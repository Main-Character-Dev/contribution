import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Journal } from '../packages/engine/dist/journal.js';

test('cursor log pages preserve UTF-8, avoid replaying unchanged output and bound the first snapshot', () => {
  const root = mkdtempSync(join(tmpdir(), 'ct-log-cursor-')), journal = new Journal(root);
  try {
    const op = journal.admit(randomUUID(), 'checks', randomUUID(), {}, 'fixture');
    const text = 'a'.repeat(128 * 1024 - 2) + '🙂' + 'end'; journal.log(op, text);
    const first = journal.logRange(op, 0), second = journal.logRange(op, first.cursor);
    assert.equal(first.text + second.text, text); assert(!first.text.includes('�')); assert(!second.text.includes('�'));
    const unchanged = journal.logRange(op, second.cursor); assert.equal(unchanged.text, ''); assert.equal(unchanged.cursor, second.cursor);
    const initial = journal.logRange(op); assert(initial.reset); assert.match(initial.text, /Earlier retained output omitted/); assert(Buffer.byteLength(initial.text) < 132000);
    assert.equal(journal.logRange(op, second.cursor + 1).reset, true);
    const large = journal.update(op, { input: { tip: 'a'.repeat(40), diagnostics: 'secret'.repeat(100000) }, result: { executionHostId: 'host', diagnostics: 'retained'.repeat(100000) }, pinned: true });
    const summary = journal.summaries()[0]; assert.equal(summary.pinned, true); assert.equal(summary.result.executionHostId, 'host'); assert.equal(summary.result.remoteOperationId, undefined); assert.equal(summary.input.tip, large.input.tip);
    assert(JSON.stringify(summary).length < 2000); assert.equal(journal.get(op.operationId).input.diagnostics, large.input.diagnostics);
    assert.equal(journal.eventHead(), journal.events().at(-1).sequence);
  } finally { journal.close(); rmSync(root, { recursive: true }); }
});

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

test('immutable outbox metadata and operation admission commit or roll back together', () => {
  const root = mkdtempSync(join(tmpdir(), 'ct-journal-')), journal = new Journal(root);
  try {
    const requestId = randomUUID();
    journal.db.exec("CREATE TRIGGER reject_admission BEFORE INSERT ON operations BEGIN SELECT RAISE(ABORT, 'fixture admission failure'); END;");
    assert.throws(() => journal.admit(requestId, 'artifact_transfer', randomUUID(), {}, 'fixture', 'queued', op => {
      journal.put('artifactOutbox', op.operationId, { immutable: true }); return { delivery: 'not_dispatched' };
    }), /fixture admission failure/);
    assert.equal(journal.byRequest(requestId), undefined); assert.deepEqual(journal.records('artifactOutbox'), []);
  } finally { journal.close(); rmSync(root, { recursive: true }); }
});
