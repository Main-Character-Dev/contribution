import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import type { ArtifactProvenance } from '@contribution/contracts';
import { run } from './process.js';
import { digest, now, requireValue, object } from './core.js';
import type { ObjectValue } from './core.js';

export async function provisioningIdentity(input: Buffer): Promise<{ expiration: string; devices: string[]; teams: string[] }> {
  const extract = async (key: string, format: 'raw' | 'json', type: string): Promise<string> => {
    const result = await run('/usr/bin/plutil', ['-extract', key, format, '-expect', type, '-o', '-', '--', '-'], { input, timeoutMs: 5000 });
    requireValue(result.code === 0, 'PROVISIONING_INVALID', 'A required provisioning identity field is missing or has an incompatible type.', 3); return result.stdout.trim();
  };
  // Complete mobileprovision plists contain dates and certificate data that JSON
  // cannot represent. Extract only the typed identity fields needed for this gate.
  const [expiration, devicesJSON, teamsJSON] = await Promise.all([extract('ExpirationDate', 'raw', 'date'), extract('ProvisionedDevices', 'json', 'array'), extract('TeamIdentifier', 'json', 'array')]);
  const devices: unknown = JSON.parse(devicesJSON), teams: unknown = JSON.parse(teamsJSON);
  requireValue(Array.isArray(devices) && devices.every(value => typeof value === 'string') && Array.isArray(teams) && teams.every(value => typeof value === 'string'), 'PROVISIONING_INVALID', 'Provisioning device/team identities have an incompatible shape.', 3);
  return { expiration, devices, teams };
}
export function appTreeDigest(root: string): string {
  const files: [string, number, string][] = []; let count = 0, bytes = 0;
  const visit = (relative: string): void => {
    const path = join(root, relative), info = lstatSync(path);
    requireValue(!info.isSymbolicLink(), 'ARTIFACT_LINK_UNSUPPORTED', 'An installable artifact must have contained regular bundle files.', 3);
    if (info.isDirectory()) for (const name of readdirSync(path).sort()) visit(join(relative, name));
    else { count++; bytes += info.size; requireValue(info.isFile() && count <= 100000 && bytes <= 4 * 1024 ** 3, 'ARTIFACT_TOO_LARGE', 'The signed app tree exceeds the bounded verifier.', 3); files.push([relative, info.mode & 0o777, digest(readFileSync(path))]); }
  }; visit(''); return digest(files);
}
export async function inspectSignedApp(appPath: string, expected: ArtifactProvenance['app'], mode: 'development' | 'ad_hoc', devices: { deviceId: string; udid: string }[], invoke: typeof run = run): Promise<ArtifactProvenance['signing']> {
  const plist = async (input: Buffer): Promise<ObjectValue> => {
    const result = await invoke('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '--', '-'], { input, timeoutMs: 5000 });
    requireValue(result.code === 0, 'PLIST_UNREADABLE', 'Native artifact identity could not be decoded.', 3); return object(JSON.parse(result.stdout));
  };
  const signature = await invoke('/usr/bin/codesign', ['--verify', '--deep', '--strict', '-R=anchor apple generic and certificate leaf[subject.OU] = \"' + expected.teamId + '\"', appPath], { timeoutMs: 15000 });
  requireValue(signature.code === 0, 'ARTIFACT_SIGNATURE_INVALID', 'Signed app verification failed.', 3);
  const info = await plist(readFileSync(join(appPath, 'Info.plist')));
  requireValue(info['CFBundleIdentifier'] === expected.bundleId && info['CFBundleVersion'] === expected.buildVersion && info['CFBundleShortVersionString'] === expected.marketingVersion, 'APP_IDENTITY_MISMATCH', 'Built app bundle/version/build differs from the approved profile.');
  const profilePath = join(appPath, 'embedded.mobileprovision'), decoded = await invoke('/usr/bin/security', ['cms', '-D', '-i', profilePath], { timeoutMs: 10000 });
  requireValue(decoded.code === 0, 'PROVISIONING_INVALID', 'The signed provisioning profile could not be verified.', 3);
  const provision = await provisioningIdentity(Buffer.from(decoded.stdout));
  requireValue(Date.parse(provision.expiration) > Date.now() && provision.teams.includes(expected.teamId), 'PROVISIONING_INVALID', 'Provisioning is expired or belongs to a different team.', 3);
  const eligible = devices.filter(device => provision.devices.includes(device.udid)).map(device => device.deviceId);
  requireValue(eligible.length === devices.length && eligible.length > 0, 'PROVISIONING_DEVICE_MISMATCH', 'The approved physical identity is not covered by provisioning.', 3);
  const signed = await invoke('/usr/bin/codesign', ['--display', '--entitlements', ':-', appPath], { timeoutMs: 10000 });
  requireValue(signed.code === 0, 'SIGNING_UNAVAILABLE', 'The signed app entitlements could not be read.', 3);
  const entitlements = await plist(Buffer.from(signed.stdout));
  requireValue(entitlements['application-identifier'] === expected.applicationIdentifier && entitlements['com.apple.developer.team-identifier'] === expected.teamId &&
    (mode === 'development' ? entitlements['get-task-allow'] === true : entitlements['get-task-allow'] === false), 'ENTITLEMENTS_CHANGED', 'Signed application/team/development mode differs from the approved build.');
  const profileEntitlements = await invoke('/usr/bin/plutil', ['-extract', 'Entitlements', 'json', '-expect', 'dictionary', '-o', '-', '--', '-'], { input: Buffer.from(decoded.stdout), timeoutMs: 5000 });
  requireValue(profileEntitlements.code === 0, 'PROVISIONING_INVALID', 'Provisioning entitlements could not be read.', 3);
  const permitted = object(JSON.parse(profileEntitlements.stdout));
  requireValue(entitlementsCovered(entitlements, permitted), 'ENTITLEMENTS_NOT_PROVISIONED', 'The signed app requests an entitlement not permitted by its provisioning profile.', 3);
  return { mode, signatureVerified: true, provisioningVerified: true, entitlementsDigest: digest(entitlements), provisioningProfileDigest: digest(readFileSync(profilePath)), eligibleDeviceRefs: eligible as [string, ...string[]], verifiedAt: now() };
}

export function entitlementsCovered(actual: unknown, permitted: unknown): boolean {
  if (typeof actual === 'string' && typeof permitted === 'string') {
    if (!permitted.includes('*')) return actual === permitted;
    // Only Apple's suffix wildcard form is accepted; other patterns need an
    // explicit reviewed adapter rather than broadening their meaning here.
    return permitted.indexOf('*') === permitted.length - 1 && actual.startsWith(permitted.slice(0, -1));
  }
  if (Array.isArray(actual)) return Array.isArray(permitted) && actual.every(value => permitted.some(allowed => entitlementsCovered(value, allowed)));
  if (actual && typeof actual === 'object' && !Array.isArray(actual)) return !!permitted && typeof permitted === 'object' && !Array.isArray(permitted) &&
    Object.entries(actual).every(([key, value]) => Object.hasOwn(permitted, key) && entitlementsCovered(value, (permitted as ObjectValue)[key]));
  return actual === permitted;
}
