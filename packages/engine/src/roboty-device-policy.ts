import { join } from 'node:path';
import type { DeviceProfileConfiguration } from '@contribution/contracts';
import type { Journal } from './journal.js';
import type { Enrolled } from './repositories.js';
import type { AdoptedHooks } from './adopted-hooks.js';
import { ProjectRuntimes } from './project-runtime.js';
import { clean, identity, inputFingerprint, contained, git } from './git.js';
import { run } from './process.js';
import type { RunOptions } from './process.js';
import { digest, object, requireValue, Fault, redact } from './core.js';
import type { ObjectValue } from './core.js';
import { readStableFile } from './bounded-file.js';

/** Read-only project-owned policy inspection. Importing these exports never
 * calls ios-device.main, inventory, signing, a build, or a lease acquisition. */
const probe = String.raw`
import { readFileSync, realpathSync } from 'node:fs';
import { join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const input = JSON.parse(readFileSync(0, 'utf8'));
const project = await import(pathToFileURL(join(input.primary, 'scripts/ios-device.mjs')));
const activation = await import(pathToFileURL(join(input.primary, 'scripts/lib/repository-stage.mjs')));
activation.requireActivation('iosDevelopment', input.primary);
assert.equal(realpathSync(project.resolveUpdateCheckout(input.primary)), realpathSync(input.primary), 'The selected source must be the original active primary.');
const toolchain = JSON.parse(readFileSync(join(input.primary, 'scripts/config/ios-toolchain.json'), 'utf8'));
const selected = project.identity, config = input.config;
assert.equal(config.app.bundleId, selected.bundle, 'Preserve the project bundle identity.');
assert.equal(config.app.teamId, selected.team, 'Preserve the project team identity.');
assert.equal(config.app.applicationIdentifier, selected.team + '.' + selected.bundle, 'Preserve the signed application identity.');
for (const build of config.builds) {
  assert.equal(build.containerKind, 'project'); assert.equal(build.containerPath, toolchain.project); assert.equal(build.scheme, toolchain.scheme);
  assert.equal(build.configuration, selected.configuration); assert.equal(build.xcodeBuild, toolchain.xcodeBuild);
  assert.equal(build.appName, basename(toolchain.project, '.xcodeproj') + '.app'); assert.equal(build.signingMode, 'development', 'Local development does not activate distribution.');
  // Refuse a changed original build contract before adapting its two online
  // provisioning choices. Every other selected flag stays project-owned.
  const derived = join(input.primary, '.contribution-inspection-only');
  assert.deepEqual(project.buildArguments(toolchain, derived, config.app.buildVersion), [
    '-project', toolchain.project, '-scheme', toolchain.scheme, '-configuration', selected.configuration,
    '-destination', 'generic/platform=iOS', '-derivedDataPath', derived, '-disableAutomaticPackageResolution', '-skipPackageUpdates',
    '-allowProvisioningUpdates', 'DEVELOPMENT_TEAM=' + selected.team, 'PRODUCT_BUNDLE_IDENTIFIER=' + selected.bundle,
    'CODE_SIGN_STYLE=Automatic', 'CODE_SIGNING_ALLOWED=YES', 'INFOPLIST_FILE=' + join(derived, 'RobotyDevelopmentInfo.plist'),
    'CURRENT_PROJECT_VERSION=' + config.app.buildVersion, 'build'
  ], 'The original build contract changed; review its offline adaptation.');
}
const device = { identifier: input.device.identifier, deviceProperties: { osVersionNumber: input.device.iOSVersion }, hardwareProperties: { productType: input.device.model } };
const compatibility = project.deviceCompatibility(device);
assert.equal(compatibility.identifier, input.device.identifier); assert.equal(compatibility.os, input.device.iOSVersion); assert.equal(compatibility.product, input.device.model);
process.stdout.write('\nCONTRIBUTION_ROBOTY_POLICY=' + JSON.stringify({ primary: realpathSync(input.primary), identity: selected, toolchain, compatibility,
  offlineProvisioning: 'manual_existing_profile', phoneContacted: false, activation: 'iosDevelopment' }) + '\n');
`;

export interface RobotyDevicePolicySelection {
  sourceTip: string; sourcePath: string; inputDigest: string; adoptionDigest: string; configDigest: string;
  policyFiles: Record<string, string>; originalPolicy: ObjectValue; deviceDigest: string;
}

export class RobotyDevicePolicy {
  readonly runtimes: ProjectRuntimes;
  constructor(readonly store: Journal, readonly hooks: Pick<AdoptedHooks, 'verify'>, private readonly execute: typeof run = run) { this.runtimes = new ProjectRuntimes(store); }
  environment(runtime: Awaited<ReturnType<ProjectRuntimes['resolve']>>): NodeJS.ProcessEnv {
    const env = this.runtimes.environment(runtime);
    // Preserve the shared host circuit's normal location and the project's
    // normal resource pool. A service's inherited test overrides are not policy.
    for (const key of Object.keys(process.env)) if (key.startsWith('CONTRIBUTION_') || key.startsWith('CODEX_') || key.startsWith('DEVICECTL_CHILD_') ||
      /^(?:MC|ROBOTY|MATHY)_/.test(key) || key === 'NODE_OPTIONS' || key === 'NODE_PATH' || key === 'DYLD_INSERT_LIBRARIES') env[key] = undefined;
    return env;
  }
  async inspect(repo: Enrolled, config: DeviceProfileConfiguration, deviceId: string, expectedTip?: string, options: RunOptions = {}): Promise<RobotyDevicePolicySelection> {
    requireValue(repo.config.integration.adapter === 'roboty-v1' && repo.config.validation.adapter === 'roboty-v1' && config.repositoryId === repo.id,
      'ROBOTY_DEVICE_POLICY_REQUIRED', 'Select the enrolled Roboty primary and its matching preserved device profile.', 3);
    const adoption = await this.hooks.verify(repo); await clean(repo.path);
    const source = await identity(repo.path), inputDigest = await inputFingerprint(repo.path);
    requireValue(source.branch === repo.config.integration.branch && source.commonDir === repo.commonDir && source.tip && (!expectedTip || source.tip === expectedTip),
      'SOURCE_CHANGED', 'Roboty preparation requires its exact clean active primary source.', 3);
    const device = this.store.record<{ deviceId: string; identifier: string; udid: string; model: string | null; iOSVersion: string | null }>('coreDeviceSelection', deviceId);
    requireValue(device?.deviceId === deviceId && device.identifier && device.udid && device.model && device.iOSVersion && config.eligibleDeviceRefs.includes(deviceId),
      'DEVICE_COMPATIBILITY_REQUIRED', 'Retain this approved phone’s verified identity, OS and product during setup before offline preparation.', 3);
    const paths = ['scripts/ios-device.mjs', 'scripts/config/ios-toolchain.json', 'scripts/config/repository-stage.json', 'scripts/lib/repository-stage.mjs',
      'scripts/lib/ios-build-lease.mjs', 'scripts/lib/ios-simulator-lease.mjs', 'scripts/lib/ios-build-host-circuit.mjs', 'scripts/lib/supervised-command.mjs',
      'scripts/lib/ios-app-configuration.mjs', 'scripts/lib/ios-diagnostics.mjs', 'scripts/lib/process-identity.mjs', 'scripts/lib/pre-push-worktree-state.mjs', 'scripts/lib/worktree-landing-state.mjs'];
    const fingerprint = (): Record<string, string> => Object.fromEntries(paths.map(path => {
      contained(repo.path, path);
      return [path, digest(readStableFile(join(repo.path, path), 4 * 1024 * 1024, 'ROBOTY_DEVICE_POLICY_CHANGED'))];
    }));
    const policyFiles = fingerprint();
    // A clean status can hide assume-unchanged inputs. Executed policy must
    // match the selected committed blobs, including helpers and activation.
    await Promise.all(paths.map(async path => {
      const blob = await git(repo.path, ['cat-file', 'blob', `${source.tip}:${path}`], { maxBytes: 4 * 1024 * 1024, timeoutMs: 10000 });
      requireValue(blob.code === 0 && digest(Buffer.from(blob.stdout)) === policyFiles[path], 'ROBOTY_DEVICE_POLICY_CHANGED', 'Executed Roboty policy must match the exact committed source.', 3);
    }));
    const runtime = await this.runtimes.resolve(repo, repo.path);
    const result = await this.execute(runtime.node, ['--input-type=module', '--eval', probe], { ...options, cwd: repo.path, env: this.environment(runtime), timeoutMs: 30000, maxBytes: 128 * 1024,
      input: JSON.stringify({ primary: repo.path, config, device }) });
    if (result.code !== 0 || result.cancelled || result.timedOut) throw new Fault(result.cancelled ? 'CANCELLED' : 'ROBOTY_DEVICE_POLICY_REFUSED',
      'The original Roboty source, activation, identity or build contract refused offline preparation.', result.cancelled ? 130 : 3, { diagnostic: redact(result.stderr).slice(-2048) });
    const sections = result.stdout.split('\nCONTRIBUTION_ROBOTY_POLICY=');
    requireValue(sections.length === 2, 'ROBOTY_DEVICE_POLICY_CHANGED', 'The original policy inspector returned no unique structured result.', 3);
    const originalPolicy = object(JSON.parse(sections[1]!.trim()));
    requireValue(originalPolicy['primary'] === source.path && originalPolicy['phoneContacted'] === false && originalPolicy['activation'] === 'iosDevelopment',
      'ROBOTY_DEVICE_POLICY_CHANGED', 'The original source selection did not confirm the registered primary.', 3);
    await clean(repo.path);
    requireValue((await identity(repo.path)).tip === source.tip && await inputFingerprint(repo.path) === inputDigest && digest(fingerprint()) === digest(policyFiles) && digest(await this.hooks.verify(repo)) === digest(adoption) &&
      digest(this.store.record('coreDeviceSelection', deviceId)) === digest(device), 'ROBOTY_DEVICE_POLICY_CHANGED', 'Source, registration or retained phone compatibility changed during inspection.', 3);
    return { sourceTip: source.tip, sourcePath: source.path, inputDigest, adoptionDigest: digest(adoption), configDigest: digest(config), policyFiles, originalPolicy, deviceDigest: digest(device) };
  }
}
