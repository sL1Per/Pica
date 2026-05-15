// tests/test-dek.mjs
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { wrapDek, unwrapDek } from '../src/crypto/dek.js';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); passed++; }
  catch (e) { console.error(`FAIL ${name}\n${e.stack}`); failed++; }
}

await test('wrap then unwrap round-trips the DEK', () => {
  const dek = randomBytes(32);
  const kek = randomBytes(32);
  const w = wrapDek(dek, kek, 'passphrase');
  assert.equal(typeof w, 'string');
  assert.deepEqual(unwrapDek(w, kek, 'passphrase'), dek);
});

await test('wrong KEK fails the GCM tag', () => {
  const w = wrapDek(randomBytes(32), randomBytes(32), 'passphrase');
  assert.throws(() => unwrapDek(w, randomBytes(32), 'passphrase'));
});

await test('slot-bound AAD: a passphrase wrap cannot be unwrapped as recovery', () => {
  const kek = randomBytes(32);
  const w = wrapDek(randomBytes(32), kek, 'passphrase');
  assert.throws(() => unwrapDek(w, kek, 'recovery'));
});

await test('rejects non-32-byte inputs', () => {
  assert.throws(() => wrapDek(randomBytes(16), randomBytes(32), 'passphrase'));
  assert.throws(() => wrapDek(randomBytes(32), randomBytes(16), 'passphrase'));
});

await test('ciphertext tampering is detected', () => {
  const kek = randomBytes(32);
  const w = wrapDek(randomBytes(32), kek, 'passphrase');
  const blob = Buffer.from(w, 'base64');
  blob[12] ^= 0x01; // flip a bit in the first ciphertext byte
  assert.throws(() => unwrapDek(blob.toString('base64'), kek, 'passphrase'));
});

await test('unwrapDek rejects a non-32-byte kek', () => {
  const w = wrapDek(randomBytes(32), randomBytes(32), 'passphrase');
  assert.throws(() => unwrapDek(w, randomBytes(16), 'passphrase'));
});

const { generateRecoveryCode, normalizeRecoveryCode } = await import('../src/crypto/dek.js');

await test('generated code is 8 groups of 4 Crockford chars', () => {
  const code = generateRecoveryCode();
  assert.match(code, /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){7}$/);
});

await test('generated codes are unique', () => {
  assert.notEqual(generateRecoveryCode(), generateRecoveryCode());
});

await test('normalize folds case, dashes, and Crockford ambiguities', () => {
  assert.equal(normalizeRecoveryCode('abcd-efgh'), 'ABCDEFGH');
  assert.equal(normalizeRecoveryCode('o0 i1 l1'), '001111');
  assert.equal(normalizeRecoveryCode(' xxxx-xxxx '), 'XXXXXXXX');
});

await test('a generated code normalizes to a 32-char secret', () => {
  assert.equal(normalizeRecoveryCode(generateRecoveryCode()).length, 32);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
