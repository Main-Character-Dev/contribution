import { join } from 'node:path';
import type { DeviceProfileConfiguration } from '@contribution/contracts';
import type { Journal } from './journal.js';
import type { Enrolled } from './repositories.js';
import type { AdoptedHooks } from './adopted-hooks.js';
import { RobotyDevicePolicy } from './roboty-device-policy.js';
import { readStableFile } from './bounded-file.js';
import { identity, clean, inputFingerprint, contained } from './git.js';
import { run } from './process.js';
import type { RunOptions } from './process.js';
import { object, digest, requireValue, Fault, redact } from './core.js';
import type { ObjectValue } from './core.js';

type Build = DeviceProfileConfiguration['builds'][number];
const worker = String.raw`
import { readFileSync } from 'node:fs';
import { readFile, mkdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const input = JSON.parse(readFileSync(0, 'utf8')), {build, config, primary, source, directory, device}=input;
const project = await import(pathToFileURL(join(source,'scripts/ios-device.mjs')));
const activation = await import(pathToFileURL(join(source,'scripts/lib/repository-stage.mjs')));
const supervision = await import(pathToFileURL(join(source,'scripts/lib/supervised-command.mjs')));
const resources = await import(pathToFileURL(join(source,'scripts/lib/ios-build-lease.mjs')));
const leases = await import(pathToFileURL(join(source,'scripts/lib/ios-simulator-lease.mjs')));
const circuit = await import(pathToFileURL(join(source,'scripts/lib/ios-build-host-circuit.mjs')));
assert.equal(project.resolveUpdateCheckout(primary),primary);
activation.requireActivation('iosDevelopment',primary); activation.requireActivation('iosDevelopment',source);
assert.ok(supervision.COMMAND_TERMINATION_GRACE_MS >= 0 && supervision.COMMAND_TERMINATION_GRACE_MS <= 5000, 'Original child termination needs a newly reviewed outer deadline.');
const controller = new AbortController();
const stop = () => controller.abort(); process.on('SIGTERM',stop); process.on('SIGINT',stop);
let lease, updates=Promise.resolve(), leaseFailure;
const update = values => updates=updates.then(()=>leases.updateIOSSimulatorLease(lease,values));
const command = async (executable, args, timeoutMs=30000) => {
 controller.signal.throwIfAborted(); if(leaseFailure) throw leaseFailure;
 const result=await supervision.runSupervisedCommand(executable,args,{cwd:source,timeoutMs,mirror:false,maxCapturedOutputBytes:2*1024*1024,
  onSpawn:async value=>{
   assert.ok(value.childPid>0 && value.childStartTime, 'The actual child identity must be retained.');
   process.stdout.write('\nCONTRIBUTION_ROBOTY_CHILD='+JSON.stringify({pid:value.childPid,start:value.childStartTime})+'\n');
   if(lease) await update({childPid:value.childPid,childProcessGroup:value.childProcessGroup,childStartTime:value.childStartTime,phaseStartedAt:value.startedAt,deadlineAt:value.deadlineAt});
  },
  onHeartbeat:()=>{if(lease) void update({}).catch(error=>{leaseFailure=error;process.kill(process.pid,'SIGTERM');});},
  onOutput:({chunk})=>process.stderr.write(chunk)
 });
 controller.signal.throwIfAborted(); await updates; if(leaseFailure) throw leaseFailure; return result.output;
};
try {
 const toolchainConfig=JSON.parse(await readFile(join(source,'scripts/config/ios-toolchain.json'),'utf8'));
 const xcode=join(build.developerDirectory,'usr/bin/xcodebuild');
 const toolchain=await command(xcode,['-version']); assert.ok(toolchain.includes('Build version '+toolchainConfig.xcodeBuild+'\n'),'The original Xcode pin changed.');
 const compatibility=project.deviceCompatibility({identifier:device.identifier,deviceProperties:{osVersionNumber:device.iOSVersion},hardwareProperties:{productType:device.model}});
 const sourceInputs=async()=>{
  const hash=createHash('sha256').update(JSON.stringify({toolchain,identity:project.identity,revision:config.app.buildVersion,device:compatibility}));
  for(const file of ['apps/ios','packages/workbench-api-swift','scripts/config/ios-toolchain.json','scripts/ios-device.mjs']) {
   const location=join(source,file); hash.update(file).update((await lstat(location)).isDirectory()
    ? await project.hashTree(location,new Set(['.build','build','DerivedData','xcuserdata','.DS_Store','__pycache__'])) : await readFile(location));
  }
  return hash.digest('hex');
 };
 const inputs=await sourceInputs(), derived=join(directory,'DerivedData'), products=join(directory,'products');
 await mkdir(derived,{recursive:true,mode:0o700}); await mkdir(products,{mode:0o700});
 circuit.assertIOSBuildHostReady();
 lease=await resources.acquireIOSBuildLease({runId:directory,label:'Contribution Roboty offline preparation',worktreePath:source,signal:controller.signal,waitTimeoutMs:Math.min(60000,build.timeoutSeconds*1000)});
 circuit.assertIOSBuildHostReady();
 await command('/usr/bin/python3',['packages/workbench-api-swift/generate.py','--check']);
 const info=join(derived,'RobotyDevelopmentInfo.plist');
 await command('/usr/bin/plutil',['-convert','xml1','-o',info,join(source,'apps/ios/Info.plist')]);
 await command('/usr/bin/plutil',['-insert','RobotyBuildIdentity','-string',inputs,info]);
 const original=project.buildArguments(toolchainConfig,derived,config.app.buildVersion);
 assert.equal(original.filter(value=>value==='-allowProvisioningUpdates').length,1); assert.equal(original.filter(value=>value==='CODE_SIGN_STYLE=Automatic').length,1);
 const args=original.filter(value=>value!=='-allowProvisioningUpdates').map(value=>value==='CODE_SIGN_STYLE=Automatic'?'CODE_SIGN_STYLE=Manual':value);
 args.push('PROVISIONING_PROFILE_SPECIFIER='+build.provisioningProfileSpecifier,'CONFIGURATION_BUILD_DIR='+products);
 assert.ok(!args.some(value=>/^-(?:allowProvisioning|authenticationKey)/.test(value)));
 await command(xcode,args,Math.min(build.timeoutSeconds*1000,supervision.IOS_BUILD_COMMAND_TIMEOUT_MS));
 const app=join(products,build.appName);
 await command('/usr/bin/codesign',['--verify','--deep','--strict',app]);
 const entitlementPath=join(directory,'original-entitlements.plist');
 await command('/usr/bin/codesign',['-d','--entitlements',entitlementPath,'--xml',app]);
 const entitlements=JSON.parse(await command('/usr/bin/plutil',['-convert','json','-o','-',entitlementPath]));
 project.assertEntitlements(entitlements);
 const appInfo=JSON.parse(await command('/usr/bin/plutil',['-convert','json','-o','-',join(app,'Info.plist')]));
 project.assertAppInfo(appInfo,config.app.buildVersion,inputs);
 assert.ok(parseFloat(appInfo.MinimumOSVersion)<=parseFloat(device.iOSVersion),'Selected retained phone OS is below the app minimum.');
 const artifactDigest=await project.hashTree(app);
 assert.equal(await sourceInputs(),inputs,'Original native build inputs changed during preparation.');
 controller.signal.throwIfAborted();
 process.stdout.write('\nCONTRIBUTION_ROBOTY_BUILD='+JSON.stringify({appPath:app,inputs,artifactDigest,phoneContacted:false,originalIdentityVerified:true,originalEntitlementsVerified:true,originalBuildPool:true,provisioning:'manual_existing_profile'})+'\n');
} finally {
 if(lease) { await updates; await update({childPid:null,childProcessGroup:null,childStartTime:null,deadlineAt:null}); assert.equal(await resources.releaseIOSBuildLease(lease),true,'The original lease changed before release.'); }
 process.removeListener('SIGTERM',stop); process.removeListener('SIGINT',stop);
}
`;

/** Supervised offline build through preserved project exports. Phone/session
 * operations and provisioning updates are absent from this worker. */
export class RobotyOfflineBuild {
  readonly policy: RobotyDevicePolicy;
  constructor(readonly store: Journal, hooks: Pick<AdoptedHooks, 'verify'>, private readonly execute: typeof run = run) { this.policy = new RobotyDevicePolicy(store, hooks); }
  async build(primary: Enrolled, source: string, config: DeviceProfileConfiguration, build: Build, directory: string, deviceId: string, options: RunOptions): Promise<{ appPath: string; evidence: ObjectValue }> {
    requireValue(config.builds.some(value => digest(value) === digest(build)), 'BUILD_PROFILE_UNCONFIGURED', 'Select an unchanged build from this exact registered profile.', 3);
    const snapshot = await identity(source), selection = await this.policy.inspect(primary, config, deviceId, snapshot.tip ?? undefined, options);
    requireValue(source !== primary.path && !snapshot.branch && snapshot.commonDir === primary.commonDir && snapshot.tip === selection.sourceTip,
      'BUILD_SOURCE_UNCONFIRMED', 'Roboty must build the retained committed detached snapshot from its active primary.', 3);
    await clean(source); const inputDigest = await inputFingerprint(source);
    for (const [path, hash] of Object.entries(selection.policyFiles)) requireValue(digest(readStableFile(contained(source, path), 4 * 1024 * 1024, 'ROBOTY_DEVICE_POLICY_CHANGED')) === hash,
      'ROBOTY_DEVICE_POLICY_CHANGED', 'The isolated policy source differs from the reviewed primary.', 3);
    const runtime = await this.policy.runtimes.resolve(primary, source), device = this.store.record('coreDeviceSelection', deviceId);
    const environment = { ...this.policy.environment(runtime), DEVELOPER_DIR: build.developerDirectory };
    const result = await this.execute(runtime.node, ['--input-type=module', '--eval', worker], { ...options, cwd: source, env: environment,
      input: JSON.stringify({ primary: primary.path, source, config, build, directory, device }), timeoutMs: build.timeoutSeconds * 1000 + 300000,
      terminationGraceMs: 10000, maxBytes: 8 * 1024 * 1024, output: text => {
        for (const line of text.split('\n')) {
          if (line.startsWith('CONTRIBUTION_ROBOTY_CHILD=')) {
            const child = object(JSON.parse(line.slice('CONTRIBUTION_ROBOTY_CHILD='.length)));
            requireValue(Number.isSafeInteger(child['pid']) && Number(child['pid']) > 0 && typeof child['start'] === 'string' && child['start'].length > 0,
              'BUILD_PROCESS_UNCONFIRMED', 'The original build child has no retained identity.', 3);
            options.started?.(Number(child['pid']), child['start']);
          } else if (!line.startsWith('CONTRIBUTION_ROBOTY_BUILD=') && line) options.output?.(line + '\n');
        }
      } });
    if (result.code !== 0 || result.cancelled || result.timedOut) throw new Fault(result.cancelled ? 'CANCELLED' : 'BUILD_FAILED',
      'Roboty offline preparation failed under its original policy and build resource owner. Retained output identifies the missing prerequisite.', result.cancelled ? 130 : 5,
      { diagnostic: redact(result.stderr).slice(-2048), timedOut: result.timedOut });
    const sections = result.stdout.split('\nCONTRIBUTION_ROBOTY_BUILD='); requireValue(sections.length === 2, 'BUILD_OUTPUT_UNCONFIRMED', 'The original worker returned no unique completion receipt.', 5);
    const evidence = object(JSON.parse(sections[1]!.trim()));
    requireValue(evidence['appPath'] === join(directory, 'products', build.appName) && evidence['phoneContacted'] === false && evidence['originalIdentityVerified'] === true &&
      evidence['originalEntitlementsVerified'] === true && evidence['originalBuildPool'] === true && /^[a-f0-9]{64}$/.test(String(evidence['inputs'])) && /^[a-f0-9]{64}$/.test(String(evidence['artifactDigest'])),
      'BUILD_OUTPUT_UNCONFIRMED', 'The original worker did not confirm its exact offline output.', 5);
    await clean(source); requireValue(await inputFingerprint(source) === inputDigest, 'BUILD_INPUT_CHANGED', 'Isolated source changed during preparation.', 5);
    const after = await this.policy.inspect(primary, config, deviceId, selection.sourceTip, options);
    requireValue(digest(after) === digest(selection), 'ROBOTY_DEVICE_POLICY_CHANGED', 'Original project or retained phone policy changed during preparation.', 5);
    return { appPath: String(evidence['appPath']), evidence: { ...evidence, policy: selection } };
  }
}
