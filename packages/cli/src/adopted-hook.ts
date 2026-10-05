import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import { Fault, object } from '@contribution/engine/core';
import type { ObjectValue } from '@contribution/engine/core';

/** Execute the service-selected original program as a Git descendant. This
 * client has no authority to choose a gate, change scope or bypass a lease. */
export async function executeAdoptedGate(plan: ObjectValue): Promise<number> {
  if (plan['mode'] === 'inactive' && plan['script'] === '') return 0;
  const script = plan['script'], cwd = plan['cwd'], scriptName = plan['scriptName'], argv = plan['argv'], input = plan['stdin'];
  if (plan['schemaVersion'] !== 1 || plan['mode'] !== 'original_gate' || typeof script !== 'string' || Buffer.byteLength(script) > 128 * 1024 ||
    typeof cwd !== 'string' || !cwd.startsWith('/') || typeof scriptName !== 'string' || !scriptName.startsWith('/') ||
    !Array.isArray(argv) || argv.length !== 2 || !argv.every(value => typeof value === 'string') || typeof input !== 'string' || Buffer.byteLength(input) > 65536)
    throw new Fault('INVALID_ADOPTED_GATE_PLAN', 'The installed service returned an invalid original-gate plan.', 3);
  const environment = object(plan['environment']);
  if (!Object.entries(environment).every(([key, value]) => /^[A-Z][A-Z0-9_]*$/.test(key) && typeof value === 'string' && !value.includes('\0')))
    throw new Fault('INVALID_ADOPTED_GATE_PLAN', 'The installed service returned an invalid gate environment.', 3);
  return new Promise(resolve => {
    // Do not detach: the engine owns and cancels the outer Git process group.
    const child = spawn('/bin/sh', ['-c', script, scriptName, ...argv as string[]], { cwd, env: { ...process.env, ...environment as NodeJS.ProcessEnv }, detached: false, stdio: ['pipe', 'pipe', 'pipe'] });
    let requestedSignal: NodeJS.Signals | undefined;
    const handlers = new Map<NodeJS.Signals, () => void>();
    for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
      const handler = (): void => { requestedSignal = signal; child.kill(signal); }; handlers.set(signal, handler); process.on(signal, handler);
    }
    const cleanup = (): void => { for (const [signal, handler] of handlers) process.off(signal, handler); };
    // Keep --json stdout reserved for the final envelope. Both original output
    // streams still reach the outer engine's distinct, bounded attempt log.
    child.stdout.on('data', data => process.stderr.write(data)); child.stderr.on('data', data => process.stderr.write(data));
    child.stdin.on('error', () => {}); child.stdin.end(input);
    child.once('error', () => { cleanup(); resolve(127); });
    child.once('close', (code, signal) => { cleanup(); const observed = requestedSignal ?? signal; resolve(observed ? Math.min(255, 128 + (constants.signals[observed] ?? 1)) : code ?? 127); });
  });
}
