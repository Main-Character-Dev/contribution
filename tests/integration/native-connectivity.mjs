import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, readdirSync, chmodSync, rmSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { request } from '../../packages/engine/dist/ipc.js';
const root=realpathSync(mkdtempSync(join(tmpdir(),'ct-native-connectivity-'))), contents=join(root,'Fixture.app/Contents'), support=join(root,'support'), state=join(support,'Journal');
let child, errors='', workerPid;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
try {
  mkdirSync(join(contents,'Library'),{recursive:true}); mkdirSync(join(contents,'Resources'));
  const launcher=join(contents,'Library/ContributionService'); copyFileSync(process.argv[2],launcher);
  const built=spawnSync(process.execPath,['scripts/package-payload.mjs',join(contents,'Resources/Engine')],{encoding:'utf8'});assert.equal(built.status,0,built.stderr);
  child=spawn(launcher,[],{env:{...process.env,CONTRIBUTION_TEST_SUPPORT_ROOT:support},stdio:['pipe','pipe','pipe']});child.stderr.on('data',b=>errors+=b);
  const first=await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error(errors)})]);assert.equal(JSON.parse(String(first[0])).state,'ready');
  const call=(command,args={})=>request(state,{schemaVersion:1,command,args,cwd:root});
  const status=async()=> (await call('service.status')).result;
  const until=async predicate=>{for(let i=0;i<100;i++){try {const value=await status();if(predicate(value))return value;}catch{} await delay(50);}throw Error('Native/engine condition did not settle: '+errors);};
  let value=await until(s=>s.connectivityHintReceipt?.event==='launch'&&s.connectivityHints.status!=='unknown');workerPid=value.processId;assert.notEqual(workerPid,child.pid);
  const nativeCLI=spawnSync(launcher,['--cli','service','status','--json'],{env:{...process.env,CONTRIBUTION_TEST_SUPPORT_ROOT:support},encoding:'utf8',timeout:10000});assert.equal(nativeCLI.status,0,nativeCLI.stderr);assert.equal(JSON.parse(nativeCLI.stdout).result.processId,workerPid);
  child.stdin.write('{"event":"bridge","status":"subscription_failed"}\n');await until(s=>s.connectivityHints.status==='subscription_failed');
  const before=(await status()).connectivityHints;
  child.stdin.write('not-json\n'+JSON.stringify({event:'bridge',status:'available',inventory:'private'})+'\n'+'x'.repeat(1000)+'\n');await delay(100);assert.deepEqual((await status()).connectivityHints,before);
  child.stdin.write('{"event":"wake"}\n');await until(s=>s.connectivityHintReceipt?.event==='wake');
  await call('service.pause');const paused=(await status()).connectivityHintReceipt;child.stdin.write('{"event":"network"}\n');await delay(100);assert.deepEqual((await status()).connectivityHintReceipt,paused);
  await call('service.resume');assert.equal((await call('service.restart',{whenIdle:true})).result.state,'restart_ready');await until(s=>s.state==='running'&&!s.maintenance);
  assert.equal((await status()).processId,workerPid,'exec restart retains the engine PID and inherited event pipe');assert.equal(child.exitCode,null);
  child.stdin.write('{"event":"network"}\n');await until(s=>s.connectivityHintReceipt?.event==='network');
  const window=(await call('maintenance.begin',{requestId:randomUUID()})).result.window;const held=(await status()).connectivityHintReceipt;child.stdin.write('{"event":"wake"}\n');await delay(100);assert.deepEqual((await status()).connectivityHintReceipt,held);
  assert.equal((await call('maintenance.resume',{windowId:window.id,observedPayload:(await call('version')).result.payload,outcome:'cancelled'})).error,null);
  child.kill('SIGINT');await once(child,'exit');assert.equal(child.exitCode,0,errors);
  console.log('Real native parent, immutable verified engine, CLI, categorical bridge failures, malformed bounds, pause/maintenance, restart pipe and signal drain pass in disposable state.');
} finally {
  if(child?.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}
  const writable=path=>{chmodSync(path,0o700);for(const item of readdirSync(path,{withFileTypes:true}))if(item.isDirectory())writable(join(path,item.name));};writable(root);rmSync(root,{recursive:true});
}
