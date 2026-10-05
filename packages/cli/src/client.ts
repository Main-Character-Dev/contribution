import { readFileSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { request, defaultStateDirectory, callerIdentity } from '@contribution/engine/client';
import { Fault, object, rejected, terminal } from '@contribution/engine/core';
import type { ObjectValue } from '@contribution/engine/core';
import { helpResponse, versionResponse } from '@contribution/engine';
import type { Response } from '@contribution/contracts';
import { executeAdoptedGate } from './adopted-hook.js';

const values: Record<string, string> = { '--repo': 'repo', '--root': 'root', '--profile': 'profile', '--availability': 'availability', '--request-id': 'requestId',
  '--expected-revision': 'expectedRevision', '--source-path': 'sourcePath', '--source-tip': 'sourceTip', '--base': 'base', '--expected-tip': 'expectedTip', '--scope-token': 'scopeToken',
  '--check': 'checkId', '--tail': 'tail', '--after': 'after', '--remote': 'remote', '--url': 'url', '--run': 'operationId', '--ssh-alias': 'sshAlias', '--host': 'host',
  '--device': 'device', '--artifact': 'artifact', '--app-ref': 'appRef', '--build-profile': 'buildProfile', '--plan': 'plan', '--session-profile': 'sessionProfile', '--duration-seconds': 'durationSeconds', '--max-bytes': 'maxBytes', '--kind': 'kind', '--node': 'node', '--pnpm': 'pnpm', '--adapter': 'adapter', '--to-host': 'toHost', '--from-host': 'fromHost' };
values['--release-ref'] = 'releaseRef';
values['--evidence'] = 'evidence';
values['--borrow-token'] = 'borrowToken';
values['--apply-adoption'] = 'applyAdoption'; values['--activate-adoption'] = 'activateAdoption'; values['--rollback-adoption'] = 'rollbackAdoption'; values['--adoption-plan'] = 'adoptionPlan';
values['--original-tip'] = 'originalTip'; values['--migration-tip'] = 'migrationTip';
values['--review-file'] = 'reviewFile'; values['--review-side'] = 'reviewSide'; values['--review-offset'] = 'reviewOffset';
const flags: Record<string, string> = { '--refresh': 'refresh', '--preview': 'preview', '--canonical': 'canonical', '--fresh': 'fresh', '--when-idle': 'whenIdle', '--launch': 'launch', '--prepare-reporting': 'prepareReporting', '--prepare-adoption': 'prepareAdoption' };
flags['--prepare-existing-adoption'] = 'prepareExistingAdoption';
flags['--list-adoptions'] = 'listAdoptions';
flags['--worktrees'] = 'worktrees';
flags['--resume'] = 'resume';
flags['--resume-native'] = 'resumeNative';
const single = new Set(['status', 'submit', 'push', 'doctor', 'version', 'logs', 'repair-context']);
const groups = new Set(['repos', 'runs', 'checks', 'settings', 'service', 'hosts', 'update', 'codex', 'hook', 'devices']);
export function exitCode(response: Response): number {
  if (response.result && typeof response.result['exitCode'] === 'number') return response.result['exitCode'];
  if (response.operationState === 'outcome_unknown') return 6;
  if (response.operationState === 'cancelled') return 130;
  if (response.operationState === 'needs_attention') return 4;
  if (response.operationState === 'failed' || response.operationState === 'interrupted') return 5;
  return response.error ? 3 : 0;
}
function jsonFile(path: string): ObjectValue {
  if (statSync(path).size > 1024 * 1024) throw new Fault('INPUT_TOO_LARGE', 'Configuration input exceeds one MiB.', 2);
  return object(JSON.parse(readFileSync(path, 'utf8')));
}
function render(response: Response, json: boolean): string {
  if (json) return JSON.stringify(response) + '\n';
  if (response.error) return `${response.error.code}: ${response.error.message}\n${response.operationId ? `Operation: ${response.operationId}\n` : ''}`;
  return JSON.stringify(response.result, null, 2) + '\n';
}
export async function runCommand(argv: readonly string[], write: (text: string) => void = text => process.stdout.write(text)): Promise<number> {
  let json = argv.includes('--json'), jsonl = argv.includes('--jsonl'), directory = defaultStateDirectory(), wait = false, follow = false;
  try {
    if (argv[0] === 'peer' && argv[1] === '--stdio' && argv.length === 2) {
      const chunks: Buffer[] = []; let bytes = 0;
      for await (const chunk of process.stdin) { const data = Buffer.from(chunk); bytes += data.length; if (bytes > 1024 * 1024) throw new Fault('FRAME_TOO_LARGE', 'Peer request exceeds one MiB.', 2); chunks.push(data); }
      const response = await request(directory, { schemaVersion: 1, command: 'peer.exchange', args: { envelope: object(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }, cwd: process.cwd() }, 45000);
      write(render(response, true)); return exitCode(response);
    }
    if (argv.length === 0 || argv[0] === 'help' || argv.includes('--help')) {
      const response = helpResponse();
      response.result = { commands: ['version', 'doctor', 'repos list|discover|add|create|initialize|inspect|configure|relocate|remove', 'status [--refresh]',
        'submit --repo ID --source-path PATH --source-tip OID --base OID --request-id ID [--metadata-file PATH]',
        'submit --repo ID --request-id ID --resume',
        'runs reconcile OPID', 'runs reconcile OPID --resume-native --preview',
        'runs reconcile OPID --resume-native --scope-token TOKEN --request-id UUID',
        'repos configure --repo ID --file PATH --expected-revision REV --request-id UUID', 'repos configure --repo ID --resume --request-id UUID',
        'push --repo ID --preview', 'push --repo ID --expected-tip OID --scope-token TOKEN --request-id ID [--wait]',
        'checks run --repo ID [--source-path PATH|--canonical] [--check ID]', 'runs list|get|wait|follow|cancel|pin|unpin', 'logs OPID [--tail N] [--follow]',
        'repair-context OPID', 'settings get|apply', 'service status|pause|resume|restart --when-idle', 'service storage [--worktrees] --preview', 'service storage [--worktrees] --scope-token TOKEN --request-id UUID', 'hosts list|pair --ssh-alias ALIAS', 'update check|apply --when-idle', 'codex open --repo ID',
        'repos pair --repo ID --host HOST --request-id UUID', 'repos seed|mirror --repo ID --request-id UUID',
        'repos runtime --repo ID --node PATH --pnpm PATH', 'repos migration --repo ID [--adapter ID] [--prepare-reporting|--prepare-adoption --request-id UUID]',
        'repos migration --repo ID --list-adoptions', 'repos migration --repo ID --adoption-plan ID [--review-file PATH --review-side before|after --review-offset BYTES]', 'repos migration --repo ID --apply-adoption|--activate-adoption|--rollback-adoption ID --expected-revision REV --request-id UUID',
        'repos migration --repo ID --prepare-existing-adoption --original-tip OID --migration-tip OID --request-id UUID',
        'service diagnostics [--run OPERATION] --json', 'service storage-policy [--file PATH --expected-revision REV --request-id UUID] --json', 'hosts sync --host HOST', 'repos resolve PATH --repo ID --host HOST --expected-revision REVISION',
        'service power-policy [--file PATH --expected-revision REV --request-id UUID] --json',
        'devices list|status|apps|authorize|revoke|qualify|prepare|install|launch|logs|test|ui|debug|capture|disconnect|reconcile',
        'devices profile --repo ID', 'devices configure --repo ID --file PATH --expected-revision REVISION --request-id UUID', 'devices artifacts list|get --repo ID [--artifact ID]',
        'devices evidence record --repo ID --file PATH --request-id UUID', 'devices evidence get|review --repo ID --evidence ID [--expected-revision REV --request-id UUID]',
        'devices artifacts transfer --repo ID --artifact ID --from-host SOURCE --host DESTINATION --request-id UUID',
        'devices transfer-host --repo ID --device DEVICE --from-host SOURCE --host DESTINATION --expected-revision REV --request-id UUID [--release-ref REF]'],
        waitSeconds: 30, eventPollMilliseconds: 500, json: 'One response envelope; --jsonl for runs follow.',
        unavailable: ['Live host pairing and adopted project migration need qualification.', 'Device operations require configured identity and evidence.', 'Signed updates need a configured verified feed.'] };
      write(render(response, json)); return 0;
    }
    const words: string[] = [], args: ObjectValue = {};
    for (let index = 0; index < argv.length; index++) {
      const word = argv[index]!;
      if (word === '--json' || word === '--jsonl') continue;
      if (word === '--wait') { wait = true; continue; } if (word === '--follow') { follow = true; continue; }
      if (word === '--operation') { const value = argv[++index]; if (!value || value.startsWith('--')) throw new Fault('INVALID_USAGE', 'Select an operation.', 2); args['operations'] = [...(args['operations'] as string[] ?? []), value]; continue; }
      if (word === '--state-dir' || word === '--file' || word === '--metadata-file') {
        const value = argv[++index]; if (!value || value.startsWith('--')) throw new Fault('INVALID_USAGE', `${word} needs a value.`, 2);
        if (word === '--state-dir') directory = value; else args[word === '--file' ? 'config' : 'metadata'] = jsonFile(value); continue;
      }
      const key = values[word];
      if (key) { const value = argv[++index]; if (!value || value.startsWith('--') || key in args) throw new Fault('INVALID_USAGE', `${word} needs one value.`, 2); args[key] = ['tail', 'after', 'durationSeconds', 'maxBytes', 'reviewOffset'].includes(key) ? Number(value) : value; continue; }
      const flag = flags[word]; if (flag) { if (flag in args) throw new Fault('INVALID_USAGE', `Repeated ${word}.`, 2); args[flag] = true; continue; }
      if (word.startsWith('-') && word !== '--version') throw new Fault('INVALID_USAGE', `Unknown option ${word}.`, 2);
      words.push(word === '--version' ? 'version' : word);
    }
    const group = words.shift()!; let command: string;
    if (single.has(group)) command = group;
    else if (groups.has(group)) { const action = words.shift(); if (!action) throw new Fault('INVALID_USAGE', `Specify a ${group} action.`, 2); command = `${group}.${action}`; }
    else throw new Fault('INVALID_USAGE', 'Unknown command. Use contribution help.', 2);
    if (command === 'devices.artifacts') { const action = words.shift(); if (!['list', 'get', 'transfer'].includes(action ?? '')) throw new Fault('INVALID_USAGE', 'Select devices artifacts list, get or transfer.', 2); command += `.${action}`; }
    if (command === 'devices.evidence') { const action = words.shift(); if (!['record', 'get', 'review'].includes(action ?? '')) throw new Fault('INVALID_USAGE', 'Select devices evidence record, get or review.', 2); command += `.${action}`; }
    if (['repos.add', 'repos.create', 'repos.relocate', 'repos.resolve'].includes(command)) args['path'] = words.shift();
    if (command.startsWith('runs.') && !['runs.list', 'runs.events'].includes(command) || ['logs', 'repair-context'].includes(command)) args['operationId'] = words.shift();
    if (command === 'devices.reconcile') args['operationId'] = words.shift();
    if (words.length) throw new Fault('INVALID_USAGE', 'Unexpected positional arguments.', 2);
    if (['checks.run', 'repos.create'].includes(command) && !args['requestId']) args['requestId'] = randomUUID();
    if (json && jsonl) throw new Fault('INVALID_USAGE', 'Choose --json or --jsonl.', 2);
    if (wait && command !== 'push') throw new Fault('INVALID_USAGE', '--wait is supported on push; use runs wait for other operations.', 2);
    if (follow && command !== 'logs') throw new Fault('INVALID_USAGE', '--follow is supported on logs; use runs follow for events.', 2);
    if (jsonl && command !== 'runs.follow') throw new Fault('INVALID_USAGE', '--jsonl is only supported on runs follow.', 2);
    if (['hook.pre-push', 'hook.adopted', 'hook.borrow', 'hook.release-borrow'].includes(command)) {
      args['operationId'] = process.env['CONTRIBUTION_OPERATION_ID'] ?? '';
      args['hookToken'] = process.env['CONTRIBUTION_HOOK_TOKEN'] ?? '';
      args['caller'] = callerIdentity();
    }
    if (command === 'hook.pre-push' || command === 'hook.adopted') {
      const chunks: Buffer[] = []; let bytes = 0;
      for await (const chunk of process.stdin) { const data = Buffer.from(chunk); bytes += data.length; if (bytes > 65536) throw new Fault('REF_TRANSACTION_UNSUPPORTED', 'Hook input exceeds its bound.', 2); chunks.push(data); }
      args['stdin'] = Buffer.concat(chunks).toString('utf8');
    }
    const call = (name: string, input: ObjectValue = args, timeout = 15000): Promise<Response> => request(directory, { schemaVersion: 1, command: name, args: input, cwd: process.cwd() }, timeout);
    if (command === 'hook.adopted') {
      const begun = await call('hook.adopted.begin');
      if (begun.error || !begun.result) { write(render(begun, json)); return exitCode(begun); }
      const gate = await executeAdoptedGate(begun.result);
      const response = await call('hook.adopted.finish', { repo: args['repo'], operationId: begun.result['operationId'], hookToken: begun.result['hookToken'], caller: args['caller'], gateExit: gate.exitCode, ...(begun.result['external'] ? { gateOutput: gate.output, outputTruncated: gate.truncated } : {}) });
      write(render(response, json)); return exitCode(response);
    }
    if (command === 'version') {
      let response: Response; try { response = await call(command); } catch { response = versionResponse(); }
      write(render(response, json)); return exitCode(response);
    }
    if (command === 'runs.wait' || command === 'runs.follow' || (command === 'logs' && follow)) {
      const deadline = Date.now() + 30000; let after = Number(args['after'] ?? 0), response: Response, lastText = '';
      do {
        response = await call('runs.get', { operationId: args['operationId'] });
        if (command === 'runs.follow') {
          const events = await call('runs.events', { operationId: args['operationId'], after });
          for (const event of (events.result?.['events'] ?? []) as ObjectValue[]) { after = Number(event['sequence']); write(JSON.stringify(event) + '\n'); }
        } else if (command === 'logs') {
          const logs = await call('logs', { operationId: args['operationId'], tail: args['tail'] ?? 200 }); const text = String(logs.result?.['text'] ?? '');
          if (text !== lastText) { write(text.startsWith(lastText) ? text.slice(lastText.length) : text); lastText = text; }
        }
        if (!response.operationState || terminal.has(response.operationState) || response.error) break;
        await new Promise(resolve => setTimeout(resolve, 500));
      } while (Date.now() < deadline);
      if (command === 'runs.wait') write(render(response!, json));
      return exitCode(response!);
    }
    let response = await call(command, args, command === 'hook.pre-push' ? 3600000 : 15000);
    if (wait && response.operationId && !response.error) {
      const deadline = Date.now() + 30000;
      while (response.operationState && !terminal.has(response.operationState) && !response.error && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 250)); response = await call('runs.get', { operationId: response.operationId });
      }
    }
    write(render(response, json)); return exitCode(response);
  } catch (error) { const response = rejected(error); write(render(response, json)); return exitCode(response); }
}
