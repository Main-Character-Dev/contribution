import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { mkdtempSync, writeFileSync, chmodSync, rmSync, realpathSync, renameSync, linkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PrivateBackendControl } from '../packages/engine/dist/backend-control.js';
const device = 'fixture-phone-001';
const tunnel = { address: 'fd12::1', rsdPort: 58783, udid: device, userspaceTun: true, userspaceTunPort: 54321 };
const mac = (key, role, challenge, nonce) => createHmac('sha256', key).update('contribution-backend-v1:' + role).update(challenge).update(nonce).digest();
async function fixture(options = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ct-backend-'))), key = randomBytes(32), sockets = new Set(), paths = [], nonces = [];
  writeFileSync(join(root, 'session.key'), key, { mode: 0o600 });
  const server = createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
    const challenge = randomBytes(32); let authenticated = false, bytes = Buffer.alloc(0);
    if (!options.silent) { socket.write(challenge.subarray(0, 7)); setImmediate(() => socket.write(challenge.subarray(7))); }
    socket.on('data', chunk => {
      bytes = Buffer.concat([bytes, chunk]);
      if (!authenticated) {
        if (bytes.length < 64) return;
        const nonce = bytes.subarray(0, 32), response = bytes.subarray(32, 64);
        if (!timingSafeEqual(response, mac(key, 'client', challenge, nonce))) return socket.destroy();
        nonces.push(nonce.toString('hex')); authenticated = true; bytes = bytes.subarray(64);
        if (options.authClose) return socket.end();
        socket.write(options.forged ? Buffer.alloc(32, 1) : mac(key, 'server', challenge, nonce));
      }
      if (!bytes.includes(Buffer.from('\r\n\r\n'))) return;
      const header = bytes.toString('utf8'), path = header.split(' ')[1]; paths.push(path);
      assert(header.startsWith('GET ')); assert.equal(header.includes(key.toString('hex')), false);
      options.onRequest?.(path, root);
      let status = 200, body = '';
      if (path === '/ready' && options.notReady) status = 503;
      if (path.startsWith('/tunnel/')) { status = options.status ?? 200; body = JSON.stringify(options.tunnel ?? tunnel); }
      if (options.body) body = options.body;
      if (options.truncated) return socket.end('HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\nshort');
      if (options.chunked && path.startsWith('/tunnel/')) return socket.end(`HTTP/1.1 ${status} OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n${Buffer.byteLength(body).toString(16)}\r\n${body}\r\n0\r\n\r\n`);
      socket.end(`HTTP/1.1 ${status} OK\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(join(root, 'control.sock'), resolve); }); chmodSync(join(root, 'control.sock'), 0o600);
  return { root, paths, nonces, client: new PrivateBackendControl(root, device), cleanup: async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); rmSync(root, { recursive: true }); } };
}

test('private backend reads authenticate each fixed selected-device endpoint without discovery or mutation', async () => {
  for (const chunked of [false, true]) {
    const f = await fixture({ chunked }); try {
      assert.deepEqual(await f.client.observe(), { controlAuthenticated: true, ready: true, tunnel, scope: 'selected_private_backend_only' });
      assert.deepEqual(f.paths, ['/health', '/ready', '/tunnel/' + device]); assert.equal(new Set(f.nonces).size, 3);
    } finally { await f.cleanup(); }
  }
});
test('private backend readiness and selected absence are distinct from physical trust or global session absence', async () => {
  for (const options of [{ notReady: true }, { status: 404 }]) {
    const f = await fixture(options); try {
      const result = await f.client.observe(); assert.equal(result.ready, !options.notReady); assert.equal(result.tunnel, null);
      assert.equal(result.scope, 'selected_private_backend_only'); assert.equal('externalSession' in result, false);
      assert.equal(f.paths.length, options.notReady ? 2 : 3);
    } finally { await f.cleanup(); }
  }
});
test('forged backend authentication, truncated output and excessive bodies cannot produce a successful observation', async () => {
  for (const [options, expected] of [[{ forged: true }, 'BACKEND_AUTHENTICATION_FAILED'], [{ authClose: true }, 'BACKEND_CONNECTION_LOST'], [{ truncated: true }, 'BACKEND_CONTROL_UNAVAILABLE'], [{ body: 'x'.repeat(65537) }, 'BACKEND_RESPONSE_TOO_LARGE']]) {
    const f = await fixture(options); try {
      await assert.rejects(f.client.observe(), { code: expected });
      if (options.forged || options.authClose) assert.deepEqual(f.paths, []);
    } finally { await f.cleanup(); }
  }
});
test('private tunnel responses reject wrong device, kernel transport, invalid endpoints and server errors', async () => {
  for (const options of [{ tunnel: { ...tunnel, udid: 'different-phone' } }, { tunnel: { ...tunnel, userspaceTun: false } }, { tunnel: { ...tunnel, userspaceTunPort: 0 } }, { tunnel: { ...tunnel, address: '127.0.0.1' } }, { tunnel: { ...tunnel, extra: true } }, { status: 500 }, { status: 302 }]) {
    const f = await fixture(options); try { await assert.rejects(f.client.observe(), { code: options.status ? 'BACKEND_TUNNEL_UNCONFIRMED' : 'BACKEND_RESPONSE_INVALID' }); }
    finally { await f.cleanup(); }
  }
});
test('session key replacement, shared credentials, changed permissions and cancellation preserve session boundaries', async () => {
  for (const change of ['replace', 'link', 'permissions', 'cancel']) {
    const f = await fixture({ silent: change === 'cancel' }); try {
      const path = join(f.root, 'session.key');
      if (change === 'replace') { renameSync(path, path + '-old'); writeFileSync(path, randomBytes(32), { mode: 0o600 }); }
      if (change === 'link') linkSync(path, path + '-shared');
      if (change === 'permissions') chmodSync(path, 0o644);
      const controller = new AbortController(); if (change === 'cancel') setTimeout(() => controller.abort(), 20);
      await assert.rejects(f.client.observe(controller.signal), { code: change === 'replace' ? 'BACKEND_SESSION_CHANGED' : change === 'cancel' ? 'CANCELLED' : 'BACKEND_CONTROL_INVALID' });
      assert.deepEqual(f.paths, []);
    } finally { await f.cleanup(); }
  }
  const f = await fixture({ onRequest: (path, root) => { if (path === '/health') { renameSync(join(root, 'session.key'), join(root, 'old.key')); writeFileSync(join(root, 'session.key'), randomBytes(32), { mode: 0o600 }); } } });
  try { await assert.rejects(f.client.observe(), { code: 'BACKEND_SESSION_CHANGED' }); assert.deepEqual(f.paths, ['/health']); }
  finally { await f.cleanup(); }
});

test('a silent private backend has one finite authentication deadline and is never retried', async () => {
  const f = await fixture({ silent: true }), started = Date.now();
  try {
    await assert.rejects(f.client.observe(), { code: 'BACKEND_TIMEOUT' });
    assert(Date.now() - started >= 2800); assert(Date.now() - started < 10000); assert.deepEqual(f.paths, []); assert.deepEqual(f.nonces, []);
    const controller = new AbortController(); controller.abort(); await assert.rejects(f.client.observe(controller.signal), { code: 'CANCELLED' });
  } finally { await f.cleanup(); }
});

test('recovered control clients preserve the original endpoint identity across key replacement', async () => {
  const f = await fixture();
  try {
    const identity = f.client.identity, recovered = new PrivateBackendControl(f.root, device, identity);
    assert.equal((await recovered.observe()).controlAuthenticated, true);
    const key = join(f.root, 'session.key'); renameSync(key, key + '-old');
    writeFileSync(key, randomBytes(32), { mode: 0o600 });
    assert.throws(() => new PrivateBackendControl(f.root, device, identity), { code: 'BACKEND_SESSION_CHANGED' });
    assert.equal(f.paths.length, 3);
  } finally { await f.cleanup(); }
});
