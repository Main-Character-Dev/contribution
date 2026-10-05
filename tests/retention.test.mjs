import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Journal } from '../packages/engine/dist/journal.js';

test('raw retention removes only expired completed unpinned logs and preserves replay identities', () => {
  const root = mkdtempSync(join(tmpdir(), 'ct-retention-')), journal = new Journal(root);
  try {
    const rows = ['succeeded', 'pinned', 'outcome_unknown', 'running', 'peer', 'interrupted'].map(kind => {
      let op = journal.admit(randomUUID(), 'checks', randomUUID(), { kind }, 'fixture'); journal.log(op, kind + '\n');
      op = journal.update(op, { state: ['pinned', 'peer'].includes(kind) ? 'succeeded' : kind, pinned: kind === 'pinned', result: { completedAt: new Date().toISOString() } });
      if (kind === 'peer') journal.put('peerOperation', op.operationId, { from: randomUUID() }); return op;
    });
    for (const op of rows) journal.update(op, { result: { completedAt: '2020-01-01T00:00:00.000Z' } });
    const report = journal.retention(true); assert.deepEqual(report.removed, [rows[0].attemptId]);
    for (const op of rows.slice(1)) assert(existsSync(journal.logPath(op)));
    assert.throws(() => journal.logs(rows[0]), error => error.code === 'LOG_EXPIRED');
    assert.equal(journal.admit(rows[0].requestId, rows[0].kind, rows[0].repositoryId, rows[0].input, 'new-payload').operationId, rows[0].operationId);
    assert(journal.response(rows[0]).result.logRetention.expired);
  } finally { journal.close(); rmSync(root, { recursive: true }); }
});

test('the log cap bounds running output and rejects every new admission while original requests remain readable', () => {
  const root = mkdtempSync(join(tmpdir(), 'ct-retention-')), journal = new Journal(root);
  try {
    journal.setMeta('settings', { retention: { rawLogDays: 30, summaryDays: 365, maxLogBytes: 100 } });
    const op = journal.admit(randomUUID(), 'device', randomUUID(), {}, 'fixture'); journal.log(op, 'x'.repeat(500)); journal.log(op, 'more');
    assert.equal(statSync(journal.logPath(op)).size, 100); assert.equal(journal.retention().admissionBlocked, true);
    assert.throws(() => journal.admit(randomUUID(), 'remote.push', randomUUID(), {}, 'fixture'), error => error.code === 'STORAGE_PRESSURE');
    assert.equal(journal.admit(op.requestId, op.kind, op.repositoryId, op.input, 'fixture').operationId, op.operationId);
    assert(journal.response(op).result.logRetention.truncated);
  } finally { journal.close(); rmSync(root, { recursive: true }); }
});
