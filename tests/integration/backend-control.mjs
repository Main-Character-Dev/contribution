import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, realpathSync, writeFileSync, lstatSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PrivateBackendControl } from '../../packages/engine/dist/backend-control.js';

const executable = process.argv[2]; assert(executable?.endsWith('/control-fixture'));
for (const mode of ['ready', 'not-ready', 'not-found']) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'ct-go-interop-'))); writeFileSync(join(directory, 'session.key'), randomBytes(32), { mode: 0o600 });
  const child = spawn(executable, [mode], { env: { ...process.env, CONTRIBUTION_BACKEND_STATE: directory }, stdio: ['ignore', 'ignore', 'pipe'] });
  const exited = once(child, 'exit'); let error = ''; child.stderr.on('data', bytes => { if (error.length < 4096) error += bytes; });
  const watchdog = setTimeout(() => child.kill('SIGTERM'), 15000);
  try {
    const deadline = Date.now() + 5000;
    while (true) {
      let ready = false; try { const stat = lstatSync(join(directory, 'control.sock')); ready = stat.isSocket() && (stat.mode & 0o777) === 0o600; } catch { /* fixture starting */ }
      if (ready) break;
      assert.equal(child.exitCode, null, error); assert(Date.now() < deadline, 'fixture socket deadline'); await new Promise(resolve => setTimeout(resolve, 10));
    }
    const observed = await new PrivateBackendControl(directory, 'fixture-phone-001').observe();
    assert.equal(observed.controlAuthenticated, true); assert.equal(observed.scope, 'selected_private_backend_only'); assert.equal(observed.ready, mode !== 'not-ready');
    assert.equal(observed.tunnel?.udid ?? null, mode === 'ready' ? 'fixture-phone-001' : null);
  } finally { clearTimeout(watchdog); child.kill('SIGTERM'); await exited; rmSync(directory, { recursive: true }); }
}
process.stdout.write('Passed: TypeScript client and actual Go overlay authenticate three fixed synthetic control scenarios; no device library linked or phone contacted.\n');
