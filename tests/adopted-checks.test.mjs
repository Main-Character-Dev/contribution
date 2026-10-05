import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Journal } from '../packages/engine/dist/journal.js';
import { Engine } from '../packages/engine/dist/service.js';
import { digest } from '../packages/engine/dist/core.js';
import { LegacyPrimaryLease } from '../packages/engine/dist/legacy-lease.js';
import { adoptionPolicies, policyInventory, projectPins } from '../packages/adapters/dist/index.js';
import { repository, git } from './integration/service.mjs';

async function fixture(adapter, mode='') {
  const root=mkdtempSync(join(tmpdir(),'ct-adopted-checks-')), store=new Journal(join(root,'state')), engine=new Engine(store,{identity:'fixture',node:process.execPath,cli:'unused'}), path=repository(root);
  const policy=adoptionPolicies.find(value=>value.id===adapter);
  for(const file of policy.policyFiles){mkdirSync(join(path,file,'..'),{recursive:true});writeFileSync(join(path,file),'// synthetic original policy\n');}
  writeFileSync(join(path,'.nvmrc'),process.version.slice(1)+'\n');writeFileSync(join(path,'package.json'),JSON.stringify({name:policy.packageName,type:'module',packageManager:'pnpm@11.23.0'}));
  const program=adapter==='mathy-v1'?'scripts/validation-profile.mjs':'scripts/run-changed-checks.mjs';
  writeFileSync(join(path,program),`import{writeFileSync}from'node:fs';import{execFileSync}from'node:child_process';import{join}from'node:path';const common=execFileSync('git',['rev-parse','--path-format=absolute','--git-common-dir'],{encoding:'utf8'}).trim();writeFileSync(join(common,'check-invocation'),JSON.stringify({cwd:process.cwd(),argv:process.argv.slice(2),managedAuthority:Object.keys(process.env).filter(key=>key.startsWith('CONTRIBUTION_')||key.startsWith('CODEX_'))}));console.log('Original check output; individual skips/reuse are original policy.');if(${JSON.stringify(mode)}==='mutate')writeFileSync('new-input','changed');if(${JSON.stringify(mode)}==='fail')process.exit(29);`);
  mkdirSync(join(path,'tests'));writeFileSync(join(path,'tests/focused.test.mjs'),'// fixture test source\n');
  const hooks=join(path,'.fixture-hooks');mkdirSync(hooks);const dispatcher=join(hooks,'pre-push');writeFileSync(dispatcher,'#!/bin/sh\nexit 71\n',{mode:0o700});git(path,'config','core.hooksPath',hooks);
  let repo=await engine.repos.add(path);const config=structuredClone(repo.config);config.integration.adapter=config.validation.adapter=adapter;config.validation.gate=policy.gate;
  repo={...repo,config,revision:digest(config),policySource:'tracked'};writeFileSync(join(path,'contribution.json'),JSON.stringify(config));engine.repos.save(repo);git(path,'add','--all');git(path,'commit','-m','Synthetic original checks');
  const adoptionId=randomUUID(),directory=join(store.directory,'adoptions',adoptionId);mkdirSync(directory,{recursive:true});const originalHook='#!/bin/sh\nexit 71\n';if(policy.gate==='enabled')writeFileSync(join(directory,'original-pre-push'),originalHook);
  store.put('adoptedHooks',repo.id,{schemaVersion:1,phase:'active',adoptionId,repositoryId:repo.id,adapter,policyRevision:repo.revision,hooksPath:hooks,dispatcherPath:dispatcher,dispatcherDigest:digest(readFileSync(dispatcher)),policyFilesDigest:digest(policyInventory(path,adapter).files),originalHookDigest:policy.gate==='enabled'?digest(Buffer.from(originalHook)):null});
  const pnpm=join(root,'pnpm');writeFileSync(pnpm,'#!/bin/sh\nprintf "11.23.0\\n"\n',{mode:0o700});store.put('projectRuntimeSelection',repo.id,{node:process.execPath,pnpm,nodeVersion:process.version.slice(1),pnpmVersion:'11.23.0',pinsDigest:projectPins(path).inputs});
  const source=join(root,'task');git(path,'worktree','add','--detach',source,'HEAD');
  const call=(args)=>engine.dispatch({schemaVersion:1,command:'checks.run',args:{repo:repo.id,requestId:randomUUID(),sourcePath:source,...args},cwd:path});
  const wait=async id=>{const deadline=Date.now()+10000;while(Date.now()<deadline){const op=store.get(id);if(!['running','queued'].includes(op.state))return op;await new Promise(r=>setTimeout(r,15));}throw Error('check deadline');};
  return{root,path,repo,source,program,store,engine,call,wait,invocation:()=>JSON.parse(readFileSync(join(repo.commonDir,'check-invocation'))),cleanup:async()=>{engine.stopping=true;while(engine.active.size)await new Promise(r=>setTimeout(r,15));store.close();rmSync(root,{recursive:true});}};
}

test('all four adopted runners use the selected task and retain local completion separately from gate proof',async()=>{
  for(const adapter of adoptionPolicies.map(value=>value.id)){
    const f=await fixture(adapter);try{
      process.env.CONTRIBUTION_HOOK_TOKEN='unrelated-fixture';process.env.CODEX_THREAD_ID='unrelated-task';
      const args={requestId:randomUUID(),fresh:true},admitted=await f.call(args);assert.equal(admitted.error,null,JSON.stringify(admitted));const op=await f.wait(admitted.operationId);
      assert.equal(op.state,'succeeded',JSON.stringify(op));assert.equal(op.result.state,'completed');assert.equal(op.result.originalCheckOutcome.publicationProof,false);assert.equal(op.result.gate.state,adapter==='glassalpha-v1'?'inactive':'not_run');assert.equal(op.result.publication,'not_requested');
      assert.equal(f.invocation().cwd,git(f.source,'rev-parse','--show-toplevel'));assert.deepEqual(f.invocation().managedAuthority,[]);assert.equal((await f.call(args)).operationId,op.operationId);
      assert.equal(f.store.record('gate',op.operationId),undefined);assert.match(f.store.logs(op),/Original check output/);
      assert.deepEqual(f.invocation().argv,adapter==='mathy-v1'?['check','--fresh']:adapter==='roboty-v1'?['--fresh']:adapter==='glassalpha-v1'?['--mode','all']:['--mode','all','--fresh']);
    }finally{delete process.env.CONTRIBUTION_HOOK_TOKEN;delete process.env.CODEX_THREAD_ID;await f.cleanup();}
  }
});

test('dirty-source support is explicit and preserves staged, unstaged and untracked input',async()=>{
  for(const adapter of adoptionPolicies.map(value=>value.id)){
    const f=await fixture(adapter);try{
      writeFileSync(join(f.source,'draft'),'staged');git(f.source,'add','draft');writeFileSync(join(f.source,'draft'),'working');writeFileSync(join(f.source,'untracked'),'keep');
      const before=git(f.source,'status','--porcelain'),index=git(f.source,'ls-files','--stage'),admitted=await f.call({});
      if(['maincharacter-v1','glassalpha-v1'].includes(adapter)){assert.equal(admitted.error.code,'DIRTY_CHECK_SOURCE_UNSUPPORTED');assert.equal(admitted.operationId,null);}
      else {assert.equal(admitted.error,null);const op=await f.wait(admitted.operationId);assert.equal(op.state,'succeeded',JSON.stringify(op));assert.equal(op.result.originalCheck.dirty,true);}
      assert.equal(git(f.source,'status','--porcelain'),before);assert.equal(git(f.source,'ls-files','--stage'),index);assert.equal(readFileSync(join(f.source,'draft'),'utf8'),'working');assert.equal(readFileSync(join(f.source,'untracked'),'utf8'),'keep');
    }finally{await f.cleanup();}
  }
});

test('Mathy policy-only and focused test selectors keep their original meaning and reject escaped selectors',async()=>{
  const f=await fixture('mathy-v1');try{
    for(const [checkId,argv,purpose]of [['landing-policy',['landing'],'landing_policy'],['test-path:tests/focused.test.mjs',['iteration','tests/focused.test.mjs'],'focused_tests']]){
      const admitted=await f.call({checkId});const op=await f.wait(admitted.operationId);assert.equal(op.state,'succeeded');assert.equal(op.result.originalCheck.purpose,purpose);assert.deepEqual(f.invocation().argv,argv);
    }
    for(const checkId of ['test-path:../outside','test-path:tests/../package.json','static.lint'])assert.equal((await f.call({checkId})).error.code,'CHECK_NOT_SELECTED');
  }finally{await f.cleanup();}
});

test('a local task check works with an unavailable canonical host and a retained legacy primary lease',async()=>{
  const f=await fixture('roboty-v1');let lease;try{
    f.engine.repos.save({...f.repo,availability:'both-macs',canonicalHostId:randomUUID()});lease=new LegacyPrimaryLease(f.repo.commonDir,randomUUID());
    const admitted=await f.call({checkId:'repository.contract'}),op=await f.wait(admitted.operationId);assert.equal(op.state,'succeeded',JSON.stringify(op));assert.deepEqual(f.invocation().argv,['--only-check','repository.contract']);assert.equal(LegacyPrimaryLease.inspect(f.repo.commonDir).token,lease.owner.token);
  }finally{lease?.release();await f.cleanup();}
});

test('changed queued inputs and unsuccessful or mutating original checks never become success',async()=>{
  for(const mode of ['queued','mutate','fail']){
    const f=await fixture('roboty-v1',mode);try{
      if(mode==='queued')f.store.setMeta('paused',true);const admitted=await f.call({});
      if(mode==='queued'){writeFileSync(join(f.source,'later-work'),'preserve');f.store.setMeta('paused',false);f.engine.kick();}
      const op=await f.wait(admitted.operationId);assert.equal(op.state,'failed',JSON.stringify(op));assert.equal(op.error.code,mode==='queued'?'SOURCE_CHANGED':mode==='mutate'?'CHECK_INPUT_CHANGED':'CHECK_FAILED');assert.equal(f.store.record('gate',op.operationId),undefined);
      if(mode==='queued')assert(!existsSync(join(f.repo.commonDir,'check-invocation')));else assert.equal(op.result.originalCheckOutcome.exitCode,mode==='fail'?29:0);
    }finally{await f.cleanup();}
  }
});
