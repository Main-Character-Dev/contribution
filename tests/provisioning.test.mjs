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
