import { Fault, now, object, requireValue } from './core.js';
import type { ObjectValue } from './core.js';
import { executable, run } from './process.js';
import { gitText } from './git.js';
import type { Journal } from './journal.js';
import type { Enrolled } from './repositories.js';

export interface APIReply { status: number; headers: Record<string, string>; body: unknown }
export type APITransport = (path: string, query?: ObjectValue) => Promise<APIReply>;
export interface Observation { observedAt: string; freshness: 'fresh' | 'stale'; readiness: string; reasonCodes: string[];
  pullRequest: ObjectValue | null; checks: ObjectValue[]; workflows: ObjectValue[]; retryAt: string | null; lastKnown?: Observation }
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
    try { response = await fetch(`https://api.github.com${path}`, { method: query ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(12000),
      headers: { Authorization: `Bearer ${auth.stdout.trim()}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Contribution', ...(query ? { 'Content-Type': 'application/json' } : {}) },
      ...(query ? { body: JSON.stringify(query) } : {}) }); }
    catch { throw new Fault('GITHUB_TRANSPORT_ERROR', 'GitHub transport timed out or disconnected. Last-known evidence remains stale.', 3, {}, true); }
    const chunks: Uint8Array[] = []; let size = 0;
    if (response.body) for await (const chunk of response.body) { size += chunk.length; requireValue(size <= 2 * 1024 * 1024, 'GITHUB_RESPONSE_TOO_LARGE', 'GitHub response exceeded the bounded observation budget.', 3); chunks.push(chunk); }
    let body: unknown;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Fault('GITHUB_MALFORMED_RESPONSE', 'GitHub returned non-JSON observation data.', 3); }
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
  const acceptedHeads = new Set([pr['headRefOid'], pr['testMergeOid']].filter(Boolean));
  const reasons: string[] = [];
  for (const rule of rules.filter(rule => rule['type'] === 'required_status_checks')) {
    const parameters = object(rule['parameters']), required = parameters['required_status_checks'];
    requireValue(Array.isArray(required), 'GITHUB_RULES_UNKNOWN', 'Required checks are not readable.', 3);
    for (const item of required) {
      const requirement = object(item), context = requirement['context'];
      const matching = checks.filter(check => check['name'] === context && acceptedHeads.has(check['head_sha']) &&
        (!requirement['integration_id'] || object(check['app'] ?? {})['id'] === requirement['integration_id']));
      const current = matching.sort((a, b) => Number(b['id']) - Number(a['id']))[0];
      if (!current || current['status'] !== 'completed' || !['success', 'neutral', 'skipped'].includes(String(current['conclusion']))) reasons.push(`REQUIRED_CHECK:${String(context)}`);
    }
  }
  if (pr['reviewDecision'] === 'CHANGES_REQUESTED' || pr['reviewDecision'] === 'REVIEW_REQUIRED') reasons.push(String(pr['reviewDecision']));
  if (reasons.length) return { readiness: 'blocked', reasonCodes: reasons };
  // GitHub's own merge-state computation includes classic protection and rules
  // not fully represented in a check rollup. Anything short of CLEAN is not ready.
  if (pr['mergeable'] !== 'MERGEABLE' || pr['mergeStateStatus'] !== 'CLEAN') return { readiness: 'unknown', reasonCodes: ['MERGE_RULES_NOT_CONFIRMED'] };
  return { readiness: 'ready', reasonCodes: [] };
}
export async function observe(api: APITransport, owner: string, name: string, branch: string, previous?: Observation): Promise<Observation> {
  const observedAt = now(), prefix = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  try {
    const workflows = await list(api, `${prefix}/actions/runs`, 'workflow_runs');
    const prs = await list(api, `${prefix}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`);
    requireValue(prs.length <= 1, 'GITHUB_PR_AMBIGUOUS', 'More than one current PR matches this branch.', 3);
    if (!prs[0]) return { observedAt, freshness: 'fresh', readiness: 'no_pull_request', reasonCodes: [], pullRequest: null, checks: [], workflows, retryAt: null };
    const number = Number(prs[0]['number']); requireValue(Number.isSafeInteger(number), 'GITHUB_MALFORMED_RESPONSE', 'PR identity is missing.', 3);
    const response = await checked(api, '/graphql', { query: `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){number url title state isDraft headRefOid baseRefName baseRefOid mergeable mergeStateStatus reviewDecision potentialMergeCommit{oid}}}}`, variables: { owner, name, number } });
    const body = object(response.body); requireValue(!body['errors'], 'GITHUB_RULES_UNKNOWN', 'GitHub could not resolve current PR rules.', 3);
    const pr = object(object(object(body['data'])['repository'])['pullRequest']);
    requireValue(typeof pr['headRefOid'] === 'string' && typeof pr['baseRefName'] === 'string' && typeof pr['isDraft'] === 'boolean', 'GITHUB_MALFORMED_RESPONSE', 'PR state is incomplete.', 3);
    const merge = pr['potentialMergeCommit'] ? object(pr['potentialMergeCommit'])['oid'] : null;
    const checks = await list(api, `${prefix}/commits/${encodeURIComponent(String(pr['headRefOid']))}/check-runs`, 'check_runs');
    if (typeof merge === 'string') checks.push(...await list(api, `${prefix}/commits/${encodeURIComponent(merge)}/check-runs`, 'check_runs'));
    const rules = await list(api, `${prefix}/rules/branches/${encodeURIComponent(String(pr['baseRefName']))}`);
    const current = { ...pr, testMergeOid: merge };
    return { observedAt, freshness: 'fresh', ...readiness(current, checks, rules), pullRequest: current, checks, workflows, retryAt: null };
  } catch (error) {
    const fault = error instanceof Fault ? error : new Fault('GITHUB_MALFORMED_RESPONSE', 'GitHub observation was incomplete.', 3);
    const result: Observation = { observedAt, freshness: 'stale', readiness: 'unknown', reasonCodes: [fault.code], pullRequest: null, checks: [], workflows: [], retryAt: typeof fault.details['retryAt'] === 'string' ? fault.details['retryAt'] : null };
    if (previous) { const { lastKnown: _history, ...lastKnown } = previous.freshness === 'fresh' ? previous : previous.lastKnown ?? previous; result.lastKnown = lastKnown; }
    return result;
  }
}
export class GitHubMonitor {
  private running = false;
  constructor(readonly store: Journal, readonly api = transport()) {}
  async refresh(repo: Enrolled): Promise<Observation | null> {
    if (!repo.config.publication.remote || !repo.config.publication.branch) return null;
    const remote = githubRepository(await gitText(repo.path, ['remote', 'get-url', repo.config.publication.remote])); if (!remote) return null;
    const previous = this.store.record<Observation>('github', repo.id);
    if (previous?.retryAt && Date.parse(previous.retryAt) > Date.now()) return previous;
    const observation = await observe(this.api, remote.owner, remote.name, repo.config.publication.branch, previous);
    observation.workflows = observation.workflows.map(current => {
      const old = previous?.workflows.find(item => item['id'] === current['id']);
      return old && (Number(old['run_attempt']) > Number(current['run_attempt']) ||
        Number(old['run_attempt']) === Number(current['run_attempt']) && String(old['updated_at']) > String(current['updated_at'])) ? old : current;
    });
    this.store.put('github', repo.id, observation);
    const workflowKeys = new Set(previous?.workflows.map(run => `${String(run['id'])}:${String(run['run_attempt'])}:${String(run['conclusion'])}`));
    for (const run of observation.workflows) {
      const key = `${String(run['id'])}:${String(run['run_attempt'])}:${String(run['conclusion'])}`;
      if (previous && !workflowKeys.has(key) && run['conclusion'] && run['conclusion'] !== 'success') this.store.put('notification', `${repo.id}:${key}`, {
        repositoryId: repo.id, eventId: key, observedAt: observation.observedAt, occurredAt: run['updated_at'], state: 'pending', outcome: run['conclusion'], url: run['html_url'], origin: 'github' });
    }
    const active = observation.workflows.some(run => run['status'] !== 'completed') || ['blocked', 'unknown'].includes(observation.readiness);
    this.store.put('githubNext', repo.id, { at: observation.retryAt ? Date.parse(observation.retryAt) : Date.now() + (observation.freshness === 'stale' ? 300000 : active ? 30000 : 600000) });
    return observation;
  }
  async tick(repos: Enrolled[]): Promise<void> {
    if (this.running) return; this.running = true;
    try { for (const repo of repos) {
      if ((this.store.record<{ at: number }>('githubNext', repo.id)?.at ?? 0) > Date.now()) continue;
      try { await this.refresh(repo); } catch { this.store.put('githubNext', repo.id, { at: Date.now() + 300000 }); }
    } } finally { this.running = false; }
  }
}
