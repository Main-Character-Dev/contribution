import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, realpathSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Journal } from '../packages/engine/dist/journal.js';
import { Engine } from '../packages/engine/dist/service.js';
import { RepositoryRemoval } from '../packages/engine/dist/repository-removal.js';
import { Repositories } from '../packages/engine/dist/repositories.js';
import { Peers } from '../packages/engine/dist/peers.js';
import { Fault } from '../packages/engine/dist/core.js';
import { Lease } from '../packages/engine/dist/process.js';
import { repository, commit, git } from './integration/service.mjs';

async function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ct-paired-removal-'))), hosts = {}, paths = {}, stores = [];
  let offline = false, loseRelease = false, beforeRelease, afterRelease, afterPrepare, losePrepare = false, dropActivation = false;
  const transport = async (alias, envelope) => {
    if (offline) throw new Fault('PEER_UNAVAILABLE', 'Fixture owner unavailable.', 3);
    if (dropActivation && envelope.action === 'authority.activate') { dropActivation = false; throw new Fault('PEER_UNAVAILABLE', 'Fixture activation was not delivered.', 3); }
    if (envelope.action === 'authority.release-mirror') await beforeRelease?.(envelope);
    const response = await hosts[alias].dispatch({ schemaVersion: 1, command: 'peer.exchange', args: { envelope }, cwd: root });
    if (envelope.action === 'authority.prepare' && !response.error) {
      await afterPrepare?.(envelope);
      if (losePrepare) { losePrepare = false; throw new Fault('PEER_UNAVAILABLE', 'Fixture reply lost after authority reservation.', 3); }
    }
    if (envelope.action === 'authority.release-mirror' && !response.error) {
      await afterRelease?.(envelope, response.result);
      if (loseRelease) { loseRelease = false; throw new Fault('PEER_UNAVAILABLE', 'Fixture reply lost after release.', 3); }
    }
    if (response.error) throw new Fault(response.error.code, response.error.message, 3); return response.result;
  };
  for (const name of ['laptop', 'mini']) {
    paths[name] = repository(root, `${name}-repo`);
    const store = new Journal(join(root, `${name}-state`)); stores.push(store);
    hosts[name] = new Engine(store, { identity: 'fixture', node: process.execPath, cli: '/fixture/cli' }, transport);
  }
  const tip = commit(paths.laptop); git(paths.mini, 'fetch', paths.laptop, 'dev'); git(paths.mini, 'checkout', '-B', 'dev', 'FETCH_HEAD');
  const call = (host, command, args = {}) => hosts[host].dispatch({ schemaVersion: 1, command, args, cwd: root });
  for (const [host, other] of [['laptop', 'mini'], ['mini', 'laptop']]) assert.equal((await call(host, 'hosts.pair', { sshAlias: other })).error, null);
  const config = (await call('laptop', 'repos.add', { path: paths.laptop })).result.repository.config, repo = config.repositoryId;
  assert.equal((await call('mini', 'repos.add', { path: paths.mini, config })).error, null);
  const transitionId = randomUUID(); assert.equal((await call('laptop', 'repos.pair', { repo, host: hosts.mini.store.hostId, requestId: transitionId })).error, null);
  return { root, hosts, paths, stores, call, config, repo, tip, transitionId, transport,
    hook: host => join(paths[host], '.git/hooks/pre-push'),
    offline: value => { offline = value; }, loseRelease: () => { loseRelease = true; },
    beforeRelease: fn => { beforeRelease = fn; }, afterRelease: fn => { afterRelease = fn; },
    afterPrepare: fn => { afterPrepare = fn; }, losePrepare: () => { losePrepare = true; },
    dropActivation: () => { dropActivation = true; },
    close: async () => { for (const engine of Object.values(hosts)) engine.stopping = true;
      while (Object.values(hosts).some(engine => engine.active.size || engine.peers.busy)) await new Promise(resolve => setTimeout(resolve, 20));
      for (const store of stores) store.close(); rmSync(root, { recursive: true }); }
  };
}

test('paired companion removal preserves dirty work and both histories while retaining canonical authority and release epochs', async () => {
  const f = await fixture(); try {
    const ownerHook = readFileSync(f.hook('mini')), sender = f.hosts.laptop.store, owner = f.hosts.mini.store;
    writeFileSync(join(f.paths.laptop, 'base.txt'), 'unstaged draft'); writeFileSync(join(f.paths.laptop, 'staged.txt'), 'staged draft'); git(f.paths.laptop, 'add', 'staged.txt');
    const before = git(f.paths.laptop, 'status', '--porcelain=v1'), index = git(f.paths.laptop, 'ls-files', '--stage');
    const response = await f.call('laptop', 'repos.remove', { repo: f.repo }); assert.equal(response.error, null, JSON.stringify(response));
    assert.equal(response.result.peerRelease.ownerHostId, owner.hostId); assert.equal(response.result.peerRelease.removedHostId, sender.hostId);
    assert.equal(f.hosts.laptop.repos.all().length, 0); assert(!existsSync(f.hook('laptop'))); assert.deepEqual(readFileSync(f.hook('mini')), ownerHook);
    assert.equal(git(f.paths.laptop, 'status', '--porcelain=v1'), before); assert.equal(git(f.paths.laptop, 'ls-files', '--stage'), index);
    for (const path of Object.values(f.paths)) assert.equal(git(path, 'rev-parse', 'HEAD'), f.tip);
    const active = await f.hosts.mini.repos.get(f.repo); assert.equal(active.availability, 'this-mac'); assert.equal(active.canonicalHostId, owner.hostId);
    f.hosts.mini.peers.assertWriter(active);
    assert.equal(sender.record('authority', f.repo).phase, 'released'); assert.equal(owner.record('authority', f.repo).phase, 'released');
    assert.deepEqual(sender.record('authorityRelease', response.result.removalId), owner.record('authorityRelease', response.result.removalId));
    assert.deepEqual((await f.call('laptop', 'repos.remove', { repo: f.repo })).result, response.result);
    assert.equal((await f.call('mini', 'repos.mirror', { repo: f.repo, requestId: randomUUID() })).error.code, 'AUTHORITY_TRANSITION_PENDING');
  } finally { await f.close(); }
});

test('offline owner and lost release reply preserve the local fence and resume the same removal after journal reopening', async () => {
  for (const mode of ['offline', 'lost-reply']) {
    const f = await fixture(); let reopened; try {
      if (mode === 'offline') f.offline(true); else f.loseRelease();
      const response = await f.call('laptop', 'repos.remove', { repo: f.repo }); assert.equal(response.error.code, 'PEER_UNAVAILABLE');
      assert.equal(response.result.requestRetained, true); assert.equal(response.error.nextActions[0].id, 'resume-removal');
      const intent = f.hosts.laptop.store.record('repositoryRemoval', f.repo); assert.equal(intent.state, 'prepared');
      assert(existsSync(f.hook('laptop'))); assert.equal(f.hosts.laptop.repos.all().length, 1);
      assert.throws(() => f.hosts.laptop.store.admit(randomUUID(), 'checks', f.repo, {}, 'fixture'), { code: 'REPOSITORY_REMOVAL_PENDING' });
      assert.equal(f.hosts.mini.store.record('authority', f.repo).phase, mode === 'offline' ? 'active' : 'released');
      f.offline(false); reopened = new Journal(f.hosts.laptop.store.directory);
      const repos = new Repositories(reopened), peers = new Peers(reopened, repos, 'fixture', f.transport);
      const result = await new RepositoryRemoval(reopened, repos, (repo, id) => peers.releaseMirror(repo, id)).remove(await repos.get(f.repo));
      assert.equal(result.removalId, intent.id); assert.equal(repos.all().length, 0); assert(!existsSync(f.hook('laptop')));
      assert.equal(f.hosts.mini.store.records('authorityRelease').length, 1);
    } finally { reopened?.close(); await f.close(); }
  }
});

test('changed hooks after remote release are preserved and new peer work cannot cross the retained removal', async () => {
  const f = await fixture(); try {
    const original = readFileSync(f.hook('laptop'));
    f.beforeRelease(async () => {
      const response = await f.call('laptop', 'checks.run', { repo: f.repo, requestId: randomUUID(), sourcePath: f.paths.laptop });
      assert.equal(response.error.code, 'REPOSITORY_REMOVAL_PENDING');
      await assert.rejects(f.hosts.mini.peers.call(f.hosts.laptop.store.hostId, 'transfer.begin', { repositoryId: f.repo, manifest: {} }), { code: 'REPOSITORY_REMOVAL_PENDING' });
    });
    f.afterRelease(() => writeFileSync(f.hook('laptop'), 'user replacement'));
    const refused = await f.call('laptop', 'repos.remove', { repo: f.repo }); assert.equal(refused.error.code, 'OWNED_HOOK_CHANGED');
    assert.equal(readFileSync(f.hook('laptop'), 'utf8'), 'user replacement'); assert.equal(f.hosts.mini.store.record('authority', f.repo).phase, 'released');
    f.afterRelease(undefined); writeFileSync(f.hook('laptop'), original);
    assert.equal((await f.call('laptop', 'repos.remove', { repo: f.repo })).error, null);
  } finally { await f.close(); }
});

test('reenrollment remains fenced until a newer explicit owner transition and historical release messages never undo it', async () => {
  const f = await fixture(); try {
    const priorAuthority = f.hosts.laptop.store.record('authority', f.repo);
    const removed = await f.call('laptop', 'repos.remove', { repo: f.repo }); assert.equal(removed.error, null);
    const release = removed.result.peerRelease;
    const reenrolled = await f.call('laptop', 'repos.add', { path: f.paths.laptop, config: f.config }); assert.equal(reenrolled.error, null);
    const mirror = await f.hosts.laptop.repos.get(f.repo); assert.equal(mirror.canonicalHostId, f.hosts.mini.store.hostId); assert.equal(mirror.availability, 'both-macs');
    assert.throws(() => f.hosts.laptop.peers.assertWriter(mirror), { code: 'AUTHORITY_TRANSITION_PENDING' });
    // An old activation after release must not revive the original writer.
    await assert.rejects(f.hosts.laptop.peers.call(f.hosts.mini.store.hostId, 'authority.activate', { repositoryId: f.repo, transition: { ...priorAuthority, phase: 'frozen' } }), { code: 'STALE_AUTHORITY_TRANSITION' });
    const transitionId = randomUUID(), paired = await f.call('mini', 'repos.pair', { repo: f.repo, host: f.hosts.laptop.store.hostId, requestId: transitionId });
    assert.equal(paired.error, null, JSON.stringify(paired));
    const current = f.hosts.mini.store.record('authority', f.repo); assert.equal(current.epoch, priorAuthority.epoch + 1);
    const historical = await f.hosts.laptop.peers.call(f.hosts.mini.store.hostId, 'authority.release-mirror', {
      repositoryId: f.repo, removalId: release.removalId, transitionId: release.transitionId, epoch: release.epoch, policy: release.policy });
    assert.deepEqual(historical.release, release); assert.deepEqual(f.hosts.mini.store.record('authority', f.repo), current);
    f.hosts.laptop.peers.assertWriter(await f.hosts.laptop.repos.get(f.repo));
  } finally { await f.close(); }
});

test('canonical removal, unrelated senders, stale scope and reused release identities cannot change authority', async () => {
  const f = await fixture(); try {
    assert.equal((await f.call('mini', 'repos.remove', { repo: f.repo })).error.code, 'AUTHORITY_RELEASE_REQUIRED');
    assert.equal(f.hosts.mini.store.record('repositoryRemoval', f.repo), undefined);
    const authority = f.hosts.mini.store.record('authority', f.repo), stranger = randomUUID();
    f.hosts.mini.store.put('peer', stranger, { hostId: stranger, alias: null, version: '0.1.0' });
    const body = { repositoryId: f.repo, removalId: randomUUID(), transitionId: authority.transitionId, epoch: authority.epoch, policy: f.hosts.mini.repos.all()[0].revision };
    await assert.rejects(f.hosts.mini.peers.receive({ fromHostId: stranger, expectedHostId: f.hosts.mini.store.hostId, compatibility: { version: '0.1.0' }, action: 'authority.release-mirror', body }), { code: 'AUTHORITY_RELEASE_REQUIRED' });
    await assert.rejects(f.hosts.laptop.peers.call(f.hosts.mini.store.hostId, 'authority.release-mirror', { ...body, epoch: authority.epoch + 1 }), { code: 'AUTHORITY_RELEASE_REQUIRED' });
    const removed = await f.call('laptop', 'repos.remove', { repo: f.repo }); assert.equal(removed.error, null);
    await assert.rejects(f.hosts.laptop.peers.call(f.hosts.mini.store.hostId, 'authority.release-mirror', { ...body, removalId: removed.result.removalId, policy: 'changed' }), { code: 'REQUEST_ID_CONFLICT' });
  } finally { await f.close(); }
});

test('unfinished operations, unacknowledged results, unadmitted captures, incoming bytes and writer leases protect either clone', async () => {
  for (const host of ['laptop', 'mini']) for (const kind of ['interrupted', 'acknowledgment', 'capture', 'history', 'incoming', 'writer']) {
    const f = await fixture(); let lease; try {
      const store = f.hosts[host].store;
      if (kind === 'interrupted' || kind === 'acknowledgment') {
        const op = store.admit(randomUUID(), 'checks', f.repo, {}, 'fixture');
        store.update(op, { state: kind === 'interrupted' ? 'interrupted' : 'succeeded', result: kind === 'acknowledgment' ? { remoteOperationId: randomUUID(), canonicalHostId: randomUUID() } : {} });
      } else if (kind === 'capture') store.put('captureIntent', randomUUID(), { repositoryId: f.repo });
      else if (kind === 'history') store.put('historyCaptureIntent', randomUUID(), { manifest: { repositoryId: f.repo } });
      else if (kind === 'incoming') store.put('transfer', randomUUID(), { manifest: { repositoryId: f.repo } });
      else lease = new Lease((await f.hosts[host].repos.get(f.repo)).commonDir, randomUUID());
      const response = await f.call('laptop', 'repos.remove', { repo: f.repo }); assert.ok(response.error, `${host}:${kind}`);
      assert.equal(f.hosts[host].store.record('authority', f.repo).phase, 'active'); assert(existsSync(f.hook('laptop')));
    } finally { lease?.release(); await f.close(); }
  }
});

test('owner transfer reservation and companion removal select an order before either owner is disabled', async () => {
  for (const winner of ['transfer', 'removal-before-release', 'removal-after-release']) {
    const f = await fixture(); try {
      const transfer = { repo: f.repo, host: f.hosts.laptop.store.hostId, requestId: randomUUID() };
      if (winner === 'transfer') {
        f.afterPrepare(async () => {
          const refused = await f.call('laptop', 'repos.remove', { repo: f.repo }); assert.equal(refused.error.code, 'AUTHORITY_TRANSITION_PENDING');
          assert.equal(f.hosts.laptop.store.record('repositoryRemoval', f.repo), undefined);
          assert.equal(f.hosts.mini.store.record('authority', f.repo).phase, 'active');
        });
        assert.equal((await f.call('mini', 'repos.pair', transfer)).error, null);
        f.hosts.laptop.peers.assertWriter(await f.hosts.laptop.repos.get(f.repo));
      } else {
        const compete = async () => {
          const refused = await f.call('mini', 'repos.pair', transfer); assert.equal(refused.error.code, 'REPOSITORY_REMOVAL_PENDING');
          const owner = await f.hosts.mini.repos.get(f.repo); f.hosts.mini.peers.assertWriter(owner);
          assert.notEqual(f.hosts.mini.store.record('authority', f.repo).phase, 'frozen');
        };
        if (winner === 'removal-before-release') f.beforeRelease(compete); else f.afterRelease(compete);
        assert.equal((await f.call('laptop', 'repos.remove', { repo: f.repo })).error, null);
        f.hosts.mini.peers.assertWriter(await f.hosts.mini.repos.get(f.repo));
      }
    } finally { await f.close(); }
  }
});

test('lost preparation reply retains the exact reservation across reopening without releasing another writer', async () => {
  const f = await fixture(); let recovered;
  try {
    f.losePrepare(); const request = { repo: f.repo, host: f.hosts.laptop.store.hostId, requestId: randomUUID() };
    assert.equal((await f.call('mini', 'repos.pair', request)).error.code, 'PEER_UNAVAILABLE');
    const reservation = f.hosts.laptop.store.record('authorityReservation', f.repo); assert.equal(reservation.transitionId, request.requestId);
    assert.equal(f.hosts.mini.store.record('authority', f.repo).phase, 'active');
    assert.equal((await f.call('laptop', 'repos.remove', { repo: f.repo })).error.code, 'AUTHORITY_TRANSITION_PENDING');
    recovered = new Journal(f.hosts.mini.store.directory); const repos = new Repositories(recovered), peers = new Peers(recovered, repos, 'fixture', f.transport);
    peers.prepareFence = repo => f.hosts.mini.workflows.ensureHook(repo);
    const result = await peers.bind(await repos.get(f.repo), request.host, request.requestId); assert.equal(result.transitionId, request.requestId);
    assert.equal(f.hosts.laptop.store.record('authorityReservation', f.repo), undefined);
    f.hosts.laptop.peers.assertWriter(await f.hosts.laptop.repos.get(f.repo));
  } finally { recovered?.close(); await f.close(); }
});

test('an older in-flight owner fence gains the new destination reservation without replacing its transition', async () => {
  const f = await fixture(); try {
    f.dropActivation(); const request = { repo: f.repo, host: f.hosts.laptop.store.hostId, requestId: randomUUID() };
    assert.equal((await f.call('mini', 'repos.pair', request)).error.code, 'PEER_UNAVAILABLE');
    const frozen = f.hosts.mini.store.record('authority', f.repo); assert.equal(frozen.phase, 'frozen');
    // Model the pre-reservation release's persisted journal boundary.
    f.hosts.laptop.store.db.prepare("DELETE FROM records WHERE namespace='authorityReservation' AND key=?").run(f.repo);
    assert.equal((await f.call('mini', 'repos.pair', request)).error, null);
    assert.deepEqual(f.hosts.mini.store.record('authority', f.repo), { ...frozen, phase: 'active' });
    assert.equal(git(f.paths.laptop, 'rev-parse', 'HEAD'), f.tip); assert.equal(git(f.paths.mini, 'rev-parse', 'HEAD'), f.tip);
  } finally { await f.close(); }
});
