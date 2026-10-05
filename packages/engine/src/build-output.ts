import { lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import type { Journal, Operation } from './journal.js';
import { now, requireValue } from './core.js';
import { privateDirectory } from './private-files.js';
import { outputFile, outputManifest } from './output-files.js';
import type { OutputFile } from './output-files.js';

export interface BuildOutputOwner {
  operationId: string; attemptId: string; repositoryId: string; directory: string;
  phase: 'creating' | 'created' | 'sealed' | 'unconfirmed'; createdAt: string;
  root?: OutputFile; parent?: OutputFile; files?: OutputFile[]; sealedAt?: string; reason?: string;
}
export class BuildOutput {
  constructor(readonly store: Journal) {}
  begin(op: Operation): string {
    const parent = join(this.store.directory, 'device-builds'); privateDirectory(parent);
    const directory = join(parent, op.attemptId);
    requireValue(!lstatSync(directory, { throwIfNoEntry: false }) && !this.store.record('buildOutput', op.attemptId),
      'BUILD_OUTPUT_RECONCILIATION_REQUIRED', 'Existing build output must be reconciled before another execution.', 3);
    const owner: BuildOutputOwner = { operationId: op.operationId, attemptId: op.attemptId, repositoryId: op.repositoryId, directory, phase: 'creating', createdAt: now() };
    this.store.put('buildOutput', op.attemptId, owner);
    mkdirSync(directory, { mode: 0o700 });
    requireValue(realpathSync(directory) === join(realpathSync(this.store.directory), 'device-builds', op.attemptId), 'BUILD_OUTPUT_RECONCILIATION_REQUIRED', 'The build output path changed during creation.', 3);
    this.store.put('buildOutput', op.attemptId, { ...owner, phase: 'created', root: outputFile(directory), parent: outputFile(parent) }); return directory;
  }
  seal(op: Operation): void {
    const owner = this.store.record<BuildOutputOwner>('buildOutput', op.attemptId);
    requireValue(owner && owner.operationId === op.operationId && owner.repositoryId === op.repositoryId && owner.phase === 'created', 'BUILD_OUTPUT_RECONCILIATION_REQUIRED', 'The output creation record does not match this build.', 3);
    try {
      for (const entry of [owner.root, owner.parent]) {
        requireValue(entry, 'STORAGE_OUTPUT_UNCONFIRMED', 'Missing output directory identity.', 3);
        const current = outputFile(entry.path); requireValue(current.directory && current.dev === entry.dev && current.ino === entry.ino, 'STORAGE_OUTPUT_UNCONFIRMED', 'The output directory was replaced.', 3);
      }
      const files = outputManifest(owner.directory, { allowLinks: true, excludeSource: true });
      this.store.put('buildOutput', op.attemptId, { ...owner, phase: 'sealed', files, sealedAt: now() });
    } catch {
      // A valid retained app does not become invalid just because disposable
      // intermediates could not be safely inventoried. They stay protected.
      this.store.put('buildOutput', op.attemptId, { ...owner, phase: 'unconfirmed', reason: 'OUTPUT_IDENTITY_UNCONFIRMED' });
    }
  }
}
