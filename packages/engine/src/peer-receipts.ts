import type { Response } from '@contribution/contracts';
import type { Journal, Operation } from './journal.js';
import { digest } from './core.js';

export interface CompletionReceipt { operationId: string; attemptId: string; digest: string }
export interface CompletionOutbox {
  operationId: string; repositoryId: string; hostId: string; receipt: CompletionReceipt;
  state: 'pending' | 'acknowledged'; retainedAt: string; acknowledgedAt?: string;
  failures?: number; nextAttempt?: number; reasonCode?: string;
}
/** Retention annotations can expire after receipt delivery. They are not part
 * of the completed effect identity; all actual result/error fields remain. */
export function completionReceipt(response: Response): CompletionReceipt | null {
  if (!response.operationId || !['succeeded', 'failed', 'cancelled'].includes(response.operationState ?? '') || !response.result || typeof response.result['attemptId'] !== 'string') return null;
  const { logRetention: _log, outputRetention: _output, peerCompletion: _peer, ...result } = response.result;
  return { operationId: response.operationId, attemptId: response.result['attemptId'], digest: digest({ ...response, result }) };
}
export function peerCompletionStatus(store: Journal, op: Operation, response: Response): { received: 'pending' | 'acknowledged' | null; sent: 'pending' | 'acknowledged' | null } | null {
  let received: 'pending' | 'acknowledged' | null = null, sent: 'pending' | 'acknowledged' | null = null;
  const association = store.record<{ from: string }>('peerOperation', op.operationId), sender = association?.from ?? op.input['senderHostId'];
  if (association || sender !== undefined) {
    const receipt = completionReceipt(response), acknowledgment = store.record<{ from: string; receipt: CompletionReceipt }>('peerCompletionAcknowledgment', op.operationId);
    received = typeof sender === 'string' && receipt && acknowledgment?.from === sender && digest(acknowledgment.receipt) === digest(receipt) ? 'acknowledged' : 'pending';
  }
  if (typeof op.result['remoteOperationId'] === 'string') {
    const outbox = store.record<CompletionOutbox>('peerCompletionOutbox', op.operationId);
    const observation = (op.result['canonicalObservation'] ?? op.result['executionObservation']) as Response | undefined;
    const receipt = observation && completionReceipt(observation);
    sent = outbox && outbox.state === 'acknowledged' && receipt && digest(outbox.receipt) === digest(receipt) ? 'acknowledged' : 'pending';
  }
  return received || sent ? { received, sent } : null;
}
export function peerEvidenceProtected(store: Journal, op: Operation): boolean {
  const status = peerCompletionStatus(store, op, store.response(op));
  return status?.received === 'pending' || status?.sent === 'pending';
}
