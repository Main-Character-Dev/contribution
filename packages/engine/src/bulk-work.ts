import { Worker } from 'node:worker_threads';
import { Fault } from './core.js';

export type BulkJob = { kind: 'file-digest'; path: string; maxBytes: number; code: string } |
  { kind: 'storage-usage'; path: string; maxStateBytes: number } | { kind: 'app-digest'; path: string } | { kind: 'app-extract'; path: string; destination: string; appName: string };
interface Pending { job: BulkJob; signal?: AbortSignal; resolve: (value: unknown) => void; reject: (error: unknown) => void; removeAbort: () => void }
const queue: Pending[] = [], idle: Worker[] = []; let active = 0;
/** Computation and owned staging IO only. SQLite and effect authority remain
 * on the service thread. Finite concurrency, queue, memory and time bounds. */
export function bulkWork<T>(job: BulkJob, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) return Promise.reject(new Fault('CANCELLED', 'Bulk verification was cancelled.', 130));
  if (queue.length >= 16) return Promise.reject(new Fault('BULK_WORK_BUSY', 'Bounded verification capacity is occupied. Retry the retained request.', 4, {}, true));
  return new Promise<T>((resolve, reject) => {
    const pending: Pending = { job, ...(signal ? { signal } : {}), resolve: value => resolve(value as T), reject, removeAbort: () => {} };
    const cancel = (): void => { const index = queue.indexOf(pending); if (index < 0) return; queue.splice(index, 1); pending.removeAbort(); reject(new Fault('CANCELLED', 'Queued verification was cancelled.', 130)); };
    pending.removeAbort = () => signal?.removeEventListener('abort', cancel); signal?.addEventListener('abort', cancel, { once: true });
    queue.push(pending); pump();
  });
}
function pump(): void {
  while (active < 2 && queue.length) {
    const pending = queue.shift()!; pending.removeAbort(); active++;
    let worker: Worker;
    try { worker = idle.pop() ?? new Worker(new URL('./bulk-worker.js', import.meta.url), { execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 256 } }); worker.ref(); }
    catch { active--; pending.reject(new Fault('BULK_WORK_FAILED', 'The bounded verifier could not start.', 3)); continue; }
    let settled = false;
    const finish = (error: unknown, value?: unknown): void => {
      if (settled) return; settled = true; clearTimeout(timer); pending.signal?.removeEventListener('abort', cancel);
      worker.removeListener('message', message); worker.removeListener('error', failed); worker.removeListener('exit', exited);
      // Hold capacity until termination, including cancelled staging writes.
      if (error) void worker.terminate().then(() => { active--; pump(); pending.reject(error); }, () => { active--; pump(); pending.reject(error); });
      else { worker.unref(); idle.push(worker); active--; pump(); pending.resolve(value); }
    };
    const cancel = (): void => finish(new Fault('CANCELLED', 'Bulk verification was cancelled; retained staging data needs its owning cleanup.', 130));
    const timer = setTimeout(() => finish(new Fault('BULK_WORK_TIMEOUT', 'Verification exceeded its finite deadline. Retained data remains protected.', 3)), 120000);
    pending.signal?.addEventListener('abort', cancel, { once: true });
    const message = (reply: { value?: unknown; error?: { code: string; message: string; exit: number } }): void => { finish(reply.error ? new Fault(reply.error.code, reply.error.message, reply.error.exit) : null, reply.value); };
    const failed = (): void => finish(new Fault('BULK_WORK_FAILED', 'The bounded verifier failed. No verified receipt was committed.', 3));
    const exited = (): void => { if (!settled) finish(new Fault('BULK_WORK_FAILED', 'The verifier ended without evidence.', 3)); };
    worker.once('message', message); worker.once('error', failed); worker.once('exit', exited);
    if (pending.signal?.aborted) cancel(); else worker.postMessage(pending.job);
  }
}
