import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fixture, repository } from './integration/service.mjs';
import { Journal } from '../packages/engine/dist/journal.js';
import { digest } from '../packages/engine/dist/core.js';

test('configuration recovery reconciles the file/journal boundary and returns the original request result', async () => {
  for (const boundary of ['before_file', 'after_file', 'concurrent_edit']) {
    const f = await fixture(); try {
      const path = repository(f.root); let repo = (await f.call('repos.add', { path })).result.repository;
      const init = await f.call('repos.initialize', { repo: repo.id, requestId: randomUUID() }); assert.equal((await f.wait(init.operationId)).operationState, 'succeeded');
      repo = (await f.call('repos.list')).result.repositories[0];
      const config = structuredClone(repo.config); config.name = 'Approved name'; const requestId = randomUUID(), updated = { ...repo, config, revision: digest(config) };
      await f.stop();
      const journal = new Journal(f.state);
      journal.put('configurationIntent', requestId, { requestId, identity: digest({ repo: repo.id, config, expectedRevision: repo.revision }), previous: repo, updated, state: 'prepared' }); journal.close();
      if (boundary !== 'before_file') writeFileSync(join(path, 'contribution.json'), JSON.stringify(boundary === 'after_file' ? config : { ...config, name: 'Concurrent owner edit' }));
      await f.start();
      if (boundary === 'concurrent_edit') {
        assert.equal(JSON.parse(readFileSync(join(path, 'contribution.json'), 'utf8')).name, 'Concurrent owner edit');
        assert.equal((await f.call('push', { repo: repo.id, preview: true })).error.code, 'CONFIGURATION_RECONCILIATION_REQUIRED');
      } else {
        assert.equal((await f.call('repos.inspect', { repo: repo.id })).result.revision, updated.revision);
        const replay = await f.call('repos.configure', { repo: repo.id, config, expectedRevision: repo.revision, requestId });
        assert.equal(replay.error, null); assert.equal(replay.result.repository.revision, updated.revision);
      }
    } finally { await f.cleanup(); }
  }
});
