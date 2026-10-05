import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Journal } from '../packages/engine/dist/journal.js';
import { Repositories } from '../packages/engine/dist/repositories.js';
import { RobotyDevicePolicy } from '../packages/engine/dist/roboty-device-policy.js';
import { projectPins } from '../packages/adapters/dist/index.js';
import { run } from '../packages/engine/dist/process.js';
import { repository, git } from './integration/service.mjs';

const program = `
import {execFileSync} from 'node:child_process'; import {join} from 'node:path';
export const identity={bundle:'dev.fixture.roboty',team:'FIXTURE123',configuration:'Debug'};
export function main(){throw Error('Never call the phone-facing entry point');}
export function resolveUpdateCheckout(root) {
 const git=args=>execFileSync('/usr/bin/git',args,{cwd:root,encoding:'utf8'}).trim();
 if(git(['branch','--show-current'])!==git(['config','--get','roboty.activeBranch'])) throw Error('Active primary changed'); return root;
}
export function deviceCompatibility(device) {return {identifier:device.identifier,os:device.deviceProperties.osVersionNumber,product:device.hardwareProperties.productType};}
export function buildArguments(config, derivedData, revision='1') {return [
 '-project',config.project,'-scheme',config.scheme,'-configuration',identity.configuration,'-destination','generic/platform=iOS',
 '-derivedDataPath',derivedData,'-disableAutomaticPackageResolution','-skipPackageUpdates','-allowProvisioningUpdates',
 'DEVELOPMENT_TEAM='+identity.team,'PRODUCT_BUNDLE_IDENTIFIER='+identity.bundle,'CODE_SIGN_STYLE=Automatic','CODE_SIGNING_ALLOWED=YES',
 'INFOPLIST_FILE='+join(derivedData,'RobotyDevelopmentInfo.plist'),'CURRENT_PROJECT_VERSION='+revision,'build'];}
`;
async function fixture(invoke = run) {
  const root = mkdtempSync(join(tmpdir(), 'ct-roboty-policy-')), path = repository(root), store = new Journal(join(root, 'state'));
  const files = ['ios-build-lease', 'ios-simulator-lease', 'ios-build-host-circuit', 'supervised-command', 'ios-app-configuration', 'ios-diagnostics', 'process-identity', 'pre-push-worktree-state', 'worktree-landing-state'];
  mkdirSync(join(path, 'scripts/lib'), { recursive: true }); mkdirSync(join(path, 'scripts/config'));
  for (const file of files) writeFileSync(join(path, 'scripts/lib', file + '.mjs'), 'export {};\n');
  writeFileSync(join(path, 'scripts/lib/repository-stage.mjs'), `import {readFileSync} from 'node:fs'; export function requireActivation(capability,root){ if(capability!=='iosDevelopment'||JSON.parse(readFileSync(root+'/scripts/config/repository-stage.json')).iosDevelopment!==true)throw Error('Not activated'); }`);
  writeFileSync(join(path, 'scripts/config/repository-stage.json'), JSON.stringify({ iosDevelopment: true, ios: false }));
  writeFileSync(join(path, 'scripts/config/ios-toolchain.json'), JSON.stringify({ project: 'apps/ios/Roboty.xcodeproj', scheme: 'Roboty', xcodeBuild: 'fixture-build' }));
  writeFileSync(join(path, 'scripts/ios-device.mjs'), program);
  writeFileSync(join(path, '.nvmrc'), process.version.slice(1)); writeFileSync(join(path, 'package.json'), JSON.stringify({ name: 'fixture', packageManager: 'pnpm@11.23.0' }));
  git(path, 'add', '--all'); git(path, 'commit', '-m', 'Fixture preserved device policy'); git(path, 'config', 'roboty.activeBranch', 'dev');
  const repos = new Repositories(store), enrolled = await repos.add(path), config = structuredClone(enrolled.config); config.integration.adapter = config.validation.adapter = 'roboty-v1';
  const repo = { ...enrolled, config }, deviceId = 'device-offline-fixture';
  store.put('coreDeviceSelection', deviceId, { deviceId, identifier: 'private-fixture-connection', udid: 'private-fixture-hardware', model: 'fixture-phone', iOSVersion: '27.0' });
  const pnpm = join(root, 'pnpm'); writeFileSync(pnpm, '#!/bin/sh\nprintf "11.23.0\\n"\n', { mode: 0o755 });
  store.put('projectRuntimeSelection', repo.id, { node: process.execPath, pnpm, nodeVersion: process.version.slice(1), pnpmVersion: '11.23.0', pinsDigest: projectPins(path).inputs });
  const profile = { schemaVersion: 1, repositoryId: repo.id, adapterId: 'xcode-ios-v1', app: { bundleId: 'dev.fixture.roboty', teamId: 'FIXTURE123', applicationIdentifier: 'FIXTURE123.dev.fixture.roboty', marketingVersion: '1.0', buildVersion: '42' },
    eligibleDeviceRefs: [deviceId], permitsForeground: false, builds: [{ id: 'development', containerKind: 'project', containerPath: 'apps/ios/Roboty.xcodeproj', scheme: 'Roboty', configuration: 'Debug', xcodeBuild: 'fixture-build', appName: 'Roboty.app', signingMode: 'development' }] };
  let verified = 0, adoption = { adoptionId: 'fixture-reviewed-registration' };
  const policy = new RobotyDevicePolicy(store, { verify: async () => { verified++; return adoption; } }, invoke);
  return { root, path, store, repo, deviceId, profile, policy, verified: () => verified, setAdoption: value => { adoption = value; }, tip: git(path, 'rev-parse', 'HEAD'),
    cleanup: () => { store.close(); rmSync(root, { recursive: true }); } };
}

test('Roboty offline policy imports original exports without running its phone-facing main or changing source', async () => {
  const f = await fixture(); try {
    const selected = await f.policy.inspect(f.repo, f.profile, f.deviceId, f.tip);
    assert.equal(selected.sourceTip, f.tip); assert.equal(selected.sourcePath, realpathSync(f.path)); assert.equal(selected.originalPolicy.phoneContacted, false);
    assert.equal(selected.originalPolicy.offlineProvisioning, 'manual_existing_profile'); assert.equal(f.verified(), 2);
    assert.equal(Object.keys(selected.policyFiles).length, 13); assert.equal(git(f.path, 'status', '--porcelain'), '');
    assert.deepEqual(f.store.records('deviceArtifact'), []); assert.deepEqual(f.store.records('deviceOwnership'), []);
    const prior = process.env.MC_IOS_BUILD_HOST_CIRCUIT_PATH;
    process.env.MC_IOS_BUILD_HOST_CIRCUIT_PATH = '/fixture/override';
    try { assert.equal(f.policy.environment({ node: process.execPath, pnpm: join(f.root, 'pnpm') }).MC_IOS_BUILD_HOST_CIRCUIT_PATH, undefined); }
    finally { if (prior === undefined) delete process.env.MC_IOS_BUILD_HOST_CIRCUIT_PATH; else process.env.MC_IOS_BUILD_HOST_CIRCUIT_PATH = prior; }
  } finally { f.cleanup(); }
});

test('Roboty source, development activation, identity, build flags and retained compatibility remain required', async () => {
  const f = await fixture(); try {
    for (const change of [profile => { profile.app.bundleId = 'dev.other.app'; }, profile => { profile.app.teamId = 'OTHERTEAM1'; },
      profile => { profile.builds[0].signingMode = 'ad_hoc'; }, profile => { profile.builds[0].scheme = 'Another'; }, profile => { profile.builds[0].configuration = 'Release'; },
      profile => { profile.builds[0].xcodeBuild = 'different'; }]) {
      const changed = structuredClone(f.profile); change(changed);
      await assert.rejects(f.policy.inspect(f.repo, changed, f.deviceId), { code: 'ROBOTY_DEVICE_POLICY_REFUSED' });
    }
    git(f.path, 'config', 'roboty.activeBranch', 'another'); await assert.rejects(f.policy.inspect(f.repo, f.profile, f.deviceId), { code: 'ROBOTY_DEVICE_POLICY_REFUSED' }); git(f.path, 'config', 'roboty.activeBranch', 'dev');
    for (const [path, replacement] of [['scripts/config/repository-stage.json', '{"iosDevelopment":false}'], ['scripts/ios-device.mjs', program.replace("'CODE_SIGNING_ALLOWED=YES'", "'CODE_SIGNING_ALLOWED=NO'")]]) {
      const original = readFileSync(join(f.path, path)); writeFileSync(join(f.path, path), replacement); git(f.path, 'add', path); git(f.path, 'commit', '-m', 'Fixture changed policy');
      await assert.rejects(f.policy.inspect(f.repo, f.profile, f.deviceId), { code: 'ROBOTY_DEVICE_POLICY_REFUSED' });
      writeFileSync(join(f.path, path), original); git(f.path, 'add', path); git(f.path, 'commit', '-m', 'Fixture restored policy');
    }
    writeFileSync(join(f.path, 'owner-draft'), 'preserve'); await assert.rejects(f.policy.inspect(f.repo, f.profile, f.deviceId), { code: 'DIRTY_PRIMARY' });
    assert.equal(readFileSync(join(f.path, 'owner-draft'), 'utf8'), 'preserve');
  } finally { f.cleanup(); }
});

test('Roboty offline selection refuses policy or phone compatibility changes during its original inspection', async () => {
  for (const change of ['adoption', 'device', 'source', 'hidden-policy']) {
    let f;
    f = await fixture(async (...args) => {
      const result = await run(...args);
      if (change === 'adoption') f.setAdoption({ adoptionId: 'replacement' });
      if (change === 'device') f.store.put('coreDeviceSelection', f.deviceId, { ...f.store.record('coreDeviceSelection', f.deviceId), iOSVersion: 'different' });
      if (change === 'source') writeFileSync(join(f.path, 'owner-draft'), 'preserve');
      if (change === 'hidden-policy') { git(f.path, 'update-index', '--assume-unchanged', 'scripts/lib/ios-app-configuration.mjs'); writeFileSync(join(f.path, 'scripts/lib/ios-app-configuration.mjs'), 'export const changed=true;\n'); }
      return result;
    });
    try { await assert.rejects(f.policy.inspect(f.repo, f.profile, f.deviceId), { code: change === 'source' ? 'DIRTY_PRIMARY' : 'ROBOTY_DEVICE_POLICY_CHANGED' }); }
    finally { f.cleanup(); }
  }
});
