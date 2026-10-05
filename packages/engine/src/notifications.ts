import type { Machine } from '@contribution/contracts';
import type { Journal, Operation } from './journal.js';
import type { Enrolled } from './repositories.js';
import { digest, id, now, requireValue, string } from './core.js';
import type { ObjectValue } from './core.js';
import { githubSelection } from './github.js';

export interface Notice {
  id: string; revision: string; repositoryId: string; originHostId: string; title: string; body: string;
  outcome: 'success' | 'failure'; operationId: string | null; url: string | null; updatedAt: string;
  state: 'pending' | 'claimed' | 'delivered' | 'uncertain' | 'superseded';
  claim?: { token: string; hostId: string; requestId: string; at: string };
  dismissedAt?: string;
}
/** The journal owns delivery claims. A lost channel reply never authorizes a second banner. */
export class Milestones {
  constructor(readonly store: Journal) {}
  dispatch(action: string, hostId: string, repo: Enrolled, args: ObjectValue): ObjectValue {
    this.synchronize([repo]);
    if (action === 'notifications.pending') return { notices: this.pending(hostId, repo.id) };
    const noticeId = string(args['noticeId'], 'noticeId');
    if (action === 'notifications.context') return this.context(repo.id, noticeId);
    const revision = string(args['revision'], 'revision');
    if (action === 'notifications.claim') return this.claim(hostId, repo.id, noticeId, revision, string(args['requestId'], 'requestId'));
    requireValue(action === 'notifications.acknowledge' && typeof args['delivered'] === 'boolean', 'INVALID_NOTIFICATION_ACTION', 'Select a supported delivery receipt.', 2);
    return this.acknowledge(hostId, repo.id, noticeId, revision, string(args['token'], 'token'), args['delivered']);
  }
  private settings(): Machine['notifications'] { return this.store.getMeta<Machine>('settings')?.notifications ?? { preferredHostId: this.store.hostId, success: true, failure: true }; }
  private destination(): string { return this.settings().preferredHostId ?? this.store.hostId; }
  private put(key: string, fields: Omit<Notice, 'id' | 'revision' | 'originHostId' | 'state' | 'updatedAt' | 'claim'>): void {
    const identity = digest({ host: this.store.hostId, key }), revision = digest(fields), old = this.store.record<Notice>('milestone', identity);
    if (old?.revision === revision) return;
    this.store.put('milestone', identity, { ...fields, id: identity, revision, originHostId: this.store.hostId, state: 'pending', updatedAt: now() });
  }
  private retire(key: string): void {
    const identity = digest({ host: this.store.hostId, key }), old = this.store.record<Notice>('milestone', identity);
    if (old && old.state !== 'superseded') this.store.put('milestone', identity, { ...old, state: 'superseded' });
  }
  private operation(op: Operation, repo: Enrolled): void {
    if (op.result['remoteOperationId'] || !['push', 'external_gate', 'checks', 'device'].includes(op.kind)) return;
    const gate = this.store.record<ObjectValue>('gate', op.operationId) ?? op.result['gate'] as ObjectValue | undefined;
    const fields = { repositoryId: repo.id, operationId: op.operationId, url: null, title: '', body: '', outcome: 'success' as 'success' | 'failure' };
    if (['failed', 'outcome_unknown', 'needs_attention'].includes(op.state)) {
      fields.outcome = 'failure'; fields.title = `${repo.config.name}: ${op.state === 'outcome_unknown' ? 'Outcome needs confirmation' : 'Action needs attention'}`;
      fields.body = op.error?.message ?? 'Inspect the retained operation for the next step.';
    } else if (op.kind === 'push' && op.result['delivery'] === 'delivered') {
      fields.title = `${repo.config.name}: Published`; fields.body = gate?.['state'] === 'inactive' ? 'Git delivery confirmed. The local gate is inactive.' : 'Git delivery confirmed. Open the retained gate and delivery results.';
    } else if (['push', 'external_gate'].includes(op.kind) && gate?.['state'] === 'passed') {
      fields.title = `${repo.config.name}: Local gate passed`; fields.body = op.kind === 'external_gate' ? 'The hook passed. Git delivery is not observed by this hook.' : 'The publication gate passed. Git delivery is still being observed.';
    } else if (op.kind === 'device' && op.state === 'succeeded') {
      fields.title = `${repo.config.name}: Device action completed`; fields.body = 'Open the retained receipt for independent install, launch and readback results.';
    } else return;
    this.put(`operation:${op.operationId}`, fields);
  }
  synchronize(repositories: Enrolled[]): void {
    const byID = new Map(repositories.map(repo => [repo.id, repo]));
    for (const op of this.store.list(500).reverse()) {
      const repo = byID.get(op.repositoryId);
      if (repo && Date.parse(String(op.result['completedAt'] ?? op.createdAt)) >= Date.now() - 7 * 86400000) this.operation(op, repo);
    }
    for (const repo of repositories.filter(repo => repo.canonicalHostId === this.store.hostId)) {
      const observation = this.store.record<ObjectValue>('github', repo.id);
      if (!observation || observation['freshness'] !== 'fresh' || observation['selection'] !== githubSelection(repo)) { this.retire(`github-pr:${repo.id}`); continue; }
      for (const run of observation['workflows'] as ObjectValue[] ?? []) {
        const key = `github-run:${repo.id}:${String(run['id'])}`;
        if (run['status'] !== 'completed' || !run['conclusion'] || ['success', 'neutral', 'skipped'].includes(String(run['conclusion']))) { this.retire(key); continue; }
        if (Date.parse(String(run['updated_at'])) < Date.now() - 7 * 86400000) continue;
        this.put(key, { repositoryId: repo.id, operationId: null, url: typeof run['html_url'] === 'string' ? run['html_url'] : null, outcome: 'failure',
          title: `${repo.config.name}: GitHub workflow ${String(run['conclusion'])}`, body: `${String(run['name'] ?? 'Workflow')} · attempt ${String(run['run_attempt'])}. Open GitHub for this exact remote run.` });
      }
      const pr = observation['pullRequest'] as ObjectValue | null, key = `github-pr:${repo.id}`;
      if (observation['readiness'] !== 'ready' || !pr) this.retire(key);
      else this.put(key, { repositoryId: repo.id, operationId: null, url: String(pr['url']), outcome: 'success', title: `${repo.config.name}: Ready to merge`,
        body: `PR #${String(pr['number'])} is currently ready. Head ${String(pr['headRefOid']).slice(0, 12)}, base ${String(pr['baseRefOid']).slice(0, 12)}. No merge was requested.` });
    }
  }
  pending(hostId: string, repositoryId?: string): Notice[] {
    const preferences = this.settings();
    return this.store.records<Notice>('milestone').filter(notice => (!repositoryId || notice.repositoryId === repositoryId) &&
      (notice.state === 'superseded' ? notice.claim?.hostId === hostId && !notice.dismissedAt : this.destination() === hostId && preferences[notice.outcome] && ['pending', 'claimed', 'uncertain'].includes(notice.state)))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 100);
  }
  claim(hostId: string, repositoryId: string, noticeId: string, revision: string, requestId: string): ObjectValue {
    return this.store.transaction(() => {
      const notice = this.store.record<Notice>('milestone', noticeId);
      requireValue(notice && notice.repositoryId === repositoryId && notice.revision === revision && this.destination() === hostId && this.settings()[notice.outcome], 'NOTIFICATION_CHANGED', 'The notification or its selected destination changed.');
      if (notice.state === 'claimed' && notice.claim?.hostId === hostId && notice.claim.requestId === requestId) return { notice, newlyClaimed: false };
      requireValue(notice.state === 'pending', 'NOTIFICATION_ALREADY_CLAIMED', 'This milestone already has a retained delivery attempt. Reconcile it without creating another banner.');
      const updated = { ...notice, state: 'claimed' as const, claim: { token: id(), hostId, requestId, at: now() } };
      this.store.put('milestone', noticeId, updated); return { notice: updated, newlyClaimed: true };
    });
  }
  acknowledge(hostId: string, repositoryId: string, noticeId: string, revision: string, token: string, delivered: boolean): ObjectValue {
    const notice = this.store.record<Notice>('milestone', noticeId);
    requireValue(notice && notice.repositoryId === repositoryId && notice.revision === revision && notice.claim?.hostId === hostId && notice.claim.token === token, 'NOTIFICATION_CHANGED', 'The delivery receipt does not match the retained claim.');
    if (notice.state === 'delivered') return { notice };
    if (notice.state === 'superseded' && !delivered) {
      const updated = { ...notice, dismissedAt: now() }; this.store.put('milestone', noticeId, updated); return { notice: updated };
    }
    requireValue(['claimed', 'uncertain'].includes(notice.state), 'NOTIFICATION_CHANGED', 'This milestone was superseded.');
    const updated = { ...notice, state: delivered ? 'delivered' : 'uncertain' }; this.store.put('milestone', noticeId, updated); return { notice: updated };
  }
  context(repositoryId: string, noticeId: string): ObjectValue {
    const notice = this.store.record<Notice>('milestone', noticeId);
    requireValue(notice && notice.repositoryId === repositoryId, 'NOTIFICATION_NOT_FOUND', 'No retained milestone belongs to this repository.', 2);
    if (!notice.operationId) return { notice };
    const op = this.store.get(notice.operationId); let log: string | null = null;
    try { log = this.store.logs(op, 500); } catch { /* The retained summary remains useful after raw log expiration. */ }
    return { notice, operation: op, log };
  }
}
