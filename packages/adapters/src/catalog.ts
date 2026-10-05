import { existsSync, readFileSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export interface AdoptionPolicy {
  id: string; packageName: string; gate: 'enabled' | 'inactive'; hookOwner: 'trusted-dispatcher' | 'husky';
  landing: 'policy-only' | 'integration-only'; attributionDates: 'one' | 'multiple';
  validation: 'cumulative' | 'local-safety' | 'inactive'; policyFiles: readonly string[];
}
const common = ['AGENTS.md', 'package.json', '.node-version', 'scripts/worktree-land', 'scripts/worktree-landing-worker', 'scripts/lib/primary-checkout-lease.mjs', 'scripts/lib/worktree-landing-flight.mjs', 'scripts/lib/worktree-landing-state.mjs'];
export const adoptionPolicies: readonly AdoptionPolicy[] = [
  { id: 'mathy-v1', packageName: 'mathy', gate: 'enabled', hookOwner: 'trusted-dispatcher', landing: 'policy-only', attributionDates: 'multiple', validation: 'cumulative',
    policyFiles: [...common, '.githooks/pre-push', '.githooks/_/runtime-bootstrap.sh', 'scripts/prepare-push.mjs', 'scripts/validation-profile.mjs', 'scripts/lib/process-identity.mjs'] },
  { id: 'maincharacter-v1', packageName: 'maincharacter', gate: 'enabled', hookOwner: 'husky', landing: 'integration-only', attributionDates: 'one', validation: 'cumulative',
    policyFiles: [...common, '.husky/pre-push', 'scripts/run-changed-checks.mjs', 'scripts/pre-push-exact-tree.mjs', 'scripts/pre-push-process-context.mjs'] },
  { id: 'roboty-v1', packageName: 'roboty', gate: 'enabled', hookOwner: 'husky', landing: 'integration-only', attributionDates: 'one', validation: 'local-safety',
    policyFiles: [...common, '.husky/pre-push', 'scripts/local-pre-push.mjs', 'scripts/activation-command.mjs', 'scripts/config/activation-commands.json', 'scripts/ios-device.mjs'] },
  { id: 'glassalpha-v1', packageName: 'glassalpha', gate: 'inactive', hookOwner: 'husky', landing: 'integration-only', attributionDates: 'one', validation: 'inactive', policyFiles: common },
];
function bounded(path: string, limit: number): Buffer {
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > limit) throw new Error('Repository policy input is not a bounded regular file.');
  return readFileSync(path);
}
export function identifyAdoption(root: string): AdoptionPolicy | undefined {
  const file = join(root, 'package.json'); if (!existsSync(file)) return undefined;
  try {
    const name = (JSON.parse(bounded(file, 1024 * 1024).toString('utf8')) as { name?: string }).name;
    return adoptionPolicies.find(policy => policy.packageName === name && policy.policyFiles.every(file => existsSync(join(root, file))));
  } catch { return undefined; }
}
export function policyInventory(root: string, adapterId: string): { policy: AdoptionPolicy; files: Record<string, string | null>; readyForParity: boolean } {
  const policy = adoptionPolicies.find(item => item.id === adapterId);
  if (!policy) throw new Error('Unknown installed repository adapter.');
  const files: Record<string, string | null> = {};
  for (const file of policy.policyFiles) files[file] = existsSync(join(root, file)) ? createHash('sha256').update(bounded(join(root, file), 4 * 1024 * 1024)).digest('hex') : null;
  return { policy, files, readyForParity: Object.values(files).every(Boolean) };
}
export function projectPins(root: string): { node: string; pnpm: string; inputs: string } {
  const nodeFile = bounded(join(root, '.node-version'), 4096), packageFile = bounded(join(root, 'package.json'), 1024 * 1024);
  const node = nodeFile.toString('utf8').trim().replace(/^v/, ''), packageManager = (JSON.parse(packageFile.toString('utf8')) as { packageManager?: string }).packageManager;
  if (!/^\d+\.\d+\.\d+$/.test(node) || !/^pnpm@\d+\.\d+\.\d+(?:\+sha(?:224|256|512)\.[a-f0-9]+)?$/.test(packageManager ?? '')) throw new Error('The project must declare exact Node and pnpm pins.');
  return { node, pnpm: packageManager!.slice('pnpm@'.length).split('+')[0]!, inputs: createHash('sha256').update(nodeFile).update(packageManager!).digest('hex') };
}
