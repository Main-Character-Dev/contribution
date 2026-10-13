import { parentPort } from 'node:worker_threads';
import type { BulkJob } from './bulk-work.js';
import { stableFileDigest } from './bounded-file.js';
import { appTreeDigest } from './device-artifacts.js';
import { extractSignedAppArchive } from './app-archive.js';
import { managedStorageCensus } from './managed-storage.js';
import { Fault } from './core.js';

parentPort!.on('message', (job: BulkJob) => {
try {
  const value = job.kind === 'file-digest' ? stableFileDigest(job.path, job.maxBytes, job.code) :
    job.kind === 'storage-usage' ? managedStorageCensus(job.path, job.maxStateBytes) :
    job.kind === 'app-digest' ? appTreeDigest(job.path) : extractSignedAppArchive(job.path, job.destination, job.appName);
  parentPort!.postMessage({ value });
} catch (error) {
  const fault = error instanceof Fault ? error : new Fault('BULK_WORK_FAILED', 'Bounded artifact verification failed.', 3);
  parentPort!.postMessage({ error: { code: fault.code, message: fault.message, exit: fault.exit } });
}
});
