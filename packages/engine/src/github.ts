import { Fault, now, object, requireValue, redact, digest } from './core.js';
import type { ObjectValue } from './core.js';
import { executable, run } from './process.js';
import { gitText } from './git.js';
import type { Journal } from './journal.js';
import type { Enrolled } from './repositories.js';

export interface APIReply { status: number; headers: Record<string, string>; body: unknown }
export type APITransport = (path: string, query?: ObjectValue) => Promise<APIReply>;
export interface Observation { observedAt: string; freshness: 'fresh' | 'stale'; readiness: string; reasonCodes: string[];
  pullRequest: ObjectValue | null; checks: ObjectValue[]; workflows: ObjectValue[]; retryAt: string | null; lastKnown?: Observation; selection?: string }
export const githubSelection = (repo: Enrolled): string => digest({ id: repo.id, path: repo.path, revision: repo.revision, publication: repo.config.publication });
function staleSelection(previous: Observation | undefined): Observation {
  const result: Observation = { observedAt: now(), freshness: 'stale', readiness: 'unknown', reasonCodes: ['GITHUB_SELECTION_CHANGED'], pullRequest: null, checks: [], workflows: [], retryAt: null };
  if (previous) { const { lastKnown: _history, ...lastKnown } = previous.freshness === 'fresh' ? previous : previous.lastKnown ?? previous; result.lastKnown = lastKnown; }
  return result;
}
export function apiFailure(reply: APIReply, time = Date.now()): Fault | null {
  if (reply.status >= 200 && reply.status < 300) return null;
  const retry = reply.headers['retry-after'], reset = reply.headers['x-ratelimit-reset'];
  const limited = reply.status === 429 || reply.status === 403 && (retry !== undefined || reply.headers['x-ratelimit-remaining'] === '0' ||
    (typeof reply.body === 'object' && reply.body !== null && /secondary rate limit/i.test(String((reply.body as ObjectValue)['message']))));
  let delay = 60000;
  if (retry) delay = Number.isFinite(Number(retry)) ? Number(retry) * 1000 : Date.parse(retry) - time;
  if (reset && reply.headers['x-ratelimit-remaining'] === '0') delay = Math.max(delay, Number(reset) * 1000 - time);
  const retryAt = new Date(time + Math.max(1000, Math.min(86400000, Number.isFinite(delay) ? delay : 60000))).toISOString();
  const code = limited ? 'GITHUB_RATE_LIMITED' : reply.status === 401 ? 'GITHUB_AUTH_REQUIRED' : reply.status === 403 ? 'GITHUB_PERMISSION_DENIED' :
    reply.status === 404 ? 'GITHUB_NOT_FOUND_OR_INACCESSIBLE' : reply.status >= 500 ? 'GITHUB_API_UNAVAILABLE' : 'GITHUB_API_ERROR';
  return new Fault(code, limited ? 'GitHub requested a polling pause.' : 'GitHub could not provide an authoritative observation.', 3,
    { status: reply.status, retryAt: limited ? retryAt : null }, limited || reply.status >= 500);
}
export function githubRepository(url: string): { owner: string; name: string } | null {
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(url);
  return match ? { owner: match[1]!, name: match[2]! } : null;
}
export function transport(): APITransport {
  return async (path, query) => {
    requireValue(path.startsWith('/') && !path.startsWith('//'), 'GITHUB_API_ERROR', 'Invalid GitHub API path.', 2);
    const auth = await run(executable('gh'), ['auth', 'token', '--hostname', 'github.com'], { timeoutMs: 5000, maxBytes: 8192, env: { GH_PROMPT_DISABLED: '1' } });
    requireValue(auth.code === 0 && auth.stdout.trim(), 'GITHUB_AUTH_REQUIRED', 'Authenticate GitHub CLI for this user session.', 3);
    let response: globalThis.Response;
    try { response = await fetch(`https://api.github.com${path}`, { method: query ? 'POST' : 'GET', redirect: 'manual', signal: AbortSignal.timeout(12000),
      headers: { Authorization: `Bearer ${auth.stdout.trim()}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Contribution', ...(query ? { 'Content-Type': 'application/json' } : {}) },
      ...(query ? { body: JSON.stringify(query) } : {}) }); }
    catch { throw new Fault('GITHUB_TRANSPORT_ERROR', 'GitHub transport timed out or disconnected. Last-known evidence remains stale.', 3, {}, true); }
    if (response.status === 302 && /^\/repos\/[^/]+\/[^/]+\/actions\/jobs\/\d+\/logs$/.test(path)) return { status: 302, headers: Object.fromEntries(response.headers), body: null };
    const chunks: Uint8Array[] = []; let size = 0;
    if (response.body) for await (const chunk of response.body) { size += chunk.length; requireValue(size <= 2 * 1024 * 1024, 'GITHUB_RESPONSE_TOO_LARGE', 'GitHub response exceeded the bounded observation budget.', 3); chunks.push(chunk); }
    let body: unknown;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {
      if (!response.ok) body = null;
      else throw new Fault('GITHUB_MALFORMED_RESPONSE', 'GitHub returned non-JSON observation data.', 3);
    }
    return { status: response.status, headers: Object.fromEntries(response.headers), body };
  };
}
async function checked(api: APITransport, path: string, query?: ObjectValue): Promise<APIReply> {
  const response = await api(path, query), failure = apiFailure(response); if (failure) throw failure; return response;
}
async function list(api: APITransport, path: string, key?: string): Promise<ObjectValue[]> {
  const values: ObjectValue[] = [];
  for (let page = 1; page <= 5; page++) {
    const response = await checked(api, `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    const items = key ? object(response.body)[key] : response.body;
    requireValue(Array.isArray(items) && items.every(item => item !== null && typeof item === 'object'), 'GITHUB_MALFORMED_RESPONSE', 'GitHub list shape changed; it cannot be treated as an empty successful observation.', 3);
    values.push(...items as ObjectValue[]);
    if (!response.headers['link']?.includes('rel="next"')) return values;
  }
  throw new Fault('GITHUB_OBSERVATION_INCOMPLETE', 'GitHub pagination exceeded this bounded observation. Readiness remains unknown.', 3);
}
export function readiness(pr: ObjectValue, checks: ObjectValue[], rules: ObjectValue[]): { readiness: string; reasonCodes: string[] } {
  if (pr['state'] !== 'OPEN') return { readiness: pr['state'] === 'MERGED' ? 'merged' : pr['state'] === 'CLOSED' ? 'closed' : 'unknown', reasonCodes: [] };
  if (pr['isDraft'] === true) return { readiness: 'draft', reasonCodes: ['PR_DRAFT'] };
  if (pr['mergeable'] === 'CONFLICTING') return { readiness: 'blocked', reasonCodes: ['MERGE_CONFLICT'] };
  // GitHub selects the test merge commit when it has reported status; never
  // choose whichever SHA happens to have the newest passing check ID.
  const selectedHead = pr['testMergeOid'] && checks.some(check => check['head_sha'] === pr['testMergeOid']) ? pr['testMergeOid'] : pr['headRefOid'];
  const reasons: string[] = [];
  requireValue(rules.every(rule => typeof rule['type'] === 'string' && /^[a-z][a-z0-9_]+$/.test(rule['type'])), 'GITHUB_RULES_UNKNOWN', 'A repository rule has no readable type.', 3);
  for (const rule of rules.filter(rule => rule['type'] === 'required_status_checks')) {
    const parameters = object(rule['parameters']), required = parameters['required_status_checks'];
    requireValue(Array.isArray(required), 'GITHUB_RULES_UNKNOWN', 'Required checks are not readable.', 3);
    for (const item of required) {
      const requirement = object(item), context = requirement['context'];
      requireValue(typeof context === 'string' && context.length > 0, 'GITHUB_RULES_UNKNOWN', 'A required check identity is missing.', 3);
      const integration = requirement['integration_id'];
      requireValue(integration === undefined || integration === null || Number.isSafeInteger(integration) && Number(integration) > 0,
        'GITHUB_RULES_UNKNOWN', 'A required check has an unreadable integration identity.', 3);
      const matching = checks.filter(check => check['name'] === context && selectedHead === check['head_sha']);
      const kinds = [...new Set(matching.map(check => check['kind'] ?? 'check_run'))];
      let passed = kinds.length > 0;
      for (const kind of kinds) {
        const current = matching.filter(check => (check['kind'] ?? 'check_run') === kind &&
          (integration === undefined || integration === null || object(check['app'] ?? {})['id'] === integration))
          .sort((a, b) => Number(b['id']) - Number(a['id']))[0];
        if (!current || current['status'] !== 'completed' || !(kind === 'commit_status' ? ['success'] : ['success', 'neutral', 'skipped']).includes(String(current['conclusion']))) passed = false;
      }
      if (!passed) reasons.push(`REQUIRED_CHECK:${context}`);
    }
  }
  if (pr['reviewDecision'] === 'CHANGES_REQUESTED' || pr['reviewDecision'] === 'REVIEW_REQUIRED') reasons.push(String(pr['reviewDecision']));
  if (reasons.length) return { readiness: 'blocked', reasonCodes: reasons };
  // GitHub's own merge-state computation includes classic protection and rules
  // not fully represented in a check rollup. Anything short of CLEAN is not ready.
  if (pr['mergeable'] !== 'MERGEABLE' || pr['mergeStateStatus'] !== 'CLEAN') return { readiness: 'unknown', reasonCodes: ['MERGE_RULES_NOT_CONFIRMED'] };
  return { readiness: 'ready', reasonCodes: [] };
}
const pullRequestQuery = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){number url title state isDraft headRefOid baseRefName baseRefOid mergeable mergeStateStatus reviewDecision potentialMergeCommit{oid} baseRef{branchProtectionRule{requiresStatusChecks requiredStatusChecks{context app{databaseId}}}}}}}`;
async function pullRequest(api: APITransport, owner: string, name: string, number: number): Promise<ObjectValue> {
  const response = await checked(api, '/graphql', { query: pullRequestQuery, variables: { owner, name, number } });
  const body = object(response.body); requireValue(!body['errors'], 'GITHUB_RULES_UNKNOWN', 'GitHub could not resolve current PR rules.', 3);
  const pr = object(object(object(body['data'])['repository'])['pullRequest']);
  requireValue(pr['number'] === number && typeof pr['headRefOid'] === 'string' && /^[a-f0-9]{40}$/.test(pr['headRefOid']) &&
    typeof pr['baseRefOid'] === 'string' && /^[a-f0-9]{40}$/.test(pr['baseRefOid']) && typeof pr['baseRefName'] === 'string' && pr['baseRefName'].length > 0 && typeof pr['isDraft'] === 'boolean',
    'GITHUB_MALFORMED_RESPONSE', 'PR identity or source/base state is incomplete.', 3);
  return pr;
}
function prIdentity(pr: ObjectValue): string {
  return digest(Object.fromEntries(['number', 'state', 'isDraft', 'headRefOid', 'baseRefName', 'baseRefOid', 'potentialMergeCommit', 'mergeable', 'mergeStateStatus', 'reviewDecision', 'baseRef'].map(key => [key, pr[key]])));
}
export async function observe(api: APITransport, owner: string, name: string, branch: string, previous?: Observation): Promise<Observation> {
  const observedAt = now(), prefix = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  try {
    const known = previous?.freshness === 'fresh' ? previous : previous?.lastKnown;
    const since = new Date(known ? Date.parse(known.observedAt) - 15 * 60000 : Date.now() - 7 * 86400000).toISOString();
    const discovered = await list(api, `${prefix}/actions/runs?created=${encodeURIComponent(`>=${since}`)}`, 'workflow_runs');
    // Created-time discovery catches external/scheduled/manual runs. Older
    // active runs also need direct observation until their outcome is known.
    const active = (known?.workflows ?? []).filter(run => run['status'] !== 'completed' && !discovered.some(item => item['id'] === run['id']));
    requireValue(active.length <= 50, 'GITHUB_OBSERVATION_INCOMPLETE', 'Too many older active runs for one bounded polling cycle.', 3);
    for (const run of active) {
      requireValue(Number.isSafeInteger(run['id']), 'GITHUB_MALFORMED_RESPONSE', 'Workflow identity is invalid.', 3);
      discovered.push(object((await checked(api, `${prefix}/actions/runs/${String(run['id'])}`)).body));
    }
    const byID = new Map((known?.workflows ?? []).map(run => [run['id'], run]));
    for (const run of discovered) {
      requireValue(Number.isSafeInteger(run['id']) && Number.isSafeInteger(run['run_attempt']) && typeof run['updated_at'] === 'string' && typeof run['status'] === 'string', 'GITHUB_MALFORMED_RESPONSE', 'Workflow identity, attempt or state is incomplete.', 3);
      const old = byID.get(run['id']);
      if (!old || Number(run['run_attempt']) > Number(old['run_attempt']) || Number(run['run_attempt']) === Number(old['run_attempt']) && String(run['updated_at']) >= String(old['updated_at'])) byID.set(run['id'], run);
    }
    const workflows = [...byID.values()].sort((a, b) => String(b['updated_at']).localeCompare(String(a['updated_at']))).slice(0, 500);
    const prs = await list(api, `${prefix}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`);
    requireValue(prs.length <= 1, 'GITHUB_PR_AMBIGUOUS', 'More than one current PR matches this branch.', 3);
    const selectedPR = prs[0] ?? known?.pullRequest;
    if (!selectedPR) return { observedAt, freshness: 'fresh', readiness: 'no_pull_request', reasonCodes: [], pullRequest: null, checks: [], workflows, retryAt: null };
    const number = Number(selectedPR['number']); requireValue(Number.isSafeInteger(number) && number > 0, 'GITHUB_MALFORMED_RESPONSE', 'PR identity is missing.', 3);
    const pr = await pullRequest(api, owner, name, number);
    if (['CLOSED', 'MERGED'].includes(String(pr['state']))) return { observedAt, freshness: 'fresh', ...readiness(pr, [], []), pullRequest: pr, checks: [], workflows, retryAt: null };
    const merge = pr['potentialMergeCommit'] ? object(pr['potentialMergeCommit'])['oid'] : null;
    requireValue(merge === null || typeof merge === 'string' && /^[a-f0-9]{40}$/.test(merge), 'GITHUB_MALFORMED_RESPONSE', 'The potential merge commit identity is unreadable.', 3);
    const checks: ObjectValue[] = [];
    for (const sha of [...new Set([pr['headRefOid'], merge].filter((value): value is string => typeof value === 'string'))]) {
      const runs = await list(api, `${prefix}/commits/${encodeURIComponent(sha)}/check-runs`, 'check_runs');
      requireValue(runs.every(value => value['head_sha'] === sha && typeof value['name'] === 'string' && Number.isSafeInteger(value['id'])), 'GITHUB_CHECK_IDENTITY_CHANGED', 'Check runs did not match the selected commit.', 3);
      checks.push(...runs.map(value => ({ ...value, kind: 'check_run' })));
      const statuses = await list(api, `${prefix}/commits/${encodeURIComponent(sha)}/statuses`);
      requireValue(statuses.every(value => typeof value['context'] === 'string' && Number.isSafeInteger(value['id']) && ['success', 'failure', 'pending', 'error'].includes(String(value['state']))), 'GITHUB_MALFORMED_RESPONSE', 'Commit status identity or state is incomplete.', 3);
      checks.push(...statuses.map(value => ({ ...value, kind: 'commit_status', head_sha: sha, name: value['context'], status: value['state'] === 'pending' ? 'in_progress' : 'completed', conclusion: value['state'] })));
    }
    const rules = await list(api, `${prefix}/rules/branches/${encodeURIComponent(String(pr['baseRefName']))}`);
    const rulesIdentity = digest(rules);
    const classic = object(pr['baseRef'])['branchProtectionRule'];
    requireValue(classic === null || classic && typeof object(classic)['requiresStatusChecks'] === 'boolean', 'GITHUB_RULES_UNKNOWN', 'Classic branch protection was not observed.', 3);
    if (classic && object(classic)['requiresStatusChecks']) {
      const required = object(classic)['requiredStatusChecks'];
      requireValue(Array.isArray(required), 'GITHUB_RULES_UNKNOWN', 'Classic required check contexts are unavailable.', 3);
      rules.push({ type: 'required_status_checks', parameters: { required_status_checks: required.map(value => {
        const item = object(value), app = item['app'];
        requireValue(app === null || app && Number.isSafeInteger(object(app)['databaseId']) && Number(object(app)['databaseId']) > 0, 'GITHUB_RULES_UNKNOWN', 'A classic required-check app was not fully observed.', 3);
        return { context: item['context'], integration_id: app === null ? null : object(app)['databaseId'] };
      }) } });
    }
    const current = { ...pr, testMergeOid: merge };
    const result = readiness(current, checks, rules);
    if (result.readiness === 'ready') {
      const finalRules = await list(api, `${prefix}/rules/branches/${encodeURIComponent(String(pr['baseRefName']))}`);
      const finalPR = await pullRequest(api, owner, name, number);
      requireValue(digest(finalRules) === rulesIdentity && prIdentity(finalPR) === prIdentity(pr), 'GITHUB_OBSERVATION_CHANGED',
        'The PR head, base, review state or rules changed during observation. Refresh before reporting readiness.', 3);
    }
    return { observedAt: now(), freshness: 'fresh', ...result, pullRequest: current, checks, workflows, retryAt: null };
  } catch (error) {
    const fault = error instanceof Fault ? error : new Fault('GITHUB_MALFORMED_RESPONSE', 'GitHub observation was incomplete.', 3);
    const result: Observation = { observedAt, freshness: 'stale', readiness: 'unknown', reasonCodes: [fault.code], pullRequest: null, checks: [], workflows: [], retryAt: typeof fault.details['retryAt'] === 'string' ? fault.details['retryAt'] : null };
    if (previous) { const { lastKnown: _history, ...lastKnown } = previous.freshness === 'fresh' ? previous : previous.lastKnown ?? previous; result.lastKnown = lastKnown; }
    return result;
  }
}
export async function workflowJobs(api: APITransport, prefix: string, runId: number, attempt: number): Promise<ObjectValue[]> {
  requireValue(Number.isSafeInteger(runId) && runId > 0 && Number.isSafeInteger(attempt) && attempt > 0, 'INVALID_HOSTED_SELECTION', 'Select one retained workflow run and attempt.', 2);
  const jobs = await list(api, `${prefix}/actions/runs/${runId}/attempts/${attempt}/jobs`, 'jobs');
  requireValue(jobs.every(job => Number.isSafeInteger(job['id']) && job['run_id'] === runId && job['run_attempt'] === attempt && typeof job['status'] === 'string'),
    'GITHUB_JOB_IDENTITY_CHANGED', 'GitHub jobs do not match the selected workflow attempt.', 3); return jobs;
}
export type LogDownload = (url: string) => Promise<globalThis.Response>;
export async function workflowLog(api: APITransport, prefix: string, runId: number, attempt: number, jobId: number,
  download: LogDownload = url => fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Accept: 'text/plain' } })): Promise<ObjectValue> {
  const result = { origin: 'github', live: false, runId, attempt, jobId, observedAt: now(), text: null, truncated: false };
  try {
    requireValue(Number.isSafeInteger(jobId) && jobId > 0, 'INVALID_HOSTED_SELECTION', 'Select one workflow job.', 2);
    const jobs = await workflowJobs(api, prefix, runId, attempt), job = jobs.find(value => value['id'] === jobId);
    requireValue(job, 'GITHUB_JOB_IDENTITY_CHANGED', 'The selected job does not belong to this run attempt.', 3);
    if (job['status'] !== 'completed') return { ...result, state: 'not_yet_available', reasonCode: 'GITHUB_JOB_ACTIVE' };
    const redirect = await api(`${prefix}/actions/jobs/${jobId}/logs`);
    if (redirect.status === 410) return { ...result, state: 'expired', reasonCode: 'GITHUB_LOG_EXPIRED' };
    if (redirect.status !== 302) throw apiFailure(redirect) ?? new Fault('GITHUB_LOG_UNAVAILABLE', 'GitHub has not exposed a confirmed log download.', 3);
    let url: URL;
    try { url = new URL(redirect.headers['location'] ?? ''); } catch { throw new Fault('GITHUB_LOG_REDIRECT_INVALID', 'GitHub returned no supported log location.', 3); }
    requireValue(url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      (url.hostname.endsWith('.githubusercontent.com') || url.hostname.endsWith('.blob.core.windows.net')), 'GITHUB_LOG_REDIRECT_INVALID', 'The log location is outside supported GitHub storage.', 3);
    // The signed location is used once and never retained or given the API token.
    const response = await download(url.href);
    if (response.status === 410) return { ...result, state: 'expired', reasonCode: 'GITHUB_LOG_EXPIRED' };
    requireValue(response.ok && response.body, 'GITHUB_LOG_UNAVAILABLE', 'The temporary log download is unavailable; refresh its API location before retrying.', 3);
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0, truncated = false;
    try {
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        const available = 512 * 1024 - bytes;
        chunks.push(chunk.value.subarray(0, available)); bytes += Math.min(available, chunk.value.length);
        if (chunk.value.length >= available) { truncated = true; await reader.cancel(); break; }
      }
    } finally { reader.releaseLock(); }
    return { ...result, state: 'available', text: redact(Buffer.concat(chunks).toString('utf8')), truncated, reasonCode: null };
  } catch (error) {
    const code = error instanceof Fault ? error.code : 'GITHUB_LOG_UNAVAILABLE';
    return { ...result, state: ['GITHUB_AUTH_REQUIRED', 'GITHUB_PERMISSION_DENIED'].includes(code) ? 'denied' : 'unavailable', reasonCode: code };
  }
}
export class GitHubMonitor {
  private running = false;
  private refreshing = new Map<string, Promise<Observation | null>>();
  get busy(): boolean { return this.running || this.refreshing.size > 0; }
  constructor(readonly store: Journal, readonly api = transport()) {}
  private async destination(repo: Enrolled): Promise<{ owner: string; name: string } | null> {
    if (!repo.config.publication.remote) return null;
    const urls = (await gitText(repo.path, ['remote', 'get-url', '--push', '--all', repo.config.publication.remote])).split('\n');
    requireValue(urls.length === 1, 'UNSUPPORTED_DESTINATION', 'GitHub observation needs one publication destination.', 3); return githubRepository(urls[0]!);
  }
  async jobs(repo: Enrolled, runId: number, attempt: number): Promise<ObjectValue> {
    const remote = await this.destination(repo); requireValue(remote, 'GITHUB_DESTINATION_UNCONFIGURED', 'Configure a supported GitHub publication destination.', 3);
    return { origin: 'github', runId, attempt, observedAt: now(), jobs: await workflowJobs(this.api, `/repos/${remote.owner}/${remote.name}`, runId, attempt) };
  }
  async logs(repo: Enrolled, runId: number, attempt: number, jobId: number): Promise<ObjectValue> {
    const remote = await this.destination(repo); requireValue(remote, 'GITHUB_DESTINATION_UNCONFIGURED', 'Configure a supported GitHub publication destination.', 3);
    return workflowLog(this.api, `/repos/${remote.owner}/${remote.name}`, runId, attempt, jobId);
  }
  async refresh(repo: Enrolled): Promise<Observation | null> {
    const scope = githubSelection(repo);
    const running = this.refreshing.get(repo.id);
    if (running) {
      const result = await running;
      if (this.store.record<{ scope: string }>('githubSelection', repo.id)?.scope === scope) return result;
      return this.refresh(repo);
    }
    const work = this.refreshOnce(repo, scope); this.refreshing.set(repo.id, work);
    try { return await work; } finally { if (this.refreshing.get(repo.id) === work) this.refreshing.delete(repo.id); }
  }
  private async refreshOnce(repo: Enrolled, scope: string): Promise<Observation | null> {
    if (!repo.config.publication.remote || !repo.config.publication.branch) return null;
    const remote = await this.destination(repo); if (!remote) return null;
    const cached = this.store.record<Observation>('github', repo.id), selectedDestination = this.store.record<{ destination: string }>('githubSelection', repo.id);
    const previous = cached?.selection === scope && selectedDestination?.destination === digest(remote) ? cached : undefined;
    if (previous?.retryAt && Date.parse(previous.retryAt) > Date.now()) return previous;
    let observation = await observe(this.api, remote.owner, remote.name, repo.config.publication.branch, previous);
    const selected = this.store.db.prepare('SELECT body FROM repositories WHERE id=?').get(repo.id);
    const current = selected ? JSON.parse(String(selected['body'])) as Enrolled : null;
    let sameSelection = false;
    try { sameSelection = Boolean(current && githubSelection(current) === scope && digest(await this.destination(repo)) === digest(remote)); } catch { /* A missing/changed remote is not the observed destination. */ }
    if (!sameSelection) observation = staleSelection(previous);
    observation.selection = scope;
    observation.workflows = observation.workflows.map(current => {
      const old = previous?.workflows.find(item => item['id'] === current['id']);
      return old && (Number(old['run_attempt']) > Number(current['run_attempt']) ||
        Number(old['run_attempt']) === Number(current['run_attempt']) && String(old['updated_at']) > String(current['updated_at'])) ? old : current;
    });
    this.store.transaction(() => { this.store.put('github', repo.id, observation); this.store.put('githubSelection', repo.id, { scope, destination: digest(remote), observedAt: observation.observedAt }); });
    const active = observation.workflows.some(run => run['status'] !== 'completed') || ['blocked', 'unknown'].includes(observation.readiness);
    this.store.put('githubNext', repo.id, { at: observation.retryAt ? Date.parse(observation.retryAt) : Date.now() + (observation.freshness === 'stale' ? 300000 : active ? 30000 : 600000) });
    return observation;
  }
  async cached(repo: Enrolled): Promise<Observation | null> {
    const observation = this.store.record<Observation>('github', repo.id); if (!observation) return null;
    const selection = this.store.record<{ destination: string }>('githubSelection', repo.id);
    let matches = false;
    try { matches = observation.selection === githubSelection(repo) && selection?.destination === digest(await this.destination(repo)); } catch { /* Preserve previous data only as stale context. */ }
    if (matches) return observation;
    const stale = staleSelection(observation); this.store.put('github', repo.id, stale); return stale;
  }
  async tick(repos: Enrolled[]): Promise<void> {
    if (this.running) return; this.running = true;
    try { for (const repo of repos) {
      if ((this.store.record<{ at: number }>('githubNext', repo.id)?.at ?? 0) > Date.now()) continue;
      try { await this.refresh(repo); } catch { this.store.put('githubNext', repo.id, { at: Date.now() + 300000 }); }
    } } finally { this.running = false; }
  }
}
