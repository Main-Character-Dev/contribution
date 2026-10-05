import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
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
  let child, stderr = '';
  const start = async () => {
    stderr = ''; child = spawn(join(payload, 'runtime/node'), [join(payload, 'node_modules/@contribution/engine/dist/service-main.js'), '--payload', payload, '--state-dir', state], { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stderr.on('data', data => { stderr += data; });
    await Promise.race([once(child.stdout, 'data'), once(child, 'exit').then(() => { throw new Error(stderr || 'Service exited before readiness'); }),
      new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error(`Service readiness timeout: ${stderr}`)), 10000); timer.unref(); })]);
  };
  await start();
  const call = async (command, args = {}, cwd = root) => {
    const response = await request(state, { schemaVersion: 1, command, args, cwd }); assertContract('response', response); return response;
  };
  const wait = async operationId => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const response = await call('runs.get', { operationId });
      if (!['queued', 'running'].includes(response.operationState)) return response;
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    throw new Error('Operation deadline exceeded');
  };
  const stop = async (signal = 'SIGTERM') => { if (child.exitCode === null) { child.kill(signal); await once(child, 'exit'); } };
  return { root, payload, state, call, wait, start, stop, pid: () => child.pid, stderr: () => stderr,
    cli: args => spawnSync(join(payload, 'runtime/node'), [join(payload, 'node_modules/@contribution/cli/dist/main.js'), ...args, '--state-dir', state, '--json'], { encoding: 'utf8', timeout: 20000 }),
    cleanup: async () => { await stop(); rmSync(root, { recursive: true }); } };
}
