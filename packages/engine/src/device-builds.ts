import { readFileSync, existsSync, lstatSync, mkdirSync, cpSync, chmodSync, openSync, closeSync, fsyncSync, realpathSync } from 'node:fs';
import { join, isAbsolute, relative } from 'node:path';
import { arch } from 'node:os';
import { assertContract, buildIdentity } from '@contribution/contracts';
import type { DeviceProfileConfiguration, DeviceContext, DeviceOperation, ArtifactProvenance } from '@contribution/contracts';
import { digest, id, now, requireValue, Fault, string } from './core.js';
import type { ObjectValue } from './core.js';
import type { Journal, Operation } from './journal.js';
import type { Enrolled } from './repositories.js';
import type { DeviceProfile, RetainedDeviceArtifact, DeviceObservation } from './devices.js';
import { clean, identity, gitText, inputFingerprint, contained, ordinaryHistory } from './git.js';
import { run, alive, processIdentity } from './process.js';
import type { RunOptions } from './process.js';
import { privateDirectory } from './private-files.js';
import { appTreeDigest, inspectSignedApp } from './device-artifacts.js';

type Build = DeviceProfileConfiguration['builds'][number];
type Host = DeviceContext['host'];
interface Prepared { appPath: string; app: ArtifactProvenance['app']; signing: ArtifactProvenance['signing']; evidence: ObjectValue }
export interface DeviceBuildDriver {
  readonly recordMode: 'observed' | 'fixture';
  host(build: Build): Promise<Host>;
  build(repo: Enrolled, config: DeviceProfileConfiguration, build: Build, directory: string, deviceId: string, options: RunOptions): Promise<Prepared>;
  archive(appPath: string, archivePath: string, options: RunOptions): Promise<void>;
}
interface Registration { config: DeviceProfileConfiguration; revision: string; registeredAt: string }

/** Offline host preparation never calls the physical-device backend. */
export class DeviceBuilds {
  readonly driver: DeviceBuildDriver | undefined;
  constructor(readonly store: Journal, readonly mode: 'fixture' | 'observed', driver?: DeviceBuildDriver) {
    this.driver = driver ?? (mode === 'observed' ? new XcodeDeviceBuildDriver(store) : undefined);
    requireValue(!this.driver || this.driver.recordMode === mode, 'FIXTURE_AUTHORITY_REJECTED', 'A build driver must match this service evidence mode.', 3);
  }
  configure(repo: Enrolled, input: unknown, expectedRevision: string, requestId: string): ObjectValue {
    try { assertContract('device-profile', input); } catch { throw new Fault('DEVICE_PROFILE_INVALID', 'The project device profile does not match the installed schema.', 2); }
    const config = input as DeviceProfileConfiguration;
    requireValue(config.repositoryId === repo.id && config.app.applicationIdentifier.endsWith(`.${config.app.bundleId}`) && /^[A-Z0-9]{10}\./.test(config.app.applicationIdentifier), 'APP_IDENTITY_MISMATCH', 'Profile repository and signed application identity must agree.', 2);
    requireValue(repo.config.integration.adapter === 'generic-v1', 'ADAPTER_MIGRATION_REQUIRED', 'Existing project source-selection and activation rules need their preserved device adapter before registration.', 3);
    const requestDigest = digest({ repo: repo.id, config, expectedRevision }), prior = this.store.record<{ digest: string; result: ObjectValue }>('deviceProfileRequest', requestId);
    if (prior) { requireValue(prior.digest === requestDigest, 'REQUEST_ID_CONFLICT', 'Profile request identity was reused with different inputs.'); return prior.result; }
    requireValue(!this.store.unsettled().some(op => op.repositoryId === repo.id && op.kind === 'device'), 'DEVICE_JOBS_PENDING', 'Drain or reconcile existing device jobs before replacing their policy.');
    const old = this.store.record<Registration>('deviceBuildProfile', repo.id);
    requireValue((old?.revision ?? 'none') === expectedRevision, 'STALE_CONFIGURATION', 'The device profile changed; inspect its current revision first.');
    requireValue(new Set(config.builds.map(build => build.id)).size === config.builds.length, 'DEVICE_PROFILE_INVALID', 'Build profile IDs must be unique.', 2);
    for (const build of config.builds) {
      requireValue(!build.containerPath.split('/').includes('..') && build.containerPath.endsWith(build.containerKind === 'project' ? '.xcodeproj' : '.xcworkspace'), 'BUILD_CONTAINER_INVALID', 'Select a contained Xcode project or workspace.', 2);
      contained(repo.path, build.containerPath);
      requireValue(isAbsolute(build.developerDirectory) && existsSync(build.developerDirectory) && lstatSync(build.developerDirectory).isDirectory(), 'XCODE_UNAVAILABLE', 'Select an installed developer directory.', 3);
      for (const value of [build.scheme, build.configuration, build.provisioningProfileSpecifier]) requireValue(!/[\x00-\x1f]/.test(value) && !value.startsWith('-'), 'DEVICE_PROFILE_INVALID', 'Build selections must be bounded literal values.', 2);
    }
    const registration: Registration = { config, revision: digest(config), registeredAt: now() };
    const profile: DeviceProfile = { repositoryId: repo.id, adapterId: config.adapterId, revision: registration.revision, app: config.app, permitsForeground: config.permitsForeground,
      configurations: config.builds.map(build => build.configuration), buildProfiles: config.builds.map(build => build.id), plans: {} };
    const result = { config, revision: registration.revision, deviceAuthority: 'not_granted', physicalSupport: 'unverified' };
    this.store.transaction(() => { this.store.put('deviceBuildProfile', repo.id, registration); this.store.put('deviceProfile', repo.id, profile); this.store.put('deviceProfileRequest', requestId, { digest: requestDigest, result }); });
    return result;
  }
  inspect(repo: Enrolled): ObjectValue { const registration = this.store.record<Registration>('deviceBuildProfile', repo.id); return registration ? { ...registration } : { config: null, revision: 'none' }; }
  artifacts(repo: Enrolled, artifactId?: string): ObjectValue {
    const records = this.store.records<RetainedDeviceArtifact>('deviceArtifact').filter(artifact => artifact.provenance.repositoryId === repo.id && artifact.provenance.recordMode === this.mode)
      .sort((a, b) => b.provenance.build.preparedAt.localeCompare(a.provenance.build.preparedAt));
    if (artifactId) requireValue(records.some(artifact => artifact.provenance.artifactId === artifactId), 'ARTIFACT_NOT_FOUND', 'No retained artifact belongs to this repository and evidence mode.', 3);
    return { artifacts: records.filter(artifact => !artifactId || artifact.provenance.artifactId === artifactId).slice(0, 100).map(artifact => ({ provenance: artifact.provenance, archiveAvailable: existsSync(artifact.path), integrity: 'revalidated_before_dispatch' })), grantsAuthority: false };
  }
  selected(repo: Enrolled, profileId: string, deviceId: string): { registration: Registration; build: Build } {
    const registration = this.store.record<Registration>('deviceBuildProfile', repo.id);
    requireValue(registration, 'BUILD_PROFILE_UNCONFIGURED', 'Register this project’s explicit offline build configuration first.', 3);
    const build = registration.config.builds.find(build => build.id === profileId);
    requireValue(build && registration.config.eligibleDeviceRefs.includes(deviceId), 'BUILD_PROFILE_UNCONFIGURED', 'Select a registered build profile and its approved opaque device.', 3);
    return { registration, build };
  }
  assertNoPriorBuildProcess(repo: Enrolled): void {
    const pending = this.store.list(100000).filter(op => op.repositoryId === repo.id && op.kind === 'device' && op.state === 'interrupted');
    for (const op of pending) {
      const receipt = op.result['deviceOperation'] as DeviceOperation | undefined;
      if (receipt?.intent.operation !== 'prepare') continue;
      const processes = op.result['processes'] as { pid: number; start: string | null }[] | undefined;
      requireValue(!processes?.some(process => alive(process.pid) && (!process.start || !processIdentity(process.pid) || processIdentity(process.pid) === process.start)), 'BUILD_PROCESS_UNRECONCILED', 'A prior build process may still be running. Reconcile that attempt before preparing another artifact.', 3);
    }
  }
  permitsPreparation(repo: Enrolled, deviceId: string): boolean {
    return this.store.record<Registration>('deviceBuildProfile', repo.id)?.config.eligibleDeviceRefs.includes(deviceId) ?? false;
  }
  async observe(repo: Enrolled, deviceId: string, profileId: string): Promise<DeviceObservation> {
    requireValue(this.driver, 'BUILD_DRIVER_UNAVAILABLE', 'This fixture has no offline build driver.', 3);
    const { build } = this.selected(repo, profileId, deviceId), host = await this.driver.host(build);
    requireValue(host.hostId === this.store.hostId && host.xcodeVersion === build.xcodeVersion && host.xcodeBuild === build.xcodeBuild && host.macOSVersion && host.macOSBuild,
      'BUILD_TOOLCHAIN_CHANGED', 'The selected Xcode or host identity differs from the registered build configuration.', 3);
    const context: DeviceContext = { host, device: { deviceId, model: null, iOSVersion: null, iOSBuild: null }, tailscale: { hostVersion: null, deviceVersion: null },
      backend: { id: 'coredevice', version: host.xcodeVersion, revision: host.xcodeBuild }, engineVersion: buildIdentity.version,
      network: { scenario: 'unknown', hostUnderlay: 'unknown', phoneUnderlay: 'unknown', tailnetPath: 'unknown', developerSession: 'unknown', internetState: 'unknown' }, signingMode: build.signingMode, bootstrapMethod: 'unknown' };
    return { recordMode: this.mode, deviceId, observedAt: now(), context, trust: 'unknown', developerService: 'unknown', session: 'unknown', externalSession: 'unknown', signingReady: false, hostReady: true, reasonCodes: ['PHONE_NOT_CONTACTED'] };
  }
  async perform(op: Operation, repo: Enrolled, receipt: DeviceOperation, signal: AbortSignal): Promise<ObjectValue> {
    requireValue(this.driver, 'BUILD_DRIVER_UNAVAILABLE', 'This fixture has no offline build driver.', 3);
    const { registration, build } = this.selected(repo, string(receipt.intent.configurationId, 'build profile'), receipt.deviceId);
    requireValue(registration.revision === receipt.intent.policyRevision, 'POLICY_CHANGED', 'Build configuration changed before preparation.');
    await clean(repo.path); const source = await identity(repo.path), inputDigest = await inputFingerprint(repo.path);
    requireValue(source.tip === receipt.intent.sourceCommit, 'SOURCE_CHANGED', 'The exact approved source changed before preparation.');
    const root = join(this.store.directory, 'device-builds'); privateDirectory(root);
    const directory = join(root, op.attemptId); requireValue(!existsSync(directory), 'BUILD_OUTPUT_RECONCILIATION_REQUIRED', 'Retained output from this build attempt must be inspected before any retry.');
    mkdirSync(directory, { mode: 0o700 });
    const options: RunOptions = { signal, output: text => this.store.log(op, text), started: (pid, start) => {
      const latest = this.store.get(op.operationId); this.store.update(latest, { result: { ...latest.result, processes: [...(latest.result['processes'] as ObjectValue[] ?? []), { pid, start }] } });
    } };
    await ordinaryHistory(repo.path, source.tip!);
    const buildSource = join(directory, 'source');
    await gitText(repo.path, ['worktree', 'add', '--detach', buildSource, source.tip!], options);
    const snapshotDigest = await inputFingerprint(buildSource);
    const prepared = await this.driver.build({ ...repo, path: buildSource }, registration.config, build, directory, receipt.deviceId, options);
    await clean(buildSource);
    requireValue(await inputFingerprint(buildSource) === snapshotDigest, 'BUILD_INPUT_CHANGED', 'The isolated committed build inputs changed during preparation.');
    requireValue(!signal.aborted, 'CANCELLED', 'Preparation was cancelled before retaining an artifact.', 130);
    const relativeApp = relative(realpathSync(directory), realpathSync(prepared.appPath));
    requireValue(relativeApp && !relativeApp.startsWith('../') && !isAbsolute(relativeApp), 'BUILD_OUTPUT_ESCAPED', 'The app must be inside this owned build attempt.');
    requireValue(digest(prepared.app) === digest(receipt.intent.app) && prepared.signing.eligibleDeviceRefs.includes(receipt.deviceId), 'APP_IDENTITY_MISMATCH', 'Prepared signed app does not match the selected identity/device.');
    const beforeCopy = appTreeDigest(prepared.appPath), artifactId = id(), artifacts = join(this.store.directory, 'device-artifacts'); privateDirectory(artifacts);
    const retained = join(artifacts, artifactId); mkdirSync(retained, { mode: 0o700 });
    const appPath = join(retained, build.appName), path = join(retained, 'signed-app.zip');
    cpSync(prepared.appPath, appPath, { recursive: true, errorOnExist: true, force: false });
    requireValue(appTreeDigest(appPath) === beforeCopy, 'ARTIFACT_CHANGED', 'App bytes changed during retention.');
    await this.driver.archive(appPath, path, options);
    const info = lstatSync(path); requireValue(info.isFile() && !info.isSymbolicLink() && info.size > 0 && info.size <= 1024 ** 3, 'ARTIFACT_TOO_LARGE', 'The signed archive must be a bounded regular file.');
    await clean(repo.path); requireValue((await identity(repo.path)).tip === source.tip && await inputFingerprint(repo.path) === inputDigest && appTreeDigest(prepared.appPath) === beforeCopy && appTreeDigest(appPath) === beforeCopy,
      'BUILD_INPUT_CHANGED', 'Source or signed output changed during preparation; it is not an installable artifact.');
    requireValue(!signal.aborted, 'CANCELLED', 'Preparation was cancelled before publishing its retained artifact.', 130);
    const afterHost = (await this.observe(repo, receipt.deviceId, build.id)).context.host;
    requireValue(digest(afterHost) === digest(receipt.context.host), 'BUILD_TOOLCHAIN_CHANGED', 'The build host toolchain changed during preparation.');
    chmodSync(path, 0o400);
    for (const entry of [path, retained, artifacts]) { const fd = openSync(entry, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } }
    const evidenceRef = id(), host = receipt.context.host;
    const provenance: ArtifactProvenance = { schemaVersion: 1, recordMode: this.mode, artifactId, repositoryId: repo.id,
      source: { commit: source.tip!, tree: await gitText(repo.path, ['rev-parse', `${source.tip}^{tree}`]), inputDigest, configurationId: build.id, configurationDigest: digest(build), adapterId: registration.config.adapterId, adapterVersion: '1', policyRevision: registration.revision },
      build: { hostId: this.store.hostId, attemptId: op.attemptId, preparedAt: now(), macOSVersion: host.macOSVersion!, macOSBuild: host.macOSBuild!, xcodeVersion: host.xcodeVersion!, xcodeBuild: host.xcodeBuild!, engineVersion: buildIdentity.version },
      artifact: { sha256: digest(readFileSync(path)), bytes: info.size, format: 'signed_app_archive' }, app: prepared.app, signing: prepared.signing, deviceAcceptance: 'not_established_by_preparation', evidenceRefs: [evidenceRef] };
    assertContract('artifact-provenance', provenance);
    const artifact: RetainedDeviceArtifact = { provenance, path, appPath, appDigest: beforeCopy };
    this.store.transaction(() => { this.store.put('deviceBuildEvidence', evidenceRef, { operationId: op.operationId, recordMode: this.mode, source: provenance.source, details: prepared.evidence }); this.store.put('deviceArtifact', artifactId, artifact); this.store.put('devicePreparedArtifact', op.operationId, { artifactId, policy: registration.revision, sourceTip: source.tip }); });
    return { artifact: provenance, artifactRef: { artifactId, sha256: provenance.artifact.sha256 }, evidenceRefs: [evidenceRef] };
  }
  reconcile(op: Operation, receipt: DeviceOperation): ObjectValue {
    const retained = this.store.record<{ artifactId: string; policy: string; sourceTip: string }>('devicePreparedArtifact', op.operationId);
    requireValue(retained && retained.policy === receipt.intent.policyRevision && retained.sourceTip === receipt.intent.sourceCommit, 'NO_SEALED_ARTIFACT', 'No complete retained artifact exists for this interrupted build. Inspect its local output before requesting a new preparation.', 3);
    const artifact = this.store.record<RetainedDeviceArtifact>('deviceArtifact', retained.artifactId);
    requireValue(artifact && artifact.provenance.recordMode === this.mode && artifact.provenance.build.attemptId === op.attemptId && artifact.provenance.repositoryId === op.repositoryId &&
      digest(readFileSync(artifact.path)) === artifact.provenance.artifact.sha256 && lstatSync(artifact.path).size === artifact.provenance.artifact.bytes && appTreeDigest(artifact.appPath) === artifact.appDigest,
      'ARTIFACT_CHANGED', 'The sealed build or materialized app changed; preserve it for inspection.');
    assertContract('artifact-provenance', artifact.provenance);
    return { artifact: artifact.provenance, artifactRef: { artifactId: retained.artifactId, sha256: artifact.provenance.artifact.sha256 }, evidenceRefs: artifact.provenance.evidenceRefs };
  }
}

export class XcodeDeviceBuildDriver implements DeviceBuildDriver {
  readonly recordMode = 'observed' as const;
  constructor(readonly store: Journal) {}
  async host(build: Build): Promise<Host> {
    const [os, xcode] = await Promise.all([run('/usr/bin/sw_vers', [], { timeoutMs: 5000 }), run(join(build.developerDirectory, 'usr/bin/xcodebuild'), ['-version'], { timeoutMs: 10000, env: { DEVELOPER_DIR: build.developerDirectory } })]);
    requireValue(os.code === 0 && xcode.code === 0, 'XCODE_UNAVAILABLE', 'The registered host toolchain could not be observed.', 3);
    return { hostId: this.store.hostId, model: null, architecture: arch() === 'arm64' ? 'arm64' : arch() === 'x64' ? 'x86_64' : 'unknown',
      macOSVersion: /ProductVersion:\s*(\S+)/.exec(os.stdout)?.[1] ?? null, macOSBuild: /BuildVersion:\s*(\S+)/.exec(os.stdout)?.[1] ?? null,
      xcodeVersion: /Xcode\s+(\S+)/.exec(xcode.stdout)?.[1] ?? null, xcodeBuild: /Build version\s+(\S+)/.exec(xcode.stdout)?.[1] ?? null };
  }
  async build(repo: Enrolled, config: DeviceProfileConfiguration, build: Build, directory: string, deviceId: string, options: RunOptions): Promise<Prepared> {
    // A retained physical ID is used only to verify provisioning membership. No
    // inventory or developer connection is needed during this local build.
    const selection = this.store.record<{ udid: string }>('coreDeviceSelection', deviceId);
    requireValue(selection?.udid, 'DEVICE_IDENTITY_REQUIRED', 'Provisioning needs this phone’s previously verified local identity; refresh inventory once during setup.', 3);
    const products = join(directory, 'products'); privateDirectory(products);
    const command = join(build.developerDirectory, 'usr/bin/xcodebuild');
    const argv = [`-${build.containerKind}`, contained(repo.path, build.containerPath), '-scheme', build.scheme, '-configuration', build.configuration,
      '-destination', 'generic/platform=iOS', '-derivedDataPath', join(directory, 'DerivedData'), '-disableAutomaticPackageResolution', '-onlyUsePackageVersionsFromResolvedFile',
      '-resultBundlePath', join(directory, 'Build.xcresult'), 'build', `CONFIGURATION_BUILD_DIR=${products}`, 'CODE_SIGN_STYLE=Manual',
      `DEVELOPMENT_TEAM=${config.app.teamId}`, `PROVISIONING_PROFILE_SPECIFIER=${build.provisioningProfileSpecifier}`, `PRODUCT_BUNDLE_IDENTIFIER=${config.app.bundleId}`,
      `MARKETING_VERSION=${config.app.marketingVersion}`, `CURRENT_PROJECT_VERSION=${config.app.buildVersion}`];
    const result = await run(command, argv, { ...options, cwd: repo.path, timeoutMs: build.timeoutSeconds * 1000, maxBytes: 8 * 1024 * 1024, env: { DEVELOPER_DIR: build.developerDirectory } });
    requireValue(result.code === 0 && !result.cancelled && !result.timedOut, result.cancelled ? 'CANCELLED' : 'BUILD_FAILED', 'The offline build did not complete. Its retained log describes the project/signing prerequisite.', result.cancelled ? 130 : 5);
    const appPath = join(products, build.appName);
    requireValue(existsSync(appPath), 'BUILD_OUTPUT_MISSING', 'Xcode did not produce the approved app bundle name.', 5); appTreeDigest(appPath);
    const verification = await inspectSignedApp(appPath, config.app, build.signingMode, [{ deviceId, udid: selection.udid }]);
    return { appPath, app: config.app, signing: verification, evidence: { signature: 'verified', provisioning: 'verified', phoneContacted: false, projectContainerDigest: digest(build), command: 'xcodebuild', arguments: argv } };
  }
  async archive(appPath: string, archivePath: string, options: RunOptions): Promise<void> {
    const result = await run('/usr/bin/ditto', ['-c', '-k', '--keepParent', '--norsrc', appPath, archivePath], { ...options, timeoutMs: 120000 });
    requireValue(result.code === 0, 'ARTIFACT_PACKAGING_FAILED', 'Signed app archive creation failed.', 5);
  }
}
