import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LegacyLandingFlight } from '../packages/engine/dist/legacy-flight.js';

test('compatible landing flights serialize FIFO and distinguish exact joins from requirements conflicts', () => {
  const root = mkdtempSync(join(tmpdir(), 'ct-flight-'));
  try {
    const first = new LegacyLandingFlight(root, 'a'.repeat(40)); assert.equal(first.tryAcquire().status, 'acquired');
    const joiner = new LegacyLandingFlight(root, 'a'.repeat(40)); assert.equal(joiner.tryAcquire().status, 'joining');
    assert.equal(joiner.release(), false); assert.equal(first.tryAcquire().status, 'acquired');
    const conflict = new LegacyLandingFlight(root, 'a'.repeat(40), 'b'.repeat(64)); assert.equal(conflict.tryAcquire().status, 'conflict');
    const second = new LegacyLandingFlight(root, 'b'.repeat(40));
    assert.equal(second.tryAcquire().reason, 'another_candidate_active');
    assert.equal(first.release(), true); assert.equal(second.tryAcquire().status, 'acquired'); assert.equal(second.release(), true);
  } finally { rmSync(root, { recursive: true }); }
});

test('unknown active/coordinator/queue owners are preserved and matching release cannot remove changed ownership', () => {
  const root = mkdtempSync(join(tmpdir(), 'ct-flight-retain-'));
  try {
    const flight = new LegacyLandingFlight(root, 'a'.repeat(40));
    const coordinator = join(flight.root, 'coordinator.lock'); mkdirSync(coordinator); writeFileSync(join(coordinator, 'owner.json'), '{}');
    assert.equal(flight.tryAcquire().reason, 'coordinator_owned_or_unresolved'); assert.equal(readFileSync(join(coordinator, 'owner.json'), 'utf8'), '{}');
    rmSync(coordinator, { recursive: true });
    const queue = join(flight.root, 'queue', '0000000000000-unknown.json'); writeFileSync(queue, '{}');
    assert.equal(flight.tryAcquire().reason, 'earlier_request_retained'); assert.equal(readFileSync(queue, 'utf8'), '{}');
    rmSync(queue); const active = join(flight.root, 'active'); mkdirSync(active); writeFileSync(join(active, 'owner.json'), '{}');
    assert.equal(flight.tryAcquire().reason, 'retained_owner_requires_reconciliation');
    rmSync(active, { recursive: true }); assert.equal(flight.tryAcquire().status, 'acquired');
    writeFileSync(join(active, 'owner.json'), JSON.stringify({ ...flight.request, token: 'foreign' }));
    assert.equal(flight.release(), false); assert.equal(existsSync(active), true);
  } finally { rmSync(root, { recursive: true }); }
});
