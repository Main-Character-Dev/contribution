import type { Resource } from '@contribution/contracts';
import { ResourceLifecycle } from './resource-lifecycle.js';
import type { ResourceAdapter, ResourceIdentity } from './resource-lifecycle.js';
import type { Operation } from './journal.js';
import { run } from './process.js';
import { boundedOwnerCall } from './resource-owner.js';
import { id, requireValue, Fault } from './core.js';

export interface SimulatorLease { token: string; udid: string; runtime: string; hostId: string; bootId: string; exclusiveDevice: boolean }
/** A thin bridge to the repository's existing admission owner. It must preserve
 * its normal acquisition order and shared worker slots. No independent lock. */
export interface SimulatorAdmission {
  acquire(signal: AbortSignal): Promise<SimulatorLease>;
  current(udid: string, token: string): SimulatorLease | null;
  release(lease: SimulatorLease): Promise<void>;
}
export interface SimulatorDriver {
  state(udid: string, runtime: string, signal: AbortSignal): Promise<'Booted' | 'Shutdown' | 'transitional' | 'unknown'>;
  boot(udid: string, guard: () => void, signal: AbortSignal): Promise<void>;
  shutdown(udid: string, guard: () => void, signal: AbortSignal): Promise<void>;
}
export class MacSimulatorDriver implements SimulatorDriver {
  async state(udid: string, runtime: string, signal: AbortSignal): Promise<'Booted' | 'Shutdown' | 'transitional' | 'unknown'> {
    const result = await run('/usr/bin/xcrun', ['simctl', 'list', 'devices', '--json'], { signal, timeoutMs: 4000, maxBytes: 1024 * 1024 });
    if (result.code !== 0) return 'unknown';
    try {
      const values = JSON.parse(result.stdout).devices as Record<string, { udid: string; state: string; isAvailable: boolean }[]>;
      const matches = (values[runtime] ?? []).filter(d => d.udid === udid && d.isAvailable === true);
      if (matches.length !== 1) return 'unknown'; const state = matches[0]!.state;
      return state === 'Booted' || state === 'Shutdown' ? state : 'transitional';
    } catch { return 'unknown'; }
  }
  async boot(udid: string, guard: () => void, signal: AbortSignal): Promise<void> { guard(); const r = await run('/usr/bin/xcrun', ['simctl', 'boot', udid], { signal, timeoutMs: 4000, maxBytes: 65536 }); requireValue(r.code === 0, 'SIMULATOR_BOOT_UNCONFIRMED', 'The exact boot command failed.', 3); }
  async shutdown(udid: string, guard: () => void, signal: AbortSignal): Promise<void> { guard(); const r = await run('/usr/bin/xcrun', ['simctl', 'shutdown', udid], { signal, timeoutMs: 4000, maxBytes: 65536 }); requireValue(r.code === 0, 'SIMULATOR_SHUTDOWN_UNCONFIRMED', 'The exact shutdown command failed.', 3); }
}
export class SimulatorResourceAdapter implements ResourceAdapter {
  readonly id = 'owned-simulator'; readonly version = 1;
  constructor(readonly admission: SimulatorAdmission, readonly driver: SimulatorDriver) {}
  lease(resource: Resource): SimulatorLease {
    requireValue(resource.identity?.type === 'simulator', 'SIMULATOR_IDENTITY_REQUIRED', 'Select a retained exact Simulator.');
    const value = resource.identity.value, lease = this.admission.current(String(value['udid']), String(value['lease']));
    requireValue(lease && lease.token === value['lease'] && lease.udid === value['udid'] && lease.runtime === value['runtime'] && lease.hostId === resource.hostId && lease.bootId === resource.bootId,
      'SIMULATOR_LEASE_CHANGED', 'The admitted token/device/runtime/host changed; preserve the device.', 3); return lease;
  }
  async observe(resource: Resource, signal: AbortSignal): Promise<ResourceIdentity | 'absent' | 'unknown'> {
    const value = resource.identity?.value; requireValue(value, 'SIMULATOR_IDENTITY_REQUIRED', 'Select a retained exact Simulator.');
    const current = this.admission.current(String(value['udid']), String(value['lease']));
    if (!current && resource.owner === 'borrowed') return 'absent';
    if (!current) return await this.driver.state(String(value['udid']), String(value['runtime']), signal) === 'Shutdown' ? 'absent' : 'unknown';
    const lease = this.lease(resource), state = await this.driver.state(lease.udid, lease.runtime, signal); this.lease(resource);
    if (state === 'Shutdown') return resource.identity!;
    return state === 'Booted' ? resource.identity! : 'unknown';
  }
  async stop(resource: Resource, guard: () => void, signal: AbortSignal): Promise<void> {
    const lease = this.lease(resource), value = resource.identity!.value;
    const finalGuard = (): void => { guard(); this.lease(resource); };
    finalGuard(); const prior = await this.driver.state(lease.udid, lease.runtime, signal); finalGuard();
    requireValue(value['initialState'] === 'Shutdown' && (prior === 'Shutdown' || lease.exclusiveDevice && value['bootConfirmed'] === true), 'SIMULATOR_BOOT_OWNERSHIP_UNCONFIRMED', 'Only a positively owned boot or confirmed unused admission can be released.', 3);
    if (prior !== 'Shutdown') {
      requireValue(prior === 'Booted', 'SIMULATOR_INITIAL_STATE_UNKNOWN', 'Unknown boot state remains protected.', 3);
      await this.driver.shutdown(lease.udid, finalGuard, signal); finalGuard();
      while (!signal.aborted) {
        if (await this.driver.state(lease.udid, lease.runtime, signal) === 'Shutdown') { finalGuard(); break; }
        finalGuard(); await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    finalGuard(); await this.admission.release(lease); guard();
    requireValue(!this.admission.current(lease.udid, lease.token), 'SIMULATOR_RELEASE_UNCONFIRMED', 'The original admission was not released.', 3);
  }
}
export async function withSimulator<T>(lifecycle: ResourceLifecycle, op: Operation, selection: { udid: string; runtime: string; lifetime?: 'ephemeral' | 'interactive'; parentId?: string; timeoutMs?: number },
  adapter: SimulatorResourceAdapter, execute: (resource: Resource, signal: AbortSignal) => Promise<T>, signal = new AbortController().signal): Promise<{ value?: T; error?: unknown; resource: Resource; admissionReleased: boolean }> {
  requireValue(/^[A-Za-z0-9-]{8,128}$/.test(selection.udid) && selection.runtime.length > 0, 'SIMULATOR_IDENTITY_REQUIRED', 'Select an exact UDID/runtime before admission.', 2);
  let resource = lifecycle.begin(op, { requestId: id(), kind: 'simulator', owner: selection.parentId ? 'borrowed' : 'utility', lifetime: selection.parentId ? 'borrowed' : selection.lifetime ?? 'ephemeral',
    adapter: adapter.id, adapterVersion: adapter.version, scope: `simulator:${selection.udid}:${id()}`, reason: 'Selected native workflow', stopAction: 'Stop the named native session through its owning repository adapter', ...(selection.parentId ? { parentId: selection.parentId } : {}) });
  let lease: SimulatorLease | undefined, value: T | undefined, error: unknown, admissionReleased = false;
  try {
    if (selection.parentId) {
      const parent = lifecycle.get(selection.parentId); requireValue(parent.identity?.type === 'simulator' && parent.identity.value['udid'] === selection.udid && parent.identity.value['runtime'] === selection.runtime, 'SIMULATOR_PARENT_CHANGED', 'The outer owner has a different device.');
      resource = lifecycle.grant(lifecycle.allocate(resource, parent.identity)); value = await boundedOwnerCall(s => execute(resource, s), signal, selection.timeoutMs ?? 3600000); resource = lifecycle.finish(resource, { nestedDriverEnded: true, outerResourceUntouched: true }, true);
      return { value, resource, admissionReleased: false };
    }
    lease = await boundedOwnerCall(s => adapter.admission.acquire(s), signal);
    requireValue(lease.udid === selection.udid && lease.runtime === selection.runtime && lease.hostId === resource.hostId && lease.bootId === resource.bootId, 'SIMULATOR_ADMISSION_CHANGED', 'Admission returned a different exact device or host.');
    lifecycle.assertCurrent(resource);
    const settle = AbortSignal.any([signal, AbortSignal.timeout(5000)]); let initial = await boundedOwnerCall(s => adapter.driver.state(lease!.udid, lease!.runtime, s), settle);
    while (initial === 'transitional' && !settle.aborted) { await new Promise(resolve => setTimeout(resolve, 100)); initial = await boundedOwnerCall(s => adapter.driver.state(lease!.udid, lease!.runtime, s), settle); }
    lifecycle.assertCurrent(resource); requireValue(adapter.admission.current(lease.udid, lease.token)?.token === lease.token, 'SIMULATOR_LEASE_CHANGED', 'Admission changed during initial observation.');
    requireValue(initial === 'Booted' || initial === 'Shutdown', 'SIMULATOR_INITIAL_STATE_UNKNOWN', 'The prior boot state cannot be proved.', 3);
    if (initial === 'Booted') resource = lifecycle.classifyBorrowed(resource);
    resource = lifecycle.allocate(resource, { type: 'simulator', value: { udid: lease.udid, runtime: lease.runtime, lease: lease.token, initialState: initial, bootConfirmed: false } });
    resource = lifecycle.grant(resource);
    const guard = (): void => { lifecycle.assertCurrent(resource); adapter.lease(resource); requireValue(!signal.aborted, 'CANCELLED', 'Native dispatch was cancelled.', 130); };
    if (initial === 'Shutdown') {
      requireValue(lease.exclusiveDevice, 'SIMULATOR_BOOT_ADMISSION_REQUIRED', 'An initially stopped device needs a positive device boot owner, preserving normal parallel slots.', 3);
      await boundedOwnerCall(s => adapter.driver.boot(lease!.udid, () => { requireValue(!s.aborted, 'OWNER_DEADLINE', 'Boot grant expired.', 3); guard(); }, s), signal); guard();
      const booted = AbortSignal.any([signal, AbortSignal.timeout(5000)]);
      while (await boundedOwnerCall(s => adapter.driver.state(lease!.udid, lease!.runtime, s), booted) !== 'Booted') { guard(); requireValue(!booted.aborted, 'SIMULATOR_BOOT_UNCONFIRMED', 'Boot did not settle within its bound.', 3); await new Promise(resolve => setTimeout(resolve, 100)); }
      guard(); resource = lifecycle.transition(resource, { identity: { type: 'simulator', value: { ...resource.identity!.value, bootConfirmed: true } } });
    }
    guard(); value = await boundedOwnerCall(s => execute(resource, s), signal, selection.timeoutMs ?? 3600000);
  } catch (failure) { error = failure; }
  finally {
    if (selection.parentId && resource.state !== 'stopped') {
      resource = lifecycle.finish(lifecycle.get(resource.resourceId), { nestedDriverEnded: true, outerResourceUntouched: true }, true);
    }
    if (lease) {
      try {
        // Cancellation cannot abort cleanup's independent finite budget.
        resource = lifecycle.get(resource.resourceId);
        requireValue(lease.hostId === resource.hostId && lease.bootId === resource.bootId && lease.udid === selection.udid && lease.runtime === selection.runtime, 'SIMULATOR_ADMISSION_CHANGED', 'Unknown admission cannot be released by this owner.');
        const dependencies = lifecycle.blockers(op.repositoryId).filter(r => r.operationId === op.operationId && r.resourceId !== resource.resourceId && r.lifetime === 'ephemeral');
        requireValue(dependencies.length === 0, 'SIMULATOR_DRIVER_UNRELEASED', 'Owned native drivers must stop before Simulator admission is released.', 3);
        if (resource.owner === 'borrowed') {
          lifecycle.assertCurrent(resource); adapter.lease(resource); await boundedOwnerCall(() => adapter.admission.release(lease!), new AbortController().signal); requireValue(!adapter.admission.current(lease.udid, lease.token), 'SIMULATOR_RELEASE_UNCONFIRMED', 'Admission release was not confirmed.', 3); admissionReleased = true; resource = lifecycle.finish(resource, { borrowedBootPreserved: true, admissionReleased: true }, true);
        } else if (resource.lifetime === 'interactive' && !error) {
          resource = lifecycle.transition(resource, { state: 'retained' });
        } else if (resource.identity) {
          resource = await lifecycle.stop(resource.resourceId, !!error, 10000); requireValue(!adapter.admission.current(lease.udid, lease.token), 'SIMULATOR_RELEASE_UNCONFIRMED', 'Admission release was not confirmed.', 3); admissionReleased = true;
        } else {
          // No device grant/boot/driver was possible. Release only this exact
          // acquired admission, recording setup failure independently.
          lifecycle.assertCurrent(resource); requireValue(adapter.admission.current(lease.udid, lease.token)?.token === lease.token, 'SIMULATOR_LEASE_CHANGED', 'Setup admission changed.');
          await boundedOwnerCall(() => adapter.admission.release(lease!), new AbortController().signal); requireValue(!adapter.admission.current(lease.udid, lease.token), 'SIMULATOR_RELEASE_UNCONFIRMED', 'Admission release was not confirmed.', 3); admissionReleased = true; resource = lifecycle.finish(resource, { setupFailedBeforeGrant: true, admissionReleased: true }, true);
        }
      } catch (failure) {
        const current = lifecycle.get(resource.resourceId); if (current.state !== 'unresolved') resource = lifecycle.unresolved(current, failure instanceof Fault ? failure.code : 'SIMULATOR_CLEANUP_UNCONFIRMED'); else resource = current;
        error ??= failure;
      }
    } else if (!selection.parentId) resource = lifecycle.unresolved(lifecycle.get(resource.resourceId), 'SIMULATOR_ADMISSION_UNCONFIRMED');
  }
  return { ...(value === undefined ? {} : { value }), ...(error === undefined ? {} : { error }), resource, admissionReleased };
}
