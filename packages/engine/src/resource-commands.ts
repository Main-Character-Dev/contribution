import type { Response } from '@contribution/contracts';
import { completed, requireValue, string } from './core.js';
import type { ObjectValue } from './core.js';
import type { DomainCommand } from './domain-command.js';
import type { Journal } from './journal.js';
import type { ResourceLifecycle } from './resource-lifecycle.js';
import type { WorkPower } from './power.js';
import { ManagedStorage } from './managed-storage.js';
import { OwnedWorktrees } from './owned-worktrees.js';
import { GitBundleRetention } from './git-bundle-retention.js';
import { StorageRetention } from './storage.js';

interface Context {
  store: Journal;
  resources: ResourceLifecycle;
  power: WorkPower;
  kick(): void;
  refreshPower(): void;
  resourcesSettled(): Promise<void>;
}

export class ResourceCommands {
  readonly handlers: Readonly<Record<string, DomainCommand>>;
  constructor(private readonly context: Context) {
    const policyFields = ['config', 'expectedRevision', 'requestId'];
    this.handlers = {
      'service.resource-policy': { fields: policyFields, maintenanceAllowed: args => args['config'] === undefined, handle: args => this.resourcePolicy(args) },
      'service.resources': { fields: ['preview', 'scopeToken', 'requestId', 'reconcile', 'after'], maintenanceAllowed: args => !args['scopeToken'], handle: args => this.resources(args), retainedFailure: (args, response) => this.resourceFailure(args, response) },
      'service.storage': { fields: ['preview', 'scopeToken', 'requestId', 'worktrees', 'bundles'], maintenanceAllowed: () => false, handle: args => this.storage(args), retainedFailure: (args, response) => this.storageFailure(args, response) },
      'service.storage-policy': { fields: policyFields, maintenanceAllowed: args => args['config'] === undefined, handle: args => this.storagePolicy(args) },
      'service.power-policy': { fields: policyFields, maintenanceAllowed: args => args['config'] === undefined, handle: args => this.powerPolicy(args) },
    };
  }
  private resourcePolicy(args: ObjectValue): Response {
    const { resources } = this.context;
    if (args['config'] === undefined) { requireValue(args['expectedRevision'] === undefined && args['requestId'] === undefined, 'INVALID_USAGE', 'Read policy without mutation arguments.', 2); return completed(resources.policy()); }
    return completed(resources.configure(args['config'], string(args['expectedRevision'], 'expectedRevision'), string(args['requestId'], 'requestId')));
  }
  private async resources(args: ObjectValue): Promise<Response> {
    const { resources, resourcesSettled } = this.context;
    if (args['preview'] === true) { requireValue(args['scopeToken'] === undefined && args['requestId'] === undefined && args['reconcile'] === undefined, 'INVALID_USAGE', 'Preview has no mutation inputs.', 2); return completed(await resources.preview()); }
    if (args['reconcile'] === true) {
      requireValue(Object.keys(args).length === 1, 'INVALID_USAGE', 'Observation uses only --reconcile.', 2);
      await resources.reconcile(); await resourcesSettled();
    } else if (args['scopeToken'] !== undefined) {
      const result = await resources.apply(string(args['scopeToken'], 'scopeToken'), string(args['requestId'], 'requestId'));
      await resourcesSettled(); return completed(result);
    } else requireValue(Object.keys(args).every(key => key === 'after'), 'INVALID_USAGE', 'Inspect resources without mutation inputs.', 2);
    const rows = resources.history(args['after'] === undefined ? '' : string(args['after'], 'after')); return completed({ total: resources.counts().total, limited: rows.length === 200, resources: rows, nextCursor: rows.at(-1)?.resourceId ?? null, policy: resources.policy() });
  }
  private async storage(args: ObjectValue): Promise<Response> {
    const { store, kick } = this.context;
    requireValue(args['worktrees'] === undefined || args['worktrees'] === true, 'INVALID_USAGE', 'Use --worktrees to select owned checkout cleanup.', 2);
    requireValue((args['bundles'] === undefined || args['bundles'] === true) && !(args['worktrees'] && args['bundles']), 'INVALID_USAGE', 'Select one cleanup category: generated output, --worktrees or --bundles.', 2);
    const storage = args['worktrees'] === true ? new OwnedWorktrees(store) : args['bundles'] === true ? new GitBundleRetention(store) : new StorageRetention(store);
    if (args['preview'] === true) {
      requireValue(args['scopeToken'] === undefined && args['requestId'] === undefined, 'INVALID_USAGE', 'Preview and cleanup are separate requests.', 2);
      return completed(await (storage instanceof StorageRetention ? storage.previewAsync() : storage.preview()));
    }
    requireValue(args['preview'] === undefined, 'INVALID_USAGE', 'Use --preview or select its scope token and a request UUID.', 2);
    const token = string(args['scopeToken'], 'scopeToken'), requestId = string(args['requestId'], 'requestId');
    const result = await (storage instanceof StorageRetention ? storage.applyAsync(token, requestId) : storage.apply(token, requestId)); kick(); return completed(result);
  }
  private async storagePolicy(args: ObjectValue): Promise<Response> {
    const storage = new ManagedStorage(this.context.store);
    if (args['config'] === undefined) { requireValue(args['expectedRevision'] === undefined && args['requestId'] === undefined, 'INVALID_USAGE', 'Read storage policy without mutation arguments.', 2); return completed({ ...storage.policy(), usage: await storage.usageAsync() }); }
    const result = storage.configure(args['config'], string(args['expectedRevision'], 'expectedRevision'), string(args['requestId'], 'requestId')); this.context.kick(); return completed(result);
  }
  private powerPolicy(args: ObjectValue): Response {
    const { power, refreshPower } = this.context;
    if (args['config'] === undefined) { requireValue(args['expectedRevision'] === undefined && args['requestId'] === undefined, 'INVALID_USAGE', 'Read power preference without mutation arguments.', 2); return completed(power.status()); }
    const result = power.configure(args['config'], string(args['expectedRevision'], 'expectedRevision'), string(args['requestId'], 'requestId')); refreshPower(); return completed(result);
  }
  private resourceFailure(args: ObjectValue, response: Response): void {
    if (!response.error || typeof args['requestId'] !== 'string') return;
    const requestId = args['requestId'], retained = this.context.store.record<{ state: string; preview: { token: string } }>('resourceCleanup', requestId);
    if (retained?.state === 'stopping' && retained.preview.token === args['scopeToken']) {
      response.result = { ...response.result, requestRetained: true, requestId, scopeToken: retained.preview.token };
      response.error.nextActions = [{ id: 'resume-resources', label: 'Resolve the retained condition and resume this exact cleanup', argv: ['contribution', 'service', 'resources', '--scope-token', retained.preview.token, '--request-id', requestId, '--json'] }];
    }
  }
  private storageFailure(args: ObjectValue, response: Response): void {
    if (!response.error || typeof args['requestId'] !== 'string') return;
    const worktrees = args['worktrees'] === true, bundles = args['bundles'] === true, requestId = args['requestId'];
    const retained = this.context.store.record<{ state: string; token?: string; preview?: { token: string } }>(worktrees ? 'worktreeCleanup' : bundles ? 'gitBundleCleanup' : 'storageCleanup', requestId);
    const token = retained?.token ?? retained?.preview?.token;
    if (retained?.state === 'removing' && token) {
      response.result = { ...response.result, requestRetained: true, requestId, scopeToken: token, worktrees, bundles };
      response.error.nextActions = [{ id: 'resume-cleanup', label: 'Resume the same reviewed cleanup after resolving the reported condition', argv: ['contribution', 'service', 'storage', ...(worktrees ? ['--worktrees'] : bundles ? ['--bundles'] : []), '--scope-token', token, '--request-id', requestId, '--json'] }];
    }
  }
}
