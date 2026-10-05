import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
export function invoke(args, cwd) {
  return spawnSync(process.execPath, [fileURLToPath(new URL('../../packages/cli/dist/main.js', import.meta.url)), ...args],
    { encoding: 'utf8', ...(cwd ? { cwd } : {}) });
}
