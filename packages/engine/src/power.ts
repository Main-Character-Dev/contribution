import { assertContract } from '@contribution/contracts';
import type { PowerPolicy } from '@contribution/contracts';
import { digest, now } from './core.js';
import { configureReviewedPolicy } from './reviewed-policy.js';
import type { ObjectValue } from './core.js';
import type { Journal } from './journal.js';
import { run } from './process.js';

const defaultPolicy: PowerPolicy = { schemaVersion: 1, keepAwakeWhileWorking: false };
/** A short renewable idle-sleep assertion for explicit active work. It cannot
 * change global power settings, wake a sleeping Mac, or maintain phone sessions. */
export class WorkPower {
  private working = false;
  private closed = false;
  private controller: AbortController | undefined;
  private pending: Promise<void> | undefined;
  private retryAt = 0;
  private state: 'inactive' | 'requesting' | 'requested' | 'unavailable' = 'inactive';
  private reason: string | null = null;
  private observedAt = now();
  constructor(readonly store: Journal, private readonly execute: typeof run = run, private readonly clock: () => number = Date.now) {}
  policy(): { policy: PowerPolicy; revision: string } {
    const policy = this.store.getMeta<PowerPolicy>('workPowerPolicy') ?? defaultPolicy;
    assertContract('power-policy', policy); return { policy, revision: digest(policy) };
  }
  status(): ObjectValue { return { ...this.policy(), working: this.working, state: this.state, reason: this.reason, observedAt: this.observedAt,
    assertionSeconds: 45, scope: 'idle_system_sleep_only', physicalSleepQualification: 'not_established' }; }
  configure(config: unknown, expectedRevision: string, requestId: string): ObjectValue {
    return configureReviewedPolicy(this.store, config, expectedRevision, requestId, {
      contract: 'power-policy', metadata: 'workPowerPolicy', requests: 'workPowerPolicyRequest', digestField: 'digest', selection: { config, expectedRevision }, currentRevision: () => this.policy().revision,
      afterApply: () => this.refresh(this.working),
      messages: { uuid: 'Use an immutable request UUID for the power preference.', replay: 'This power request identifies a different reviewed preference.', owner: 'This request already identifies an operation.', revision: 'The power preference changed since it was reviewed.' }
    });
  }
  refresh(working: boolean): void {
    this.working = working && !this.closed;
    if (!this.working || !this.policy().policy.keepAwakeWhileWorking) {
      this.controller?.abort(); this.setState('inactive', null); this.retryAt = 0; return;
    }
    if (this.pending || this.clock() < this.retryAt) return;
    const controller = new AbortController(); this.controller = controller; this.setState('requesting', null);
    this.pending = this.execute('/usr/bin/caffeinate', ['-i', '-t', '45', '-w', String(process.pid)], {
      signal: controller.signal, timeoutMs: 50000, maxBytes: 4096,
      started: () => { if (!controller.signal.aborted) this.setState('requested', null); }
    }).then(result => {
      if (controller.signal.aborted) return;
      if (result.code !== 0 || result.timedOut || result.cancelled || result.signal) { this.setState('unavailable', 'POWER_ASSERTION_FAILED'); this.retryAt = this.clock() + 30000; }
      else this.setState('inactive', null);
    }).catch(() => { if (!controller.signal.aborted) { this.setState('unavailable', 'POWER_ASSERTION_UNAVAILABLE'); this.retryAt = this.clock() + 30000; } })
      .finally(() => { this.controller = undefined; this.pending = undefined; });
  }
  private setState(state: WorkPower['state'], reason: string | null): void {
    if (this.state !== state || this.reason !== reason) { this.state = state; this.reason = reason; this.observedAt = now(); }
  }
  async close(): Promise<void> { this.closed = true; this.refresh(false); await this.pending; }
}
