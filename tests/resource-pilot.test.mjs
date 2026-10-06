import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture, repository, commit, git } from './integration/service.mjs';
import { processIdentity } from '../packages/engine/dist/process.js';

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
