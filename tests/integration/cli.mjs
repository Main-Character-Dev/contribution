import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
export function invoke(args, cwd) {
  const state = mkdtempSync(join(tmpdir(), 'ct-cli-uninstalled-'));
  try {
    return spawnSync(process.execPath, [fileURLToPath(new URL('../../packages/cli/dist/main.js', import.meta.url)), ...args, '--state-dir', state],
      { encoding: 'utf8', timeout: 20000, ...(cwd ? { cwd } : {}) });
  } finally { rmSync(state, { recursive: true }); }
}
