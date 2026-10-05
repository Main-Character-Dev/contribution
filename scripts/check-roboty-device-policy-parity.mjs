// Read the named original source; all Git/filesystem mutations stay in this
// disposable fixture. No phone, build, signing tool or shared lease is invoked.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, realpathSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Journal } from '../packages/engine/dist/journal.js';
import { Repositories } from '../packages/engine/dist/repositories.js';
import { RobotyDevicePolicy } from '../packages/engine/dist/roboty-device-policy.js';
import { projectPins } from '../packages/adapters/dist/index.js';
import { digest } from '../packages/engine/dist/core.js';

const original = resolve(process.argv[2] ?? '/Users/gabe/Sites/roboty');
const root = realpathSync(mkdtempSync(join(tmpdir(), 'ct-roboty-policy-parity-'))), primary = join(root, 'primary');
const git = (...args) => execFileSync('/usr/bin/git', args, { cwd: primary, encoding: 'utf8', timeout: 10000 }).trim();
let store;
try {
  mkdirSync(join(primary, 'scripts/lib'), { recursive: true }); mkdirSync(join(primary, 'scripts/config'));
  const paths = ['scripts/ios-device.mjs', 'scripts/config/ios-toolchain.json', 'scripts/lib/repository-stage.mjs', 'scripts/lib/ios-build-lease.mjs',
    'scripts/lib/ios-simulator-lease.mjs', 'scripts/lib/ios-build-host-circuit.mjs', 'scripts/lib/supervised-command.mjs', 'scripts/lib/ios-app-configuration.mjs',
    'scripts/lib/ios-diagnostics.mjs', 'scripts/lib/process-identity.mjs', 'scripts/lib/pre-push-worktree-state.mjs', 'scripts/lib/worktree-landing-state.mjs'];
  for (const path of paths) cpSync(join(original, path), join(primary, path), { errorOnExist: true, force: false });
  // Activation is synthetic and exists only inside the disposable project.
  writeFileSync(join(primary, 'scripts/config/repository-stage.json'), JSON.stringify({ stage: 'local', hosted: false, ios: false, robotics: false, simulation: false, iosDevelopment: true }));
  writeFileSync(join(primary, '.nvmrc'), process.version.slice(1)); writeFileSync(join(primary, 'package.json'), JSON.stringify({ name: 'fixture', packageManager: 'pnpm@11.23.0' }));
  git('init', '--initial-branch=roboty-1'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'roboty.activeBranch', 'roboty-1'); git('add', '--all'); git('commit', '-m', 'Private disposable original-source parity');
  store = new Journal(join(root, 'state')); const enrolled = await new Repositories(store).add(primary), config = structuredClone(enrolled.config); config.integration.adapter = config.validation.adapter = 'roboty-v1';
  const repo = { ...enrolled, config }, program = await import(pathToFileURL(join(primary, 'scripts/ios-device.mjs'))), toolchain = JSON.parse(readFileSync(join(primary, 'scripts/config/ios-toolchain.json')));
  const pnpm = join(root, 'pnpm'); writeFileSync(pnpm, '#!/bin/sh\nprintf "11.23.0\\n"\n', { mode: 0o755 });
  store.put('projectRuntimeSelection', repo.id, { node: process.execPath, pnpm, nodeVersion: process.version.slice(1), pnpmVersion: '11.23.0', pinsDigest: projectPins(primary).inputs });
  const deviceId = 'device-fixture'; store.put('coreDeviceSelection', deviceId, { deviceId, identifier: 'fixture-connection', udid: 'fixture-hardware', model: 'fixture-model', iOSVersion: '27.0' });
  const profile = { repositoryId: repo.id, app: { bundleId: program.identity.bundle, teamId: program.identity.team, applicationIdentifier: program.identity.team + '.' + program.identity.bundle, buildVersion: '42' }, eligibleDeviceRefs: [deviceId], builds: [{ containerKind: 'project', containerPath: toolchain.project, scheme: toolchain.scheme, configuration: program.identity.configuration, xcodeBuild: toolchain.xcodeBuild, appName: 'Roboty.app', signingMode: 'development' }] };
  const policy = new RobotyDevicePolicy(store, { verify: async () => ({ adoptionId: 'fixture-only' }) });
  const selected = await policy.inspect(repo, profile, deviceId, git('rev-parse', 'HEAD'));
  assert.equal(selected.originalPolicy.phoneContacted, false); assert.equal(git('status', '--porcelain'), '');
  const foreign = structuredClone(profile); foreign.app.bundleId = 'dev.unapproved.fixture'; await assert.rejects(policy.inspect(repo, foreign, deviceId), { code: 'ROBOTY_DEVICE_POLICY_REFUSED' });
  git('config', 'roboty.activeBranch', 'roboty-2'); await assert.rejects(policy.inspect(repo, profile, deviceId), { code: 'ROBOTY_DEVICE_POLICY_REFUSED' });
  console.log(JSON.stringify({ recordMode: 'fixture', originalSource: 'read_only', sourceDigests: Object.fromEntries(paths.map(path => [path, digest(readFileSync(join(original, path)))])),
    passed: ['original_export_shape', 'original_active_primary_selection', 'original_development_activation', 'original_identity_and_build_arguments', 'foreign_identity_refusal', 'active_branch_refusal'], phoneContacted: false, buildStarted: false, liveProjectChanged: false }));
} finally { store?.close(); rmSync(root, { recursive: true, force: true }); }
