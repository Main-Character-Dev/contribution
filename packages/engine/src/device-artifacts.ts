import { opendirSync, lstatSync, realpathSync } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { join } from 'node:path';
import type { ArtifactProvenance } from '@contribution/contracts';
import { run } from './process.js';
import { digest, now, requireValue, object } from './core.js';
import type { ObjectValue } from './core.js';
import { readStableFile, stableFileDigest } from './bounded-file.js';

export function artifactFileDigest(path: string): string {
  const file = stableFileDigest(path, 1024 ** 3, 'ARTIFACT_CHANGED');
  requireValue(file.bytes > 0, 'ARTIFACT_INVALID', 'The signed archive must contain bounded regular file bytes.', 3);
  return file.sha256;
}

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
  const files: [string, number, string][] = [], entries: { path: string; relative: string; stat: BigIntStats }[] = [];
  const canonicalRoot = realpathSync(root); let bytes = 0n;
  const same = (a: BigIntStats, b: BigIntStats): boolean => a.dev === b.dev && a.ino === b.ino && a.mode === b.mode && a.uid === b.uid &&
    a.nlink === b.nlink && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
  const verify = (entry: typeof entries[number]): void => {
    requireValue(same(entry.stat, lstatSync(entry.path, { bigint: true })) && realpathSync(root) === canonicalRoot,
      'ARTIFACT_CHANGED', 'The signed app tree changed during bounded verification.', 3);
  };
  const visit = (relative: string, depth: number): void => {
    const path = join(root, relative), stat = lstatSync(path, { bigint: true });
    requireValue(!stat.isSymbolicLink(), 'ARTIFACT_LINK_UNSUPPORTED', 'An installable artifact must have contained regular bundle files.', 3);
    requireValue(stat.uid === BigInt(process.getuid?.() ?? -1) && (stat.isDirectory() || stat.isFile() && stat.nlink === 1n),
      'ARTIFACT_CHANGED', 'The app must contain owned directories and unshared regular files.', 3);
    requireValue(relative !== '' || stat.isDirectory(), 'ARTIFACT_INVALID', 'The signed app root must be a directory.', 3);
    requireValue(depth <= 32 && entries.length < 100000, 'ARTIFACT_TOO_LARGE', 'The signed app tree exceeds its entry or nesting bound.', 3);
    const entry = { path, relative, stat }; entries.push(entry);
    if (stat.isDirectory()) {
      const names: string[] = [], directory = opendirSync(path);
      try {
        for (let child = directory.readSync(); child; child = directory.readSync()) {
          requireValue(names.length + entries.length < 100000, 'ARTIFACT_TOO_LARGE', 'The signed app directory exceeds the bounded census.', 3); names.push(child.name);
        }
      } finally { directory.closeSync(); }
      verify(entry);
      for (const name of names.sort()) { verify(entry); visit(join(relative, name), depth + 1); }
      verify(entry);
    } else { bytes += stat.size; requireValue(bytes <= 4n * 1024n ** 3n, 'ARTIFACT_TOO_LARGE', 'The signed app bytes exceed the bounded verifier.', 3); }
  };
  // Census bounds include empty directories. Hashing uses one MiB buffers and
  // preserves the original ordered [path, mode, content digest] wire identity.
  visit('', 0);
  for (const entry of entries) if (entry.stat.isFile()) {
    verify(entry); const file = stableFileDigest(entry.path, Number(entry.stat.size), 'ARTIFACT_CHANGED'); verify(entry);
    files.push([entry.relative, Number(entry.stat.mode & 0o777n), file.sha256]);
  }
  for (const entry of entries) verify(entry);
  return digest(files);
}
export async function inspectSignedApp(appPath: string, expected: ArtifactProvenance['app'], mode: 'development' | 'ad_hoc', devices: { deviceId: string; udid: string }[], invoke: typeof run = run): Promise<ArtifactProvenance['signing']> {
  const before = appTreeDigest(appPath);
  const plist = async (input: Buffer): Promise<ObjectValue> => {
    const result = await invoke('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '--', '-'], { input, timeoutMs: 5000 });
    requireValue(result.code === 0, 'PLIST_UNREADABLE', 'Native artifact identity could not be decoded.', 3); return object(JSON.parse(result.stdout));
  };
  const signature = await invoke('/usr/bin/codesign', ['--verify', '--deep', '--strict', '-R=anchor apple generic and certificate leaf[subject.OU] = \"' + expected.teamId + '\"', appPath], { timeoutMs: 15000 });
  requireValue(signature.code === 0, 'ARTIFACT_SIGNATURE_INVALID', 'Signed app verification failed.', 3);
  const info = await plist(readStableFile(join(appPath, 'Info.plist'), 4 * 1024 ** 2, 'APP_IDENTITY_INVALID'));
  requireValue(info['CFBundleIdentifier'] === expected.bundleId && info['CFBundleVersion'] === expected.buildVersion && info['CFBundleShortVersionString'] === expected.marketingVersion, 'APP_IDENTITY_MISMATCH', 'Built app bundle/version/build differs from the approved profile.');
  const profilePath = join(appPath, 'embedded.mobileprovision'), profile = readStableFile(profilePath, 16 * 1024 ** 2, 'PROVISIONING_INVALID');
  const decoded = await invoke('/usr/bin/security', ['cms', '-D'], { input: profile, timeoutMs: 10000 });
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
  requireValue(digest(readStableFile(profilePath, 16 * 1024 ** 2, 'PROVISIONING_INVALID')) === digest(profile), 'PROVISIONING_CHANGED', 'Provisioning bytes changed while their identity was verified.', 3);
  requireValue(appTreeDigest(appPath) === before, 'ARTIFACT_CHANGED', 'The signed app changed while signature and provisioning were verified.', 3);
  return { mode, signatureVerified: true, provisioningVerified: true, entitlementsDigest: digest(entitlements), provisioningProfileDigest: digest(profile), eligibleDeviceRefs: eligible as [string, ...string[]], verifiedAt: now() };
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
