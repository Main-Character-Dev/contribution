import { lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import type { Journal } from './journal.js';
import { id, now, requireValue } from './core.js';
import type { ObjectValue } from './core.js';
import { privateDirectory } from './private-files.js';
import { outputFile, outputManifest } from './output-files.js';
import type { OutputFile } from './output-files.js';

export interface BackupOutputOwner {
  id: string; hostId: string; windowId: string; payload: string; generation: number; directory: string; createdAt: string;
  phase: 'creating' | 'created' | 'sealed'; root?: OutputFile; parent?: OutputFile; files?: OutputFile[]; receipt?: ObjectValue;
}
/** Ownership is retained before the SQLite backup target exists. Unknown old
 * backups never gain cleanup authority merely by looking like this layout. */
export class BackupOutput {
  constructor(readonly store: Journal) {}
  begin(payload: string, windowId: string): BackupOutputOwner {
    const parent = join(this.store.directory, 'backups'); privateDirectory(parent);
    const identity = id(), directory = join(parent, identity), generation = Number(this.store.getMeta('backupGeneration') ?? 0) + 1;
    requireValue(Number.isSafeInteger(generation) && generation > 0 && !lstatSync(directory, { throwIfNoEntry: false }), 'BACKUP_OUTPUT_UNCONFIRMED', 'Backup creation identity is unavailable.', 3);
    let owner: BackupOutputOwner = { id: identity, hostId: this.store.hostId, payload, windowId, generation, directory, createdAt: now(), phase: 'creating' };
    this.store.transaction(() => { this.store.setMeta('backupGeneration', generation); this.store.put('backupOutput', identity, owner); });
    mkdirSync(directory, { mode: 0o700 });
    requireValue(realpathSync(directory) === join(realpathSync(this.store.directory), 'backups', identity), 'BACKUP_OUTPUT_UNCONFIRMED', 'The backup directory changed during creation.', 3);
    owner = { ...owner, phase: 'created', root: outputFile(directory), parent: outputFile(parent) };
    this.store.put('backupOutput', identity, owner); return owner;
  }
  seal(owner: BackupOutputOwner, receipt: ObjectValue): void {
    requireValue(this.store.record<BackupOutputOwner>('backupOutput', owner.id)?.phase === 'created' && receipt['windowId'] === owner.windowId && receipt['hostId'] === owner.hostId &&
      receipt['payload'] === owner.payload && receipt['path'] === join(owner.directory, 'journal.sqlite'), 'BACKUP_OUTPUT_UNCONFIRMED', 'The backup receipt does not match its retained creation identity.', 3);
    for (const entry of [owner.root, owner.parent]) {
      requireValue(entry, 'BACKUP_OUTPUT_UNCONFIRMED', 'The backup directory has no retained identity.', 3);
      const current = outputFile(entry.path);
      requireValue(current.directory && current.dev === entry.dev && current.ino === entry.ino, 'BACKUP_OUTPUT_UNCONFIRMED', 'The backup directory was replaced.', 3);
    }
    const files = outputManifest(owner.directory);
    requireValue(files.length === 3 && files.every(file => file.path === owner.directory || file.path === join(owner.directory, 'journal.sqlite') || file.path === join(owner.directory, 'receipt.json')),
      'BACKUP_OUTPUT_UNCONFIRMED', 'Unrecognized backup output remains protected.', 3);
    this.store.put('backupOutput', owner.id, { ...owner, phase: 'sealed', files, receipt });
  }
}
