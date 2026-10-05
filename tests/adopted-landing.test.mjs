import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Journal } from '../packages/engine/dist/journal.js';
import { Engine } from '../packages/engine/dist/service.js';
import { digest } from '../packages/engine/dist/core.js';
import { LegacyLandingFlight } from '../packages/engine/dist/legacy-flight.js';
import { adoptionPolicies, policyInventory, projectPins } from '../packages/adapters/dist/index.js';
import { repository, git } from './integration/service.mjs';

async function fixture(adapter = 'maincharacter-v1', mode = '') {
  const root = mkdtempSync(join(tmpdir(), 'ct-adopted-land-')), store = new Journal(join(root, 'state')), engine = new Engine(store, { identity: 'fixture', node: process.execPath, cli: 'unused' });
  const path = repository(root), policy = adoptionPolicies.find(value => value.id === adapter);
  for (const file of policy.policyFiles) { mkdirSync(join(path, file, '..'), { recursive: true }); writeFileSync(join(path, file), '// synthetic original policy\n'); }
  writeFileSync(join(path, '.nvmrc'), process.version.slice(1) + '\n'); writeFileSync(join(path, 'package.json'), JSON.stringify({ name: policy.packageName, type: 'module', packageManager: 'pnpm@11.23.0' }));
  const stateSource = `
import { existsSync,readFileSync,appendFileSync,writeFileSync } from 'node:fs'; import { join } from 'node:path';
export function assertManagedLandingSourceWorktree({worktreePath}) { if(!worktreePath.includes('/.codex/worktrees/')) throw Error('native ownership rejected'); }
export function readLandingCandidate(primary,tip) { const file=join(primary,'.git','fixture-candidate'); return existsSync(file)?JSON.parse(readFileSync(file)):null; }
export function listLandingCandidates(primary) { return [readLandingCandidate(primary,'')].filter(Boolean); }
export function landingCandidateRequiresExactTreeValidation(){return false;}
export function landingValidationRequirementsDigest(){return 'b'.repeat(64);}
export function enqueueLandingCandidate({primaryRoot,sha,worktreePath,taskId,supersedes,objectiveId,reviewEpoch,requiredUITestSelectors}) {
 const prior=readLandingCandidate(primaryRoot,sha),queued={...prior,sha,worktree_path:worktreePath,task_id:taskId,supersedes,objective_id:objectiveId,review_epoch:reviewEpoch,required_ui_test_selectors:requiredUITestSelectors};
 writeFileSync(join(primaryRoot,'.git','fixture-candidate'),JSON.stringify(queued));return queued;
}
export function readLandingValidationReceipt(primary,tip) { const file=join(primary,'.git','fixture-receipt'); return existsSync(file)?JSON.parse(readFileSync(file)):null; }
export function resolveCanonicalLandingForCandidate(primary,head,candidate) { appendFileSync(join(primary,'.git','validator-count'),'canonical\\n'); return {commitSha:head,requiredUITestSelectors:candidate.required_ui_test_selectors}; }
`;
  writeFileSync(join(path, 'scripts/lib/worktree-landing-state.mjs'), stateSource);
  const entry = `
import {existsSync,readFileSync,writeFileSync,appendFileSync,rmSync} from 'node:fs'; import {join} from 'node:path'; import {execFileSync} from 'node:child_process'; import {pathToFileURL} from 'node:url';
const git=(cwd,args)=>execFileSync('/usr/bin/git',args,{cwd,encoding:'utf8'}).trim();
export function resolveLandedCandidateSha({candidateSha,receipt,targetContainsSha,resolveTreeSha,landedIdentity,requiredUITestSelectors,checksCommand}) {
  appendFileSync(join(process.cwd(),'.git','validator-count'),'receipt\\n');
  if(receipt.candidate_sha!==candidateSha||receipt.status!=='landed'||!targetContainsSha(receipt.landed_sha)) throw Error('receipt refused');
  if(${JSON.stringify(adapter)}==='mathy-v1') { if(checksCommand!=='pnpm test:changed'||!requiredUITestSelectors.includes('required-selector')||landedIdentity.commitSha!==receipt.landed_sha) throw Error('Mathy requirements lost'); }
  else if(receipt.validation_status!=='not_run'||receipt.checks_command!=='integration-only'||resolveTreeSha(receipt.landed_sha)!==receipt.resolved_tree_sha) throw Error('integration-only policy violated');
  return receipt.landed_sha;
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url) {
 const primary=process.cwd(),source=process.argv.includes('--worktree')?process.argv[process.argv.indexOf('--worktree')+1]:JSON.parse(readFileSync(join(primary,'.git','fixture-candidate'))).worktree_path;
 if(existsSync(join(primary,'.git','primary-checkout-mutation.lock'))) throw Error('service must not hold original worker lease');
 if(process.env.CONTRIBUTION_OPERATION_ID) throw Error('push authority leaked');
 if(process.env.CODEX_THREAD_ID!=='original-task') throw Error('existing task attribution lost');
 if(git(source,['status','--porcelain'])) throw Error('source became dirty');
 appendFileSync(join(primary,'.git','worker-count'),'worker\\n');
 const target=git(primary,['rev-parse','HEAD']),tip=git(source,['rev-parse','HEAD']);
 if(${JSON.stringify(mode)}==='no-effect') process.exit(19);
 git(primary,['merge','--ff-only',tip]);
 const receipt={status:'landed',candidate_sha:tip,landed_sha:tip,target_sha:target,resolved_tree_sha:git(primary,['rev-parse',tip+'^{tree}']),checks_command:${JSON.stringify(policy.landing === 'policy-only' ? 'pnpm test:changed' : 'integration-only')},validation_status:${JSON.stringify(policy.landing === 'policy-only' ? 'passed' : 'not_run')},reconciliation_status:${JSON.stringify(mode === 'reconciliation' ? 'failed' : 'passed')}};
 if(${JSON.stringify(mode)}!=='missing-receipt') writeFileSync(join(primary,'.git','fixture-receipt'),JSON.stringify(receipt));
 if(${JSON.stringify(mode)}!=='reconciliation')rmSync(join(primary,'.git','fixture-candidate'));
 const index=process.argv.indexOf('--message-file'); if(index>=0) writeFileSync(join(primary,'.git','message-observed'),readFileSync(process.argv[index+1]));
 if(${JSON.stringify(mode)}==='exit-after-delivery') process.exit(27);
}
`;
  writeFileSync(join(path, 'scripts/worktree-land'), entry);
  writeFileSync(join(path, 'scripts/worktree-landing-worker'), entry + `\nexport function integrationContractDigest(){return 'a'.repeat(64);}\n`);
  writeFileSync(join(path, 'scripts/pre-push-worktree-guard.mjs'), `import {appendFileSync,existsSync} from 'node:fs';import {join} from 'node:path';appendFileSync(join(process.cwd(),'.git','guard-count'),'guard\\n'); if(existsSync(join(process.cwd(),'.git','guard-fail')))process.exit(1);`);
  const hooks = join(path, '.fixture-hooks'); mkdirSync(hooks); const dispatcher = join(hooks, 'pre-push'); writeFileSync(dispatcher, '#!/bin/sh\nexit 9\n', { mode: 0o700 }); git(path, 'config', 'core.hooksPath', hooks);
  let repo = await engine.repos.add(path); const config = structuredClone(repo.config); config.integration.adapter = adapter; config.validation.adapter = adapter; config.validation.gate = policy.gate;
  repo = { ...repo, config, revision: digest(config), policySource: 'tracked' }; writeFileSync(join(path, 'contribution.json'), JSON.stringify(config)); engine.repos.save(repo);
  git(path, 'add', '--all'); git(path, 'commit', '-m', 'Synthetic adopted project policy');
  const adoptionId = randomUUID(), directory = join(store.directory, 'adoptions', adoptionId); mkdirSync(directory, { recursive: true });
  const originalHook = '#!/bin/sh\nexit 9\n'; if (policy.gate === 'enabled') writeFileSync(join(directory, 'original-pre-push'), originalHook);
  store.put('adoptedHooks', repo.id, { schemaVersion: 1, phase: 'active', adoptionId, repositoryId: repo.id, adapter, policyRevision: repo.revision, hooksPath: hooks,
    dispatcherPath: dispatcher, dispatcherDigest: digest(readFileSync(dispatcher)), policyFilesDigest: digest(policyInventory(path, adapter).files), originalHookDigest: policy.gate === 'enabled' ? digest(Buffer.from(originalHook)) : null });
  const pnpm = join(root, 'pnpm'); writeFileSync(pnpm, '#!/bin/sh\nprintf "11.23.0\\n"\n', { mode: 0o700 });
  store.put('projectRuntimeSelection', repo.id, { node: process.execPath, pnpm, nodeVersion: process.version.slice(1), pnpmVersion: '11.23.0', pinsDigest: projectPins(path).inputs });
  const base = git(path, 'rev-parse', 'HEAD'), sourcePath = join(root, '.codex/worktrees/task/source'); mkdirSync(join(sourcePath, '..'), { recursive: true }); git(path, 'worktree', 'add', '--detach', sourcePath, base);
  writeFileSync(join(sourcePath, 'completed-work'), 'completed'); git(sourcePath, 'add', '--all'); git(sourcePath, 'commit', '-m', 'Completed task'); const sourceTip = git(sourcePath, 'rev-parse', 'HEAD');
  writeFileSync(join(path, '.git/fixture-candidate'), JSON.stringify({ sha: sourceTip, worktree_path: git(sourcePath, 'rev-parse', '--show-toplevel'), task_id: 'original-task', required_ui_test_selectors: ['required-selector'], supersedes: [base], objective_id: 'original-objective', review_epoch: 4 }));
  const args = { repo: repo.id, requestId: randomUUID(), sourcePath, sourceTip, base, metadata: { schemaVersion: 1 } };
  const call = (command, args) => engine.dispatch({ schemaVersion: 1, command, args, cwd: path });
  const wait = async id => { const deadline = Date.now() + 12000; while (Date.now() < deadline) { const op = store.get(id); if (!['running','queued'].includes(op.state)) return op; await new Promise(r => setTimeout(r, 15)); } throw Error('fixture deadline'); };
  return { root, store, engine, path, repo, args, call, wait, cleanup: async () => { engine.stopping = true; while (engine.active.size) await new Promise(r => setTimeout(r, 15)); store.close(); rmSync(root, { recursive: true }); } };
}

test('all adopted families run the original native landing and receipt/source guards without publication or outer lease', async () => {
  for (const policy of adoptionPolicies) {
    const f = await fixture(policy.id); try {
      if (policy.id === 'mathy-v1') f.args.metadata.integrationMessage = 'Approved combined message\n\nRetain source intent.';
      const admitted = await f.call('submit', f.args); assert.equal(admitted.error, null, JSON.stringify(admitted)); const op = await f.wait(admitted.operationId);
      assert.equal(op.state, 'succeeded', JSON.stringify(op)); assert.equal(op.result.landedTip, f.args.sourceTip); assert.equal(op.result.publication, 'not_requested');
      assert.equal(op.result.validation, policy.landing === 'policy-only' ? 'passed' : 'not_run'); assert.equal(git(f.args.sourcePath, 'rev-parse', 'HEAD'), f.args.sourceTip); assert.equal(git(f.path, 'status', '--porcelain'), '');
      assert.equal(readFileSync(join(f.path, '.git/worker-count'), 'utf8'), 'worker\n'); assert(existsSync(join(f.path, '.git/guard-count')));
      assert.equal((await f.call('submit', f.args)).operationId, admitted.operationId); assert.equal(readFileSync(join(f.path, '.git/worker-count'), 'utf8'), 'worker\n');
      if (policy.id === 'mathy-v1') assert.equal(readFileSync(join(f.path, '.git/message-observed'), 'utf8'), f.args.metadata.integrationMessage + '\n');
    } finally { await f.cleanup(); }
  }
});

test('dirty and changed queued tasks land only their captured commits while preserving unrelated work', async () => {
  for (const mode of ['dirty', 'queued', 'advanced']) {
    const f = await fixture(); try {
      if (mode === 'dirty') writeFileSync(join(f.args.sourcePath, 'unrelated-draft'), 'preserve');
      if (mode !== 'dirty') f.store.setMeta('paused', true);
      const admitted = await f.call('submit', f.args);
      assert.equal(admitted.error, null, JSON.stringify(admitted));
      if (mode !== 'dirty') { writeFileSync(join(f.args.sourcePath, 'unrelated-draft'), 'preserve'); if(mode==='advanced'){git(f.args.sourcePath,'add','unrelated-draft');git(f.args.sourcePath,'commit','-m','Later separate work');} await f.call('service.resume', {}); }
      const op = await f.wait(admitted.operationId); assert.equal(op.state, 'succeeded', JSON.stringify(op));
      assert.equal(git(f.path, 'rev-parse', 'HEAD'), f.args.sourceTip); assert.equal(readFileSync(join(f.args.sourcePath, 'unrelated-draft'), 'utf8'), 'preserve');
      assert.equal(op.result.capturedSource.owner, 'contribution'); assert.equal(git(op.result.capturedSource.path, 'status', '--porcelain'), ''); assert(!op.result.capturedSource.path.includes('/.codex/worktrees/'));
      const queue = f.store.record('adoptedSnapshotQueue', op.operationId); assert.equal(queue.phase, 'registered'); assert.equal(queue.previous.candidate.worktree_path, git(f.args.sourcePath, 'rev-parse', '--show-toplevel')); assert.deepEqual(queue.queued.supersedes, [f.args.base]);
      assert(!existsSync(join(f.path, 'unrelated-draft'))); if(mode==='advanced')assert.notEqual(git(f.args.sourcePath,'rev-parse','HEAD'),f.args.sourceTip);
    } finally { await f.cleanup(); }
  }
});

test('an unapproved original source or a generic message override cannot obtain captured-source authority', async () => {
  for (const mode of ['source','message']) {
    const f=await fixture(); try {
      if(mode==='message') f.args.metadata.integrationMessage='Unauthorized original message replacement';
      else {const other=join(f.root,'ordinary-worktree');git(f.path,'worktree','add','--detach',other,f.args.sourceTip);f.args.sourcePath=other;writeFileSync(join(other,'draft'),'preserve');}
      const result=await f.call('submit',f.args);assert.equal(result.error.code,mode==='message'?'PROJECT_MESSAGE_POLICY':'SOURCE_OWNERSHIP_REQUIRED');assert(!existsSync(join(f.path,'.git/worker-count')));
    } finally {await f.cleanup();}
  }
});

test('captured-source registration preserves all policy families and original Mathy requirement metadata', async () => {
  for (const policy of adoptionPolicies) {
    const f = await fixture(policy.id); try {
      writeFileSync(join(f.args.sourcePath,'unrelated-draft'),'preserve');
      const admitted=await f.call('submit',f.args);assert.equal(admitted.error,null,JSON.stringify(admitted));const op=await f.wait(admitted.operationId);
      assert.equal(op.state,'succeeded',JSON.stringify(op));const queue=f.store.record('adoptedSnapshotQueue',op.operationId);
      assert.equal(queue.queued.objective_id,'original-objective');assert.equal(queue.queued.review_epoch,4);assert.deepEqual(queue.queued.required_ui_test_selectors,['required-selector']);
      assert.equal(queue.queued.task_id,'original-task');assert.equal(readFileSync(join(f.args.sourcePath,'unrelated-draft'),'utf8'),'preserve');
      assert.equal(readFileSync(join(f.path,'.git/worker-count'),'utf8'),'worker\n');
    } finally {await f.cleanup();}
  }
});

test('active original flights preserve candidate ownership and an explicit pre-dispatch retry uses the same request', async () => {
  const f=await fixture(), flight=new LegacyLandingFlight(f.repo.commonDir,f.args.sourceTip,'a'.repeat(64));
  try {
    assert.equal(flight.tryAcquire().status,'acquired');writeFileSync(join(f.args.sourcePath,'unrelated-draft'),'preserve');
    const original=readFileSync(join(f.path,'.git/fixture-candidate')),admitted=await f.call('submit',f.args);let op=await f.wait(admitted.operationId);
    assert.equal(op.state,'waiting');assert.equal(op.error.code,'LANDING_COORDINATION_BUSY');assert.equal(op.effectDispatched,false);
    assert.deepEqual(readFileSync(join(f.path,'.git/fixture-candidate')),original);assert(!existsSync(join(f.path,'.git/worker-count')));
    flight.release();await f.call('runs.reconcile',{operationId:op.operationId});op=await f.wait(op.operationId);assert.equal(op.state,'succeeded',JSON.stringify(op));
    assert.equal(op.requestId,f.args.requestId);assert.equal(readFileSync(join(f.path,'.git/worker-count'),'utf8'),'worker\n');
  } finally {flight.release();await f.cleanup();}
});

test('post-promotion exit loss is resolved by original receipts while missing receipt and native reconciliation stay uncertain', async () => {
  for (const mode of ['exit-after-delivery', 'missing-receipt', 'reconciliation']) {
    const f = await fixture(mode === 'reconciliation' ? 'mathy-v1' : 'maincharacter-v1', mode); try {
      const admitted = await f.call('submit', f.args); assert.equal(admitted.error, null, JSON.stringify(admitted)); let op = await f.wait(admitted.operationId);
      assert.equal(op.state, mode === 'exit-after-delivery' ? 'succeeded' : 'outcome_unknown', JSON.stringify(op)); assert.equal(git(f.path, 'rev-parse', 'HEAD'), f.args.sourceTip);
      if (mode === 'reconciliation') { const path = join(f.path, '.git/fixture-receipt'), receipt = JSON.parse(readFileSync(path)); receipt.reconciliation_status = 'passed'; writeFileSync(path, JSON.stringify(receipt)); }
      await f.engine.recoverObservedEffects(op.operationId); op = f.store.get(op.operationId);
      assert.equal(op.state, mode === 'missing-receipt' ? 'outcome_unknown' : 'succeeded'); assert.equal(readFileSync(join(f.path, '.git/worker-count'), 'utf8'), 'worker\n');
    } finally { await f.cleanup(); }
  }
});

test('a completion guard failure cannot be hidden by an original landed receipt and reconciliation never reruns integration', async () => {
  const f = await fixture(); try {
    writeFileSync(join(f.path, '.git/guard-fail'), 'fixture blocker');
    const admitted = await f.call('submit', f.args), op = await f.wait(admitted.operationId); assert.equal(op.state, 'outcome_unknown');
    await f.engine.recoverObservedEffects(op.operationId); assert.equal(f.store.get(op.operationId).state, 'outcome_unknown');
    rmSync(join(f.path, '.git/guard-fail')); await f.engine.recoverObservedEffects(op.operationId); assert.equal(f.store.get(op.operationId).state, 'succeeded');
    assert.equal(readFileSync(join(f.path, '.git/worker-count'), 'utf8'), 'worker\n');
  } finally { await f.cleanup(); }
});
