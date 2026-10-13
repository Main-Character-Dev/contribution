import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { Journal } from '../packages/engine/dist/journal.js';
import { Repositories } from '../packages/engine/dist/repositories.js';
import { Peers } from '../packages/engine/dist/peers.js';
import { PeerSession } from '../packages/engine/dist/peer-session.js';
import { run } from '../packages/engine/dist/process.js';
import { processLifecycle, ownedProcess } from '../packages/engine/dist/resource-process.js';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Engine } from '../packages/engine/dist/service.js';
import { listen } from '../packages/engine/dist/ipc.js';

test('the real session helper forwards multiple bounded frames through authenticated IPC and rejects other actions', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ct-session-helper-')), home = join(root, 'home'), state = join(home, 'Library/Application Support/Contribution');
  const store = new Journal(state), engine = new Engine(store, { identity: 'fixture', node: process.execPath, cli: 'unused' }), server = await listen(engine);
  const helper = async input => {
    const child = spawn(process.execPath, [new URL('../packages/cli/dist/main.js', import.meta.url).pathname, 'peer', '--stdio-session'], { env: { ...process.env, HOME: home }, stdio: ['pipe','pipe','pipe'] });
    let stdout = '', stderr = ''; child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; }); child.stdin.end(input);
    const [code] = await once(child, 'exit'); return { code, stderr, frames: stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) };
  };
  try {
    const envelope = { fromHostId: randomUUID(), expectedHostId: store.hostId, action: 'transfer.chunk', body: { repositoryId: randomUUID() } };
    const repeated = await helper((JSON.stringify(envelope) + '\n').repeat(3)); assert.equal(repeated.code, 0, repeated.stderr); assert.equal(repeated.frames.length, 3); assert(repeated.frames.every(reply => reply.error.code === 'UNPAIRED_HOST'));
    const arbitrary = await helper(JSON.stringify({ ...envelope, action: 'hello' }) + '\n'); assert.equal(arbitrary.frames[0].error.code, 'INVALID_PEER_SESSION');
    const partial = await helper('{'); assert.equal(partial.frames[0].error.code, 'INVALID_PEER_SESSION');
    assert.equal(store.list().length, 0); assert.equal(store.records('resource').length, 0);
  } finally { engine.stopping = true; await new Promise(resolve => server.close(resolve)); store.close(); rmSync(root, { recursive: true }); }
});

test('negotiated four-chunk windows reuse a session; legacy peers retain the single-request transport', async () => {
  for (const negotiated of [true, false]) {
    const root = mkdtempSync(join(tmpdir(), 'ct-peer-window-')), store = new Journal(root);
    try {
      const host = randomUUID(), path = join(root, 'bundle'), data = Buffer.alloc(8 * 1024 ** 2, 7); writeFileSync(path, data);
      const compatibility = { hostId: host, version: '0.1.0', protocolVersion: 1, requestSchemaVersion: 1, capabilities: negotiated ? ['stdio-session-v1','health-v1'] : ['health-v1'] };
      store.put('peer', host, { hostId: host, alias: 'fixture', version: '0.1.0', capabilities: compatibility.capabilities });
      let opens = 0, closes = 0, singles = 0; const windows = [];
      const response = envelope => ({ ...compatibility, offset: envelope.action.endsWith('.chunk') ? envelope.body.offset + Buffer.from(envelope.body.data, 'base64').length : 0 });
      const transport = async (_, envelope) => { singles++; return response(envelope); };
      transport.openSession = () => { opens++; let closed = false; return { get closed() { return closed; }, requestMany: async envelopes => { windows.push(envelopes.length); await new Promise(resolve => setTimeout(resolve, 5)); return envelopes.map(response); }, close: async () => { if (!closed) closes++; closed = true; } }; };
      const peers = new Peers(store, new Repositories(store), 'fixture', transport);
      await peers.send(host, { repositoryId: randomUUID(), requestId: randomUUID(), transferId: randomUUID(), bytes: data.length, bundleDigest: createHash('sha256').update(data).digest('hex') }, path);
      if (negotiated) { assert.equal(opens, 1); assert.equal(closes, 1); assert.deepEqual(windows, [1,4,4,4,4,4,4,4,4,1]); assert.equal(singles, 0); }
      else { assert.equal(opens, 0); assert.equal(singles, 34); }
    } finally { store.close(); rmSync(root, { recursive: true }); }
  }
});

test('a live framed session retains one exact process owner and confirms release after multiple windows', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ct-session-owner-')), store = new Journal(root);
  try {
    const helper = join(root, 'helper.mjs'), core = new URL('../packages/engine/dist/core.js', import.meta.url).href;
    writeFileSync(helper, `import { createInterface } from 'node:readline'; import { completed } from ${JSON.stringify(core)}; for await (const line of createInterface({input:process.stdin})) { const value=JSON.parse(line); process.stdout.write(JSON.stringify(completed({hostId:value.expectedHostId,offset:value.body.offset,label:'🙂'}))+'\\n'); }`);
    const lifecycle = processLifecycle(store), owner = ownedProcess(lifecycle, null, [], 'process', 'session:fixture');
    const session = new PeerSession('fixture', owner, (command, argv, options) => { assert.equal(command, '/usr/bin/ssh'); assert.match(argv.at(-1), /peer --stdio-session$/); return run(process.execPath, [helper], options); });
    const envelopes = Array.from({ length: 4 }, (_, offset) => ({ expectedHostId: 'fixture', body: { offset } }));
    assert.deepEqual((await session.requestMany(envelopes)).map(row => row.offset), [0,1,2,3]);
    assert.equal(lifecycle.live().length, 1); assert.equal(lifecycle.live()[0].state, 'active');
    assert.equal((await session.requestMany([envelopes[0]]))[0].label, '🙂');
    assert.equal(session.drained, false);
    await session.close(); assert.deepEqual(lifecycle.live(), []); assert.equal(lifecycle.all().length, 1); assert.equal(lifecycle.all()[0].state, 'stopped');
    assert.equal(session.drained, true);
    await assert.rejects(session.requestMany(envelopes), { code: 'PEER_SESSION_BUSY' });
  } finally { store.close(); rmSync(root, { recursive: true }); }
});

test('control RPCs get a turn between transfer windows and closing sessions remain busy until drained', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ct-session-fair-')), store = new Journal(root);
  try {
    const host = randomUUID(), compatibility = { hostId: host, version: '0.1.0', protocolVersion: 1, requestSchemaVersion: 1, capabilities: ['stdio-session-v1','health-v1'] };
    store.put('peer', host, { hostId: host, alias: 'fixture', ...compatibility });
    const actions = []; let release; const gate = new Promise(resolve => { release = resolve; }); let first = true, drain;
    const transport = async (_, envelope) => { actions.push(envelope.action); return compatibility; };
    transport.openSession = () => { let closed = false, drained = false; return {
      get closed() { return closed; }, get drained() { return drained; },
      requestMany: async envelopes => { actions.push('window'); if (first) { first = false; await gate; } return envelopes.map(() => compatibility); },
      close: async () => { closed = true; if (drain) await drain; drained = true; }
    }; };
    const peers = new Peers(store, new Repositories(store), 'fixture', transport);
    const window = peers.callTransfer(host, 'transfer.chunk', [{}]);
    while (first) await new Promise(resolve => setImmediate(resolve));
    assert.equal(peers.busy, true);
    const control = peers.call(host, 'health', {}), next = peers.callTransfer(host, 'transfer.chunk', [{}]); release();
    await Promise.all([window, control, next]); assert.deepEqual(actions, ['window','health','window']);
    let drained; drain = new Promise(resolve => { drained = resolve; }); const closing = peers.closeTransfer(host);
    await new Promise(resolve => setImmediate(resolve)); assert.equal(peers.busy, true); drained(); await closing; assert.equal(peers.busy, false);
  } finally { store.close(); rmSync(root, { recursive: true }); }
});

test('malformed replies and cancellation release the exact session owner before reporting failure', async () => {
  for (const malformed of [true, false]) {
    const root = mkdtempSync(join(tmpdir(), 'ct-session-failure-')), store = new Journal(root);
    try {
      const helper = join(root, 'helper.mjs'); writeFileSync(helper, `process.stdin.on('data',()=>{${malformed ? "process.stdout.write('{}\\n');" : ''}});`);
      const lifecycle = processLifecycle(store), session = new PeerSession('fixture', ownedProcess(lifecycle, null, [], 'process', 'session:failure'), (_, __, options) => run(process.execPath, [helper], options));
      const controller = new AbortController(); if (!malformed) setTimeout(() => controller.abort(), 150);
      await assert.rejects(session.requestMany([{ body: {} }], controller.signal), error => malformed ? error.code === 'PEER_PROTOCOL_ERROR' : ['PROBE_CANCELLED','UNREACHABLE'].includes(error.code));
      assert.equal(session.drained, true); assert.deepEqual(lifecycle.live(), []); assert.equal(lifecycle.all()[0].state, 'stopped');
    } finally { store.close(); rmSync(root, { recursive: true }); }
  }
});
