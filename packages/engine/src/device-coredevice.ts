import { arch } from 'node:os';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appTreeDigest, inspectSignedApp } from './device-artifacts.js';
export { appTreeDigest, provisioningIdentity } from './device-artifacts.js';
import { buildIdentity } from '@contribution/contracts';
import type { DeviceOperation, DeviceContext } from '@contribution/contracts';
import { run } from './process.js';
import { digest, id, now, object, requireValue, Fault } from './core.js';
import type { ObjectValue } from './core.js';
import type { Journal } from './journal.js';
import type { DeviceBackend, DeviceObservation, DeviceProfile, RetainedDeviceArtifact } from './devices.js';

type Effect = DeviceOperation['effects'][number];
interface Selection { deviceId: string; identifier: string; udid: string; model: string | null; iOSVersion: string | null; iOSBuild: string | null; paired: boolean; tunnel: string; transport: string }
interface LaunchSelection { operationId: string; effectId: string; deviceId: string; hostId: string; app: DeviceOperation['intent']['app']; directory: string; requestedAt: string; process?: { pid: number; executable: string } }
function devicePath(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 4096 || !value.startsWith('file:')) return null;
  try {
    const url = new URL(value);
    if (url.hostname || url.search || url.hash || /(?:^|\/)\.\.(?:\/|$)/.test(decodeURIComponent(value))) return null;
    const path = fileURLToPath(url);
    return path.startsWith('/') && !/[\u0000-\u001f\u007f]/.test(path) ? posix.normalize(path).replace(/\/$/, '') : null;
  } catch { return null; }
}
/** The native adapter uses CoreDevice only. It never silently starts another backend. */
export class CoreDeviceBackend implements DeviceBackend {
  readonly recordMode = 'observed' as const;
  readonly supportedOperations = ['connect', 'install', 'launch'] as const;
  constructor(readonly store: Journal, private readonly execute: typeof run = run) {}
  private async command(argv: string[], timeout = 15000, signal?: AbortSignal): Promise<ObjectValue> {
    const env: NodeJS.ProcessEnv = {};
    for (const key of Object.keys(process.env)) if (key.startsWith('DEVICECTL_CHILD_')) env[key] = undefined;
    const result = await this.execute('/usr/bin/xcrun', ['devicectl', ...argv, '--timeout', String(Math.ceil(timeout / 1000)), '--json-output', '-'], { env, timeoutMs: timeout + 2000, maxBytes: 2 * 1024 * 1024, ...(signal ? { signal } : {}) });
    requireValue(result.code === 0 && !result.timedOut && !result.cancelled && !result.outputLimited && !result.signal && !signal?.aborted, 'DEVELOPER_SERVICE_UNAVAILABLE', 'CoreDevice did not confirm the bounded operation. Inspect the selected host and phone prerequisites.', 3);
    let json: ObjectValue;
    try { json = object(JSON.parse(result.stdout)); } catch { throw new Fault('DEVICE_PROTOCOL_CHANGED', 'CoreDevice returned an unrecognized structured result.', 3); }
    requireValue(!json['error'] && json['result'] && (json['info'] === undefined || object(json['info'])['outcome'] === 'success'), 'DEVICE_PROTOCOL_CHANGED', 'CoreDevice returned no confirmed result.', 3); return object(json['result']);
  }
  async inventory(): Promise<{ deviceId: string; label: string }[]> {
    const result = await this.command(['list', 'devices']); requireValue(Array.isArray(result['devices']), 'DEVICE_PROTOCOL_CHANGED', 'CoreDevice inventory has an unknown structure.', 3);
    const inventory: { deviceId: string; label: string }[] = [];
    for (const value of result['devices'].slice(0, 100)) {
      const device = object(value), hardware = object(device['hardwareProperties'] ?? {}), properties = object(device['deviceProperties'] ?? {}), connection = object(device['connectionProperties'] ?? {});
      const identifier = device['identifier'], udid = hardware['udid'];
      // Deprecated dictionaries are still explicit in Xcode 27 output. Do not
      // guess the replacement layout or confuse a connection ID with hardware.
      if (typeof identifier !== 'string' || typeof udid !== 'string' || !/^[A-Za-z0-9-]{8,128}$/.test(identifier) || !/^[A-Za-z0-9-]{8,128}$/.test(udid)) continue;
      const deviceId = `device-${digest(Buffer.from(udid)).slice(0, 32)}`;
      const selection: Selection = { deviceId, identifier, udid, model: typeof hardware['productType'] === 'string' ? hardware['productType'] : null,
        iOSVersion: typeof properties['osVersionNumber'] === 'string' ? properties['osVersionNumber'] : null, iOSBuild: typeof properties['osBuildUpdate'] === 'string' ? properties['osBuildUpdate'] : null,
        paired: connection['pairingState'] === 'paired', tunnel: String(connection['tunnelState'] ?? 'unknown'), transport: String(connection['transportType'] ?? 'unknown') };
      this.store.put('coreDeviceSelection', deviceId, selection); inventory.push({ deviceId, label: selection.model ?? 'Apple device' });
    }
    requireValue(result['devices'].length === 0 || inventory.length > 0, 'DEVICE_PROTOCOL_CHANGED', 'Inventory did not expose a verifiable physical identity; no device was enrolled.', 3); return inventory;
  }
  private selection(deviceId: string): Selection {
    const selection = this.store.record<Selection>('coreDeviceSelection', deviceId); requireValue(selection, 'DEVICE_IDENTITY_REQUIRED', 'Refresh inventory and select an observed opaque device reference.', 3); return selection;
  }
  async observe(deviceId: string, _profile: DeviceProfile): Promise<DeviceObservation> {
    let reachable = false;
    try { reachable = (await this.inventory()).some(device => device.deviceId === deviceId); } catch { /* preserve unknown availability without inventing a cause */ }
    const selection = this.selection(deviceId);
    const [os, xcode] = await Promise.all([this.execute('/usr/bin/sw_vers', [], { timeoutMs: 3000 }), this.execute('/usr/bin/xcrun', ['xcodebuild', '-version'], { timeoutMs: 5000 })]);
    const context: DeviceContext = { host: { hostId: this.store.hostId, model: null, architecture: arch() === 'arm64' ? 'arm64' : arch() === 'x64' ? 'x86_64' : 'unknown',
      macOSVersion: /ProductVersion:\s*(\S+)/.exec(os.stdout)?.[1] ?? null, macOSBuild: /BuildVersion:\s*(\S+)/.exec(os.stdout)?.[1] ?? null,
      xcodeVersion: /Xcode\s+(\S+)/.exec(xcode.stdout)?.[1] ?? null, xcodeBuild: /Build version\s+(\S+)/.exec(xcode.stdout)?.[1] ?? null },
      device: { deviceId, model: selection.model, iOSVersion: selection.iOSVersion, iOSBuild: selection.iOSBuild },
      tailscale: { hostVersion: null, deviceVersion: null }, backend: { id: 'coredevice', version: /Xcode\s+(\S+)/.exec(xcode.stdout)?.[1] ?? null, revision: /Build version\s+(\S+)/.exec(xcode.stdout)?.[1] ?? null },
      engineVersion: buildIdentity.version, network: { scenario: 'unknown', hostUnderlay: 'unknown', phoneUnderlay: 'unknown', tailnetPath: 'unknown', developerSession: reachable && selection.tunnel === 'connected' ? 'existing' : 'unknown', internetState: 'unknown' },
      signingMode: 'unknown', bootstrapMethod: 'existing' };
    // Inventory does not establish absence of another Xcode/test/debug owner.
    // Cached inventory/tunnel labels do not prove a live developer-service RPC.
    // Native session attribution is still required before routine physical work.
    return { recordMode: 'observed', deviceId, observedAt: now(), context, trust: reachable && selection.paired ? 'trusted' : 'unknown', developerService: 'unknown',
      session: 'unknown', externalSession: 'unknown', signingReady: false, hostReady: os.code === 0 && xcode.code === 0, reasonCodes: reachable ? ['LIVE_DEVELOPER_SERVICE_UNCONFIRMED'] : ['DEVICE_OFFLINE'] };
  }
  private async apps(deviceId: string, signal?: AbortSignal, bundleId?: string): Promise<ObjectValue[]> {
    const result = await this.command(['device', 'info', 'apps', '--device', this.selection(deviceId).identifier, ...(bundleId ? ['--bundle-id', bundleId] : [])], 15000, signal);
    requireValue(Array.isArray(result['apps']) && result['apps'].length <= 10000, 'DEVICE_PROTOCOL_CHANGED', 'Installed-app inventory has an unknown or oversized structure.', 3); return result['apps'].map(object);
  }
  private async selectedApp(receipt: DeviceOperation, signal?: AbortSignal): Promise<ObjectValue | null> {
    const matches = (await this.apps(receipt.deviceId, signal, receipt.intent.app.bundleId)).filter(app => app['bundleIdentifier'] === receipt.intent.app.bundleId);
    requireValue(matches.length <= 1, 'DEVICE_PROTOCOL_CHANGED', 'Installed-app identity is ambiguous.', 3);
    return matches[0] ?? null;
  }
  private async installed(receipt: DeviceOperation): Promise<Effect['installReadback']> {
    const app = await this.selectedApp(receipt);
    if (!app || typeof app['version'] !== 'string' || typeof app['bundleVersion'] !== 'string') return null;
    return { deviceId: receipt.deviceId, bundleId: receipt.intent.app.bundleId, teamId: typeof app['teamIdentifier'] === 'string' ? app['teamIdentifier'] : null,
      marketingVersion: app['version'], buildVersion: app['bundleVersion'], observedAt: now(), method: 'CoreDevice installed-app inventory' };
  }
  async verifyInstalledApp(receipt: DeviceOperation): Promise<void> {
    const app = await this.installed(receipt), expected = receipt.intent.app;
    requireValue(app && app.bundleId === expected.bundleId && app.buildVersion === expected.buildVersion && app.marketingVersion === expected.marketingVersion && (app.teamId === null || app.teamId === expected.teamId),
      'INSTALLED_APP_REFERENCE_INVALID', 'The selected installed app changed or cannot be observed.', 3);
  }
  async verifyArtifact(artifact: RetainedDeviceArtifact, receipt: DeviceOperation): Promise<void> {
    requireValue(artifact.provenance.recordMode === 'observed' && artifact.provenance.signing.eligibleDeviceRefs.includes(receipt.deviceId), 'ARTIFACT_UNAUTHORIZED', 'Fixture or ineligible artifacts cannot be installed.');
    requireValue(artifact.appDigest && appTreeDigest(artifact.appPath) === artifact.appDigest, 'ARTIFACT_CHANGED', 'The materialized app no longer matches its sealed build/transfer receipt.');
    const signing = await inspectSignedApp(artifact.appPath, receipt.intent.app, artifact.provenance.signing.mode, [{ deviceId: receipt.deviceId, udid: this.selection(receipt.deviceId).udid }]);
    requireValue(signing.entitlementsDigest === artifact.provenance.signing.entitlementsDigest && signing.provisioningProfileDigest === artifact.provenance.signing.provisioningProfileDigest,
      'ENTITLEMENTS_CHANGED', 'Signed entitlements or provisioning differ from the retained artifact.');
  }
  private evidence(receipt: DeviceOperation, value: unknown): string { const ref = id(); this.store.put('deviceReadback', ref, { operationId: receipt.operationId, observedAt: now(), value }); return ref; }
  private appMatches(app: ObjectValue | null, receipt: DeviceOperation): boolean {
    const expected = receipt.intent.app;
    return Boolean(app && app['bundleIdentifier'] === expected.bundleId && app['version'] === expected.marketingVersion && app['bundleVersion'] === expected.buildVersion &&
      (app['teamIdentifier'] === undefined || app['teamIdentifier'] === null || app['teamIdentifier'] === expected.teamId));
  }
  private async launchReadback(receipt: DeviceOperation, signal?: AbortSignal): Promise<Partial<Effect>> {
    const unknown = (reason: string): Partial<Effect> => ({ state: 'outcome_unknown', certainty: 'uncertain', launchReadback: null,
      reasonCodes: [reason], missingProof: ['A live process for the exact selected app and retained launch must be observed.'] });
    const effect = receipt.effects.find(value => value.operation === 'launch');
    const selection = effect && this.store.record<LaunchSelection>('coreDeviceLaunch', effect.effectId);
    if (!selection || selection.operationId !== receipt.operationId || selection.deviceId !== receipt.deviceId || selection.hostId !== this.store.hostId || digest(selection.app) !== digest(receipt.intent.app)) return unknown('LAUNCH_SELECTION_UNCONFIRMED');
    const app = await this.selectedApp(receipt, signal);
    if (!this.appMatches(app, receipt) || devicePath(app?.['url']) !== selection.directory) return unknown('INSTALLED_APP_REFERENCE_INVALID');
    const result = await this.command(['device', 'info', 'processes', '--device', this.selection(receipt.deviceId).identifier], 15000, signal);
    requireValue(Array.isArray(result['runningProcesses']) && result['runningProcesses'].length <= 10000, 'DEVICE_PROTOCOL_CHANGED', 'Live process inventory has an unknown or oversized structure.', 3);
    const matches = result['runningProcesses'].map(object).filter(value => {
      const executable = devicePath(value['executable']), pid = value['processIdentifier'];
      return Number.isSafeInteger(pid) && Number(pid) > 0 && executable && posix.dirname(executable) === selection.directory &&
        (!selection.process || selection.process.pid === pid && selection.process.executable === executable);
    });
    if (matches.length !== 1) return unknown('LAUNCH_PROCESS_UNCONFIRMED');
    // Read back app identity again after the process query. No app extension,
    // matching display name or unrelated process is substituted for this app.
    const current = await this.selectedApp(receipt, signal);
    if (!this.appMatches(current, receipt) || devicePath(current?.['url']) !== selection.directory) return unknown('INSTALLED_APP_REFERENCE_INVALID');
    const launchReadback: NonNullable<Effect['launchReadback']> = { deviceId: receipt.deviceId, bundleId: receipt.intent.app.bundleId, processState: 'running',
      processId: Number(matches[0]!['processIdentifier']), observedAt: now(), method: 'CoreDevice live process query bound to installed app URL and retained launch' };
    return { state: 'succeeded', certainty: 'confirmed', launchReadback, reasonCodes: [], missingProof: [], evidenceRefs: [this.evidence(receipt, launchReadback)] };
  }
  async perform(action: Effect['operation'], receipt: DeviceOperation, _parameters: ObjectValue, signal: AbortSignal, beforeDispatch: () => void = () => {}): Promise<Partial<Effect>> {
    const device = this.selection(receipt.deviceId).identifier;
    if (action === 'install') {
      const artifact = this.store.record<RetainedDeviceArtifact>('deviceArtifact', receipt.intent.artifactRef!.artifactId)!;
      beforeDispatch();
      await this.command(['device', 'install', 'app', '--device', device, artifact.appPath], 120000, signal);
      const installReadback = await this.installed(receipt);
      return { state: 'succeeded', certainty: 'confirmed', installReadback, evidenceRefs: [this.evidence(receipt, installReadback)] };
    }
    if (action === 'launch') {
      const effect = receipt.effects.find(value => value.operation === 'launch');
      requireValue(effect && !this.store.record('coreDeviceLaunch', effect.effectId), 'LAUNCH_RECONCILIATION_REQUIRED', 'An existing launch selection may only be observed, never dispatched again.', 3);
      const app = await this.selectedApp(receipt, signal), directory = devicePath(app?.['url']);
      requireValue(this.appMatches(app, receipt) && directory && directory.endsWith('.app'), 'INSTALLED_APP_REFERENCE_INVALID', 'Launch requires the exact installed app identity and bundle URL.', 3);
      const selection: LaunchSelection = { operationId: receipt.operationId, effectId: effect.effectId, deviceId: receipt.deviceId, hostId: this.store.hostId,
        app: receipt.intent.app, directory, requestedAt: now() };
      requireValue(!this.store.record('coreDeviceLaunch', effect.effectId) && !signal.aborted, 'LAUNCH_RECONCILIATION_REQUIRED', 'A concurrent or cancelled launch cannot dispatch this effect.', 3);
      beforeDispatch();
      this.store.put('coreDeviceLaunch', effect.effectId, selection);
      // Explicit empty child environment prevents inherited app-side flags.
      // Never terminate an existing app or acquire a console/debug session.
      const reply = await this.command(['device', 'process', 'launch', '--device', device, '--environment-variables', '{}', '--activate', receipt.intent.app.bundleId], 30000, signal);
      const returned = object(reply['process'] ?? {}), executable = devicePath(returned['executable']), pid = returned['processIdentifier'];
      requireValue(Number.isSafeInteger(pid) && Number(pid) > 0 && executable && posix.dirname(executable) === directory,
        'LAUNCH_REPLY_UNCONFIRMED', 'The launch reply did not identify the selected app process. Observe the retained launch without repeating it.', 3);
      this.store.put('coreDeviceLaunch', effect.effectId, { ...selection, process: { pid: Number(pid), executable } });
      return this.launchReadback(receipt, signal);
    }
    if (action === 'connect') {
      // `device info details` explicitly permits cached results after connection
      // failure. Confirm a bounded developer-service request instead. Do not
      // retain unrelated app identities or treat this as ownership/native proof.
      beforeDispatch();
      const apps = await this.apps(receipt.deviceId, signal);
      return { state: 'succeeded', certainty: 'confirmed', evidenceRefs: [this.evidence(receipt, {
        deviceId: receipt.deviceId, method: 'CoreDevice installed-app query', appCount: apps.length,
        proves: 'A completed developer-service query; not native ownership or other capabilities.'
      })] };
    }
    throw new Fault('CAPABILITY_UNVERIFIED', 'This native operation needs its independently qualified project/backend route.', 3);
  }
  async reconcile(effect: Effect, receipt: DeviceOperation): Promise<Partial<Effect>> {
    if (effect.operation === 'install') {
      const installReadback = await this.installed(receipt);
      return { state: 'succeeded', certainty: 'confirmed', installReadback, evidenceRefs: [this.evidence(receipt, installReadback)] };
    }
    if (effect.operation === 'launch') return this.launchReadback(receipt);
    // No guess about a process ID or native session is substituted for readback.
    return { state: 'outcome_unknown', certainty: 'uncertain', reasonCodes: ['READBACK_UNAVAILABLE'], missingProof: ['The selected native process/session requires qualified observation.'] };
  }
}
