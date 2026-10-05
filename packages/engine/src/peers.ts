import { openSync, closeSync, fsyncSync, readFileSync, writeFileSync, statSync, existsSync, readdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildIdentity, validateContractFormat, assertContract } from '@contribution/contracts';
import type { Response } from '@contribution/contracts';
import { digest, id, now, object, string, requireValue, Fault, rejected } from './core.js';
import type { ObjectValue } from './core.js';
import type { Journal, Operation } from './journal.js';
import type { Repositories, Enrolled } from './repositories.js';
import { identity, git, gitText, ordinaryHistory, oid, clean } from './git.js';
import { run, Lease } from './process.js';
import { privateDirectory } from './private-files.js';

export interface Peer { hostId: string; alias: string | null; version: string; observedAt: string }
export type PeerTransport = (alias: string, envelope: ObjectValue) => Promise<ObjectValue>;
export interface TransferManifest {
  schemaVersion: 1; transferId: string; requestId: string; repositoryId: string; senderHostId: string;
  kind: 'submit' | 'seed' | 'mirror'; branch: string; tip: string; base: string | null; metadata: ObjectValue;
  policy: string; objectFormat: string; sourceRef: string; bundleDigest: string; bytes: number;
}
interface Transfer { manifest: TransferManifest; path: string; accepted?: ObjectValue }
interface Authority { transitionId: string; epoch: number; previousTransitionId: string | null; ownerHostId: string; previousOwnerHostId: string; phase: 'frozen' | 'active'; peerHostId: string; tip: string | null; policy: string }
const CHUNK = 256 * 1024, MAX_BUNDLE = 256 * 1024 * 1024;
export function compatiblePeer(hello: ObjectValue): boolean {
  const local = buildIdentity.version.match(/^(\d+)\.(\d+)\.(\d+)$/), remote = String(hello['version']).match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (hello['protocolVersion'] === undefined) return hello['version'] === buildIdentity.version;
  return hello['protocolVersion'] === 1 && hello['requestSchemaVersion'] === 1 && Boolean(local && remote && local[1] === remote[1] && local[2] === remote[2] && Math.abs(Number(local[3]) - Number(remote[3])) <= 1);
}
const peerHello = (): ObjectValue => ({ version: buildIdentity.version, protocolVersion: 1, requestSchemaVersion: 1 });
function uuid(value: unknown, field: string): string { const result = string(value, field); requireValue(validateContractFormat('uuid', result), 'INVALID_ID', `${field} must be a UUID.`, 2); return result; }
function sync(path: string): void { const fd = openSync(path, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } }
export async function sshTransport(alias: string, envelope: ObjectValue): Promise<ObjectValue> {
  requireValue(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(alias), 'INVALID_SSH_ALIAS', 'Use a configured SSH host alias.', 2);
  // This fixed command never contains repository paths, source text or caller argv.
  const result = await run('/usr/bin/ssh', ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=8',
    '-o', 'ServerAliveInterval=10', '-o', 'ServerAliveCountMax=2', '--', alias, '"$HOME/.local/bin/contribution" peer --stdio'],
    { input: JSON.stringify(envelope) + '\n', timeoutMs: 45000, maxBytes: 2 * 1024 * 1024 });
  if (result.code === 255 || result.timedOut) throw new Fault('PEER_UNAVAILABLE', 'Verified noninteractive SSH or the installed peer service is unavailable. Accepted local work remains retained.', 3, {}, true);
  let response: Response;
  try { response = JSON.parse(result.stdout) as Response; assertContract('response', response); }
  catch { throw new Fault('PEER_PROTOCOL_ERROR', 'The installed peer returned an incompatible response.', 3); }
  if (response.error) throw new Fault(response.error.code, response.error.message, 3, response.result ?? {}, response.error.retryable);
  return object(response.result);
}

export class Peers {
  private chains = new Map<string, Promise<unknown>>();
  busy = false;
  cancelLocal?: (operation: Operation) => Response;
  prepareFence?: (repo: Enrolled) => Promise<void>;
  dispatchLocal?: (command: string, args: ObjectValue) => Promise<Response>;
  constructor(readonly store: Journal, readonly repos: Repositories, readonly payload: string, readonly transport: PeerTransport = sshTransport) {}
  list(): Peer[] { return this.store.records<Peer>('peer'); }
  private serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(key) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(fn); this.chains.set(key, next);
    void next.finally(() => { if (this.chains.get(key) === next) this.chains.delete(key); }).catch(() => {}); return next;
  }
  async call(hostId: string, action: string, body: ObjectValue): Promise<ObjectValue> {
    const peer = this.store.record<Peer>('peer', hostId);
    requireValue(peer?.alias, 'PEER_ROUTE_REQUIRED', 'Pair this host through its verified SSH alias before sending work.', 3);
    const result = await this.transport(peer.alias, { fromHostId: this.store.hostId, expectedHostId: hostId, compatibility: peerHello(), action, body });
    requireValue(result['hostId'] === hostId, 'PEER_IDENTITY_CHANGED', 'The SSH destination no longer identifies the paired Contribution host.', 3);
    requireValue(compatiblePeer(result), 'PEER_VERSION_MISMATCH', 'Peer compatibility changed; update the selected hosts before continuing.', 3); return result;
  }
  async pair(alias: string): Promise<ObjectValue> {
    const result = await this.transport(alias, { fromHostId: this.store.hostId, action: 'hello', body: peerHello() });
    const hostId = uuid(result['hostId'], 'hostId'); requireValue(hostId !== this.store.hostId, 'SELF_PAIRING', 'Choose a different host.');
    requireValue(compatiblePeer(result), 'PEER_VERSION_MISMATCH', 'Update both peers to compatible adjacent patch releases with protocol and request schema version 1.', 3);
    const peer: Peer = { hostId, alias, version: string(result['version'], 'version'), observedAt: now() }; this.store.put('peer', hostId, peer);
    return { peer, authorityChanged: false };
  }
  assertWriter(repo: Enrolled): void {
    const authority = this.store.record<Authority>('authority', repo.id);
    requireValue(!authority || authority.phase === 'active', 'AUTHORITY_TRANSITION_PENDING', 'Both writers remain fenced until the retained authority transition is reconciled.', 3);
    requireValue(repo.canonicalHostId === this.store.hostId, 'CANONICAL_OWNER_REQUIRED', 'This host is a mirror; submit or publish through the canonical owner.');
  }
  private idle(repo: Enrolled): void {
    requireValue(!this.store.unsettled().some(op => op.repositoryId === repo.id), 'REPOSITORY_BUSY', 'Reconcile all retained work before transferring repository authority.');
    requireValue(!Lease.inspect(repo.commonDir), 'REPOSITORY_BUSY', 'A repository writer currently owns the mutation lease.');
  }
  async bind(repo: Enrolled, hostId: string, requestId: string): Promise<ObjectValue> {
    uuid(requestId, 'requestId'); uuid(hostId, 'hostId');
    return this.serial(repo.id, async () => {
      const previous = this.store.record<Authority>('authority', repo.id);
      if (previous?.transitionId === requestId) {
        requireValue(previous.ownerHostId === hostId, 'REQUEST_ID_CONFLICT', 'The transition identity has a different owner.');
        if (previous.phase === 'active') return { hostId, transitionId: requestId, canonicalHostId: hostId };
      } else {
        this.assertWriter(repo); this.idle(repo); await this.repos.current(repo); await clean(repo.path);
        const remote = await this.call(hostId, 'repository.inspect', { repositoryId: repo.id });
        requireValue(remote['policy'] === repo.revision && remote['branch'] === repo.config.integration.branch, 'PEER_POLICY_MISMATCH', 'Both enrollments must agree on the exact policy and branch.');
        const tip = (await identity(repo.path)).tip;
        requireValue(!tip || !remote['tip'] || tip === remote['tip'], 'DIVERGENT_HISTORY', 'Both hosts have different committed histories. Preserve and reconcile them before authority transfer.');
        this.idle(repo);
        await this.prepareFence?.(repo); this.idle(repo);
        const transition: Authority = { transitionId: requestId, epoch: (previous?.epoch ?? 0) + 1, previousTransitionId: previous?.transitionId ?? null, previousOwnerHostId: this.store.hostId, ownerHostId: hostId, peerHostId: hostId, phase: 'frozen', tip, policy: repo.revision };
        // Durable local fence precedes any message that could enable the remote owner.
        this.store.transaction(() => { this.store.put('authority', repo.id, transition); this.repos.save({ ...repo, availability: 'both-macs', canonicalHostId: hostId }); });
      }
      const frozen = this.store.record<Authority>('authority', repo.id)!;
      const result = await this.call(hostId, 'authority.activate', { repositoryId: repo.id, transition: frozen });
      requireValue(result['transitionId'] === requestId && result['canonicalHostId'] === hostId, 'AUTHORITY_RECEIPT_INVALID', 'The new owner did not confirm the exact transition.', 3);
      this.store.put('authority', repo.id, { ...frozen, phase: 'active' });
      return { ...result, previousWriterDisabled: true };
    });
  }
  async receive(envelope: ObjectValue): Promise<ObjectValue> {
    requireValue(Object.keys(envelope).every(key => ['fromHostId', 'expectedHostId', 'compatibility', 'action', 'body'].includes(key)), 'INVALID_PEER_REQUEST', 'Unexpected peer fields.', 2);
    const from = uuid(envelope['fromHostId'], 'fromHostId'), action = string(envelope['action'], 'action'), body = object(envelope['body']);
    requireValue(from !== this.store.hostId, 'SELF_PAIRING', 'Peer host identity must be distinct.');
    if (action === 'hello') {
      requireValue(compatiblePeer(body), 'PEER_VERSION_MISMATCH', 'Update both peers to compatible adjacent patch releases with protocol and request schema version 1.', 3);
      const existing = this.store.record<Peer>('peer', from);
      this.store.put('peer', from, { hostId: from, alias: existing?.alias ?? null, version: body['version'], observedAt: now() });
      return { hostId: this.store.hostId, ...peerHello() };
    }
    requireValue(envelope['expectedHostId'] === this.store.hostId && this.store.record('peer', from), 'UNPAIRED_HOST', 'Pair the exact intended Contribution hosts before exchanging work.', 3);
    requireValue(compatiblePeer(envelope['compatibility'] ? object(envelope['compatibility']) : { version: this.store.record<Peer>('peer', from)?.version }), 'PEER_VERSION_MISMATCH', 'The sender is no longer compatible with this service.', 3);
    const repositoryId = uuid(body['repositoryId'], 'repositoryId'), repo = await this.repos.get(repositoryId);
    const result = await this.serial(repositoryId, async (): Promise<ObjectValue> => {
      if (action === 'repository.inspect') return { repositoryId, branch: repo.config.integration.branch, policy: repo.revision, tip: (await identity(repo.path)).tip, canonicalHostId: repo.canonicalHostId };
      if (action === 'authority.activate') {
        const transition = object(body['transition']);
        requireValue(transition['ownerHostId'] === this.store.hostId && transition['previousOwnerHostId'] === from && transition['phase'] === 'frozen', 'AUTHORITY_FENCE_REQUIRED', 'The previous owner must first durably disable its writer.');
        const transitionId = uuid(transition['transitionId'], 'transitionId'), prior = this.store.record<Authority>('authority', repositoryId);
        if (prior?.transitionId === transitionId && prior.phase === 'active') return { transitionId, canonicalHostId: this.store.hostId };
        requireValue(transition['epoch'] === (prior?.epoch ?? 0) + 1 && transition['previousTransitionId'] === (prior?.transitionId ?? null), 'STALE_AUTHORITY_TRANSITION', 'An old ownership message cannot reactivate a previous writer.');
        requireValue(!prior || (prior.phase === 'active' && prior.ownerHostId === from), 'AUTHORITY_CONFLICT', 'This host has a different retained authority transition.');
        this.idle(repo); await this.repos.current(repo); await clean(repo.path);
        requireValue(repo.canonicalHostId === this.store.hostId || repo.canonicalHostId === from, 'AUTHORITY_CONFLICT', 'A third host owns this repository.');
        requireValue(transition['policy'] === repo.revision, 'PEER_POLICY_MISMATCH', 'The remote policy changed.');
        const tip = (await identity(repo.path)).tip;
        requireValue(!tip || !transition['tip'] || tip === transition['tip'], 'DIVERGENT_HISTORY', 'Canonical history changed during ownership transfer.');
        await this.prepareFence?.(repo); this.idle(repo);
        this.store.transaction(() => {
          this.store.put('authority', repositoryId, { transitionId, epoch: transition['epoch'], previousTransitionId: transition['previousTransitionId'], ownerHostId: this.store.hostId, previousOwnerHostId: from, peerHostId: from, phase: 'active', tip, policy: repo.revision });
          this.repos.save({ ...repo, availability: 'both-macs', canonicalHostId: this.store.hostId });
        });
        return { transitionId, canonicalHostId: this.store.hostId };
      }
      const authority = this.store.record<Authority>('authority', repositoryId);
      requireValue(repo.availability === 'both-macs' && authority?.phase === 'active' && authority.peerHostId === from, 'REPOSITORY_PEER_UNAUTHORIZED', 'This peer is not associated with the repository authority.');
      if (action === 'publication.preview' || action === 'publication.start' || action === 'repository.status' || action === 'checks.start') {
        this.assertWriter(repo); requireValue(this.dispatchLocal, 'PEER_DISPATCH_UNAVAILABLE', 'The service dispatcher is unavailable.', 3);
        const args: ObjectValue = action === 'checks.start' ? { repo: repo.id, requestId: uuid(body['requestId'], 'requestId'), canonical: true, fresh: body['fresh'] === true, ...(body['checkId'] ? { checkId: string(body['checkId'], 'checkId') } : {}) } : action === 'publication.start'
          ? { repo: repo.id, requestId: uuid(body['requestId'], 'requestId'), expectedTip: string(body['expectedTip'], 'expectedTip'), scopeToken: string(body['scopeToken'], 'scopeToken') }
          : action === 'publication.preview' ? { repo: repo.id, preview: true } : { repo: repo.id, refresh: true };
        const response = await this.dispatchLocal(action === 'repository.status' ? 'status' : action === 'checks.start' ? 'checks.run' : 'push', args);
        if (response.operationId) this.store.put('peerOperation', response.operationId, { from, repositoryId: repo.id });
        return { response };
      }
      if (action === 'transfer.begin') return this.begin(repo, from, body);
      if (action === 'transfer.chunk') return this.chunk(from, body);
      if (action === 'transfer.finish') return this.finish(repo, from, body);
      if (action === 'operation.get' || action === 'operation.cancel' || action === 'operation.reconcile') {
        const op = this.store.get(uuid(body['operationId'], 'operationId'));
        const association = this.store.record<{ from: string }>('peerOperation', op.operationId);
        requireValue(op.repositoryId === repo.id && (op.input['senderHostId'] === from || association?.from === from), 'PEER_OPERATION_UNAUTHORIZED', 'This operation does not belong to the peer.');
        const response = action === 'operation.reconcile' && this.dispatchLocal ? await this.dispatchLocal('runs.reconcile', { operationId: op.operationId })
          : action === 'operation.cancel' && this.cancelLocal ? this.cancelLocal(op) : this.store.response(op);
        let log = '';
        try { log = this.store.logs(op, 2000); } catch { /* Expose unavailable evidence without inventing output. */ }
        return { response, log: Buffer.byteLength(log) > 131072 ? '[Earlier remote log output omitted]\n' + Buffer.from(log).subarray(-131072).toString('utf8') : log };
      }
      throw new Fault('PEER_ACTION_UNSUPPORTED', 'The fixed peer endpoint does not support this action.', 2);
    });
    return { ...result, hostId: this.store.hostId, ...peerHello() };
  }
  private begin(repo: Enrolled, from: string, body: ObjectValue): ObjectValue {
    const m = object(body['manifest']) as unknown as TransferManifest;
    requireValue(Object.keys(m).sort().join(',') === ['schemaVersion','transferId','requestId','repositoryId','senderHostId','kind','branch','tip','base','metadata','policy','objectFormat','sourceRef','bundleDigest','bytes'].sort().join(','), 'INVALID_TRANSFER', 'Unexpected or missing manifest fields.', 2);
    uuid(m.requestId, 'requestId'); uuid(m.transferId, 'transferId');
    requireValue(m.schemaVersion === 1 && m.repositoryId === repo.id && m.senderHostId === from && m.policy === repo.revision && m.branch === repo.config.integration.branch, 'TRANSFER_IDENTITY_MISMATCH', 'Transfer repository, branch, host or policy is incompatible.');
    requireValue(['submit', 'seed', 'mirror'].includes(m.kind) && ['sha1', 'sha256'].includes(m.objectFormat), 'TRANSFER_UNSUPPORTED', 'Unknown transfer purpose or object format.', 2);
    oid(m.tip, m.objectFormat); if (m.base !== null) oid(m.base, m.objectFormat);
    requireValue((m.kind === 'submit') === (m.base !== null), 'INVALID_SOURCE_RANGE', 'Only task transfers carry a declared base.', 2);
    assertContract('submission-metadata', m.metadata);
    requireValue(/^refs\/contribution\/outbox\/[a-f0-9]{64}$/.test(m.sourceRef) && /^[a-f0-9]{64}$/.test(m.bundleDigest) && Number.isSafeInteger(m.bytes) && m.bytes > 0 && m.bytes <= MAX_BUNDLE, 'INVALID_TRANSFER', 'Bundle identity or size is outside the transfer contract.', 2);
    requireValue(m.kind === 'mirror' ? repo.canonicalHostId === from : repo.canonicalHostId === this.store.hostId, 'CANONICAL_OWNER_REQUIRED', 'Transfer direction does not match canonical authority.');
    const previous = this.store.record<Transfer>('transfer', m.transferId);
    if (previous) { requireValue(digest(previous.manifest) === digest(m), 'TRANSFER_ID_CONFLICT', 'Transfer ID is immutable.'); return { transferId: m.transferId, offset: statSync(previous.path).size, accepted: previous.accepted ?? null }; }
    const directory = join(this.store.directory, 'incoming'); privateDirectory(directory);
    const path = join(directory, `${m.transferId}.bundle`);
    if (!existsSync(path)) { writeFileSync(path, '', { flag: 'wx', mode: 0o600 }); sync(path); }
    requireValue(statSync(path).size === 0, 'TRANSFER_RECOVERY_REQUIRED', 'An unacknowledged partial transfer must be reconciled before reusing this identity.', 3);
    this.store.put('transfer', m.transferId, { manifest: m, path }); return { transferId: m.transferId, offset: 0 };
  }
  private chunk(from: string, body: ObjectValue): ObjectValue {
    const transfer = this.store.record<Transfer>('transfer', uuid(body['transferId'], 'transferId'));
    requireValue(transfer && transfer.manifest.senderHostId === from && transfer.manifest.repositoryId === body['repositoryId'], 'TRANSFER_NOT_FOUND', 'No transfer belongs to this peer.');
    const encoded = body['data']; requireValue(typeof encoded === 'string' && encoded.length <= Math.ceil(CHUNK / 3) * 4 && /^[A-Za-z0-9+/]+={0,2}$/.test(encoded), 'INVALID_CHUNK', 'Chunk encoding exceeds its bound.', 2);
    const data = Buffer.from(encoded, 'base64'), offset = Number(body['offset']), current = statSync(transfer.path).size;
    requireValue(data.toString('base64') === encoded && data.length <= CHUNK && Number.isSafeInteger(offset) && offset >= 0 && offset + data.length <= transfer.manifest.bytes, 'INVALID_CHUNK', 'Chunk has an invalid range.', 2);
    if (offset < current) {
      requireValue(offset + data.length <= current && readFileSync(transfer.path).subarray(offset, offset + data.length).equals(data), 'CHUNK_CONFLICT', 'Previously acknowledged bytes differ.');
    } else { requireValue(!transfer.accepted && offset === current, 'CHUNK_OFFSET', 'Resume at the last confirmed offset.'); appendFileSync(transfer.path, data); sync(transfer.path); }
    return { transferId: transfer.manifest.transferId, offset: statSync(transfer.path).size };
  }
  private async finish(repo: Enrolled, from: string, body: ObjectValue): Promise<ObjectValue> {
    const transfer = this.store.record<Transfer>('transfer', uuid(body['transferId'], 'transferId'));
    requireValue(transfer && transfer.manifest.senderHostId === from && transfer.manifest.repositoryId === repo.id, 'TRANSFER_NOT_FOUND', 'No transfer belongs to this peer.');
    if (transfer.accepted) return transfer.accepted;
    const m = transfer.manifest, bytes = readFileSync(transfer.path);
    requireValue(bytes.length === m.bytes && digest(bytes) === m.bundleDigest, 'BUNDLE_DIGEST_MISMATCH', 'The retained bundle does not match its immutable manifest.');
    requireValue((await identity(repo.path)).objectFormat === m.objectFormat, 'OBJECT_FORMAT_MISMATCH', 'The peer Git object formats differ.');
    const heads = await gitText(repo.path, ['bundle', 'list-heads', transfer.path]);
    requireValue(heads === `${m.tip} ${m.sourceRef}`, 'UNEXPECTED_BUNDLE_REFS', 'A transfer must contain exactly its declared source ref.');
    const verified = await git(repo.path, ['bundle', 'verify', transfer.path]);
    requireValue(verified.code === 0, 'BUNDLE_PREREQUISITES_MISSING', 'Provide a self-contained replacement bundle for the same logical source.');
    const incoming = `refs/contribution/incoming/${from}/${m.requestId}`;
    const priorRef = await git(repo.path, ['rev-parse', '--verify', incoming]);
    requireValue(priorRef.code !== 0 || priorRef.stdout.trim() === m.tip, 'REQUEST_ID_CONFLICT', 'This request already retained a different source tip.');
    await gitText(repo.path, ['-c', 'core.hooksPath=/dev/null', '-c', 'maintenance.auto=false', 'fetch', '--no-tags', '--no-write-fetch-head', transfer.path, `${m.sourceRef}:${incoming}`]);
    await ordinaryHistory(repo.path, m.tip);
    if (m.base) {
      requireValue((await git(repo.path, ['merge-base', '--is-ancestor', m.base, m.tip])).code === 0 && m.base !== m.tip && !await gitText(repo.path, ['rev-list', '--merges', `${m.base}..${m.tip}`]), 'INVALID_SOURCE_RANGE', 'The incoming task range must have complete linear ancestry.');
      const authors = new Set((await gitText(repo.path, ['log', '--format=%an <%ae>', `${m.base}..${m.tip}`])).split('\n'));
      const count = Number(await gitText(repo.path, ['rev-list', '--count', `${m.base}..${m.tip}`]));
      requireValue(authors.size === 1 && (count === 1 || typeof m.metadata['integrationMessage'] === 'string'), 'NEEDS_INPUT', 'Incoming generic tasks require one author and an explicit multi-commit message.', 2);
    }
    requireValue(repo.config.integration.adapter === 'generic-v1', 'ADAPTER_MIGRATION_REQUIRED', 'Imported sources need an explicitly adopted repository adapter.', 3);
    const input = { tip: m.tip, base: m.base, metadata: m.metadata, policy: m.policy, senderHostId: from, incomingRef: incoming };
    const op = this.store.admit(m.requestId, m.kind === 'submit' ? 'submit' : m.kind, repo.id, input, this.payload);
    const receipt = { transferId: m.transferId, requestId: m.requestId, sourceTip: m.tip, incomingRef: incoming, response: this.store.response(op), acceptedAt: now() };
    this.store.put('transfer', m.transferId, { ...transfer, accepted: receipt }); return receipt;
  }
  async send(hostId: string, manifest: TransferManifest, path: string): Promise<ObjectValue> {
    requireValue(digest(readFileSync(path)) === manifest.bundleDigest, 'LOCAL_BUNDLE_CHANGED', 'Retained transfer bytes changed.');
    const begin = await this.call(hostId, 'transfer.begin', { repositoryId: manifest.repositoryId, manifest });
    if (begin['accepted']) return object(begin['accepted']);
    let offset = Number(begin['offset']); const data = readFileSync(path);
    requireValue(Number.isSafeInteger(offset) && offset >= 0 && offset <= data.length, 'PEER_PROTOCOL_ERROR', 'Peer returned an invalid transfer offset.');
    while (offset < data.length) {
      const chunk = data.subarray(offset, offset + CHUNK);
      const result = await this.call(hostId, 'transfer.chunk', { repositoryId: manifest.repositoryId, transferId: manifest.transferId, offset, data: chunk.toString('base64') });
      requireValue(result['offset'] === offset + chunk.length, 'PEER_PROTOCOL_ERROR', 'Peer did not retain the exact chunk.'); offset += chunk.length;
    }
    return this.call(hostId, 'transfer.finish', { repositoryId: manifest.repositoryId, transferId: manifest.transferId });
  }
  async captureHistory(repo: Enrolled, kind: 'seed' | 'mirror', requestId: string): Promise<Operation> {
    const prior = this.store.list(100000).find(op => op.requestId === requestId);
    if (prior) { requireValue(prior.kind === `transfer.${kind}` && prior.repositoryId === repo.id, 'REQUEST_ID_CONFLICT', 'Request ID identifies another operation.'); return prior; }
    await this.repos.current(repo); const info = await identity(repo.path); requireValue(info.tip, 'UNBORN_REPOSITORY', 'No committed history is available to transfer.', 3);
    await ordinaryHistory(repo.path, info.tip);
    const authority = this.store.record<Authority>('authority', repo.id); requireValue(authority?.phase === 'active', 'AUTHORITY_TRANSITION_PENDING', 'Complete repository pairing before history transfer.', 3);
    requireValue(kind === 'mirror' ? repo.canonicalHostId === this.store.hostId : repo.canonicalHostId !== this.store.hostId, 'TRANSFER_DIRECTION_INVALID', 'History transfer does not match this host role.');
    const sourceRef = `refs/contribution/outbox/${digest({ requestId })}`;
    await gitText(repo.path, ['update-ref', sourceRef, info.tip]);
    const directory = join(this.store.directory, 'transfers'); privateDirectory(directory); const path = join(directory, `${digest({ requestId })}.bundle`);
    if (!existsSync(path)) await gitText(repo.path, ['bundle', 'create', path, sourceRef]); sync(path);
    const manifest: TransferManifest = { schemaVersion: 1, transferId: id(), requestId, repositoryId: repo.id, senderHostId: this.store.hostId, kind, branch: repo.config.integration.branch,
      tip: info.tip, base: null, metadata: { schemaVersion: 1 }, policy: repo.revision, objectFormat: info.objectFormat, sourceRef, bundleDigest: digest(readFileSync(path)), bytes: statSync(path).size };
    return this.store.admit(requestId, `transfer.${kind}`, repo.id, { manifest, path, destinationHostId: authority.peerHostId }, this.payload, 'queued_local');
  }
  async applyHistory(op: Operation, repo: Enrolled): Promise<ObjectValue> {
    if (op.kind === 'seed') this.assertWriter(repo);
    else requireValue(repo.canonicalHostId === op.input['senderHostId'], 'CANONICAL_OWNER_REQUIRED', 'Only accepted canonical history may update a mirror.');
    await this.repos.current(repo); await clean(repo.path);
    const tip = string(op.input['tip'], 'tip'), current = (await identity(repo.path)).tip;
    if (current === tip && (op.effectDispatched || op.kind === 'mirror')) return { tip, publication: 'not_requested', reconciled: true };
    if (op.kind === 'seed') {
      requireValue(!current, 'SEED_TARGET_NOT_EMPTY', 'First history handoff requires an unborn canonical target.');
      requireValue(readdirSync(repo.path).every(name => name === '.git'), 'SEED_FILES_CONFLICT', 'Seed import never overwrites existing files, including ignored content.');
    } else requireValue(!current || (await git(repo.path, ['merge-base', '--is-ancestor', current, tip])).code === 0, 'MIRROR_DIVERGED', 'The mirror contains unique history. Both histories remain retained.');
    this.store.update(this.store.get(op.operationId), { effectDispatched: true, stage: 'promoting_history', result: { historyTip: tip, previousTip: current } });
    await gitText(repo.path, ['-c', 'core.hooksPath=/dev/null', 'merge', '--ff-only', '--no-overwrite-ignore', tip]);
    requireValue((await identity(repo.path)).tip === tip, 'HISTORY_PROMOTION_UNCERTAIN', 'History promotion needs reconciliation.', 6);
    const receipt = { tip, previousTip: current, publication: 'not_requested' };
    if (existsSync(join(repo.path, 'contribution.json'))) this.repos.save({ ...repo, policySource: 'tracked' });
    this.store.put('historyReceipt', op.requestId, receipt); return receipt;
  }
  async tick(): Promise<void> {
    if (this.busy) return; this.busy = true;
    try {
      // Seed admission precedes task handoff. Stable per-repository creation order
      // is retained even when one host is unavailable for hours.
      const pending = this.store.unsettled().filter(op => op.state === 'queued_local');
      for (const op of pending) {
        if (Number(op.result['nextPeerAttempt'] ?? 0) > Date.now()) continue;
        if (this.store.unsettled().some(other => other.repositoryId === op.repositoryId && other.operationId !== op.operationId && ['needs_attention', 'outcome_unknown'].includes(other.state))) continue;
        const earlier = pending.find(other => other.repositoryId === op.repositoryId && other.operationId !== op.operationId && other.createdAt < op.createdAt);
        if (earlier) continue;
        try {
          const repo = await this.repos.get(op.repositoryId);
          const authority = this.store.record<Authority>('authority', repo.id);
          requireValue(authority?.phase === 'active', 'AUTHORITY_TRANSITION_PENDING', 'Retained work waits for authority reconciliation.', 3);
          const hostId = typeof op.input['destinationHostId'] === 'string' ? op.input['destinationHostId'] : repo.canonicalHostId;
          let remoteOperationId = op.result['remoteOperationId'];
          if (!remoteOperationId) {
            const current = this.store.get(op.operationId);
            this.store.update(current, { result: { ...current.result, transferAttempted: true, canonicalHostId: hostId } });
            let receipt: ObjectValue;
            if (op.kind === 'remote.push') {
              receipt = await this.call(hostId, 'publication.start', { repositoryId: repo.id, requestId: op.requestId, expectedTip: op.input['expectedTip'], scopeToken: op.input['scopeToken'] });
            } else {
            let manifest: TransferManifest, path: string;
            if (op.kind.startsWith('transfer.')) { manifest = op.input['manifest'] as unknown as TransferManifest; path = string(op.input['path'], 'path'); }
            else {
              const captured = this.store.record<ObjectValue>('capture', op.requestId); requireValue(captured, 'SOURCE_RETENTION_MISSING', 'Captured source evidence is unavailable.');
              path = string(captured['bundle'], 'bundle');
              const retained = this.store.record<TransferManifest>('outboxManifest', op.operationId);
              manifest = retained ?? { schemaVersion: 1, transferId: id(), requestId: op.requestId, repositoryId: repo.id, senderHostId: this.store.hostId, kind: 'submit', branch: repo.config.integration.branch,
                tip: string(op.input['tip'], 'tip'), base: string(op.input['base'], 'base'), metadata: object(op.input['metadata']), policy: string(op.input['policy'], 'policy'),
                objectFormat: (await identity(repo.path)).objectFormat, sourceRef: string(captured['retention'], 'retention'), bundleDigest: string(captured['bundleDigest'], 'bundleDigest'), bytes: statSync(path).size };
              if (!retained) this.store.put('outboxManifest', op.operationId, manifest);
            }
            receipt = await this.send(hostId, manifest, path);
            }
            const response = object(receipt['response']);
            if (response['error']) {
              const error = object(response['error']); throw new Fault(string(error['code'], 'code'), string(error['message'], 'message'), 4);
            }
            remoteOperationId = uuid(response['operationId'], 'operationId');
            const latest = this.store.get(op.operationId);
            this.store.update(latest, { stage: 'canonical_accepted', result: { ...latest.result, remoteOperationId, receipt, canonicalHostAccepted: true, canonicalHostId: hostId } });
          }
          await this.observeOperation(this.store.get(op.operationId));
        } catch (error) {
          const latest = this.store.get(op.operationId), attempts = Number(latest.result['peerFailures'] ?? 0) + 1;
          const delay = Math.min(300000, 1000 * 2 ** Math.min(attempts, 8)) * (0.8 + Math.random() * 0.4);
          const retry = !(error instanceof Fault) || ['PEER_UNAVAILABLE', 'PEER_ROUTE_REQUIRED', 'SERVICE_UNAVAILABLE', 'SERVICE_TIMEOUT', 'AUTHORITY_TRANSITION_PENDING'].includes(error.code);
          this.store.update(latest, { state: retry ? 'queued_local' : 'needs_attention', stage: 'waiting_for_peer', error: retry ? null : rejected(error).error, result: { ...latest.result, peerFailures: attempts, nextPeerAttempt: Date.now() + delay,
            peerError: { code: error instanceof Fault ? error.code : 'PEER_UNAVAILABLE', message: error instanceof Fault ? error.message : 'Peer transport is unavailable.' } } });
        }
      }
    } finally { this.busy = false; }
  }
  async observeOperation(op: Operation, reconcile = false): Promise<Operation> {
    const repo = await this.repos.get(op.repositoryId), remoteOperationId = string(op.result['remoteOperationId'], 'remoteOperationId');
    const hostId = string(op.result['canonicalHostId'], 'canonicalHostId');
    const observation = await this.call(hostId, reconcile ? 'operation.reconcile' : op.result['cancelRequested'] ? 'operation.cancel' : 'operation.get', { repositoryId: repo.id, operationId: remoteOperationId });
    const response = observation['response'] as Response; assertContract('response', response);
    requireValue(response.operationId === remoteOperationId && response.operationState, 'PEER_OPERATION_MISMATCH', 'Peer response identifies different work.');
    const stopped = Boolean(response.error) || ['succeeded', 'failed', 'cancelled', 'interrupted', 'outcome_unknown', 'needs_attention', 'waiting'].includes(response.operationState);
    if (typeof observation['log'] === 'string' && Buffer.byteLength(observation['log']) <= 132000) this.store.put('remoteLog', op.operationId, { text: observation['log'], observedAt: now(), originHostId: hostId });
    const latest = this.store.get(op.operationId);
    return this.store.update(latest, { state: stopped ? response.operationState : 'queued_local', stage: stopped ? response.error ? 'canonical_attention_required' : 'canonical_completed' : 'canonical_accepted',
      error: stopped ? response.error : null, result: { ...latest.result, canonicalObservation: response, peerObservedAt: now(), nextPeerAttempt: Date.now() + 1500, ...(stopped ? { completedAt: now() } : {}) } });
  }
}
