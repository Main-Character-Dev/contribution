import { readSync, closeSync } from 'node:fs';
// fd 3 is a one-use private execution barrier, independent of command stdin.
// No target code runs until its exact exec-preserved identity is journaled.
try {
  const chunks: Buffer[] = []; let count = 0; const waitingDeadline = performance.now() + 30000;
  for (;;) {
    const bytes = Buffer.alloc(16384); let n: number;
    try { n = readSync(3, bytes, 0, bytes.length, null); }
    catch (error) {
      // Spawned stdio is nonblocking. A busy journal/identity preflight may
      // legitimately leave this waiting worker ahead of its grant writer.
      if (['EAGAIN', 'EWOULDBLOCK', 'EINTR'].includes((error as NodeJS.ErrnoException).code ?? '') && performance.now() < waitingDeadline) {
        await new Promise(resolve => setTimeout(resolve, 10)); continue;
      }
      throw error;
    }
    if (!n) break; count += n; if (count > 1024 * 1024) throw new Error('Grant too large'); chunks.push(bytes.subarray(0, n));
  }
  closeSync(3);
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { executable: string; argv: string[]; environment: Record<string, string>; deadline: number };
  if (!value.executable.startsWith('/') || !Array.isArray(value.argv) || !value.argv.every(x => typeof x === 'string') || !Number.isFinite(value.deadline) || Date.now() >= value.deadline || typeof process.execve !== 'function') throw new Error('Grant invalid');
  process.execve(value.executable, [value.executable, ...value.argv], value.environment);
} catch { process.exitCode = 78; }
