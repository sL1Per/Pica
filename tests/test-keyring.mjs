// tests/test-keyring.mjs
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import {
  detectFormat, newKdf, deriveKek, setSlot, getSlot, removeSlot, writeConfigAtomic, KDF,
} from '../src/crypto/keyring.js';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); passed++; }
  catch (e) { console.error(`FAIL ${name}\n${e.stack}`); failed++; }
}

await test('detectFormat distinguishes none / v1 / v2', () => {
  assert.equal(detectFormat(undefined), 'none');
  assert.equal(detectFormat({}), 'none');
  assert.equal(detectFormat({ kdf: { salt: 'aa' }, verifier: 'x' }), 'v1');
  assert.equal(detectFormat({ version: 2, wraps: { passphrase: {} } }), 'v2');
});

await test('newKdf produces a fresh 64-hex-char salt and the heavy params', () => {
  const a = newKdf(), b = newKdf();
  assert.equal(a.salt.length, KDF.saltBytes * 2);
  assert.notEqual(a.salt, b.salt);
  assert.equal(a.cost, KDF.cost);
});

await test('deriveKek is deterministic for the same secret+salt', async () => {
  const kdf = newKdf();
  const k1 = await deriveKek('hunter2', kdf);
  const k2 = await deriveKek('hunter2', kdf);
  assert.equal(k1.length, 32);
  assert.deepEqual(k1, k2);
  assert.notDeepEqual(k1, await deriveKek('hunter3', kdf));
});

await test('setSlot/getSlot/removeSlot and v1 verifier drop', () => {
  const sec = { kdf: { salt: 'aa' }, verifier: 'old' };
  setSlot(sec, 'passphrase', newKdf(), 'd2Vt');
  assert.equal(sec.version, 2);
  assert.equal(sec.verifier, undefined);
  assert.ok(getSlot(sec, 'passphrase'));
  setSlot(sec, 'recovery', newKdf(), 'cmVj', { createdAt: '2026-01-01T00:00:00Z' });
  assert.equal(getSlot(sec, 'recovery').createdAt, '2026-01-01T00:00:00Z');
  removeSlot(sec, 'recovery');
  assert.equal(getSlot(sec, 'recovery'), undefined);
});

await test('writeConfigAtomic writes mode-0600 JSON and is re-readable', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-kr-'));
  const cfgPath = path.join(dir, 'config.json');
  writeConfigAtomic(cfgPath, { port: 8080, security: { version: 2 } });
  assert.equal(JSON.parse(fs.readFileSync(cfgPath, 'utf8')).port, 8080);
  assert.equal(fs.statSync(cfgPath).mode & 0o777, 0o600);
  assert.equal(fs.existsSync(cfgPath + '.tmp'), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

await test('detectFormat returns unknown for degenerate configs', () => {
  assert.equal(detectFormat({ wraps: { x: 1 } }), 'unknown'); // wraps but no version:2
  assert.equal(detectFormat({ kdf: { salt: 'aa' } }), 'unknown'); // kdf but no verifier
});

await test('deriveKek: different salt yields a different key for the same secret', async () => {
  const k1 = await deriveKek('same-secret', newKdf());
  const k2 = await deriveKek('same-secret', newKdf());
  assert.notDeepEqual(k1, k2);
});

await test('writeConfigAtomic overwrites an existing file and lands at 0600', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-kr2-'));
  const cfgPath = path.join(dir, 'config.json');
  fs.writeFileSync(cfgPath, '{"old":true}');
  fs.writeFileSync(cfgPath + '.tmp', 'stale', { mode: 0o644 }); // simulate a crash leftover
  writeConfigAtomic(cfgPath, { fresh: 1 });
  assert.deepEqual(JSON.parse(fs.readFileSync(cfgPath, 'utf8')), { fresh: 1 });
  assert.equal(fs.statSync(cfgPath).mode & 0o777, 0o600);
  assert.equal(fs.existsSync(cfgPath + '.tmp'), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
