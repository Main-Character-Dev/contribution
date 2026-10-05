import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, existsSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Journal } from '../packages/engine/dist/journal.js';
import { BackendSessions } from '../packages/engine/dist/backend-sessions.js';
import { Maintenance } from '../packages/engine/dist/maintenance.js';
import { Engine } from '../packages/engine/dist/service.js';
import { alive, processIdentity } from '../packages/engine/dist/process.js';

const deviceId = 'device-' + 'b'.repeat(32), udid = 'fixture-phone-001';
function fixture(body = 'exit 0') {
  const root = mkdtempSync(join(tmpdir(), 'ct-backend-session-')), store = new Journal(join(root, 'state'));
  const executable = join(root, 'fixture-backend');
  writeFileSync(executable, '#!/bin/sh\nprintf "%s\\n" "$$" > "$CONTRIBUTION_BACKEND_STATE/fixture-started"\nprintf "%s\\n" "$@" > "$CONTRIBUTION_BACKEND_STATE/fixture-args"\n/usr/bin/env > "$CONTRIBUTION_BACKEND_STATE/fixture-env"\n' + body + '\n', { mode: 0o555 });
  const selected = { path: executable, sha256: createHash('sha256').update(readFileSync(executable)).digest('hex'), revision: 'synthetic-no-device-library' };
  const supervisor = new BackendSessions(store, selected);
  return { root, store, executable, selected, supervisor,
    prepare: (seconds = 10) => { const session = supervisor.prepare(deviceId, udid, seconds); writeFileSync(join(session.directory, 'pairings', 'fixture.json'), '{"synthetic":true}', { mode: 0o600 }); return session; },
    cleanup: () => { store.close(); rmSync(root, { recursive: true, force: true }); } };
}
async function until(predicate) {
  const deadline = Date.now() + 4000;
  while (!predicate()) { assert(Date.now() < deadline, 'fixture did not reach expected state'); await new Promise(resolve => setTimeout(resolve, 10)); }
}

test('backend starts only after the exact durable process grant and keeps phone proof separate from local exit', async () => {
  const f = fixture(); try {
    const session = f.prepare(); let checks = 0;
    const done = await f.supervisor.start(session.sessionId, () => {
      checks++;
      const retained = f.supervisor.get(session.sessionId);
      assert.equal(retained.dispatchGranted, false);
      assert.equal(existsSync(join(session.directory, 'fixture-started')), false);
      if (checks === 2) { assert(retained.process); assert.equal(processIdentity(retained.process.pid), retained.process.start); }
    });
    assert.equal(checks, 2); assert.equal(done.exit.code, 0); assert.equal(done.state, 'exited'); assert.equal(done.localProcess, 'exited');
    assert.equal(done.phoneSession, 'unknown'); assert.equal(done.control, null);
    assert.equal(Number(readFileSync(join(session.directory, 'fixture-started'), 'utf8')), done.process.pid);
    assert.deepEqual(readFileSync(join(session.directory, 'fixture-args'), 'utf8').trim().split('\n'), ['tunnel', 'start', '--userspace', '--udid', udid, '--pair-record-path', join(session.directory, 'pairings')]);
    assert.equal(statSync(join(session.directory, 'session.key')).mode & 0o777, 0o600);
    assert.equal(statSync(join(session.directory, 'pairings')).mode & 0o777, 0o700);
    const environment = readFileSync(join(session.directory, 'fixture-env'), 'utf8');
    assert.match(environment, /CONTRIBUTION_BACKEND_STATE=/); assert.doesNotMatch(environment, /NODE_OPTIONS|GO_IOS_|USBMUXD_|DEVICECTL_CHILD_|DYLD_/);
    assert.throws(() => f.supervisor.prepare(deviceId, udid, 10), { code: 'BACKEND_SESSION_UNRECONCILED' });
    await assert.rejects(f.supervisor.start(session.sessionId, () => {}), { code: 'BACKEND_SESSION_UNRECONCILED' });
  } finally { f.cleanup(); }
});

test('missing private trust, changed material and changed immutable executable cannot dispatch', async () => {
  for (const kind of ['trust', 'key', 'permissions', 'executable', 'paused', 'maintenance']) {
    const f = fixture(); try {
      const session = kind === 'trust' ? f.supervisor.prepare(deviceId, udid, 10) : f.prepare();
      if (kind === 'key') writeFileSync(join(session.directory, 'session.key'), Buffer.alloc(32, 8));
      if (kind === 'permissions') chmodSync(join(session.directory, 'pairings', 'fixture.json'), 0o644);
      if (kind === 'executable') { chmodSync(f.executable, 0o755); writeFileSync(f.executable, '#!/bin/sh\nexit 0\n'); chmodSync(f.executable, 0o555); }
      if (['paused', 'maintenance'].includes(kind)) f.store.setMeta(kind, true);
      await assert.rejects(f.supervisor.start(session.sessionId, () => {}));
      assert.equal(existsSync(join(session.directory, 'fixture-started')), false, kind);
      assert.equal(f.supervisor.get(session.sessionId).dispatchGranted, false, kind);
    } finally { f.cleanup(); }
  }
});

test('revocation at the durable grant barrier stops the wrapper before any backend call', async () => {
  for (const kind of ['revoke', 'material', 'maintenance', 'recovery']) {
    const f = fixture(); try {
      const session = f.prepare(); let checks = 0;
      await assert.rejects(f.supervisor.start(session.sessionId, () => {
        if (++checks !== 2) return;
        if (kind === 'revoke') throw new Error('fixture authority revoked');
        if (kind === 'material') writeFileSync(join(session.directory, 'pairings', 'fixture.json'), '{"changed":true}');
        if (kind === 'maintenance') f.store.setMeta('maintenance', true);
        if (kind === 'recovery') new BackendSessions(f.store, f.selected).reconcile(session.sessionId);
      }), { code: 'PROCESS_OBSERVER_FAILED' });
      const retained = f.supervisor.get(session.sessionId);
      assert.equal(retained.dispatchGranted, false); assert.equal(retained.phoneSession, 'not_started');
      assert.equal(retained.localProcess, 'exited'); assert.equal(retained.state, 'exited'); assert.equal(alive(retained.process.pid), false);
      assert.equal(existsSync(join(session.directory, 'fixture-started')), false);
      // A fully observed pre-dispatch failure needs no phone release proof.
      assert.equal(f.supervisor.prepare(deviceId, udid, 10).state, 'prepared');
    } finally { f.cleanup(); }
  }
});

test('a grant cannot dispatch after synchronous policy verification consumes the retained deadline', async () => {
  const f = fixture(); try {
    const session = f.prepare(1); let checks = 0;
    await assert.rejects(f.supervisor.start(session.sessionId, () => {
      if (++checks !== 2) return;
      const deadline = Date.now() + 1100;
      while (Date.now() < deadline) { /* Simulate a bounded synchronous policy read. */ }
    }), { code: 'PROCESS_OBSERVER_FAILED' });
    assert.equal(f.supervisor.get(session.sessionId).dispatchGranted, false);
    assert.equal(existsSync(join(session.directory, 'fixture-started')), false);
  } finally { f.cleanup(); }
});

test('restart reconciliation does not reconnect or kill; explicit cancellation targets only the active owned process', async () => {
  const f = fixture('trap "exit 0" TERM\nwhile :; do /bin/sleep 0.1; done');
  let operation;
  try {
    const session = f.prepare(); operation = f.supervisor.start(session.sessionId, () => {});
    await until(() => existsSync(join(session.directory, 'fixture-started')));
    const retained = f.supervisor.get(session.sessionId), recovered = new BackendSessions(f.store, f.selected);
    const checkpoint = recovered.cancel(session.sessionId);
    assert.equal(checkpoint.state, 'unconfirmed'); assert.equal(checkpoint.localProcess, 'running'); assert.equal(alive(retained.process.pid), true);
    assert.equal(checkpoint.phoneSession, 'unknown');
    const maintenance = new Maintenance(f.store, 'fixture-payload');
    assert.equal(maintenance.isReady(maintenance.blockers(0, false, 0)), false);
    f.supervisor.cancel(session.sessionId); const done = await operation;
    assert.equal(done.exit.cancelled, true); assert.equal(done.exit.code, 130); assert.equal(done.localProcess, 'exited');
    assert.equal(done.phoneSession, 'unknown'); assert.equal(alive(retained.process.pid), false);
    assert.equal(maintenance.isReady(maintenance.blockers(0, false, 0)), true);
  } finally { if (operation) { for (const record of f.store.records('backendSession')) f.supervisor.cancel(record.sessionId); await operation; } f.cleanup(); }
});

test('deadline, overflow and unknown retained process identity remain bounded and cannot prove phone release', async () => {
  for (const kind of ['timeout', 'overflow']) {
    const f = fixture(kind === 'overflow' ? '/usr/bin/yes fixture-output' : 'trap "exit 0" TERM\nwhile :; do /bin/sleep 0.1; done');
    try {
      const session = f.prepare(1), done = await f.supervisor.start(session.sessionId, () => {});
      assert.equal(done.exit.code, kind === 'timeout' ? 124 : 5); assert.equal(done.phoneSession, 'unknown');
      assert.equal(done.exit.timedOut, kind === 'timeout'); assert.equal(done.exit.outputLimited, kind === 'overflow');
      assert.equal(JSON.stringify(done).includes('fixture-output'), false);
      f.store.put('backendSession', session.sessionId, { ...done, state: 'running', process: { pid: process.pid, start: 'wrong-retained-start' } });
      const recovered = f.supervisor.reconcile(session.sessionId); assert.equal(recovered.localProcess, 'unknown'); assert.equal(recovered.state, 'unconfirmed');
    } finally { f.cleanup(); }
  }
});

test('engine startup preserves uncertain session state and exposes a bounded private-safe status', async () => {
  const f = fixture(); try {
    const session = f.prepare();
    f.store.put('backendSession', session.sessionId, { ...session, state: 'running', dispatchGranted: true, phoneSession: 'unknown', localProcess: 'running', process: { pid: process.pid, start: 'not-this-process-start' } });
    const engine = new Engine(f.store, { identity: 'fixture-payload', distribution: 'development', runtime: process.execPath });
    const response = await engine.dispatch({ schemaVersion: 1, command: 'service.status', args: {}, cwd: f.root });
    const status = response.result.backendSessions;
    assert.equal(status.total, 1); assert.equal(status.sessions[0].state, 'unconfirmed'); assert.equal(status.sessions[0].localProcess, 'unknown');
    assert.equal(status.sessions[0].phoneSession, 'unknown');
    assert.equal(JSON.stringify(status).includes(udid), false); assert.equal(JSON.stringify(status).includes(session.directory), false);
    assert.equal(JSON.stringify(status).includes(session.keyDigest), false);
    assert.equal(engine.maintenance.isReady(engine.maintenance.blockers(0, false, 0)), false);
    assert.equal(existsSync(join(session.directory, 'fixture-started')), false);
  } finally { f.cleanup(); }
});
