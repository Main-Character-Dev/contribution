import { lstatSync, opendirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { assertContract, validateContractFormat } from '@contribution/contracts';
import type { StoragePolicy } from '@contribution/contracts';
import type { Journal } from './journal.js';
import { digest, now, requireValue } from './core.js';
import type { ObjectValue } from './core.js';

export interface ManagedUsage {
  observedAt: string; logicalBytes: number; entries: number; complete: boolean; reason: string | null;
  maxStateBytes: number; admissionBlocked: boolean; categories: { category: string; logicalBytes: number; entries: number }[];
  scope: string; excluded: string[]; accounting: string;
}
const defaultPolicy: StoragePolicy = { schemaVersion: 1, maxStateBytes: 10 * 1024 ** 3 };
const directories: Record<string, string> = { Payloads: 'installed_payloads', logs: 'raw_logs', backups: 'journal_backups', transfers: 'outgoing_git_bundles', incoming: 'incoming_git_bundles',
  'artifact-incoming': 'incoming_artifacts', 'device-builds': 'device_builds', candidates: 'landing_checkouts', 'adopted-landings': 'adopted_checkouts', 'legacy-reports': 'original_gate_output', 'legacy-reporting': 'original_gate_output' };

/** A bounded read-only census. Link targets are never traversed and unknown
 * files count toward the cap; absence of a completed census never means zero. */
export class ManagedStorage {
  constructor(readonly store: Journal) {}
  policy(): { policy: StoragePolicy; revision: string } {
    const policy = this.store.getMeta<StoragePolicy>('managedStoragePolicy') ?? defaultPolicy;
    assertContract('storage-policy', policy); return { policy, revision: digest(policy) };
  }
  configure(config: unknown, expectedRevision: string, requestId: string): ObjectValue {
    assertContract('storage-policy', config);
    requireValue(validateContractFormat('uuid', requestId), 'INVALID_USAGE', 'Use an immutable request UUID for the storage policy.', 2);
    const inputDigest = digest({ config, expectedRevision }), prior = this.store.record<{ digest: string; result: ObjectValue }>('managedStoragePolicyRequest', requestId);
    if (prior) { requireValue(prior.digest === inputDigest, 'REQUEST_ID_CONFLICT', 'This storage policy request already identifies a different review.'); return prior.result; }
    requireValue(!this.store.byRequest(requestId), 'REQUEST_ID_CONFLICT', 'This request already identifies an operation.');
    requireValue(this.policy().revision === expectedRevision, 'REVISION_CONFLICT', 'Managed-data policy changed since it was reviewed.');
    const result = { policy: config, revision: digest(config), requestId };
    this.store.transaction(() => { this.store.setMeta('managedStoragePolicy', config); this.store.put('managedStoragePolicyRequest', requestId, { digest: inputDigest, result }); });
    return result;
  }
  usage(limits: { entries: number; depth: number; milliseconds: number } = { entries: 200000, depth: 32, milliseconds: 2000 }): ManagedUsage {
    const { policy } = this.policy(), started = performance.now(), categories = new Map<string, { category: string; logicalBytes: number; entries: number }>();
    let bytes = 0, entries = 0, reason: string | null = null;
    const stop = (value: string): void => { reason ??= value; };
    const categoryFor = (name: string): string => Object.hasOwn(directories, name) ? directories[name]! : (/^journal\.sqlite(?:-(?:wal|shm))?$/.test(name) ? 'journal' : 'other_private_state');
    const visit = (path: string, category: string, depth: number): void => {
      if (reason) return;
      if (entries >= limits.entries || depth > limits.depth || performance.now() - started >= limits.milliseconds) { stop('STORAGE_CENSUS_LIMIT'); return; }
      let info;
      try { info = lstatSync(path); } catch { stop('STORAGE_CENSUS_UNAVAILABLE'); return; }
      if (!Number.isSafeInteger(info.size) || !Number.isSafeInteger(bytes + info.size)) { stop('STORAGE_CENSUS_OVERFLOW'); return; }
      const row = categories.get(category) ?? { category, logicalBytes: 0, entries: 0 };
      entries++; bytes += info.size; row.entries++; row.logicalBytes += info.size; categories.set(category, row);
      // Symlink length is counted, but its contents and target are excluded.
      if (!info.isDirectory() || info.isSymbolicLink()) return;
      try {
        const current = lstatSync(path);
        if (current.isSymbolicLink() || current.dev !== info.dev || current.ino !== info.ino || realpathSync(path) !== path) { stop('STORAGE_CENSUS_CHANGED'); return; }
        const directory = opendirSync(path);
        try {
          const opened = lstatSync(path);
          if (opened.isSymbolicLink() || opened.dev !== info.dev || opened.ino !== info.ino) { stop('STORAGE_CENSUS_CHANGED'); return; }
          let entry;
          while (!reason && (entry = directory.readSync())) visit(join(path, entry.name), depth === 0 ? categoryFor(entry.name) : category, depth + 1);
        } finally { directory.closeSync(); }
        const after = lstatSync(path);
        if (after.isSymbolicLink() || after.dev !== info.dev || after.ino !== info.ino) stop('STORAGE_CENSUS_CHANGED');
      } catch { stop('STORAGE_CENSUS_UNAVAILABLE'); }
    };
    try {
      const original = lstatSync(this.store.directory);
      if (!original.isDirectory() || original.isSymbolicLink() || original.uid !== process.getuid?.()) stop('UNSAFE_STATE_DIRECTORY');
      else visit(realpathSync(this.store.directory), 'other_private_state', 0);
    } catch { stop('STORAGE_CENSUS_UNAVAILABLE'); }
    return { observedAt: now(), logicalBytes: bytes, entries, complete: reason === null, reason, maxStateBytes: policy.maxStateBytes,
      admissionBlocked: reason !== null || bytes >= policy.maxStateBytes, categories: [...categories.values()].sort((a, b) => a.category.localeCompare(b.category)),
      scope: 'private_contribution_support_directory', accounting: 'logical_sizes_including_directory_and_link_entries',
      excluded: ['source repositories and their Git object stores', 'external link targets', 'user-selected external exports', 'application bundles outside the support directory'] };
  }
  assertAdmission(): void {
    const usage = this.usage();
    requireValue(usage.complete, usage.reason ?? 'STORAGE_CENSUS_UNAVAILABLE', 'Managed-data usage could not be fully inspected. Preserve the state and review storage diagnostics before new work.', 3);
    requireValue(!usage.admissionBlocked, 'MANAGED_STORAGE_PRESSURE', 'Contribution-managed data reached its cap. Review eligible output for cleanup or raise the managed-data limit; protected records remain preserved.', 3);
  }
}
