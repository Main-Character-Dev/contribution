import { cpus, freemem, totalmem, loadavg } from 'node:os';
import { statfsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import type { ObjectValue } from './core.js';
import { now } from './core.js';
import type { ResourceLifecycle } from './resource-lifecycle.js';
import { processCensus } from './process.js';
/** A bounded on-demand sample, not another polling daemon. RSS is not summed
 * and neither load nor free memory is a claim about a process causing pressure. */
export async function resourceHealth(resources: ResourceLifecycle): Promise<ObjectValue> {
  const before = cpus().map(c => c.times), started = performance.now(); await new Promise(resolve => setTimeout(resolve, 200));
  const after = cpus().map(c => c.times); let total = 0, idle = 0;
  if (before.length === after.length) for (let i = 0; i < before.length; i++) {
    for (const key of ['user', 'nice', 'sys', 'idle', 'irq'] as const) total += after[i]![key] - before[i]![key];
    idle += after[i]!.idle - before[i]!.idle;
  }
  let disk: ObjectValue | null = null, pressure: string | null = null, swap: string | null = null;
  try { const fs = statfsSync(resources.store.directory); disk = { availableBytes: fs.bavail * fs.bsize, totalBytes: fs.blocks * fs.bsize, scope: 'state-volume; snapshots and purgeable space are not independently measured' }; } catch { /* unknown */ }
  if (process.platform === 'darwin') {
    try { pressure = execFileSync('/usr/sbin/sysctl', ['-n', 'kern.memorystatus_vm_pressure_level'], { encoding: 'utf8', timeout: 1000, maxBuffer: 4096 }).trim(); } catch { /* unknown */ }
    try { swap = execFileSync('/usr/sbin/sysctl', ['-n', 'vm.swapusage'], { encoding: 'utf8', timeout: 1000, maxBuffer: 4096 }).trim(); } catch { /* unknown */ }
  }
  const processes = processCensus(), rows = resources.all();
  return { observedAt: now(), sampleMilliseconds: Math.round(performance.now() - started), cpuBusyPercent: total > 0 && idle >= 0 && total >= idle ? 100 * (total - idle) / total : null,
    loadAverage: loadavg(), processCount: processes?.length ?? null, memory: { totalBytes: totalmem(), freeBytes: freemem(), pressureNativeValue: pressure, swapNativeValue: swap, interpretation: 'native observation; no summed RSS or attribution' },
    disk, resources: { retained: rows.filter(r => r.state !== 'stopped').length, unresolved: rows.filter(r => r.state === 'unresolved').length, recordedDevices: new Set(rows.filter(r => r.kind === 'simulator' && r.state !== 'stopped').map(r => r.identity?.value['udid']).filter(Boolean)).size, deviceScope: 'retained records only; physical/simulator global census unavailable' } };
}
