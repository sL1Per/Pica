// tests/test-masterkey-envelope.mjs
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { encryptBlob, decryptBlob } from '../src/crypto/aes.js';
import { initMasterKey } from '../src/crypto/masterkey.js';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); passed++; }
  catch (e) { console.error(`FAIL ${name}\n${e.stack}`); failed++; }
}

function tmpCfg() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-mk-'));
  return { dir, configPath: path.join(dir, 'config.json') };
}
const QUIET = { info() {}, warn() {}, error() {} };

await test('first run creates a v2 config and a usable DEK', async () => {
  const { dir, configPath } = tmpCfg();
  process.env.PICA_PASSPHRASE = 'correct horse';
  const cfg = { dataDir: path.join(dir, 'data') };
  const { masterKey, mustResetPassphrase } = await initMasterKey(cfg, configPath, QUIET);
  assert.equal(masterKey.length, 32);
  assert.equal(mustResetPassphrase, false);
  const onDisk = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.equal(onDisk.security.version, 2);
  assert.ok(onDisk.security.wraps.passphrase.wrapped);
  fs.rmSync(dir, { recursive: true, force: true });
});

await test('unlock with the correct passphrase returns the same DEK', async () => {
  const { dir, configPath } = tmpCfg();
  process.env.PICA_PASSPHRASE = 'correct horse';
  const cfg = { dataDir: path.join(dir, 'data') };
  const first = await initMasterKey(cfg, configPath, QUIET);
  const reloaded = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const second = await initMasterKey(reloaded, configPath, QUIET);
  assert.deepEqual(second.masterKey, first.masterKey);
  fs.rmSync(dir, { recursive: true, force: true });
});

await test('wrong passphrase with no recovery code throws', async () => {
  const { dir, configPath } = tmpCfg();
  process.env.PICA_PASSPHRASE = 'right one';
  const cfg = { dataDir: path.join(dir, 'data') };
  await initMasterKey(cfg, configPath, QUIET);
  const reloaded = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  process.env.PICA_PASSPHRASE = 'WRONG';
  await assert.rejects(() => initMasterKey(reloaded, configPath, QUIET), /passphrase/i);
  fs.rmSync(dir, { recursive: true, force: true });
});

await test('v1 → v2 migration freezes the old key and still decrypts old data', async () => {
  const { dir, configPath } = tmpCfg();
  const { scrypt } = await import('node:crypto');
  const { promisify } = await import('node:util');
  const scryptAsync = promisify(scrypt);
  const salt = Buffer.from('a'.repeat(64), 'hex');
  const pass = 'legacy pass';
  const oldKey = await scryptAsync(pass, salt, 32,
    { cost: 1 << 17, blockSize: 8, parallelization: 1, maxmem: 512 * 1024 * 1024 });
  const verifier = encryptBlob(Buffer.from('pica-verifier-v1', 'utf8'), oldKey);
  const v1 = {
    dataDir: path.join(dir, 'data'),
    security: {
      kdf: { algorithm: 'scrypt', salt: salt.toString('hex'),
             cost: 1 << 17, blockSize: 8, parallelization: 1 },
      verifier: verifier.toString('base64'),
    },
  };
  const secret = encryptBlob(Buffer.from('payroll'), oldKey, 'employee:x');

  process.env.PICA_PASSPHRASE = pass;
  const { masterKey } = await initMasterKey(v1, configPath, QUIET);
  assert.deepEqual(masterKey, oldKey, 'DEK must equal the frozen legacy key');
  assert.equal(decryptBlob(secret, masterKey, 'employee:x').toString(), 'payroll');

  const migrated = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.equal(migrated.security.version, 2);
  assert.equal(migrated.security.verifier, undefined);
  const again = await initMasterKey(migrated, configPath, QUIET);
  assert.deepEqual(again.masterKey, oldKey);
  fs.rmSync(dir, { recursive: true, force: true });
});

await test('recover with code: unlocks DEK and flags mustResetPassphrase', async () => {
  const { dir, configPath } = tmpCfg();
  process.env.PICA_PASSPHRASE = 'orig pass';
  const cfg = { dataDir: path.join(dir, 'data') };
  const { masterKey: dek } = await initMasterKey(cfg, configPath, QUIET);

  const { deriveKek, newKdf, setSlot, writeConfigAtomic } = await import('../src/crypto/keyring.js');
  const { wrapDek, generateRecoveryCode, normalizeRecoveryCode } = await import('../src/crypto/dek.js');
  const code = generateRecoveryCode();
  const rk = newKdf();
  const recKek = await deriveKek(normalizeRecoveryCode(code), rk);
  const cfgObj = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  setSlot(cfgObj.security, 'recovery', rk, wrapDek(dek, recKek, 'recovery'),
    { createdAt: new Date().toISOString() });
  writeConfigAtomic(configPath, cfgObj);

  delete process.env.PICA_PASSPHRASE;
  process.env.PICA_RECOVERY_CODE = code;
  const reloaded = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const r = await initMasterKey(reloaded, configPath, QUIET);
  delete process.env.PICA_RECOVERY_CODE;
  assert.deepEqual(r.masterKey, dek);
  assert.equal(r.mustResetPassphrase, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

await test('PICA_RESET=1 moves data aside and re-runs first-run', async () => {
  const { dir, configPath } = tmpCfg();
  process.env.PICA_PASSPHRASE = 'first';
  const dataDir = path.join(dir, 'data');
  const cfg = { dataDir };
  await initMasterKey(cfg, configPath, QUIET);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'marker'), 'keepme');

  const reloaded = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  reloaded.dataDir = dataDir;
  process.env.PICA_RESET = '1';
  process.env.PICA_PASSPHRASE = 'brand new';
  const r = await initMasterKey(reloaded, configPath, QUIET);
  delete process.env.PICA_RESET;
  assert.equal(r.masterKey.length, 32);
  const asideDirs = fs.readdirSync(dir).filter((n) => n.startsWith('data.pre-reset-'));
  assert.equal(asideDirs.length, 1, 'old data moved aside, not deleted');
  assert.equal(fs.readFileSync(path.join(dir, asideDirs[0], 'marker'), 'utf8'), 'keepme');
  fs.rmSync(dir, { recursive: true, force: true });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
