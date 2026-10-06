import { lstatSync, realpathSync, accessSync, constants } from 'node:fs';
import { dirname } from 'node:path';
import type { Connectivity } from '@contribution/contracts';
import type { SSHRunner } from './peer-connectivity.js';
import { sshDestination } from './peer-connectivity.js';
import { run } from './process.js';

export function trustedTailscale(): string | null {
  for (const candidate of ['/Applications/Tailscale.app/Contents/MacOS/Tailscale', '/usr/local/bin/tailscale', '/opt/homebrew/bin/tailscale']) {
    try {
      const path = realpathSync(candidate), stat = lstatSync(path); accessSync(path, constants.X_OK);
      if (!stat.isFile() || stat.mode & 0o022 || ![0, process.getuid?.()].includes(stat.uid)) continue;
      let parent = dirname(path), safe = true;
      while (parent !== '/') { const info = lstatSync(parent); if (info.isSymbolicLink() || info.mode & 0o022 || ![0, process.getuid?.()].includes(info.uid)) { safe = false; break; } parent = dirname(parent); }
      if (safe) return path;
    } catch { /* Optional CLI absence or permissions are unavailable evidence. */ }
  }
  return null;
}
const unknown = (): Connectivity['provider'] => ({ status: 'unavailable', client: 'unknown', target: 'unknown', path: 'unknown' });
/** Explicit read-only diagnosis only; no provider output is logged or retained. */
export async function diagnoseTailscale(destination: string, runner: SSHRunner = run, locate: () => string | null = trustedTailscale, signal?: AbortSignal): Promise<Connectivity['provider']> {
  const command = locate(); if (!command) return unknown();
  sshDestination(destination);
  const controller = new AbortController(), abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(abort, 8000);
  const good = (result: Awaited<ReturnType<SSHRunner>>) => result.code === 0 && !result.timedOut && !result.cancelled && !result.outputLimited && result.cleanup?.released !== false;
  try {
    const result = await runner(command, ['status', '--json'], { signal: controller.signal, timeoutMs: 3000, maxBytes: 256 * 1024 });
    if (!good(result)) return unknown();
    const parsed: unknown = JSON.parse(result.stdout);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return unknown();
    const status = parsed as Record<string, unknown>;
    const evidence: Connectivity['provider'] = { status: 'observed', client: status['BackendState'] === 'Running' ? 'running' : status['BackendState'] === 'Stopped' ? 'stopped' : status['BackendState'] === 'NeedsLogin' ? 'login_required' : 'unknown', target: 'unknown', path: 'unknown' };
    if (evidence.client !== 'running') return evidence;
    // OpenSSH owns configuration evaluation, including trusted Match/Proxy
    // behavior. Never use this result as dispatch or trust authority.
    const config = await runner('/usr/bin/ssh', ['-G', '--', destination], { signal: controller.signal, timeoutMs: 3000, maxBytes: 65536 });
    if (!good(config)) return evidence;
    const fields = new Map(config.stdout.split('\n').map(line => { const index = line.indexOf(' '); return [line.slice(0, index).toLowerCase(), line.slice(index + 1).trim()]; }));
    if ([fields.get('proxycommand'), fields.get('proxyjump')].some(value => value && value !== 'none')) return { ...evidence, status: 'skipped' };
    const target = fields.get('hostname'); if (!target) return evidence;
    const peers = status['Peer']; if (!peers || typeof peers !== 'object' || Array.isArray(peers)) return evidence;
    const selected = Object.values(peers).filter(peer => peer && typeof peer === 'object').map(peer => peer as Record<string, unknown>).find(peer =>
      typeof peer['DNSName'] === 'string' && peer['DNSName'].replace(/\.$/, '').toLowerCase() === target.replace(/\.$/, '').toLowerCase() || Array.isArray(peer['TailscaleIPs']) && peer['TailscaleIPs'].includes(target));
    if (!selected) return evidence;
    evidence.target = 'visible';
    // Flags are version-dependent. Help must establish the bounded command.
    const help = await runner(command, ['ping', '--help'], { signal: controller.signal, timeoutMs: 1000, maxBytes: 16384 });
    if (!good(help) || !['--until-direct', '--timeout', '--c'].every(flag => help.stdout.includes(flag))) return evidence;
    const ping = await runner(command, ['ping', '--c=1', '--timeout=2s', '--until-direct=false', target], { signal: controller.signal, timeoutMs: 3000, maxBytes: 16384 });
    if (good(ping)) { evidence.target = 'reachable'; evidence.path = /via DERP\(/.test(ping.stdout) ? 'relay' : /via \d|via \[/.test(ping.stdout) ? 'direct' : 'unknown'; }
    return evidence;
  } catch { return unknown(); }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
