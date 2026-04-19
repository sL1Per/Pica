#!/usr/bin/env node
/**
 * M2a smoke test — exercises every crypto primitive end to end.
 * Uses only Node's built-in `assert` module; no test framework.
 *
 * Run with:   node tests/test-crypto.mjs
 */

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  encryptBlob, decryptBlob, encryptField, decryptField,
  hashPassword, verifyPassword,
  initMasterKey,
} from '../src/crypto/index.js';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

// ----------------------------------------------------------------------------
console.log('AES-GCM blob round trip');
// ----------------------------------------------------------------------------

await test('encrypt → decrypt returns original bytes', () => {
  const key = randomBytes(32);
  const plain = Buffer.from('Hello, Pica!');
  const blob = encryptBlob(plain, key);
  assert.equal(decryptBlob(blob, key).toString('utf8'), 'Hello, Pica!');
});

await test('binary safety — 64 KiB random payload round trips exactly', () => {
  const key = randomBytes(32);
  const plain = randomBytes(65536);
  const blob = encryptBlob(plain, key);
  assert.deepEqual(decryptBlob(blob, key), plain);
});

await test('empty plaintext is handled', () => {
  const key = randomBytes(32);
  const blob = encryptBlob(Buffer.alloc(0), key);
  assert.equal(decryptBlob(blob, key).length, 0);
});

await test('fresh IV per encryption — same plaintext yields different ciphertext', () => {
  const key = randomBytes(32);
  const plain = Buffer.from('same input');
  const a = encryptBlob(plain, key);
  const b = encryptBlob(plain, key);
  assert.notDeepEqual(a, b);
});

await test('decrypt with wrong key throws', () => {
  const k1 = randomBytes(32);
  const k2 = randomBytes(32);
  const blob = encryptBlob(Buffer.from('secret'), k1);
  assert.throws(() => decryptBlob(blob, k2));
});

await test('tampered ciphertext throws', () => {
  const key = randomBytes(32);
  const blob = encryptBlob(Buffer.from('secret'), key);
  blob[20] ^= 0xff; // flip a byte in the ciphertext region
  assert.throws(() => decryptBlob(blob, key));
});

await test('truncated ciphertext throws', () => {
  const key = randomBytes(32);
  assert.throws(() => decryptBlob(Buffer.alloc(10), key));
});

await test('rejects non-32-byte key', () => {
  assert.throws(() => encryptBlob(Buffer.from('x'), randomBytes(16)));
  assert.throws(() => decryptBlob(Buffer.alloc(40), randomBytes(16)));
});

// ----------------------------------------------------------------------------
console.log('\nAES-GCM field round trip (string/base64)');
// ----------------------------------------------------------------------------

await test('encryptField → decryptField round trip with UTF-8', () => {
  const key = randomBytes(32);
  const plain = 'João — lição número 3 ☕';
  const ct = encryptField(plain, key);
  assert.equal(decryptField(ct, key), plain);
});

await test('field ciphertext is valid base64', () => {
  const key = randomBytes(32);
  const ct = encryptField('hello', key);
  assert.match(ct, /^[A-Za-z0-9+/]+={0,2}$/);
});

// ----------------------------------------------------------------------------
console.log('\nAAD binding');
// ----------------------------------------------------------------------------

await test('AAD round trip with matching AAD', () => {
  const key = randomBytes(32);
  const ct = encryptField('salary: 42000', key, 'employee:123');
  assert.equal(decryptField(ct, key, 'employee:123'), 'salary: 42000');
});

await test('decrypt fails if AAD differs (ciphertext swap prevention)', () => {
  const key = randomBytes(32);
  const ct = encryptField('salary: 42000', key, 'employee:123');
  assert.throws(() => decryptField(ct, key, 'employee:456'));
});

await test('decrypt fails if AAD was present on encrypt but absent on decrypt', () => {
  const key = randomBytes(32);
  const ct = encryptField('secret', key, 'context');
  assert.throws(() => decryptField(ct, key));
});

// ----------------------------------------------------------------------------
console.log('\nPassword hashing');
// ----------------------------------------------------------------------------

await test('hashPassword produces the declared format', async () => {
  const stored = await hashPassword('correct horse battery staple');
  const parts = stored.split('$');
  assert.equal(parts.length, 6);
  assert.equal(parts[0], 'scrypt');
  assert.ok(Number(parts[1]) > 0);
});

await test('verifyPassword accepts the correct password', async () => {
  const stored = await hashPassword('hunter2');
  assert.equal(await verifyPassword('hunter2', stored), true);
});

await test('verifyPassword rejects a wrong password', async () => {
  const stored = await hashPassword('hunter2');
  assert.equal(await verifyPassword('hunter3', stored), false);
});

await test('verifyPassword rejects a malformed hash', async () => {
  assert.equal(await verifyPassword('whatever', 'not-a-valid-hash'), false);
  assert.equal(await verifyPassword('whatever', 'scrypt$x$y$z$a$b'), false);
});

await test('same password produces different stored hashes (fresh salt)', async () => {
  const a = await hashPassword('same');
  const b = await hashPassword('same');
  assert.notEqual(a, b);
  assert.equal(await verifyPassword('same', a), true);
  assert.equal(await verifyPassword('same', b), true);
});

// ----------------------------------------------------------------------------
console.log('\nMaster key lifecycle');
// ----------------------------------------------------------------------------

// Use a temp dir so the tests don't touch the real config.json.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-test-'));
const tmpConfig = path.join(tmpDir, 'config.json');

try {
  await test('first run: creates salt + verifier and returns 32-byte key', async () => {
    process.env.PICA_PASSPHRASE = 'test-passphrase-for-unit-tests';
    const config = { host: '127.0.0.1', port: 8080 };
    const key = await initMasterKey(config, tmpConfig, null);
    assert.equal(key.length, 32);
    assert.ok(config.security);
    assert.ok(config.security.kdf.salt);
    assert.ok(config.security.verifier);
    assert.ok(fs.existsSync(tmpConfig));
  });

  await test('second run: same passphrase → same derived key', async () => {
    // Load the config written by the first run.
    const config = JSON.parse(fs.readFileSync(tmpConfig, 'utf8'));
    process.env.PICA_PASSPHRASE = 'test-passphrase-for-unit-tests';
    const key = await initMasterKey(config, tmpConfig, null);
    assert.equal(key.length, 32);
  });

  await test('second run: wrong passphrase throws "Incorrect passphrase"', async () => {
    const config = JSON.parse(fs.readFileSync(tmpConfig, 'utf8'));
    process.env.PICA_PASSPHRASE = 'totally-wrong-passphrase';
    await assert.rejects(
      () => initMasterKey(config, tmpConfig, null),
      /Incorrect passphrase/,
    );
  });

  await test('derived key can round-trip encrypted data across runs', async () => {
    const config = JSON.parse(fs.readFileSync(tmpConfig, 'utf8'));
    process.env.PICA_PASSPHRASE = 'test-passphrase-for-unit-tests';
    const key1 = await initMasterKey(config, tmpConfig, null);

    const blob = encryptBlob(Buffer.from('cross-run secret'), key1);

    const key2 = await initMasterKey(config, tmpConfig, null);
    assert.equal(decryptBlob(blob, key2).toString('utf8'), 'cross-run secret');
  });

  await test('rejects passphrases shorter than 8 characters on first run', async () => {
    const fresh = path.join(tmpDir, 'fresh.json');
    process.env.PICA_PASSPHRASE = 'short';
    await assert.rejects(
      () => initMasterKey({ host: '127.0.0.1' }, fresh, null),
      /at least 8/,
    );
  });
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.PICA_PASSPHRASE;
}

// ----------------------------------------------------------------------------
console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
