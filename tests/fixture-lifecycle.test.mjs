import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { superviseChild, drainEngines } from './fixtures/lifecycle.mjs';

test('fixture cleanup is repeatable after SIGKILL and natural exit', async () => {
  for (const signal of ['SIGKILL', null]) {
    const child = spawn(process.execPath, ['-e', 'console.log(JSON.stringify({state:"ready"}));' + (signal ? 'setInterval(()=>{},1000)' : '')]);
    const lifecycle = superviseChild(child);
    try {
      await lifecycle.ready();
      if (signal) await lifecycle.stop(signal); else await lifecycle.exited;
      await lifecycle.stop(); await lifecycle.stop();
      assert.equal(child.signalCode, signal);
    } finally { await lifecycle.stop('SIGKILL'); }
  }
});

test('stalled fixture shutdown fails within its bound and releases its child', async () => {
  const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{});console.log(JSON.stringify({state:"ready"}));setInterval(()=>{},1000)']);
  const lifecycle = superviseChild(child);
  try {
    await lifecycle.ready();
    await assert.rejects(lifecycle.stop('SIGTERM', 50), /exit.*exceeded 50 ms/);
    assert.equal(child.signalCode, 'SIGKILL'); await lifecycle.stop();
  } finally { await lifecycle.stop('SIGKILL'); }
});

test('engine cleanup drains background observations before closing its owner', async () => {
  let busy = true, closed = false;
  const engine = { stopping: false, active: new Map(), get backgroundBusy() { return busy; }, power: { close: async () => { assert.equal(busy, false); closed = true; } } };
  const drain = drainEngines(engine);
  assert.equal(engine.stopping, true); assert.equal(closed, false);
  busy = false; await drain; assert.equal(closed, true);
});

test('Git fixture and engine commands ignore global signing and hooks', () => {
  const root = mkdtempSync(join(tmpdir(), 'ct-hostile-git-'));
  try {
    const config = join(root, 'global'), hooks = join(root, 'hooks'), marker = join(root, 'hook-ran'); mkdirSync(hooks);
    writeFileSync(join(hooks, 'pre-commit'), `#!/bin/sh\ntouch '${marker}'\nexit 91\n`, { mode: 0o700 });
    writeFileSync(config, `[commit]\n gpgsign=true\n[gpg]\n program=/nonexistent-fixture-signer\n[core]\n hooksPath=${hooks}\n`);
    const code = `import {repository,commit} from './tests/integration/service.mjs';import {Journal} from './packages/engine/dist/journal.js';import {Engine} from './packages/engine/dist/service.js';const path=repository(${JSON.stringify(root)});commit(path);const store=new Journal(${JSON.stringify(join(root, 'state'))});try{const engine=new Engine(store,{identity:'fixture'});await engine.repos.add(path);console.log('isolated');}finally{store.close();}`;
    const result = spawnSync(process.execPath, ['--import', './tests/fixtures/environment.mjs', '--input-type=module', '-e', code], { encoding: 'utf8', timeout: 15000, env: { ...process.env, GIT_CONFIG_GLOBAL: config } });
    assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /isolated/); assert.equal(existsSync(marker), false);
  } finally { rmSync(root, { recursive: true }); }
});
