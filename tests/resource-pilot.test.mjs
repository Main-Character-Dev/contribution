import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture, repository, commit, git } from './integration/service.mjs';
import { processIdentity } from '../packages/engine/dist/process.js';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

// A disposable packaged-service pilot on this host. This is not launchd,
// Simulator, provider or two-host qualification and never enrolls a user repo.
test('AT-LC08/13/18 disposable immutable payload survives SIGKILL, observes exact orphan ownership and replays reviewed cleanup once', async () => {
  const f = await fixture(); let retained;
  try {
    const primary = repository(f.root); commit(primary);
    const added = await f.call('repos.add', { path: primary }); assert.equal(added.error, null);
    const repo = added.result.repository, config = structuredClone(repo.config);
    config.validation.builtins = []; config.validation.checks = [{ id: 'disposable-wait', profiles: [config.validation.profile], argv: ['/bin/sh', '-c', 'sleep 30'], cwd: '.', timeoutSeconds: 40, reuse: 'never' }];
    const configured = await f.call('repos.configure', { repo: repo.id, config, expectedRevision: repo.revision, requestId: randomUUID() }); assert.equal(configured.error, null, JSON.stringify(configured));
    git(primary, 'add', '--all'); git(primary, 'commit', '--allow-empty', '-m', 'Fixture configuration');
    const requestId = randomUUID(), admitted = await f.call('checks.run', { repo: repo.id, canonical: true, requestId }); assert.equal(admitted.error, null, JSON.stringify(admitted));
    for (let n = 0; n < 200; n++) {
      const response = await f.call('service.resources'); retained = response.result.resources.find(r => r.operationId === admitted.operationId && r.state === 'active');
      if (retained) break; await new Promise(resolve => setTimeout(resolve, 30));
    }
    assert(retained); const members = JSON.parse(retained.identity.value.members);
    await f.stop('SIGKILL'); await f.start();
    const rows = await f.call('service.resources'); const recovered = rows.result.resources.find(r => r.resourceId === retained.resourceId);
    assert.equal(recovered.state, 'unresolved'); assert.equal(recovered.token, retained.token);
    const duplicate = await f.call('checks.run', { repo: repo.id, canonical: true, requestId }); assert.equal(duplicate.operationId, admitted.operationId);
    const blocked = await f.call('checks.run', { repo: repo.id, canonical: true, requestId: randomUUID() }); assert.equal(blocked.error.code, 'RESOURCE_RECONCILIATION_REQUIRED');
    const preview = await f.call('service.resources', { preview: true }); assert(preview.result.candidates.some(r => r.resourceId === retained.resourceId));
    const cleanup = { scopeToken: preview.result.scopeToken, requestId: randomUUID() }, result = await f.call('service.resources', cleanup);
    assert.equal(result.error, null, JSON.stringify(result)); assert(result.result.released.includes(retained.resourceId));
    assert.deepEqual((await f.call('service.resources', cleanup)).result, result.result);
    for (const member of members) assert.notEqual(processIdentity(member.pid), member.start);
    assert.equal((await f.call('service.resources')).result.resources.find(r => r.resourceId === retained.resourceId).state, 'stopped');
  } finally {
    // Only these fixture-retained PID/start identities are fallback operands.
    if (retained) for (const member of JSON.parse(retained.identity.value.members)) if (processIdentity(member.pid) === member.start) try { process.kill(member.pid, 'SIGKILL'); } catch { }
    await f.cleanup();
  }
});

test('AT-LC08/13 immutable service resumes cleanup interrupted by SIGKILL and clears only its exact admission fence', async () => {
  const f = await fixture(); let retained;
  try {
    const primary = repository(f.root); commit(primary);
    const fifo = join(f.root, 'owned-wait.fifo'); assert.equal(spawnSync('/usr/bin/mkfifo', [fifo]).status, 0);
    const added = await f.call('repos.add', { path: primary }), repo = added.result.repository, config = structuredClone(repo.config);
    config.validation.builtins = []; config.validation.checks = [{ id: 'owned-wait', profiles: [config.validation.profile],
      argv: ['/bin/sh', '-c', 'trap "" TERM; echo owned; read held < "$1"', 'fixture', fifo], cwd: '.', timeoutSeconds: 40, reuse: 'never' }];
    const configured = await f.call('repos.configure', { repo: repo.id, config, expectedRevision: repo.revision, requestId: randomUUID() }); assert.equal(configured.error, null);
    git(primary, 'add', '--all'); git(primary, 'commit', '--allow-empty', '-m', 'Fixture wait configuration');
    const admitted = await f.call('checks.run', { repo: repo.id, canonical: true, requestId: randomUUID() }); assert.equal(admitted.error, null);
    for (let n = 0; n < 200; n++) {
      retained = (await f.call('service.resources')).result.resources.find(r => r.operationId === admitted.operationId && r.state === 'active');
      if (retained) break; await new Promise(resolve => setTimeout(resolve, 30));
    }
    assert(retained); await f.stop('SIGKILL'); await f.start();
    const preview = await f.call('service.resources', { preview: true }), cleanup = { scopeToken: preview.result.scopeToken, requestId: randomUUID() };
    const interrupted = f.call('service.resources', cleanup).catch(error => error);
    let stopping;
    for (let n = 0; n < 100; n++) {
      stopping = (await f.call('service.resources')).result.resources.find(r => r.resourceId === retained.resourceId);
      if (stopping.state === 'stopping') break; await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(stopping.state, 'stopping'); await f.stop('SIGKILL'); await interrupted; await f.start();
    const blocked = await f.call('checks.run', { repo: repo.id, canonical: true, requestId: randomUUID() }); assert.equal(blocked.error.code, 'RESOURCE_RECONCILIATION_REQUIRED');
    const completed = await f.call('service.resources', cleanup); assert.equal(completed.error, null, JSON.stringify(completed));
    assert(completed.result.released.includes(retained.resourceId)); assert.deepEqual((await f.call('service.resources', cleanup)).result, completed.result);
    config.validation.checks[0].argv = ['/bin/sh', '-c', 'echo recovered'];
    const revised = await f.call('repos.configure', { repo: repo.id, config, expectedRevision: configured.result.repository.revision, requestId: randomUUID() }); assert.equal(revised.error, null, JSON.stringify(revised));
    git(primary, 'add', '--all'); git(primary, 'commit', '--allow-empty', '-m', 'Fixture recovered configuration');
    const next = await f.call('checks.run', { repo: repo.id, canonical: true, requestId: randomUUID() }); assert.equal(next.error, null, JSON.stringify(next));
    assert.equal((await f.wait(next.operationId)).operationState, 'succeeded');
  } finally {
    if (retained) for (const member of JSON.parse(retained.identity.value.members)) if (processIdentity(member.pid) === member.start) try { process.kill(member.pid, 'SIGKILL'); } catch { }
    await f.cleanup();
  }
});
