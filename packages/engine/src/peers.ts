import { openSync, closeSync, fsyncSync, writeFileSync, statSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildIdentity, validateContractFormat, assertContract } from '@contribution/contracts';
import type { Response } from '@contribution/contracts';
import { digest, id, now, object, string, requireValue, Fault, rejected, isGitJob } from './core.js';
import type { ObjectValue } from './core.js';
import type { Journal, Operation } from './journal.js';
import type { Repositories, Enrolled } from './repositories.js';
import { identity, git, gitText, ordinaryHistory, oid, clean } from './git.js';
import { run } from './process.js';
import { privateDirectory } from './private-files.js';
import { Milestones } from './notifications.js';
import { ProjectRegistry } from './project-registry.js';
import type { ProjectCatalog } from './project-registry.js';
import { StableFileReader, stableFileDigest } from './bounded-file.js';
import { createBoundedBundle, MAX_GIT_BUNDLE } from './git-bundle.js';
import { incomingFileIdentity, incomingFileSize, retainIncomingChunk } from './incoming-file.js';
import type { IncomingFileIdentity } from './incoming-file.js';
import { completionReceipt } from './peer-receipts.js';
import type { CompletionReceipt, CompletionOutbox } from './peer-receipts.js';
import { assertRepositorySettled } from './repository-idle.js';

export interface Peer { hostId: string; alias: string | null; version: string; observedAt: string }
export type PeerTransport = (alias: string, envelope: ObjectValue) => Promise<ObjectValue>;
export interface TransferManifest {
  schemaVersion: 1; transferId: string; requestId: string; repositoryId: string; senderHostId: string;
  kind: 'submit' | 'seed' | 'mirror'; branch: string; tip: string; base: string | null; metadata: ObjectValue;
  policy: string; objectFormat: string; sourceRef: string; bundleDigest: string; bytes: number;
}
interface Transfer { manifest: TransferManifest; path: string; fileIdentity?: IncomingFileIdentity; accepted?: ObjectValue }
interface HistoryCapture {
  manifest: Omit<TransferManifest, 'bundleDigest' | 'bytes'>; path: string; commonDir: string;
  destinationHostId: string; authority: string; bundle?: { bytes: number; sha256: string };
}
export interface Authority { transitionId: string; epoch: number; previousTransitionId: string | null; ownerHostId: string; previousOwnerHostId: string; phase: 'frozen' | 'active' | 'released'; peerHostId: string; tip: string | null; policy: string }
export interface MirrorRelease {
  removalId: string; repositoryId: string; removedHostId: string; ownerHostId: string;
  transitionId: string; epoch: number; policy: string; releasedAt: string;
}
const CHUNK = 256 * 1024, MAX_BUNDLE = MAX_GIT_BUNDLE;
export const remoteDeviceCommands = new Set(['devices.connect', 'devices.prepare', 'devices.install', 'devices.launch', 'devices.logs', 'devices.test', 'devices.ui', 'devices.debug', 'devices.capture', 'devices.disconnect', 'devices.qualify', 'devices.artifacts.transfer']);
export const remoteDeviceReads = new Set(['devices.list', 'devices.apps', 'devices.status', 'devices.profile', 'devices.artifacts.list', 'devices.artifacts.get']);
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
  readonly registry: ProjectRegistry;
  private chains = new Map<string, Promise<unknown>>();
  busy = false;
  cancelLocal?: (operation: Operation) => Response;
  prepareFence?: (repo: Enrolled) => Promise<void>;
  dispatchLocal?: (command: string, args: ObjectValue) => Promise<Response>;
  receiveArtifact?: (repo: Enrolled, from: string, action: string, body: ObjectValue) => Promise<ObjectValue>;
  receiveDeviceOwnership?: (repo: Enrolled, from: string, release: unknown) => Promise<ObjectValue>;
  constructor(readonly store: Journal, readonly repos: Repositories, readonly payload: string, readonly transport: PeerTransport = sshTransport) { this.registry = new ProjectRegistry(store, repos); }
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
    await this.syncRegistry(hostId, true);
    return { peer, authorityChanged: false, registry: this.store.record('peerRegistrySync', hostId) };
  }
  async syncRegistry(hostId: string, force = false): Promise<void> {
    return this.serial(`registry:${hostId}`, () => this.exchangeRegistry(hostId, force));
  }
  private async exchangeRegistry(hostId: string, force: boolean): Promise<void> {
    const previous = this.store.record<{ nextAttempt: number; failures: number }>('peerRegistrySync', hostId);
    if (!force && Number(previous?.nextAttempt ?? 0) > Date.now()) return;
    let catalog: ProjectCatalog | undefined;
    try {
      catalog = this.registry.local();
      const result = await this.call(hostId, 'registry.exchange', { catalog });
      requireValue(result['receivedGeneration'] === catalog.generation && result['receivedDigest'] === catalog.digest, 'REGISTRY_RECEIPT_INVALID', 'The peer did not acknowledge the exact catalog generation.', 3);
      const received = this.registry.receive(hostId, result['catalog']);
      this.store.put('peerRegistrySync', hostId, { state: 'acknowledged', generation: catalog.generation, digest: catalog.digest, receivedGeneration: received.generation,
        observedAt: now(), failures: 0, nextAttempt: Date.now() + 30000 });
    } catch (error) {
      const failures = (previous?.failures ?? 0) + 1;
      this.store.put('peerRegistrySync', hostId, { state: 'pending', generation: catalog?.generation ?? null, digest: catalog?.digest ?? null, failures,
        lastAttemptAt: now(), nextAttempt: Date.now() + Math.min(300000, 1000 * 2 ** Math.min(failures, 8)),
        reasonCode: error instanceof Fault ? error.code : 'PEER_UNAVAILABLE' });
    }
  }
  assertWriter(repo: Enrolled): void {
    const authority = this.store.record<Authority>('authority', repo.id);
    requireValue(!this.store.record('authorityReservation', repo.id) && (!authority || authority.phase === 'active' || authority.phase === 'released' && authority.ownerHostId === this.store.hostId && repo.availability === 'this-mac'),
      'AUTHORITY_TRANSITION_PENDING', 'This writer remains fenced until the retained authority transition or released companion is reconciled.', 3);
    requireValue(repo.canonicalHostId === this.store.hostId, 'CANONICAL_OWNER_REQUIRED', 'This host is a mirror; submit or publish through the canonical owner.');
  }
  private receiptPending(repo: Enrolled): boolean {
    const receipts = this.store.db.prepare('SELECT body FROM operations WHERE repository_id=? LIMIT 10001').all(repo.id).map(row => JSON.parse(String(row['body'])) as Operation);
    return receipts.length > 10000 || receipts.some(op => this.store.peerEvidenceProtected(op));
  }
  private idle(repo: Enrolled): void {
    assertRepositorySettled(this.store, repo.id);
    requireValue(!['contribution-writer.lock', 'primary-checkout-mutation.lock', 'primary-checkout-mutation.lock.recovery'].some(path => existsSync(join(repo.commonDir, path))),
      'REPOSITORY_BUSY', 'A writer or unconfirmed recovery boundary remains retained. Reconcile it before transferring authority.');
  }
  private prepareRequest(repo: Enrolled, from: string, requestId: string, scope: ObjectValue): void {
    const existing = this.store.byRequest(requestId), association = existing && this.store.record<{ from: string }>('peerOperation', existing.operationId);
    const prior = this.store.record<{ from: string; repositoryId: string; digest: string }>('peerRequest', requestId), scopeDigest = digest(scope);
    requireValue(!prior || (prior.from === from && prior.repositoryId === repo.id && prior.digest === scopeDigest), 'REQUEST_ID_CONFLICT', 'A different peer request owns this request identity.');
    requireValue(!existing || (existing.repositoryId === repo.id && (association?.from === from || existing.input['senderHostId'] === from || prior?.from === from)), 'REQUEST_ID_CONFLICT', 'This request identity belongs to a different local or peer operation.');
    requireValue(existing || !this.store.record('peerCancellation', `${from}:${requestId}`), 'REMOTE_REQUEST_CANCELLED', 'This request was cancelled before remote acceptance. It cannot later dispatch work.');
    if (!prior) this.store.put('peerRequest', requestId, { from, repositoryId: repo.id, digest: scopeDigest });
  }
  async bind(repo: Enrolled, hostId: string, requestId: string): Promise<ObjectValue> {
    uuid(requestId, 'requestId'); uuid(hostId, 'hostId');
    requireValue(repo.config.integration.adapter === 'generic-v1', 'ADOPTED_AUTHORITY_MIGRATION_REQUIRED',
      'Publication-hook adoption does not fence every existing landing entry point. Complete the cooperating-writer cutover before changing this project’s canonical host.', 3);
    return this.serial(repo.id, async () => {
      const previous = this.store.record<Authority>('authority', repo.id);
      if (previous?.transitionId === requestId) {
        requireValue(previous.ownerHostId === hostId, 'REQUEST_ID_CONFLICT', 'The transition identity has a different owner.');
        if (previous.phase === 'active' || previous.phase === 'released') return { hostId, transitionId: requestId, canonicalHostId: hostId, ...(previous.phase === 'released' ? { historical: true, pairingReleased: true } : {}) };
      } else {
        this.assertWriter(repo); this.idle(repo); await this.repos.current(repo); await clean(repo.path);
        const remote = await this.call(hostId, 'repository.inspect', { repositoryId: repo.id });
        requireValue(remote['completionPending'] !== true, 'PEER_RECEIPT_PENDING', 'The destination still needs its retained completion acknowledgment. Finish that exchange before transferring authority.', 3);
        requireValue(remote['policy'] === repo.revision && remote['branch'] === repo.config.integration.branch, 'PEER_POLICY_MISMATCH', 'Both enrollments must agree on the exact policy and branch.');
        const tip = (await identity(repo.path)).tip;
        requireValue(!tip || !remote['tip'] || tip === remote['tip'], 'DIVERGENT_HISTORY', 'Both hosts have different committed histories. Preserve and reconcile them before authority transfer.');
        this.idle(repo);
        await this.prepareFence?.(repo); this.idle(repo);
        const transition: Authority = { transitionId: requestId, epoch: (previous?.epoch ?? 0) + 1, previousTransitionId: previous?.transitionId ?? null, previousOwnerHostId: this.store.hostId, ownerHostId: hostId, peerHostId: hostId, phase: 'frozen', tip, policy: repo.revision };
        const proposal = this.store.record<Authority>('authorityProposal', requestId);
        requireValue(!proposal || digest(proposal) === digest(transition), 'AUTHORITY_SELECTION_CHANGED', 'The retained owner-transfer proposal has different history, policy or authority. Preserve it for reconciliation.', 3);
        this.store.put('authorityProposal', requestId, transition);
        const prepared = await this.call(hostId, 'authority.prepare', { repositoryId: repo.id, transition });
        requireValue(prepared['transitionDigest'] === digest(transition), 'AUTHORITY_RECEIPT_INVALID', 'The destination did not reserve this exact owner transition.', 3);
        this.store.assertRepositoryAvailable(repo.id); this.idle(repo);
        requireValue(digest(this.store.record('authority', repo.id)) === digest(previous) && digest(this.repos.all().find(row => row.id === repo.id)) === digest(repo),
          'AUTHORITY_CONFLICT', 'Local authority or enrollment changed during preparation. Retry only the retained transition.', 3);
        // Durable local fence precedes any message that could enable the remote owner.
        this.store.transaction(() => { this.store.put('authority', repo.id, transition); this.repos.save({ ...repo, availability: 'both-macs', canonicalHostId: hostId }); });
      }
      const frozen = this.store.record<Authority>('authority', repo.id)!;
      if (previous?.transitionId === requestId && previous.phase === 'frozen') {
        // An older payload may already have retained the source fence before
        // this protocol gained destination reservations. Recover that same
        // selection rather than abandoning an in-flight owner transition.
        const prepared = await this.call(hostId, 'authority.prepare', { repositoryId: repo.id, transition: frozen });
        requireValue(prepared['transitionDigest'] === digest(frozen) || prepared['transitionId'] === requestId && prepared['canonicalHostId'] === hostId,
          'AUTHORITY_RECEIPT_INVALID', 'The destination did not reconcile the retained owner transition.', 3);
      }
      const result = await this.call(hostId, 'authority.activate', { repositoryId: repo.id, transition: frozen });
      requireValue(result['transitionId'] === requestId && result['canonicalHostId'] === hostId, 'AUTHORITY_RECEIPT_INVALID', 'The new owner did not confirm the exact transition.', 3);
      this.store.put('authority', repo.id, { ...frozen, phase: 'active' });
      return { ...result, previousWriterDisabled: true };
    });
  }
  async releaseMirror(repo: Enrolled, removalId: string): Promise<MirrorRelease> {
    const removal = this.store.record<{ id: string; repository: Enrolled; state: string }>('repositoryRemoval', repo.id);
    const authority = this.store.record<Authority>('authority', repo.id);
    requireValue(removal?.id === removalId && removal.state === 'prepared' && digest(removal.repository) === digest(repo),
      'REMOVAL_FENCE_REQUIRED', 'A retained removal must fence this exact companion before releasing its pairing.', 3);
    requireValue(repo.config.integration.adapter === 'generic-v1' && authority?.phase === 'active' && authority.ownerHostId === repo.canonicalHostId &&
      authority.peerHostId === repo.canonicalHostId && repo.canonicalHostId !== this.store.hostId && repo.availability === 'both-macs',
      'AUTHORITY_RELEASE_REQUIRED', 'Only the retained generic companion may release this pairing. Transfer canonical ownership explicitly before removing its owner.', 3);
    const result = await this.call(authority.ownerHostId, 'authority.release-mirror', { repositoryId: repo.id, removalId,
      transitionId: authority.transitionId, epoch: authority.epoch, policy: repo.revision });
    const receipt = object(result['release']) as unknown as MirrorRelease;
    requireValue(receipt.removalId === removalId && receipt.repositoryId === repo.id && receipt.removedHostId === this.store.hostId &&
      receipt.ownerHostId === authority.ownerHostId && receipt.transitionId === authority.transitionId && receipt.epoch === authority.epoch && receipt.policy === repo.revision &&
      typeof receipt.releasedAt === 'string' && Number.isFinite(Date.parse(receipt.releasedAt)), 'AUTHORITY_RECEIPT_INVALID', 'The canonical host did not confirm this exact companion release.', 3);
    requireValue(digest(this.store.record('authority', repo.id)) === digest(authority), 'AUTHORITY_CONFLICT', 'Authority changed while companion release was in flight. Preserve the removal for reconciliation.', 3);
    return receipt;
  }
  private acceptMirrorRelease(repo: Enrolled, from: string, body: ObjectValue): ObjectValue {
    requireValue(Object.keys(body).sort().join() === ['repositoryId', 'removalId', 'transitionId', 'epoch', 'policy'].sort().join(), 'INVALID_PEER_REQUEST', 'Companion release accepts only the exact retained authority selection.', 2);
    const removalId = uuid(body['removalId'], 'removalId'), retained = this.store.record<MirrorRelease>('authorityRelease', removalId);
    if (retained) {
      requireValue(retained.repositoryId === repo.id && retained.removedHostId === from && retained.ownerHostId === this.store.hostId &&
        retained.transitionId === body['transitionId'] && retained.epoch === body['epoch'] && retained.policy === body['policy'],
        'REQUEST_ID_CONFLICT', 'This release identity already belongs to different authority.', 3);
      return { release: retained }; // Historical reply never changes current authority.
    }
    this.store.assertRepositoryAvailable(repo.id);
    const authority = this.store.record<Authority>('authority', repo.id);
    requireValue(repo.config.integration.adapter === 'generic-v1' && repo.availability === 'both-macs' && repo.canonicalHostId === this.store.hostId &&
      authority?.phase === 'active' && authority.ownerHostId === this.store.hostId && authority.peerHostId === from &&
      authority.transitionId === body['transitionId'] && authority.epoch === body['epoch'] && repo.revision === body['policy'],
      'AUTHORITY_RELEASE_REQUIRED', 'This sender does not identify the current generic companion and canonical authority.', 3);
    this.idle(repo);
    const release: MirrorRelease = { removalId, repositoryId: repo.id, removedHostId: from, ownerHostId: this.store.hostId,
      transitionId: authority.transitionId, epoch: authority.epoch, policy: repo.revision, releasedAt: now() };
    this.store.transaction(() => {
      this.store.put('authorityRelease', removalId, release);
      this.store.put('authority', repo.id, { ...authority, phase: 'released' });
      this.repos.save({ ...repo, availability: 'this-mac' });
    });
    return { release };
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
    if (action === 'registry.exchange') {
      requireValue(Object.keys(body).join() === 'catalog', 'REGISTRY_INVALID', 'Catalog exchange accepts only bounded discovery metadata.', 2);
      const received = this.registry.receive(from, body['catalog']);
      return { hostId: this.store.hostId, ...peerHello(), catalog: this.registry.local(), receivedGeneration: received.generation, receivedDigest: received.digest };
    }
    const repositoryId = uuid(body['repositoryId'], 'repositoryId'), repo = await this.repos.get(repositoryId);
    const result = await this.serial(repositoryId, async (): Promise<ObjectValue> => {
      if (action === 'repository.inspect') return { repositoryId, branch: repo.config.integration.branch, policy: repo.revision, tip: (await identity(repo.path)).tip, canonicalHostId: repo.canonicalHostId, completionPending: this.receiptPending(repo) };
      if (action === 'authority.release-mirror') return this.acceptMirrorRelease(repo, from, body);
      if (action === 'authority.prepare' || action === 'authority.activate') {
        this.store.assertRepositoryAvailable(repo.id);
        requireValue(repo.config.integration.adapter === 'generic-v1', 'ADOPTED_AUTHORITY_MIGRATION_REQUIRED',
          'The adopted project needs its complete cooperating-writer cutover before it can accept canonical ownership.', 3);
        const transition = object(body['transition']);
        requireValue(transition['ownerHostId'] === this.store.hostId && transition['previousOwnerHostId'] === from && transition['phase'] === 'frozen', 'AUTHORITY_FENCE_REQUIRED', 'The previous owner must first durably disable its writer.');
        const transitionId = uuid(transition['transitionId'], 'transitionId'), prior = this.store.record<Authority>('authority', repositoryId);
        if (prior?.transitionId === transitionId && prior.phase === 'active') return { transitionId, canonicalHostId: this.store.hostId };
        requireValue(transition['epoch'] === (prior?.epoch ?? 0) + 1 && transition['previousTransitionId'] === (prior?.transitionId ?? null), 'STALE_AUTHORITY_TRANSITION', 'An old ownership message cannot reactivate a previous writer.');
        requireValue(!prior || (['active', 'released'].includes(prior.phase) && prior.ownerHostId === from), 'AUTHORITY_CONFLICT', 'This host has a different retained authority transition.');
        const reservation = this.store.record<{ from: string; transitionDigest: string }>('authorityReservation', repo.id);
        requireValue(!reservation || reservation.from === from && reservation.transitionDigest === digest(transition), 'AUTHORITY_TRANSITION_PENDING', 'Another exact authority transition already reserved this clone.', 3);
        if (action === 'authority.activate') requireValue(reservation, 'AUTHORITY_PREPARE_REQUIRED', 'Reserve this owner transition before activating it.', 3);
        this.idle(repo); await this.repos.current(repo); await clean(repo.path);
        requireValue(repo.canonicalHostId === this.store.hostId || repo.canonicalHostId === from, 'AUTHORITY_CONFLICT', 'A third host owns this repository.');
        requireValue(transition['policy'] === repo.revision, 'PEER_POLICY_MISMATCH', 'The remote policy changed.');
        const tip = (await identity(repo.path)).tip;
        requireValue(!tip || !transition['tip'] || tip === transition['tip'], 'DIVERGENT_HISTORY', 'Canonical history changed during ownership transfer.');
        await this.prepareFence?.(repo); this.idle(repo);
        this.store.assertRepositoryAvailable(repo.id);
        requireValue(digest(this.repos.all().find(row => row.id === repo.id)) === digest(repo), 'AUTHORITY_CONFLICT', 'Enrollment changed during authority inspection.', 3);
        if (action === 'authority.prepare') {
          const prepared = { from, transitionId, transitionDigest: digest(transition) };
          this.store.put('authorityReservation', repo.id, prepared); return prepared;
        }
        this.store.transaction(() => {
          this.store.db.prepare("DELETE FROM records WHERE namespace='authorityReservation' AND key=?").run(repo.id);
          this.store.put('authority', repositoryId, { transitionId, epoch: transition['epoch'], previousTransitionId: transition['previousTransitionId'], ownerHostId: this.store.hostId, previousOwnerHostId: from, peerHostId: from, phase: 'active', tip, policy: repo.revision });
          this.repos.save({ ...repo, availability: 'both-macs', canonicalHostId: this.store.hostId });
        });
        return { transitionId, canonicalHostId: this.store.hostId };
      }
      // An old authenticated sender can finish a receipt exchange while owner
      // activation is frozen. This grants no repository mutation authority.
      if (action === 'operation.acknowledge') return this.acceptCompletion(repo, from, body);
      this.store.assertRepositoryAvailable(repo.id);
      const authority = this.store.record<Authority>('authority', repositoryId);
      requireValue(repo.availability === 'both-macs' && authority?.phase === 'active' && authority.peerHostId === from, 'REPOSITORY_PEER_UNAUTHORIZED', 'This peer is not associated with the repository authority.');
      if (action === 'device.ownership.accept') {
        requireValue(this.receiveDeviceOwnership, 'PEER_ACTION_UNSUPPORTED', 'This peer has no device ownership receiver.', 3);
        return this.receiveDeviceOwnership(repo, from, body['release']);
      }
      if (action === 'operation.cancel-request') {
        const requestId = string(body['requestId'], 'requestId'), op = this.store.byRequest(requestId);
        if (op) {
          const association = this.store.record<{ from: string }>('peerOperation', op.operationId), request = this.store.record<{ from: string; repositoryId: string }>('peerRequest', requestId);
          requireValue(op.repositoryId === repo.id && (association?.from === from || op.input['senderHostId'] === from || (request?.from === from && request.repositoryId === repo.id)), 'PEER_OPERATION_UNAUTHORIZED', 'This peer cannot cancel another caller’s request.');
          requireValue(this.cancelLocal, 'PEER_DISPATCH_UNAVAILABLE', 'The operation owner is unavailable.', 3);
          this.store.put('peerOperation', op.operationId, { from, repositoryId: repo.id });
          return { response: this.cancelLocal(op), requestCancelled: false };
        }
        this.store.put('peerCancellation', `${from}:${requestId}`, { repositoryId: repo.id, from, requestId, cancelledAt: now() });
        return { requestCancelled: true, requestId, executionHostAccepted: false };
      }
      if (['artifact.begin', 'artifact.chunk', 'artifact.finish'].includes(action)) {
        requireValue(this.receiveArtifact, 'PEER_ACTION_UNSUPPORTED', 'This peer has no installed artifact receiver.', 3);
        return this.receiveArtifact(repo, from, action, body);
      }
      if (action === 'device.command' || action === 'device.observe') {
        const command = string(body['command'], 'command'), args = object(body['args']);
        requireValue((action === 'device.command' ? remoteDeviceCommands : remoteDeviceReads).has(command), 'DEVICE_COMMAND_UNAUTHORIZED', 'The peer endpoint exposes only named device operations with existing local authorization.', 3);
        requireValue(args['repo'] === repo.id && (command === 'devices.artifacts.transfer' ? args['fromHost'] === this.store.hostId : args['host'] === this.store.hostId), 'DEVICE_IDENTITY_MISMATCH', 'Remote device commands must select this exact repository and execution host.', 3);
        if (action === 'device.command') {
          this.prepareRequest(repo, from, string(args['requestId'], 'requestId'), { command, args, expectedPolicyRevision: body['expectedPolicyRevision'] });
          const existing = this.store.byRequest(string(args['requestId'], 'requestId'));
          const profile = this.store.record<{ revision: string }>('deviceProfile', repo.id);
          requireValue(existing || (typeof body['expectedPolicyRevision'] === 'string' && profile?.revision === body['expectedPolicyRevision']), 'POLICY_CHANGED', 'Remote device policy changed after the caller selected this operation. Refresh its profile and use a new request.', 3);
        }
        requireValue(this.dispatchLocal, 'PEER_DISPATCH_UNAVAILABLE', 'The device command dispatcher is unavailable.', 3);
        const response = await this.dispatchLocal(command, args);
        if (response.operationId) this.store.put('peerOperation', response.operationId, { from, repositoryId: repo.id });
        return { response };
      }
      if (['notifications.pending', 'notifications.claim', 'notifications.acknowledge', 'notifications.context'].includes(action)) return new Milestones(this.store).dispatch(action, from, repo, body);
      if (action === 'publication.preview' || action === 'publication.start' || action === 'repository.status' || action === 'checks.start') {
        this.assertWriter(repo); requireValue(this.dispatchLocal, 'PEER_DISPATCH_UNAVAILABLE', 'The service dispatcher is unavailable.', 3);
        const args: ObjectValue = action === 'checks.start' ? { repo: repo.id, requestId: uuid(body['requestId'], 'requestId'), canonical: true, fresh: body['fresh'] === true, ...(body['checkId'] ? { checkId: string(body['checkId'], 'checkId') } : {}) } : action === 'publication.start'
          ? { repo: repo.id, requestId: uuid(body['requestId'], 'requestId'), expectedTip: string(body['expectedTip'], 'expectedTip'), scopeToken: string(body['scopeToken'], 'scopeToken') }
          : action === 'publication.preview' ? { repo: repo.id, preview: true } : { repo: repo.id, refresh: true };
        if (action === 'publication.start' || action === 'checks.start') this.prepareRequest(repo, from, string(args['requestId'], 'requestId'), { action, args });
        const response = await this.dispatchLocal(action === 'repository.status' ? 'status' : action === 'checks.start' ? 'checks.run' : 'push', args);
        if (response.operationId) this.store.put('peerOperation', response.operationId, { from, repositoryId: repo.id });
        return { response };
      }
      if (action === 'transfer.begin') return this.begin(repo, from, body);
      if (action === 'transfer.chunk') return this.chunk(from, body);
      if (action === 'transfer.finish') return this.finish(repo, from, body);
      if (['operation.get', 'operation.cancel', 'operation.reconcile'].includes(action)) {
        const op = this.store.get(uuid(body['operationId'], 'operationId'));
        const association = this.store.record<{ from: string }>('peerOperation', op.operationId);
        requireValue(op.repositoryId === repo.id && (op.input['senderHostId'] === from || association?.from === from), 'PEER_OPERATION_UNAUTHORIZED', 'This operation does not belong to the peer.');
        const response = action === 'operation.reconcile' && this.dispatchLocal ? await this.dispatchLocal(op.kind === 'device' ? 'devices.reconcile' : 'runs.reconcile', { operationId: op.operationId, ...(op.kind === 'device' ? { requestId: id() } : {}) })
          : action === 'operation.cancel' && this.cancelLocal ? this.cancelLocal(op) : this.store.response(op);
        let log = '', logStatus = 'available';
        try { log = this.store.logs(op, 2000); } catch (error) { logStatus = error instanceof Fault && error.code === 'LOG_EXPIRED' ? 'expired' : 'unavailable'; }
        return { response, completionReceipt: completionReceipt(response), logStatus, log: Buffer.byteLength(log) > 131072 ? '[Earlier remote log output omitted]\n' + Buffer.from(log).subarray(-131072).toString('utf8') : log };
      }
      throw new Fault('PEER_ACTION_UNSUPPORTED', 'The fixed peer endpoint does not support this action.', 2);
    });
    return { ...result, hostId: this.store.hostId, ...peerHello() };
  }
  private acceptCompletion(repo: Enrolled, from: string, body: ObjectValue): ObjectValue {
    requireValue(Object.keys(body).every(key => ['repositoryId', 'operationId', 'receipt'].includes(key)), 'INVALID_PEER_REQUEST', 'Completion acknowledgment accepts only its retained operation receipt.', 2);
    const op = this.store.get(uuid(body['operationId'], 'operationId')), association = this.store.record<{ from: string }>('peerOperation', op.operationId);
    requireValue(op.repositoryId === repo.id && (op.input['senderHostId'] === from || association?.from === from), 'PEER_OPERATION_UNAUTHORIZED', 'This operation does not belong to the acknowledging peer.', 3);
    const offered = completionReceipt(this.store.response(op));
    requireValue(offered && digest(body['receipt']) === digest(offered), 'COMPLETION_RECEIPT_CHANGED', 'Only the exact current completed effect receipt can be acknowledged.', 3);
    const prior = this.store.record<{ from: string; receipt: CompletionReceipt; acknowledgedAt: string }>('peerCompletionAcknowledgment', op.operationId);
    requireValue(!prior || prior.from === from, 'PEER_OPERATION_UNAUTHORIZED', 'A different peer owns this completion receipt.', 3);
    const retained = prior && digest(prior.receipt) === digest(offered) ? prior : { from, receipt: offered, acknowledgedAt: now() };
    this.store.transaction(() => {
      this.store.put('peerCompletionAcknowledgment', op.operationId, retained);
      this.store.put('peerCompletionAcknowledgmentHistory', `${op.operationId}:${offered.digest}`, retained);
    });
    return { acknowledged: true, receipt: offered, acknowledgedAt: retained.acknowledgedAt };
  }
  private begin(repo: Enrolled, from: string, body: ObjectValue): ObjectValue {
    const m = object(body['manifest']) as unknown as TransferManifest;
    requireValue(Object.keys(m).sort().join(',') === ['schemaVersion','transferId','requestId','repositoryId','senderHostId','kind','branch','tip','base','metadata','policy','objectFormat','sourceRef','bundleDigest','bytes'].sort().join(','), 'INVALID_TRANSFER', 'Unexpected or missing manifest fields.', 2);
    uuid(m.requestId, 'requestId'); uuid(m.transferId, 'transferId');
    requireValue(!this.store.record('peerCancellation', `${from}:${m.requestId}`), 'REMOTE_REQUEST_CANCELLED', 'This transfer request was cancelled before remote admission.');
    requireValue(m.schemaVersion === 1 && m.repositoryId === repo.id && m.senderHostId === from && m.policy === repo.revision && m.branch === repo.config.integration.branch, 'TRANSFER_IDENTITY_MISMATCH', 'Transfer repository, branch, host or policy is incompatible.');
    requireValue(['submit', 'seed', 'mirror'].includes(m.kind) && ['sha1', 'sha256'].includes(m.objectFormat), 'TRANSFER_UNSUPPORTED', 'Unknown transfer purpose or object format.', 2);
    oid(m.tip, m.objectFormat); if (m.base !== null) oid(m.base, m.objectFormat);
    requireValue((m.kind === 'submit') === (m.base !== null), 'INVALID_SOURCE_RANGE', 'Only task transfers carry a declared base.', 2);
    assertContract('submission-metadata', m.metadata);
    requireValue(/^refs\/contribution\/outbox\/[a-f0-9]{64}$/.test(m.sourceRef) && /^[a-f0-9]{64}$/.test(m.bundleDigest) && Number.isSafeInteger(m.bytes) && m.bytes > 0 && m.bytes <= MAX_BUNDLE, 'INVALID_TRANSFER', 'Bundle identity or size is outside the transfer contract.', 2);
    requireValue(m.kind === 'mirror' ? repo.canonicalHostId === from : repo.canonicalHostId === this.store.hostId, 'CANONICAL_OWNER_REQUIRED', 'Transfer direction does not match canonical authority.');
    const previous = this.store.record<Transfer>('transfer', m.transferId);
    if (previous) { requireValue(digest(previous.manifest) === digest(m), 'TRANSFER_ID_CONFLICT', 'Transfer ID is immutable.'); return { transferId: m.transferId, offset: previous.accepted ? previous.manifest.bytes : incomingFileSize(previous.path, previous.manifest.bytes, previous.fileIdentity), accepted: previous.accepted ?? null }; }
    this.store.assertRepositoryAvailable(repo.id); this.store.assertAdmissionStorage();
    const pending = this.store.records<Transfer>('transfer').filter(item => !item.accepted);
    requireValue(pending.filter(item => item.manifest.repositoryId === repo.id).length < 3 && pending.reduce((sum, item) => sum + item.manifest.bytes, m.bytes) <= 1024 ** 3,
      'TRANSFER_STORAGE_QUOTA', 'Retained Git transfers reached their bounded incoming reservation. Reconcile the existing transfers first.', 3);
    const directory = join(this.store.directory, 'incoming'); privateDirectory(directory);
    const path = join(directory, `${m.transferId}.bundle`);
    requireValue(!existsSync(path), 'TRANSFER_RECOVERY_REQUIRED', 'An unrecorded incoming file must be preserved for reconciliation before reusing this identity.', 3);
    writeFileSync(path, '', { flag: 'wx', mode: 0o600 }); sync(path); sync(directory);
    const fileIdentity = incomingFileIdentity(path);
    this.store.put('transfer', m.transferId, { manifest: m, path, fileIdentity }); return { transferId: m.transferId, offset: 0 };
  }
  private chunk(from: string, body: ObjectValue): ObjectValue {
    const transfer = this.store.record<Transfer>('transfer', uuid(body['transferId'], 'transferId'));
    requireValue(transfer && transfer.manifest.senderHostId === from && transfer.manifest.repositoryId === body['repositoryId'], 'TRANSFER_NOT_FOUND', 'No transfer belongs to this peer.');
    const encoded = body['data']; requireValue(typeof encoded === 'string' && encoded.length <= Math.ceil(CHUNK / 3) * 4 && /^[A-Za-z0-9+/]+={0,2}$/.test(encoded), 'INVALID_CHUNK', 'Chunk encoding exceeds its bound.', 2);
    const data = Buffer.from(encoded, 'base64'), offset = Number(body['offset']);
    requireValue(data.toString('base64') === encoded && data.length <= CHUNK && Number.isSafeInteger(offset) && offset >= 0 && offset + data.length <= transfer.manifest.bytes, 'INVALID_CHUNK', 'Chunk has an invalid range.', 2);
    requireValue(!transfer.accepted, 'TRANSFER_ALREADY_COMPLETE', 'This bundle already has an immutable acceptance receipt.');
    const retained = retainIncomingChunk(transfer.path, transfer.manifest.bytes, transfer.fileIdentity, offset, data);
    return { transferId: transfer.manifest.transferId, offset: retained };
  }
  private async finish(repo: Enrolled, from: string, body: ObjectValue): Promise<ObjectValue> {
    const transfer = this.store.record<Transfer>('transfer', uuid(body['transferId'], 'transferId'));
    requireValue(transfer && transfer.manifest.senderHostId === from && transfer.manifest.repositoryId === repo.id, 'TRANSFER_NOT_FOUND', 'No transfer belongs to this peer.');
    if (transfer.accepted) return transfer.accepted;
    incomingFileSize(transfer.path, transfer.manifest.bytes, transfer.fileIdentity);
    const m = transfer.manifest, file = new StableFileReader(transfer.path, MAX_BUNDLE, 'BUNDLE_DIGEST_MISMATCH');
    try {
    this.prepareRequest(repo, from, m.requestId, { manifest: m });
    requireValue(file.size === m.bytes && file.digest() === m.bundleDigest, 'BUNDLE_DIGEST_MISMATCH', 'The retained bundle does not match its immutable manifest.');
    requireValue((await identity(repo.path)).objectFormat === m.objectFormat, 'OBJECT_FORMAT_MISMATCH', 'The peer Git object formats differ.');
    const heads = await gitText(repo.path, ['bundle', 'list-heads', transfer.path]);
    requireValue(heads === `${m.tip} ${m.sourceRef}`, 'UNEXPECTED_BUNDLE_REFS', 'A transfer must contain exactly its declared source ref.');
    const verified = await git(repo.path, ['bundle', 'verify', transfer.path]);
    requireValue(verified.code === 0, 'BUNDLE_PREREQUISITES_MISSING', 'Provide a self-contained replacement bundle for the same logical source.');
    const incoming = `refs/contribution/incoming/${from}/${m.requestId}`;
    const priorRef = await git(repo.path, ['rev-parse', '--verify', incoming]);
    requireValue(priorRef.code !== 0 || priorRef.stdout.trim() === m.tip, 'REQUEST_ID_CONFLICT', 'This request already retained a different source tip.');
    file.verify();
    await gitText(repo.path, ['-c', 'core.hooksPath=/dev/null', '-c', 'maintenance.auto=false', 'fetch', '--no-tags', '--no-write-fetch-head', transfer.path, `${m.sourceRef}:${incoming}`]);
    file.verify();
    requireValue(await gitText(repo.path, ['rev-parse', '--verify', incoming]) === m.tip, 'BUNDLE_SOURCE_CHANGED', 'The imported source differs from the immutable transfer selection.');
    await ordinaryHistory(repo.path, m.tip);
    if (m.base) {
      requireValue((await git(repo.path, ['merge-base', '--is-ancestor', m.base, m.tip])).code === 0 && m.base !== m.tip && !await gitText(repo.path, ['rev-list', '--merges', `${m.base}..${m.tip}`]), 'INVALID_SOURCE_RANGE', 'The incoming task range must have complete linear ancestry.');
      const authors = new Set((await gitText(repo.path, ['log', '--format=%an <%ae>', `${m.base}..${m.tip}`])).split('\n'));
      const count = Number(await gitText(repo.path, ['rev-list', '--count', `${m.base}..${m.tip}`]));
      requireValue(authors.size === 1 && (count === 1 || typeof m.metadata['integrationMessage'] === 'string'), 'NEEDS_INPUT', 'Incoming generic tasks require one author and an explicit multi-commit message.', 2);
    }
    requireValue(repo.config.integration.adapter === 'generic-v1', 'ADAPTER_MIGRATION_REQUIRED', 'Imported sources need an explicitly adopted repository adapter.', 3);
    file.verify();
    const input = { tip: m.tip, base: m.base, metadata: m.metadata, policy: m.policy, senderHostId: from, incomingRef: incoming };
    const op = this.store.admit(m.requestId, m.kind === 'submit' ? 'submit' : m.kind, repo.id, input, this.payload, 'queued', operation => {
      this.store.put('peerOperation', operation.operationId, { from, repositoryId: repo.id }); return {};
    });
    const receipt = { transferId: m.transferId, requestId: m.requestId, sourceTip: m.tip, incomingRef: incoming, response: this.store.response(op), acceptedAt: now() };
    this.store.put('transfer', m.transferId, { ...transfer, accepted: receipt }); return receipt;
    } finally { file.close(); }
  }
  async send(hostId: string, manifest: TransferManifest, path: string): Promise<ObjectValue> {
    const file = new StableFileReader(path, MAX_BUNDLE, 'LOCAL_BUNDLE_CHANGED');
    try {
    requireValue(file.size === manifest.bytes && file.digest() === manifest.bundleDigest, 'LOCAL_BUNDLE_CHANGED', 'Retained transfer bytes changed.');
    const begin = await this.call(hostId, 'transfer.begin', { repositoryId: manifest.repositoryId, manifest });
    if (begin['accepted']) return object(begin['accepted']);
    let offset = Number(begin['offset']); file.verify();
    requireValue(Number.isSafeInteger(offset) && offset >= 0 && offset <= file.size, 'PEER_PROTOCOL_ERROR', 'Peer returned an invalid transfer offset.');
    while (offset < file.size) {
      const chunk = file.read(offset, Math.min(CHUNK, file.size - offset));
      const result = await this.call(hostId, 'transfer.chunk', { repositoryId: manifest.repositoryId, transferId: manifest.transferId, offset, data: chunk.toString('base64') });
      requireValue(result['offset'] === offset + chunk.length, 'PEER_PROTOCOL_ERROR', 'Peer did not retain the exact chunk.'); offset += chunk.length;
    }
    file.verify();
    return await this.call(hostId, 'transfer.finish', { repositoryId: manifest.repositoryId, transferId: manifest.transferId });
    } finally { file.close(); }
  }
  async captureHistory(repo: Enrolled, kind: 'seed' | 'mirror', requestId: string): Promise<Operation> {
    uuid(requestId, 'requestId');
    return this.serial(`history:${requestId}`, () => this.serial(repo.id, () => this.captureSelectedHistory(repo, kind, requestId)));
  }
  private async captureSelectedHistory(repo: Enrolled, kind: 'seed' | 'mirror', requestId: string): Promise<Operation> {
    const prior = this.store.byRequest(requestId);
    if (prior) { requireValue(prior.kind === `transfer.${kind}` && prior.repositoryId === repo.id, 'REQUEST_ID_CONFLICT', 'Request ID identifies another operation.'); return prior; }
    this.store.assertRepositoryAvailable(repo.id); this.store.assertAdmissionStorage();
    await this.repos.current(repo); const info = await identity(repo.path);
    const authority = this.store.record<Authority>('authority', repo.id); requireValue(authority?.phase === 'active', 'AUTHORITY_TRANSITION_PENDING', 'Complete repository pairing before history transfer.', 3);
    requireValue(kind === 'mirror' ? repo.canonicalHostId === this.store.hostId : repo.canonicalHostId !== this.store.hostId, 'TRANSFER_DIRECTION_INVALID', 'History transfer does not match this host role.');
    let selected = this.store.record<HistoryCapture>('historyCaptureIntent', requestId);
    if (!selected) {
      requireValue(info.tip, 'UNBORN_REPOSITORY', 'No committed history is available to transfer.', 3);
      await ordinaryHistory(repo.path, info.tip);
      selected = { manifest: { schemaVersion: 1, transferId: id(), requestId, repositoryId: repo.id, senderHostId: this.store.hostId, kind, branch: repo.config.integration.branch,
        tip: info.tip, base: null, metadata: { schemaVersion: 1 }, policy: repo.revision, objectFormat: info.objectFormat, sourceRef: `refs/contribution/outbox/${digest({ requestId })}` },
        path: join(this.store.directory, 'transfers', `${digest({ requestId })}.bundle`), commonDir: repo.commonDir, destinationHostId: authority.peerHostId, authority: digest(authority) };
    }
    const selection = selected, m = selection.manifest;
    requireValue(m.kind === kind && m.repositoryId === repo.id, 'REQUEST_ID_CONFLICT', 'This request already selected different history.');
    const currentSelection = (): void => {
      const live = this.repos.all().find(value => value.id === repo.id);
      requireValue(live?.revision === m.policy && live.commonDir === selection.commonDir && live.canonicalHostId === repo.canonicalHostId,
        'HISTORY_SELECTION_CHANGED', 'The enrollment changed while retaining selected history.', 3);
      requireValue(selection.commonDir === info.commonDir && m.objectFormat === info.objectFormat && m.policy === repo.revision && selection.authority === digest(this.store.record('authority', repo.id)),
        'HISTORY_SELECTION_CHANGED', 'The retained history selection requires its original clone, configuration and authority. Preserve it for reconciliation.', 3);
      this.store.assertRepositoryAvailable(repo.id); this.store.assertAdmissionStorage();
    };
    currentSelection();
    requireValue(!this.store.record('captureIntent', requestId), 'REQUEST_ID_CONFLICT', 'This request already selected task source.');
    this.store.put('historyCaptureIntent', requestId, selected);
    const sourceRef = m.sourceRef, path = selected.path;
    const retained = await git(repo.path, ['rev-parse', '--verify', sourceRef]);
    requireValue(retained.code !== 0 || retained.stdout.trim() === m.tip, 'HISTORY_SELECTION_CHANGED', 'The retained source ref changed; preserve both histories for reconciliation.', 3);
    if (retained.code !== 0) await gitText(repo.path, ['update-ref', sourceRef, m.tip, '0'.repeat(m.tip.length)]);
    const directory = join(this.store.directory, 'transfers'); privateDirectory(directory);
    await createBoundedBundle(this.store, requestId, repo.path, sourceRef, m.tip, path);
    const bundle = stableFileDigest(path, MAX_BUNDLE, 'LOCAL_BUNDLE_CHANGED');
    requireValue(!selected.bundle || digest(selected.bundle) === digest(bundle), 'LOCAL_BUNDLE_CHANGED', 'Retained transfer bytes changed.');
    await gitText(repo.path, ['bundle', 'verify', path]);
    requireValue(await gitText(repo.path, ['bundle', 'list-heads', path]) === `${m.tip} ${m.sourceRef}`, 'HISTORY_SELECTION_CHANGED', 'The retained bundle differs from the selected history.');
    requireValue(digest(stableFileDigest(path, MAX_BUNDLE, 'LOCAL_BUNDLE_CHANGED')) === digest(bundle), 'LOCAL_BUNDLE_CHANGED', 'Retained transfer bytes changed during validation.');
    await this.repos.current(repo); currentSelection();
    this.store.put('historyCaptureIntent', requestId, { ...selected, bundle });
    const manifest: TransferManifest = { ...m, bundleDigest: bundle.sha256, bytes: bundle.bytes };
    return this.store.admit(requestId, `transfer.${kind}`, repo.id, { manifest, path, destinationHostId: selected.destinationHostId }, this.payload, 'queued_local');
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
    if (this.busy || this.store.getMeta('paused') || this.store.getMeta('maintenance')) return; this.busy = true;
    try {
      // Seed admission precedes task handoff. Stable per-repository creation order
      // is retained even when one host is unavailable for hours.
      const pending = this.store.unsettled().filter(op => op.state === 'queued_local');
      for (const op of pending) {
        if (Number(op.result['nextPeerAttempt'] ?? 0) > Date.now()) continue;
        if (this.store.getMeta('paused') || this.store.getMeta('maintenance')) break;
        if (isGitJob(op.kind) && this.store.unsettled().some(other => other.repositoryId === op.repositoryId && isGitJob(other.kind) && other.operationId !== op.operationId && ['needs_attention', 'outcome_unknown'].includes(other.state))) continue;
        const earlier = pending.find(other => other.repositoryId === op.repositoryId && isGitJob(other.kind) === isGitJob(op.kind) && other.operationId !== op.operationId && other.createdAt < op.createdAt);
        if (earlier) continue;
        try {
          const repo = await this.repos.get(op.repositoryId);
          const authority = this.store.record<Authority>('authority', repo.id);
          requireValue(authority?.phase === 'active', 'AUTHORITY_TRANSITION_PENDING', 'Retained work waits for authority reconciliation.', 3);
          const hostId = typeof op.input['destinationHostId'] === 'string' ? op.input['destinationHostId'] : repo.canonicalHostId;
          if (this.store.get(op.operationId).state !== 'queued_local') continue;
          let remoteOperationId = op.result['remoteOperationId'];
          if (!remoteOperationId) {
            const current = this.store.get(op.operationId);
            const device = op.kind === 'remote.device';
            this.store.update(current, { result: { ...current.result, transferAttempted: true, ...(device ? { executionHostId: hostId } : { canonicalHostId: hostId }) } });
            let receipt: ObjectValue;
            if (current.result['cancelRequested']) {
              receipt = await this.call(hostId, 'operation.cancel-request', { repositoryId: repo.id, requestId: op.requestId });
              if (receipt['requestCancelled'] === true) {
                const latest = this.store.get(op.operationId);
                this.store.update(latest, { state: 'cancelled', stage: 'remote_admission_cancelled', error: null, result: { ...latest.result, cancellationReceipt: receipt } });
                continue;
              }
            } else if (device) {
              receipt = await this.call(hostId, 'device.command', { repositoryId: repo.id, command: op.input['command'], args: op.input['args'], expectedPolicyRevision: op.result['remotePolicyRevision'] });
            } else if (op.kind === 'remote.push') {
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
            this.store.update(latest, { stage: device ? 'execution_host_accepted' : 'canonical_accepted', result: { ...latest.result, remoteOperationId, receipt,
              ...(device ? { executionHostId: hostId, acceptance: { localDurable: true, executionHostAccepted: true, executionHostId: hostId, acceptedAt: now() } } : { canonicalHostAccepted: true, canonicalHostId: hostId }) } });
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
      for (const peer of this.list().filter(peer => peer.alias)) {
        if (this.store.getMeta('paused') || this.store.getMeta('maintenance')) break;
        await this.syncRegistry(peer.hostId);
      }
      const acknowledgments = this.store.db.prepare("SELECT body FROM records WHERE namespace='peerCompletionOutbox' AND json_extract(body,'$.state')='pending' AND COALESCE(json_extract(body,'$.nextAttempt'),0)<=? ORDER BY json_extract(body,'$.retainedAt'),key LIMIT 20").all(Date.now());
      for (const row of acknowledgments) {
        if (this.store.getMeta('paused') || this.store.getMeta('maintenance')) break;
        await this.acknowledgeCompletion(JSON.parse(String(row['body'])) as CompletionOutbox);
      }
    } finally { this.busy = false; }
  }
  async observeOperation(op: Operation, reconcile = false): Promise<Operation> {
    const repo = await this.repos.get(op.repositoryId), remoteOperationId = string(op.result['remoteOperationId'], 'remoteOperationId');
    const device = op.kind === 'remote.device', hostId = string(device ? op.result['executionHostId'] : op.result['canonicalHostId'], device ? 'executionHostId' : 'canonicalHostId');
    const observation = await this.call(hostId, reconcile ? 'operation.reconcile' : op.result['cancelRequested'] ? 'operation.cancel' : 'operation.get', { repositoryId: repo.id, operationId: remoteOperationId });
    const response = observation['response'] as Response; assertContract('response', response);
    requireValue(response.operationId === remoteOperationId && response.operationState, 'PEER_OPERATION_MISMATCH', 'Peer response identifies different work.');
    const stopped = Boolean(response.error) || ['succeeded', 'failed', 'cancelled', 'interrupted', 'outcome_unknown', 'needs_attention', 'waiting'].includes(response.operationState);
    // Older peers used an empty string for both empty and unavailable logs.
    const logStatus = observation['logStatus'] ?? (typeof observation['log'] === 'string' && observation['log'].length ? 'available' : 'unavailable');
    requireValue(['available', 'expired', 'unavailable'].includes(String(logStatus)), 'PEER_PROTOCOL_ERROR', 'The peer returned an unknown log availability state.', 3);
    if (typeof observation['log'] === 'string') this.store.retainRemoteLog(op, hostId, observation['log'], logStatus as 'available' | 'expired' | 'unavailable');
    const selected = completionReceipt(response), offered = observation['completionReceipt'];
    requireValue(!offered || selected && digest(offered) === digest(selected), 'COMPLETION_RECEIPT_INVALID', 'The peer completion receipt does not match its observed response.', 3);
    const latest = this.store.get(op.operationId), prior = this.store.record<CompletionOutbox>('peerCompletionOutbox', op.operationId);
    const outbox: CompletionOutbox | undefined = selected && offered ? prior && prior.hostId === hostId && digest(prior.receipt) === digest(selected) ? prior :
      { operationId: op.operationId, repositoryId: repo.id, hostId, receipt: selected, state: 'pending', retainedAt: now() } : undefined;
    const updated = this.store.update(latest, { state: stopped ? response.operationState : 'queued_local', stage: stopped ? response.error ? device ? 'execution_attention_required' : 'canonical_attention_required' : device ? 'execution_completed' : 'canonical_completed' : device ? 'execution_host_accepted' : 'canonical_accepted',
      error: stopped ? response.error : null, result: { ...latest.result, ...(device ? { executionObservation: response, ...(response.result?.['deviceOperation'] ? { deviceOperation: response.result['deviceOperation'] } : {}) } : { canonicalObservation: response }),
        peerObservedAt: now(), nextPeerAttempt: Date.now() + 1500, ...(stopped ? { completedAt: now() } : {}) } }, 'peer.operation_observed', () => {
          if (outbox) this.store.put('peerCompletionOutbox', op.operationId, outbox);
        });
    // Local response and immutable acknowledgment intent share a transaction.
    // Losing either network reply cannot replay integration or an app effect.
    if (outbox?.state === 'pending') await this.acknowledgeCompletion(outbox);
    return updated;
  }
  private async acknowledgeCompletion(outbox: CompletionOutbox): Promise<void> {
    if (this.store.getMeta('paused') || this.store.getMeta('maintenance')) return;
    await this.serial(`completion:${outbox.operationId}`, async () => {
      const current = this.store.record<CompletionOutbox>('peerCompletionOutbox', outbox.operationId);
      if (!current || current.state === 'acknowledged' || digest(current.receipt) !== digest(outbox.receipt)) return;
      try {
        const op = this.store.get(outbox.operationId), observed = (op.result['canonicalObservation'] ?? op.result['executionObservation']) as Response | undefined;
        requireValue(observed && digest(completionReceipt(observed)) === digest(outbox.receipt), 'COMPLETION_RECEIPT_CHANGED', 'The retained local observation changed before acknowledgment.', 3);
        const reply = await this.call(outbox.hostId, 'operation.acknowledge', { repositoryId: outbox.repositoryId, operationId: outbox.receipt.operationId, receipt: outbox.receipt });
        requireValue(reply['acknowledged'] === true && digest(reply['receipt']) === digest(outbox.receipt), 'COMPLETION_RECEIPT_INVALID', 'The peer did not confirm the retained completion receipt.', 3);
        const latest = this.store.record<CompletionOutbox>('peerCompletionOutbox', outbox.operationId);
        if (latest && digest(latest.receipt) === digest(outbox.receipt)) this.store.put('peerCompletionOutbox', outbox.operationId, { ...latest, state: 'acknowledged', acknowledgedAt: now() });
      } catch (error) {
        const latest = this.store.record<CompletionOutbox>('peerCompletionOutbox', outbox.operationId);
        if (!latest || digest(latest.receipt) !== digest(outbox.receipt)) return;
        const failures = (latest.failures ?? 0) + 1;
        this.store.put('peerCompletionOutbox', outbox.operationId, { ...latest, failures, reasonCode: error instanceof Fault ? error.code : 'PEER_UNAVAILABLE', nextAttempt: Date.now() + Math.min(300000, 1000 * 2 ** Math.min(failures, 8)) });
      }
    });
  }
}
