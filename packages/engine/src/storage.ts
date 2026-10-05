import { lstatSync, readdirSync, unlinkSync, rmdirSync, openSync, closeSync, fsyncSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import type { Journal, Operation } from './journal.js';
import type { RetainedDeviceArtifact } from './devices.js';
import { digest, id, now, requireValue } from './core.js';
import type { ObjectValue } from './core.js';
import { validateContractFormat } from '@contribution/contracts';

interface FileIdentity { path: string; directory: boolean; dev: number; ino: number; size: number; mtime: number; ctime: number }
interface Candidate { key: string; kind: 'artifact' | 'incoming' | 'legacy'; directory: string; repositoryId: string; operationId?: string; attemptId?: string; artifactId?: string; transferId?: string; bytes: number; files: FileIdentity[] }
interface Preview { token: string; createdAt: string; candidates: Candidate[]; policy: ObjectValue }
interface Cleanup { requestId: string; token: string; preview: Preview; completed: string[]; state: 'removing' | 'completed'; result?: ObjectValue }
interface Incoming { manifest: { transferId: string; provenance: RetainedDeviceArtifact['provenance']; repositoryId: string }; directory: string; path: string; accepted?: { retainedAt: string } }
function present(path: string): boolean { try { lstatSync(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; } }

export function artifactRetention(store: Journal, artifact: RetainedDeviceArtifact): ObjectValue | null {
  return store.records<ObjectValue>('storageEviction').find(value => value['artifactId'] === artifact.provenance.artifactId && typeof value['directory'] === 'string' && artifact.path.startsWith(value['directory'] + '/')) ?? null;
}
export function requireArtifactAvailable(store: Journal, artifact: RetainedDeviceArtifact): void {
  requireValue(!artifactRetention(store, artifact) && present(artifact.path) && present(artifact.appPath),
    'ARTIFACT_EXPIRED', 'This retained artifact is unavailable or being removed. Its provenance remains readable; prepare a new artifact before another installation or transfer.', 3);
}

/** Only reproducible, positively owned terminal output is eligible. Source
 * worktrees, Git bundles/retention refs, backups, manifests and request/effect
 * receipts are deliberately outside this removal boundary. */
export class StorageRetention {
  constructor(readonly store: Journal) {}
  private ownedDirectory(path: string, category: string): boolean {
    const parent = join(this.store.directory, category), name = relative(parent, path);
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(name) || join(parent, name) !== path || !present(parent)) return false;
    const info = lstatSync(parent); return info.isDirectory() && !info.isSymbolicLink() && info.uid === process.getuid?.();
  }
  private manifest(directory: string): FileIdentity[] {
    const entries: FileIdentity[] = []; let bytes = 0;
    requireValue(lstatSync(directory).isDirectory(), 'STORAGE_OUTPUT_UNCONFIRMED', 'The retained output root is no longer a directory.', 3);
    const visit = (path: string, depth: number): void => {
      const info = lstatSync(path);
      requireValue(info.uid === process.getuid?.() && !info.isSymbolicLink() && (info.isDirectory() || (info.isFile() && info.nlink === 1)) && depth <= 32 && entries.length < 50000,
        'STORAGE_OUTPUT_UNCONFIRMED', 'Linked, shared, foreign or unusually nested output remains protected.', 3);
      bytes += info.isFile() ? info.size : 0;
      requireValue(bytes <= 4 * 1024 ** 3, 'STORAGE_OUTPUT_UNCONFIRMED', 'Output exceeds this bounded cleanup inspection.', 3);
      entries.push({ path, directory: info.isDirectory(), dev: info.dev, ino: info.ino, size: info.size, mtime: info.mtimeMs, ctime: info.ctimeMs });
      if (info.isDirectory()) for (const name of readdirSync(path).sort()) visit(join(path, name), depth + 1);
    };
    visit(directory, 0); return entries;
  }
  private settled(op: Operation | undefined, cutoff: number): boolean {
    return Boolean(op && !op.pinned && ['succeeded', 'failed', 'cancelled'].includes(op.state) && typeof op.result['completedAt'] === 'string' &&
      Date.parse(op.result['completedAt']) <= cutoff && !this.store.record('peerOperation', op.operationId));
  }
  private census(observedAt: number): { candidates: Candidate[]; protected: ObjectValue[]; policy: ObjectValue } {
    const operations = this.store.list(10001); requireValue(operations.length <= 10000, 'STORAGE_CENSUS_LIMIT', 'Large journals require a paged retention census before output can be removed.', 3);
    const rawLogDays = this.store.getMeta<{ retention: { rawLogDays: number } }>('settings')?.retention.rawLogDays ?? 30;
    const artifactCutoff = observedAt - 30 * 86400000, logCutoff = observedAt - rawLogDays * 86400000;
    const candidates: Candidate[] = [], protectedEntries: ObjectValue[] = [], visited = new Set<string>();
    const add = (value: Omit<Candidate, 'bytes' | 'files'>, eligible: boolean, category: string): void => {
      if (visited.has(value.directory) || !present(value.directory)) return; visited.add(value.directory);
      if (!eligible || !this.ownedDirectory(value.directory, category)) { protectedEntries.push({ key: value.key, reason: 'UNRESOLVED_PINNED_RECENT_OR_UNCONFIRMED' }); return; }
      try {
        const files = this.manifest(value.directory), bytes = files.filter(file => !file.directory).reduce((total, file) => total + file.size, 0);
        candidates.push({ ...value, files, bytes });
      } catch { protectedEntries.push({ key: value.key, reason: 'OUTPUT_IDENTITY_UNCONFIRMED' }); }
    };
    const artifactIdle = (artifactId: string): boolean => !operations.some(op => (op.pinned || !['succeeded', 'failed', 'cancelled'].includes(op.state)) && JSON.stringify({ input: op.input, result: op.result }).includes(artifactId));
    for (const artifact of this.store.records<RetainedDeviceArtifact>('deviceArtifact')) {
      const provenance = artifact.provenance, directory = dirname(artifact.path);
      // Incoming output has its own retained transfer-completion owner below.
      if (!this.ownedDirectory(directory, 'device-artifacts') || directory !== join(this.store.directory, 'device-artifacts', provenance.artifactId) || artifact.path !== join(directory, 'signed-app.zip') || dirname(artifact.appPath) !== directory) continue;
      const op = operations.find(value => value.attemptId === provenance.build.attemptId);
      add({ key: `artifact:${provenance.artifactId}`, kind: 'artifact', artifactId: provenance.artifactId, directory, repositoryId: provenance.repositoryId,
        ...(op ? { operationId: op.operationId, attemptId: op.attemptId } : {}) },
        this.settled(op, artifactCutoff) && Date.parse(provenance.build.preparedAt) <= artifactCutoff && artifactIdle(provenance.artifactId), 'device-artifacts');
    }
    for (const incoming of this.store.records<Incoming>('artifactIncoming')) {
      const m = incoming.manifest;
      add({ key: `incoming:${m.transferId}`, kind: 'incoming', transferId: m.transferId, artifactId: m.provenance.artifactId, directory: incoming.directory, repositoryId: m.repositoryId },
        Boolean(incoming.directory === join(this.store.directory, 'artifact-incoming', m.transferId) && incoming.path === join(incoming.directory, 'signed-app.zip') && incoming.accepted && Date.parse(incoming.accepted.retainedAt) <= artifactCutoff && artifactIdle(m.provenance.artifactId)), 'artifact-incoming');
    }
    for (const attempt of this.store.records<{ operationId: string; attemptId: string; repositoryId: string; paths: { directory: string } }>('legacyAttempt')) {
      const op = operations.find(value => value.operationId === attempt.operationId), eligible = this.settled(op, logCutoff) && op?.attemptId === attempt.attemptId && op.repositoryId === attempt.repositoryId;
      add({ key: `legacy-working:${attempt.attemptId}`, kind: 'legacy', operationId: attempt.operationId, attemptId: attempt.attemptId, repositoryId: attempt.repositoryId, directory: attempt.paths.directory }, eligible, 'legacy-attempts');
      const sealed = this.store.record<{ snapshot: string }>('legacyEvidence', attempt.attemptId);
      if (sealed) add({ key: `legacy-sealed:${attempt.attemptId}`, kind: 'legacy', operationId: attempt.operationId, attemptId: attempt.attemptId, repositoryId: attempt.repositoryId, directory: sealed.snapshot }, eligible, 'legacy-evidence');
    }
    return { candidates: candidates.sort((a, b) => a.key.localeCompare(b.key)), protected: protectedEntries,
      policy: { artifactsDays: 30, legacyRawOutputDays: rawLogDays, preserved: ['request_and_effect_receipts', 'provenance', 'source_worktrees', 'git_transfers_and_refs', 'backups', 'unresolved_or_pinned_dependencies'] } };
  }
  preview(): ObjectValue {
    const observedAt = Date.now(), census = this.census(observedAt), preview: Preview = { token: id(), createdAt: new Date(observedAt).toISOString(), candidates: census.candidates, policy: census.policy };
    this.store.put('storagePreview', preview.token, preview);
    return { scopeToken: preview.token, policy: preview.policy, eligibleBytes: preview.candidates.reduce((sum, value) => sum + value.bytes, 0),
      candidates: preview.candidates.map(({ files: _files, ...candidate }) => candidate), protected: census.protected, mutation: 'none' };
  }
  apply(token: string, requestId: string): ObjectValue {
    requireValue(validateContractFormat('uuid', token) && validateContractFormat('uuid', requestId), 'INVALID_USAGE', 'Storage cleanup requires the preview UUID and an immutable request UUID.', 2);
    let cleanup = this.store.record<Cleanup>('storageCleanup', requestId);
    if (cleanup) { requireValue(cleanup.token === token, 'REQUEST_ID_CONFLICT', 'This cleanup request has a different preview.'); if (cleanup.result) return cleanup.result; }
    const preview = cleanup?.preview ?? this.store.record<Preview>('storagePreview', token);
    requireValue(preview, 'STORAGE_PREVIEW_REQUIRED', 'Review retained storage before selecting a cleanup scope.', 3);
    requireValue(!this.store.records<Cleanup>('storageCleanup').some(other => other.requestId !== requestId && other.state === 'removing' && other.preview.candidates.some(candidate => preview.candidates.some(selected => selected.key === candidate.key))),
      'STORAGE_CLEANUP_PENDING', 'Resume the existing cleanup request for this output before selecting another request.', 3);
    const current = this.census(Date.now()), eligible = new Map(current.candidates.map(value => [value.key, value]));
    requireValue(digest(current.policy) === digest(preview.policy), 'STORAGE_SELECTION_CHANGED', 'Retention policy changed after this preview.');
    for (const candidate of preview.candidates) {
      if (cleanup?.completed.includes(candidate.key)) continue;
      const observed = eligible.get(candidate.key);
      if (!cleanup) requireValue(observed && digest(observed) === digest(candidate), 'STORAGE_SELECTION_CHANGED', 'Output, dependencies or pinning changed since preview. Obtain a fresh review.');
      else {
        // A partially removed directory still must be eligible. An absent owned
        // directory can complete its retained tombstone without touching files.
        requireValue(!present(candidate.directory) || observed, 'STORAGE_SELECTION_CHANGED', 'A new dependency or uncertain output blocks the retained cleanup.');
        if (observed) requireValue(observed.files.every(file => candidate.files.some(prior => prior.path === file.path && this.same(prior, file))), 'STORAGE_SELECTION_CHANGED', 'New or changed files are preserved during cleanup recovery.');
      }
    }
    cleanup ??= { requestId, token, preview, completed: [], state: 'removing' };
    this.store.put('storageCleanup', requestId, cleanup);
    for (const candidate of preview.candidates) {
      if (cleanup.completed.includes(candidate.key)) continue;
      this.store.put('storageEviction', candidate.key, { state: 'removing', requestId, repositoryId: candidate.repositoryId, operationId: candidate.operationId ?? null, attemptId: candidate.attemptId ?? null, artifactId: candidate.artifactId ?? null, transferId: candidate.transferId ?? null, directory: candidate.directory, bytes: candidate.bytes, observedAt: now() });
      // Never recurse into an unreviewed filename. A new file causes rmdir to
      // fail and preserves the remaining directory for explicit reconciliation.
      for (const file of [...candidate.files].reverse()) {
        if (!present(file.path)) continue;
        // Recheck each reviewed ancestor as well as the file. A replaced
        // directory must never redirect a later unlink outside this output.
        for (const parent of candidate.files.filter(value => value.directory && file.path.startsWith(value.path + '/'))) {
          const observed = lstatSync(parent.path);
          requireValue(observed.isDirectory() && !observed.isSymbolicLink() && observed.dev === parent.dev && observed.ino === parent.ino,
            'STORAGE_SELECTION_CHANGED', 'A replaced output directory is preserved for inspection.');
        }
        const stat = lstatSync(file.path), actual: FileIdentity = { path: file.path, directory: stat.isDirectory(), dev: stat.dev, ino: stat.ino, size: stat.size, mtime: stat.mtimeMs, ctime: stat.ctimeMs };
        requireValue(stat.uid === process.getuid?.() && !stat.isSymbolicLink() && (file.directory || (stat.isFile() && stat.nlink === 1)) && this.same(file, actual), 'STORAGE_SELECTION_CHANGED', 'A changed output is preserved instead of being removed.');
        if (file.directory) rmdirSync(file.path); else unlinkSync(file.path);
      }
      const fd = openSync(dirname(candidate.directory), 'r'); try { fsyncSync(fd); } finally { closeSync(fd); }
      this.store.transaction(() => {
        this.store.put('storageEviction', candidate.key, { ...this.store.record<ObjectValue>('storageEviction', candidate.key), state: 'removed', removedAt: now() });
        cleanup!.completed.push(candidate.key); this.store.put('storageCleanup', requestId, cleanup);
      });
    }
    const result = { requestId, scopeToken: token, removed: cleanup.completed, bytes: preview.candidates.reduce((total, value) => total + value.bytes, 0), receiptsPreserved: true };
    this.store.put('storageCleanup', requestId, { ...cleanup, state: 'completed', result }); return result;
  }
  private same(a: FileIdentity, b: FileIdentity): boolean {
    // Directory metadata necessarily changes as its reviewed children disappear.
    return a.path === b.path && a.directory === b.directory && a.dev === b.dev && a.ino === b.ino && (a.directory || (a.size === b.size && a.mtime === b.mtime && a.ctime === b.ctime));
  }
}
