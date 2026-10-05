import { assertContract, validateContractFormat } from '@contribution/contracts';
import type { DeviceOwnership } from '@contribution/contracts';
import { digest, id, now, object, requireValue, string } from './core.js';
import type { ObjectValue } from './core.js';
import type { Journal, Operation } from './journal.js';
import type { Enrolled } from './repositories.js';
import type { Devices, DeviceObservation } from './devices.js';

interface Intent {
  repositoryId: string; deviceId: string; fromHostId: string; toHostId: string;
  expectedRevision: string; releaseRef: string | null;
}
interface Release {
  schemaVersion: 1; recordMode: 'observed' | 'fixture'; releaseId: string; ownershipId: string;
  repositoryId: string; deviceId: string; fromHostId: string; toHostId: string;
  previousRevision: string; revision: string; appIdentity: string; releasedAt: string; evidenceRefs: string[];
}
interface Fence { operationId: string; releaseId: string; intent: Intent; owner: DeviceOwnership; releaseDispatched: boolean }
type PeerCall = (host: string, action: string, body: ObjectValue) => Promise<ObjectValue>;

/** Relinquishment fences the old host before cleanup or any remote request.
 * Receipt references are usable only after authenticated receipt at this host.
 * Expiry, local process absence and a caller-supplied receipt never confer ownership. */
export class DeviceOwnershipTransfers {
  private receiving = new Set<string>();
  constructor(readonly store: Journal, readonly devices: Devices, readonly call: PeerCall) {}
  private enabled(): void {
    requireValue(this.store.getMeta<{ remoteDevices?: { enabled: boolean } }>('settings')?.remoteDevices?.enabled,
      'DEVICE_MODULE_DISABLED', 'Enable Remote Devices on the selected host first.', 3);
  }
  private app(repo: Enrolled): string {
    const app = this.devices.profile(repo).app;
    return digest({ bundleId: app.bundleId, teamId: app.teamId, applicationIdentifier: app.applicationIdentifier });
  }
  private peer(repo: Enrolled, host: string): void {
    const authority = this.store.record<{ phase: string; peerHostId: string }>('authority', repo.id);
    requireValue(repo.availability === 'both-macs' && authority?.phase === 'active' && authority.peerHostId === host && this.store.record('peer', host),
      'REPOSITORY_PEER_UNAUTHORIZED', 'The other device host must be explicitly associated with this repository.', 3);
  }
  private idle(deviceId: string, operationId?: string): void {
    const owner = this.devices.ownership(deviceId);
    requireValue(owner.activeOperationIds.length === 0 && !this.store.unsettled().some(op => op.operationId !== operationId &&
      ((op.kind === 'device' && op.input['deviceId'] === deviceId && object(op.input['selection'])['action'] !== 'prepare' &&
        !(op.state === 'needs_attention' && object(op.result['deviceOperation'])['resultCertainty'] === 'confirmed')) ||
       (op.kind === 'device_transfer' && object(op.input['intent'])['deviceId'] === deviceId))),
    'DEVICE_BUSY', 'Finish or explicitly cancel queued device work and reconcile uncertain effects before host transfer.', 3);
  }
  private readiness(observation: DeviceObservation, noSession: boolean): void {
    requireValue(observation.hostReady && observation.trust === 'trusted', 'PAIRING_REQUIRED', 'The selected host must independently verify trust with the exact phone.', 3);
    requireValue(observation.externalSession === 'absent', observation.externalSession === 'present' ? 'DEVICE_BUSY_EXTERNAL' : 'PREVIOUS_OWNER_UNCONFIRMED',
      'Account for native, backend and external activity on this phone before ownership can change.', 3);
    requireValue(noSession ? observation.session === 'none' : ['none', 'owned'].includes(observation.session),
      'PREVIOUS_OWNER_UNCONFIRMED', 'The prior developer session has not been confirmed absent or Contribution-owned.', 3);
  }
  admit(repo: Enrolled, args: ObjectValue, payload: string): Operation {
    const requestId = string(args['requestId'], 'requestId');
    const intent: Intent = { repositoryId: repo.id, deviceId: string(args['device'], 'device'), fromHostId: string(args['fromHost'], 'fromHost'),
      toHostId: string(args['host'], 'host'), expectedRevision: string(args['expectedRevision'], 'expectedRevision'), releaseRef: typeof args['releaseRef'] === 'string' ? args['releaseRef'] : null };
    for (const value of [requestId, intent.fromHostId, intent.toHostId]) requireValue(validateContractFormat('uuid', value), 'INVALID_ID', 'Request and host identities must be UUIDs.', 2);
    requireValue(intent.fromHostId !== intent.toHostId && [intent.fromHostId, intent.toHostId].includes(this.store.hostId), 'EXECUTION_HOST_ROUTE_REQUIRED', 'Run transfer on the relinquishing host, or consume a retained release on its destination.', 3);
    const input = { intent }, prior = this.store.existing(requestId, 'device_transfer', repo.id, input); if (prior) return prior;
    this.enabled(); this.peer(repo, intent.fromHostId === this.store.hostId ? intent.toHostId : intent.fromHostId); this.app(repo);
    if (intent.fromHostId === this.store.hostId) {
      requireValue(!intent.releaseRef, 'INVALID_USAGE', 'A source transfer creates its release; release references are consumed on the destination.', 2);
      const owner = this.devices.ownership(intent.deviceId);
      requireValue(owner.revision === intent.expectedRevision && owner.state === 'owned' && owner.ownerHostId === this.store.hostId && owner.mutationsPermitted,
        'OWNERSHIP_REVISION_CONFLICT', 'Read current ownership and select its exact local owner revision before transfer.', 3);
    } else {
      const release = intent.releaseRef && this.store.record<Release>('deviceOwnershipIncoming', intent.releaseRef);
      requireValue(release && release.deviceId === intent.deviceId && release.repositoryId === repo.id && release.fromHostId === intent.fromHostId && release.toHostId === intent.toHostId && release.previousRevision === intent.expectedRevision,
        'RELEASE_REFERENCE_REQUIRED', 'This host needs the exact release retained through its authenticated peer channel. An offline former owner without that receipt remains unconfirmed.', 3);
    }
    this.idle(intent.deviceId);
    return this.store.admit(requestId, 'device_transfer', repo.id, input, payload, 'queued', op => ({ acceptance: {
      localDurable: true, executionHostAccepted: true, executionHostId: this.store.hostId, acceptedAt: op.createdAt }, transferId: intent.releaseRef ?? requestId }));
  }
  private async release(op: Operation, repo: Enrolled, intent: Intent, signal: AbortSignal): Promise<Release> {
    const retained = this.store.record<Release>('deviceOwnershipRelease', op.requestId);
    if (retained) {
      requireValue(retained.deviceId === intent.deviceId && retained.toHostId === intent.toHostId && retained.previousRevision === intent.expectedRevision, 'REQUEST_ID_CONFLICT', 'The retained release belongs to another intent.');
      return retained;
    }
    this.enabled(); this.peer(repo, intent.toHostId); this.idle(intent.deviceId, op.operationId);
    let fence = this.store.record<Fence>('deviceOwnershipFence', intent.deviceId);
    if (fence) requireValue(fence.operationId === op.operationId && digest(fence.intent) === digest(intent), 'DEVICE_TRANSFER_PENDING', 'Another retained ownership transfer must be reconciled first.', 3);
    else {
      const owner = this.devices.ownership(intent.deviceId);
      requireValue(owner.revision === intent.expectedRevision && owner.state === 'owned' && owner.ownerHostId === this.store.hostId && owner.mutationsPermitted,
        'OWNERSHIP_REVISION_CONFLICT', 'Ownership changed after transfer admission.', 3);
      fence = { operationId: op.operationId, releaseId: op.requestId, intent, owner, releaseDispatched: false };
      this.store.update(this.store.get(op.operationId), { effectDispatched: true, stage: 'ownership_fenced' }, 'device.ownership_fenced', () => {
        this.store.put('deviceOwnershipFence', intent.deviceId, fence);
        this.devices.saveOwnership({ ...owner, state: 'transfer_pending', mutationsPermitted: false, selectedHostId: intent.toHostId, reasonCodes: ['DEVICE_TRANSFER_PENDING'] });
      });
    }
    const appIdentity = this.app(repo), profile = this.devices.profile(repo);
    let observation = await this.devices.observe(repo, intent.deviceId); this.readiness(observation, false);
    let evidenceRefs: string[] = [];
    if (observation.session === 'owned') {
      requireValue(!fence.releaseDispatched, 'SESSION_RELEASE_UNCONFIRMED', 'A prior session release was dispatched. Observe its completion without repeating cleanup.', 3);
      requireValue(this.devices.backend.releaseOwnedSession, 'SESSION_RELEASE_UNAVAILABLE', 'The selected backend cannot safely release its exact owned session yet.', 3);
      requireValue(!signal.aborted, 'CANCELLED', 'Host transfer was cancelled before session cleanup.', 130);
      fence = { ...fence, releaseDispatched: true };
      this.store.update(this.store.get(op.operationId), { effectDispatched: true, stage: 'releasing_owned_session' }, 'device.session_release_started', () => this.store.put('deviceOwnershipFence', intent.deviceId, fence));
      const result = await this.devices.backend.releaseOwnedSession(intent.deviceId, profile, signal);
      requireValue(result.released && result.evidenceRefs.length, 'SESSION_RELEASE_UNCONFIRMED', 'Session cleanup did not return confirmed retained evidence.', 6);
      evidenceRefs = result.evidenceRefs;
      observation = await this.devices.observe(repo, intent.deviceId);
    }
    this.readiness(observation, true); this.idle(intent.deviceId, op.operationId);
    requireValue(this.devices.profile(repo).revision === profile.revision && this.app(repo) === appIdentity, 'POLICY_CHANGED', 'Device policy changed while releasing the session.', 3);
    const current = this.devices.ownership(intent.deviceId);
    requireValue(current.state === 'transfer_pending' && current.revision === intent.expectedRevision && current.ownerHostId === this.store.hostId,
      'OWNERSHIP_REVISION_CONFLICT', 'The retained local transfer fence changed. Preserve it for reconciliation.', 3);
    const evidenceRef = id(); this.store.put('deviceOwnershipObservation', evidenceRef, { recordMode: this.devices.mode, observation, operationId: op.operationId });
    const release: Release = { schemaVersion: 1, recordMode: this.devices.mode, releaseId: op.requestId, ownershipId: current.ownershipId, repositoryId: repo.id,
      deviceId: intent.deviceId, fromHostId: this.store.hostId, toHostId: intent.toHostId, previousRevision: intent.expectedRevision, revision: id(), appIdentity,
      releasedAt: now(), evidenceRefs: [...evidenceRefs, evidenceRef] };
    // The old host stays unable to mutate even when delivery or the new host fails.
    const latest = this.store.get(op.operationId);
    this.store.update(latest, { effectDispatched: true, stage: 'ownership_released', result: { ...latest.result, releaseRef: release.releaseId, release } }, 'device.ownership_released', () => {
      this.store.put('deviceOwnershipRelease', release.releaseId, release);
      this.devices.saveOwnership({ ...current, state: 'unowned', mutationsPermitted: false, ownerHostId: intent.toHostId, previousHostId: this.store.hostId,
        revision: release.revision, priorSession: 'released', releaseReceiptRef: release.releaseId, externalSession: 'absent', observedAt: observation.observedAt, reasonCodes: ['DESTINATION_ACCEPTANCE_PENDING'] });
      this.store.put('deviceOwnershipFence', intent.deviceId, null);
    });
    return release;
  }
  private parseRelease(repo: Enrolled, from: string, value: unknown): Release {
    const raw = object(value), fields = ['schemaVersion', 'recordMode', 'releaseId', 'ownershipId', 'repositoryId', 'deviceId', 'fromHostId', 'toHostId', 'previousRevision', 'revision', 'appIdentity', 'releasedAt', 'evidenceRefs'];
    requireValue(Object.keys(raw).length === fields.length && fields.every(field => field in raw), 'INVALID_OWNERSHIP_RELEASE', 'Unexpected release fields.', 2);
    for (const field of ['releaseId', 'ownershipId', 'fromHostId', 'toHostId']) requireValue(typeof raw[field] === 'string' && validateContractFormat('uuid', raw[field] as string), 'INVALID_OWNERSHIP_RELEASE', 'Invalid release identity.', 2);
    for (const field of ['deviceId', 'previousRevision', 'revision', 'appIdentity']) string(raw[field], field);
    requireValue(raw['schemaVersion'] === 1 && raw['recordMode'] === this.devices.mode && raw['repositoryId'] === repo.id && raw['fromHostId'] === from && raw['toHostId'] === this.store.hostId &&
      Array.isArray(raw['evidenceRefs']) && raw['evidenceRefs'].length > 0 && raw['evidenceRefs'].length <= 32 && raw['evidenceRefs'].every(item => typeof item === 'string' && item.length <= 256) &&
      typeof raw['releasedAt'] === 'string' && validateContractFormat('date-time', raw['releasedAt']),
    'INVALID_OWNERSHIP_RELEASE', 'The release must identify its authenticated source, selected destination, evidence mode and exact repository.', 3);
    return raw as unknown as Release;
  }
  async receive(repo: Enrolled, from: string, value: unknown): Promise<ObjectValue> {
    this.peer(repo, from); const release = this.parseRelease(repo, from, value);
    const retained = this.store.record<Release>('deviceOwnershipIncoming', release.releaseId);
    requireValue(!retained || digest(retained) === digest(release), 'REQUEST_ID_CONFLICT', 'A release reference cannot change its immutable scope.');
    // Retain the authenticated receipt even if the destination is currently disabled,
    // offline from its phone or not independently trusted. It grants no authority.
    if (!retained) this.store.put('deviceOwnershipIncoming', release.releaseId, release);
    return this.accept(repo, release);
  }
  private async accept(repo: Enrolled, release: Release, operationId?: string): Promise<ObjectValue> {
    const accepted = this.store.record<ObjectValue>('deviceOwnershipAcceptance', release.releaseId); if (accepted) return accepted;
    this.enabled(); this.peer(repo, release.fromHostId);
    requireValue(!this.store.getMeta('paused'), 'SERVICE_PAUSED', 'Ownership admission waits for the selected host to resume.', 3);
    requireValue(this.app(repo) === release.appIdentity, 'APP_IDENTITY_MISMATCH', 'The destination must independently approve the same app identity.', 3);
    requireValue(!this.receiving.has(release.deviceId), 'DEVICE_BUSY', 'Another ownership observation is in progress.', 3);
    this.receiving.add(release.deviceId);
    try {
      this.idle(release.deviceId, operationId);
      const owner = this.devices.ownership(release.deviceId), profileRevision = this.devices.profile(repo).revision;
      requireValue(owner.state === 'unowned' && owner.ownerHostId !== this.store.hostId &&
        (owner.ownerHostId === null || (owner.ownerHostId === release.fromHostId && owner.revision === release.previousRevision)),
      'PREVIOUS_OWNER_UNCONFIRMED', 'Local ownership history does not agree with this relinquishment. No takeover is inferred from elapsed time.', 3);
      const observation = await this.devices.observe(repo, release.deviceId); this.readiness(observation, true);
      this.idle(release.deviceId, operationId);
      this.enabled(); this.peer(repo, release.fromHostId);
      requireValue(!this.store.getMeta('paused'), 'SERVICE_PAUSED', 'The selected host paused during ownership observation.', 3);
      requireValue(digest(this.devices.ownership(release.deviceId)) === digest(owner) && this.devices.profile(repo).revision === profileRevision,
        'OWNERSHIP_REVISION_CONFLICT', 'Destination ownership or policy changed during observation.', 3);
      const next: DeviceOwnership = { ...owner, ownershipId: release.ownershipId, ownerHostId: this.store.hostId, selectedHostId: this.store.hostId,
        previousHostId: release.fromHostId, state: 'owned', mutationsPermitted: true, revision: release.revision, priorSession: 'released',
        releaseReceiptRef: release.releaseId, recoveryEvidenceRefs: [], externalSession: 'absent', observedAt: observation.observedAt, reasonCodes: [] };
      assertContract('device-ownership', next);
      const response = { transferId: release.releaseId, releaseRef: release.releaseId, deviceId: release.deviceId, revision: release.revision,
        ownerHostId: this.store.hostId, destinationAccepted: true, acceptedAt: now(), recordMode: this.devices.mode };
      this.store.transaction(() => { this.devices.saveOwnership(next); this.store.put('deviceOwnershipAcceptance', release.releaseId, response); this.store.put('deviceOwnershipObservation', release.releaseId, { recordMode: this.devices.mode, observation }); });
      return response;
    } finally { this.receiving.delete(release.deviceId); }
  }
  async execute(op: Operation, repo: Enrolled, signal: AbortSignal): Promise<ObjectValue> {
    const intent = op.input['intent'] as unknown as Intent;
    requireValue(!signal.aborted, 'CANCELLED', 'Host transfer was cancelled before dispatch.', 130);
    if (intent.fromHostId === this.store.hostId) {
      const release = await this.release(op, repo, intent, signal);
      const response = await this.call(intent.toHostId, 'device.ownership.accept', { repositoryId: repo.id, release });
      requireValue(response['transferId'] === release.releaseId && response['revision'] === release.revision && response['ownerHostId'] === intent.toHostId && response['destinationAccepted'] === true,
        'OWNERSHIP_RECEIPT_INVALID', 'The destination did not confirm this exact retained transfer.', 6);
      this.store.put('deviceOwnershipDelivered', release.releaseId, response);
      const owner = this.devices.ownership(intent.deviceId);
      if (owner.revision === release.revision && owner.ownerHostId === intent.toHostId && owner.state === 'unowned') this.devices.saveOwnership({ ...owner, reasonCodes: [] });
      return { transfer: response, releaseRef: release.releaseId };
    }
    const release = intent.releaseRef && this.store.record<Release>('deviceOwnershipIncoming', intent.releaseRef);
    requireValue(release, 'RELEASE_REFERENCE_REQUIRED', 'No authenticated retained release is available.', 3);
    const transfer = await this.accept(repo, release, op.operationId);
    return { transfer, releaseRef: release.releaseId };
  }
}
