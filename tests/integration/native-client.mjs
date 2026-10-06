import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fixture, repository } from './service.mjs';
import { Journal } from '../../packages/engine/dist/journal.js';
import { assertContract } from '../../packages/contracts/dist/index.js';

const probe = process.argv[2]; assert(probe?.startsWith('/'), 'Pass the compiled Swift client probe');
const f = await fixture();
try {
  const native = (command, args = {}) => {
    const result = spawnSync(probe, [f.state, command, JSON.stringify(args)], { encoding: 'utf8', timeout: 20000 });
    assert.equal(result.status, 0, result.stderr); const response = JSON.parse(result.stdout); assertContract('response', response); return response;
  };
  assert.equal(native('version').result.payload, (await f.call('version')).result.payload);
  const repo = (await f.call('repos.add', { path: repository(f.root) })).result.repository;
  const accepted = native('repos.initialize', { repo: repo.id, requestId: randomUUID() }); assert.equal(accepted.error, null);
  const final = await f.wait(accepted.operationId); assert.equal(final.operationState, 'succeeded');
  assert.equal(native('runs.get', { operationId: accepted.operationId }).result.bootstrapTip, final.result.bootstrapTip);
  const nodeOperation = await f.call('checks.run', { repo: repo.id, canonical: true, requestId: randomUUID() });
  await f.wait(nodeOperation.operationId);
  assert.equal(native('runs.get', { operationId: nodeOperation.operationId }).operationId, nodeOperation.operationId);
  const host = randomUUID(), journal = new Journal(f.state); journal.put('peer', host, {hostId:host, alias:'contribution-fixture.invalid', version:'0.1.0', observedAt:new Date().toISOString()}); journal.close();
  assert.equal(native('hosts.check', {host}).error, null);
  const nativeHost = native('hosts.list').result.hosts.find(peer => peer.hostId === host); assertContract('connectivity',nativeHost.connectivity);
  const cliHosts = f.cli(['hosts','list']); assert.equal(cliHosts.status,0,cliHosts.stderr); assertContract('connectivity',JSON.parse(cliHosts.stdout).result.hosts.find(peer=>peer.hostId===host).connectivity);
  assert.equal(native('service.status').error,null);
  const window = native('maintenance.begin', { requestId: randomUUID() }).result.window;
  for (let attempt = 0; attempt < 140 && !native('maintenance.status').result.ready; attempt++) await new Promise(resolve => setTimeout(resolve,100));
  assert.equal(native('maintenance.status').result.ready, true);
  assert.equal(native('service.resume').error.code, 'SERVICE_MAINTENANCE');
  assert.equal(native('maintenance.resume', { windowId: window.id, observedPayload: native('version').result.payload, outcome: 'cancelled' }).error, null);
  console.log('Swift native client and Node CLI/service share authenticated IPC, payload identity, admission and retained operation results.');
} finally { await f.cleanup(); }
