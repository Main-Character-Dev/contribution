import { statSync } from 'node:fs';
import { assertContract } from '@contribution/contracts';
import type { DeviceCapability, DeviceContext, DeviceOwnership, DeviceOperation, DeviceTestEvidence, ArtifactProvenance, Response } from '@contribution/contracts';
import { digest, id, now, requireValue, Fault, object, string, completed } from './core.js';
import type { ObjectValue } from './core.js';
import type { Journal, Operation } from './journal.js';
import type { Enrolled } from './repositories.js';
import { identity, clean } from './git.js';
import { artifactFileDigest } from './device-artifacts.js';
import { DeviceBuilds } from './device-builds.js';
import { requireArtifactAvailable } from './storage.js';
import type { DeviceBuildDriver } from './device-builds.js';
import type { AdoptedHooks } from './adopted-hooks.js';

type DeviceAction = DeviceCapability['operation'];
type Effect = DeviceOperation['effects'][number];
type Mode = 'observed' | 'fixture';
export const deviceActions: DeviceAction[] = ['connect', 'prepare', 'install', 'launch', 'logs', 'test', 'ui', 'debug', 'screenshot', 'screen_capture', 'native_xcode_destination'];
export interface DeviceProfile {
  repositoryId: string; adapterId: string; revision: string; app: DeviceOperation['intent']['app'];
  permitsForeground: boolean; configurations: string[]; buildProfiles: string[];
  plans: Record<string, { operation: DeviceAction; fixtureId: string; acceptanceId: string; authorizedOperations: [string, ...string[]]; maxAttempts: number; maxDurationSeconds: number; expectedContextDigest?: string }>;
}
export interface DeviceObservation {
  recordMode: Mode; deviceId: string; observedAt: string; context: DeviceContext;
  trust: 'trusted' | 'unpaired' | 'verification_failed' | 'revoked' | 'unknown';
  developerService: 'ready' | 'unavailable' | 'unlock_required' | 'developer_mode_required' | 'incompatible' | 'busy' | 'unknown';
  session: 'owned' | 'external' | 'none' | 'unknown'; externalSession: 'absent' | 'present' | 'unknown';
  signingReady: boolean; hostReady: boolean; reasonCodes: string[];
}
export interface DeviceBackend {
  readonly recordMode: Mode;
  readonly supportedOperations?: readonly string[];
  inventory(): Promise<{ deviceId: string; label: string }[]>;
  observe(deviceId: string, profile: DeviceProfile): Promise<DeviceObservation>;
  perform(action: Effect['operation'], receipt: DeviceOperation, parameters: ObjectValue, signal: AbortSignal): Promise<Partial<Effect>>;
  reconcile(effect: Effect, receipt: DeviceOperation): Promise<Partial<Effect>>;
  verifyArtifact(artifact: RetainedDeviceArtifact, receipt: DeviceOperation): Promise<void>;
  verifyInstalledApp(receipt: DeviceOperation): Promise<void>;
  releaseOwnedSession?(deviceId: string, profile: DeviceProfile, signal: AbortSignal): Promise<{ released: boolean; evidenceRefs: string[] }>;
}
interface Grant { hostId: string; deviceId: string; repositoryId: string; appIdentity: string; policyRevision: string; operations: string[]; revision: string; updatedAt: string }
export interface RetainedDeviceArtifact { provenance: ArtifactProvenance; path: string; appPath: string; appDigest?: string }

/** Devices use the same journal and scheduler. No backend is authority by itself. */
export class Devices {
  readonly builds: DeviceBuilds;
  constructor(readonly store: Journal, readonly backend: DeviceBackend, readonly payload: string, readonly mode: Mode = 'observed', buildDriver?: DeviceBuildDriver, hooks?: Pick<AdoptedHooks, 'verify'>) {
    this.builds = new DeviceBuilds(store, mode, buildDriver, hooks);
    requireValue(backend.recordMode === mode, 'FIXTURE_AUTHORITY_REJECTED', 'Fixture backends cannot run in the installed production service.', 3);
  }
  profile(repo: Enrolled): DeviceProfile {
    const profile = this.store.record<DeviceProfile>('deviceProfile', repo.id);
    requireValue(profile, 'DEVICE_ADAPTER_UNCONFIGURED', 'Configure the project-owned app identity and build/qualification adapter first.', 3);
    requireValue(profile.repositoryId === repo.id, 'DEVICE_IDENTITY_MISMATCH', 'Device adapter belongs to a different repository.'); return profile;
  }
  private enabled(): void {
    requireValue(this.store.getMeta<{ remoteDevices?: { enabled: boolean } }>('settings')?.remoteDevices?.enabled, 'DEVICE_MODULE_DISABLED', 'Enable Remote Devices on this selected host first.', 3);
  }
  private key(repo: Enrolled, device: string): string { return digest({ repo: repo.id, device, host: this.store.hostId }); }
  private appIdentity(profile: DeviceProfile): string { return digest({ bundle: profile.app.bundleId, team: profile.app.teamId, application: profile.app.applicationIdentifier }); }
  async observe(repo: Enrolled, deviceId: string): Promise<DeviceObservation> {
    const observation = await this.backend.observe(deviceId, this.profile(repo));
    requireValue(observation.recordMode === this.mode && observation.deviceId === deviceId && observation.context.device.deviceId === deviceId && observation.context.host.hostId === this.store.hostId,
      'DEVICE_IDENTITY_MISMATCH', 'The authenticated device/backend observation does not match the selected scope.');
    // Validate the shared context without projecting away its conditional rules.
    this.capability('connect', observation.context);
    this.store.put('deviceObservation', this.key(repo, deviceId), observation); return observation;
  }
  ownership(deviceId: string): DeviceOwnership {
    const prior = this.store.record<DeviceOwnership>('deviceOwnership', deviceId); if (prior) return prior;
    const owner: DeviceOwnership = { schemaVersion: 1, recordMode: this.mode, ownershipId: id(), deviceId, ownerHostId: null, selectedHostId: this.store.hostId, previousHostId: null,
      state: 'unowned', mutationsPermitted: false, revision: id(), activeOperationIds: [], leaseExpiresAt: null, priorSession: 'unknown', releaseReceiptRef: null,
      recoveryEvidenceRefs: [], externalSession: 'unknown', observedAt: null, reasonCodes: ['PREVIOUS_OWNER_UNCONFIRMED'] };
    this.saveOwnership(owner); return owner;
  }
  saveOwnership(owner: DeviceOwnership): void { assertContract('device-ownership', owner); requireValue(owner.recordMode === this.mode, 'FIXTURE_AUTHORITY_REJECTED', 'Ownership evidence mode differs from this service.'); this.store.put('deviceOwnership', owner.deviceId, owner); }
  capability(action: DeviceAction, context: DeviceContext): DeviceCapability {
    const key = digest({ action, context }), found = this.store.record<DeviceCapability>('deviceCapability', key);
    if (found) {
      assertContract('device-capability', found);
      requireValue(found.recordMode === this.mode && digest(found.context) === digest(context), 'CAPABILITY_CONTEXT_CHANGED', 'Retained capability does not match this exact context.'); return found;
    }
    const value: DeviceCapability = { schemaVersion: 1, recordMode: this.mode, capabilityId: key, operation: action, support: 'unverified', context,
      qualifiedAt: null, evidenceIds: [], limitations: ['No reviewed evidence qualifies this exact operation and context.'], reasonCodes: ['CAPABILITY_UNVERIFIED'] };
    assertContract('device-capability', value); return value;
  }
  promote(evidence: DeviceTestEvidence, reviewed: boolean, repositoryId?: string): DeviceCapability {
    assertContract('device-test-evidence', evidence);
    requireValue(reviewed && evidence.recordMode === 'observed' && this.mode === 'observed' && evidence.evidenceKind === 'physical_device' && evidence.executionStatus === 'executed' && evidence.outcome === 'passed',
      'PHYSICAL_EVIDENCE_REQUIRED', 'Only reviewed observed execution can qualify a physical capability. Fixture shape never establishes support.');
    requireValue(evidence.operationIds.length > 0 && evidence.evidenceRefs.length > 0 && evidence.missingProof.length === 0, 'PHYSICAL_EVIDENCE_INCOMPLETE', 'Qualification needs retained observed operations and complete required proof.');
    const context = evidence.context;
    requireValue(context.host.hostId === this.store.hostId && context.host.architecture !== 'unknown' && context.host.macOSVersion && context.host.macOSBuild && context.host.xcodeVersion && context.host.xcodeBuild &&
      context.device.iOSVersion && context.device.iOSBuild && context.backend.version && context.backend.revision && context.engineVersion && context.network.scenario !== 'unknown',
      'QUALIFICATION_CONTEXT_INCOMPLETE', 'Physical support requires observed host/device/toolchain/backend versions and the actual network scenario.');
    requireValue(evidence.startedAt && evidence.completedAt && Date.parse(evidence.startedAt) <= Date.parse(evidence.completedAt), 'PHYSICAL_EVIDENCE_INCOMPLETE', 'The physical proof needs an ordered observed time window.');
    let qualifiedAction = false; const refs = new Set<string>();
    for (const opId of evidence.operationIds) {
      const op = this.store.get(opId), receipt = op.result['deviceOperation'] as DeviceOperation | undefined;
      try { assertContract('device-operation', receipt); } catch { throw new Fault('PHYSICAL_EVIDENCE_INCOMPLETE', 'A retained operation no longer has a valid device receipt.', 3); }
      requireValue(op.kind === 'device' && op.state === 'succeeded' && (!repositoryId || op.repositoryId === repositoryId) && receipt?.recordMode === 'observed' && receipt.operationState === 'succeeded' && receipt.resultCertainty === 'confirmed' &&
        digest(receipt.context) === digest(evidence.context) && receipt.startedAt && receipt.completedAt && Date.parse(receipt.startedAt) >= Date.parse(evidence.startedAt) && Date.parse(receipt.completedAt) <= Date.parse(evidence.completedAt),
        'PHYSICAL_EVIDENCE_INCOMPLETE', 'Every cited operation must confirm the selected repository, exact context and observed time window.');
      for (const effect of receipt.effects) {
        if (effect.state === 'succeeded') this.validateReadback(effect, receipt);
        if (effect.operation === evidence.operation && effect.state === 'succeeded' && effect.certainty === 'confirmed' && effect.evidenceRefs.length &&
          receipt.intent.mode === 'qualification' && receipt.intent.qualification?.acceptanceId === evidence.acceptanceId && receipt.intent.qualification.expectedContextDigest === digest(receipt.context)) qualifiedAction = true;
        for (const ref of effect.evidenceRefs) {
          const retained = this.store.record<{ operationId: string }>('deviceReadback', ref) ?? this.store.record<{ operationId: string }>('deviceBuildEvidence', ref);
          if (retained?.operationId === opId) refs.add(ref);
        }
      }
    }
    requireValue(qualifiedAction && evidence.evidenceRefs.every(ref => refs.has(ref)), 'PHYSICAL_EVIDENCE_INCOMPLETE', 'The named operation and acceptance case need a retained successful qualification effect and its actual readback references.');
    if (evidence.operation === 'install' && ['AT-01', 'AT-02', 'AT-03', 'AT-16'].includes(evidence.acceptanceId)) requireValue(evidence.dataRetention === 'passed', 'DATA_RETENTION_PROOF_REQUIRED', 'This installation case also requires reviewed meaningful app-data continuity proof.');
    if (evidence.context.network.scenario === 'cold_cellular') {
      const cold = evidence.coldStartProof;
      requireValue(cold.priorDeveloperSessionAbsent === true && cold.usableWifiAbsent === true && cold.usbAbsent === true && cold.phoneCellularConfirmed === true,
        'COLD_START_PROOF_REQUIRED', 'A warm or unknown session cannot establish fresh cellular support.');
    }
    if (evidence.acceptanceId === 'AT-09') requireValue(['phone', 'both'].includes(evidence.coldStartProof.restartKind), 'RESTART_PROOF_REQUIRED', 'The phone-restart case needs a recorded phone restart.');
    if (evidence.acceptanceId === 'AT-10') requireValue(['host', 'both'].includes(evidence.coldStartProof.restartKind), 'RESTART_PROOF_REQUIRED', 'The host-restart case needs a recorded host restart.');
    const prior = this.store.record<DeviceTestEvidence>('deviceEvidence', evidence.evidenceId);
    requireValue(!prior || digest(prior) === digest(evidence), 'EVIDENCE_ID_CONFLICT', 'A reviewed evidence identity cannot be rewritten.');
    const priorCapability = this.store.record<DeviceCapability>('deviceEvidenceCapability', evidence.evidenceId);
    if (prior && priorCapability) return priorCapability;
    const capability = { ...this.capability(evidence.operation, evidence.context), support: 'supported' as const, qualifiedAt: now(), evidenceIds: [evidence.evidenceId], limitations: [], reasonCodes: [] };
    this.store.transaction(() => { this.store.put('deviceEvidence', evidence.evidenceId, evidence); this.store.put('deviceCapability', capability.capabilityId, capability); this.store.put('deviceEvidenceCapability', evidence.evidenceId, capability); }); return capability;
  }
  recordEvidence(repo: Enrolled, value: unknown, requestId: string): ObjectValue {
    try { assertContract('device-test-evidence', value); } catch { throw new Fault('DEVICE_EVIDENCE_INVALID', 'The private evidence report does not match the installed schema.', 2); }
    const evidence = value as DeviceTestEvidence;
    requireValue(evidence.recordMode === this.mode && evidence.context.host.hostId === this.store.hostId, 'FIXTURE_AUTHORITY_REJECTED', 'Evidence must match the selected service host and evidence mode.', 3);
    this.profile(repo);
    const scope = digest({ repositoryId: repo.id, evidence }), prior = this.store.record<{ digest: string; result: ObjectValue }>('deviceEvidenceRequest', requestId);
    if (prior) { requireValue(prior.digest === scope, 'REQUEST_ID_CONFLICT', 'Evidence request identity already names different content.'); return prior.result; }
    for (const operationId of evidence.operationIds) requireValue(this.store.get(operationId).repositoryId === repo.id, 'EVIDENCE_SCOPE_MISMATCH', 'Every cited operation must belong to this project.', 3);
    const existing = this.store.record<{ repositoryId: string; evidence: DeviceTestEvidence }>('deviceEvidenceDraft', evidence.evidenceId);
    requireValue(!existing || (existing.repositoryId === repo.id && digest(existing.evidence) === digest(evidence)), 'EVIDENCE_ID_CONFLICT', 'Retained evidence is immutable. Use a new identity for a corrected report.');
    const result = { evidenceId: evidence.evidenceId, revision: digest(evidence), physicalSupport: 'not_promoted', reviewRequired: true };
    this.store.transaction(() => { this.store.put('deviceEvidenceDraft', evidence.evidenceId, { repositoryId: repo.id, evidence }); this.store.put('deviceEvidenceRequest', requestId, { digest: scope, result }); }); return result;
  }
  inspectEvidence(repo: Enrolled, evidenceId: string): ObjectValue {
    const retained = this.store.record<{ repositoryId: string; evidence: DeviceTestEvidence }>('deviceEvidenceDraft', evidenceId);
    requireValue(retained?.repositoryId === repo.id, 'EVIDENCE_NOT_FOUND', 'No retained evidence report belongs to this project.', 3);
    return { evidence: retained.evidence, revision: digest(retained.evidence), reviewed: Boolean(this.store.record('deviceEvidence', evidenceId)) };
  }
  reviewEvidence(repo: Enrolled, evidenceId: string, expectedRevision: string, requestId: string): ObjectValue {
    const scope = digest({ repositoryId: repo.id, evidenceId, expectedRevision }), prior = this.store.record<{ digest: string; result: ObjectValue }>('deviceEvidenceReview', requestId);
    if (prior) { requireValue(prior.digest === scope, 'REQUEST_ID_CONFLICT', 'Review request identity has a different scope.'); return prior.result; }
    this.enabled(); const selected = this.inspectEvidence(repo, evidenceId);
    requireValue(selected['revision'] === expectedRevision, 'EVIDENCE_REVISION_CONFLICT', 'Inspect the exact retained report before reviewing it.', 3);
    const capability = this.promote(selected['evidence'] as DeviceTestEvidence, true, repo.id);
    const result = { evidenceId, capability, reviewScope: 'Named operation and exact context only; no other acceptance case or device scope is qualified.' };
    this.store.put('deviceEvidenceReview', requestId, { digest: scope, result }); return result;
  }
  authorize(repo: Enrolled, deviceId: string, operations: string[], revoke: boolean, requestId: string): ObjectValue {
    this.enabled(); const profile = this.profile(repo), key = this.key(repo, deviceId);
    requireValue(operations.length > 0 && operations.every(action => [...deviceActions, 'disconnect'].includes(action as DeviceAction)), 'INVALID_DEVICE_SCOPE', 'Select named device operations.', 2);
    const scope = { repositoryId: repo.id, deviceId, operations: [...new Set(operations)].sort(), revoke, profile: profile.revision };
    const prior = this.store.record<{ digest: string; grant: Grant }>('deviceGrantRequest', requestId);
    if (prior) { requireValue(prior.digest === digest(scope), 'REQUEST_ID_CONFLICT', 'Authorization request identity has different scope.'); return { grant: prior.grant }; }
    requireValue(this.store.record<DeviceObservation>('deviceObservation', key) || (operations.every(action => action === 'prepare') && this.builds.permitsPreparation(repo, deviceId)), 'DEVICE_IDENTITY_REQUIRED', 'Observe and enroll the selected physical device before granting operations.', 3);
    const existing = this.store.record<Grant>('deviceGrant', key);
    const allowed = new Set(existing?.appIdentity === this.appIdentity(profile) && existing.policyRevision === profile.revision ? existing.operations : []);
    for (const action of scope.operations) if (revoke) allowed.delete(action); else allowed.add(action);
    const grant: Grant = { hostId: this.store.hostId, repositoryId: repo.id, deviceId, appIdentity: this.appIdentity(profile), policyRevision: profile.revision,
      operations: [...allowed].sort(), revision: id(), updatedAt: now() };
    this.store.transaction(() => { this.store.put('deviceGrant', key, grant); this.store.put('deviceGrantRequest', requestId, { digest: digest(scope), grant }); });
    return { grant, activeEffects: 'Retained effects require reconciliation; revocation never promises rollback.' };
  }
  private permission(repo: Enrolled, deviceId: string, profile: DeviceProfile, actions: string[]): Grant {
    this.enabled(); const grant = this.store.record<Grant>('deviceGrant', this.key(repo, deviceId));
    requireValue(grant && grant.appIdentity === this.appIdentity(profile) && grant.policyRevision === profile.revision && actions.every(action => grant.operations.includes(action)),
      'AUTHORIZATION_DENIED', 'This host/device/project/app operation scope is not approved or was revoked.', 3); return grant;
  }
  private guard(repo: Enrolled, observation: DeviceObservation, actions: string[], qualification: DeviceOperation['intent']['qualification'], ownedOperationId?: string): DeviceOwnership {
    const profile = this.profile(repo); this.permission(repo, observation.deviceId, profile, actions);
    requireValue(observation.hostReady, 'HOST_OFFLINE', 'The selected host/toolchain is unavailable.', 3);
    const physical = actions.some(action => action !== 'prepare');
    requireValue(!this.backend.supportedOperations || actions.every(action => action === 'prepare' || this.backend.supportedOperations!.includes(action)),
      'BACKEND_OPERATION_UNAVAILABLE', 'The installed backend does not implement the selected operation. Select its explicit supported adapter before qualification.', 3);
    const ownership = this.ownership(observation.deviceId);
    if (physical) {
      requireValue(observation.trust === 'trusted', observation.trust === 'verification_failed' ? 'PAIR_VERIFICATION_FAILED' : 'PAIRING_REQUIRED', 'The selected host must verify trust with this exact phone.', 3);
      requireValue(observation.externalSession === 'absent', observation.externalSession === 'present' ? 'DEVICE_BUSY_EXTERNAL' : 'PREVIOUS_OWNER_UNCONFIRMED', 'Account for existing native or backend sessions before starting device work.', 3);
      requireValue(ownership.state === 'owned' && ownership.ownerHostId === this.store.hostId && ownership.mutationsPermitted && ownership.priorSession !== 'unknown', 'PREVIOUS_OWNER_UNCONFIRMED', 'Device ownership or previous effects remain unconfirmed.', 3);
      requireValue(!ownership.activeOperationIds.length || (ownedOperationId && ownership.activeOperationIds.length === 1 && ownership.activeOperationIds[0] === ownedOperationId), 'DEVICE_BUSY', 'A conflicting device operation is active.');
      if (!actions.every(action => ['connect', 'disconnect'].includes(action))) requireValue(observation.developerService === 'ready',
        observation.developerService === 'unlock_required' ? 'UNLOCK_REQUIRED' : observation.developerService === 'developer_mode_required' ? 'DEVELOPER_MODE_REQUIRED' : 'DEVELOPER_SERVICE_UNAVAILABLE',
        'The required Apple developer session is unavailable in this observed context.', 3);
    }
    if (actions.some(action => ['test', 'ui'].includes(action))) requireValue(observation.signingReady, 'SIGNING_UNAVAILABLE', 'The selected host has not verified this app signing configuration.', 3);
    for (const action of actions.filter(action => !['disconnect', 'prepare'].includes(action))) {
      const capability = this.capability(action as DeviceAction, observation.context);
      requireValue(capability.support !== 'unsupported', 'CAPABILITY_UNSUPPORTED', 'The operation is known to be incompatible with this exact context.', 3);
      if (qualification) requireValue(qualification.authorizedOperations.includes(action) && digest(observation.context) === qualification.expectedContextDigest && capability.support !== 'requires_action', 'QUALIFICATION_CONTEXT_CHANGED', 'Qualification scope or prerequisites changed.', 3);
      else requireValue(capability.support === 'supported', 'CAPABILITY_UNVERIFIED', 'Routine operation requires qualified evidence for this exact context.', 3);
    }
    return ownership;
  }
  async status(repo: Enrolled, deviceId: string, refresh: boolean): Promise<Response> {
    const observation = refresh ? await this.observe(repo, deviceId) : this.store.record<DeviceObservation>('deviceObservation', this.key(repo, deviceId));
    requireValue(observation, 'DEVICE_OBSERVATION_REQUIRED', 'Refresh this device to observe current readiness.', 3);
    const capabilities = deviceActions.map(action => this.capability(action, observation.context)), ownership = this.ownership(deviceId);
    const availability = capabilities.map(capability => {
      try { requireValue(capability.operation !== 'prepare', 'BUILD_PROFILE_SELECTION_REQUIRED', 'Select an offline host build profile first.', 3); this.guard(repo, observation, [capability.operation], null); return { operation: capability.operation, callable: refresh, capabilityId: capability.capabilityId, reasonCodes: refresh ? [] : ['STATUS_STALE'] }; }
      catch (error) { return { operation: capability.operation, callable: false, capabilityId: capability.capabilityId, reasonCodes: [error instanceof Fault ? error.code : 'READINESS_UNKNOWN'] }; }
    });
    const response = completed({ recordMode: this.mode, repositoryId: repo.id, executionHostId: this.store.hostId, canonicalHostId: repo.canonicalHostId, deviceId,
      observedAt: observation.observedAt, freshness: refresh ? 'fresh' : 'stale', network: observation.context.network,
      host: { state: observation.hostReady ? 'online' : 'unavailable', tailnet: 'unknown', reasonCodes: observation.reasonCodes },
      trust: { state: observation.trust, observedAt: observation.observedAt, reasonCodes: observation.trust === 'trusted' ? [] : ['PAIRING_REQUIRED'] },
      developerService: { state: observation.developerService, session: observation.session, sessionRef: null, reasonCodes: observation.reasonCodes },
      capabilities, availability, ownership, unresolvedOperationIds: ownership.activeOperationIds, nextActions: [] });
    assertContract('device-status', response); return response;
  }
  installedApps(repo: Enrolled, deviceId: string): ObjectValue {
    const profile = this.profile(repo);
    const rows = this.store.db.prepare("SELECT key,body FROM records WHERE namespace='deviceInstalledApp'").all();
    const apps = rows.flatMap(row => {
      const value = JSON.parse(String(row['body'])) as { repositoryId: string; hostId: string; deviceId: string; policy: string; app: DeviceProfile['app']; readback: Effect['installReadback'] };
      return value.repositoryId === repo.id && value.hostId === this.store.hostId && value.deviceId === deviceId && value.policy === profile.revision &&
        this.appIdentity({ ...profile, app: value.app }) === this.appIdentity(profile) ? [{ appRef: String(row['key']), app: value.app, observedAt: value.readback?.observedAt ?? null }] : [];
    }).sort((a, b) => String(b.observedAt).localeCompare(String(a.observedAt))).slice(0, 100);
    return { repositoryId: repo.id, executionHostId: this.store.hostId, deviceId, apps, freshness: 'retained', revalidatedBeforeDispatch: true };
  }
  private retainInstalledApp(op: Operation, receipt: DeviceOperation, effect: Effect): void {
    const latest = this.store.get(op.operationId);
    if (typeof latest.result['installedAppRef'] === 'string') return;
    const appRef = id();
    this.store.update(latest, { result: { ...latest.result, installedAppRef: appRef } }, 'device.installed_app_observed', () =>
      this.store.put('deviceInstalledApp', appRef, { app: receipt.intent.app, deviceId: receipt.deviceId, repositoryId: op.repositoryId, hostId: this.store.hostId, policy: receipt.intent.policyRevision, readback: effect.installReadback }));
  }
  async admit(repo: Enrolled, action: DeviceOperation['intent']['operation'], args: ObjectValue): Promise<Operation> {
    const deviceId = string(args['device'], 'device'), requestId = string(args['requestId'], 'requestId'), profile = this.profile(repo);
    const selection = { action, args, profile: profile.revision, appIdentity: this.appIdentity(profile) };
    const existing = this.store.byRequest(requestId);
    if (existing) { requireValue(existing.kind === 'device' && existing.repositoryId === repo.id && digest({ action: object(existing.input['selection'])['action'], args: object(existing.input['selection'])['args'] }) === digest({ action, args }), 'REQUEST_ID_CONFLICT', 'Device request ID already names a different immutable intent.'); return existing; }
    const observation = action === 'prepare' ? await this.builds.observe(repo, deviceId, string(args['buildProfile'], 'build profile')) : await this.observe(repo, deviceId);
    const actions = action === 'install_and_launch' ? ['install', 'launch'] : [action];
    let qualification: DeviceOperation['intent']['qualification'] = null;
    if (args['qualificationPlan']) {
      const planId = string(args['qualificationPlan'], 'qualificationPlan'), plan = profile.plans[planId];
      requireValue(plan && plan.operation === actions[0] && plan.maxAttempts >= 1 && plan.maxAttempts <= 3 && plan.maxDurationSeconds > 0 && plan.maxDurationSeconds <= 5400,
        'QUALIFICATION_PLAN_UNCONFIGURED', 'Choose a registered bounded plan for this app and operation.', 3);
      requireValue((plan.expectedContextDigest || this.mode === 'fixture') && (!plan.expectedContextDigest || plan.expectedContextDigest === digest(observation.context)),
        'QUALIFICATION_CONTEXT_CHANGED', 'The observed context must match the exact context approved in the registered qualification plan.', 3);
      qualification = { acceptanceId: plan.acceptanceId, fixtureId: plan.fixtureId, authorizedOperations: plan.authorizedOperations,
        maxAttempts: plan.maxAttempts, maxDurationSeconds: plan.maxDurationSeconds, planId, expectedContextDigest: digest(observation.context) };
      const count = this.store.records<{ count: number; key: string }>('qualificationBudget').find(record => record.key === digest({ planId, context: observation.context, repo: repo.id }));
      requireValue(!count || count.count < plan.maxAttempts, 'QUALIFICATION_BUDGET_EXHAUSTED', 'The exact-context qualification attempt budget is exhausted.', 3);
    }
    const owner = this.guard(repo, observation, actions, qualification);
    requireValue(!actions.includes('launch') || profile.permitsForeground, 'PROJECT_FOREGROUND_GUARD', 'This project does not permit foregrounding in the selected operation.', 3);
    let artifact: RetainedDeviceArtifact | undefined;
    if (actions.includes('install')) {
      artifact = this.store.record<RetainedDeviceArtifact>('deviceArtifact', string(args['artifact'], 'artifact'));
      requireValue(artifact && artifact.provenance.recordMode === this.mode && artifact.provenance.repositoryId === repo.id && artifact.provenance.signing.eligibleDeviceRefs.includes(deviceId), 'ARTIFACT_UNAUTHORIZED', 'The selected signed artifact is not eligible for this app/device.', 3);
      requireArtifactAvailable(this.store, artifact);
      requireValue(this.appIdentity({ ...profile, app: artifact.provenance.app }) === this.appIdentity(profile), 'APP_IDENTITY_MISMATCH', 'In-place installation must preserve the approved bundle/team identity.');
      requireValue(statSync(artifact.path).size === artifact.provenance.artifact.bytes && artifactFileDigest(artifact.path) === artifact.provenance.artifact.sha256, 'ARTIFACT_CHANGED', 'The immutable artifact bytes changed.');
    }
    let installed: { app: DeviceOperation['intent']['app']; deviceId: string; repositoryId: string; hostId: string; policy: string } | undefined;
    if (['launch', 'logs', 'debug', 'screenshot', 'screen_capture'].includes(action)) {
      installed = this.store.record('deviceInstalledApp', string(args['appRef'], 'appRef'));
      requireValue(installed && installed.deviceId === deviceId && installed.repositoryId === repo.id && installed.hostId === this.store.hostId && installed.policy === profile.revision && this.appIdentity({ ...profile, app: installed.app }) === this.appIdentity(profile),
        'INSTALLED_APP_REFERENCE_INVALID', 'Select the retained app identity approved for this device, project and host.', 3);
    }
    if (action === 'prepare') {
      this.builds.assertNoPriorBuildProcess(repo);
      requireValue(profile.buildProfiles.includes(string(args['buildProfile'], 'buildProfile')), 'BUILD_PROFILE_UNCONFIGURED', 'Select a registered project build profile.', 3);
      await clean(repo.path); requireValue((await identity(repo.path)).tip === args['sourceTip'], 'SOURCE_CHANGED', 'Preparation requires the exact clean project-selected source tip.');
    }
    if (['test', 'ui'].includes(action) && !qualification) {
      const plan = profile.plans[string(args['plan'], 'plan')]; requireValue(plan?.operation === action, 'DEVICE_PLAN_UNCONFIGURED', 'Select a registered project test or accessibility plan.', 3);
    }
    if (['logs', 'screen_capture'].includes(action)) requireValue(Number.isSafeInteger(args['durationSeconds']) && Number(args['durationSeconds']) > 0 && Number(args['durationSeconds']) <= 300, 'CAPTURE_BOUNDS_REQUIRED', 'Select a capture duration between 1 and 300 seconds.', 2);
    if (action === 'logs') requireValue(Number.isSafeInteger(args['maxBytes']) && Number(args['maxBytes']) > 0 && Number(args['maxBytes']) <= 8 * 1024 * 1024, 'CAPTURE_BOUNDS_REQUIRED', 'Bound logs to at most eight MiB.', 2);
    const op = this.store.admit(requestId, 'device', repo.id, { selection, deviceId, context: observation.context, profileRevision: profile.revision, parameters: args }, this.payload, 'queued', op => {
    const receipt: DeviceOperation = { schemaVersion: 1, recordMode: this.mode, operationId: op.operationId, requestId, repositoryId: repo.id, executionHostId: this.store.hostId, deviceId,
      intent: { operation: action, app: artifact?.provenance.app ?? installed?.app ?? profile.app, artifactRef: artifact ? { artifactId: artifact.provenance.artifactId, sha256: artifact.provenance.artifact.sha256 } : null,
        installedAppRef: typeof args['appRef'] === 'string' ? args['appRef'] : null, sourceCommit: typeof args['sourceTip'] === 'string' ? args['sourceTip'] : artifact?.provenance.source.commit ?? null,
        configurationId: typeof args['buildProfile'] === 'string' ? args['buildProfile'] : null, adapterId: profile.adapterId, policyRevision: profile.revision,
        authorizedOperations: actions as [string, ...string[]], mode: qualification ? 'qualification' : 'routine', qualification },
      context: observation.context, capabilityIds: actions.filter(action => !['disconnect', 'prepare'].includes(action)).map(action => this.capability(action as DeviceAction, observation.context).capabilityId),
      ownershipId: owner.ownershipId, requestedAt: op.createdAt, startedAt: null, completedAt: null, operationState: 'queued', stage: 'accepted', resultCertainty: 'not_observed',
      effects: actions.map(operation => ({ effectId: id(), operation, state: 'queued', certainty: 'not_observed', startedAt: null, completedAt: null, installReadback: null, launchReadback: null, evidenceRefs: [], reasonCodes: [], missingProof: [] })) as unknown as DeviceOperation['effects'],
      reconciliation: { status: 'not_required', attempts: 0, lastObservedAt: null, nextObservation: null }, logRefs: [op.attemptId], reasonCodes: [], missingProof: [] };
    assertContract('device-operation', receipt);
    return { deviceOperation: receipt, acceptance: { localDurable: true, executionHostAccepted: true, executionHostId: this.store.hostId, acceptedAt: op.createdAt } };
    }); return op;
  }
  private save(op: Operation, receipt: DeviceOperation): void {
    assertContract('device-operation', receipt);
    const latest = this.store.get(op.operationId); this.store.update(latest, { stage: receipt.stage, result: { ...latest.result, deviceOperation: receipt } }, 'device.effect_changed');
  }
  async execute(op: Operation, repo: Enrolled, signal: AbortSignal): Promise<ObjectValue> {
    const receipt = structuredClone(op.result['deviceOperation']) as DeviceOperation;
    requireValue(receipt, 'DEVICE_INTENT_INCOMPLETE', 'A device admission interrupted before sealing intent requires reconciliation.', 3);
    const profile = this.profile(repo); requireValue(profile.revision === op.input['profileRevision'], 'POLICY_CHANGED', 'Device policy changed after admission.');
    if (receipt.intent.operation === 'prepare') {
      await clean(repo.path); requireValue((await identity(repo.path)).tip === receipt.intent.sourceCommit, 'SOURCE_CHANGED', 'The selected build source changed before preparation.');
    }
    const observation = receipt.intent.operation === 'prepare' ? await this.builds.observe(repo, receipt.deviceId, string(receipt.intent.configurationId, 'build profile')) : await this.observe(repo, receipt.deviceId);
    requireValue(digest(observation.context) === digest(receipt.context), 'CAPABILITY_CONTEXT_CHANGED', 'Device, network or backend context changed after admission.', 3);
    const owner = this.guard(repo, observation, receipt.intent.authorizedOperations, receipt.intent.qualification);
    const ownsDevice = receipt.intent.operation !== 'prepare';
    if (ownsDevice) this.saveOwnership({ ...owner, activeOperationIds: [op.operationId], observedAt: now() });
    let deadline: NodeJS.Timeout | undefined; const bounded = new AbortController();
    const abort = (): void => bounded.abort(); signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
    try {
      if (receipt.intent.qualification) {
        const q = receipt.intent.qualification, key = digest({ planId: q.planId, context: receipt.context, repo: repo.id });
        const budget = this.store.record<{ count: number }>('qualificationBudget', key);
        requireValue((budget?.count ?? 0) < q.maxAttempts, 'QUALIFICATION_BUDGET_EXHAUSTED', 'Qualification attempt budget is exhausted.', 3);
        this.store.put('qualificationBudget', key, { key, count: (budget?.count ?? 0) + 1 });
        deadline = setTimeout(abort, q.maxDurationSeconds * 1000);
      }
      receipt.operationState = 'running'; receipt.startedAt = now(); this.save(op, receipt);
      for (const effect of receipt.effects) {
        this.permission(repo, receipt.deviceId, profile, [effect.operation]);
        if (effect.operation === 'install') {
          const artifact = this.store.record<RetainedDeviceArtifact>('deviceArtifact', receipt.intent.artifactRef!.artifactId);
          requireValue(artifact, 'ARTIFACT_UNAUTHORIZED', 'The selected retained artifact is unavailable.', 3);
          requireArtifactAvailable(this.store, artifact);
          requireValue(artifact && artifact.provenance.recordMode === this.mode && artifact.provenance.artifact.sha256 === receipt.intent.artifactRef!.sha256 && statSync(artifact.path).size === artifact.provenance.artifact.bytes && artifactFileDigest(artifact.path) === receipt.intent.artifactRef!.sha256,
            'ARTIFACT_CHANGED', 'Retained artifact bytes changed before device dispatch.');
          await this.backend.verifyArtifact(artifact, receipt);
        }
        if (['launch', 'logs', 'debug', 'screenshot', 'screen_capture'].includes(effect.operation)) await this.backend.verifyInstalledApp(receipt);
        if (effect.operation !== 'prepare') {
          const current = await this.observe(repo, receipt.deviceId);
          requireValue(digest(current.context) === digest(receipt.context), 'CAPABILITY_CONTEXT_CHANGED', 'The device context changed during effect preflight.', 3);
          this.guard(repo, current, [effect.operation], receipt.intent.qualification, op.operationId);
          requireValue(this.profile(repo).revision === receipt.intent.policyRevision, 'POLICY_CHANGED', 'The project policy changed during device preflight.', 3);
        } else this.permission(repo, receipt.deviceId, this.profile(repo), ['prepare']);
        if (bounded.signal.aborted) { effect.state = 'cancelled'; effect.completedAt = now(); throw new Fault('CANCELLED', 'Device work was cancelled before the next effect.', 130); }
        effect.state = 'running'; effect.startedAt = now(); receipt.stage = effect.operation === 'install' ? 'installing' : effect.operation === 'launch' ? 'launching' : effect.operation;
        this.save(op, receipt); this.store.update(this.store.get(op.operationId), { effectDispatched: effect.operation !== 'prepare' });
        let result: Partial<Effect>;
        try {
          if (effect.operation === 'prepare') {
            const prepared = await this.builds.perform(op, repo, receipt, bounded.signal);
            const latest = this.store.get(op.operationId); this.store.update(latest, { result: { ...latest.result, ...prepared } });
            result = { state: 'succeeded', certainty: 'confirmed', evidenceRefs: prepared['evidenceRefs'] as string[] };
          } else result = await this.backend.perform(effect.operation, receipt, object(op.input['parameters']), bounded.signal);
        }
        catch (error) {
          if (effect.operation === 'prepare') { effect.state = error instanceof Fault && error.exit === 130 ? 'cancelled' : 'failed'; effect.certainty = 'confirmed'; effect.completedAt = now(); throw error; }
          result = { state: 'outcome_unknown', certainty: 'uncertain', reasonCodes: ['OUTCOME_UNCERTAIN'], missingProof: ['The backend did not confirm whether the intended effect occurred.'] }; }
        effect.state = result.state ?? 'outcome_unknown';
        Object.assign(effect, result, { completedAt: now(), effectId: effect.effectId, operation: effect.operation });
        if (!['succeeded', 'failed', 'cancelled', 'outcome_unknown'].includes(effect.state)) { effect.state = 'outcome_unknown'; effect.certainty = 'uncertain'; }
        if (effect.state === 'succeeded') this.validateReadback(effect, receipt);
        if (effect.operation === 'install' && effect.state === 'succeeded') {
          this.retainInstalledApp(op, receipt, effect);
        }
        if (effect.state === 'outcome_unknown' || effect.certainty === 'uncertain') {
          effect.state = 'outcome_unknown'; effect.certainty = 'uncertain'; receipt.operationState = 'outcome_unknown'; receipt.resultCertainty = 'uncertain';
          receipt.reconciliation.status = 'required'; receipt.reconciliation.nextObservation = 'Observe the selected device and exact intended app/process without repeating the effect.';
          receipt.missingProof = [...effect.missingProof]; if (!receipt.missingProof.length) receipt.missingProof = ['The external effect remains unconfirmed.'];
          this.save(op, receipt); throw new Fault('OUTCOME_UNCERTAIN', 'A device effect may have occurred; reconcile before retrying.', 6);
        }
        this.save(op, receipt);
        if (effect.state !== 'succeeded') throw new Fault(effect.reasonCodes[0] ?? 'DEVICE_OPERATION_FAILED', 'The device effect did not complete; earlier effects are retained independently.', effect.state === 'cancelled' ? 130 : 5);
      }
      receipt.operationState = 'succeeded'; receipt.stage = 'completed'; receipt.resultCertainty = 'confirmed'; receipt.completedAt = now(); this.save(op, receipt);
      return { deviceOperation: receipt };
    } catch (error) {
      if (receipt.operationState !== 'outcome_unknown') {
        receipt.operationState = error instanceof Fault && error.exit === 130 ? 'cancelled' : 'failed';
        receipt.resultCertainty = 'confirmed'; receipt.completedAt = now(); receipt.reasonCodes = [error instanceof Fault ? error.code : 'DEVICE_OPERATION_FAILED']; this.save(op, receipt);
      }
      throw error;
    } finally {
      if (deadline) clearTimeout(deadline); signal.removeEventListener('abort', abort);
      if (ownsDevice) this.saveOwnership({ ...this.ownership(receipt.deviceId), activeOperationIds: receipt.operationState === 'outcome_unknown' ? [op.operationId] : [],
        mutationsPermitted: receipt.operationState !== 'outcome_unknown', state: receipt.operationState === 'outcome_unknown' ? 'blocked' : 'owned', reasonCodes: receipt.operationState === 'outcome_unknown' ? ['OUTCOME_UNCERTAIN'] : [] });
    }
  }
  private validateReadback(effect: Effect, receipt: DeviceOperation): void {
    if (effect.operation === 'install') {
      const readback = effect.installReadback, app = receipt.intent.app;
      if (!readback || readback.deviceId !== receipt.deviceId || readback.bundleId !== app.bundleId || readback.buildVersion !== app.buildVersion || readback.marketingVersion !== app.marketingVersion || (readback.teamId !== null && readback.teamId !== app.teamId)) {
        effect.state = 'outcome_unknown'; effect.certainty = 'uncertain'; effect.reasonCodes = ['INSTALLED_IDENTITY_UNCONFIRMED']; effect.missingProof = ['The installed app identity/build was not confirmed on the selected physical device.'];
      }
    } else if (effect.operation === 'launch') {
      const readback = effect.launchReadback;
      if (!readback || readback.deviceId !== receipt.deviceId || readback.bundleId !== receipt.intent.app.bundleId || !['running', 'foreground'].includes(readback.processState)) {
        effect.state = 'outcome_unknown'; effect.certainty = 'uncertain'; effect.reasonCodes = ['LAUNCH_UNCONFIRMED']; effect.missingProof = ['The requested app process was not observed.'];
      }
    }
    if (effect.state === 'succeeded' && (effect.certainty !== 'confirmed' || effect.evidenceRefs.length === 0)) {
      effect.state = 'outcome_unknown'; effect.certainty = 'uncertain'; effect.reasonCodes = ['EFFECT_EVIDENCE_REQUIRED']; effect.missingProof = ['A successful device effect needs retained observed evidence.'];
    }
  }
  async reconcile(op: Operation): Promise<ObjectValue> {
    const receipt = structuredClone(op.result['deviceOperation']) as DeviceOperation;
    if (receipt?.intent.operation === 'prepare' && receipt.operationState === 'interrupted') {
      const result = this.builds.reconcile(op, receipt);
      receipt.operationState = 'succeeded'; receipt.stage = 'reconciled'; receipt.resultCertainty = 'confirmed'; receipt.completedAt = now();
      for (const effect of receipt.effects) { effect.state = 'succeeded'; effect.certainty = 'confirmed'; effect.completedAt = now(); effect.evidenceRefs = result['evidenceRefs'] as string[]; effect.reasonCodes = []; effect.missingProof = []; }
      receipt.missingProof = []; receipt.reasonCodes = []; receipt.reconciliation.status = 'resolved'; receipt.reconciliation.lastObservedAt = now();
      assertContract('device-operation', receipt);
      this.store.update(op, { state: 'succeeded', stage: 'reconciled', error: null, result: { ...op.result, ...result, deviceOperation: receipt } });
      return { ...result, deviceOperation: receipt };
    }
    requireValue(receipt?.operationState === 'outcome_unknown', 'RECONCILIATION_NOT_REQUIRED', 'This operation has no uncertain device effect.', 2);
    receipt.reconciliation.attempts++; receipt.reconciliation.status = 'in_progress'; this.save(op, receipt);
    for (const effect of receipt.effects.filter(effect => effect.state === 'outcome_unknown' || effect.state === 'running')) {
      const observation = await this.backend.reconcile(effect, receipt);
      Object.assign(effect, observation); if (effect.state === 'succeeded') this.validateReadback(effect, receipt);
      if (effect.operation === 'install' && effect.state === 'succeeded') this.retainInstalledApp(op, receipt, effect);
    }
    receipt.reconciliation.lastObservedAt = now();
    const uncertain = receipt.effects.some(effect => effect.state === 'outcome_unknown' || effect.state === 'running');
    receipt.reconciliation.status = uncertain ? 'blocked' : 'resolved';
    if (!uncertain) {
      const unstarted = receipt.effects.some(effect => effect.state === 'queued');
      receipt.operationState = unstarted ? 'needs_attention' : receipt.effects.every(effect => effect.state === 'succeeded') ? 'succeeded' : 'failed';
      receipt.resultCertainty = 'confirmed'; receipt.completedAt = now(); receipt.missingProof = unstarted ? ['A later effect was never dispatched; request it separately if still intended.'] : [];
      const owner = this.ownership(receipt.deviceId); this.saveOwnership({ ...owner, state: 'owned', mutationsPermitted: true, activeOperationIds: [], reasonCodes: [] });
    }
    this.save(op, receipt);
    this.store.update(this.store.get(op.operationId), { state: receipt.operationState, error: uncertain ? op.error : null }); return { deviceOperation: receipt };
  }
}
