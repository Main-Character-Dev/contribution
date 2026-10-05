import { arch } from 'node:os';
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
/** The native adapter uses CoreDevice only. It never silently starts another backend. */
export class CoreDeviceBackend implements DeviceBackend {
  readonly recordMode = 'observed' as const;
  readonly supportedOperations = ['connect', 'install', 'launch'] as const;
  constructor(readonly store: Journal, private readonly execute: typeof run = run) {}
  private async command(argv: string[], timeout = 15000, signal?: AbortSignal): Promise<ObjectValue> {
    const result = await this.execute('/usr/bin/xcrun', ['devicectl', ...argv, '--timeout', String(Math.ceil(timeout / 1000)), '--json-output', '-'], { timeoutMs: timeout + 2000, maxBytes: 2 * 1024 * 1024, ...(signal ? { signal } : {}) });
    requireValue(result.code === 0 && !result.timedOut && !result.cancelled && !result.signal && !signal?.aborted, 'DEVELOPER_SERVICE_UNAVAILABLE', 'CoreDevice did not confirm the bounded operation. Inspect the selected host and phone prerequisites.', 3);
    let json: ObjectValue;
    try { json = object(JSON.parse(result.stdout)); } catch { throw new Fault('DEVICE_PROTOCOL_CHANGED', 'CoreDevice returned an unrecognized structured result.', 3); }
    requireValue(!json['error'] && json['result'], 'DEVICE_PROTOCOL_CHANGED', 'CoreDevice returned no confirmed result.', 3); return object(json['result']);
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
  private async apps(deviceId: string, signal?: AbortSignal): Promise<ObjectValue[]> {
    const result = await this.command(['device', 'info', 'apps', '--device', this.selection(deviceId).identifier], 15000, signal);
    requireValue(Array.isArray(result['apps']), 'DEVICE_PROTOCOL_CHANGED', 'Installed-app inventory has an unknown structure.', 3); return result['apps'].map(object);
  }
  private async installed(receipt: DeviceOperation): Promise<Effect['installReadback']> {
    const app = (await this.apps(receipt.deviceId)).find(app => app['bundleIdentifier'] === receipt.intent.app.bundleId);
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
  async perform(action: Effect['operation'], receipt: DeviceOperation, _parameters: ObjectValue, signal: AbortSignal): Promise<Partial<Effect>> {
    const device = this.selection(receipt.deviceId).identifier;
    if (action === 'install') {
      const artifact = this.store.record<RetainedDeviceArtifact>('deviceArtifact', receipt.intent.artifactRef!.artifactId)!;
      await this.command(['device', 'install', 'app', '--device', device, artifact.appPath], 120000, signal);
      const installReadback = await this.installed(receipt);
      return { state: 'succeeded', certainty: 'confirmed', installReadback, evidenceRefs: [this.evidence(receipt, installReadback)] };
    }
    if (action === 'launch') {
      await this.command(['device', 'process', 'launch', '--device', device, receipt.intent.app.bundleId], 30000, signal);
      // CLI delivery alone is not enough to confirm the app is running.
      return this.reconcile({ operation: 'launch' } as Effect, receipt);
    }
    if (action === 'connect') {
      // `device info details` explicitly permits cached results after connection
      // failure. Confirm a bounded developer-service request instead. Do not
      // retain unrelated app identities or treat this as ownership/native proof.
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
    // No guess about a process ID or native session is substituted for readback.
    return { state: 'outcome_unknown', certainty: 'uncertain', reasonCodes: ['READBACK_UNAVAILABLE'], missingProof: ['The selected native process/session requires qualified observation.'] };
  }
}
