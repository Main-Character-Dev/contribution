import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Journal } from '../packages/engine/dist/journal.js';
import { Engine } from '../packages/engine/dist/service.js';
import { repository, fixture } from './integration/service.mjs';

async function setup() {
  const root = mkdtempSync(join(tmpdir(), 'ct-diagnostics-')), store = new Journal(join(root, 'state'));
  const engine = new Engine(store, { identity: 'private-payload-identity', node: process.execPath, cli: 'private-cli-path' });
  const repo = await engine.repos.add(repository(root));
  return { root, store, engine, repo, call: args => engine.dispatch({ schemaVersion: 1, command: 'service.diagnostics', args, cwd: root }),
    close: () => { store.close(); rmSync(root, { recursive: true }); } };
}

test('general diagnostics select known fields and never export arbitrary private strings or stable identities', async () => {
  const f = await setup(); try {
    const secret = 'SENSITIVE_SENTINEL_ssh_token_bundle_app_user_data';
    f.store.setMeta('settings', { label: secret, remoteDevices: { enabled: true }, projectRoots: [secret], retention: { maxLogBytes: 2000000, rawLogDays: 30, summaryDays: 365 } });
    f.engine.repos.save({ ...f.repo, config: { ...f.repo.config, name: secret } });
    let op = f.store.admit(randomUUID(), 'device', f.repo.id, { token: secret, url: 'https://private.example.invalid', sourcePath: f.root }, secret);
    op = f.store.update(op, { state: 'outcome_unknown', stage: secret, error: { code: secret, message: secret, retryable: false, nextActions: [] }, result: {
      diagnostics: secret, process: { argv: [secret] }, completedAt: secret,
      deviceOperation: { recordMode: 'fixture', deviceId: secret, resultCertainty: 'uncertain', context: { network: secret }, intent: { operation: 'install', app: { bundleId: secret } },
        reconciliation: { status: 'blocked', reason: secret }, effects: [{ operation: 'install', state: 'outcome_unknown', certainty: 'uncertain', installReadback: { appData: secret }, reasonCodes: [secret] }] }
    } });
    writeFileSync(f.store.logPath(op), secret);
    f.store.put('deviceEvidence', secret, { pairingKey: secret, screenshot: secret });
    const response = await f.call({ operationId: op.operationId }); assert.equal(response.error, null);
    const report = response.result.diagnostics, text = JSON.stringify(report);
    for (const value of [secret, f.root, f.repo.id, f.store.hostId, op.requestId, op.operationId, op.attemptId, 'https://private.example.invalid']) assert(!text.includes(value), value);
    assert.equal(report.operations[0].state, 'outcome_unknown'); assert.equal(report.operations[0].device.recordMode, 'fixture');
    assert.equal(report.operations[0].device.effects[0].state, 'outcome_unknown'); assert.equal(report.operations[0].device.certainty, 'uncertain'); assert.equal(report.operations[0].completedAt, null);
    assert.equal(report.operations[0].project, report.repositories[0].project); assert.equal(f.store.get(op.operationId).stage, secret);
    assert.equal(report.storage.accounting, 'raw_logs_only'); assert.equal(report.history.includedOperations, 1);
  } finally { f.close(); }
});

test('diagnostics preserve inactive versus passed and explain bounded history without remote or device probes', async () => {
  const f = await setup(); try {
    f.store.setMeta('maintenance', true);
    for (let index = 0; index < 202; index++) {
      const op = f.store.admit(randomUUID(), 'push', f.repo.id, {}, 'fixture');
      f.store.update(op, { state: 'succeeded', result: { gate: { state: index % 2 ? 'inactive' : 'passed' }, delivery: 'delivered' } });
    }
    f.engine.devices.backend.inventory = () => { throw new Error('must not probe devices'); };
    const response = await f.call({}); assert.equal(response.error, null); const report = response.result.diagnostics;
    assert.equal(report.history.retainedOperations, 202); assert.equal(report.history.includedOperations, 200); assert.equal(report.history.truncated, true);
    assert.equal(report.operations[0].delivery, 'delivered'); assert.equal(report.operations[0].gate, 'inactive'); assert.equal(report.operations[1].gate, 'passed'); assert.equal(report.service.maintenance, true);
    assert.equal((await f.call({ operationId: randomUUID() })).error.code, 'RUN_NOT_FOUND');
    assert.equal((await f.call({ includeRawLogs: true })).error.code, 'INVALID_USAGE');
  } finally { f.close(); }
});

test('installed CLI reads the same redacted diagnostic projection without writing an export automatically', async () => {
  const f = await fixture(); try {
    const cli = f.cli(['service', 'diagnostics']); assert.equal(cli.status, 0, cli.stderr);
    const report = JSON.parse(cli.stdout).result.diagnostics; assert.equal(report.privacy, 'allowlisted_summary'); assert.equal(report.scope, 'local_service');
    assert(!JSON.stringify(report).includes(f.state));
  } finally { await f.cleanup(); }
});
