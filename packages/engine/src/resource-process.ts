import type { Resource } from '@contribution/contracts';
import type { Journal, Operation } from './journal.js';
import { ResourceLifecycle, bootIdentity } from './resource-lifecycle.js';
import type { ResourceAdapter, ResourceIdentity } from './resource-lifecycle.js';
import { processCensus, processIdentity } from './process.js';
import type { ProcessMember, ProcessOwnership, ProcessResult } from './process.js';
import { digest, id, requireValue } from './core.js';

function members(resource: Resource): ProcessMember[] {
  requireValue(resource.identity?.type === 'process' && resource.identity.value['boot'] === resource.bootId, 'PROCESS_GRANT_CHANGED', 'The retained process identity is incomplete.');
  const value = JSON.parse(String(resource.identity.value['members'])) as ProcessMember[];
  requireValue(Array.isArray(value) && value.length > 0 && value.length <= 4096 && value.every(m => Number.isSafeInteger(m.pid) && m.pid > 0 && typeof m.start === 'string' && m.start.length > 0), 'PROCESS_GRANT_CHANGED', 'Process members require exact identities.'); return value;
}
export const processResourceAdapter: ResourceAdapter = {
  id: 'owned-process', version: 2,
  async observe(resource): Promise<ResourceIdentity | 'absent' | 'unknown'> {
    const known = members(resource), census = processCensus(); if (!census) return 'unknown';
    const uncertain = JSON.parse(String(resource.identity!.value['unconfirmed'] ?? '[]')) as ProcessMember[];
    if (!Array.isArray(uncertain) || uncertain.length > 64 || uncertain.some(m => !Number.isSafeInteger(m.pid) || m.pid < 1 || typeof m.start !== 'string' || !m.start)) return 'unknown';
    if (census.some(p => uncertain.some(m => m.pid === p.pid && m.start === p.start))) return 'unknown';
    const group = Number(resource.identity!.value['group']);
    if (census.some(p => p.group === group && !known.some(m => m.pid === p.pid && m.start === p.start))) return 'unknown';
    const live = census.filter(p => known.some(m => m.pid === p.pid && m.start === p.start));
    return live.length ? resource.identity! : 'absent';
  },
  async stop(resource, guard, signal): Promise<void> {
    const known = members(resource);
    const terminate = (name: 'SIGTERM' | 'SIGKILL'): void => {
      for (const member of known) { guard(); if (processIdentity(member.pid) === member.start) try { process.kill(member.pid, name); } catch { /* confirm through observation */ } }
    };
    guard(); terminate('SIGTERM');
    const grace = performance.now() + 1500;
    while (!signal.aborted && performance.now() < grace) { if (await this.observe(resource, signal) === 'absent') return; await new Promise(resolve => setTimeout(resolve, 50)); }
    guard(); terminate('SIGKILL');
    while (!signal.aborted) { if (await this.observe(resource, signal) === 'absent') return; await new Promise(resolve => setTimeout(resolve, 50)); }
  }
};
export function ownedProcess(lifecycle: ResourceLifecycle, op: Operation, dependencies: string[] = [], kind: 'process' | 'server' = 'process'): ProcessOwnership {
  let resource: Resource;
  return {
    intent(executable, argv, deadlineAt) {
      resource = lifecycle.begin(op, { requestId: id(), kind, owner: 'utility', lifetime: 'ephemeral', adapter: processResourceAdapter.id, adapterVersion: processResourceAdapter.version, deadlineAt,
        dependencies, scope: `process:${id()}`, reason: `Accepted command ${digest({ executable, argv })}`, stopAction: 'contribution service resources --preview' });
    },
    allocated(pid, start) {
      resource = lifecycle.allocate(resource, { type: 'process', value: { pid, start, group: pid, boot: bootIdentity(), members: JSON.stringify([{ pid, start }]) } });
    },
    grant() { resource = lifecycle.grant(resource); },
    members(values) { requireValue(values.length <= 4096, 'PROCESS_CENSUS_LIMIT', 'Too many descendants remain protected.'); resource = lifecycle.transition(resource, { identity: { type: 'process', value: { ...resource.identity!.value, members: JSON.stringify(values) } } }); },
    unconfirmed(values) { requireValue(values.length <= 64, 'PROCESS_CENSUS_LIMIT', 'Unknown members require bounded exact-owner inspection.'); resource = lifecycle.transition(resource, { identity: { type: 'process', value: { ...resource.identity!.value, unconfirmed: JSON.stringify(values) } } }); },
    stopping() { resource = lifecycle.transition(resource, { state: 'stopping' }); },
    finished(result: ProcessResult) { resource = lifecycle.finish(resource, { code: result.code, actualExitCode: result.actualExitCode ?? null, signal: result.signal, timedOut: result.timedOut, cancelled: result.cancelled, cleanup: result.cleanup ?? null }, result.cleanup?.released === true);
      const current = lifecycle.store.get(op.operationId); lifecycle.store.update(current, { result: { ...current.result, resourceReceipts: [...((current.result['resourceReceipts'] as unknown[]) ?? []), { resourceId: resource.resourceId, workflowExit: result.code, actualExitCode: result.actualExitCode ?? null, release: resource.state, cleanup: result.cleanup ?? null }] } });
    },
    uncertain(reason) { if (resource && resource.state !== 'stopped') resource = lifecycle.unresolved(resource, reason); }
  };
}
export function processLifecycle(store: Journal): ResourceLifecycle {
  const lifecycle = new ResourceLifecycle(store); lifecycle.register(processResourceAdapter); return lifecycle;
}
