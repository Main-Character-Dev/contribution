import { existsSync, readFileSync, writeFileSync, mkdirSync, realpathSync, readdirSync, lstatSync, openSync, closeSync, fsyncSync, renameSync } from 'node:fs';
import { basename, join, resolve, dirname } from 'node:path';
import { assertContract } from '@contribution/contracts';
import type { Repository } from '@contribution/contracts';
import { identifyAdoption } from '@contribution/adapters';
import { Journal } from './journal.js';
import { digest, id, now, requireValue } from './core.js';
import type { ObjectValue } from './core.js';
import { git, gitText, identity } from './git.js';

export interface Enrolled {
  id: string; path: string; commonDir: string; config: Repository; revision: string; canonicalHostId: string;
  availability: 'this-mac' | 'both-macs'; policySource: 'generated' | 'tracked'; hookPath: string | null;
}
interface ConfigurationIntent { requestId: string; identity: string; previous: Enrolled; updated: Enrolled; state: 'prepared' | 'completed' }
interface CreationIntent { requestId: string; requestedPath: string; path: string; directory?: { dev: number; ino: number }; repository?: Enrolled }
export class Repositories {
  private readonly creating = new Map<string, Promise<Enrolled>>();
  constructor(readonly store: Journal) {
    for (const intent of store.records<ConfigurationIntent>('configurationIntent').filter(record => record.state === 'prepared')) {
      try { this.finishConfiguration(intent); } catch { /* Preserve the approved intent and block dependent writers until the same request can reconcile it. */ }
    }
  }
  all(): Enrolled[] { return this.store.db.prepare('SELECT body FROM repositories').all().map(row => JSON.parse(String(row['body'])) as Enrolled); }
  save(repo: Enrolled): void { this.store.db.prepare('INSERT INTO repositories VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET common_dir=excluded.common_dir,body=excluded.body').run(repo.id, repo.commonDir, JSON.stringify(repo)); }
  async get(selector: string): Promise<Enrolled> {
    const direct = this.all().find(repo => repo.id === selector); if (direct) return direct;
    let common: string | undefined;
    try { common = (await identity(selector)).commonDir; } catch { /* no implicit nearby repository */ }
    const matching = this.all().filter(repo => repo.commonDir === common);
    requireValue(matching.length === 1, 'REPOSITORY_NOT_ENROLLED', 'Supply one enrolled repository ID or checkout path.', 2); return matching[0]!;
  }
  async add(path: string, profile: 'local-development' | 'standard' = 'local-development', availability: 'this-mac' | 'both-macs' = 'this-mac', supplied?: Repository, expected?: { repositoryId: string; revision: string }): Promise<Enrolled> {
    const info = await identity(path); const existing = this.all().find(repo => repo.commonDir === info.commonDir);
    if (existing) {
      requireValue(!expected || (existing.id === expected.repositoryId && existing.revision === expected.revision), 'REGISTRY_MAPPING_CONFLICT', 'The selected enrolled clone belongs to another project or configuration revision.');
      if (expected) await this.current(existing);
      requireValue(existing.availability === availability, 'AUTHORITY_TRANSITION_REQUIRED', 'Re-enrollment cannot change canonical ownership.'); return existing;
    }
    requireValue(availability === 'this-mac', 'PAIRING_REQUIRED', 'Pair and reconcile the canonical host before enabling both-macs availability.', 3);
    const file = join(info.path, 'contribution.json'); let config: Repository;
    const hook = await gitText(path, ['rev-parse', '--path-format=absolute', '--git-path', 'hooks/pre-push']);
    const hooksConfig = await git(path, ['config', '--get', 'core.hooksPath']);
    const hookPath = hooksConfig.code === 0 ? hooksConfig.stdout.trim() : existsSync(hook) ? hook : null;
    if (supplied) { assertContract('repository', supplied); config = supplied;
      requireValue(!existsSync(file) || digest(JSON.parse(readFileSync(file, 'utf8'))) === digest(config), 'POLICY_CHANGED', 'The supplied enrollment policy conflicts with the existing file.'); }
    else if (existsSync(file)) { config = JSON.parse(readFileSync(file, 'utf8')) as Repository; assertContract('repository', config); }
    else {
      requireValue(info.branch, 'DETACHED_PRIMARY', 'Enrollment needs a configured primary branch. Task worktrees may remain detached.', 2);
      const adopted = identifyAdoption(info.path);
      config = { schemaVersion: 1, repositoryId: id(), name: basename(info.path), integration: { branch: info.branch, adapter: hookPath || adopted ? 'migration-required' : 'generic-v1' },
        publication: { remote: null, branch: null, pullRequestBase: null, mode: 'explicit' },
        validation: { profile, gate: adopted?.gate ?? (hookPath ? 'enabled' : 'inactive'), adapter: hookPath || adopted ? 'migration-required' : 'generic-v1', builtins: [], checks: [] },
        runtime: { node: 'repository', packageManager: 'repository' } };
    }
    requireValue(!expected || (config.repositoryId === expected.repositoryId && digest(config) === expected.revision), 'REGISTRY_MAPPING_CONFLICT', 'Select a clone with the matching reviewed contribution.json identity and configuration. No project was enrolled.');
    requireValue(!expected || info.branch === config.integration.branch, 'ACTIVE_BRANCH_CHANGED', 'Select the local checkout on the project’s configured integration branch.');
    requireValue(!this.all().some(repo => repo.id === config.repositoryId), 'CLONE_IDENTITY_CONFLICT', 'This logical repository already has a different local clone. Reconcile its mapping explicitly.');
    const repo: Enrolled = { id: config.repositoryId, path: info.path, commonDir: info.commonDir, config, revision: digest(config),
      canonicalHostId: this.store.hostId, availability, policySource: existsSync(file) ? 'tracked' : 'generated', hookPath };
    this.save(repo); return repo;
  }
  async create(inputPath: string, requestId: string): Promise<Enrolled> {
    const absolute = resolve(inputPath);
    let intent = this.store.record<CreationIntent>('creationIntent', requestId);
    if (intent) requireValue(intent.requestedPath === absolute, 'REQUEST_ID_CONFLICT', 'This creation request already identifies a different destination.');
    else {
      const path = join(realpathSync(dirname(absolute)), basename(absolute));
      requireValue(!this.store.db.prepare('SELECT id FROM operations WHERE request_id=?').get(requestId), 'REQUEST_ID_CONFLICT', 'This request already identifies another operation.');
      requireValue(!this.store.records<CreationIntent>('creationIntent').some(value => value.path === path), 'CREATION_ALREADY_PENDING', 'Retry the original creation request for this destination.');
      requireValue(!existsSync(path) || (lstatSync(path).isDirectory() && !lstatSync(path).isSymbolicLink() && readdirSync(path).length === 0), 'DESTINATION_NOT_EMPTY', 'Create needs a new or empty regular directory.');
      intent = { requestId, requestedPath: absolute, path }; this.store.put('creationIntent', requestId, intent);
    }
    const current = this.creating.get(requestId); if (current) return current;
    const pending = this.finishCreation(intent); this.creating.set(requestId, pending);
    try { return await pending; } finally { this.creating.delete(requestId); }
  }
  private async finishCreation(intent: CreationIntent): Promise<Enrolled> {
    if (intent.repository) return intent.repository;
    const { path } = intent;
    for (const key of ['user.name', 'user.email']) requireValue((await git(dirname(path), ['config', '--get', key])).code === 0, 'GIT_IDENTITY_REQUIRED', 'Configure your Git author identity before creating a repository.', 3);
    if (!intent.directory) {
      if (!existsSync(path)) mkdirSync(path);
      const info = lstatSync(path);
      requireValue(info.isDirectory() && !info.isSymbolicLink() && readdirSync(path).length === 0, 'DESTINATION_CHANGED', 'The requested empty destination changed; preserve it for reconciliation.');
      intent.directory = { dev: info.dev, ino: info.ino }; this.store.put('creationIntent', intent.requestId, intent);
    }
    const info = lstatSync(path);
    requireValue(info.isDirectory() && !info.isSymbolicLink() && info.dev === intent.directory.dev && info.ino === intent.directory.ino,
      'DESTINATION_CHANGED', 'The retained creation directory was replaced; preserve its current contents.');
    requireValue(readdirSync(path).every(name => name === '.git'), 'DESTINATION_CHANGED', 'Unrelated contents appeared before creation completed; preserve them for review.');
    const gitDirectory = join(path, '.git'), marker = join(gitDirectory, 'contribution-creation.json');
    const content = JSON.stringify({ schemaVersion: 1, requestId: intent.requestId, path }) + '\n';
    if (!existsSync(gitDirectory)) {
      mkdirSync(gitDirectory, { mode: 0o700 }); writeFileSync(marker, content, { mode: 0o600, flag: 'wx' });
      for (const entry of [marker, gitDirectory, path]) { const fd = openSync(entry, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } }
    }
    requireValue(lstatSync(gitDirectory).isDirectory() && !lstatSync(gitDirectory).isSymbolicLink() && existsSync(marker) && lstatSync(marker).isFile() && !lstatSync(marker).isSymbolicLink() && readFileSync(marker, 'utf8') === content,
      'CREATION_OWNERSHIP_UNCONFIRMED', 'The partial Git directory has no matching creation receipt; preserve it for explicit reconciliation.');
    if (existsSync(join(gitDirectory, 'HEAD'))) {
      const before = await identity(path);
      requireValue(!before.tip && before.branch === 'dev' && before.commonDir === realpathSync(gitDirectory), 'CREATION_HISTORY_CHANGED', 'The partial repository gained different history or ownership; do not initialize it again.');
    }
    await gitText(path, ['init', '--initial-branch=dev']);
    const repo = await this.add(path); intent.repository = repo; this.store.put('creationIntent', intent.requestId, intent); return repo;
  }
  private migrationReady(repo: Enrolled): void {
    requireValue(!this.store.records<{ repositoryId: string; phase: string }>('adoptionPlan').some(plan => plan.repositoryId === repo.id && ['applying', 'applied', 'rolling_back'].includes(plan.phase)), 'MIGRATION_RECONCILIATION_REQUIRED', 'Finish or roll back the retained adoption before repository work or configuration changes.', 3);
  }
  async current(repo: Enrolled): Promise<void> {
    this.migrationReady(repo);
    requireValue(!this.store.records<ConfigurationIntent>('configurationIntent').some(intent => intent.previous.id === repo.id && intent.state === 'prepared'), 'CONFIGURATION_RECONCILIATION_REQUIRED', 'A retained policy change needs reconciliation before another writer can run.', 3);
    const info = await identity(repo.path);
    requireValue(info.commonDir === repo.commonDir, 'REPOSITORY_IDENTITY_CHANGED', 'The enrolled path now points to a different Git repository.');
    requireValue(info.branch === repo.config.integration.branch, 'ACTIVE_BRANCH_CHANGED', 'The primary checkout is no longer on its configured integration branch.');
    if (repo.policySource === 'tracked') {
      const file = join(repo.path, 'contribution.json');
      requireValue(existsSync(file) && digest(JSON.parse(readFileSync(file, 'utf8'))) === repo.revision, 'POLICY_CHANGED', 'Tracked configuration changed; apply and review it through repos configure.');
    }
  }
  configure(repo: Enrolled, config: Repository, expectedRevision: string, requestId: string): Enrolled {
    this.migrationReady(repo); assertContract('repository', config);
    const requestIdentity = digest({ repo: repo.id, config, expectedRevision });
    const retained = this.store.record<ConfigurationIntent>('configurationIntent', requestId);
    if (retained) { requireValue(retained.identity === requestIdentity, 'REQUEST_ID_CONFLICT', 'Configuration request identity already has different content.'); return retained.state === 'completed' ? retained.updated : this.finishConfiguration(retained); }
    requireValue(!this.store.records<ConfigurationIntent>('configurationIntent').some(intent => intent.previous.id === repo.id && intent.state === 'prepared'), 'CONFIGURATION_RECONCILIATION_REQUIRED', 'Reconcile the earlier approved policy change first.', 3);
    requireValue(repo.revision === expectedRevision, 'REVISION_CONFLICT', 'Configuration changed since it was read.');
    requireValue(config.repositoryId === repo.id && config.integration.branch === repo.config.integration.branch && config.integration.adapter === repo.config.integration.adapter,
      'AUTHORITY_TRANSITION_REQUIRED', 'Identity, branch and adapter changes require an explicit reconciled migration.');
    requireValue(!this.store.unsettled().some(op => op.repositoryId === repo.id), 'REPOSITORY_BUSY', 'Reconcile queued or uncertain operations before changing effective policy.');
    const updated = { ...repo, config, revision: digest(config) };
    const intent: ConfigurationIntent = { requestId, identity: requestIdentity, previous: repo, updated, state: 'prepared' };
    if (repo.policySource === 'tracked') requireValue(digest(JSON.parse(readFileSync(join(repo.path, 'contribution.json'), 'utf8'))) === repo.revision, 'POLICY_CHANGED', 'Resolve concurrent tracked configuration changes before applying.');
    this.store.put('configurationIntent', requestId, intent); return this.finishConfiguration(intent);
  }
  private finishConfiguration(intent: ConfigurationIntent): Enrolled {
    const { previous, updated } = intent;
    if (previous.policySource === 'tracked') {
      const path = join(previous.path, 'contribution.json'), info = lstatSync(path);
      requireValue(info.isFile() && !info.isSymbolicLink(), 'POLICY_PATH_CHANGED', 'The tracked policy is no longer a regular file.');
      const current = digest(JSON.parse(readFileSync(path, 'utf8')));
      requireValue(current === previous.revision || current === updated.revision, 'POLICY_CHANGED', 'Concurrent policy changes are preserved; reconcile the retained configuration intent.');
      if (current !== updated.revision) {
        const temporary = join(previous.path, `.contribution-config-${digest(intent.requestId)}.tmp`), content = JSON.stringify(updated.config, null, 2) + '\n';
        if (existsSync(temporary)) requireValue(lstatSync(temporary).isFile() && !lstatSync(temporary).isSymbolicLink() && readFileSync(temporary, 'utf8') === content, 'CONFIGURATION_TEMP_CONFLICT', 'Preserve the conflicting policy temporary file for reconciliation.');
        else writeFileSync(temporary, content, { flag: 'wx', mode: info.mode & 0o777 });
        const fd = openSync(temporary, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); }
        requireValue(digest(JSON.parse(readFileSync(path, 'utf8'))) === previous.revision, 'POLICY_CHANGED', 'Policy changed before atomic replacement.');
        renameSync(temporary, path);
        const parent = openSync(previous.path, 'r'); try { fsyncSync(parent); } finally { closeSync(parent); }
      }
    }
    this.store.transaction(() => { this.save(updated); this.store.put('configurationIntent', intent.requestId, { ...intent, state: 'completed' });
      this.store.put('configurationRequests', intent.requestId, { digest: intent.identity, result: { repository: updated } }); }); return updated;
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
    const selected = await git(repo.path, ['rev-parse', '--verify', `refs/heads/${repo.config.integration.branch}`]);
    const canonicalTip = selected.code === 0 ? selected.stdout.trim() : null;
    const branchChanged = info.branch !== repo.config.integration.branch;
    let remoteTip: string | null = null, relation = 'unconfigured', action = 'configure', observedAt: string | null = null;
    let ahead: number | null = null, behind: number | null = null, blockedReason: string | null = null;
    if (remote && branch && canonicalTip) {
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
          if (remoteTip === canonicalTip) { relation = 'equal'; action = 'none'; ahead = 0; behind = 0; }
          else {
            const counts = await git(repo.path, ['rev-list', '--left-right', '--count', `${canonicalTip}...${remoteTip}`]);
            if (counts.code === 0) {
              [ahead, behind] = counts.stdout.trim().split(/\s+/).map(Number) as [number, number];
              relation = ahead > 0 && behind > 0 ? 'diverged' : ahead > 0 ? 'ahead' : 'behind'; action = relation === 'ahead' ? 'push' : 'reconcile';
            } else { relation = 'unknown'; action = 'refresh'; blockedReason = 'REMOTE_HISTORY_UNAVAILABLE'; }
          }
        }
      }
    }
    if (branchChanged) { blockedReason = 'ACTIVE_BRANCH_CHANGED'; action = 'reconcile'; }
    const unsettled = this.store.unsettled().filter(op => op.repositoryId === repo.id);
    const result = { repositoryId: repo.id, canonicalHostId: repo.canonicalHostId, canonicalBranch: repo.config.integration.branch,
      canonicalTip, checkout: { branch: info.branch, tip: info.tip, matchesCanonicalBranch: !branchChanged }, publication: { remote, branch, remoteTip, relation, ahead, behind, observedAt,
        freshness: observedAt ? 'fresh' : 'unknown', action, enabled: !blockedReason && repo.canonicalHostId === this.store.hostId, blockedReason },
      pending: { localSubmissions: unsettled.filter(op => op.state === 'queued_local').length, landingJobs: unsettled.filter(op => op.kind === 'submit').length,
        dirtyWorktrees: (await gitText(repo.path, ['status', '--porcelain=v1'])).length ? 1 : 0 } };
    this.store.put('status', repo.id, result); return result;
  }
}
