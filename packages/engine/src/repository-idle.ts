import type { Journal, Operation } from './journal.js';
import { requireValue } from './core.js';
import { alive, processIdentity } from './process.js';

/** An exited worker or terminal transport reply does not settle its history.
 * Lifecycle changes need the complete bounded dependency census. */
export function assertRepositoryResourcesReleased(store: Journal, repositoryId: string): void {
  const pending = store.db.prepare(`SELECT key FROM records WHERE namespace='resource' AND json_extract(body,'$.repositoryId')=? AND json_extract(body,'$.state')!='stopped' LIMIT 1`).get(repositoryId);
  requireValue(!pending, 'RESOURCE_RECONCILIATION_REQUIRED', 'A retained session/resource still depends on this clone. Use its exact owning stop action before changing enrollment or transferring authority.', 3);
}
export function assertRepositorySettled(store: Journal, repositoryId: string): void {
  assertRepositoryResourcesReleased(store, repositoryId);
  const rows = store.db.prepare('SELECT body FROM operations WHERE repository_id=? LIMIT 10001').all(repositoryId);
  requireValue(rows.length <= 10000, 'REPOSITORY_CENSUS_LIMIT', 'This repository needs a paged dependency review before changing enrollment or authority.', 3);
  for (const row of rows) {
    const op = JSON.parse(String(row['body'])) as Operation;
    requireValue(['succeeded', 'failed', 'cancelled'].includes(op.state), 'REPOSITORY_BUSY', 'Queued, interrupted or uncertain repository work still needs reconciliation.', 3);
    requireValue(!store.peerEvidenceProtected(op), 'PEER_RECEIPT_PENDING', 'Complete the retained peer receipt exchange before changing enrollment or authority.', 3);
    const processes = op.result['processes'] as { pid: number; start: string | null }[] | undefined;
    requireValue(!processes?.some(proc => {
      if (!alive(proc.pid)) return false;
      const start = processIdentity(proc.pid); return !start || !proc.start || start === proc.start;
    }), 'REPOSITORY_BUSY', 'A retained worker may still be using this repository.', 3);
  }
  const capture = store.db.prepare(`SELECT r.key FROM records r LEFT JOIN operations o ON o.request_id=r.key
    WHERE o.id IS NULL AND ((r.namespace='captureIntent' AND json_extract(r.body,'$.repositoryId')=?)
    OR (r.namespace='historyCaptureIntent' AND json_extract(r.body,'$.manifest.repositoryId')=?)) LIMIT 1`).get(repositoryId, repositoryId);
  requireValue(!capture, 'CAPTURE_RECONCILIATION_REQUIRED', 'Resume the retained source/history capture before changing enrollment or authority.', 3);
  const incoming = store.db.prepare(`SELECT key FROM records WHERE namespace='transfer'
    AND json_extract(body,'$.manifest.repositoryId')=? AND json_extract(body,'$.accepted') IS NULL LIMIT 1`).get(repositoryId);
  requireValue(!incoming, 'TRANSFER_RECONCILIATION_REQUIRED', 'An incomplete incoming Git transfer still depends on this repository pairing.', 3);
}
