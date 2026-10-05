import { adoptionPolicies, leaseBridgePatch, reportingPatch } from '@contribution/adapters';
import { assertContract } from '@contribution/contracts';
import type { Repository } from '@contribution/contracts';
import type { Enrolled } from './repositories.js';
import { digest, requireValue } from './core.js';
import { git, gitText, identity, oid, ordinaryHistory } from './git.js';

const quote = (value: string): string => "'" + value.replaceAll("'", "'\\''") + "'";
export const adoptionReporting: Record<string, string | null> = { 'mathy-v1': 'scripts/lib/pre-push-reporting.mjs', 'maincharacter-v1': null, 'roboty-v1': 'scripts/local-pre-push.mjs', 'glassalpha-v1': null };
export function adoptionGuard(repositoryId: string): string {
  return `#!/bin/sh\n# Contribution adopted publication guard v1; original gate retained by the installed service.\nset -eu\nif [ -n "\${CONTRIBUTION_HOOK_TOKEN:-}" ]; then\n  exec "$CONTRIBUTION_BRIDGE_NODE" "$CONTRIBUTION_BRIDGE_CLI" hook adopted --repo ${quote(repositoryId)} --state-dir "$CONTRIBUTION_BRIDGE_STATE" --remote "$1" --url "$2"\nfi\nexec "$HOME/.local/bin/contribution" hook adopted --repo ${quote(repositoryId)} --remote "$1" --url "$2"\n`;
}
interface Blob { bytes: Buffer; mode: number }
export interface ExistingAdoptionSource {
  originalHook: Buffer | null;
  changes: { path: string; before: Buffer | null; after: Buffer; mode: number; beforeMode: number | null }[];
  inventory: Record<string, string | null>;
}
async function blob(repo: Enrolled, tip: string, path: string): Promise<Blob | null> {
  const entry = await gitText(repo.path, ['ls-tree', '-z', tip, '--', path]);
  if (!entry) return null;
  const match = /^(100644|100755) blob ([a-f0-9]{40,64})\t([^\0]+)\0$/.exec(entry);
  requireValue(match?.[3] === path, 'MIGRATION_SOURCE_UNSAFE', 'Committed migration sources must be ordinary files, not links or submodules.', 3);
  const result = await git(repo.path, ['cat-file', 'blob', match[2]!], { maxBytes: 4 * 1024 * 1024 });
  requireValue(result.code === 0 && !result.stdout.includes('\uFFFD') && !result.stdout.includes('\0'), 'MIGRATION_SOURCE_UNSAFE', 'Committed policy sources must be bounded UTF-8 text.', 3);
  return { bytes: Buffer.from(result.stdout), mode: match[1] === '100755' ? 0o755 : 0o644 };
}
/** Reconstruct only the deterministic reviewed migration from local committed
 * history. No remote program or caller-provided original hook is accepted. */
export async function existingAdoptionSource(repo: Enrolled, sourceTip: string, migrationTip: string): Promise<ExistingAdoptionSource> {
  const info = await identity(repo.path), adapter = repo.config.integration.adapter, policy = adoptionPolicies.find(value => value.id === adapter);
  requireValue(policy && adapter === repo.config.validation.adapter && policy.gate === repo.config.validation.gate, 'ADAPTER_SELECTION_MISMATCH', 'Select a tracked, already migrated project policy.', 3);
  oid(sourceTip, info.objectFormat); oid(migrationTip, info.objectFormat);
  requireValue(sourceTip !== migrationTip && (await git(repo.path, ['merge-base', '--is-ancestor', sourceTip, migrationTip])).code === 0 &&
    info.tip && (await git(repo.path, ['merge-base', '--is-ancestor', migrationTip, info.tip])).code === 0, 'MIGRATION_HISTORY_REQUIRED', 'The original and migration commits must be ancestors of this clone’s current history.', 3);
  await ordinaryHistory(repo.path, migrationTip);
  const guard = adapter === 'mathy-v1' ? '.githooks/pre-push' : '.husky/pre-push', original = await blob(repo, sourceTip, guard);
  requireValue(policy.gate === 'inactive' ? original === null : Boolean(original && original.bytes.length <= 128 * 1024), 'MIGRATION_GATE_CHANGED', 'The original committed gate must match the project’s activation policy.', 3);
  const configBefore = await blob(repo, sourceTip, 'contribution.json');
  if (configBefore) {
    const config = JSON.parse(configBefore.bytes.toString('utf8')) as Repository; assertContract('repository', config);
    requireValue(config.integration.adapter === 'migration-required' && config.validation.adapter === 'migration-required', 'MIGRATION_SOURCE_CHANGED', 'The original configuration must precede adoption.', 3);
    config.integration.adapter = adapter; config.validation.adapter = adapter;
    requireValue(digest(config) === repo.revision, 'MIGRATION_POLICY_CHANGED', 'The imported adoption cannot change another reviewed configuration field.', 3);
  }
  const leasePath = 'scripts/lib/primary-checkout-lease.mjs', lease = await blob(repo, sourceTip, leasePath);
  requireValue(lease, 'MIGRATION_SOURCE_MISSING', 'The original lease source is absent.', 3);
  const changes: ExistingAdoptionSource['changes'] = [
    { path: guard, before: original?.bytes ?? null, after: Buffer.from(adoptionGuard(repo.id)), beforeMode: original?.mode ?? null, mode: 0o755 },
    { path: leasePath, before: lease.bytes, after: Buffer.from(leaseBridgePatch(lease.bytes.toString('utf8'))), beforeMode: lease.mode, mode: lease.mode }
  ];
  const reporting = adoptionReporting[adapter];
  if (reporting) {
    const before = await blob(repo, sourceTip, reporting); requireValue(before, 'MIGRATION_SOURCE_MISSING', 'The original reporting source is absent.', 3);
    changes.push({ path: reporting, before: before.bytes, after: Buffer.from(reportingPatch(adapter, before.bytes.toString('utf8')).source), beforeMode: before.mode, mode: before.mode });
  }
  changes.push({ path: 'contribution.json', before: configBefore?.bytes ?? null, after: Buffer.from(JSON.stringify(repo.config, null, 2) + '\n'), beforeMode: configBefore?.mode ?? null, mode: configBefore?.mode ?? 0o644 });
  const changed = (await gitText(repo.path, ['diff', '--name-only', sourceTip, migrationTip, '--'])).split('\n').filter(Boolean).sort();
  requireValue(digest(changed) === digest(changes.filter(change => !change.before?.equals(change.after) || change.mode !== change.beforeMode).map(change => change.path).sort()), 'MIGRATION_RANGE_CHANGED', 'The historical migration must contain exactly the deterministic reviewed changes.', 3);
  for (const change of changes) {
    for (const tip of [migrationTip, info.tip]) {
      const current = await blob(repo, tip, change.path);
      requireValue(current?.bytes.equals(change.after) && current.mode === change.mode, 'MIGRATION_SOURCE_CHANGED', 'The committed migration or current policy differs from its deterministic reconstruction.', 3);
    }
  }
  const inventory: Record<string, string | null> = {};
  for (const path of policy.policyFiles) {
    const before = await blob(repo, sourceTip, path), after = await blob(repo, migrationTip, path), current = await blob(repo, info.tip, path);
    requireValue(before && after && current && after.bytes.equals(current.bytes) && after.mode === current.mode, 'MIGRATION_POLICY_CHANGED', 'The complete adopted policy must match its reviewed migration.', 3);
    if (!changes.some(change => change.path === path)) requireValue(before.bytes.equals(after.bytes) && before.mode === after.mode, 'MIGRATION_POLICY_CHANGED', 'An original policy source changed outside the adoption seams.', 3);
    inventory[path] = digest(before.bytes);
  }
  return { originalHook: original?.bytes ?? null, changes, inventory };
}
