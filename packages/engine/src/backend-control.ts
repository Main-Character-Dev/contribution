import { createConnection, isIP } from 'node:net';
import type { Socket } from 'node:net';
import { Agent, request } from 'node:http';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { readStableFile } from './bounded-file.js';
import { digest, Fault, requireValue } from './core.js';

export interface PrivateTunnel { address: string; rsdPort: number; udid: string; userspaceTun: true; userspaceTunPort: number }
export interface PrivateBackendObservation { controlAuthenticated: true; ready: boolean; tunnel: PrivateTunnel | null; scope: 'selected_private_backend_only' }
const code = 'BACKEND_CONTROL_INVALID';
function fault(code: string, message: string): Fault { return new Fault(code, message, 3); }
function snapshot(directory: string): { identity: string; key: Buffer; socket: string } {
  requireValue(isAbsolute(directory) && resolve(directory) === directory && realpathSync(directory) === directory, code, 'Use the exact canonical private backend directory.', 3);
  const state = lstatSync(directory, { bigint: true }), socket = join(directory, 'control.sock'), path = join(directory, 'session.key');
  const endpoint = lstatSync(socket, { bigint: true }), credential = lstatSync(path, { bigint: true }), uid = BigInt(process.getuid?.() ?? -1);
  requireValue(state.isDirectory() && state.uid === uid && (state.mode & 0o777n) === 0o700n && endpoint.isSocket() && endpoint.uid === uid && (endpoint.mode & 0o777n) === 0o600n &&
    credential.isFile() && !credential.isSymbolicLink() && credential.uid === uid && credential.nlink === 1n && (credential.mode & 0o777n) === 0o600n && credential.size === 32n,
    code, 'Private backend directory, socket or session key ownership changed.', 3);
  const key = readStableFile(path, 32, code); requireValue(key.length === 32 && !key.equals(Buffer.alloc(32)), code, 'A nonzero private backend session key is required.', 3);
  const seal = (info: typeof state): string[] => [info.dev, info.ino, info.mode, info.uid, info.nlink, info.mtimeNs, info.ctimeNs].map(String);
  // Directory timestamps legitimately change as the owned backend creates its
  // pairing state. Inode identity and permissions still bind the directory.
  return { key, socket, identity: digest({ state: seal(state).slice(0, 4), socket: seal(endpoint), key: seal(credential), digest: digest(key) }) };
}
function mac(key: Buffer, role: string, challenge: Buffer, nonce: Buffer): Buffer {
  return createHmac('sha256', key).update('contribution-backend-v1:' + role).update(challenge).update(nonce).digest();
}
function exact(socket: Socket, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => { socket.off('readable', read); socket.off('error', fail); socket.off('end', end); socket.off('close', end); };
    const fail = (error: Error): void => { cleanup(); reject(error); };
    const end = (): void => fail(fault('BACKEND_CONNECTION_LOST', 'Private backend authentication ended before completion.'));
    const read = (): void => {
      const bytes = socket.read(length) as Buffer | null;
      if (bytes) { cleanup(); resolve(bytes); }
      else if (socket.destroyed || socket.readableEnded) end();
    };
    socket.on('readable', read); socket.once('error', fail); socket.once('end', end); socket.once('close', end); read();
  });
}
/** Internal read-only client: exact Unix endpoint, mutual authentication before
 * HTTP, one request per connection, no discovery, fallback, redirects or retry.
 * A private tunnel observation never establishes phone trust or global absence. */
export class PrivateBackendControl {
  private readonly bound: string;
  constructor(readonly directory: string, readonly device: string) {
    requireValue(/^[A-Za-z0-9-]{8,128}$/.test(device), code, 'Select one exact backend device identity.', 3);
    this.bound = snapshot(directory).identity;
  }
  private verify(): ReturnType<typeof snapshot> {
    const current = snapshot(this.directory);
    requireValue(current.identity === this.bound, 'BACKEND_SESSION_CHANGED', 'The selected backend session changed. Reconcile it before opening another connection.', 3); return current;
  }
  private async get(path: '/health' | '/ready' | `/tunnel/${string}`, signal?: AbortSignal): Promise<{ status: number; bytes: Buffer }> {
    requireValue(!signal?.aborted, 'CANCELLED', 'Backend observation was cancelled before connection.', 130);
    const selected = this.verify(), socket = createConnection({ path: selected.socket });
    // Keep a listener until cleanup so late transport errors never escape the
    // owning request after its authentication/read promise has settled.
    const ignore = (): void => {}; socket.on('error', ignore);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const abort = (): void => { socket.destroy(fault('CANCELLED', 'Backend observation was cancelled.')); };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    try {
      timer = setTimeout(() => socket.destroy(fault('BACKEND_TIMEOUT', 'Private backend authentication exceeded three seconds.')), 3000);
      const challenge = await exact(socket, 32), nonce = randomBytes(32);
      this.verify(); socket.write(Buffer.concat([nonce, mac(selected.key, 'client', challenge, nonce)]));
      const reply = await exact(socket, 32);
      requireValue(timingSafeEqual(reply, mac(selected.key, 'server', challenge, nonce)), 'BACKEND_AUTHENTICATION_FAILED', 'The private backend did not authenticate its session.', 3);
      this.verify(); clearTimeout(timer);
      timer = setTimeout(() => socket.destroy(fault('BACKEND_TIMEOUT', 'The bounded private backend observation exceeded ten seconds.')), 10000);
      const agent = new Agent({ keepAlive: false, maxSockets: 1 });
      // This authenticated socket is the only transport. Node cannot resolve
      // the placeholder host or select another network endpoint.
      agent.createConnection = () => socket;
      try {
        const result = await new Promise<{ status: number; bytes: Buffer }>((resolve, reject) => {
          const req = request({ method: 'GET', host: 'contribution-backend', path, agent, maxHeaderSize: 16 * 1024, headers: { Connection: 'close', Accept: 'application/json' } }, res => {
            const chunks: Buffer[] = []; let bytes = 0;
            res.on('data', (chunk: Buffer) => {
              bytes += chunk.length;
              if (bytes > 64 * 1024) { const error = fault('BACKEND_RESPONSE_TOO_LARGE', 'The private backend response exceeds 64 KiB.'); res.destroy(error); req.destroy(error); }
              else chunks.push(chunk);
            });
            res.once('error', reject);
            res.once('end', () => {
              if (!res.complete) reject(fault('BACKEND_CONNECTION_LOST', 'The private backend response was truncated.'));
              else resolve({ status: res.statusCode ?? 0, bytes: Buffer.concat(chunks) });
            });
          });
          req.once('error', reject); req.end();
        });
        this.verify(); return result;
      } finally { agent.destroy(); }
    } catch (error) {
      if (error instanceof Fault) throw error;
      throw fault('BACKEND_CONTROL_UNAVAILABLE', 'The exact private backend connection failed or returned an invalid response. No alternative route was attempted.');
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); socket.destroy(); }
  }
  async observe(signal?: AbortSignal): Promise<PrivateBackendObservation> {
    const health = await this.get('/health', signal);
    requireValue(health.status === 200 && health.bytes.length === 0, 'BACKEND_HEALTH_UNCONFIRMED', 'The authenticated private backend did not confirm its control health.', 3);
    const ready = await this.get('/ready', signal);
    requireValue([200, 503].includes(ready.status) && ready.bytes.length === 0, 'BACKEND_READY_UNCONFIRMED', 'The private backend returned an incompatible readiness result.', 3);
    if (ready.status === 503) return { controlAuthenticated: true, ready: false, tunnel: null, scope: 'selected_private_backend_only' };
    const response = await this.get(`/tunnel/${this.device}`, signal);
    if (response.status === 404) return { controlAuthenticated: true, ready: true, tunnel: null, scope: 'selected_private_backend_only' };
    requireValue(response.status === 200, 'BACKEND_TUNNEL_UNCONFIRMED', 'The private backend could not confirm the selected tunnel.', 3);
    let value: unknown;
    try { value = JSON.parse(response.bytes.toString('utf8')); } catch { throw fault('BACKEND_RESPONSE_INVALID', 'The selected private tunnel response is not valid JSON.'); }
    requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), 'BACKEND_RESPONSE_INVALID', 'The selected tunnel response is not an object.', 3);
    const tunnel = value as PrivateTunnel;
    requireValue(Object.keys(tunnel).sort().join() === ['address', 'rsdPort', 'udid', 'userspaceTun', 'userspaceTunPort'].sort().join() &&
      typeof tunnel.address === 'string' && isIP(tunnel.address) === 6 && tunnel.udid === this.device && tunnel.userspaceTun === true &&
      [tunnel.rsdPort, tunnel.userspaceTunPort].every(port => Number.isInteger(port) && port > 0 && port <= 65535),
      'BACKEND_RESPONSE_INVALID', 'The private response changed device identity, transport kind or bounded tunnel endpoints.', 3);
    return { controlAuthenticated: true, ready: true, tunnel, scope: 'selected_private_backend_only' };
  }
}
