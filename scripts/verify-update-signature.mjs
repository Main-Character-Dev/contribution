import { readFileSync } from 'node:fs';
import { createPublicKey, verify } from 'node:crypto';
import assert from 'node:assert/strict';
const [archive, publicKey, signature] = process.argv.slice(2);
const bytes = Buffer.from(publicKey, 'base64'), signed = Buffer.from(signature, 'base64');
assert.equal(bytes.length, 32); assert.equal(signed.length, 64);
const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), bytes]), format: 'der', type: 'spki' });
assert(verify(null, readFileSync(archive), key, signed), 'The archive signature does not match the public update key embedded in the app');
console.log('The archive matches the embedded public update key.');
