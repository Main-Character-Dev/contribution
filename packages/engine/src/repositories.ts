import { existsSync, readFileSync, writeFileSync, mkdirSync, realpathSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { assertContract } from '@contribution/contracts';
import type { Repository } from '@contribution/contracts';
import { Journal } from './journal.js';
import { digest, id, now, requireValue } from './core.js';
import type { ObjectValue } from './core.js';
import { git, gitText, identity } from './git.js';

export interface Enrolled {
  id: string; path: string; commonDir: string; config: Repository; revision: string; canonicalHostId: string;
  availability: 'this-mac' | 'both-macs'; policySource: 'generated' | 'tracked'; hookPath: string | null;
}
export class Repositories {
  constructor(readonly store: Journal) {}
  all(): Enrolled[] { return this.store.db.prepare('SELECT body FROM repositories').all().map(row => JSON.parse(String(row['body'])) as Enrolled); }
  save(repo: Enrolled): void { this.store.db.prepare('INSERT INTO repositories VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET common_dir=excluded.common_dir,body=excluded.body').run(repo.id, repo.commonDir, JSON.stringify(repo)); }
  async get(selector: string): Promise<Enrolled> {
    const direct = this.all().find(repo => repo.id === selector); if (direct) return direct;
    let common: string | undefined;
    try { common = (await identity(selector)).commonDir; } catch { /* no implicit nearby repository */ }
    const matching = this.all().filter(repo => repo.commonDir === common);
    requireValue(matching.length === 1, 'REPOSITORY_NOT_ENROLLED', 'Supply one enrolled repository ID or checkout path.', 2); return matching[0]!;
  }
  async add(path: string, profile: 'local-development' | 'standard' = 'local-development', availability: 'this-mac' | 'both-macs' = 'this-mac'): Promise<Enrolled> {
    const info = await identity(path); const existing = this.all().find(repo => repo.commonDir === info.commonDir);
    if (existing) {
      requireValue(existing.availability === availability, 'AUTHORITY_TRANSITION_REQUIRED', 'Re-enrollment cannot change canonical ownership.'); return existing;
    }
    requireValue(availability === 'this-mac', 'PAIRING_REQUIRED', 'Pair and reconcile the canonical host before enabling both-macs availability.', 3);
    const file = join(info.path, 'contribution.json'); let config: Repository;
    const hook = await gitText(path, ['rev-parse', '--path-format=absolute', '--git-path', 'hooks/pre-push']);
    const hooksConfig = await git(path, ['config', '--get', 'core.hooksPath']);
    const hookPath = hooksConfig.code === 0 ? hooksConfig.stdout.trim() : existsSync(hook) ? hook : null;
    if (existsSync(file)) { config = JSON.parse(readFileSync(file, 'utf8')) as Repository; assertContract('repository', config); }
    else {
      requireValue(info.branch, 'DETACHED_PRIMARY', 'Enrollment needs a configured primary branch. Task worktrees may remain detached.', 2);
      config = { schemaVersion: 1, repositoryId: id(), name: basename(info.path), integration: { branch: info.branch, adapter: hookPath ? 'migration-required' : 'generic-v1' },
        publication: { remote: null, branch: null, pullRequestBase: null, mode: 'explicit' },
        validation: { profile, gate: hookPath ? 'enabled' : 'inactive', adapter: hookPath ? 'migration-required' : 'generic-v1', builtins: [], checks: [] },
        runtime: { node: 'repository', packageManager: 'repository' } };
    }
    requireValue(!this.all().some(repo => repo.id === config.repositoryId), 'CLONE_IDENTITY_CONFLICT', 'This logical repository already has a different local clone. Reconcile its mapping explicitly.');
    const repo: Enrolled = { id: config.repositoryId, path: info.path, commonDir: info.commonDir, config, revision: digest(config),
      canonicalHostId: this.store.hostId, availability, policySource: existsSync(file) ? 'tracked' : 'generated', hookPath };
    this.save(repo); return repo;
  }
  async create(path: string): Promise<Enrolled> {
    requireValue(!existsSync(path) || readdirSync(path).length === 0, 'DESTINATION_NOT_EMPTY', 'Create needs a new or empty directory.');
    const parent = existsSync(path) ? path : join(path, '..');
    for (const key of ['user.name', 'user.email']) requireValue((await git(parent, ['config', '--get', key])).code === 0, 'GIT_IDENTITY_REQUIRED', 'Configure your Git author identity before creating a repository.', 3);
    mkdirSync(path, { recursive: true }); await gitText(path, ['init', '--initial-branch=dev']); return this.add(path);
  }
  async current(repo: Enrolled): Promise<void> {
    const info = await identity(repo.path);
    requireValue(info.commonDir === repo.commonDir, 'REPOSITORY_IDENTITY_CHANGED', 'The enrolled path now points to a different Git repository.');
    requireValue(info.branch === repo.config.integration.branch, 'ACTIVE_BRANCH_CHANGED', 'The primary checkout is no longer on its configured integration branch.');
    if (repo.policySource === 'tracked') {
      const file = join(repo.path, 'contribution.json');
      requireValue(existsSync(file) && digest(JSON.parse(readFileSync(file, 'utf8'))) === repo.revision, 'POLICY_CHANGED', 'Tracked configuration changed; apply and review it through repos configure.');
    }
  }
  configure(repo: Enrolled, config: Repository, expectedRevision: string): Enrolled {
    assertContract('repository', config);
    requireValue(repo.revision === expectedRevision, 'REVISION_CONFLICT', 'Configuration changed since it was read.');
    requireValue(config.repositoryId === repo.id && config.integration.branch === repo.config.integration.branch && config.integration.adapter === repo.config.integration.adapter,
      'AUTHORITY_TRANSITION_REQUIRED', 'Identity, branch and adapter changes require an explicit reconciled migration.');
    requireValue(!this.store.unsettled().some(op => op.repositoryId === repo.id), 'REPOSITORY_BUSY', 'Reconcile queued or uncertain operations before changing effective policy.');
    const updated = { ...repo, config, revision: digest(config) };
    if (repo.policySource === 'tracked') {
      requireValue(digest(JSON.parse(readFileSync(join(repo.path, 'contribution.json'), 'utf8'))) === repo.revision, 'POLICY_CHANGED', 'Resolve concurrent tracked configuration changes before applying.');
      writeFileSync(join(repo.path, 'contribution.json'), JSON.stringify(config, null, 2) + '\n');
    }
    this.save(updated); return updated;
  }
  async relocate(repo: Enrolled, path: string): Promise<Enrolled> {
    const info = await identity(path);
    requireValue(info.commonDir === repo.commonDir || (!existsSync(repo.path) && existsSync(join(info.path, 'contribution.json')) && JSON.parse(readFileSync(join(info.path, 'contribution.json'), 'utf8')).repositoryId === repo.id),
      'REPOSITORY_IDENTITY_CHANGED', 'Relocation could not establish the enrolled repository identity.');
    const updated = { ...repo, path: realpathSync(path), commonDir: info.commonDir }; this.save(updated); return updated;
  }
  async status(repo: Enrolled, refresh: boolean): Promise<ObjectValue> {
    if (!refresh) {
      const cached = this.store.record<ObjectValue>('status', repo.id);
      if (cached) return { ...cached, publication: { ...(cached['publication'] as ObjectValue), freshness: 'stale' } };
    }
    const info = await identity(repo.path); const { remote, branch } = repo.config.publication;
    let remoteTip: string | null = null, relation = 'unconfigured', action = 'configure', observedAt: string | null = null;
    let ahead: number | null = null, behind: number | null = null, blockedReason: string | null = null;
    if (remote && branch && info.tip) {
      if (!refresh) { relation = 'unknown'; action = 'refresh'; }
      else {
        const destinations = (await gitText(repo.path, ['remote', 'get-url', '--push', '--all', remote])).split('\n');
        requireValue(destinations.length === 1, 'UNSUPPORTED_DESTINATION', 'Publication status requires one push destination.', 3);
        const result = await git(repo.path, ['ls-remote', '--exit-code', destinations[0]!, `refs/heads/${branch}`], { timeoutMs: 15000 });
        observedAt = now();
        if (result.code === 2) { relation = 'unpublished'; action = 'publish'; }
        else if (result.code !== 0 || !/^[a-f0-9]{40,64}\trefs\/heads\//.test(result.stdout)) { relation = 'unknown'; action = 'refresh'; blockedReason = 'REMOTE_OBSERVATION_FAILED'; }
        else {
          remoteTip = result.stdout.split('\t')[0]!;
          if (remoteTip === info.tip) { relation = 'equal'; action = 'none'; ahead = 0; behind = 0; }
          else {
            const counts = await git(repo.path, ['rev-list', '--left-right', '--count', `${info.tip}...${remoteTip}`]);
            if (counts.code === 0) {
              [ahead, behind] = counts.stdout.trim().split(/\s+/).map(Number) as [number, number];
              relation = ahead > 0 && behind > 0 ? 'diverged' : ahead > 0 ? 'ahead' : 'behind'; action = relation === 'ahead' ? 'push' : 'reconcile';
            } else { relation = 'unknown'; action = 'refresh'; blockedReason = 'REMOTE_HISTORY_UNAVAILABLE'; }
          }
        }
      }
    }
    const unsettled = this.store.unsettled().filter(op => op.repositoryId === repo.id);
    const result = { repositoryId: repo.id, canonicalHostId: repo.canonicalHostId, canonicalBranch: repo.config.integration.branch,
      canonicalTip: info.tip, publication: { remote, branch, remoteTip, relation, ahead, behind, observedAt,
        freshness: observedAt ? 'fresh' : 'unknown', action, enabled: !blockedReason && repo.canonicalHostId === this.store.hostId, blockedReason },
      pending: { localSubmissions: unsettled.filter(op => op.state === 'queued_local').length, landingJobs: unsettled.filter(op => op.kind === 'submit').length,
        dirtyWorktrees: (await gitText(repo.path, ['status', '--porcelain=v1'])).length ? 1 : 0 } };
    this.store.put('status', repo.id, result); return result;
  }
}
