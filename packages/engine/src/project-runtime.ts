import { realpathSync, accessSync, constants } from 'node:fs';
import { dirname, delimiter } from 'node:path';
import { projectPins } from '@contribution/adapters';
import { run } from './process.js';
import { requireValue, Fault } from './core.js';
import type { Journal } from './journal.js';
import type { Enrolled } from './repositories.js';

export interface ProjectRuntime { node: string; pnpm: string; nodeVersion: string; pnpmVersion: string; pinsDigest: string }
export class ProjectRuntimes {
  constructor(readonly store: Journal) {}
  async register(repo: Enrolled, node: string, pnpm: string): Promise<ProjectRuntime> {
    requireValue(node.startsWith('/') && pnpm.startsWith('/'), 'PROJECT_RUNTIME_REQUIRED', 'Register absolute project runtime executables.', 2);
    const pins = this.pins(repo.path);
    accessSync(node, constants.X_OK); accessSync(pnpm, constants.X_OK);
    const runtime: ProjectRuntime = { node: realpathSync(node), pnpm: realpathSync(pnpm), nodeVersion: pins.node, pnpmVersion: pins.pnpm, pinsDigest: pins.inputs };
    await this.verify(repo.path, runtime); this.store.put('projectRuntimeSelection', repo.id, runtime); return runtime;
  }
  private pins(path: string): ReturnType<typeof projectPins> {
    try { return projectPins(path); } catch { throw new Fault('PROJECT_PINS_REQUIRED', 'The selected project source must declare exact Node and pnpm pins.', 3); }
  }
  environment(runtime: ProjectRuntime): NodeJS.ProcessEnv {
    return { PATH: [dirname(runtime.node), dirname(runtime.pnpm), process.env['PATH'] ?? '/usr/bin:/bin'].join(delimiter), COREPACK_ENABLE_NETWORK: '0', COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' };
  }
  async verify(source: string, runtime: ProjectRuntime): Promise<void> {
    const pins = this.pins(source);
    requireValue(pins.inputs === runtime.pinsDigest && pins.node === runtime.nodeVersion && pins.pnpm === runtime.pnpmVersion, 'PROJECT_RUNTIME_CHANGED', 'The selected source runtime pins changed. Register the matching project tools.', 3);
    const env = this.environment(runtime);
    const versions = await Promise.all([run(runtime.node, ['--version'], { cwd: source, env, timeoutMs: 5000 }), run(runtime.pnpm, ['--version'], { cwd: source, env, timeoutMs: 10000 })]);
    requireValue(versions[0]!.code === 0 && versions[0]!.stdout.trim() === `v${pins.node}` && versions[1]!.code === 0 && versions[1]!.stdout.trim() === pins.pnpm,
      'PROJECT_RUNTIME_MISMATCH', 'Selected executable versions do not match this project. Contribution never installs another project runtime implicitly.', 3);
  }
  async resolve(repo: Enrolled, source: string): Promise<ProjectRuntime> {
    const runtime = this.store.record<ProjectRuntime>('projectRuntimeSelection', repo.id);
    requireValue(runtime, 'PROJECT_RUNTIME_REQUIRED', 'Register this project’s exact Node and pnpm executables first.', 3); await this.verify(source, runtime); return runtime;
  }
}
