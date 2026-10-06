import { DatabaseSync, backup } from 'node:sqlite';
import { chmodSync, readFileSync, appendFileSync, openSync, closeSync, fsyncSync, statSync, existsSync, lstatSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertContract } from '@contribution/contracts';
import type { Response } from '@contribution/contracts';
import { canonical, digest, Fault, id, now, redact, requireValue, terminal } from './core.js';
import type { ObjectValue, State } from './core.js';
import { privateDirectory } from './private-files.js';
import { ManagedStorage } from './managed-storage.js';
import { BackupOutput } from './backup-output.js';
import { stableFileDigest } from './bounded-file.js';
import { peerEvidenceProtected, peerCompletionStatus } from './peer-receipts.js';

export interface Operation {
  operationId: string; requestId: string; repositoryId: string; kind: string; input: ObjectValue;
  state: State; stage: string; result: ObjectValue; error: Response['error']; createdAt: string;
  attemptId: string; payload: string; pinned: boolean; effectDispatched: boolean;
}
export class Journal {
  readonly db: DatabaseSync;
  readonly hostId: string;
  private cachedLogBytes: number | undefined;
  constructor(readonly directory: string) {
    privateDirectory(directory); privateDirectory(join(directory, 'logs'));
    const path = join(directory, 'journal.sqlite');
    for (const file of [path, `${path}-wal`, `${path}-shm`]) if (existsSync(file)) {
      const info = lstatSync(file);
      requireValue(info.isFile() && !info.isSymbolicLink() && info.uid === process.getuid?.(), 'UNSAFE_JOURNAL', 'Journal files must be regular files owned by this user.', 3);
    }
    // Check compatibility read-only before changing journal mode or metadata.
    if (existsSync(path) && statSync(path).size) {
      const probe = new DatabaseSync(path, { readOnly: true, allowExtension: false });
      try { requireValue(Number(probe.prepare('PRAGMA user_version').get()?.['user_version']) <= 3, 'DATABASE_TOO_NEW', 'This payload cannot open the newer journal. Preserve it and use a compatible release.', 3); }
      finally { probe.close(); }
    }
    this.db = new DatabaseSync(path, { enableForeignKeyConstraints: true, enableDoubleQuotedStringLiterals: false, allowExtension: false });
    chmodSync(path, 0o600);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000;');
    const version = Number(this.db.prepare('PRAGMA user_version').get()?.['user_version']);
    requireValue(version <= 3, 'DATABASE_TOO_NEW', 'This payload cannot open the newer journal. Preserve it and use a compatible release.', 3);
    if (version === 0) this.transaction(() => this.db.exec(`
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE repositories (id TEXT PRIMARY KEY, common_dir TEXT UNIQUE NOT NULL, body TEXT NOT NULL);
      CREATE TABLE operations (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, request_id TEXT UNIQUE NOT NULL, identity TEXT NOT NULL, repository_id TEXT NOT NULL, state TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT NOT NULL);
      CREATE TABLE records (namespace TEXT NOT NULL, key TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(namespace,key));
      PRAGMA user_version=1;`));
    this.hostId = this.getMeta<string>('hostId') ?? id(); this.setMeta('hostId', this.hostId);
  }
  enableConnectivity(): void {
    // Fence old dispatchers before recording acceptance-unknown remote checks.
    if (Number(this.db.prepare('PRAGMA user_version').get()?.['user_version']) < 3) this.db.exec('PRAGMA user_version=3');
  }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  getMeta<T>(key: string): T | undefined {
    const row = this.db.prepare('SELECT value FROM metadata WHERE key=?').get(key);
    return row ? JSON.parse(String(row['value'])) as T : undefined;
  }
  setMeta(key: string, value: unknown): void { this.db.prepare('INSERT INTO metadata VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, canonical(value)); }
  record<T>(namespace: string, key: string): T | undefined {
    const row = this.db.prepare('SELECT body FROM records WHERE namespace=? AND key=?').get(namespace, key);
    return row ? JSON.parse(String(row['body'])) as T : undefined;
  }
  records<T>(namespace: string): T[] { return this.db.prepare('SELECT body FROM records WHERE namespace=?').all(namespace).map(row => JSON.parse(String(row['body'])) as T); }
  put(namespace: string, key: string, value: unknown): void { this.db.prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(namespace,key) DO UPDATE SET body=excluded.body').run(namespace, key, canonical(value)); }
  assertRepositoryAvailable(repositoryId: string, enrolling = false): void {
    requireValue(!this.records<{ repositoryId: string; owner: string; state: string; lifetime: string }>('resource').some(r => r.repositoryId === repositoryId && ['utility', 'borrowed'].includes(r.owner) && ['ephemeral', 'borrowed'].includes(r.lifetime) && ['unresolved', 'stopping', 'intent', 'allocated'].includes(r.state)), 'RESOURCE_RECONCILIATION_REQUIRED', 'A retained resource in this clone needs its owning reconciliation before new work.', 3);
    requireValue(!this.records<{ state: string; preview: { resources: { repositoryId: string }[] } }>('resourceCleanup').some(r => r.state === 'stopping' && r.preview.resources.some(x => x.repositoryId === repositoryId)), 'RESOURCE_CLEANUP_PENDING', 'Resume the retained exact resource cleanup before new work in this clone.', 3);
    const bundleCleanup = this.db.prepare(`SELECT r.key FROM records r, json_each(r.body,'$.preview.candidates') c
      WHERE r.namespace='gitBundleCleanup' AND json_extract(r.body,'$.state')='removing'
      AND json_extract(c.value,'$.repositoryId')=? LIMIT 1`).get(repositoryId);
    requireValue(!bundleCleanup, 'STORAGE_CLEANUP_PENDING', 'Resume the retained Git bundle cleanup before new work in this clone.', 3);
    const removal = this.record<{ state: string }>('repositoryRemoval', repositoryId);
    requireValue(!removal || removal.state === 'completed', 'REPOSITORY_REMOVAL_PENDING', 'Resume repos remove with the same repository ID to reconcile its retained removal before new work.', 3);
    requireValue(!removal || enrolling || this.db.prepare('SELECT id FROM repositories WHERE id=?').get(repositoryId), 'REPOSITORY_NOT_ENROLLED', 'This repository left Contribution. Enroll it explicitly before starting new work.', 3);
  }
  existing(requestId: string, kind: string, repositoryId: string, input: ObjectValue): Operation | undefined {
    const row = this.db.prepare('SELECT body,identity FROM operations WHERE request_id=?').get(requestId);
    if (!row) return undefined;
    requireValue(row['identity'] === digest({ kind, repositoryId, input }), 'REQUEST_ID_CONFLICT', 'This request ID already identifies different immutable inputs.');
    return JSON.parse(String(row['body'])) as Operation;
  }
  assertAdmissionStorage(kind?: string, repositoryId?: string, input: ObjectValue = {}): void {
    const storage = this.retention(true);
    new ManagedStorage(this).assertAdmission();
    if (!storage.admissionBlocked) return;
    // A full cap must not prevent the owner from raising that cap. This
    // exception is restricted to one reviewed retention-only control request.
    const previous = this.getMeta<ObjectValue>('settings'), config = input['config'] as ObjectValue | undefined;
    let recovery = false;
    if (kind === 'settings.apply' && repositoryId === this.hostId && previous && config && input['expectedRevision'] === digest(previous)) {
      try {
        assertContract('machine', config);
        const retention = config['retention'] as { maxLogBytes: number };
        recovery = Number.isSafeInteger(retention.maxLogBytes) && retention.maxLogBytes > storage.totalBytes && digest({ ...config, retention: previous['retention'] }) === digest(previous) &&
          !this.unsettled().some(op => op.kind === 'settings.apply');
      } catch { /* Invalid settings never gain a storage-recovery exception. */ }
    }
    requireValue(recovery, 'STORAGE_PRESSURE', 'Protected logs reached the cap. Raise the cap above current usage with a reviewed retention-only settings change, or release eligible evidence. Other new work remains paused.', 3);
  }
  admit(requestId: string, kind: string, repositoryId: string, input: ObjectValue, payload: string, state: State = 'queued', initialResult?: (op: Operation) => ObjectValue): Operation {
    const prior = this.existing(requestId, kind, repositoryId, input); if (prior) return prior;
    this.assertRepositoryAvailable(repositoryId);
    requireValue(!this.records<{ state: string; completed: string[]; preview: { candidates: { owner: { repositoryId: string; attemptId: string } }[] } }>('worktreeCleanup')
      .some(cleanup => cleanup.state === 'removing' && cleanup.preview.candidates.some(value => value.owner.repositoryId === repositoryId && !cleanup.completed.includes(value.owner.attemptId))),
      'STORAGE_CLEANUP_PENDING', 'A retained worktree cleanup is in progress for this clone. Resume that cleanup before admitting new work.', 3);
    this.assertAdmissionStorage(kind, repositoryId, input);
    const op: Operation = { operationId: id(), requestId, repositoryId, kind, input, payload, state, stage: 'accepted',
      result: {}, error: null, createdAt: now(), attemptId: id(), pinned: false, effectDispatched: false };
    const log = openSync(this.logPath(op), 'wx', 0o600); fsyncSync(log); closeSync(log);
    this.transaction(() => {
      if (initialResult) op.result = initialResult(op);
      this.db.prepare('INSERT INTO operations(id,request_id,identity,repository_id,state,body) VALUES(?,?,?,?,?,?)')
        .run(op.operationId, requestId, digest({ kind, repositoryId, input }), repositoryId, state, canonical(op));
      this.event(op, `${kind}.accepted`, { state });
    }); return op;
  }
  get(operationId: string): Operation {
    const row = this.db.prepare('SELECT body FROM operations WHERE id=?').get(operationId);
    if (!row) throw new Fault('RUN_NOT_FOUND', 'No retained operation has this identity.', 2);
    return JSON.parse(String(row['body'])) as Operation;
  }
  byRequest(requestId: string): Operation | undefined {
    const row = this.db.prepare('SELECT body FROM operations WHERE request_id=?').get(requestId);
    return row ? JSON.parse(String(row['body'])) as Operation : undefined;
  }
  list(limit = 200): Operation[] { return this.db.prepare('SELECT body FROM operations ORDER BY sequence DESC LIMIT ?').all(limit).map(row => JSON.parse(String(row['body'])) as Operation); }
  peerEvidenceProtected(op: Operation): boolean { return peerEvidenceProtected(this, op); }
  queue(): Operation[] { return this.db.prepare("SELECT body FROM operations WHERE state='queued' ORDER BY sequence").all().map(row => JSON.parse(String(row['body'])) as Operation); }
  unsettled(): Operation[] { return this.db.prepare("SELECT body FROM operations WHERE state NOT IN ('succeeded','failed','cancelled','interrupted') ORDER BY sequence").all().map(row => JSON.parse(String(row['body'])) as Operation); }
  update(op: Operation, patch: Partial<Operation>, type = 'operation.changed', mutation?: () => void): Operation {
    const updated = { ...op, ...patch };
    if (['succeeded', 'failed', 'cancelled', 'interrupted'].includes(updated.state) && !updated.result['completedAt']) updated.result = { ...updated.result, completedAt: now() };
    this.transaction(() => {
      mutation?.();
      this.db.prepare('UPDATE operations SET state=?,body=? WHERE id=?').run(updated.state, canonical(updated), op.operationId);
      this.event(updated, type, { state: updated.state, stage: updated.stage, attemptId: updated.attemptId });
    }); return updated;
  }
  event(op: Operation, type: string, payload: ObjectValue): void {
    const row = this.db.prepare('INSERT INTO events(body) VALUES(?)').run('{}');
    const event = { schemaVersion: 1, eventId: id(), originHostId: this.hostId, sequence: Number(row.lastInsertRowid),
      operationId: op.operationId, repositoryId: op.repositoryId, occurredAt: now(), type, payload };
    assertContract('event', event);
    this.db.prepare('UPDATE events SET body=? WHERE sequence=?').run(canonical(event), Number(row.lastInsertRowid));
  }
  events(after = 0, operationId?: string): ObjectValue[] {
    requireValue(Number.isSafeInteger(after) && after >= 0, 'INVALID_CURSOR', 'Event cursor must be a nonnegative integer.', 2);
    const rows = operationId
      ? this.db.prepare("SELECT body FROM events WHERE sequence>? AND json_extract(body,'$.operationId')=? ORDER BY sequence LIMIT 500").all(after, operationId)
      : this.db.prepare('SELECT body FROM events WHERE sequence>? ORDER BY sequence LIMIT 500').all(after);
    return rows.map(row => JSON.parse(String(row['body'])) as ObjectValue);
  }
  logPath(op: Operation): string { return join(this.directory, 'logs', `${op.attemptId}.log`); }
  log(op: Operation, text: string): void {
    const path = this.logPath(op), maxLogBytes = this.getMeta<{ retention: { maxLogBytes: number } }>('settings')?.retention.maxLogBytes ?? 2147483648;
    const usage = this.cachedLogBytes ?? this.retention().totalBytes, limit = Math.min(8 * 1024 * 1024, statSync(path).size + Math.max(0, maxLogBytes - usage));
    const size = statSync(path).size, bytes = Buffer.from(redact(text));
    if (size >= limit) { this.put('logTruncation', op.attemptId, { occurredAt: now(), limit, reason: 'STORAGE_QUOTA' }); return; }
    if (size + bytes.length >= limit) {
      const marker = Buffer.from('\n[Contribution log quota reached; further output omitted]\n');
      appendFileSync(path, Buffer.concat([bytes.subarray(0, Math.max(0, limit - size - marker.length)), marker.subarray(0, limit - size)]));
      this.put('logTruncation', op.attemptId, { occurredAt: now(), limit });
    } else appendFileSync(path, bytes, { mode: 0o600 });
    this.cachedLogBytes = usage + statSync(path).size - size;
  }
  logs(op: Operation, tail = 200): string {
    requireValue(Number.isInteger(tail) && tail > 0 && tail <= 10000, 'INVALID_LOG_RANGE', 'Request between 1 and 10000 retained lines.', 2);
    if (!existsSync(this.logPath(op)) && this.record('logEviction', op.attemptId)) throw new Fault('LOG_EXPIRED', 'Raw output expired under retention. Its operation summary and replay identity remain retained.', 3);
    try { return readFileSync(this.logPath(op), 'utf8').split('\n').slice(-tail).join('\n'); } catch { throw new Fault('LOG_UNAVAILABLE', 'The retained log is unavailable on this host.', 3); }
  }
  retainRemoteLog(op: Operation, hostId: string, text: string, state: 'available' | 'expired' | 'unavailable'): void {
    requireValue(typeof op.result['remoteOperationId'] === 'string' && [op.result['canonicalHostId'], op.result['executionHostId']].includes(hostId),
      'PEER_OPERATION_MISMATCH', 'Remote logs must belong to the retained operation owner.', 3);
    requireValue(Buffer.byteLength(text) <= 132000, 'PEER_LOG_TOO_LARGE', 'The peer log snapshot exceeded its bound.', 3);
    this.put('remoteLogStatus', op.operationId, { state, observedAt: now(), originHostId: hostId });
    if (state !== 'available') return;
    const usage = this.retention(true);
    if (this.record('remoteLogEviction', op.attemptId)) return; // Expired snapshots do not silently resurrect.
    const previous = this.record<{ text?: string }>('remoteLog', op.operationId), oldBytes = typeof previous?.text === 'string' ? Buffer.byteLength(previous.text) : 0;
    const limit = Math.min(132000, oldBytes + Math.max(0, usage.maxLogBytes - usage.totalBytes)), bytes = Buffer.from(redact(text));
    const truncated = bytes.length > limit;
    // Decode only complete UTF-8 characters; replacement characters could
    // otherwise increase a byte-limited snapshot beyond the selected cap.
    let end = Math.min(bytes.length, limit);
    if (end < bytes.length) while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end--;
    const retained = bytes.subarray(0, end).toString('utf8');
    this.put('remoteLog', op.operationId, { text: retained, observedAt: now(), originHostId: hostId, truncated, retainedBytes: Buffer.byteLength(retained) });
    this.cachedLogBytes = usage.totalBytes - oldBytes + Buffer.byteLength(retained);
  }
  remoteLogs(op: Operation, tail = 200): ObjectValue {
    requireValue(Number.isInteger(tail) && tail > 0 && tail <= 10000, 'INVALID_LOG_RANGE', 'Request between 1 and 10000 retained lines.', 2);
    requireValue(!this.record('remoteLogEviction', op.attemptId), 'LOG_EXPIRED', 'The cached remote log expired under local retention. Its operation and completion receipt remain retained.', 3);
    const cached = this.record<ObjectValue>('remoteLog', op.operationId), status = this.record<ObjectValue>('remoteLogStatus', op.operationId);
    requireValue(cached && typeof cached['text'] === 'string', status?.['state'] === 'expired' ? 'LOG_EXPIRED' : 'LOG_UNAVAILABLE', 'No retained remote log is available for this operation.', 3);
    return { ...cached, text: (cached['truncated'] === true ? '[Remote log snapshot truncated by the local log-storage cap]\n' : '') + String(cached['text']).split('\n').slice(-tail).join('\n'), freshness: 'cached', sourceStatus: status ?? null };
  }
  retention(prune = false, observedAt = Date.now()): { totalBytes: number; eligibleBytes: number; protectedBytes: number; maxLogBytes: number; admissionBlocked: boolean; removed: string[]; policy: ObjectValue } {
    const policy = this.getMeta<{ retention?: { rawLogDays: number; summaryDays: number; maxLogBytes: number } }>('settings')?.retention ?? { rawLogDays: 30, summaryDays: 365, maxLogBytes: 2147483648 };
    let totalBytes = 0, eligibleBytes = 0, protectedBytes = 0; const removed: string[] = [];
    const operations = new Map(this.list(100000).map(op => [`${op.attemptId}.log`, op]));
    const settled = (op: Operation | undefined): op is Operation => Boolean(op && !op.pinned && ['succeeded', 'failed', 'cancelled'].includes(op.state) &&
      typeof op.result['completedAt'] === 'string' && Date.parse(op.result['completedAt']) <= observedAt - policy.rawLogDays * 86400000 && !this.peerEvidenceProtected(op));
    for (const name of readdirSync(join(this.directory, 'logs'))) {
      const path = join(this.directory, 'logs', name), info = lstatSync(path), op = operations.get(name);
      const bytes = info.size; totalBytes += bytes;
      const eligible = info.isFile() && !info.isSymbolicLink() && info.uid === process.getuid?.() && settled(op);
      if (!eligible) { protectedBytes += bytes; continue; }
      eligibleBytes += bytes;
      if (prune) {
        this.put('logEviction', op.attemptId, { operationId: op.operationId, bytes, expiredAt: new Date(observedAt).toISOString(), reason: 'RAW_LOG_RETENTION' });
        unlinkSync(path); removed.push(op.attemptId); totalBytes -= bytes; eligibleBytes -= bytes;
      }
    }
    const byId = new Map([...operations.values()].map(op => [op.operationId, op]));
    // Account for raw text stored in SQLite without loading every log body.
    const remote = this.db.prepare("SELECT key,json_type(body,'$.text') AS text_type,length(CAST(CASE WHEN json_type(body,'$.text')='text' THEN json_extract(body,'$.text') ELSE body END AS BLOB)) AS bytes FROM records WHERE namespace='remoteLog'").all();
    for (const row of remote) {
      const op = byId.get(String(row['key'])), bytes = Number(row['bytes']); totalBytes += bytes;
      if (row['text_type'] !== 'text' || !settled(op)) { protectedBytes += bytes; continue; }
      eligibleBytes += bytes;
      if (prune) {
        this.transaction(() => {
          this.put('remoteLogEviction', op.attemptId, { operationId: op.operationId, bytes, expiredAt: new Date(observedAt).toISOString(), reason: 'RAW_LOG_RETENTION' });
          this.db.prepare("DELETE FROM records WHERE namespace='remoteLog' AND key=?").run(op.operationId);
        });
        removed.push(`remote:${op.attemptId}`); totalBytes -= bytes; eligibleBytes -= bytes;
      }
    }
    this.cachedLogBytes = totalBytes;
    return { totalBytes, eligibleBytes, protectedBytes, maxLogBytes: policy.maxLogBytes, admissionBlocked: totalBytes >= policy.maxLogBytes, removed,
      policy: { ...policy, includes: ['local_raw_log_files', 'cached_remote_log_text'], summaries: 'Retained with immutable request identities; summary compaction pending', protects: ['pinned', 'active', 'unresolved', 'unacknowledged peer evidence'] } };
  }
  response(op: Operation): Response {
    const response: Response = { schemaVersion: 1, requestStatus: terminal.has(op.state) || op.error ? 'completed' : 'accepted', operationId: op.operationId,
      operationState: op.state, result: { ...op.result, kind: op.kind, stage: op.stage, attemptId: op.attemptId, payload: op.payload,
        logRetention: { truncated: this.record('logTruncation', op.attemptId) ?? null, expired: this.record('logEviction', op.attemptId) ?? null, remoteExpired: this.record('remoteLogEviction', op.attemptId) ?? null },
        outputRetention: [...['legacy-working', 'legacy-sealed', 'build'].map(kind => this.record('storageEviction', `${kind}:${op.attemptId}`)), this.record('worktreeEviction', op.attemptId), this.record('gitBundleOperationEviction', op.operationId)].filter(Boolean),
        acceptance: ['device', 'remote.device', 'device_transfer'].includes(op.kind) ? op.result['acceptance'] : op.kind === 'artifact_transfer' ? { localDurable: true, executionHostAccepted: true, executionHostId: this.hostId, acceptedAt: op.createdAt } : { localDurable: true, canonicalHostAccepted: op.result['canonicalHostAccepted'] ?? (op.state !== 'queued_local' && !op.kind.startsWith('transfer.')),
          canonicalHostId: op.result['canonicalHostId'] ?? this.hostId, acceptedAt: op.createdAt } }, error: op.error };
    const completion = peerCompletionStatus(this, op, response);
    if (completion) response.result = { ...response.result, peerCompletion: completion };
    return response;
  }
  async backup(path: string): Promise<void> { await backup(this.db, path); chmodSync(path, 0o600); }
  async checkpointBackup(payload: string, windowId: string): Promise<ObjectValue> {
    const output = new BackupOutput(this), owner = output.begin(payload, windowId), directory = owner.directory, root = join(this.directory, 'backups');
    const path = join(directory, 'journal.sqlite');
    const fd = openSync(path, 'wx', 0o600); closeSync(fd);
    await this.backup(path);
    // The online backup is our new private output, not the live journal. Let
    // SQLite finish it as a standalone database and remove its own WAL/SHM
    // before hashing. Read-only WAL inspection otherwise creates sidecars.
    const probe = new DatabaseSync(path, { allowExtension: false });
    let schemaVersion: number, lastEvent: number, operations: number;
    try {
      requireValue(probe.prepare('PRAGMA journal_mode=DELETE').get()?.['journal_mode'] === 'delete', 'BACKUP_INVALID', 'The update backup could not become a standalone recovery copy.', 3);
      requireValue(probe.prepare('PRAGMA quick_check').get()?.['quick_check'] === 'ok', 'BACKUP_INVALID', 'The update backup failed its integrity check.', 3);
      schemaVersion = Number(probe.prepare('PRAGMA user_version').get()?.['user_version']);
      lastEvent = Number(probe.prepare('SELECT COALESCE(MAX(sequence),0) AS n FROM events').get()?.['n']);
      operations = Number(probe.prepare('SELECT COUNT(*) AS n FROM operations').get()?.['n']);
    } finally { probe.close(); }
    const receipt = { schemaVersion, payload, windowId, hostId: this.hostId, createdAt: now(), operations, lastEvent,
      sha256: stableFileDigest(path, 4 * 1024 ** 3, 'BACKUP_INVALID').sha256, path, restoration: 'manual_compatibility_review_required' };
    writeFileSync(join(directory, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    for (const target of [path, join(directory, 'receipt.json'), directory, root]) {
      const handle = openSync(target, 'r'); try { fsyncSync(handle); } finally { closeSync(handle); }
    }
    output.seal(owner, receipt);
    return receipt;
  }
  close(): void { this.db.close(); }
}
