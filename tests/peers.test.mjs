import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { Journal } from '../packages/engine/dist/journal.js';
import { Engine } from '../packages/engine/dist/service.js';
import { Fault } from '../packages/engine/dist/core.js';
import { compatiblePeer } from '../packages/engine/dist/peers.js';
import { repository, commit, git } from './integration/service.mjs';

async function pairFixture() {
  const root = mkdtempSync(join(tmpdir(), 'ct-peers-')), hosts = {}, stores = [];
  let offline = false, loseActivation = false, loseReceipt = false;
  const transport = async (alias, envelope) => {
    if (offline) throw new Fault('PEER_UNAVAILABLE', 'Fixture peer disconnected.', 3);
    const result = await hosts[alias].dispatch({ schemaVersion: 1, command: 'peer.exchange', args: { envelope }, cwd: root });
    if ((loseActivation && envelope.action === 'authority.activate') || (loseReceipt && envelope.action === 'transfer.finish')) {
      loseActivation = false; loseReceipt = false; throw new Fault('PEER_UNAVAILABLE', 'Fixture reply lost after durable receipt.', 3);
    }
    if (result.error) throw new Fault(result.error.code, result.error.message, 3); return result.result;
  };
  const payload = { identity: 'fixture', distribution: 'fixture', root: root, node: process.execPath, cli: join(root, 'fixture-cli.js') };
  writeFileSync(payload.cli, 'process.exit(3);\n');
  for (const name of ['laptop', 'mini']) { const store = new Journal(join(root, name)); stores.push(store); hosts[name] = new Engine(store, payload, transport); }
  const call = (host, command, args = {}) => hosts[host].dispatch({ schemaVersion: 1, command, args, cwd: root });
  for (const [host, alias] of [['laptop', 'mini'], ['mini', 'laptop']]) assert.equal((await call(host, 'hosts.pair', { sshAlias: alias })).error, null);
  const source = repository(root, 'source'), target = repository(root, 'target');
  const config = (await call('laptop', 'repos.add', { path: source })).result.repository.config;
  const added = await call('mini', 'repos.add', { path: target, config }); assert.equal(added.error, null);
  const wait = async (host, operationId) => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const result = await call(host, 'runs.get', { operationId });
      if (!['queued', 'running', 'queued_local'].includes(result.operationState)) return result;
      await hosts.laptop.peers.tick(); await hosts.mini.peers.tick();
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    throw new Error('Fixture operation timed out: ' + JSON.stringify(await call(host, 'runs.get', { operationId })));
  };
  return { root, hosts, source, target, config, call, wait, offline: value => { offline = value; }, loseActivation: () => { loseActivation = true; }, loseReceipt: () => { loseReceipt = true; },
    cleanup: async () => { for (const host of Object.values(hosts)) host.stopping = true; while (Object.values(hosts).some(host => host.active.size || host.peers.busy)) await new Promise(resolve => setTimeout(resolve, 20)); for (const store of stores) store.close(); rmSync(root, { recursive: true }); } };
}

test('adjacent peer patch compatibility requires explicit stable protocol and request semantics', () => {
  assert.equal(compatiblePeer({ version: '0.1.1', protocolVersion: 1, requestSchemaVersion: 1 }), true);
  for (const version of ['0.1.2', '0.2.0', '1.0.0', '0.1.1-preview']) assert.equal(compatiblePeer({ version, protocolVersion: 1, requestSchemaVersion: 1 }), false);
  assert.equal(compatiblePeer({ version: '0.1.1' }), false);
  assert.equal(compatiblePeer({ version: '0.1.0', protocolVersion: 2, requestSchemaVersion: 1 }), false);
});

test('canonical checks run on the owner and an unreachable owner never substitutes a mirror check', async () => {
  const f = await pairFixture(); try {
    const repo = f.config.repositoryId;
    const bootstrap = await f.call('laptop', 'repos.initialize', { repo, requestId: randomUUID() }); await f.wait('laptop', bootstrap.operationId);
    assert.equal((await f.call('laptop', 'repos.pair', { repo, host: f.hosts.mini.store.hostId, requestId: randomUUID() })).error, null);
    const seed = await f.call('laptop', 'repos.seed', { repo, requestId: randomUUID() }); await f.wait('laptop', seed.operationId);
    f.offline(true);
    const unavailable = await f.call('laptop', 'checks.run', { repo, canonical: true, requestId: randomUUID() });
    assert.equal(unavailable.error.code, 'PEER_UNAVAILABLE'); assert.equal(unavailable.operationId, null);
    f.offline(false);
    const request = { repo, canonical: true, requestId: randomUUID() }, accepted = await f.call('laptop', 'checks.run', request);
    assert.equal(accepted.error, null); assert.equal(accepted.result.canonicalHostId, f.hosts.mini.store.hostId);
    const remote = f.hosts.mini.store.get(accepted.result.remoteOperationId); assert.equal(remote.input.sourcePath, realpathSync(f.target));
    assert.equal((await f.call('laptop', 'checks.run', request)).operationId, accepted.operationId);
    const result = await f.wait('laptop', accepted.operationId);
    assert.equal(result.operationState, 'waiting'); assert.equal(result.error.code, 'CHECKS_UNCONFIGURED');
    const log = await f.call('laptop', 'logs', { operationId: accepted.operationId });
    assert.equal(log.result.originHostId, f.hosts.mini.store.hostId); assert.equal(log.result.freshness, 'cached'); assert.match(log.result.text, /CHECKS_UNCONFIGURED/);
    await f.call('laptop', 'runs.cancel', { operationId: accepted.operationId });
    assert.equal((await f.wait('laptop', accepted.operationId)).operationState, 'cancelled');
    assert.equal(f.hosts.mini.store.get(remote.operationId).state, 'cancelled');
  } finally { await f.cleanup(); }
});

test('first history reaches an unborn owner; detached dirty task handoff survives lost receipt and lands once', async () => {
  const f = await pairFixture(); try {
    const bootstrap = await f.call('laptop', 'repos.initialize', { repo: f.config.repositoryId, requestId: randomUUID() });
    assert.equal((await f.wait('laptop', bootstrap.operationId)).operationState, 'succeeded');
    const base = git(f.source, 'rev-parse', 'HEAD'), miniId = f.hosts.mini.store.hostId;
    assert.equal((await f.call('laptop', 'repos.pair', { repo: f.config.repositoryId, host: miniId, requestId: randomUUID() })).error, null);
    const seed = await f.call('laptop', 'repos.seed', { repo: f.config.repositoryId, requestId: randomUUID() });
    assert.equal(seed.operationState, 'queued_local'); assert.equal(seed.result.acceptance.canonicalHostAccepted, false);
    assert.equal((await f.wait('laptop', seed.operationId)).operationState, 'succeeded'); assert.equal(git(f.target, 'rev-parse', 'HEAD'), base);
    const task = join(f.root, 'task'); git(f.source, 'worktree', 'add', '--detach', task, base); const tip = commit(task, 'task.txt', 'completed\n'); writeFileSync(join(task, 'unrelated.txt'), 'keep');
    f.loseReceipt();
    const request = { repo: f.config.repositoryId, sourcePath: task, sourceTip: tip, base, requestId: randomUUID() };
    const accepted = await f.call('laptop', 'submit', request);
    const result = await f.wait('laptop', accepted.operationId); assert.equal(result.operationState, 'succeeded', JSON.stringify(result));
    assert.equal(git(f.target, 'rev-list', '--count', `${base}..HEAD`), '1'); assert.match(git(task, 'status', '--porcelain'), /unrelated/);
    assert.equal((await f.call('laptop', 'submit', request)).operationId, accepted.operationId);
    assert.equal(f.hosts.mini.store.list().filter(op => op.kind === 'submit').length, 1);
    assert.equal((await f.call('laptop', 'push', { repo: f.config.repositoryId, preview: true })).error.code, 'DESTINATION_UNCONFIGURED');
    assert.equal((await f.call('laptop', 'hook.pre-push', { repo: f.config.repositoryId })).error.code, 'CANONICAL_OWNER_REQUIRED');
  } finally { await f.cleanup(); }
});

test('lost authority reply leaves the old writer fenced and retry resumes the same transition', async () => {
  const f = await pairFixture(); try {
    f.loseActivation(); const request = { repo: f.config.repositoryId, host: f.hosts.mini.store.hostId, requestId: randomUUID() };
    assert.equal((await f.call('laptop', 'repos.pair', request)).error.code, 'PEER_UNAVAILABLE');
    assert.throws(() => f.hosts.laptop.peers.assertWriter(f.hosts.laptop.repos.all()[0]), /fenced/);
    assert.doesNotThrow(() => f.hosts.mini.peers.assertWriter(f.hosts.mini.repos.all()[0]));
    assert.equal((await f.call('laptop', 'repos.pair', request)).error, null);
    assert.throws(() => f.hosts.laptop.peers.assertWriter(f.hosts.laptop.repos.all()[0]), /mirror/);
    f.offline(true);
    assert.equal((await f.call('laptop', 'repos.add', { path: f.source })).error.code, 'AUTHORITY_TRANSITION_REQUIRED');
  } finally { await f.cleanup(); }
});

test('pairing refuses unrelated histories before changing either writer', async () => {
  const f = await pairFixture(); try {
    commit(f.source, 'left', 'left'); commit(f.target, 'right', 'right');
    const result = await f.call('laptop', 'repos.pair', { repo: f.config.repositoryId, host: f.hosts.mini.store.hostId, requestId: randomUUID() });
    assert.equal(result.error.code, 'DIVERGENT_HISTORY');
    assert.equal(f.hosts.laptop.repos.all()[0].canonicalHostId, f.hosts.laptop.store.hostId);
    assert.equal(f.hosts.mini.repos.all()[0].canonicalHostId, f.hosts.mini.store.hostId);
  } finally { await f.cleanup(); }
});

test('canonical mirror preserves dirty and divergent work while retained bundles support multiple chunks', async () => {
  const f = await pairFixture(); try {
    // A large incompressible committed file exercises the bounded chunk protocol.
    commit(f.source, 'large.bin', randomBytes(600000));
    await f.call('laptop', 'repos.pair', { repo: f.config.repositoryId, host: f.hosts.mini.store.hostId, requestId: randomUUID() });
    const seed = await f.call('laptop', 'repos.seed', { repo: f.config.repositoryId, requestId: randomUUID() });
    assert.equal((await f.wait('laptop', seed.operationId)).operationState, 'succeeded');
    const original = git(f.source, 'rev-parse', 'HEAD'), updated = commit(f.target, 'new.txt', 'canonical');
    writeFileSync(join(f.source, 'private.txt'), 'unrelated');
    const dirty = await f.call('mini', 'repos.mirror', { repo: f.config.repositoryId, requestId: randomUUID() });
    assert.equal((await f.wait('mini', dirty.operationId)).operationState, 'failed');
    assert.equal(git(f.source, 'rev-parse', 'HEAD'), original);
    // Keep the user's unrelated file by committing it as distinct local history.
    git(f.source, '-c', 'core.hooksPath=/dev/null', 'add', 'private.txt'); git(f.source, '-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'Local independent work');
    const divergent = git(f.source, 'rev-parse', 'HEAD');
    const second = await f.call('mini', 'repos.mirror', { repo: f.config.repositoryId, requestId: randomUUID() });
    const result = await f.wait('mini', second.operationId);
    assert.equal(result.operationState, 'failed'); assert.equal(result.result.canonicalObservation.error.code, 'MIRROR_DIVERGED');
    assert.equal(git(f.source, 'rev-parse', 'HEAD'), divergent); assert.equal(git(f.target, 'rev-parse', 'HEAD'), updated);
  } finally { await f.cleanup(); }
});

test('replaying an old authority activation cannot undo a newer owner transition', async () => {
  const f = await pairFixture(); try {
    const repo = f.config.repositoryId;
    assert.equal((await f.call('laptop', 'repos.pair', { repo, host: f.hosts.mini.store.hostId, requestId: randomUUID() })).error, null);
    const old = { ...f.hosts.laptop.store.record('authority', repo), phase: 'frozen' };
    assert.equal((await f.call('mini', 'repos.pair', { repo, host: f.hosts.laptop.store.hostId, requestId: randomUUID() })).error, null);
    const replay = await f.call('mini', 'peer.exchange', { envelope: { fromHostId: f.hosts.laptop.store.hostId, expectedHostId: f.hosts.mini.store.hostId,
      action: 'authority.activate', body: { repositoryId: repo, transition: old } } });
    assert.equal(replay.error.code, 'STALE_AUTHORITY_TRANSITION');
    assert.doesNotThrow(() => f.hosts.laptop.peers.assertWriter(f.hosts.laptop.repos.all()[0]));
    assert.throws(() => f.hosts.mini.peers.assertWriter(f.hosts.mini.repos.all()[0]), /mirror/);
  } finally { await f.cleanup(); }
});
