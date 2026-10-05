import { resolve } from 'node:path';
import { unlinkSync } from 'node:fs';
import { verifyPayload } from './payload.js';
import { Journal } from './journal.js';
import { Engine } from './service.js';
import { ServiceLock, defaultStateDirectory, listen, socketPath } from './ipc.js';
import { redact } from './core.js';

const args = process.argv.slice(2);
const option = (name: string): string | undefined => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
try {
  const payloadPath = option('--payload'); if (!payloadPath) throw new Error('An explicit verified installed payload is required.');
  const payload = verifyPayload(resolve(payloadPath));
  const directory = resolve(option('--state-dir') ?? defaultStateDirectory());
  const lock = new ServiceLock(directory), journal = new Journal(directory), engine = new Engine(journal, payload);
  const server = await listen(engine);
  journal.setMeta('maintenance', false); await engine.recoverObservedEffects(); engine.kick();
  process.stdout.write(JSON.stringify({ state: 'ready', hostId: journal.hostId, payload: payload.identity }) + '\n');
  let closing = false;
  const monitor = setInterval(() => { if (!engine.stopping) void engine.github.tick(engine.repos.all()); }, 30000);
  const close = (): void => {
    if (closing) return; closing = true; engine.stopping = true; clearInterval(monitor);
    // A maintenance stop drains instead of killing owned effects.
    const drain = setInterval(() => {
      if (engine.active.size) return;
      clearInterval(drain); server.close(() => {
        try { unlinkSync(socketPath(directory)); } catch { /* server may remove it */ }
        journal.close(); lock.release(); process.exitCode = 0;
      });
    }, 100);
  };
  process.on('SIGTERM', close); process.on('SIGINT', close);
  const lifecycle = setInterval(() => { if (engine.stopping) { clearInterval(lifecycle); close(); } }, 250);
} catch (error) { process.stderr.write(redact(error instanceof Error ? error.message : 'Service startup failed.') + '\n'); process.exitCode = 3; }
