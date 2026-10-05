import { LegacyPrimaryLease } from './legacy-lease.js';
import type { LegacyOwner } from './legacy-lease.js';
import type { Journal } from './journal.js';
import type { Enrolled } from './repositories.js';
import { digest, id, object, requireValue, string } from './core.js';
import type { ObjectValue } from './core.js';

export interface LegacyHookInvocation {
  repositoryId: string; operationId: string; attemptId: string; policyRevision: string;
  phase: 'gate_running' | 'gate_finished'; hookToken: string; lease: LegacyOwner;
  process: { pid: number; start: string };
}
interface BorrowReceipt { operationId: string; repositoryId: string; leaseToken: string; borrowToken: string; result: ObjectValue; released: boolean }

/** A hook receives a receipt for borrowing, never the authority to release the
 * outer primary writer. Environment selectors are not sufficient authority. */
export class LegacyHookBorrow {
  constructor(readonly store: Journal) {}
  private invocation(repo: Enrolled, args: ObjectValue): LegacyHookInvocation {
    const operationId = string(args['operationId'], 'operation'), op = this.store.get(operationId);
    const invocation = this.store.record<LegacyHookInvocation>('legacyHookInvocation', operationId);
    requireValue(invocation && invocation.repositoryId === repo.id && invocation.operationId === op.operationId && invocation.attemptId === op.attemptId &&
      invocation.policyRevision === repo.revision && invocation.hookToken === args['hookToken'] && invocation.phase === 'gate_running' &&
      op.repositoryId === repo.id && ['push', 'external_gate'].includes(op.kind) && op.state === 'running' && invocation.lease.purpose === `contribution:${op.attemptId}` && invocation.lease.pid === process.pid,
      'HOOK_LEASE_INVALID', 'No active adopted gate owns this exact repository, policy, operation and writer lease.');
    const caller = object(args['caller']);
    requireValue(typeof caller['pid'] === 'number' && typeof caller['start'] === 'string', 'HOOK_PROCESS_MISMATCH', 'A verified live hook process is required.');
    LegacyPrimaryLease.borrow(repo.commonDir, invocation.lease, { pid: caller['pid'], start: caller['start'] }, invocation.process);
    return invocation;
  }
  borrow(repo: Enrolled, args: ObjectValue): ObjectValue {
    const invocation = this.invocation(repo, args), key = digest({ operationId: invocation.operationId, caller: args['caller'] });
    const prior = this.store.record<BorrowReceipt>('legacyBorrow', key);
    if (prior) {
      requireValue(prior.leaseToken === invocation.lease.token && !prior.released, 'HOOK_LEASE_INVALID', 'This caller already released its borrowed lease.'); return prior.result;
    }
    const borrowToken = `contribution-borrow:${id()}`;
    const result = { status: 'acquired', leasePath: `${repo.commonDir}/primary-checkout-mutation.lock`, token: borrowToken,
      owner: { ...invocation.lease, token: borrowToken }, contributionBorrowed: true };
    this.store.transaction(() => {
      this.store.put('legacyBorrow', key, { operationId: invocation.operationId, repositoryId: repo.id, leaseToken: invocation.lease.token, borrowToken, result, released: false });
      this.store.put('legacyBorrowToken', borrowToken, { key });
    }); return result;
  }
  release(repo: Enrolled, args: ObjectValue): ObjectValue {
    const invocation = this.invocation(repo, args), borrowToken = string(args['borrowToken'], 'borrow token');
    const index = this.store.record<{ key: string }>('legacyBorrowToken', borrowToken), receipt = index ? this.store.record<BorrowReceipt>('legacyBorrow', index.key) : null;
    requireValue(index && receipt && receipt.operationId === invocation.operationId && receipt.repositoryId === repo.id && receipt.leaseToken === invocation.lease.token && receipt.borrowToken === borrowToken,
      'HOOK_LEASE_INVALID', 'The release receipt does not belong to this managed gate.');
    if (!receipt.released) this.store.put('legacyBorrow', index.key, { ...receipt, released: true });
    return { released: true, outerLeaseReleased: false };
  }
}
