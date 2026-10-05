/** Narrow compatibility edits, generated for private review before adoption.
 * No original project source is distributed with this module. */
export function leaseBridgePatch(source: string): string {
  if (source.includes('Contribution shared-writer bridge v1')) throw new Error('This primary lease source is already bridged.');
  const rename = (name: string): void => {
    const before = `export function ${name}(`;
    if (source.split(before).length !== 2) throw new Error('The primary lease seam changed; inspect current source before adoption.');
    source = source.replace(before, `function contributionLegacy_${name}(`);
  };
  rename('acquirePrimaryCheckoutLease'); rename('releasePrimaryCheckoutLease');
  const hasProcessLease = source.includes('export function releaseProcessLease(');
  if (hasProcessLease) rename('releaseProcessLease');
  return source + `
// Contribution shared-writer bridge v1. Legacy behavior remains the fallback.
// Every borrow/release is checked by the installed service against live Git ancestry.
import { spawnSync as contributionBridgeSpawn } from 'node:child_process';
function contributionBridgeCall(action, borrowToken) {
  const env = process.env;
  for (const name of ['CONTRIBUTION_BRIDGE_NODE', 'CONTRIBUTION_BRIDGE_CLI', 'CONTRIBUTION_BRIDGE_STATE', 'CONTRIBUTION_BRIDGE_REPO', 'CONTRIBUTION_OPERATION_ID', 'CONTRIBUTION_HOOK_TOKEN']) {
    if (!env[name]) throw new Error('The managed hook bridge is incomplete; preserve the outer lease.');
  }
  if (![env.CONTRIBUTION_BRIDGE_NODE, env.CONTRIBUTION_BRIDGE_CLI, env.CONTRIBUTION_BRIDGE_STATE].every(value => value.startsWith('/'))) throw new Error('The installed bridge requires absolute paths.');
  const argv = [env.CONTRIBUTION_BRIDGE_CLI, 'hook', action, '--repo', env.CONTRIBUTION_BRIDGE_REPO, '--state-dir', env.CONTRIBUTION_BRIDGE_STATE, '--json'];
  if (borrowToken) argv.push('--borrow-token', borrowToken);
  const response = contributionBridgeSpawn(env.CONTRIBUTION_BRIDGE_NODE, argv, { cwd: process.cwd(), env, encoding: 'utf8', timeout: 20000, maxBuffer: 1048576 });
  if (response.error || response.status !== 0) throw new Error('The installed service refused the managed hook lease.');
  const envelope = JSON.parse(response.stdout);
  if (envelope.schemaVersion !== 1 || envelope.error || !envelope.result) throw new Error('Invalid managed hook lease response.');
  return envelope.result;
}
export function acquirePrimaryCheckoutLease(options) {
  if (process.env.CONTRIBUTION_HOOK_TOKEN) return contributionBridgeCall('borrow');
  return contributionLegacy_acquirePrimaryCheckoutLease(options);
}
function contributionReleaseBorrow(options, legacy) {
  if (typeof options?.token === 'string' && options.token.startsWith('contribution-borrow:')) {
    const result = contributionBridgeCall('release-borrow', options.token);
    return result.released === true && result.outerLeaseReleased === false;
  }
  return legacy(options);
}
export function releasePrimaryCheckoutLease(options) { return contributionReleaseBorrow(options, contributionLegacy_releasePrimaryCheckoutLease); }
${hasProcessLease ? 'export function releaseProcessLease(options) { return contributionReleaseBorrow(options, contributionLegacy_releaseProcessLease); }' : ''}
`;
}
