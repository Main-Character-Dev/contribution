import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { adoptionPolicies, policyInventory, projectPins } from '../packages/adapters/dist/index.js';
import { fixture, repository, commit, git } from './integration/service.mjs';

test('repository policy inventory keeps attribution, activation and gate distinctions without exposing source content', () => {
  const root = mkdtempSync(join(tmpdir(), 'ct-policy-'));
  try {
    for (const policy of adoptionPolicies) {
      const path = join(root, policy.id); mkdirSync(path);
      for (const file of policy.policyFiles) { mkdirSync(dirname(join(path, file)), { recursive: true }); writeFileSync(join(path, file), 'fixture private policy text\n'); }
      const inventory = policyInventory(path, policy.id);
      assert.equal(inventory.readyForParity, true); assert.doesNotMatch(JSON.stringify(inventory), /fixture private policy text/);
    }
    const mathy = adoptionPolicies.find(p => p.id === 'mathy-v1'), roboty = adoptionPolicies.find(p => p.id === 'roboty-v1'), glass = adoptionPolicies.find(p => p.id === 'glassalpha-v1');
    assert.equal(mathy.attributionDates, 'multiple'); assert.equal(mathy.landing, 'policy-only');
    assert.equal(roboty.validation, 'local-safety'); assert.equal(roboty.attributionDates, 'one'); assert.equal(glass.gate, 'inactive');
  } finally { rmSync(root, { recursive: true }); }
});

test('adoption enrollment preserves an inactive gate while requiring migration of its existing hook owner', async () => {
  const f = await fixture(); try {
    const path = repository(f.root), policy = adoptionPolicies.find(p => p.id === 'glassalpha-v1');
    for (const file of policy.policyFiles) { mkdirSync(dirname(join(path, file)), { recursive: true }); writeFileSync(join(path, file), 'fixture\n'); }
    writeFileSync(join(path, 'package.json'), JSON.stringify({ name: 'glassalpha', packageManager: 'pnpm@11.22.0' }));
    writeFileSync(join(path, '.nvmrc'), '24.19.0\n'); git(path, 'config', 'core.hooksPath', '.husky/_');
    const result = await f.call('repos.add', { path }); assert.equal(result.error, null);
    assert.equal(result.result.repository.config.validation.gate, 'inactive'); assert.equal(result.result.repository.config.integration.adapter, 'migration-required');
    assert.equal(git(path, 'config', '--get', 'core.hooksPath'), '.husky/_');
    const report = await f.call('repos.migration', { repo: result.result.repository.id }); assert.equal(report.error, null); assert.equal(report.result.mutation, 'none');
  } finally { await f.cleanup(); }
});

test('project checks require their own explicit tool pins and reject runtime drift', async () => {
  const f = await fixture(); try {
    const path = repository(f.root), pnpm = join(f.root, 'fixture-pnpm'); writeFileSync(pnpm, '#!/bin/sh\necho 11.23.0\n', { mode: 0o755 });
    writeFileSync(join(path, '.node-version'), process.versions.node + '\n'); writeFileSync(join(path, 'package.json'), JSON.stringify({ name: 'fixture', packageManager: 'pnpm@11.23.0' }));
    git(path, 'add', '.node-version', 'package.json'); git(path, 'commit', '-m', 'Pinned fixture');
    const repo = (await f.call('repos.add', { path })).result.repository, config = structuredClone(repo.config);
    config.validation.checks = [{ id: 'runtime', argv: ['node', '-e', 'console.log("verified-project-runtime")'], cwd: '.', profiles: ['local-development'], timeoutSeconds: 10, reuse: 'never' }];
    await f.call('repos.configure', { repo: repo.id, config, expectedRevision: repo.revision, requestId: randomUUID() });
    const missing = await f.call('checks.run', { repo: repo.id, canonical: true, requestId: randomUUID() }); assert.equal((await f.wait(missing.operationId)).error.code, 'PROJECT_RUNTIME_REQUIRED');
    await f.call('runs.cancel', { operationId: missing.operationId });
    assert.equal((await f.call('repos.runtime', { repo: repo.id, node: process.execPath, pnpm })).error, null);
    const accepted = await f.call('checks.run', { repo: repo.id, canonical: true, requestId: randomUUID() }); assert.equal((await f.wait(accepted.operationId)).operationState, 'succeeded');
    assert.match((await f.call('logs', { operationId: accepted.operationId })).result.text, /verified-project-runtime/);
    commit(path, '.node-version', '99.0.0\n');
    const changed = await f.call('checks.run', { repo: repo.id, canonical: true, requestId: randomUUID() }); assert.equal((await f.wait(changed.operationId)).error.code, 'PROJECT_RUNTIME_CHANGED');
  } finally { await f.cleanup(); }
});

test('runtime pin inspection does not accept floating package-manager requirements', () => {
  const root = mkdtempSync(join(tmpdir(), 'ct-pins-'));
  try { writeFileSync(join(root, '.node-version'), '24.19.0\n'); writeFileSync(join(root, 'package.json'), JSON.stringify({ packageManager: 'pnpm@latest' })); assert.throws(() => projectPins(root), /exact Node and pnpm/); }
  finally { rmSync(root, { recursive: true }); }
});

test('original nvmrc pins work without node-version and conflicting, floating or linked declarations fail closed', () => {
  const root=mkdtempSync(join(tmpdir(),'ct-nvmrc-'));
  try {
    writeFileSync(join(root,'package.json'),JSON.stringify({packageManager:'pnpm@11.22.0'}));writeFileSync(join(root,'.nvmrc'),'v24.19.0\n');
    const original=projectPins(root);assert.equal(original.node,'24.19.0');assert.equal(original.pnpm,'11.22.0');
    writeFileSync(join(root,'.node-version'),'24.19.0\n');assert.equal(projectPins(root).node,'24.19.0');assert.notEqual(projectPins(root).inputs,original.inputs);
    writeFileSync(join(root,'.node-version'),'24.21.0\n');assert.throws(()=>projectPins(root),/matching exact/);
    rmSync(join(root,'.node-version'));writeFileSync(join(root,'.nvmrc'),'lts/*\n');assert.throws(()=>projectPins(root),/matching exact/);
    rmSync(join(root,'.nvmrc'));symlinkSync(join(root,'missing'),join(root,'.nvmrc'));writeFileSync(join(root,'.node-version'),'24.19.0\n');assert.throws(()=>projectPins(root),/bounded regular file/);
  } finally {rmSync(root,{recursive:true});}
});
