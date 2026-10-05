import { writeFileSync, appendFileSync, statSync, existsSync, mkdirSync, openSync, readSync, closeSync, fsyncSync, chmodSync } from 'node:fs';
import { join, basename } from 'node:path';
import { assertContract, validateContractFormat } from '@contribution/contracts';
import type { ArtifactProvenance, DeviceProfileConfiguration } from '@contribution/contracts';
import { digest, id, now, requireValue, object, string, Fault } from './core.js';
import type { ObjectValue } from './core.js';
import type { Journal, Operation } from './journal.js';
import type { Enrolled } from './repositories.js';
import type { RetainedDeviceArtifact, DeviceProfile } from './devices.js';
import { privateDirectory } from './private-files.js';
import { extractSignedAppArchive } from './app-archive.js';
import { appTreeDigest, inspectSignedApp, artifactFileDigest } from './device-artifacts.js';
import { requireArtifactAvailable } from './storage.js';

type PeerCall = (hostId: string, action: string, body: ObjectValue) => Promise<ObjectValue>;
interface Manifest { schemaVersion: 1; transferId: string; requestId: string; repositoryId: string; senderHostId: string; receiverHostId: string; provenance: ArtifactProvenance; appName: string; appDigest: string }
interface Incoming { manifest: Manifest; directory: string; path: string; policy: string; accepted?: ObjectValue }
const CHUNK = 256 * 1024, CAPACITY = 4 * 1024 ** 3;
function sync(path: string): void { const fd = openSync(path, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } }
function uuid(value: unknown): string { const text = string(value, 'transfer identity'); requireValue(validateContractFormat('uuid', text), 'INVALID_TRANSFER', 'Transfer and host identities must be UUIDs.', 2); return text; }
function slice(path: string, offset: number, length: number): Buffer {
  const fd = openSync(path, 'r'); try { const bytes = Buffer.alloc(length); requireValue(readSync(fd, bytes, 0, length, offset) === length, 'ARTIFACT_CHANGED', 'The retained archive changed during transfer.'); return bytes; } finally { closeSync(fd); }
}
function appIdentity(app: ArtifactProvenance['app']): string { return digest({ bundleId: app.bundleId, teamId: app.teamId, applicationIdentifier: app.applicationIdentifier }); }

/** Artifact transport uses the existing paired-host envelope and operation
 * journal. Receiving bytes never dispatches a device effect or changes Git authority.
 */
export class DeviceArtifactTransfers {
  constructor(readonly store: Journal, readonly mode: 'observed' | 'fixture', readonly call: PeerCall) {}
  private enabled(): void { requireValue(this.store.getMeta<{ remoteDevices?: { enabled: boolean } }>('settings')?.remoteDevices?.enabled, 'DEVICE_MODULE_DISABLED', 'Enable Remote Devices before starting an artifact transfer.', 3); }
  admit(repo: Enrolled, artifactId: string, toHost: string, requestId: string, payload: string): Operation {
    const input = { artifactId, toHost }, previous = this.store.existing(requestId, 'artifact_transfer', repo.id, input); if (previous) return previous;
    this.enabled();
    uuid(toHost); requireValue(toHost !== this.store.hostId && this.store.record('peer', toHost), 'PEER_ROUTE_REQUIRED', 'Select an explicitly paired different host.', 3);
    const authority = this.store.record<{ phase: string; peerHostId: string }>('authority', repo.id);
    requireValue(repo.availability === 'both-macs' && authority?.phase === 'active' && authority.peerHostId === toHost, 'REPOSITORY_PEER_UNAUTHORIZED', 'This repository is not associated with the destination host.', 3);
    const artifact = this.store.record<RetainedDeviceArtifact>('deviceArtifact', artifactId);
    requireValue(artifact && artifact.provenance.repositoryId === repo.id && artifact.provenance.recordMode === this.mode, 'ARTIFACT_UNAUTHORIZED', 'Select a retained artifact belonging to this repository and evidence mode.', 3);
    assertContract('artifact-provenance', artifact.provenance);
    requireArtifactAvailable(this.store, artifact);
    const manifest: Manifest = { schemaVersion: 1, transferId: id(), requestId, repositoryId: repo.id, senderHostId: this.store.hostId, receiverHostId: toHost, provenance: artifact.provenance, appName: basename(artifact.appPath), appDigest: string(artifact.appDigest, 'sealed app digest') };
    return this.store.admit(requestId, 'artifact_transfer', repo.id, input, payload, 'queued', op => {
      this.store.put('artifactOutbox', op.operationId, { manifest, path: artifact.path });
      return { transferId: manifest.transferId, artifactId, executionHostId: this.store.hostId, destinationHostId: toHost, delivery: 'not_dispatched', phoneEffect: 'not_requested' };
    });
  }
  async execute(op: Operation, signal: AbortSignal): Promise<ObjectValue> {
    this.enabled();
    const outbox = this.store.record<{ manifest: Manifest; path: string }>('artifactOutbox', op.operationId); requireValue(outbox, 'ARTIFACT_TRANSFER_INCOMPLETE', 'The immutable artifact transfer intent is unavailable.', 3);
    const { manifest: m, path } = outbox, expected = m.provenance.artifact;
    requireValue(statSync(path).size === expected.bytes && artifactFileDigest(path) === expected.sha256, 'ARTIFACT_CHANGED', 'The selected immutable archive changed before transfer.');
    const body = { repositoryId: m.repositoryId, transferId: m.transferId };
    const check = (): void => { this.enabled(); requireValue(!signal.aborted, 'CANCELLED', 'Artifact transfer was cancelled; already received private bytes remain retained without installation authority.', 130); };
    check(); let response = await this.call(m.receiverHostId, 'artifact.begin', { ...body, manifest: m });
    if (response['accepted']) return this.confirm(m, object(response['accepted']));
    let offset = Number(response['offset']); requireValue(Number.isSafeInteger(offset) && offset >= 0 && offset <= expected.bytes, 'PEER_PROTOCOL_ERROR', 'The receiver returned an invalid retained byte offset.', 3);
    while (offset < expected.bytes) {
      check(); const data = slice(path, offset, Math.min(CHUNK, expected.bytes - offset));
      response = await this.call(m.receiverHostId, 'artifact.chunk', { ...body, offset, data: data.toString('base64') });
      requireValue(response['offset'] === offset + data.length, 'PEER_PROTOCOL_ERROR', 'The receiver did not acknowledge the exact immutable chunk.', 3);
      offset += data.length; this.store.log(op, `[artifact transfer] ${offset}/${expected.bytes} bytes acknowledged\n`);
      const latest = this.store.get(op.operationId); this.store.update(latest, { stage: 'transferring_artifact', result: { ...latest.result, acknowledgedBytes: offset } });
    }
    check(); requireValue(artifactFileDigest(path) === expected.sha256, 'ARTIFACT_CHANGED', 'The archive changed during transfer.');
    this.store.update(this.store.get(op.operationId), { stage: 'verifying_remote_artifact', effectDispatched: true });
    response = await this.call(m.receiverHostId, 'artifact.finish', body);
    return this.confirm(m, response);
  }
  private confirm(m: Manifest, receipt: ObjectValue): ObjectValue {
    requireValue(receipt['transferId'] === m.transferId && receipt['artifactId'] === m.provenance.artifactId && receipt['sha256'] === m.provenance.artifact.sha256 && receipt['provenanceDigest'] === digest(m.provenance) && receipt['receiverHostId'] === m.receiverHostId,
      'ARTIFACT_RECEIPT_INVALID', 'The remote receipt differs from the selected immutable artifact.', 3);
    this.store.put('artifactDelivery', m.transferId, receipt);
    return { transferId: m.transferId, artifactId: m.provenance.artifactId, delivery: 'retained_and_verified', receipt, phoneEffect: 'not_requested' };
  }
  private profile(repo: Enrolled, m: Manifest): DeviceProfile {
    requireValue(this.store.getMeta<{ remoteDevices?: { enabled: boolean } }>('settings')?.remoteDevices?.enabled, 'DEVICE_MODULE_DISABLED', 'Remote Devices must be enabled on the receiving host.', 3);
    const profile = this.store.record<DeviceProfile>('deviceProfile', repo.id), config = this.store.record<{ config: DeviceProfileConfiguration }>('deviceBuildProfile', repo.id)?.config;
    requireValue(profile && appIdentity(profile.app) === appIdentity(m.provenance.app) && config?.eligibleDeviceRefs.some(device => m.provenance.signing.eligibleDeviceRefs.includes(device)), 'ARTIFACT_UNAUTHORIZED', 'The receiving host has no approved project/app/device scope for this artifact.', 3); return profile;
  }
  async receive(repo: Enrolled, from: string, action: string, body: ObjectValue): Promise<ObjectValue> {
    const transferId = uuid(body['transferId']);
    if (action === 'artifact.begin') {
      const m = object(body['manifest']) as unknown as Manifest;
      requireValue(Object.keys(m).sort().join(',') === ['schemaVersion','transferId','requestId','repositoryId','senderHostId','receiverHostId','provenance','appName','appDigest'].sort().join(','), 'INVALID_TRANSFER', 'Unexpected artifact manifest fields.', 2);
      try { assertContract('artifact-provenance', m.provenance); } catch { throw new Fault('INVALID_TRANSFER', 'Artifact provenance does not match the installed contract.', 2); }
      requireValue(m.schemaVersion === 1 && m.transferId === transferId && m.repositoryId === repo.id && m.provenance.repositoryId === repo.id && m.senderHostId === from && m.receiverHostId === this.store.hostId && m.provenance.recordMode === this.mode && m.provenance.artifact.format === 'signed_app_archive' && m.provenance.artifact.bytes <= 1024 ** 3 && /^[a-f0-9]{64}$/.test(m.appDigest) && /^[A-Za-z0-9][A-Za-z0-9 _.()-]{0,120}\.app$/.test(m.appName),
        'ARTIFACT_TRANSFER_IDENTITY_MISMATCH', 'Artifact mode, identities, format or bounds do not match this host.', 3);
      string(m.requestId, 'requestId'); const previous = this.store.record<Incoming>('artifactIncoming', transferId);
      if (previous) {
        requireValue(digest(previous.manifest) === digest(m), 'TRANSFER_ID_CONFLICT', 'The transfer identity has different immutable contents.');
        // A retained completion receipt is historical observation, even after
        // later policy changes. No new bytes or effects follow this reply.
        if (!previous.accepted) requireValue(this.profile(repo, m).revision === previous.policy, 'POLICY_CHANGED', 'The receiving scope changed during the retained transfer.');
        return { transferId, offset: previous.accepted ? previous.manifest.provenance.artifact.bytes : statSync(previous.path).size, accepted: previous.accepted ?? null };
      }
      const profile = this.profile(repo, m);
      this.store.assertRepositoryAvailable(repo.id); this.store.assertAdmissionStorage();
      const request = this.store.records<Incoming>('artifactIncoming').find(item => item.manifest.senderHostId === from && item.manifest.requestId === m.requestId);
      requireValue(!request, 'REQUEST_ID_CONFLICT', 'This sender already retained a transfer for this request.');
      const pending = this.store.records<Incoming>('artifactIncoming').filter(item => !item.accepted || this.store.record<{ state: string }>('storageEviction', `incoming:${item.manifest.transferId}`)?.state !== 'removed');
      requireValue(pending.filter(item => !item.accepted && item.manifest.repositoryId === repo.id).length < 3 && pending.reduce((sum, item) => sum + item.manifest.provenance.artifact.bytes * 3, m.provenance.artifact.bytes * 3) <= CAPACITY, 'ARTIFACT_STORAGE_QUOTA', 'Retained artifact transfers reached their private storage reservation. Reconcile and prune eligible transfers first.', 3);
      const root = join(this.store.directory, 'artifact-incoming'); privateDirectory(root);
      const directory = join(root, transferId); requireValue(!existsSync(directory), 'TRANSFER_RECOVERY_REQUIRED', 'An unrecorded incoming directory must be reconciled before reusing this transfer identity.', 3);
      mkdirSync(directory, { mode: 0o700 }); const path = join(directory, 'signed-app.zip'); writeFileSync(path, '', { mode: 0o600, flag: 'wx' }); sync(path); sync(directory); sync(root);
      this.store.put('artifactIncoming', transferId, { manifest: m, directory, path, policy: profile.revision }); return { transferId, offset: 0, accepted: null };
    }
    const incoming = this.store.record<Incoming>('artifactIncoming', transferId);
    requireValue(incoming && incoming.manifest.repositoryId === repo.id && incoming.manifest.senderHostId === from, 'TRANSFER_NOT_FOUND', 'This peer has no matching retained artifact transfer.', 3);
    const m = incoming.manifest;
    if (incoming.accepted) { requireValue(action === 'artifact.finish', 'TRANSFER_ALREADY_COMPLETE', 'This artifact is already sealed.'); return incoming.accepted; }
    requireValue(this.profile(repo, m).revision === incoming.policy, 'POLICY_CHANGED', 'The receiving project/device scope changed while bytes were in flight. Reconcile this retained transfer before a new selection.', 3);
    if (action === 'artifact.chunk') {
      const encoded = body['data'], offset = Number(body['offset']), current = statSync(incoming.path).size;
      requireValue(typeof encoded === 'string' && encoded.length <= Math.ceil(CHUNK / 3) * 4 && /^[A-Za-z0-9+/]+={0,2}$/.test(encoded), 'INVALID_CHUNK', 'Artifact chunk is not bounded canonical base64.', 2);
      const data = Buffer.from(encoded, 'base64');
      requireValue(data.toString('base64') === encoded && data.length > 0 && data.length <= CHUNK && Number.isSafeInteger(offset) && offset >= 0 && offset + data.length <= m.provenance.artifact.bytes, 'INVALID_CHUNK', 'Artifact chunk range is invalid.', 2);
      if (offset < current) requireValue(offset + data.length <= current && slice(incoming.path, offset, data.length).equals(data), 'CHUNK_CONFLICT', 'Previously acknowledged artifact bytes differ.');
      else { requireValue(offset === current, 'CHUNK_OFFSET', 'Resume artifact transfer at its last retained offset.'); appendFileSync(incoming.path, data); sync(incoming.path); }
      return { transferId, offset: statSync(incoming.path).size };
    }
    requireValue(action === 'artifact.finish', 'PEER_ACTION_UNSUPPORTED', 'Unknown artifact transfer action.', 2);
    requireValue(statSync(incoming.path).size === m.provenance.artifact.bytes && artifactFileDigest(incoming.path) === m.provenance.artifact.sha256, 'ARTIFACT_CHANGED', 'Received bytes differ from the immutable artifact manifest.');
    const extraction = extractSignedAppArchive(incoming.path, join(incoming.directory, `materialized-${id()}`), m.appName);
    requireValue(appTreeDigest(extraction.appPath) === m.appDigest, 'ARTIFACT_CHANGED', 'The extracted signed app differs from its retained tree identity.');
    if (this.mode === 'observed') {
      const approved = this.store.record<{ config: DeviceProfileConfiguration }>('deviceBuildProfile', repo.id)!.config.eligibleDeviceRefs;
      const devices = m.provenance.signing.eligibleDeviceRefs.filter(deviceId => approved.includes(deviceId)).flatMap(deviceId => {
        const selected = this.store.record<{ udid: string }>('coreDeviceSelection', deviceId); return selected?.udid ? [{ deviceId, udid: selected.udid }] : [];
      });
      requireValue(devices.length > 0, 'DEVICE_IDENTITY_REQUIRED', 'Receiving verification needs a previously observed local physical identity.', 3);
      const signing = await inspectSignedApp(extraction.appPath, m.provenance.app, m.provenance.signing.mode, devices);
      requireValue(signing.entitlementsDigest === m.provenance.signing.entitlementsDigest && signing.provisioningProfileDigest === m.provenance.signing.provisioningProfileDigest, 'ARTIFACT_CHANGED', 'Received signing inputs differ from the retained provenance.');
    }
    // Recheck policy and archive after asynchronous native signature verification.
    requireValue(this.profile(repo, m).revision === incoming.policy && artifactFileDigest(incoming.path) === m.provenance.artifact.sha256, 'POLICY_CHANGED', 'Artifact or destination policy changed during verification.');
    const previous = this.store.record<RetainedDeviceArtifact>('deviceArtifact', m.provenance.artifactId);
    requireValue(!previous || digest(previous.provenance) === digest(m.provenance), 'ARTIFACT_ID_CONFLICT', 'A different artifact already owns this artifact identity.');
    chmodSync(incoming.path, 0o400); sync(incoming.path);
    const receipt = { transferId, artifactId: m.provenance.artifactId, sha256: m.provenance.artifact.sha256, provenanceDigest: digest(m.provenance), receiverHostId: this.store.hostId, retainedAt: now(), recordMode: this.mode, verification: this.mode === 'observed' ? 'archive_app_signature_and_provisioning' : 'fixture_archive_only', phoneEffect: 'not_requested' };
    this.store.transaction(() => {
      this.store.put('deviceArtifact', m.provenance.artifactId, { provenance: m.provenance, path: incoming.path, appPath: extraction.appPath, appDigest: m.appDigest });
      this.store.put('artifactIncoming', transferId, { ...incoming, accepted: receipt });
    }); return receipt;
  }
}
