import { DatabaseSync, backup } from 'node:sqlite';
import { chmodSync, readFileSync, appendFileSync, openSync, closeSync, fsyncSync, statSync, existsSync, lstatSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { assertContract } from '@contribution/contracts';
import type { Response } from '@contribution/contracts';
import { canonical, digest, Fault, id, now, redact, requireValue, terminal } from './core.js';
import type { ObjectValue, State } from './core.js';
import { privateDirectory } from './private-files.js';

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
      try { requireValue(Number(probe.prepare('PRAGMA user_version').get()?.['user_version']) <= 1, 'DATABASE_TOO_NEW', 'This payload cannot open the newer journal. Preserve it and use a compatible release.', 3); }
      finally { probe.close(); }
    }
    this.db = new DatabaseSync(path, { enableForeignKeyConstraints: true, enableDoubleQuotedStringLiterals: false, allowExtension: false });
    chmodSync(path, 0o600);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000;');
    const version = Number(this.db.prepare('PRAGMA user_version').get()?.['user_version']);
    requireValue(version <= 1, 'DATABASE_TOO_NEW', 'This payload cannot open the newer journal. Preserve it and use a compatible release.', 3);
    if (version === 0) this.transaction(() => this.db.exec(`
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE repositories (id TEXT PRIMARY KEY, common_dir TEXT UNIQUE NOT NULL, body TEXT NOT NULL);
      CREATE TABLE operations (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, request_id TEXT UNIQUE NOT NULL, identity TEXT NOT NULL, repository_id TEXT NOT NULL, state TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT NOT NULL);
      CREATE TABLE records (namespace TEXT NOT NULL, key TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(namespace,key));
      PRAGMA user_version=1;`));
    this.hostId = this.getMeta<string>('hostId') ?? id(); this.setMeta('hostId', this.hostId);
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
  existing(requestId: string, kind: string, repositoryId: string, input: ObjectValue): Operation | undefined {
    const row = this.db.prepare('SELECT body,identity FROM operations WHERE request_id=?').get(requestId);
    if (!row) return undefined;
    requireValue(row['identity'] === digest({ kind, repositoryId, input }), 'REQUEST_ID_CONFLICT', 'This request ID already identifies different immutable inputs.');
    return JSON.parse(String(row['body'])) as Operation;
  }
  admit(requestId: string, kind: string, repositoryId: string, input: ObjectValue, payload: string, state: State = 'queued', initialResult?: (op: Operation) => ObjectValue): Operation {
    const prior = this.existing(requestId, kind, repositoryId, input); if (prior) return prior;
    const storage = this.retention(true);
    requireValue(!storage.admissionBlocked, 'STORAGE_PRESSURE', 'Retained logs reached the cap. Protected evidence remains preserved; raise the cap or export and release eligible evidence.', 3);
    const op: Operation = { operationId: id(), requestId, repositoryId, kind, input, payload, state, stage: 'accepted',
      result: {}, error: null, createdAt: now(), attemptId: id(), pinned: false, effectDispatched: false };
    if (initialResult) op.result = initialResult(op);
    const log = openSync(this.logPath(op), 'wx', 0o600); fsyncSync(log); closeSync(log);
    this.transaction(() => {
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
  list(limit = 200): Operation[] { return this.db.prepare('SELECT body FROM operations ORDER BY sequence DESC LIMIT ?').all(limit).map(row => JSON.parse(String(row['body'])) as Operation); }
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
  retention(prune = false, observedAt = Date.now()): { totalBytes: number; eligibleBytes: number; protectedBytes: number; maxLogBytes: number; admissionBlocked: boolean; removed: string[]; policy: ObjectValue } {
    const policy = this.getMeta<{ retention?: { rawLogDays: number; summaryDays: number; maxLogBytes: number } }>('settings')?.retention ?? { rawLogDays: 30, summaryDays: 365, maxLogBytes: 2147483648 };
    let totalBytes = 0, eligibleBytes = 0, protectedBytes = 0; const removed: string[] = [];
    const operations = new Map(this.list(100000).map(op => [`${op.attemptId}.log`, op]));
    for (const name of readdirSync(join(this.directory, 'logs'))) {
      const path = join(this.directory, 'logs', name), info = lstatSync(path), op = operations.get(name);
      const bytes = info.size; totalBytes += bytes;
      const completed = op?.result['completedAt'];
      const eligible = info.isFile() && !info.isSymbolicLink() && info.uid === process.getuid?.() && op && !op.pinned
        && ['succeeded', 'failed', 'cancelled'].includes(op.state) && typeof completed === 'string'
        && Date.parse(completed) <= observedAt - policy.rawLogDays * 86400000
        && !this.record('peerOperation', op.operationId);
      if (!eligible) { protectedBytes += bytes; continue; }
      eligibleBytes += bytes;
      if (prune) {
        this.put('logEviction', op.attemptId, { operationId: op.operationId, bytes, expiredAt: new Date(observedAt).toISOString(), reason: 'RAW_LOG_RETENTION' });
        unlinkSync(path); removed.push(op.attemptId); totalBytes -= bytes; eligibleBytes -= bytes;
      }
    }
    this.cachedLogBytes = totalBytes;
    return { totalBytes, eligibleBytes, protectedBytes, maxLogBytes: policy.maxLogBytes, admissionBlocked: totalBytes >= policy.maxLogBytes, removed,
      policy: { ...policy, summaries: 'Retained with immutable request identities; summary compaction pending', protects: ['pinned', 'active', 'unresolved', 'unacknowledged peer evidence'] } };
  }
  response(op: Operation): Response {
    return { schemaVersion: 1, requestStatus: terminal.has(op.state) || op.error ? 'completed' : 'accepted', operationId: op.operationId,
      operationState: op.state, result: { ...op.result, kind: op.kind, stage: op.stage, attemptId: op.attemptId, payload: op.payload,
        logRetention: { truncated: this.record('logTruncation', op.attemptId) ?? null, expired: this.record('logEviction', op.attemptId) ?? null },
        acceptance: op.kind === 'device' ? op.result['acceptance'] : { localDurable: true, canonicalHostAccepted: op.result['canonicalHostAccepted'] ?? (op.state !== 'queued_local' && !op.kind.startsWith('transfer.')),
          canonicalHostId: op.result['canonicalHostId'] ?? this.hostId, acceptedAt: op.createdAt } }, error: op.error };
  }
  async backup(path: string): Promise<void> { await backup(this.db, path); chmodSync(path, 0o600); }
  async checkpointBackup(payload: string, windowId: string): Promise<ObjectValue> {
    const root = join(this.directory, 'backups'); privateDirectory(root);
    const directory = join(root, id()); privateDirectory(directory);
    const path = join(directory, 'journal.sqlite');
    const fd = openSync(path, 'wx', 0o600); closeSync(fd);
    await this.backup(path);
    const probe = new DatabaseSync(path, { readOnly: true, allowExtension: false });
    let schemaVersion: number, lastEvent: number, operations: number;
    try {
      requireValue(probe.prepare('PRAGMA quick_check').get()?.['quick_check'] === 'ok', 'BACKUP_INVALID', 'The update backup failed its integrity check.', 3);
      schemaVersion = Number(probe.prepare('PRAGMA user_version').get()?.['user_version']);
      lastEvent = Number(probe.prepare('SELECT COALESCE(MAX(sequence),0) AS n FROM events').get()?.['n']);
      operations = Number(probe.prepare('SELECT COUNT(*) AS n FROM operations').get()?.['n']);
    } finally { probe.close(); }
    const receipt = { schemaVersion, payload, windowId, hostId: this.hostId, createdAt: now(), operations, lastEvent,
      sha256: createHash('sha256').update(readFileSync(path)).digest('hex'), path, restoration: 'manual_compatibility_review_required' };
    writeFileSync(join(directory, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    for (const target of [path, join(directory, 'receipt.json'), directory, root]) {
      const handle = openSync(target, 'r'); try { fsyncSync(handle); } finally { closeSync(handle); }
    }
    return receipt;
  }
  close(): void { this.db.close(); }
}
