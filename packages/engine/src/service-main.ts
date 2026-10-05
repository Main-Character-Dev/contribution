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
  journal.setMeta('maintenance', Boolean(engine.maintenance.current()));
  if (!engine.maintenance.current()) { await engine.recoverObservedEffects(); engine.kick(); }
  process.stdout.write(JSON.stringify({ state: 'ready', hostId: journal.hostId, payload: payload.identity }) + '\n');
  let closing = false;
  const monitor = setInterval(() => { if (!engine.stopping && !journal.getMeta('maintenance')) void engine.github.tick(engine.repos.all()); }, 30000);
  const peerMonitor = setInterval(() => { if (!engine.stopping && !journal.getMeta('paused') && !journal.getMeta('maintenance')) void engine.peers.tick(); }, 1500);
  const close = (): void => {
    if (closing) return; closing = true; engine.stopping = true; clearInterval(monitor); clearInterval(peerMonitor);
    // A maintenance stop drains instead of killing owned effects.
    const drain = setInterval(() => {
      if (engine.active.size || engine.backgroundBusy) return;
      clearInterval(drain); server.close(() => {
        try { unlinkSync(socketPath(directory)); } catch { /* server may remove it */ }
        engine.maintenance.stopped(); journal.close(); lock.release();
        if (engine.restartRequested) {
          // Replace this launchd-owned process only after every worker and peer
          // transfer drained and the database/socket/lock were closed.
          const environment = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
          try { process.execve!(payload.node, [payload.node, payload.service, '--payload', payload.root, '--state-dir', directory], environment); }
          catch { process.stderr.write('The service could not restart its pinned payload. Reopen Contribution to repair registration.\n'); process.exitCode = 3; }
        } else process.exitCode = 0;
      });
    }, 100);
  };
  process.on('SIGTERM', close); process.on('SIGINT', close);
  const lifecycle = setInterval(() => { if (engine.stopping) { clearInterval(lifecycle); close(); } }, 250);
} catch (error) { process.stderr.write(redact(error instanceof Error ? error.message : 'Service startup failed.') + '\n'); process.exitCode = 3; }
