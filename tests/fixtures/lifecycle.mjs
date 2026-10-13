export async function within(promise, label, timeoutMs = 10000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs} ms`)), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

export async function waitFor(predicate, label, { timeoutMs = 10000, intervalMs = 20, details = () => '' } = {}) {
  const deadline = performance.now() + timeoutMs;
  return within((async () => {
    while (true) {
      const value = await predicate();
      if (value) return value;
      if (performance.now() >= deadline) throw new Error(`${label} exceeded ${timeoutMs} ms: ${details()}`);
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  })(), label, timeoutMs + intervalMs);
}

export async function drainEngines(engines) {
  const rows = Array.isArray(engines) ? engines : [engines];
  for (const engine of rows) engine.stopping = true;
  await waitFor(() => rows.every(engine => !engine.active.size && !engine.backgroundBusy), 'Fixture engine drain', {
    timeoutMs: 30000,
    details: () => JSON.stringify(rows.map(engine => ({ active: [...engine.active.keys()], backgroundBusy: engine.backgroundBusy })))
  });
  await within(Promise.all(rows.map(engine => engine.power.close())), 'Fixture power cleanup');
}

export async function waitOperation(read, label, { pending = ['queued', 'running'], advance } = {}) {
  let last;
  return waitFor(async () => {
    last = await read();
    if (!pending.includes(last.operationState ?? last.state)) return last;
    await advance?.();
    return false;
  }, label, { timeoutMs: 30000, details: () => JSON.stringify(last) });
}

// Retain exit from spawn onward: exitCode remains null after signal exits, and
// waiting for a second exit event can never finish.
export function superviseChild(child, diagnostics = () => '') {
  const exited = new Promise(resolve => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
    child.once('error', error => resolve({ error }));
  });
  const stop = async (signal = 'SIGTERM', timeoutMs = 10000) => {
    if (child.exitCode !== null || child.signalCode !== null) return exited;
    child.kill(signal);
    try { return await within(exited, `Fixture child ${child.pid} exit: ${diagnostics()}`, timeoutMs); }
    catch (error) {
      child.kill('SIGKILL');
      await within(exited, `Fixture child ${child.pid} forced exit`, 5000);
      throw error;
    }
  };
  const ready = async () => {
    let buffer = '';
    let observe;
    const message = new Promise((resolve, reject) => {
      observe = data => {
        buffer += data;
        if (buffer.length > 65536) { reject(new Error('Fixture readiness output exceeded its bound')); return; }
        const newline = buffer.indexOf('\n');
        if (newline < 0) return;
        try {
          const value = JSON.parse(buffer.slice(0, newline));
          if (value.state !== 'ready') throw new Error('Unexpected fixture readiness response');
          resolve(value);
        } catch (error) { reject(error); }
      };
      child.stdout.on('data', observe);
    });
    try {
      return await within(Promise.race([message, exited.then(result => {
        throw result.error ?? new Error(`Service exited before readiness: ${JSON.stringify(result)} ${diagnostics()}`);
      })]), `Service readiness: ${diagnostics()}`);
    } finally { child.stdout.off('data', observe); }
  };
  return { exited, stop, ready };
}
