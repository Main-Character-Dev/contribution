import test from 'node:test';
import assert from 'node:assert/strict';
import { provisioningIdentity } from '../packages/engine/dist/device-coredevice.js';

test('native provisioning extraction handles actual plist date and certificate data types', async () => {
  const xml = '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>ExpirationDate</key><date>2030-10-05T12:00:00Z</date><key>CreationDate</key><date>2026-10-05T12:00:00Z</date><key>DeveloperCertificates</key><array><data>AQIDBA==</data></array><key>ProvisionedDevices</key><array><string>fixture-phone</string></array><key>TeamIdentifier</key><array><string>FIXTURETEAM</string></array></dict></plist>';
  const result = await provisioningIdentity(Buffer.from(xml));
  assert.equal(Date.parse(result.expiration), Date.parse('2030-10-05T12:00:00Z'));
  assert.deepEqual(result.devices, ['fixture-phone']); assert.deepEqual(result.teams, ['FIXTURETEAM']);
  await assert.rejects(provisioningIdentity(Buffer.from(xml.replace('<date>2030-10-05T12:00:00Z</date>', '<string>2030-10-05T12:00:00Z</string>'))), error => error.code === 'PROVISIONING_INVALID');
});


test('signed entitlements must be covered by the verified provisioning profile', async () => {
  const { entitlementsCovered } = await import('../packages/engine/dist/device-artifacts.js');
  const profile = { 'application-identifier': 'PREFIX1234.*', 'keychain-access-groups': ['PREFIX1234.*'], 'get-task-allow': false };
  assert.equal(entitlementsCovered({ 'application-identifier': 'PREFIX1234.dev.example.app', 'keychain-access-groups': ['PREFIX1234.dev.example.app'], 'get-task-allow': false }, profile), true);
  for (const request of [ { 'application-identifier': 'OTHER12345.dev.example.app' }, { 'keychain-access-groups': ['OTHER12345.secret'] }, { 'get-task-allow': true }, { 'aps-environment': 'production' } ])
    assert.equal(entitlementsCovered(request, profile), false);
  assert.equal(entitlementsCovered('PREFIX1234.dev.example', '*example'), false);
});
