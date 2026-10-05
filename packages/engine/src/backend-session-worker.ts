import { readSync } from 'node:fs';
import { stableFileDigest } from './bounded-file.js';

// This process cannot invoke the backend until its parent durably retains its
// PID/start identity and sends a complete grant over the private stdin pipe.
// execve preserves that identity and process group; there is no unjournaled
// second spawn between the grant and the backend's first possible effect.
try {
  const bytes = Buffer.alloc(16385); let length = 0;
  while (length < bytes.length) {
    const count = readSync(0, bytes, length, bytes.length - length, null);
    if (!count) break;
    length += count;
  }
  if (!length || length > 16384) throw new Error('Invalid grant');
  const grant = JSON.parse(bytes.subarray(0, length).toString('utf8')) as {
    executable: string; sha256: string; argv: string[]; environment: Record<string, string>; deadline: number;
  };
  if (stableFileDigest(grant.executable, 256 * 1024 ** 2, 'BACKEND_EXECUTABLE_CHANGED').sha256 !== grant.sha256 || typeof process.execve !== 'function' ||
    !Number.isFinite(grant.deadline) || Date.now() >= grant.deadline) throw new Error('Unverified or expired executable grant');
  process.execve(grant.executable, [grant.executable, ...grant.argv], grant.environment);
} catch {
  // Backend output and grant details may contain private material. Do not echo
  // either into the ordinary service log.
  process.exitCode = 78;
}
