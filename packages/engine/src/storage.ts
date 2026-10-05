import { lstatSync, realpathSync, unlinkSync, rmdirSync, openSync, closeSync, fsyncSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import type { Journal, Operation } from './journal.js';
import type { RetainedDeviceArtifact } from './devices.js';
import { digest, id, now, requireValue, Fault } from './core.js';
import type { ObjectValue } from './core.js';
import { validateContractFormat } from '@contribution/contracts';
import { outputFile, outputManifest, sameOutputFile } from './output-files.js';
import type { OutputFile } from './output-files.js';
import type { BuildOutputOwner } from './build-output.js';
import type { BackupOutputOwner } from './backup-output.js';
import { stableFileDigest } from './bounded-file.js';
import { alive, processIdentity } from './process.js';

type FileIdentity = OutputFile;
interface Candidate { key: string; kind: 'artifact' | 'incoming' | 'legacy' | 'build' | 'backup'; directory: string; repositoryId: string; operationId?: string; attemptId?: string; artifactId?: string; transferId?: string; bytes: number; files: FileIdentity[] }
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
 * worktrees, Git bundles/retention refs, manifests and request/effect
 * receipts are deliberately outside this removal boundary. */
export class StorageRetention {
  constructor(readonly store: Journal) {}
  private ownedDirectory(path: string, category: string): boolean {
    const parent = join(this.store.directory, category), name = relative(parent, path);
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(name) || join(parent, name) !== path || !present(parent)) return false;
    const info = lstatSync(parent); return info.isDirectory() && !info.isSymbolicLink() && info.uid === process.getuid?.();
  }
  private settled(op: Operation | undefined, cutoff: number): boolean {
    return Boolean(op && !op.pinned && ['succeeded', 'failed', 'cancelled'].includes(op.state) && typeof op.result['completedAt'] === 'string' &&
      Date.parse(op.result['completedAt']) <= cutoff && !this.store.record('peerOperation', op.operationId));
  }
  private census(observedAt: number): { candidates: Candidate[]; protected: ObjectValue[]; policy: ObjectValue } {
    const operations = this.store.list(10001); requireValue(operations.length <= 10000, 'STORAGE_CENSUS_LIMIT', 'Large journals require a paged retention census before output can be removed.', 3);
    const rawLogDays = this.store.getMeta<{ retention: { rawLogDays: number } }>('settings')?.retention.rawLogDays ?? 30;
    const summaryDays = this.store.getMeta<{ retention: { summaryDays: number } }>('settings')?.retention.summaryDays ?? 365;
    const artifactCutoff = observedAt - 30 * 86400000, logCutoff = observedAt - rawLogDays * 86400000;
    const candidates: Candidate[] = [], protectedEntries: ObjectValue[] = [], visited = new Set<string>();
    const add = (value: Omit<Candidate, 'bytes' | 'files'>, eligible: boolean, category: string, sealedFiles?: FileIdentity[]): void => {
      if (visited.has(value.directory) || !present(value.directory)) return; visited.add(value.directory);
      if (!eligible || !this.ownedDirectory(value.directory, category)) { protectedEntries.push({ key: value.key, reason: 'UNRESOLVED_PINNED_RECENT_OR_UNCONFIRMED' }); return; }
      try {
        const files = outputManifest(value.directory, { allowLinks: value.kind === 'build' }), bytes = files.filter(file => !file.directory).reduce((total, file) => total + file.size, 0);
        if (sealedFiles) {
          const partial = this.store.record<{ state: string }>('storageEviction', value.key)?.state === 'removing';
          const sealed = new Map(sealedFiles.map(file => [file.path, file]));
          requireValue((partial || files.length === sealedFiles.length) && files.every(file => sealed.has(file.path) && sameOutputFile(sealed.get(file.path)!, file)),
            'STORAGE_OUTPUT_UNCONFIRMED', 'Output changed after its completion snapshot.', 3);
        }
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
    for (const owner of this.store.records<BuildOutputOwner>('buildOutput')) {
      const op = operations.find(value => value.operationId === owner.operationId), source = join(realpathSync(this.store.directory), 'device-builds', owner.attemptId, 'source');
      const checkout = this.store.record<{ operationId: string; directory: string; kind: string }>('ownedWorktree', owner.attemptId);
      const removal = this.store.record<{ operationId: string; directory: string }>('worktreeEviction', owner.attemptId);
      const artifacts = this.store.records<RetainedDeviceArtifact>('deviceArtifact').filter(value => value.provenance.build.attemptId === owner.attemptId);
      const dependent = operations.some(other => other.repositoryId === owner.repositoryId && (!['succeeded', 'failed', 'cancelled'].includes(other.state) ||
        other.pinned && (other.operationId === owner.operationId || JSON.stringify({ input: other.input, result: other.result }).includes(owner.directory)) ||
        (other.result['processes'] as { pid: number; start: string | null }[] | undefined)?.some(proc => alive(proc.pid) && (!proc.start || !processIdentity(proc.pid) || processIdentity(proc.pid) === proc.start))));
      let directoriesMatch = false;
      try { directoriesMatch = Boolean(owner.root && owner.parent && [owner.root, owner.parent].every(entry => {
        const current = outputFile(entry.path); return current.directory && current.dev === entry.dev && current.ino === entry.ino;
      })); } catch { /* Replaced or absent roots remain unconfirmed. */ }
      add({ key: `build:${owner.attemptId}`, kind: 'build', directory: owner.directory, repositoryId: owner.repositoryId, operationId: owner.operationId, attemptId: owner.attemptId },
        Boolean(owner.phase === 'sealed' && owner.files && directoriesMatch && op?.attemptId === owner.attemptId && op.repositoryId === owner.repositoryId &&
          owner.directory === join(this.store.directory, 'device-builds', owner.attemptId) && this.settled(op, logCutoff) && !dependent && artifacts.every(value => artifactIdle(value.provenance.artifactId)) &&
          checkout?.kind === 'build' && checkout.operationId === owner.operationId && checkout.directory === source && removal?.operationId === owner.operationId && removal.directory === source && !present(source)),
        'device-builds', owner.files);
    }
    const backups = this.store.records<BackupOutputOwner>('backupOutput');
    requireValue(backups.length <= 1000, 'STORAGE_CENSUS_LIMIT', 'Large backup inventories require a paged cleanup census.', 3);
    const history = this.store.records<ObjectValue>('maintenanceHistory');
    const completedBackup = (owner: BackupOutputOwner): ObjectValue | undefined => history.find(value => value['id'] === owner.windowId && ['activated', 'cancelled'].includes(String(value['outcome'])) &&
      typeof value['completedAt'] === 'string' && owner.receipt && digest(value['backup']) === digest(owner.receipt));
    const intact = (owner: BackupOutputOwner): boolean => {
      try {
        return Boolean(owner.phase === 'sealed' && owner.hostId === this.store.hostId && owner.directory === join(this.store.directory, 'backups', owner.id) &&
          owner.receipt?.['schemaVersion'] === 1 && owner.receipt['hostId'] === this.store.hostId && owner.receipt['path'] === join(owner.directory, 'journal.sqlite') &&
          owner.root && owner.parent && [owner.root, owner.parent].every(entry => {
            const current = outputFile(entry.path); return current.directory && current.dev === entry.dev && current.ino === entry.ino;
          }) && owner.files && completedBackup(owner));
      } catch { return false; }
    };
    const complete = backups.filter(owner => {
      if (!intact(owner) || this.store.record('storageEviction', `backup:${owner.id}`)) return false;
      try {
        const files = outputManifest(owner.directory), sealed = new Map(owner.files!.map(file => [file.path, file]));
        return files.length === sealed.size && files.every(file => sealed.has(file.path) && sameOutputFile(sealed.get(file.path)!, file));
      } catch { return false; }
    }).sort((a, b) => b.generation - a.generation);
    // Independently rehash the two recovery copies we will retain. Filesystem
    // metadata alone must not make a damaged backup sufficient redundancy.
    const retainedBackups = complete.slice(0, 2).filter(owner => {
      try { return stableFileDigest(String(owner.receipt!['path']), 4 * 1024 ** 3, 'BACKUP_INVALID').sha256 === owner.receipt!['sha256']; }
      catch { return false; }
    });
    const backupIdle = !this.store.getMeta('maintenance') && !this.store.getMeta('maintenanceWindow') && !operations.some(op => op.pinned ||
      !['succeeded', 'failed', 'cancelled'].includes(op.state) || this.store.record('peerOperation', op.operationId) ||
      (op.result['processes'] as { pid: number; start: string | null }[] | undefined)?.some(proc => alive(proc.pid) && (!proc.start || !processIdentity(proc.pid) || processIdentity(proc.pid) === proc.start)));
    for (const owner of backups) {
      const completed = completedBackup(owner), cutoff = observedAt - summaryDays * 86400000;
      const newer = retainedBackups.filter(other => other.generation > owner.generation && Number(other.receipt!['lastEvent']) >= Number(owner.receipt?.['lastEvent']) &&
        Number(other.receipt!['operations']) >= Number(owner.receipt?.['operations']));
      add({ key: `backup:${owner.id}`, kind: 'backup', directory: owner.directory, repositoryId: this.store.hostId },
        Boolean(backupIdle && intact(owner) && completed && Date.parse(String(completed['completedAt'])) <= cutoff && newer.length >= 2), 'backups', owner.files);
    }
    return { candidates: candidates.sort((a, b) => a.key.localeCompare(b.key)), protected: protectedEntries,
      policy: { artifactsDays: 30, legacyRawOutputDays: rawLogDays, buildOutputDays: rawLogDays, buildSourceRemoval: 'requires_prior_confirmed_git_cleanup', backupDays: summaryDays, minimumNewerBackups: 2,
        preserved: ['request_and_effect_receipts', 'provenance', 'source_worktrees', 'git_transfers_and_refs', 'latest_two_complete_backups', 'unresolved_or_pinned_dependencies'] } };
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
        if (observed) {
          const selected = new Map(candidate.files.map(file => [file.path, file]));
          requireValue(observed.files.every(file => selected.has(file.path) && this.same(selected.get(file.path)!, file)), 'STORAGE_SELECTION_CHANGED', 'New or changed files are preserved during cleanup recovery.');
        }
      }
    }
    cleanup ??= { requestId, token, preview, completed: [], state: 'removing' };
    this.store.put('storageCleanup', requestId, cleanup);
    for (const candidate of preview.candidates) {
      if (cleanup.completed.includes(candidate.key)) continue;
      this.store.put('storageEviction', candidate.key, { state: 'removing', requestId, repositoryId: candidate.repositoryId, operationId: candidate.operationId ?? null, attemptId: candidate.attemptId ?? null, artifactId: candidate.artifactId ?? null, transferId: candidate.transferId ?? null, directory: candidate.directory, bytes: candidate.bytes, observedAt: now() });
      const selectedFiles = new Map(candidate.files.map(file => [file.path, file]));
      // Never recurse into an unreviewed filename. A new file causes rmdir to
      // fail and preserves the remaining directory for explicit reconciliation.
      for (const file of [...candidate.files].reverse()) {
        if (!present(file.path)) continue;
        // Recheck each reviewed ancestor as well as the file. A replaced
        // directory must never redirect a later unlink outside this output.
        for (let parentPath = dirname(file.path); parentPath === candidate.directory || parentPath.startsWith(candidate.directory + '/'); parentPath = dirname(parentPath)) {
          const parent = selectedFiles.get(parentPath);
          requireValue(parent?.directory, 'STORAGE_SELECTION_CHANGED', 'An unreviewed output ancestor is preserved.', 3);
          const observed = lstatSync(parent.path);
          requireValue(observed.isDirectory() && !observed.isSymbolicLink() && observed.dev === parent.dev && observed.ino === parent.ino,
            'STORAGE_SELECTION_CHANGED', 'A replaced output directory is preserved for inspection.');
        }
        let actual: FileIdentity;
        try { actual = outputFile(file.path, candidate.kind === 'build'); } catch { throw new Fault('STORAGE_SELECTION_CHANGED', 'A changed output is preserved instead of being removed.', 3); }
        requireValue(this.same(file, actual), 'STORAGE_SELECTION_CHANGED', 'A changed output is preserved instead of being removed.');
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
    return sameOutputFile(a, b);
  }
}
