import test from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../packages/engine/dist/process.js';

test('cancellation terminates a resistant descendant after its shell leader exits', { timeout: 10000 }, async () => {
  const controller = new AbortController(); let timer;
  const result = await run('/bin/sh', ['-c', 'trap "exit 0" TERM; /bin/sh -c \'trap "" TERM; echo child-ready; while :; do sleep 1; done\' & wait'], {
    timeoutMs: 6000, signal: controller.signal, output: text => { if (text.includes('child-ready') && !timer) timer = setTimeout(() => controller.abort(), 50); }
  });
  assert.equal(result.cancelled, true); assert.equal(result.timedOut, false);
});
