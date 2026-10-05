import type { DeviceOperation } from '../../packages/contracts/src/generated/device-operation.js';
import type { DeviceStatus } from '../../packages/contracts/src/generated/device-status.js';

type Intent = DeviceOperation['intent'];
type Effect = DeviceOperation['effects'][number];
type Availability = NonNullable<DeviceStatus['result']>['availability'][number];

const intent: Intent = {
  operation: 'logs', app: { bundleId: 'dev.example.fixture', teamId: 'EXAMPLE123',
    applicationIdentifier: 'EXAMPLE123.dev.example.fixture', marketingVersion: '1.0', buildVersion: '1' },
  artifactRef: null, installedAppRef: null, sourceCommit: null, configurationId: null,
  adapterId: 'fixture', policyRevision: 'fixture', authorizedOperations: ['logs'],
  mode: 'routine', qualification: null,
};
const effect: Effect = {
  effectId: 'fixture', operation: 'install', state: 'outcome_unknown', certainty: 'uncertain',
  startedAt: null, completedAt: null, installReadback: null, launchReadback: null,
  evidenceRefs: [], reasonCodes: ['OUTCOME_UNCERTAIN'], missingProof: ['readback'],
};
const availability: Availability = { operation: 'install', callable: false, capabilityId: 'fixture', reasonCodes: ['UNVERIFIED'] };

// Known fields must retain useful types, not merely accept positive fixtures.
const operation: string = intent.operation;
const bundleId: string = intent.app.bundleId;
const artifact: { artifactId: string; sha256: string } | null = intent.artifactRef;
const authorizedOperation: string | undefined = intent.authorizedOperations[0];
const readback: { deviceId: string; teamId: string | null } | null = effect.installReadback;
const state: string = effect.state;
const callable: boolean = availability.callable;

// @ts-expect-error ordinary intent properties are required
const missingIntent: Intent = { operation: 'install' };
// @ts-expect-error operation is an enum, not a number
const numericIntent: Intent = { ...intent, operation: 42 };
// @ts-expect-error nested required app fields cannot disappear
const missingAppField: Intent['app'] = { bundleId: 'dev.example.fixture' };
// @ts-expect-error nested array entries are strings
const numericAuthorization: Intent = { ...intent, authorizedOperations: [42] };
// @ts-expect-error artifact nullability does not permit malformed objects
const malformedArtifact: Intent['artifactRef'] = { artifactId: 'fixture', sha256: false };
// @ts-expect-error qualification retains its required structure beside null
const malformedQualification: Intent['qualification'] = { planId: 'fixture' };
// @ts-expect-error effect fields are required and operation/state are enums
const malformedEffect: Effect = { operation: false, state: 'invented' };
// @ts-expect-error effect state rejects invented values even with all fields present
const inventedState: Effect = { ...effect, state: 'invented' };
// @ts-expect-error nullable readbacks retain their nested required fields
const malformedReadback: Effect['installReadback'] = { deviceId: 'fixture' };
// @ts-expect-error all availability fields are required and operation is an enum
const malformedAvailability: Availability = { operation: 'invented' };
// @ts-expect-error callable remains boolean
const nonBooleanAvailability: Availability = { ...availability, callable: 'yes' };
// @ts-expect-error reasonCodes remains an array of strings
const numericReason: Availability = { ...availability, reasonCodes: [42] };
// @ts-expect-error closed intent objects do not gain an additive dictionary
const extraIntentField: Intent = { ...intent, bypass: true };

void [intent, effect, availability, operation, bundleId, artifact, authorizedOperation, readback, state, callable,
  missingIntent, numericIntent, missingAppField, numericAuthorization, malformedArtifact, malformedQualification,
  malformedEffect, inventedState, malformedReadback, malformedAvailability, nonBooleanAvailability, numericReason, extraIntentField];
