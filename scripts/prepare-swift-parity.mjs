import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { example, responseNegativeCases } from '../tests/fixtures/contracts.mjs';
import { assertContract, validateContract } from '../packages/contracts/dist/index.js';
import { helpResponse, versionResponse, unavailableResponse } from '../packages/engine/dist/index.js';
const positive = ['accepted-submission','push-preview','repository-status','device-status'].map(example);
positive.push(helpResponse(), versionResponse(), unavailableResponse());
const additive = versionResponse();
additive.futureEnvelope = { enabled: true, nullable: null, list: [1, 'x', { extra: 9 }] };
additive.result.futurePayload = { count: 9007199254740991, nullable: null };
positive.push(additive);
const nullable = versionResponse(); nullable.result = null; positive.push(nullable);
for (const value of positive) assertContract('response', value);
const negative = responseNegativeCases().map(v => v.value);
for (const value of negative) assert.equal(validateContract('response', value).valid, false);
mkdirSync(new URL('../.build/', import.meta.url), { recursive: true });
for (const [name, value] of Object.entries({ 'swift-parity': { positive, negative }, version: versionResponse(), unavailable: unavailableResponse() })) {
  writeFileSync(new URL(`../.build/${name}.json`, import.meta.url), JSON.stringify(value));
}
console.log(`Prepared Swift parity: ${positive.length} positive, ${negative.length} negative envelopes and two client responses.`);
