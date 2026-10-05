import { buildIdentity } from '@contribution/contracts';
import type { Journal, Operation } from './journal.js';
import type { Repositories } from './repositories.js';
import { now } from './core.js';
import type { ObjectValue } from './core.js';

const states = ['queued', 'queued_local', 'running', 'waiting', 'needs_attention', 'outcome_unknown', 'failed', 'interrupted', 'cancelled', 'succeeded'];
const kinds = ['initialize', 'checks', 'submit', 'push', 'seed', 'mirror', 'transfer.seed', 'transfer.mirror', 'device', 'remote.device', 'remote.checks', 'remote.push', 'external_gate', 'artifact_transfer', 'device_transfer', 'settings.apply'];
const actions = ['connect', 'prepare', 'install', 'install_and_launch', 'launch', 'logs', 'test', 'ui', 'debug', 'screenshot', 'screen_capture', 'native_xcode_destination', 'disconnect'];
function choice(value: unknown, allowed: readonly string[]): string { return typeof value === 'string' && allowed.includes(value) ? value : 'unknown'; }
function object(value: unknown): ObjectValue { return value && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {}; }
function count(value: unknown): number | null { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null; }
function date(value: unknown): string | null { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) ? value : null; }

/** General sharing is an allowlist projection, never recursive redaction of
 * arbitrary private records. Exact evidence and raw logs stay in their stores. */
export class Diagnostics {
  constructor(readonly store: Journal, readonly repos: Repositories) {}
  snapshot(operationId?: string): ObjectValue {
    const selected = operationId ? this.store.get(operationId) : undefined;
    const operations = selected ? [selected] : this.store.list(200);
    const aliases = new Map<string, string>();
    const alias = (kind: string, identity: string): string => {
      const key = kind + ':' + identity;
      if (!aliases.has(key)) aliases.set(key, `${kind}-${[...aliases.keys()].filter(value => value.startsWith(kind + ':')).length + 1}`);
      return aliases.get(key)!;
    };
    const project = (id: string): string => alias('project', id);
    const settings = this.store.getMeta<ObjectValue>('settings') ?? {}, storage = this.store.retention();
    const summarize = (op: Operation): ObjectValue => {
      const result = object(op.result), gate = object(result['gate']), receipt = object(result['deviceOperation']);
      const effects = Array.isArray(receipt['effects']) ? receipt['effects'].slice(0, 32) : [];
      return { operation: alias('operation', op.operationId), attempt: alias('attempt', op.attemptId), project: project(op.repositoryId),
        kind: choice(op.kind, kinds), state: choice(op.state, states), pinned: op.pinned === true, effectDispatched: op.effectDispatched === true,
        createdAt: date(op.createdAt), completedAt: date(result['completedAt']), errorPresent: Boolean(op.error),
        gate: choice(gate['state'], ['not_run', 'inactive', 'passed', 'failed', 'cancelled', 'timed_out', 'running']),
        delivery: choice(result['delivery'], ['delivered', 'up_to_date', 'unknown', 'unobserved', 'failed', 'not_delivered']),
        log: { expired: Boolean(this.store.record('logEviction', op.attemptId)), truncated: Boolean(this.store.record('logTruncation', op.attemptId)) },
        ...(Object.keys(receipt).length ? { device: { recordMode: choice(receipt['recordMode'], ['fixture', 'observed']),
          requestedAction: choice(object(receipt['intent'])['operation'], actions), certainty: choice(receipt['resultCertainty'], ['not_observed', 'confirmed', 'uncertain']),
          reconciliation: choice(object(receipt['reconciliation'])['status'], ['not_required', 'required', 'in_progress', 'resolved', 'blocked']),
          effectsTruncated: Array.isArray(receipt['effects']) && receipt['effects'].length > effects.length,
          effects: effects.map(value => { const effect = object(value); return { action: choice(effect['operation'], actions), state: choice(effect['state'], [...states, 'not_requested']),
            certainty: choice(effect['certainty'], ['not_observed', 'confirmed', 'uncertain']), installationReadbackPresent: Boolean(effect['installReadback']), launchReadbackPresent: Boolean(effect['launchReadback']) }; }) } } : {}) };
    };
    const total = Number(this.store.db.prepare('SELECT COUNT(*) AS count FROM operations').get()?.['count']);
    const repositories = this.repos.all().filter(repo => !selected || repo.id === selected.repositoryId);
    return { schemaVersion: 1, generatedAt: now(), scope: selected ? 'selected_operation' : 'local_service', privacy: 'allowlisted_summary',
      software: { contribution: buildIdentity.version, protocolVersion: 1, runtime: process.version, platform: process.platform, architecture: process.arch },
      service: { paused: this.store.getMeta('paused') === true, maintenance: this.store.getMeta('maintenance') === true,
        remoteDevicesEnabled: object(settings['remoteDevices'])['enabled'] === true, databaseSchema: 1 },
      storage: { rawLogBytes: count(storage.totalBytes), protectedLogBytes: count(storage.protectedBytes), eligibleLogBytes: count(storage.eligibleBytes), maxLogBytes: count(storage.maxLogBytes), admissionBlocked: storage.admissionBlocked,
        accounting: 'raw_logs_only' },
      repositoryCoverage: { matching: repositories.length, included: Math.min(repositories.length, 1000), truncated: repositories.length > 1000 },
      repositories: repositories.slice(0, 1000).map(repo => ({ project: project(repo.id),
        adapter: choice(repo.config.integration.adapter, ['generic-v1', 'migration-required', 'mathy-v1', 'maincharacter-v1', 'roboty-v1', 'glassalpha-v1']),
        availability: choice(repo.availability, ['this-mac', 'both-macs']), owner: repo.canonicalHostId === this.store.hostId ? 'local' : 'peer',
        gate: choice(repo.config.validation.gate, ['enabled', 'inactive']) })),
      history: { retainedOperations: count(total), includedOperations: operations.length, truncated: !selected && total > operations.length, order: 'newest_first' },
      operations: operations.map(summarize),
      omissions: ['project and device names', 'absolute paths', 'host and device identifiers', 'network endpoints', 'source and commit contents', 'command arguments', 'raw logs and screenshots', 'error messages', 'pairing and signing assets', 'app data', 'free-form evidence'],
      evidenceBoundary: 'A redacted diagnostic summary is not device qualification or publication proof. Exact retained evidence remains private.' };
  }
}
