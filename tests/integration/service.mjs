import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import '../fixtures/environment.mjs';
import { superviseChild, waitFor } from '../fixtures/lifecycle.mjs';
import assert from 'node:assert/strict';
import { request } from '../../packages/engine/dist/ipc.js';
import { assertContract } from '../../packages/contracts/dist/index.js';

const source = resolve(import.meta.dirname, '../..');
export function git(path, ...args) {
  const result = spawnSync('git', ['-C', path, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
}
export function repository(root, name = 'repo') {
  const path = join(root, name); mkdirSync(path); git(path, 'init', '--initial-branch=dev');
  git(path, 'config', 'user.name', 'Fixture Author'); git(path, 'config', 'user.email', 'fixture@example.invalid'); return path;
}
export function commit(path, name = 'base.txt', text = 'base\n') {
  writeFileSync(join(path, name), text); git(path, 'add', '--', name); git(path, 'commit', '-m', `Fixture ${name}`); return git(path, 'rev-parse', 'HEAD');
}
export async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ct-test-')), payload = join(root, 'payload'), state = join(root, 'state');
  const build = spawnSync(process.execPath, [join(source, 'scripts/package-payload.mjs'), payload], { encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr);
  let child, supervision, stderr = '';
  const start = async (selectedPayload = payload) => {
    stderr = ''; child = spawn(join(selectedPayload, 'runtime/node'), [join(selectedPayload, 'node_modules/@contribution/engine/dist/service-main.js'), '--payload', selectedPayload, '--state-dir', state], { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stderr.on('data', data => { stderr += data; });
    supervision = superviseChild(child, () => stderr);
    try { await supervision.ready(); }
    catch (error) { await supervision.stop('SIGKILL'); throw error; }
  };
  await start();
  const call = async (command, args = {}, cwd = root) => {
    const response = await request(state, { schemaVersion: 1, command, args, cwd }); assertContract('response', response); return response;
  };
  const wait = async operationId => {
    return waitFor(async () => {
      const response = await call('runs.get', { operationId });
      return !['queued', 'running'].includes(response.operationState) && response;
    }, `Operation ${operationId}`, { timeoutMs: 30000, details: () => stderr });
  };
  const stop = (signal = 'SIGTERM') => supervision.stop(signal);
  return { root, payload, state, call, wait, start, stop, pid: () => child.pid, stderr: () => stderr,
    cli: args => spawnSync(join(payload, 'runtime/node'), [join(payload, 'node_modules/@contribution/cli/dist/main.js'), ...args, '--state-dir', state, '--json'], { encoding: 'utf8', timeout: 20000 }),
    exited: () => supervision.exited,
    cleanup: async () => { await stop(); rmSync(root, { recursive: true }); } };
}
