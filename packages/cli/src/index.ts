import { helpResponse, unavailableResponse, usageResponse, versionResponse } from '@contribution/engine';
import type { Response } from '@contribution/contracts';

export interface CLIResult { readonly exitCode: number; readonly stdout: string }
const productGroups = new Set(['doctor', 'hosts', 'repos', 'status', 'submit', 'push', 'checks',
  'runs', 'logs', 'repair-context', 'codex', 'settings', 'service', 'update', 'devices']);

export function runCLI(args: readonly string[]): CLIResult {
  const json = args.includes('--json');
  const words = args.filter(word => word !== '--json');
  const command = words[0];
  let response: Response;
  let exitCode = 0;
  if (words.length === 0 || command === 'help' || words.includes('--help')) {
    response = helpResponse();
  } else if ((command === 'version' || command === '--version') && words.length === 1) {
    response = versionResponse();
  } else if (command && productGroups.has(command)) {
    response = unavailableResponse(); exitCode = 3;
  } else {
    response = usageResponse('Use help, version, or service status. No product operations are implemented in S0.'); exitCode = 2;
  }
  if (json) return { exitCode, stdout: JSON.stringify(response) + '\n' };
  if (response.error) return { exitCode, stdout: response.error.message + '\n' };
  if (response.result && 'version' in response.result) {
    return { exitCode, stdout: `Contribution ${String(response.result['version'])} (${String(response.result['channel'])}); service not installed\n` };
  }
  return { exitCode, stdout: 'Contribution — S0 development shell\n\nUsage: contribution help [--json]\n       contribution version [--json]\n       contribution service status [--json]\n\nProduct operations are unavailable; no service is installed.\n' };
}
