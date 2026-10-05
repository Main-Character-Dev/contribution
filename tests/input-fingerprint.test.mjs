import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, symlinkSync, unlinkSync, openSync, ftruncateSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { repository, commit, git } from './integration/service.mjs';
import { inputFingerprint } from '../packages/engine/dist/git.js';

test('current-source identity detects changed staged bytes even when working bytes and status letters stay identical',async()=>{
  const root=mkdtempSync(join(tmpdir(),'ct-input-fingerprint-'));try{
    const path=repository(root);commit(path,'file','original');writeFileSync(join(path,'file'),'staged one');git(path,'add','file');writeFileSync(join(path,'file'),'working');
    const status=git(path,'status','--porcelain'),first=await inputFingerprint(path);
    writeFileSync(join(path,'file'),'staged two');git(path,'add','file');writeFileSync(join(path,'file'),'working');
    assert.equal(git(path,'status','--porcelain'),status);assert.notEqual(await inputFingerprint(path),first);assert.equal(readFileSync(join(path,'file'),'utf8'),'working');assert.equal(git(path,'show',':file'),'staged two');
  }finally{rmSync(root,{recursive:true});}
});

test('untracked links fingerprint link identity without reading their outside targets, and oversized inputs are bounded',async()=>{
  const root=mkdtempSync(join(tmpdir(),'ct-input-links-'));try{
    const path=repository(root);commit(path);const outside=join(root,'outside');writeFileSync(outside,'private first');symlinkSync(outside,join(path,'link'));
    const first=await inputFingerprint(path);writeFileSync(outside,'private changed');assert.equal(await inputFingerprint(path),first);
    unlinkSync(join(path,'link'));symlinkSync(join(root,'missing-target'),join(path,'link'));assert.notEqual(await inputFingerprint(path),first);
    const fd=openSync(join(path,'oversized'),'w');ftruncateSync(fd,16*1024*1024+1);closeSync(fd);
    await assert.rejects(inputFingerprint(path),e=>e.code==='SOURCE_INSPECTION_LIMIT');assert.equal(readFileSync(outside,'utf8'),'private changed');
  }finally{rmSync(root,{recursive:true});}
});
