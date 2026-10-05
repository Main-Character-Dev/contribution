import { readFileSync } from 'node:fs';
const exampleRoot = new URL('../../packages/contracts/examples/', import.meta.url);
export function example(name) { return JSON.parse(readFileSync(new URL(name + '.json', exampleRoot), 'utf8')); }
export const exampleSchemas = {
  'accepted-submission': 'response', 'artifact-provenance': 'artifact-provenance',
  'device-capability': 'device-capability', 'device-operation': 'device-operation',
  'device-operation-uncertain': 'device-operation', 'device-ownership': 'device-ownership',
  'device-status': 'device-status', 'device-test-evidence': 'device-test-evidence',
  machine: 'machine', 'push-preview': 'response', 'repository-status': 'status',
  repository: 'repository', 'run-event': 'event', 'submission-metadata': 'submission-metadata',
};
export function responseNegativeCases() {
  const base = () => example('accepted-submission');
  const cases = [];
  const add = (name, mutate) => { const value = base(); mutate(value); cases.push({ name, schema: 'response', value }); };
  add('accepted without operation', v => { v.operationId = null; v.operationState = null; });
  add('accepted with error', v => { v.error = { code: 'E', message: 'error', retryable: false, nextActions: [] }; });
  add('rejected without error', v => { v.requestStatus = 'rejected'; });
  add('missing explicit null', v => { delete v.error; });
  add('unknown schema version', v => { v.schemaVersion = 2; });
  add('unknown state', v => { v.operationState = 'pushed'; });
  add('empty operation identity', v => { v.operationId = ''; });
  add('null operation with state', v => { v.requestStatus = 'completed'; v.operationId = null; });
  add('nonobject result', v => { v.result = []; });
  add('error argv cannot be shell string', v => {
    v.requestStatus = 'rejected'; v.error = { code: 'E', message: 'error', retryable: false,
      nextActions: [{ id: 'help', label: 'Help', argv: 'contribution help' }] };
  });
  add('empty next action argv', v => {
    v.requestStatus = 'rejected'; v.error = { code: 'E', message: 'error', retryable: false,
      nextActions: [{ id: 'help', label: 'Help', argv: [] }] };
  });
  return cases;
}
export function negativeCases() {
  const cases = responseNegativeCases();
  const add = (name, fixture, schema, mutate) => { const value = example(fixture); mutate(value); cases.push({ name, schema, value }); };
  add('invalid UUID', 'repository', 'repository', v => { v.repositoryId = 'not-a-uuid'; });
  add('unknown configuration key', 'repository', 'repository', v => { v.bypassPolicy = true; });
  add('invalid date-time', 'run-event', 'event', v => { v.occurredAt = '2026-02-30T00:00:00Z'; });
  add('support without qualification', 'device-capability', 'device-capability', v => { v.support = 'supported'; });
  add('expired lease cannot permit takeover', 'device-ownership', 'device-ownership', v => { v.mutationsPermitted = true; });
  add('false composite success', 'device-operation', 'device-operation', v => { v.operationState = 'succeeded'; });
  add('install success without readback', 'device-operation', 'device-operation', v => { v.effects[0].installReadback = null; });
  add('unknown effect without reconciliation', 'device-operation-uncertain', 'device-operation', v => { v.reconciliation.status = 'not_required'; });
  add('routine cannot carry qualification', 'device-operation-uncertain', 'device-operation', v => { v.intent.mode = 'routine'; });
  add('qualification needs a plan', 'device-operation-uncertain', 'device-operation', v => { v.intent.qualification = null; });
  add('fixture cannot pass physical acceptance', 'device-test-evidence', 'device-test-evidence', v => { v.outcome = 'passed'; });
  add('unrun evidence cannot assert support', 'device-test-evidence', 'device-test-evidence', v => { v.claims = ['supported']; });
  return cases;
}
