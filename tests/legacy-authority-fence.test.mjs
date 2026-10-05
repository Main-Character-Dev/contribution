import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, realpathSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { Journal } from '../packages/engine/dist/journal.js';
import { LegacyPrimaryLease } from '../packages/engine/dist/legacy-lease.js';
import { LegacyAuthorityFence } from '../packages/engine/dist/legacy-authority-fence.js';

const mac = { skip: process.platform !== 'darwin' };
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ct-authority-fence-'))), commonDir = join(root, 'git'); mkdirSync(commonDir);
  const store = new Journal(join(root, 'state')), repo = { id: randomUUID(), commonDir, canonicalHostId: store.hostId }, fence = new LegacyAuthorityFence(store), transitionId = randomUUID();
  const path = join(commonDir, 'primary-checkout-mutation.lock');
  const activate = () => store.put('authority', repo.id, { transitionId, phase: 'active', ownerHostId: store.hostId });
  const cleanup = () => { store.close(); for (const name of ['primary-checkout-mutation.lock','retained-original']) if (existsSync(join(commonDir,name))) execFileSync('/usr/bin/chflags',['nouchg',join(commonDir,name)]); rmSync(root,{recursive:true}); };
  return { root, store, repo, fence, path, transitionId, activate, cleanup };
}

test('persistent fencing blocks lease acquisition and survives journal restart without inventing a live process', mac, () => {
  const f=fixture(); try {
    const value=f.fence.freeze(f.repo,f.transitionId); assert.equal(value.phase,'frozen'); assert.equal(value.owner.pid,process.pid);
    const owner=readFileSync(join(f.path,'owner.json'),'utf8');
    assert.throws(()=>new LegacyPrimaryLease(f.repo.commonDir,randomUUID()),e=>e.code==='REPOSITORY_BUSY');
    assert.throws(()=>renameSync(f.path,join(f.repo.commonDir,'renamed')),e=>e.code==='EPERM');
    assert.throws(()=>f.fence.assertWriter(f.repo),e=>e.code==='LEGACY_AUTHORITY_FROZEN');
    assert.equal(f.fence.freeze(f.repo,randomUUID()).id,value.id);
    const other=new Journal(f.store.directory); try {assert.equal(new LegacyAuthorityFence(other).verify(f.repo).id,value.id);}finally{other.close();}
    assert.equal(readFileSync(join(f.path,'owner.json'),'utf8'),owner);
    assert.throws(()=>f.fence.releaseForOwner(f.repo,f.transitionId),e=>e.code==='LEGACY_RELEASE_UNAUTHORIZED');
    f.activate(); f.fence.releaseForOwner(f.repo,f.transitionId); assert(!existsSync(f.path)); f.fence.assertWriter(f.repo);
    f.fence.releaseForOwner(f.repo,f.transitionId); assert.equal(f.fence.retained(f.repo).phase,'released');
  } finally {f.cleanup();}
});

test('a creator may exit and its exact historical fence is released only by confirmed ownership', mac, () => {
  const f=fixture(); try {
    const module=pathToFileURL(resolve('packages/engine/dist/legacy-authority-fence.js')).href, journal=pathToFileURL(resolve('packages/engine/dist/journal.js')).href;
    const script=`import {Journal} from ${JSON.stringify(journal)};import{LegacyAuthorityFence}from ${JSON.stringify(module)};const s=new Journal(${JSON.stringify(f.store.directory)});const r=${JSON.stringify(f.repo)};new LegacyAuthorityFence(s).freeze(r,${JSON.stringify(f.transitionId)});s.close();`;
    execFileSync(process.execPath,['--input-type=module','--eval',script],{stdio:'pipe'});
    const value=f.fence.verify(f.repo);assert.notEqual(value.owner.pid,process.pid);
    assert.throws(()=>renameSync(f.path,join(f.repo.commonDir,'renamed')),e=>e.code==='EPERM');
    f.activate();f.fence.releaseForOwner(f.repo,f.transitionId);assert(!existsSync(f.path));
  }finally{f.cleanup();}
});

test('preparing and release crash windows resume their exact owned boundary', mac, () => {
  for(const window of ['before-flag','after-flag','after-unflag','after-remove']) {
    const f=fixture();try{
      const value=f.fence.freeze(f.repo,f.transitionId);
      if(window.startsWith('before')||window==='after-flag'){
        if(window==='before-flag')execFileSync('/usr/bin/chflags',['nouchg',f.path]);
        f.store.put('legacyAuthorityFence',f.repo.id,{...value,phase:'preparing'});
        assert.equal(f.fence.freeze(f.repo,f.transitionId).phase,'frozen');
      }else{
        f.activate();f.store.put('legacyAuthorityFence',f.repo.id,{...value,phase:'releasing',releasedBy:f.transitionId});
        execFileSync('/usr/bin/chflags',['nouchg',f.path]);
        if(window==='after-remove')assert(LegacyPrimaryLease.removeOwned(f.path,value.owner));
      }
      f.activate();f.fence.releaseForOwner(f.repo,f.transitionId);assert(!existsSync(f.path));
    }finally{f.cleanup();}
  }
});

test('missing flags, replaced identity, extra files, unknown recovery and foreign locks fail closed', mac, () => {
  for(const mode of ['flag','replacement','extra','recovery','foreign']) {
    const f=fixture();try{
      if(mode==='foreign'){
        const foreign=new LegacyPrimaryLease(f.repo.commonDir,randomUUID());
        assert.throws(()=>f.fence.freeze(f.repo,f.transitionId),e=>e.code==='LEGACY_FENCE_CHANGED');
        assert.equal(LegacyPrimaryLease.inspect(f.repo.commonDir).token,foreign.owner.token);foreign.release();continue;
      }
      f.fence.freeze(f.repo,f.transitionId);
      if(mode==='flag')execFileSync('/usr/bin/chflags',['nouchg',f.path]);
      if(mode==='replacement'){
        const owner=readFileSync(join(f.path,'owner.json'));
        execFileSync('/usr/bin/chflags',['nouchg',f.path]);renameSync(f.path,join(f.repo.commonDir,'retained-original'));mkdirSync(f.path,{mode:0o700});writeFileSync(join(f.path,'owner.json'),owner,{mode:0o600});execFileSync('/usr/bin/chflags',['uchg',f.path]);
      }
      if(mode==='extra'){execFileSync('/usr/bin/chflags',['nouchg',f.path]);writeFileSync(join(f.path,'unrelated'),'preserve');execFileSync('/usr/bin/chflags',['uchg',f.path]);}
      if(mode==='recovery')mkdirSync(f.path+'.recovery');
      f.activate();assert.throws(()=>f.fence.releaseForOwner(f.repo,f.transitionId),e=>['LEGACY_FENCE_LOST','LEGACY_FENCE_CHANGED','REPOSITORY_BUSY'].includes(e.code));
      assert(existsSync(f.path));assert.throws(()=>f.fence.assertWriter(f.repo),e=>e.code==='LEGACY_AUTHORITY_FROZEN');
    }finally{f.cleanup();}
  }
});
