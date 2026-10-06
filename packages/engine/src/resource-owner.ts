import type { Resource } from '@contribution/contracts';
import type { Operation } from './journal.js';
import { ResourceLifecycle } from './resource-lifecycle.js';
import type { ResourceAdapter, ResourceIdentity } from './resource-lifecycle.js';
import { digest, id, requireValue, Fault } from './core.js';

/** Owning integrations must reserve without executing, then accept one durable
 * grant. Ports, browser tabs discovered by name and OS labels are not owners. */
export interface NamedOwner {
  id: string; version: number; kind: 'provider' | 'service' | 'server';
  reserve(requestId: string, guard: () => void, signal: AbortSignal): Promise<ResourceIdentity>;
  start(identity: ResourceIdentity, guard: () => void, signal: AbortSignal): Promise<void>;
  observe(identity: ResourceIdentity, signal: AbortSignal): Promise<ResourceIdentity | 'absent' | 'unknown'>;
  close(identity: ResourceIdentity, guard: () => void, signal: AbortSignal): Promise<void>;
}
export async function boundedOwnerCall<T>(effect: (signal: AbortSignal) => Promise<T>, signal: AbortSignal, milliseconds = 5000): Promise<T> {
  const control = new AbortController(), cancel = (): void => control.abort(); signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) control.abort(); let timer: NodeJS.Timeout | undefined;
  try {
    requireValue(!control.signal.aborted, 'CANCELLED', 'Owning action was cancelled before dispatch.', 130);
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { control.abort(); reject(new Fault('OWNER_DEADLINE', 'The supported owner did not confirm its action within the finite bound.', 3)); }, milliseconds); });
    const cancellation = new Promise<never>((_, reject) => control.signal.addEventListener('abort', () => queueMicrotask(() => reject(new Fault('OWNER_CANCELLED', 'The owning action was interrupted; preserve uncertain effects.', 3))), { once: true }));
    return await Promise.race([effect(control.signal), deadline, cancellation]);
  } finally { control.abort(); if (timer) clearTimeout(timer); signal.removeEventListener('abort', cancel); }
}
export class NamedOwnerAdapter implements ResourceAdapter {
  readonly id: string; readonly version: number;
  constructor(readonly owner: NamedOwner) { this.id = owner.id; this.version = owner.version; }
  async observe(resource: Resource, signal: AbortSignal): Promise<ResourceIdentity | 'absent' | 'unknown'> {
    requireValue(resource.identity?.type === (this.owner.kind === 'server' ? 'process' : this.owner.kind), 'OWNER_IDENTITY_INVALID', 'The named owner cannot inspect this kind.', 3);
    return boundedOwnerCall(s => this.owner.observe(resource.identity!, s), signal);
  }
  async stop(resource: Resource, guard: () => void, signal: AbortSignal): Promise<void> {
    requireValue(resource.identity?.type === (this.owner.kind === 'server' ? 'process' : this.owner.kind), 'OWNER_IDENTITY_INVALID', 'Select the retained named owner identity.', 3);
    await boundedOwnerCall(async s => { const exact = await this.owner.observe(resource.identity!, s); guard(); requireValue(!s.aborted && digest(exact) === digest(resource.identity), 'OWNER_IDENTITY_CHANGED', 'The supported owner reports a changed/unknown session.', 3);
      await this.owner.close(resource.identity!, () => { requireValue(!s.aborted, 'OWNER_DEADLINE', 'The owning grant expired.', 3); guard(); }, s); }, signal);
  }
}
export async function withNamedOwner<T>(lifecycle: ResourceLifecycle, op: Operation, adapter: NamedOwnerAdapter,
  input: { scope: string; reason: string; stopAction: string; lifetime: 'ephemeral' | 'interactive' | 'persistent'; borrowedIdentity?: ResourceIdentity; dependencies?: string[] },
  execute: (resource: Resource, signal: AbortSignal) => Promise<T>, signal = new AbortController().signal): Promise<{ value?: T; error?: unknown; resource: Resource }> {
  let resource = lifecycle.begin(op, { requestId: id(), kind: adapter.owner.kind, owner: input.borrowedIdentity ? 'borrowed' : 'utility', lifetime: input.borrowedIdentity ? 'borrowed' : input.lifetime,
    adapter: adapter.id, adapterVersion: adapter.version, scope: input.scope, reason: input.reason, stopAction: input.stopAction, dependencies: input.dependencies ?? [] });
  let value: T | undefined, error: unknown;
  try {
    const identity = input.borrowedIdentity ?? await boundedOwnerCall(s => adapter.owner.reserve(resource.requestId, () => { lifecycle.assertCurrent(resource); requireValue(!s.aborted, 'OWNER_DEADLINE', 'Reservation grant expired.', 3); }, s), signal);
    resource = lifecycle.allocate(resource, identity); resource = lifecycle.grant(resource);
    if (!input.borrowedIdentity) await boundedOwnerCall(s => adapter.owner.start(identity, () => { lifecycle.assertCurrent(resource); requireValue(!s.aborted, 'OWNER_DEADLINE', 'Startup grant expired.', 3); }, s), signal);
    value = await boundedOwnerCall(s => execute(resource, s), signal, 30000);
  } catch (failure) { error = failure; }
  finally {
    try {
      resource = lifecycle.get(resource.resourceId);
      if (resource.owner === 'borrowed') resource = lifecycle.finish(resource, { borrowedSessionUntouched: true, workflowFailed: !!error }, true);
      else if (resource.identity && (resource.lifetime === 'ephemeral' || error)) resource = await lifecycle.stop(resource.resourceId, true);
      else if (!resource.identity) resource = lifecycle.unresolved(resource, 'The owner reservation is unconfirmed; inspect its exact immutable request before retrying.');
    } catch (failure) { error ??= failure; resource = lifecycle.get(resource.resourceId); }
  }
  return { ...(value === undefined ? {} : { value }), ...(error === undefined ? {} : { error }), resource };
}
