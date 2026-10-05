import { validateContractFormat } from '@contribution/contracts';
import type { Journal } from './journal.js';
import type { Repositories } from './repositories.js';
import { digest, now, object, requireValue } from './core.js';
import type { ObjectValue } from './core.js';

interface ProjectSummary {
  repositoryId: string; name: string; branch: string; policyRevision: string;
  adapter: string; gate: 'enabled' | 'inactive'; availability: 'this-mac' | 'both-macs';
  reportedCanonicalHostId: string; authorityState: 'unpaired' | 'frozen' | 'active';
}
export interface ProjectCatalog { schemaVersion: 1; generation: number; digest: string; projects: ProjectSummary[] }
interface ReceivedCatalog { catalog: ProjectCatalog; observedAt: string; removed: ProjectSummary[] }
const keys = ['repositoryId', 'name', 'branch', 'policyRevision', 'adapter', 'gate', 'availability', 'reportedCanonicalHostId', 'authorityState'].sort();
const uuid = (value: unknown): value is string => typeof value === 'string' && validateContractFormat('uuid', value);
const bounded = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\x00-\x1f\x7f]/.test(value);

/** Discovery metadata is never repository enrollment, policy replacement or
 * writer authority. Paths, remotes, commands and credentials stay host-local. */
export class ProjectRegistry {
  constructor(readonly store: Journal, readonly repos: Repositories) {}
  local(): ProjectCatalog {
    const projects: ProjectSummary[] = this.repos.all().map<ProjectSummary>(repo => ({ repositoryId: repo.id, name: repo.config.name,
      branch: repo.config.integration.branch, policyRevision: repo.revision, adapter: repo.config.integration.adapter, gate: repo.config.validation.gate,
      availability: repo.availability, reportedCanonicalHostId: repo.canonicalHostId,
      authorityState: this.store.record<{ phase: 'frozen' | 'active' }>('authority', repo.id)?.phase ?? 'unpaired' })).sort((a, b) => a.repositoryId.localeCompare(b.repositoryId));
    requireValue(projects.length <= 1000 && Buffer.byteLength(JSON.stringify(projects)) <= 512 * 1024, 'REGISTRY_LIMIT', 'The paired project catalog exceeds its bounded project or byte limit.', 3);
    const prior = this.store.getMeta<ProjectCatalog>('projectRegistryCatalog'), hash = digest(projects);
    if (prior?.digest === hash) return prior;
    const catalog: ProjectCatalog = { schemaVersion: 1, generation: (prior?.generation ?? 0) + 1, digest: hash, projects };
    this.store.setMeta('projectRegistryCatalog', catalog); return catalog;
  }
  receive(hostId: string, value: unknown): ProjectCatalog {
    requireValue(uuid(hostId) && hostId !== this.store.hostId && this.store.record('peer', hostId), 'UNPAIRED_HOST', 'Only an explicitly paired host may exchange project discovery metadata.', 3);
    const raw = object(value);
    requireValue(Buffer.byteLength(JSON.stringify(raw)) <= 512 * 1024 + 256, 'REGISTRY_LIMIT', 'The paired project catalog exceeds its byte limit.', 3);
    requireValue(Object.keys(raw).sort().join() === ['schemaVersion', 'generation', 'digest', 'projects'].sort().join() && raw['schemaVersion'] === 1 &&
      Number.isSafeInteger(raw['generation']) && Number(raw['generation']) > 0 && Array.isArray(raw['projects']) && raw['projects'].length <= 1000,
      'REGISTRY_INVALID', 'The paired project catalog has an unknown or oversized shape.', 3);
    const projects = raw['projects'].map(value => {
      const row = object(value);
      requireValue(Object.keys(row).sort().join() === keys.join() && uuid(row['repositoryId']) && bounded(row['name']) && bounded(row['branch']) &&
        typeof row['policyRevision'] === 'string' && /^[a-f0-9]{64}$/.test(row['policyRevision']) && bounded(row['adapter']) && ['enabled', 'inactive'].includes(String(row['gate'])) &&
        ['this-mac', 'both-macs'].includes(String(row['availability'])) && uuid(row['reportedCanonicalHostId']) && ['unpaired', 'frozen', 'active'].includes(String(row['authorityState'])),
        'REGISTRY_INVALID', 'The paired project summary contains an unrecognized field or identity.', 3);
      return row as unknown as ProjectSummary;
    });
    requireValue(new Set(projects.map(value => value.repositoryId)).size === projects.length && digest(projects) === raw['digest'], 'REGISTRY_INVALID', 'The catalog digest or unique project identities are invalid.', 3);
    const catalog: ProjectCatalog = { schemaVersion: 1, generation: Number(raw['generation']), digest: String(raw['digest']), projects };
    const previous = this.store.record<ReceivedCatalog>('peerProjectCatalog', hostId);
    if (previous) {
      requireValue(catalog.generation >= previous.catalog.generation, 'REGISTRY_STALE', 'An older catalog cannot replace a newer paired-host observation.', 3);
      requireValue(catalog.generation !== previous.catalog.generation || catalog.digest === previous.catalog.digest, 'REGISTRY_CONFLICT', 'A paired catalog generation cannot identify two different contents.', 3);
    }
    const present = new Set(projects.map(value => value.repositoryId));
    const removed = new Map([...(previous?.removed ?? []), ...(previous?.catalog.projects ?? [])].filter(value => !present.has(value.repositoryId)).map(value => [value.repositoryId, value]));
    this.store.put('peerProjectCatalog', hostId, { catalog, observedAt: now(), removed: [...removed.values()].slice(-1000) });
    return catalog;
  }
  offer(hostId: string, repositoryId: string, expectedRevision: string): ProjectSummary {
    const catalog = this.store.record<ReceivedCatalog>('peerProjectCatalog', hostId);
    const offer = catalog?.catalog.projects.find(project => project.repositoryId === repositoryId);
    requireValue(offer && offer.policyRevision === expectedRevision, 'REGISTRY_SELECTION_CHANGED', 'Refresh the peer project and review its current policy revision before selecting a local clone.', 3); return offer;
  }
  view(): ObjectValue[] {
    const locals = this.repos.all();
    return this.store.db.prepare("SELECT key,body FROM records WHERE namespace='peerProjectCatalog' ORDER BY key").all().flatMap(row => {
      const received = JSON.parse(String(row['body'])) as ReceivedCatalog, hostId = String(row['key']);
      return [...received.catalog.projects.map(project => ({ project, removed: false })), ...received.removed.map(project => ({ project, removed: true }))].map(({ project, removed }) => {
        const local = locals.find(repo => repo.id === project.repositoryId);
        return { ...project, hostId, observedAt: received.observedAt, generation: received.catalog.generation,
          state: removed ? 'removed_on_peer' : !local ? 'checkout_required' : local.revision === project.policyRevision ? 'mapped' : 'configuration_conflict',
          localPath: local?.path ?? null, localPolicyRevision: local?.revision ?? null,
          authority: 'reported_only', setupPerformed: false };
      });
    });
  }
}
