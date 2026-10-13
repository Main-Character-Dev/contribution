import { assertContract, validateContractFormat } from '@contribution/contracts';
import type { Journal } from './journal.js';
import { digest, requireValue } from './core.js';
import type { ObjectValue } from './core.js';

interface Review {
  contract: string;
  metadata: string;
  requests: string;
  digestField: 'digest' | 'input';
  selection: unknown;
  currentRevision: () => string;
  ownerAvailable?: () => boolean;
  afterApply?: () => void;
  messages: { uuid: string; replay: string; owner: string; revision: string };
}

/** Shared persistence mechanics only. Each owner supplies its existing digest
 * selection, namespace and extra collision guard so old receipts still replay. */
export function configureReviewedPolicy(store: Journal, config: unknown, expectedRevision: string, requestId: string, review: Review): ObjectValue {
  assertContract(review.contract, config);
  requireValue(validateContractFormat('uuid', requestId), 'INVALID_USAGE', review.messages.uuid, 2);
  const inputDigest = digest(review.selection), prior = store.record<ObjectValue & { result: ObjectValue }>(review.requests, requestId);
  if (prior) {
    requireValue(prior[review.digestField] === inputDigest, 'REQUEST_ID_CONFLICT', review.messages.replay);
    return prior.result;
  }
  requireValue(!store.byRequest(requestId) && (review.ownerAvailable?.() ?? true), 'REQUEST_ID_CONFLICT', review.messages.owner);
  requireValue(review.currentRevision() === expectedRevision, 'REVISION_CONFLICT', review.messages.revision);
  const result = { policy: config, revision: digest(config), requestId };
  store.transaction(() => {
    store.setMeta(review.metadata, config);
    store.put(review.requests, requestId, { [review.digestField]: inputDigest, result });
  });
  review.afterApply?.();
  return result;
}
