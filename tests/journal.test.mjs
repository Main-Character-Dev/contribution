import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Journal } from '../packages/engine/dist/journal.js';

test('filtered event replay reaches a target beyond a full page of unrelated events', () => {
  const root = mkdtempSync(join(tmpdir(), 'ct-journal-')), journal = new Journal(root);
  try {
    const first = journal.admit(randomUUID(), 'checks', randomUUID(), {}, 'fixture');
    for (let i = 0; i < 501; i++) journal.event(first, 'fixture.progress', { i });
    const target = journal.admit(randomUUID(), 'checks', randomUUID(), {}, 'fixture');
    const events = journal.events(0, target.operationId);
    assert.equal(events.length, 1); assert.equal(events[0].operationId, target.operationId);
    assert.throws(() => journal.events(NaN), /cursor/);
  } finally { journal.close(); rmSync(root, { recursive: true }); }
});

test('bounded logs make omitted output explicit and retain a structured quota record', () => {
  const root = mkdtempSync(join(tmpdir(), 'ct-journal-')), journal = new Journal(root);
  try {
    const op = journal.admit(randomUUID(), 'checks', randomUUID(), {}, 'fixture');
    journal.log(op, 'x'.repeat(9 * 1024 * 1024));
    assert.equal(statSync(journal.logPath(op)).size, 8 * 1024 * 1024);
    assert.match(readFileSync(journal.logPath(op), 'utf8').slice(-100), /quota reached/);
    assert.ok(journal.record('logTruncation', op.attemptId));
  } finally { journal.close(); rmSync(root, { recursive: true }); }
});

test('settings mutation and completion roll back together when the operation receipt cannot commit', () => {
  const root = mkdtempSync(join(tmpdir(), 'ct-journal-')), journal = new Journal(root);
  try {
    const op = journal.admit(randomUUID(), 'settings.apply', journal.hostId, {}, 'fixture');
    journal.setMeta('settings', { label: 'Before' });
    journal.db.exec("CREATE TRIGGER reject_receipt BEFORE UPDATE ON operations BEGIN SELECT RAISE(ABORT, 'fixture failure'); END;");
    assert.throws(() => journal.update(op, { state: 'succeeded' }, 'operation.succeeded', () => journal.setMeta('settings', { label: 'After' })), /fixture failure/);
    assert.equal(journal.getMeta('settings').label, 'Before'); assert.equal(journal.get(op.operationId).state, 'queued');
  } finally { journal.close(); rmSync(root, { recursive: true }); }
});
