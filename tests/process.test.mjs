import test from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../packages/engine/dist/process.js';

test('cancellation terminates a resistant descendant after its shell leader exits', { timeout: 10000 }, async () => {
  const controller = new AbortController(); let timer;
  const result = await run('/bin/sh', ['-c', 'trap "exit 0" TERM; /bin/sh -c \'trap "" TERM; echo child-ready; while :; do sleep 1; done\' & wait'], {
    timeoutMs: 6000, signal: controller.signal, output: text => { if (text.includes('child-ready') && !timer) timer = setTimeout(() => controller.abort(), 50); }
  });
  assert.equal(result.cancelled, true); assert.equal(result.timedOut, false);
  assert.equal(result.code, 130);
});

test('a zero child exit cannot erase cancellation, timeout or output-limit failure', { timeout: 10000 }, async () => {
  for (const kind of ['cancel', 'timeout', 'output']) {
    const controller = new AbortController();
    const script = 'trap "exit 0" TERM; echo ready; while :; do sleep 0.05; done';
    const result = await run('/bin/sh', ['-c', script], {
      timeoutMs: kind === 'timeout' ? 400 : 3000, maxBytes: kind === 'output' ? 1 : 1024, signal: controller.signal,
      output: text => { if (kind === 'cancel' && text.includes('ready')) controller.abort(); }
    });
    assert.equal(result.actualExitCode, 0, kind);
    assert.equal(result.code, kind === 'cancel' ? 130 : kind === 'timeout' ? 124 : 5, kind);
    assert.equal(result.timedOut, kind === 'timeout'); assert.equal(result.cancelled, kind === 'cancel');
  }
  const exit = await run('/bin/sh', ['-c', 'exit 7']); assert.equal(exit.code, 7); assert.equal(exit.actualExitCode, 7);
});
