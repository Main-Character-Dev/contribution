import { closeSync, fsyncSync, lstatSync, openSync, realpathSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { validateContractFormat } from '@contribution/contracts';
import type { Journal } from './journal.js';
import type { Enrolled } from './repositories.js';
import type { TransferManifest } from './peers.js';
import { digest, id, now, requireValue } from './core.js';
import type { ObjectValue } from './core.js';
import { outputFile, sameOutputFile } from './output-files.js';
import type { OutputFile } from './output-files.js';
import { stableFileDigest } from './bounded-file.js';
import { MAX_GIT_BUNDLE } from './git-bundle.js';
import { incomingFileSize } from './incoming-file.js';
import type { IncomingFileIdentity } from './incoming-file.js';
import { gitText, identity } from './git.js';
import { assertRepositorySettled } from './repository-idle.js';

interface Source {
  key: string; direction: 'outgoing' | 'incoming'; ownerKey: string; ownerDigest: string;
  repositoryId: string; operationId: string; attemptId: string; path: string; ref: string; tip: string; sha256: string; bytes: number;
}
interface Candidate extends Source { file: OutputFile; parent: OutputFile; primary: string; commonDir: string; clone: OutputFile }
interface Preview { token: string; candidates: Candidate[]; minimumAgeDays: number }
interface Cleanup { requestId: string; preview: Preview; completed: string[]; state: 'removing' | 'completed'; result?: ObjectValue }
interface Producer { state: string; path: string; parent: string; bundle?: { bytes: number; sha256: string }; file?: { dev: string; ino: string; size: string; mtime: string; mode: string; uid: string } }
interface Incoming { path: string; fileIdentity?: IncomingFileIdentity; manifest: TransferManifest; accepted?: { response: { operationId: string }; incomingRef: string } }
const busy = new WeakSet<Journal>();
function present(path: string): boolean { try { lstatSync(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; } }

/** A bundle is a duplicate transport artifact. Cleanup preserves its Git ref,
 * all source objects, immutable manifests and acknowledged outcome receipts. */
export class GitBundleRetention {
  constructor(readonly store: Journal) {}
  private days(): number { return this.store.getMeta<{ retention: { rawLogDays: number } }>('settings')?.retention.rawLogDays ?? 30; }
  private source(direction: Source['direction'], ownerKey: string): Source {
    requireValue(validateContractFormat('uuid', ownerKey), 'GIT_BUNDLE_PROTECTED', 'An unrecognized owner identity cannot authorize bundle cleanup.', 3);
    if (direction === 'outgoing') {
      const producer = this.store.record<Producer>('bundleProduction', ownerKey), op = this.store.byRequest(ownerKey);
      const capture = this.store.record<{ bundle: string; retention: string; tip: string; bundleDigest: string }>('capture', ownerKey);
      const manifest = op?.input['manifest'] as TransferManifest | undefined;
      requireValue(producer?.state === 'completed' && producer.bundle && producer.file && op &&
        (op.kind === 'submit' && capture || ['transfer.seed', 'transfer.mirror'].includes(op.kind) && manifest),
        'GIT_BUNDLE_PROTECTED', 'An incomplete or unassociated bundle producer remains protected.', 3);
      const path = producer.path, ref = capture?.retention ?? manifest!.sourceRef, tip = capture?.tip ?? manifest!.tip, sha256 = capture?.bundleDigest ?? manifest!.bundleDigest;
      requireValue(path === join(this.store.directory, 'transfers', `${digest({ requestId: ownerKey })}.bundle`) &&
        path === (capture?.bundle ?? op.input['path']) && producer.parent === realpathSync(dirname(path)) && producer.bundle.sha256 === sha256,
        'GIT_BUNDLE_PROTECTED', 'The completed producer and immutable source selection disagree.', 3);
      return { key: `outgoing:${ownerKey}`, direction, ownerKey, ownerDigest: digest({ producer, capture, manifest }), repositoryId: op.repositoryId,
        operationId: op.operationId, attemptId: op.attemptId, path, ref, tip, sha256, bytes: producer.bundle.bytes };
    }
    const transfer = this.store.record<Incoming>('transfer', ownerKey), m = transfer?.manifest;
    requireValue(transfer?.accepted && transfer.fileIdentity && m && m.transferId === ownerKey && transfer.path === join(this.store.directory, 'incoming', `${ownerKey}.bundle`),
      'GIT_BUNDLE_PROTECTED', 'Unaccepted or unowned incoming bytes remain protected.', 3);
    const op = this.store.get(transfer.accepted.response.operationId), ref = `refs/contribution/incoming/${m.senderHostId}/${m.requestId}`;
    requireValue(op.repositoryId === m.repositoryId && op.requestId === m.requestId && op.input['senderHostId'] === m.senderHostId && op.input['incomingRef'] === ref && op.input['tip'] === m.tip && transfer.accepted.incomingRef === ref,
      'GIT_BUNDLE_PROTECTED', 'The incoming bundle lacks its exact imported source and operation receipt.', 3);
    return { key: `incoming:${ownerKey}`, direction, ownerKey, ownerDigest: digest(transfer), repositoryId: op.repositoryId,
      operationId: op.operationId, attemptId: op.attemptId, path: transfer.path, ref, tip: m.tip, sha256: m.bundleDigest, bytes: m.bytes };
  }
  private eligible(source: Source): void {
    requireValue(!this.store.getMeta('maintenance'), 'SERVICE_MAINTENANCE', 'Bundle cleanup waits for the update maintenance window to finish.', 3);
    const op = this.store.get(source.operationId);
    requireValue(op.attemptId === source.attemptId && op.repositoryId === source.repositoryId && !op.pinned && op.state === 'succeeded' &&
      typeof op.result['completedAt'] === 'string' && Date.parse(op.result['completedAt']) <= Date.now() - this.days() * 86400000,
      'GIT_BUNDLE_PROTECTED', 'Recent, failed, pinned or unfinished source history remains protected.', 3);
    assertRepositorySettled(this.store, source.repositoryId);
    const pinned = this.store.db.prepare("SELECT id FROM operations WHERE repository_id=? AND json_extract(body,'$.pinned')=1 LIMIT 1").get(source.repositoryId);
    requireValue(!pinned, 'GIT_BUNDLE_PROTECTED', 'A pinned repository record preserves its associated source transport evidence.', 3);
    requireValue(digest(this.source(source.direction, source.ownerKey)) === digest(source), 'GIT_BUNDLE_CHANGED', 'The retained bundle owner or manifest changed.', 3);
  }
  private async inspect(source: Source, previous?: Candidate, missingAllowed = false): Promise<Candidate> {
    this.eligible(source);
    requireValue(/^[a-f0-9]{40,64}$/.test(source.tip) && /^[a-f0-9]{64}$/.test(source.sha256) && Number.isSafeInteger(source.bytes) && source.bytes > 0 && source.bytes <= MAX_GIT_BUNDLE &&
      (source.direction === 'outgoing' ? /^refs\/contribution\/outbox\/[a-f0-9]{64}$/ : /^refs\/contribution\/incoming\/[a-f0-9-]{36}\/[a-f0-9-]{36}$/).test(source.ref),
      'GIT_BUNDLE_CHANGED', 'The retained source is outside the bounded Git transport contract.', 3);
    const row = this.store.db.prepare('SELECT body FROM repositories WHERE id=?').get(source.repositoryId);
    requireValue(row, 'GIT_BUNDLE_PROTECTED', 'Reenroll and reconcile the source clone before retiring its bundle.', 3);
    const options = { timeoutMs: 3000, maxBytes: 65536, signal: AbortSignal.timeout(5000) };
    const repo = JSON.parse(String(row['body'])) as Enrolled, info = await identity(repo.path, options);
    requireValue(info.path === repo.path && info.commonDir === repo.commonDir && realpathSync(repo.path) === repo.path && realpathSync(repo.commonDir) === repo.commonDir,
      'GIT_BUNDLE_CHANGED', 'The enrolled source clone was replaced or relocated.', 3);
    requireValue(await gitText(repo.path, ['rev-parse', '--verify', source.ref], options) === source.tip &&
      await gitText(repo.path, ['cat-file', '-t', source.tip], options) === 'commit', 'GIT_BUNDLE_HISTORY_UNRETAINED', 'Keep the bundle until its exact source commit is retained by its original Git ref.', 3);
    this.eligible(source);
    const parent = outputFile(dirname(source.path)), clone = outputFile(repo.commonDir);
    requireValue(parent.directory && clone.directory && realpathSync(dirname(source.path)) === dirname(source.path) && (lstatSync(parent.path).mode & 0o077) === 0,
      'GIT_BUNDLE_CHANGED', 'Bundle cleanup requires its unchanged private directory.', 3);
    if (!present(source.path)) {
      requireValue(missingAllowed && previous && sameOutputFile(previous.parent, parent) && sameOutputFile(previous.clone, clone) && previous.primary === repo.path && previous.commonDir === repo.commonDir,
        'GIT_BUNDLE_CHANGED', 'Missing output is not proof of an authorized cleanup.', 3);
      return previous;
    }
    const file = outputFile(source.path);
    requireValue(!file.directory && !file.link, 'GIT_BUNDLE_CHANGED', 'The bundle is no longer an unshared regular file.', 3);
    if (source.direction === 'incoming') {
      const transfer = this.store.record<Incoming>('transfer', source.ownerKey)!;
      incomingFileSize(source.path, source.bytes, transfer.fileIdentity);
    } else {
      const producer = this.store.record<Producer>('bundleProduction', source.ownerKey)!, info = lstatSync(source.path, { bigint: true });
      requireValue(digest(producer.file) === digest({ dev: String(info.dev), ino: String(info.ino), size: String(info.size), mtime: String(info.mtimeNs), mode: String(info.mode), uid: String(info.uid) }),
        'GIT_BUNDLE_CHANGED', 'The bundle no longer has its original producer identity.', 3);
    }
    requireValue(digest(stableFileDigest(source.path, MAX_GIT_BUNDLE, 'GIT_BUNDLE_CHANGED')) === digest({ bytes: source.bytes, sha256: source.sha256 }), 'GIT_BUNDLE_CHANGED', 'Bundle bytes differ from the immutable transport digest.', 3);
    return { ...source, file, parent, clone, primary: repo.path, commonDir: repo.commonDir };
  }
  async preview(): Promise<ObjectValue> {
    const candidates: Candidate[] = [], protectedEntries: ObjectValue[] = [], started = Date.now(); let inspectedBytes = 0;
    const rows = this.store.db.prepare("SELECT namespace,key FROM records WHERE namespace IN ('bundleProduction','transfer') ORDER BY namespace,key LIMIT 1001").all();
    requireValue(rows.length <= 1000, 'STORAGE_CENSUS_LIMIT', 'Larger bundle inventories need a paged retention census.', 3);
    for (const row of rows) {
      const direction = row['namespace'] === 'transfer' ? 'incoming' : 'outgoing', key = String(row['key']), eviction = this.store.record<{ state: string }>('gitBundleEviction', `${direction}:${key}`);
      if (eviction?.state === 'removed') continue;
      try {
        requireValue(!eviction && Date.now() - started < 3000, 'GIT_BUNDLE_REVIEW_BOUND', 'Resume retained cleanup or review remaining bundles in another bounded batch.', 3);
        const source = this.source(direction, key);
        inspectedBytes += source.bytes;
        requireValue(inspectedBytes <= 512 * 1024 * 1024, 'GIT_BUNDLE_REVIEW_BOUND', 'The remaining bundles require another bounded review batch.', 3);
        candidates.push(await this.inspect(source));
      } catch (error) { protectedEntries.push({ key: `${direction}:${key}`, reason: (error as { code?: string }).code ?? 'GIT_BUNDLE_INSPECTION_UNAVAILABLE' }); }
    }
    const preview: Preview = { token: id(), candidates, minimumAgeDays: this.days() }; this.store.put('gitBundlePreview', preview.token, preview);
    return { scopeToken: preview.token, bundles: true, minimumAgeDays: preview.minimumAgeDays, candidates: candidates.map(({ file: _file, parent: _parent, clone: _clone, ...value }) => value),
      eligibleBytes: candidates.reduce((sum, value) => sum + value.bytes, 0), protected: protectedEntries, refsAndReceipts: 'preserved', mutation: 'none' };
  }
  async apply(token: string, requestId: string): Promise<ObjectValue> {
    requireValue(validateContractFormat('uuid', token) && validateContractFormat('uuid', requestId), 'INVALID_USAGE', 'Bundle cleanup requires its preview and immutable request UUID.', 2);
    requireValue(!busy.has(this.store), 'STORAGE_CLEANUP_BUSY', 'Another Git bundle cleanup is active.', 4); busy.add(this.store);
    try {
      let cleanup = this.store.record<Cleanup>('gitBundleCleanup', requestId);
      if (cleanup) { requireValue(cleanup.preview.token === token, 'REQUEST_ID_CONFLICT', 'The cleanup request selects another bundle review.'); if (cleanup.result) return cleanup.result; }
      const preview = cleanup?.preview ?? this.store.record<Preview>('gitBundlePreview', token);
      requireValue(preview, 'STORAGE_PREVIEW_REQUIRED', 'Review retained Git bundles before removing transport bytes.', 3);
      requireValue(!this.store.records<Cleanup>('gitBundleCleanup').some(other => other.requestId !== requestId && other.state === 'removing'), 'STORAGE_CLEANUP_PENDING', 'Resume the retained bundle cleanup first.', 3);
      requireValue(preview.minimumAgeDays === this.days(), 'STORAGE_SELECTION_CHANGED', 'Bundle retention policy changed after review.', 3);
      if (!cleanup) {
        for (const selected of preview.candidates) requireValue(digest(await this.inspect(this.source(selected.direction, selected.ownerKey))) === digest(selected), 'STORAGE_SELECTION_CHANGED', 'Reviewed bundle ownership, bytes or clone changed.', 3);
        cleanup = { requestId, preview, completed: [], state: 'removing' }; this.store.put('gitBundleCleanup', requestId, cleanup);
      }
      for (const selected of preview.candidates) {
        if (cleanup.completed.includes(selected.key)) continue;
        const eviction = this.store.record<{ state: string; requestId: string }>('gitBundleEviction', selected.key);
        requireValue(!eviction || eviction.requestId === requestId, 'STORAGE_CLEANUP_PENDING', 'Another removal owns this bundle.', 3);
        requireValue(digest(await this.inspect(this.source(selected.direction, selected.ownerKey), selected, eviction?.state === 'removing')) === digest(selected), 'STORAGE_SELECTION_CHANGED', 'Bundle or retained source changed during cleanup.', 3);
        const source = this.source(selected.direction, selected.ownerKey); this.eligible(source);
        this.store.put('gitBundleEviction', selected.key, { requestId, operationId: selected.operationId, state: 'removing', path: selected.path, ref: selected.ref, tip: selected.tip, bytes: selected.bytes });
        if (present(selected.path)) {
          requireValue(sameOutputFile(selected.parent, outputFile(dirname(selected.path))) && sameOutputFile(selected.file, outputFile(selected.path)), 'GIT_BUNDLE_CHANGED', 'A replacement bundle or containing directory is preserved.', 3);
          unlinkSync(selected.path);
        }
        const fd = openSync(dirname(selected.path), 'r'); try { fsyncSync(fd); } finally { closeSync(fd); }
        this.store.transaction(() => {
          const receipt = { ...this.store.record<ObjectValue>('gitBundleEviction', selected.key), state: 'removed', removedAt: now(), refsAndReceipts: 'preserved' };
          this.store.put('gitBundleEviction', selected.key, receipt); this.store.put('gitBundleOperationEviction', selected.operationId, receipt);
          cleanup!.completed.push(selected.key); this.store.put('gitBundleCleanup', requestId, cleanup);
        });
      }
      const result = { requestId, scopeToken: token, bundles: true, removed: cleanup.completed, refsAndReceipts: 'preserved' };
      this.store.put('gitBundleCleanup', requestId, { ...cleanup, state: 'completed', result }); return result;
    } finally { busy.delete(this.store); }
  }
}
