import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Journal } from '../packages/engine/dist/journal.js';
import { Engine } from '../packages/engine/dist/service.js';
import { Fault, digest } from '../packages/engine/dist/core.js';
import { repository, commit } from './integration/service.mjs';

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ct-project-registry-')), hosts = {}, stores = [];
  let offline = false, loseReply = false; const exchanges = [];
  const transport = async (alias, envelope) => {
    if (offline) throw new Fault('PEER_UNAVAILABLE', 'Fixture offline', 3);
    if (envelope.action === 'registry.exchange') exchanges.push(structuredClone(envelope));
    const response = await hosts[alias].dispatch({ schemaVersion: 1, command: 'peer.exchange', args: { envelope }, cwd: root });
    if (response.error) throw new Fault(response.error.code, response.error.message, 3);
    if (loseReply && envelope.action === 'registry.exchange') { loseReply = false; throw new Fault('PEER_UNAVAILABLE', 'Fixture lost reply', 3); }
    return response.result;
  };
  for (const name of ['laptop', 'mini']) { const store = new Journal(join(root, name)); stores.push(store); hosts[name] = new Engine(store, { identity: 'fixture' }, transport); }
  const call = (host, command, args = {}) => hosts[host].dispatch({ schemaVersion: 1, command, args, cwd: root });
  const source = repository(root, 'source'); commit(source);
  const repo = (await call('laptop', 'repos.add', { path: source })).result.repository;
  assert.equal((await call('laptop', 'hosts.pair', { sshAlias: 'mini' })).error, null);
  return { root, hosts, stores, call, source, repo, exchanges, offline: value => { offline = value; }, loseReply: () => { loseReply = true; },
    cleanup: async () => { for (const host of Object.values(hosts)) host.stopping = true; while (Object.values(hosts).some(host => host.active.size || host.peers.busy)) await new Promise(resolve => setTimeout(resolve, 10)); for (const store of stores) store.close(); rmSync(root, { recursive: true }); } };
}

test('paired discovery shows an absent project without sharing paths or granting enrollment and authority', async () => {
  const f = await fixture(); try {
    const projects = (await f.call('mini', 'repos.list')).result;
    assert.equal(projects.repositories.length, 0); assert.equal(projects.peerProjects.length, 1);
    assert.equal(projects.peerProjects[0].state, 'checkout_required'); assert.equal(projects.peerProjects[0].repositoryId, f.repo.id);
    assert.equal(projects.peerProjects[0].authority, 'reported_only'); assert.equal(projects.peerProjects[0].setupPerformed, false);
    assert.equal(JSON.stringify(f.exchanges).includes(f.source), false);
    assert.equal(JSON.stringify(f.exchanges).includes('publication'), false);
    assert.equal(f.hosts.mini.store.record('authority', f.repo.id), undefined);
    const unpaired = randomUUID(), catalog = f.hosts.laptop.peers.registry.local();
    assert.throws(() => f.hosts.mini.peers.registry.receive(unpaired, catalog), error => error.code === 'UNPAIRED_HOST');
  } finally { await f.cleanup(); }
});

test('offline metadata and uncertain delivery keep a durable generation and retry idempotently', async () => {
  const f = await fixture(); try {
    const local = f.hosts.laptop, remote = f.hosts.mini, host = remote.store.hostId;
    const second = repository(f.root, 'second'); await local.repos.add(second); f.offline(true);
    let response = await f.call('laptop', 'hosts.sync', { host }); assert.equal(response.result.registry.state, 'pending');
    const catalog = local.peers.registry.local(), generation = catalog.generation;
    assert.equal(remote.peers.registry.view().length, 1); assert.equal(local.store.getMeta('projectRegistryCatalog').generation, generation);
    f.offline(false); await f.call('laptop','hosts.retry',{host}); await local.peers.settledChecks(); f.loseReply(); response = await f.call('laptop', 'hosts.sync', { host });
    assert.equal(response.result.registry.state, 'pending'); assert.equal(remote.peers.registry.view().length, 2);
    await new Promise(resolve=>setTimeout(resolve,2000)); await f.call('laptop','hosts.retry',{host}); await local.peers.settledChecks();
    response = await f.call('laptop', 'hosts.sync', { host }); assert.equal(response.result.registry.state, 'acknowledged');
    assert.equal(response.result.registry.generation, generation); assert.equal(remote.peers.registry.view().length, 2);
    assert.equal(remote.repos.all().length, 0);
  } finally { await f.cleanup(); }
});

test('explicit local mapping checks logical identity and revision before enrollment and preserves conflicts', async () => {
  const f = await fixture(); try {
    const destination = repository(f.root, 'clone'), args = { repo: f.repo.id, host: f.hosts.laptop.store.hostId, path: destination, expectedRevision: f.repo.revision };
    assert.equal((await f.call('mini', 'repos.resolve', args)).error.code, 'REGISTRY_MAPPING_CONFLICT');
    assert.equal(f.hosts.mini.repos.all().length, 0);
    writeFileSync(join(destination, 'contribution.json'), JSON.stringify(f.repo.config, null, 2) + '\n');
    const result = await f.call('mini', 'repos.resolve', args); assert.equal(result.error, null, JSON.stringify(result));
    assert.equal(result.result.repository.id, f.repo.id); assert.equal(result.result.peerProjects[0].state, 'mapped');
    assert.equal(result.result.authorityChanged, false); assert.equal(f.hosts.mini.store.record('authority', f.repo.id), undefined);
    const old = f.hosts.mini.repos.all()[0], config = structuredClone(f.repo.config); config.name = 'Reviewed new name';
    f.hosts.laptop.repos.configure(f.repo, config, f.repo.revision, randomUUID());
    await f.call('laptop', 'hosts.sync', { host: f.hosts.mini.store.hostId });
    const projects = (await f.call('mini', 'repos.list')).result;
    assert.equal(projects.peerProjects[0].state, 'configuration_conflict'); assert.deepEqual(f.hosts.mini.repos.all()[0], old);
    assert.equal((await f.call('mini', 'repos.resolve', args)).error.code, 'REGISTRY_SELECTION_CHANGED');
  } finally { await f.cleanup(); }
});

test('catalog rollback, same-generation mutation, extra fields and duplicate identities are rejected', async () => {
  const f = await fixture(); try {
    const registry = f.hosts.mini.peers.registry, host = f.hosts.laptop.store.hostId, original = f.hosts.laptop.peers.registry.local();
    for (const variant of ['same', 'extra', 'duplicate']) {
      const value = structuredClone(original);
      if (variant === 'same') value.projects[0].name = 'Rewritten generation';
      if (variant === 'extra') value.projects[0].path = '/private/path';
      if (variant === 'duplicate') value.projects.push(value.projects[0]);
      value.digest = digest(value.projects);
      assert.throws(() => registry.receive(host, value), error => ['REGISTRY_CONFLICT', 'REGISTRY_INVALID'].includes(error.code));
    }
    const later = { ...original, generation: original.generation + 1, projects: [], digest: digest([]) }; registry.receive(host, later);
    assert.throws(() => registry.receive(host, original), error => error.code === 'REGISTRY_STALE');
    const view = registry.view(); assert.equal(view[0].state, 'removed_on_peer'); assert.equal(view[0].repositoryId, f.repo.id);
    assert.equal(f.hosts.laptop.repos.all().length, 1);
  } finally { await f.cleanup(); }
});

test('a restarted receiving journal retains project setup observations without enrolling a checkout', async () => {
  const f = await fixture(); try {
    const original = (await f.call('mini', 'repos.list')).result.peerProjects;
    const hostId = f.hosts.mini.store.hostId; f.hosts.mini.stopping = true; f.hosts.mini.store.close();
    const store = new Journal(join(f.root, 'mini')); f.stores[1] = store; f.hosts.mini = new Engine(store, { identity: 'fixture' });
    assert.equal(store.hostId, hostId); assert.deepEqual((await f.call('mini', 'repos.list')).result.peerProjects, original);
    assert.equal(f.hosts.mini.repos.all().length, 0); assert.equal(f.hosts.mini.store.record('authority', f.repo.id), undefined);
    const catalog = f.hosts.laptop.peers.registry.local();
    f.hosts.mini.peers.registry.receive(f.hosts.laptop.store.hostId, catalog);
    assert.equal(f.hosts.mini.peers.registry.view().length, 1);
  } finally { await f.cleanup(); }
});
