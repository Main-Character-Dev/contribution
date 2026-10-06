import type { Operation } from './journal.js';
import type { ResourceLifecycle } from './resource-lifecycle.js';
import type { SimulatorResourceAdapter } from './resource-simulator.js';
import { withSimulator } from './resource-simulator.js';
import type { Resource } from '@contribution/contracts';
import { requireValue } from './core.js';

export type RepositoryFamily = 'maincharacter' | 'mathy' | 'roboty' | 'glassalpha';
export interface LifecycleQualification {
  repositoryId: string; enrollmentRevision: string; clone: string; hostId: string;
  adapterVersion: number; exactDeviceCoordination: boolean; hostCancellationAndCrash: boolean; rollbackVerified: boolean;
}
/** An adapter translates existing admission without changing its queue, slot
 * budget or lock order. Qualification is exact, never inferred from a name. */
export class RepositoryResources {
  constructor(readonly lifecycle: ResourceLifecycle, readonly family: RepositoryFamily, readonly simulator: SimulatorResourceAdapter) {}
  qualify(op: Operation): void {
    const proof = this.lifecycle.store.record<LifecycleQualification>('resourceQualification', op.repositoryId), context = this.lifecycle.context(op.repositoryId);
    requireValue(proof && proof.repositoryId === op.repositoryId && proof.enrollmentRevision === context.revision && proof.clone === context.clone && proof.hostId === this.lifecycle.store.hostId &&
      proof.adapterVersion === this.simulator.version && proof.exactDeviceCoordination && proof.hostCancellationAndCrash && proof.rollbackVerified,
      'RESOURCE_ADOPTION_UNQUALIFIED', 'Keep the existing repository lifecycle helper until exact-device coordination, actual-host cancellation/crash and rollback qualify this adapter.', 3);
  }
  async simulatorSession<T>(op: Operation, selection: { udid: string; runtime: string; interactive?: boolean; parentId?: string; timeoutMs?: number }, execute: (resource: Resource, signal: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<{ value?: T; error?: unknown; resource: Resource; admissionReleased: boolean }> {
    this.qualify(op);
    // Mathy's visual default is intentional. The observer still classifies a
    // preexisting boot as borrowed, regardless of the family's requested life.
    return withSimulator(this.lifecycle, op, { udid: selection.udid, runtime: selection.runtime, lifetime: selection.interactive || this.family === 'mathy' ? 'interactive' : 'ephemeral',
      ...(selection.parentId ? { parentId: selection.parentId } : {}), ...(selection.timeoutMs ? { timeoutMs: selection.timeoutMs } : {}) }, this.simulator, execute, signal);
  }
}
