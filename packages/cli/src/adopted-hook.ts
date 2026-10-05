import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import { Fault, object } from '@contribution/engine/core';
import type { ObjectValue } from '@contribution/engine/core';

/** Execute the service-selected original program as a Git descendant. This
 * client has no authority to choose a gate, change scope or bypass a lease. */
export async function executeAdoptedGate(plan: ObjectValue): Promise<{ exitCode: number; output: string; truncated: boolean }> {
  if (plan['schemaVersion'] === 1 && ['inactive', 'no_ref_changes'].includes(String(plan['mode'])) && plan['script'] === '') return { exitCode: 0, output: '', truncated: false };
  const script = plan['script'], cwd = plan['cwd'], scriptName = plan['scriptName'], argv = plan['argv'], input = plan['stdin'];
  if (plan['schemaVersion'] !== 1 || plan['mode'] !== 'original_gate' || typeof script !== 'string' || Buffer.byteLength(script) > 128 * 1024 ||
    typeof cwd !== 'string' || !cwd.startsWith('/') || typeof scriptName !== 'string' || !scriptName.startsWith('/') ||
    !Array.isArray(argv) || argv.length !== 2 || !argv.every(value => typeof value === 'string') || typeof input !== 'string' || Buffer.byteLength(input) > 65536)
    throw new Fault('INVALID_ADOPTED_GATE_PLAN', 'The installed service returned an invalid original-gate plan.', 3);
  const environment = object(plan['environment']);
  if (!Object.entries(environment).every(([key, value]) => /^[A-Z][A-Z0-9_]*$/.test(key) && typeof value === 'string' && !value.includes('\0')))
    throw new Fault('INVALID_ADOPTED_GATE_PLAN', 'The installed service returned an invalid gate environment.', 3);
  return new Promise(resolve => {
    const output: Buffer[] = []; let bytes = 0, truncated = false;
    const observe = (data: Buffer): void => {
      process.stderr.write(data);
      if (plan['external'] !== true) return;
      const retained = data.subarray(0, Math.max(0, 128 * 1024 - bytes));
      if (retained.length) { output.push(retained); bytes += retained.length; }
      if (retained.length < data.length) truncated = true;
    };
    const outcome = (exitCode: number) => ({ exitCode, output: Buffer.concat(output).toString('utf8'), truncated });
    // Managed gates remain in the engine-owned Git group. An external client
    // owns only its gate child group, never the user-owned outer Git process.
    const child = spawn('/bin/sh', ['-c', script, scriptName, ...argv as string[]], { cwd, env: { ...process.env, ...environment as NodeJS.ProcessEnv }, detached: plan['external'] === true, stdio: ['pipe', 'pipe', 'pipe'] });
    let requestedSignal: NodeJS.Signals | undefined;
    let killTimer: NodeJS.Timeout | undefined;
    const stop = (signal: NodeJS.Signals): void => {
      requestedSignal = signal;
      const kill = (value: NodeJS.Signals): void => { try { if (plan['external'] === true && child.pid) process.kill(-child.pid, value); else child.kill(value); } catch { /* exited */ } };
      kill(signal); killTimer ??= setTimeout(() => kill('SIGKILL'), 1500);
    };
    const handlers = new Map<NodeJS.Signals, () => void>();
    for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
      const handler = (): void => { stop(signal); }; handlers.set(signal, handler); process.on(signal, handler);
    }
    const budget = setTimeout(() => { stop('SIGTERM'); }, 3600000);
    const cleanup = (): void => { clearTimeout(budget); if (killTimer) clearTimeout(killTimer); for (const [signal, handler] of handlers) process.off(signal, handler); };
    // Keep --json stdout reserved for the final envelope. Both original output
    // streams still reach the outer engine's distinct, bounded attempt log.
    child.stdout.on('data', observe); child.stderr.on('data', observe);
    child.stdin.on('error', () => {}); child.stdin.end(input);
    child.once('error', () => { cleanup(); resolve(outcome(127)); });
    child.once('close', (code, signal) => { cleanup(); const observed = requestedSignal ?? signal; resolve(outcome(observed ? Math.min(255, 128 + (constants.signals[observed] ?? 1)) : code ?? 127)); });
  });
}
