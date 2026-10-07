import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { processIdentity } from '../packages/engine/dist/process.js';
import { spawnSync, spawn } from 'node:child_process';
import { Journal } from '../packages/engine/dist/journal.js';
import { Peers } from '../packages/engine/dist/peers.js';
import { Engine } from '../packages/engine/dist/service.js';
import { Fault, digest } from '../packages/engine/dist/core.js';
import { PeerConnectivity, retryDelay, sshArguments, transportFailure, invokeSSH, recordGitConnectivity } from '../packages/engine/dist/peer-connectivity.js';
import { diagnoseTailscale } from '../packages/engine/dist/tailscale-diagnostics.js';
import { git as engineGit } from '../packages/engine/dist/git.js';
import { assertContract } from '../packages/contracts/dist/index.js';
import { repository, git, fixture } from './integration/service.mjs';
import ts from 'typescript';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { ResourceLifecycle } from '../packages/engine/dist/resource-lifecycle.js';

const processResult = (overrides = {}) => ({ code: 0, signal: null, stdout: '', stderr: '', timedOut: false, cancelled: false, cleanup: { released: true, reason: null, members: [] }, ...overrides });
const hello = { version: '0.1.0', protocolVersion: 1, requestSchemaVersion: 1, capabilities: ['health-v1','lookup-request-v1'] };
function policyFixture() {
  const root = mkdtempSync(join(tmpdir(),'ct-connectivity-')), store = new Journal(root);
  let wall = 1700000000000, mono = 0;
  const clock = { wall: () => wall, mono: () => mono, random: () => .5 }, policy = new PeerConnectivity(store, clock);
  return { root, store, policy, clock, advance: n => { wall += n; mono += n; }, jump: n => { wall += n; }, close: () => { store.close(); rmSync(root,{recursive:true}); } };
}

for (const destination of ['mini','mini.example','100.64.1.2','::1','2001:db8::1']) test(`SSH argv preserves one configured destination: ${destination}`, () => {
  const args = sshArguments(destination); assert.equal(args.at(-2), destination); assert.equal(args.at(-3), '--'); assert(args.includes('BatchMode=yes')); assert(args.includes('StrictHostKeyChecking=yes')); assert(!args.join(' ').includes('accept-new'));
});
for (const destination of ['-Fbad','user@mini','mini:22','mini;whoami','mini\nother']) test(`SSH destination rejects ambiguous input: ${JSON.stringify(destination)}`, () => assert.throws(() => sshArguments(destination), {code:'INVALID_SSH_ALIAS'}));
for (const [stderr,code,stage,retryable] of [
  ['Host key verification failed.','SSH_HOST_UNAPPROVED','trust',false],['REMOTE HOST IDENTIFICATION HAS CHANGED!','SSH_HOST_KEY_CHANGED','trust',false],
  ['Permission denied (publickey).','SSH_AUTH_DENIED','authentication',false],['Could not resolve hostname mini','SSH_RESOLUTION_FAILED','resolution',true],
  ['No route to host','SSH_ROUTE_UNAVAILABLE','connection',true],['Connection refused','SSH_REFUSED','connection',true],['contribution: not found','PEER_HELPER_UNAVAILABLE','helper',false],['an unknown failure','PEER_UNAVAILABLE','connection',true]
]) test(`bounded SSH classification: ${code}`, () => { const failure=transportFailure(processResult({code:255,stderr})); assert.equal(failure.code,code); assert.equal(failure.details.stage,stage); assert.equal(failure.retryable,retryable); assert(!failure.message.includes(stderr)); });

test('transport health uses the same SSH argv and bounded worker context', async () => {
  let captured; await invokeSSH('::1', {action:'health'}, {health:true}, async (...args) => { captured=args;return processResult(); });
  assert.equal(captured[0],'/usr/bin/ssh'); assert.equal(captured[2].timeoutMs,10000); assert.equal(captured[2].maxBytes,65536); assert.equal(JSON.parse(captured[2].input).action,'health');
});
test('shared host budget survives service restart, uses monotonic due time, and clamps jitter', async () => {
  const f=policyFixture();try {
    let attempts=0; const fail=() => { attempts++;throw new Fault('PEER_UNAVAILABLE','fixture',3); };
    await assert.rejects(f.policy.execute('host','mini','health',fail));
    f.jump(86400000);await assert.rejects(f.policy.execute('host','mini','registry.exchange',fail),{code:'PEER_RETRY_WAIT'}); assert.equal(attempts,1);
    f.advance(2000);await f.policy.execute('host','mini','health',async()=>hello);assert.equal(f.policy.snapshot('host','mini').state,'ready');
    f.jump(-86400000);f.advance(30001);assert.equal(f.policy.snapshot('host','mini').freshness,'stale');
    const restarted=new PeerConnectivity(f.store,f.clock);assert.equal(restarted.snapshot('host','mini').freshness,'stale');
    assert.equal(retryDelay(100,1),300000);assert.equal(retryDelay(1,0),1600);assertContract('connectivity',f.policy.snapshot('host','mini'));
  } finally {f.close();}
});
test('trust failures require explicit retry; network hints never approve trust', async()=> {
  const f=policyFixture();try {
    await assert.rejects(f.policy.execute('host','mini','health',async()=>{throw transportFailure(processResult({code:255,stderr:'Host key verification failed'}));}));
    assert.equal(f.policy.snapshot('host','mini').state,'requires_action');assert.equal(f.policy.invalidate('host','mini'),false);
    await assert.rejects(f.policy.execute('host','mini','registry.exchange',async()=>hello),{code:'SSH_HOST_UNAPPROVED'});
    f.advance(2000);assert.equal(f.policy.invalidate('host','mini',true),true);await f.policy.execute('host','mini','health',async()=>hello);
    assert.equal(f.policy.snapshot('host','mini').state,'ready');
  }finally{f.close();}
});
test('per-target serialization and four-target bound let a healthy peer progress during outage', async()=> {
 const f=policyFixture();try {
   const releases=[];let active=0,peak=0;
   const calls=Array.from({length:6},(_,i)=>f.policy.execute('host'+i,'mini'+i,'health',()=>new Promise(resolve=>{active++;peak=Math.max(peak,active);releases.push(()=>{active--;resolve(hello);});})));
   await new Promise(setImmediate);assert.equal(active,4);releases.shift()();await new Promise(setImmediate);assert.equal(active,4);assert.equal(peak,4);
   while(releases.length){releases.shift()();await new Promise(setImmediate);}await Promise.all(calls);
   let first;const order=[];const a=f.policy.execute('one','mini','health',()=>new Promise(resolve=>{first=()=>{order.push('first');resolve(hello);};}));
   const b=f.policy.execute('one','mini','registry.exchange',async()=>{order.push('second');return hello;});await new Promise(setImmediate);assert.deepEqual(order,[]);first();await Promise.all([a,b]);assert.deepEqual(order,['first','second']);
 }finally{f.close();}
});
test('late generation cannot restore readiness after invalidation',async()=> {
 const f=policyFixture();try {
  let finish;const pending=f.policy.execute('host','mini','health',()=>new Promise(resolve=>{finish=resolve;}));await new Promise(setImmediate);
  assert.equal(f.policy.snapshot('host','mini').state,'checking');f.policy.invalidate('host','mini',true);finish(hello);
  await assert.rejects(pending);assert.equal(f.policy.snapshot('host','mini').state,'unknown');assert.equal(f.policy.snapshot('host','mini').lastSuccessAt,null);
 }finally{f.close();}
});
test('paired read-only health changes no peer, repository, operation or authority records',async()=> {
 const f=policyFixture();try {
  const sender=randomUUID();f.store.put('peer',sender,{hostId:sender,alias:null,version:'0.1.0'});
  const engine=new Engine(f.store,{identity:'fixture',distribution:'fixture',root:f.root,node:process.execPath,cli:join(f.root,'cli')});
  const before=f.store.db.prepare('SELECT * FROM records ORDER BY namespace,key').all();
  const result=await engine.peers.receive({fromHostId:sender,expectedHostId:f.store.hostId,compatibility:hello,action:'health',body:{}});
  assert.equal(result.hostId,f.store.hostId);assert.deepEqual(f.store.db.prepare('SELECT * FROM records ORDER BY namespace,key').all(),before);assert.equal(f.store.list().length,0);
  await assert.rejects(engine.peers.receive({fromHostId:randomUUID(),expectedHostId:f.store.hostId,compatibility:hello,action:'health',body:{}}));
  await assert.rejects(engine.peers.receive({fromHostId:sender,expectedHostId:randomUUID(),compatibility:hello,action:'health',body:{}}));
 }finally{f.close();}
});
test('new observations fence the journal and resource allocation cannot downgrade it',()=> {
 const f=policyFixture();try {
   f.store.enableConnectivity();assert.equal(f.store.db.prepare('PRAGMA user_version').get().user_version,3);
   const lifecycle=new ResourceLifecycle(f.store,()=>({clone:'fixture-clone',revision:'v1'}),()=> 'fixture-boot');
   const op=f.store.admit(randomUUID(),'checks',randomUUID(),{},'fixture');
   lifecycle.begin(op,{requestId:randomUUID(),kind:'provider',owner:'utility',lifetime:'ephemeral',adapter:'fixture',adapterVersion:1,scope:randomUUID(),reason:'Fixture resource migration',stopAction:'fixture close'});
   assert.equal(f.store.db.prepare('PRAGMA user_version').get().user_version,3);
   f.store.db.exec('PRAGMA user_version=5');assert.throws(()=>new Journal(f.root),{code:'DATABASE_TOO_NEW'});
 }finally{f.close();}
});
test('optional provider absence, login state and malformed output never alter helper readiness',async()=> {
 const f=policyFixture();try {
  await f.policy.execute('host','mini','health',async()=>hello);
  assert.equal((await diagnoseTailscale('mini',async()=>{throw new Error('must not run');},()=>null)).status,'unavailable');
  for (const stdout of ['bad-json',JSON.stringify({BackendState:'NeedsLogin'}),JSON.stringify({BackendState:'Stopped'})]) {
   const provider=await diagnoseTailscale('mini',async()=>processResult({stdout}),()=>'/fixture/tailscale');assert(['unavailable','observed'].includes(provider.status));assert.equal(f.policy.snapshot('host','mini').state,'ready');
  }
 }finally{f.close();}
});
test('explicit provider diagnostics use effective SSH hostname, skip proxies and preserve direct/relay evidence',async()=> {
 for(const path of ['direct','relay','proxy']){
  const calls=[];const runner=async(executable,args,options)=>{calls.push({executable,args,options});if(args[0]==='status')return processResult({stdout:JSON.stringify({BackendState:'Running',Peer:{x:{DNSName:'mini.tail.invalid.',TailscaleIPs:['100.64.1.2']}}})});
   if(executable==='/usr/bin/ssh')return processResult({stdout:'hostname mini.tail.invalid\n'+(path==='proxy'?'proxyjump gateway\n':'')});
   if(args[0]==='ping'&&args[1]==='--help')return processResult({stdout:'--until-direct --timeout --c'});
   return processResult({stdout:path==='relay'?'pong via DERP(region)':'pong via 100.64.1.2:41641'});
  };
  const result=await diagnoseTailscale('mini',runner,()=>'/fixture/tailscale');assert.equal(result.path,path==='proxy'?'unknown':path);if(path==='proxy')assert(!calls.some(c=>c.args.includes('--c=1')));assert(calls.every(c=>c.options.timeoutMs<=3000));
 }
});
test('actual Git path preserves custom core.sshCommand and ambient GIT_SSH_COMMAND',async()=> {
 const f=policyFixture();try {
  const repo=repository(f.root,'repo'),capture=join(f.root,'capture'),wrapper=join(f.root,'ssh-wrapper');
  writeFileSync(wrapper,'#!/bin/sh\nprintf "%s\\n" "$@" > "$CAPTURE"\nexit 255\n',{mode:0o700});
  git(repo,'config','core.sshCommand',wrapper);const result=await engineGit(repo,['ls-remote','ssh://fixture.invalid/repo'],{env:{CAPTURE:capture},timeoutMs:3000});assert.notEqual(result.code,0);
  assert.match(readFileSync(capture,'utf8'),/fixture.invalid/);assert(!readFileSync(capture,'utf8').includes('BatchMode'));
  git(repo,'config','core.sshCommand','/this/must/not/run');await engineGit(repo,['ls-remote','ssh://fixture.invalid/repo'],{env:{GIT_SSH_COMMAND:wrapper,CAPTURE:capture},timeoutMs:3000});assert.match(readFileSync(capture,'utf8'),/fixture.invalid/);
  git(repo,'config','--unset','core.sshCommand');git(repo,'config','ssh.variant','simple');writeFileSync(join(f.root,'ssh'),readFileSync(wrapper),{mode:0o700});
  await engineGit(repo,['ls-remote','ssh://fixture.invalid/repo'],{env:{PATH:f.root+':'+process.env.PATH,CAPTURE:capture},timeoutMs:3000});assert(!readFileSync(capture,'utf8').includes('BatchMode'));
  const evidence=recordGitConnectivity(f.store,'repo','ssh://fixture.invalid/repo',result);assert.equal(evidence.targetKind,'git-remote');assert.equal(evidence.helper,'not_applicable');assert.equal(evidence.state,'unavailable');assert.equal(f.policy.snapshot('host','mini').state,'unknown');
 }finally{f.close();}
});
test('real worker and CLI return bounded host snapshots and remain usable during a remote outage',async()=> {
 const f=await fixture();try {
  const store=new Journal(f.state),host=randomUUID();store.put('peer',host,{hostId:host,alias:'contribution-fixture.invalid',version:'0.1.0',observedAt:new Date().toISOString()});store.close();
  const started=Date.now();assert.equal((await f.call('hosts.check',{host})).error,null);assert(Date.now()-started<1500);
  assert.equal((await f.call('service.status')).error,null);assert.equal((await f.call('repos.list')).error,null);
  const cli=spawnSync(process.execPath,['packages/cli/dist/main.js','hosts','list','--state-dir',f.state,'--json'],{encoding:'utf8',timeout:5000});assert.equal(cli.status,0,cli.stderr);const response=JSON.parse(cli.stdout);assertContract('response',response);assertContract('connectivity',response.result.hosts.find(p=>p.hostId===host).connectivity);
  const diagnostic=await f.call('service.diagnostics');assert(!JSON.stringify(diagnostic.result).includes('contribution-fixture.invalid'));
 }finally{await f.cleanup();}
});

test('an old peer without read-only health remains usable for ordinary authenticated exchanges', async()=> {
 const f=policyFixture();try {
  await assert.rejects(f.policy.execute('host','mini','health',async()=>{throw new Fault('PEER_ACTION_UNSUPPORTED','Old peer',3);}));
  assert.equal(f.policy.snapshot('host','mini').reasonCode,'PEER_ACTION_UNSUPPORTED');
  await f.policy.execute('host','mini','registry.exchange',async()=>hello);assert.equal(f.policy.snapshot('host','mini').state,'ready');
 }finally{f.close();}
});
test('pause coalesces health requests without starting new probes or erasing retained evidence', async()=> {
 const f=policyFixture();try {
  const host=randomUUID();f.store.put('peer',host,{hostId:host,alias:'mini',version:'0.1.0'});let attempts=0,complete;
  const engine=new Engine(f.store,{identity:'fixture',root:f.root,node:process.execPath,cli:join(f.root,'cli')},async()=>{attempts++;return new Promise(resolve=>{complete=()=>resolve({hostId:host,...hello});});});
  engine.peers.check(host);engine.peers.check(host);await new Promise(setImmediate);assert.equal(attempts,1);complete();await engine.peers.settledChecks();
  f.store.setMeta('paused',true);engine.peers.check(host);await engine.peers.settledChecks();assert.equal(attempts,1);assert.equal(engine.peers.connectivity.snapshot(host,'mini').state,'ready');
  f.store.setMeta('paused',false);engine.peers.networkHint();assert.equal(engine.peers.connectivity.snapshot(host,'mini').state,'unknown');
 }finally{f.close();}
});
test('meaningful endpoint changes clear old readiness and retry state without changing enrollment', async()=> {
 const f=policyFixture();try {
  await f.policy.execute('host','old','health',async()=>hello);f.policy.changeEndpoint('host','new');const value=f.policy.snapshot('host','new');assert.equal(value.lastSuccessAt,null);assert.equal(value.state,'unknown');assert.equal(value.endpointRevision,digest('new'));
  await f.policy.execute('host','new','health',async()=>hello);assert.equal(f.policy.snapshot('host','new').state,'ready');
 }finally{f.close();}
});

test('the actual pre-connectivity Journal refuses v3 before opening a writer or changing retained work',async()=> {
 const f=policyFixture();try {
  const request=randomUUID(),op=f.store.admit(request,'remote.checks',randomUUID(),{destinationHostId:randomUUID(),fresh:false,checkId:null},'fixture','queued_local');f.store.enableConnectivity();
  const legacy=spawnSync('/usr/bin/git',['show','b27a8038bec543e02b46a6796070db66e4dfd462:packages/engine/src/journal.ts'],{encoding:'utf8'});assert.equal(legacy.status,0,legacy.stderr);
  let source=ts.transpileModule(legacy.stdout,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
  source=source.replace(/from '(\.\/[^']+)'/g,(_match,name)=>'from '+JSON.stringify(pathToFileURL(resolve('packages/engine/dist',name)).href));
  source=source.replace("from '@contribution/contracts'",'from '+JSON.stringify(pathToFileURL(resolve('packages/contracts/dist/index.js')).href));
  const {Journal:LegacyJournal}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  const before=readFileSync(join(f.root,'journal.sqlite'));assert.throws(()=>new LegacyJournal(f.root),{code:'DATABASE_TOO_NEW'});assert.deepEqual(readFileSync(join(f.root,'journal.sqlite')),before);assert.deepEqual(f.store.byRequest(request),op);assert.equal(f.store.list().length,1);
 }finally{f.close();}
});

test('unconfirmed process release retains exact private identities and explicit Retry cannot bypass it',async()=> {
 const f=policyFixture();try {
  const failure=transportFailure(processResult({code:5,cleanup:{released:false,reason:'PROCESS_RELEASE_UNCONFIRMED',members:[{pid:12345,start:'fixture-start'}]}}));
  await assert.rejects(f.policy.execute('host','mini','health',async()=>{throw failure;}));
  assert.deepEqual(f.store.record('peerProcessRelease','host').members,[{pid:12345,start:'fixture-start'}]);assert.equal(f.policy.snapshot('host','mini').state,'requires_action');assert.equal(f.policy.invalidate('host','mini',true),false);
 }finally{f.close();}
});

test('process reconciliation observes exact retained child absence and never stops a live owner',async()=> {
 const f=policyFixture();let child;
 try {
  child=spawn(process.execPath,['-e','console.log("ready");setInterval(()=>{},1000)'],{stdio:['ignore','pipe','ignore']});await once(child.stdout,'data');const start=processIdentity(child.pid);assert.ok(start);
  await assert.rejects(f.policy.execute('host','mini','health',async()=>{throw transportFailure(processResult({code:5,cleanup:{released:false,reason:'PROCESS_RELEASE_UNCONFIRMED',members:[{pid:child.pid,start}]}}));}));
  assert.equal((await f.policy.reconcile('host','mini')).reconciled,false);assert.equal(child.exitCode,null);
  child.kill();await once(child,'exit');assert.equal((await f.policy.reconcile('host','mini')).reconciled,true);assert.equal(f.policy.snapshot('host','mini').state,'unknown');
  await f.policy.execute('host','mini','health',async()=>hello);assert.equal(f.policy.snapshot('host','mini').state,'ready');
 }finally{if(child?.exitCode===null && child?.signalCode===null){child.kill();await once(child,'exit');}f.close();}
});

test('parallel peer tick preserves journal sequence when repository jobs have identical timestamps',async()=> {
 const f=policyFixture();try {
  const repo=randomUUID(),host=randomUUID(),calls=[];f.store.put('peer',host,{hostId:host,alias:'mini',version:'0.1.0'});f.store.put('authority',repo,{phase:'active'});
  const first=f.store.admit(randomUUID(),'remote.checks',repo,{destinationHostId:host,checkId:null,fresh:false},'fixture','queued_local');
  const second=f.store.admit(randomUUID(),'remote.checks',repo,{destinationHostId:host,checkId:null,fresh:false},'fixture','queued_local');
  f.store.update(first,{createdAt:'2026-10-06T00:00:00.000Z'});f.store.update(second,{createdAt:'2026-10-06T00:00:00.000Z'});
  const peers=new Peers(f.store,{get:async()=>({id:repo,canonicalHostId:host})},'fixture',async(_alias,envelope)=>{calls.push(envelope.body.requestId);return {hostId:host,...hello,response:{schemaVersion:1,requestStatus:'accepted',operationId:randomUUID(),operationState:'queued',result:{},error:null}};},f.clock);
  peers.list=()=>[];peers.observeOperation=async op=>op;await peers.tick();assert.deepEqual(calls,[first.requestId]);assert.equal(f.store.get(second.operationId).result.remoteOperationId,undefined);
 }finally{f.close();}
});
