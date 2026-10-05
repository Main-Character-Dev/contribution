import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync, existsSync, unlinkSync, symlinkSync, linkSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Journal } from '../packages/engine/dist/journal.js';
import { BuildOutput } from '../packages/engine/dist/build-output.js';
import { StorageRetention } from '../packages/engine/dist/storage.js';
import { OwnedWorktrees } from '../packages/engine/dist/owned-worktrees.js';
import { repository, commit, git } from './integration/service.mjs';

const old = '2020-01-01T00:00:00.000Z';
async function fixture() {
  const root=realpathSync(mkdtempSync(join(tmpdir(),'ct-build-output-'))),primary=repository(root),tip=commit(primary),store=new Journal(join(root,'state'));
  const repo={id:randomUUID(),path:primary,commonDir:git(primary,'rev-parse','--path-format=absolute','--git-common-dir')};
  let op=store.admit(randomUUID(),'device',repo.id,{fixture:'offline-build'},'fixture');
  const output=new BuildOutput(store),worktrees=new OwnedWorktrees(store),storage=new StorageRetention(store),directory=output.begin(op);
  const source=await worktrees.create(op,repo,'build',tip),products=join(directory,'products');mkdirSync(products);
  writeFileSync(join(products,'generated-binary'),'reproducible build');writeFileSync(join(directory,'Build.xcresult'),'reproducible result');
  const external=join(root,'valuable-external-file');writeFileSync(external,'preserve external bytes');symlinkSync(external,join(products,'cache-link'));
  output.seal(op);assert.equal(store.record('buildOutput',op.attemptId).phase,'sealed');
  op=store.update(op,{state:'succeeded',result:{completedAt:old}});
  const removeSource=async()=>{const preview=await worktrees.preview();assert.equal(preview.candidates.length,1,JSON.stringify(preview));return worktrees.apply(preview.scopeToken,randomUUID());};
  return {root,repo,tip,store,op,directory,source,products,external,output,worktrees,storage,removeSource,close:()=>{store.close();rmSync(root,{recursive:true});}};
}

test('generated builds become eligible only after confirmed owned Git cleanup and unlink cache links without following them', async()=>{
  const f=await fixture();try{
    const unknown=join(f.root,'state/device-builds',randomUUID());mkdirSync(unknown);writeFileSync(join(unknown,'owner-notes'),'preserve unknown output');
    assert.equal(f.storage.preview().candidates.length,0);assert(existsSync(f.source));
    await f.removeSource();const preview=f.storage.preview();assert.equal(preview.candidates.length,1,JSON.stringify(preview));assert.equal(preview.candidates[0].kind,'build');
    const request=randomUUID(),result=f.storage.apply(preview.scopeToken,request);assert.deepEqual(result.removed,[`build:${f.op.attemptId}`]);assert(!existsSync(f.directory));
    assert.equal(readFileSync(f.external,'utf8'),'preserve external bytes');assert.equal(readFileSync(join(unknown,'owner-notes'),'utf8'),'preserve unknown output');
    assert.equal(git(f.repo.path,'rev-parse',`refs/contribution/worktrees/${f.op.attemptId}`),f.tip);
    assert.equal(f.store.admit(f.op.requestId,f.op.kind,f.repo.id,f.op.input,'new-payload').operationId,f.op.operationId);
    assert.deepEqual(f.storage.apply(preview.scopeToken,request),result);assert.equal(f.store.response(f.op).result.outputRetention.find(value=>value.bytes)?.state,'removed');
    assert.equal(f.store.record('buildOutput',f.op.attemptId).phase,'sealed');
  }finally{f.close();}
});

test('modified, additional, linked, replaced, unconfirmed and still-needed build outputs remain protected', async()=>{
  for(const change of ['new-file','changed-file','link-target','hardlink','root','source','pin','peer','unknown','live-process','pending','unsealed']){
    const f=await fixture();try{
      await f.removeSource();
      if(change==='new-file')writeFileSync(join(f.directory,'user-notes'),'preserve notes');
      if(change==='changed-file')writeFileSync(join(f.products,'generated-binary'),'preserve edits');
      if(change==='link-target'){unlinkSync(join(f.products,'cache-link'));symlinkSync('/different-target',join(f.products,'cache-link'));}
      if(change==='hardlink')linkSync(join(f.products,'generated-binary'),join(f.root,'shared-output'));
      if(change==='root'){renameSync(f.directory,f.directory+'-original');mkdirSync(f.directory);}
      if(change==='source')mkdirSync(f.source);
      if(change==='pin')f.store.update(f.op,{pinned:true});
      if(change==='peer')f.store.put('peerOperation',f.op.operationId,{from:'unacknowledged'});
      if(change==='unknown')f.store.update(f.op,{state:'outcome_unknown'});
      if(change==='live-process')f.store.update(f.op,{result:{...f.op.result,processes:[{pid:process.pid,start:null}]}});
      if(change==='pending')f.store.admit(randomUUID(),'checks',f.repo.id,{},'fixture');
      if(change==='unsealed')f.store.put('buildOutput',f.op.attemptId,{...f.store.record('buildOutput',f.op.attemptId),phase:'unconfirmed'});
      const preview=f.storage.preview();assert.equal(preview.candidates.length,0,change);assert.equal(preview.protected.length,1,change);assert(existsSync(f.directory));
      assert.equal(readFileSync(f.external,'utf8'),'preserve external bytes');
    }finally{f.close();}
  }
});

test('build cleanup refuses a stale review before removal when files, dependent pins or source ownership change', async()=>{
  for(const change of ['file','pin','checkout']){
    const f=await fixture();try{
      await f.removeSource();const preview=f.storage.preview();
      if(change==='file')writeFileSync(join(f.directory,'new-owner-file'),'preserve');
      if(change==='pin')f.store.update(f.op,{pinned:true});
      if(change==='checkout')f.store.put('worktreeEviction',f.op.attemptId,{operationId:f.op.operationId,directory:join(f.root,'different')});
      assert.throws(()=>f.storage.apply(preview.scopeToken,randomUUID()),{code:'STORAGE_SELECTION_CHANGED'});assert.equal(f.store.records('storageCleanup').length,0);
      assert(existsSync(join(f.products,'generated-binary')));
    }finally{f.close();}
  }
});

test('partial build deletion resumes only the same reviewed snapshot and protects new files',async()=>{
  const f=await fixture();try{
    await f.removeSource();const preview=f.storage.preview(),requestId=randomUUID(),selected=f.store.record('storagePreview',preview.scopeToken);
    f.store.put('storageCleanup',requestId,{requestId,token:preview.scopeToken,preview:selected,completed:[],state:'removing'});
    f.store.put('storageEviction',`build:${f.op.attemptId}`,{state:'removing',requestId,directory:f.directory});
    unlinkSync(join(f.products,'generated-binary'));writeFileSync(join(f.directory,'new-notes'),'preserve');
    assert.throws(()=>f.storage.apply(preview.scopeToken,requestId),{code:'STORAGE_SELECTION_CHANGED'});assert.equal(readFileSync(join(f.directory,'new-notes'),'utf8'),'preserve');
    unlinkSync(join(f.directory,'new-notes')); // Simulate the fixture owner's explicit reconciliation.
    const recovery=f.storage.apply(preview.scopeToken,requestId);assert.deepEqual(recovery.removed,[`build:${f.op.attemptId}`]);assert(!existsSync(f.directory));
    assert.equal(readFileSync(f.external,'utf8'),'preserve external bytes');assert.deepEqual(f.storage.apply(preview.scopeToken,requestId),recovery);
  }finally{f.close();}
});

test('incomplete output creation and unsealable intermediates never acquire cleanup ownership',async()=>{
  const f=await fixture();try{
    assert.throws(()=>f.output.begin(f.op),{code:'BUILD_OUTPUT_RECONCILIATION_REQUIRED'});
    let next=f.store.admit(randomUUID(),'device',f.repo.id,{},'fixture');const path=f.output.begin(next);
    writeFileSync(join(path,'shared'),'shared output');linkSync(join(path,'shared'),join(f.root,'shared-link'));
    f.output.seal(next);assert.equal(f.store.record('buildOutput',next.attemptId).phase,'unconfirmed');
    next=f.store.update(next,{state:'succeeded',result:{completedAt:old}});
    assert.equal(f.storage.preview().candidates.length,0);assert(existsSync(join(path,'shared')));
    const orphan=f.store.admit(randomUUID(),'device',f.repo.id,{},'fixture');
    f.store.put('buildOutput',orphan.attemptId,{operationId:orphan.operationId,attemptId:orphan.attemptId,repositoryId:f.repo.id,phase:'creating'});
    assert.throws(()=>f.output.begin(orphan),{code:'BUILD_OUTPUT_RECONCILIATION_REQUIRED'});
  }finally{f.close();}
});

test('pinning a later artifact-dependent attempt protects its original build evidence',async()=>{
  const f=await fixture();try{
    await f.removeSource();const artifactId=randomUUID(),provenance=JSON.parse(readFileSync(new URL('../packages/contracts/examples/artifact-provenance.json',import.meta.url)));
    provenance.artifactId=artifactId;provenance.repositoryId=f.repo.id;provenance.build.attemptId=f.op.attemptId;
    f.store.put('deviceArtifact',artifactId,{provenance,path:join(f.root,'separate-retained-archive.zip'),appPath:join(f.root,'separate-retained-app')});
    const preview=f.storage.preview();assert.equal(preview.candidates.length,1);
    let dependent=f.store.admit(randomUUID(),'device',f.repo.id,{artifactId},'fixture');dependent=f.store.update(dependent,{state:'succeeded',pinned:true});
    assert.throws(()=>f.storage.apply(preview.scopeToken,randomUUID()),{code:'STORAGE_SELECTION_CHANGED'});assert(existsSync(f.directory));
    f.store.update(dependent,{pinned:false});assert.equal(f.storage.preview().candidates.length,1);
  }finally{f.close();}
});
