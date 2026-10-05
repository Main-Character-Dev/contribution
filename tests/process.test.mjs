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

test('binary stdout preserves bytes independently of logs and stops before exceeding its sink bound', async () => {
  const binary = Buffer.from([0, 255, 128, 10, 254]); let chunks = [], logs = '';
  const result = await run(process.execPath, ['-e', 'process.stdout.write(Buffer.from([0,255,128,10,254])); process.stderr.write("diagnostic\\n")'], {
    maxBytes: 32, stdoutSink: { maxBytes: 5, write: data => chunks.push(Buffer.from(data)) }, output: text => { logs += text; }
  });
  assert.equal(result.code, 0); assert.equal(result.stdout, ''); assert.equal(result.stderr, 'diagnostic\n'); assert.equal(logs, 'diagnostic\n'); assert.deepEqual(Buffer.concat(chunks), binary);
  let retained = 0;
  const overflow = await run(process.execPath, ['-e', 'process.on("SIGTERM",()=>process.exit(0)); setInterval(()=>process.stdout.write(Buffer.alloc(1024,255)),1)'], {
    stdoutSink: { maxBytes: 4096, write: data => { retained += data.length; } }, timeoutMs: 5000
  });
  assert.equal(overflow.code, 5); assert.equal(overflow.outputLimited, true); assert(retained <= 4096); assert.equal(overflow.stdout, '');
});

test('failed output and ownership callbacks stop the child and reject without escaping the runner', async () => {
  for (const mode of ['binary', 'log', 'owner']) {
    const options = mode === 'binary' ? { stdoutSink: { maxBytes: 1024, write: () => { throw new Error('fixture disk full'); } } } :
      mode === 'log' ? { output: () => { throw new Error('fixture log full'); } } : { started: () => { throw new Error('fixture journal unavailable'); } };
    await assert.rejects(run(process.execPath, ['-e', 'setInterval(()=>process.stdout.write("output\\n"),5)'], { ...options, timeoutMs: 3000 }),
      { code: mode === 'owner' ? 'PROCESS_OBSERVER_FAILED' : 'OUTPUT_SINK_FAILED' });
  }
});

test('a bounded outer grace lets a supervised worker finish its owned child cleanup', { timeout: 10000 }, async () => {
  const controller = new AbortController(); let cleanup = '';
  const result = await run(process.execPath, ['-e', 'process.on("SIGTERM",()=>setTimeout(()=>{process.stdout.write("cleanup-confirmed\\n");process.exit(0)},1800));process.stdout.write("ready\\n");setInterval(()=>{},1000)'], {
    signal: controller.signal, timeoutMs: 7000, terminationGraceMs: 3500,
    output: text => { cleanup += text; if (text.includes('ready')) controller.abort(); }
  });
  assert.equal(result.code, 130); assert.equal(result.actualExitCode, 0); assert.match(cleanup, /cleanup-confirmed/);
  for (const terminationGraceMs of [-1, 0.5, 30001, Infinity]) await assert.rejects(run('/bin/sh', ['-c', 'exit 0'], { terminationGraceMs }), { code: 'INVALID_TERMINATION_BOUND' });
});
