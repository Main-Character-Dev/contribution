import type { Journal } from './journal.js';
import { id, now, requireValue, Fault } from './core.js';
import type { ObjectValue } from './core.js';

export interface MaintenanceWindow {
  id: string; requestId: string; payload: string; phase: 'draining' | 'stopping' | 'stopped';
  requestedAt: string; backup?: ObjectValue; stoppedAt?: string;
}
// No timeout grants permission to restart workers. The app must explicitly
// reconcile the installed payload or cancel the held window after recovery.
export class Maintenance {
  busy = false;
  constructor(readonly store: Journal, readonly payload: string) {}
  current(): MaintenanceWindow | undefined { return this.store.getMeta<MaintenanceWindow | null>('maintenanceWindow') ?? undefined; }
  begin(requestId: string): MaintenanceWindow {
    const current = this.current();
    if (current) { requireValue(current.requestId === requestId, 'MAINTENANCE_HELD', 'Another update or maintenance window is already retained.', 4); return current; }
    requireValue(!this.store.record('maintenanceHistory', requestId), 'MAINTENANCE_ALREADY_FINISHED', 'This maintenance request already finished. Use a new request identity.');
    const window: MaintenanceWindow = { id: id(), requestId, payload: this.payload, phase: 'draining', requestedAt: now() };
    this.store.transaction(() => { this.store.setMeta('maintenanceWindow', window); this.store.setMeta('maintenance', true); }); return window;
  }
  require(windowId: string): MaintenanceWindow {
    const window = this.current(); requireValue(window?.id === windowId, 'MAINTENANCE_WINDOW_CHANGED', 'Select the current retained maintenance window.'); return window;
  }
  blockers(active: number, background: boolean, requests: number): ObjectValue {
    return { active, background, requests, uncertainOperations: this.store.unsettled().filter(op => op.state === 'outcome_unknown').map(op => op.operationId),
      deviceSessions: this.store.records<{ deviceId: string; ownerHostId: string | null; state: string; priorSession: string }>('deviceOwnership')
        .filter(owner => owner.ownerHostId === this.store.hostId && !['none', 'released'].includes(owner.priorSession)).map(owner => ({ deviceId: owner.deviceId, state: owner.state, priorSession: owner.priorSession })) };
  }
  isReady(blockers: ObjectValue): boolean {
    return !blockers['active'] && !blockers['background'] && !blockers['requests'] && !(blockers['uncertainOperations'] as unknown[]).length && !(blockers['deviceSessions'] as unknown[]).length;
  }
  async stop(windowId: string, blockers: ObjectValue): Promise<MaintenanceWindow> {
    let window = this.require(windowId);
    if (this.busy || !this.isReady(blockers)) throw new Fault('MAINTENANCE_NOT_READY', 'Work, observations, uncertain effects or utility-owned device sessions still need to drain or reconcile.', 4, { blockers });
    this.busy = true;
    try {
      window = { ...window, phase: 'stopping' }; this.store.setMeta('maintenanceWindow', window);
      const backup = await this.store.checkpointBackup(this.payload, window.id);
      window = { ...window, backup }; this.store.setMeta('maintenanceWindow', window); return window;
    } finally { this.busy = false; }
  }
  stopped(): void {
    const window = this.current(); if (window) this.store.setMeta('maintenanceWindow', { ...window, phase: 'stopped', stoppedAt: now() });
  }
  resume(windowId: string, observedPayload: string, outcome: 'cancelled' | 'activated'): ObjectValue {
    const window = this.require(windowId);
    requireValue(!this.busy, 'MAINTENANCE_BUSY', 'The final backup is still running.', 4);
    requireValue(observedPayload === this.payload, 'PAYLOAD_CHANGED', 'Read the running payload identity before releasing maintenance.');
    requireValue(outcome !== 'cancelled' || this.payload === window.payload, 'PAYLOAD_CHANGED', 'The installed engine changed. Reconcile activation instead of cancelling the old update.');
    const receipt = { ...window, resumedPayload: this.payload, outcome, completedAt: now(), automaticDatabaseRestore: false };
    this.store.transaction(() => { this.store.put('maintenanceHistory', window.requestId, receipt); this.store.setMeta('maintenanceWindow', null); this.store.setMeta('maintenance', false); });
    return receipt;
  }
}
