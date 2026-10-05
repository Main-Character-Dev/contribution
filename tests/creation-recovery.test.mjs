import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, lstatSync, existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fixture, repository, git } from './integration/service.mjs';
import { Journal } from '../packages/engine/dist/journal.js';

test('creation retries retain one initialization and conflicting identities never create another destination', async () => {
  const f = await fixture(); try {
    const parent = repository(f.root), path = join(parent, 'new-project'), request = { path, requestId: randomUUID() };
    await f.call('service.pause');
    const [first, concurrent] = await Promise.all([f.call('repos.create', request), f.call('repos.create', request)]);
    assert.equal(first.error, null, JSON.stringify(first)); assert.equal(first.operationId, concurrent.operationId);
    git(path, 'config', 'user.name', 'Fixture Author'); git(path, 'config', 'user.email', 'fixture@example.invalid');
    await f.call('service.resume'); const finished = await f.wait(first.operationId);
    assert.equal(finished.operationState, 'succeeded', JSON.stringify(finished));
    await f.stop(); await f.start(); assert.equal((await f.call('repos.create', request)).operationId, first.operationId);
    assert.equal(git(path, 'rev-list', '--count', 'HEAD'), '1');
    const other = join(parent, 'other');
    assert.equal((await f.call('repos.create', { ...request, path: other })).error.code, 'REQUEST_ID_CONFLICT');
    assert.equal(existsSync(other), false);
  } finally { await f.cleanup(); }
});

test('partial repository creation resumes only its retained owned directory and preserves concurrent work', async () => {
  for (const boundary of ['claimed_directory', 'owned_git', 'initialized_git', 'owner_file', 'foreign_git']) {
    const f = await fixture(); try {
      const parent = repository(f.root), requestedPath = join(parent, 'new-project'); mkdirSync(requestedPath);
      const path = realpathSync(requestedPath), info = lstatSync(path), requestId = randomUUID();
      await f.call('service.pause'); await f.stop();
      const journal = new Journal(f.state); journal.put('creationIntent', requestId, { requestId, requestedPath, path, directory: { dev: info.dev, ino: info.ino } }); journal.close();
      if (['owned_git', 'initialized_git', 'foreign_git'].includes(boundary)) {
        mkdirSync(join(path, '.git'));
        if (boundary !== 'foreign_git') writeFileSync(join(path, '.git/contribution-creation.json'), JSON.stringify({ schemaVersion: 1, requestId, path }) + '\n');
        if (boundary === 'initialized_git') git(path, 'init', '--initial-branch=dev');
      }
      if (boundary === 'owner_file') writeFileSync(join(path, 'owner.txt'), 'preserved');
      await f.start(); const response = await f.call('repos.create', { path: requestedPath, requestId });
      if (boundary === 'owner_file') {
        assert.equal(response.error.code, 'DESTINATION_CHANGED'); assert.equal(readFileSync(join(path, 'owner.txt'), 'utf8'), 'preserved');
      } else if (boundary === 'foreign_git') {
        assert.equal(response.error.code, 'CREATION_OWNERSHIP_UNCONFIRMED'); assert.equal(existsSync(join(path, '.git/HEAD')), false);
      } else {
        assert.equal(response.error, null, JSON.stringify(response)); assert.equal(response.operationState, 'queued');
        assert.equal((await f.call('repos.create', { path: requestedPath, requestId })).operationId, response.operationId);
      }
    } finally { await f.cleanup(); }
  }
});
