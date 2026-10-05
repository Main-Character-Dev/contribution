import { createServer, createConnection } from 'node:net';
import type { Server } from 'node:net';
import { chmodSync, existsSync, lstatSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { timingSafeEqual, randomBytes } from 'node:crypto';
import type { Response } from '@contribution/contracts';
import { assertContract } from '@contribution/contracts';
import { Fault, digest, object, rejected, requireValue } from './core.js';
import { privateDirectory } from './private-files.js';
import { alive, processIdentity } from './process.js';
import type { Engine, Request } from './service.js';

export const defaultStateDirectory = (): string => join(homedir(), 'Library', 'Application Support', 'Contribution');
export const socketPath = (directory: string): string => join(tmpdir(), `ct-${process.getuid?.()}-${digest(directory).slice(0, 12)}`, 'service.sock');
const MAX_FRAME = 1024 * 1024;
function credential(directory: string): string {
  const path = join(directory, 'client.token'), stat = lstatSync(path);
  requireValue(stat.isFile() && !stat.isSymbolicLink() && stat.uid === process.getuid?.() && (stat.mode & 0o077) === 0, 'UNSAFE_CREDENTIAL', 'Local service credential ownership or permissions changed.', 3);
  return readFileSync(path, 'utf8').trim();
}
export class ServiceLock {
  readonly directory: string;
  readonly start: string;
  constructor(state: string) {
    privateDirectory(state); this.directory = join(state, 'service.lock');
    const start = processIdentity(process.pid); requireValue(start, 'PROCESS_IDENTITY_UNAVAILABLE', 'Cannot establish the service process identity.', 3); this.start = start;
    if (existsSync(this.directory)) {
      let previous: { pid: number; start: string };
      try { previous = JSON.parse(readFileSync(join(this.directory, 'owner.json'), 'utf8')) as typeof previous; }
      catch { throw new Fault('SERVICE_LOCK_UNCONFIRMED', 'The prior service lock has no verifiable owner. Preserve it for explicit repair.', 3); }
      requireValue(!alive(previous.pid) || (processIdentity(previous.pid) !== null && processIdentity(previous.pid) !== previous.start), 'SERVICE_ALREADY_RUNNING', 'One service already owns this state directory.', 3);
      unlinkSync(join(this.directory, 'owner.json')); rmdirSync(this.directory);
    }
    mkdirSync(this.directory, { mode: 0o700 }); writeFileSync(join(this.directory, 'owner.json'), JSON.stringify({ pid: process.pid, start }), { flag: 'wx', mode: 0o600 });
  }
  release(): void {
    const owner = JSON.parse(readFileSync(join(this.directory, 'owner.json'), 'utf8')) as { pid: number; start: string };
    if (owner.pid === process.pid && owner.start === this.start) { unlinkSync(join(this.directory, 'owner.json')); rmdirSync(this.directory); }
  }
}
export async function listen(engine: Engine): Promise<Server> {
  const state = engine.store.directory, path = socketPath(state), directory = join(path, '..'); privateDirectory(directory);
  if (existsSync(path)) { requireValue(lstatSync(path).isSocket() && lstatSync(path).uid === process.getuid?.(), 'UNSAFE_SOCKET', 'Refusing to replace a non-owned socket.', 3); unlinkSync(path); }
  const token = randomBytes(32).toString('hex'); writeFileSync(join(state, 'client.token'), token + '\n', { mode: 0o600 }); chmodSync(join(state, 'client.token'), 0o600);
  writeFileSync(join(state, 'endpoint.json'), JSON.stringify({ schemaVersion: 1, socket: path, hostId: engine.store.hostId, payload: engine.payload.identity }), { mode: 0o600 });
  const server = createServer(socket => {
    let data = Buffer.alloc(0), handled = false;
    socket.setTimeout(5000, () => { if (!handled) socket.destroy(); });
    socket.on('error', () => { /* observers disconnect without cancelling accepted jobs */ });
    socket.on('data', (chunk: Buffer) => {
      if (handled) { socket.destroy(); return; }
      data = Buffer.concat([data, chunk]);
      if (data.length > MAX_FRAME) { socket.end(JSON.stringify(rejected(new Fault('FRAME_TOO_LARGE', 'IPC request exceeds one MiB.', 2))) + '\n'); handled = true; return; }
      const newline = data.indexOf(10); if (newline < 0) return;
      handled = true; socket.setTimeout(0);
      void (async () => {
        try {
          requireValue(newline === data.length - 1, 'INVALID_FRAME', 'One request per connection is required.', 2);
          const frame = object(JSON.parse(data.subarray(0, newline).toString('utf8')));
          const supplied = typeof frame['token'] === 'string' ? Buffer.from(frame['token']) : Buffer.alloc(0), expected = Buffer.from(token);
          requireValue(supplied.length === expected.length && timingSafeEqual(supplied, expected), 'AUTHORIZATION_DENIED', 'Local IPC authentication failed.', 3);
          requireValue(Object.keys(frame).every(key => ['token', 'request'].includes(key)), 'INVALID_FRAME', 'Unexpected frame fields.', 2);
          const response = await engine.dispatch(frame['request']); assertContract('response', response);
          socket.end(JSON.stringify(response) + '\n');
        } catch (error) { socket.end(JSON.stringify(rejected(error)) + '\n'); }
      })();
    });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(path, () => { chmodSync(path, 0o600); resolve(); }); });
  return server;
}
export async function request(directory: string, body: Request, timeoutMs = 15000): Promise<Response> {
  let token: string;
  try { token = credential(directory); } catch { throw new Fault('SERVICE_NOT_INSTALLED', 'The Contribution user service is unavailable. Open the installed app to inspect registration.', 3); }
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath(directory)); let data = Buffer.alloc(0);
    const timer = setTimeout(() => { socket.destroy(); reject(new Fault('SERVICE_TIMEOUT', 'The bounded request wait ended; accepted work continues. Query the same request before retrying.', 3)); }, timeoutMs);
    socket.on('connect', () => socket.write(JSON.stringify({ token, request: body }) + '\n'));
    socket.on('error', () => { clearTimeout(timer); reject(new Fault('SERVICE_UNAVAILABLE', 'The installed user service is not reachable.', 3)); });
    socket.on('data', (chunk: Buffer) => {
      data = Buffer.concat([data, chunk]);
      if (data.length > 8 * MAX_FRAME) { clearTimeout(timer); socket.destroy(); reject(new Fault('RESPONSE_TOO_LARGE', 'Use paged or bounded output.', 3)); return; }
      const newline = data.indexOf(10); if (newline < 0) return;
      clearTimeout(timer); socket.end();
      try { const result = JSON.parse(data.subarray(0, newline).toString('utf8')) as Response; assertContract('response', result); resolve(result); }
      catch { reject(new Fault('SERVICE_PROTOCOL_ERROR', 'Service returned an incompatible response.', 3)); }
    });
    socket.on('end', () => { clearTimeout(timer); if (data.indexOf(10) < 0) reject(new Fault('SERVICE_CONNECTION_LOST', 'The service reply was lost. Retry with the same request ID.', 3)); });
  });
}
