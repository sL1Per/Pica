// tests/test-mail-config-store.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { encryptBlob } from '../src/crypto/aes.js';

import { createMailConfigStore } from '../src/storage/mail-config.js';

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL ${name}\n       ${e.message}`);
    failed++;
  }
}

const MASTER_KEY = Buffer.alloc(32, 7);
const SAFE_DEFAULT = {
  enabled: false, host: '', port: 465, secure: true,
  user: '', pass: '', from: '',
};

// Each group gets its own temp dir so stores are isolated.
function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pica-mailcfg-'));
}
function configIn(dir) {
  return path.join(dir, 'config.json');
}
function writeConfig(configPath, obj) {
  fs.writeFileSync(configPath, JSON.stringify(obj, null, 2) + '\n', { mode: 0o600 });
}

// ─────────────────────────────────────────────────────────────────────────────
// Group 1 — absent mail key → safe defaults
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n1 — absent mail key → safe defaults');
{
  const dir = tmpDir();
  try {
    const configPath = configIn(dir);
    writeConfig(configPath, { dataDir: dir }); // no mail key

    await test('read() returns the safe disabled default', () => {
      const store = createMailConfigStore(configPath, MASTER_KEY);
      assert.deepEqual(store.read(), SAFE_DEFAULT);
    });

    await test('isConfigured() is false', () => {
      const store = createMailConfigStore(configPath, MASTER_KEY);
      assert.equal(store.isConfigured(), false);
    });

    await test('publicView() returns disabled shape with hasPassword:false', () => {
      const store = createMailConfigStore(configPath, MASTER_KEY);
      const pv = store.publicView();
      assert.deepEqual(pv, {
        enabled: false, host: '', port: 465, secure: true,
        user: '', from: '', hasPassword: false,
      });
      assert.ok(!('pass' in pv), 'publicView must NOT have a pass key');
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Group 2 — write + fresh-instance round-trip, on-disk opaque
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n2 — write + round-trip + on-disk opacity');
{
  const dir = tmpDir();
  try {
    const configPath = configIn(dir);
    writeConfig(configPath, { dataDir: dir });

    const store1 = createMailConfigStore(configPath, MASTER_KEY);
    store1.write({
      enabled: true, host: 'h', port: 587, secure: false,
      user: 'u', pass: 'S3cret!', from: 'F <f@x>',
    });

    // Fresh instance forces a decrypt-on-construct from disk.
    const store2 = createMailConfigStore(configPath, MASTER_KEY);

    await test('read() round-trips all fields', () => {
      const r = store2.read();
      assert.equal(r.enabled, true);
      assert.equal(r.host, 'h');
      assert.equal(r.port, 587);
      assert.equal(r.secure, false);
      assert.equal(r.user, 'u');
      assert.equal(r.pass, 'S3cret!');
      assert.equal(r.from, 'F <f@x>');
    });

    await test('isConfigured() is true', () => {
      assert.equal(store2.isConfigured(), true);
    });

    await test('on-disk mail has only {enc} — no plaintext keys', () => {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const m = raw.mail;
      assert.ok(m && typeof m === 'object', 'mail is an object');
      assert.ok(typeof m.enc === 'string' && m.enc.length > 0, 'mail.enc is a non-empty string');
      const keys = Object.keys(m);
      assert.deepEqual(keys, ['enc'], 'mail object has ONLY the enc key');
    });

    await test('plaintext password is NOT present anywhere in the file', () => {
      const raw = fs.readFileSync(configPath, 'utf8');
      assert.ok(!raw.includes('S3cret!'), 'S3cret! must not appear in the config file');
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Group 3 — pass write-only semantics
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n3 — pass write-only semantics');
{
  const dir = tmpDir();
  try {
    const configPath = configIn(dir);
    writeConfig(configPath, { dataDir: dir });

    const store = createMailConfigStore(configPath, MASTER_KEY);
    store.write({
      enabled: true, host: 'h', port: 587, secure: false,
      user: 'u', pass: 'S3cret!', from: 'F <f@x>',
    });

    await test('write without pass keeps existing pass, updates host', () => {
      store.write({ enabled: true, host: 'h2', port: 587, secure: false, user: 'u', from: 'F <f@x>' });
      const r = store.read();
      assert.equal(r.pass, 'S3cret!', 'pass must be preserved when absent from patch');
      assert.equal(r.host, 'h2');
    });

    await test('write with pass="" keeps existing pass', () => {
      store.write({ enabled: true, host: 'h2', port: 587, secure: false, user: 'u', from: 'F <f@x>', pass: '' });
      const r = store.read();
      assert.equal(r.pass, 'S3cret!', 'empty string must not replace stored pass');
    });

    await test('write with pass="New1" replaces the stored pass', () => {
      store.write({ enabled: true, host: 'h2', port: 587, secure: false, user: 'u', from: 'F <f@x>', pass: 'New1' });
      const r = store.read();
      assert.equal(r.pass, 'New1');
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Group 4 — publicView never has pass
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n4 — publicView');
{
  const dir = tmpDir();
  try {
    const configPath = configIn(dir);
    writeConfig(configPath, { dataDir: dir });

    const store = createMailConfigStore(configPath, MASTER_KEY);
    store.write({
      enabled: true, host: 'smtp.x.io', port: 587, secure: false,
      user: 'me', pass: 'hunter2', from: 'Me <me@x.io>',
    });

    await test('publicView has hasPassword:true and NO pass key', () => {
      const pv = store.publicView();
      assert.equal(pv.hasPassword, true);
      assert.ok(!('pass' in pv), 'publicView must NEVER contain a pass key');
    });

    await test('publicView contains expected fields only', () => {
      const pv = store.publicView();
      const keys = new Set(Object.keys(pv));
      for (const k of ['enabled', 'host', 'port', 'secure', 'user', 'from', 'hasPassword']) {
        assert.ok(keys.has(k), `publicView must have key: ${k}`);
      }
      assert.equal(keys.size, 7, 'publicView has exactly 7 keys');
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Group 5 — never-throws on bad-blob paths
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n5 — never-throws on all bad-blob paths');
{
  // Helper: construct must not throw; read() must return safe default.
  async function assertSafeDefault(label, configPath) {
    await test(`${label}: does not throw on construct`, () => {
      // createMailConfigStore must not throw
      const store = createMailConfigStore(configPath, MASTER_KEY);
      assert.deepEqual(store.read(), SAFE_DEFAULT);
    });
    await test(`${label}: isConfigured() is false`, () => {
      const store = createMailConfigStore(configPath, MASTER_KEY);
      assert.equal(store.isConfigured(), false);
    });
  }

  // 5a — non-object mail value: "mail": "x"
  {
    const dir = tmpDir();
    try {
      const configPath = configIn(dir);
      writeConfig(configPath, { mail: 'x' });
      await assertSafeDefault('non-object mail', configPath);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  // 5b — mail.enc is not valid base64 / nonsense string
  {
    const dir = tmpDir();
    try {
      const configPath = configIn(dir);
      writeConfig(configPath, { mail: { enc: 'not-base64-…!!' } });
      await assertSafeDefault('invalid base64 enc', configPath);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  // 5c — valid base64 but random garbage bytes (wrong key → decrypt throws)
  {
    const dir = tmpDir();
    try {
      const configPath = configIn(dir);
      // Valid base64 of 64 random bytes — looks like a real blob but isn't encrypted with MASTER_KEY.
      const garbage = Buffer.alloc(64, 0xde).toString('base64');
      writeConfig(configPath, { mail: { enc: garbage } });
      await assertSafeDefault('garbage ciphertext (bad key)', configPath);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  // 5d — mail: {} (no enc key at all)
  {
    const dir = tmpDir();
    try {
      const configPath = configIn(dir);
      writeConfig(configPath, { mail: {} });
      await assertSafeDefault('mail:{} no enc', configPath);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  // 5e — wrong AAD: encrypted with a different AAD, placed in config
  {
    const dir = tmpDir();
    try {
      const configPath = configIn(dir);
      const wrongAadBlob = encryptBlob(
        Buffer.from(JSON.stringify({ enabled: false }), 'utf8'),
        MASTER_KEY,
        'pica-mail-config-WRONG-aad',
      );
      writeConfig(configPath, { mail: { enc: wrongAadBlob.toString('base64') } });
      await assertSafeDefault('blob encrypted with wrong AAD', configPath);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Group 6 — normalize: write coercion rules
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n6 — normalize coercions');
{
  const dir = tmpDir();
  try {
    const configPath = configIn(dir);
    writeConfig(configPath, { dataDir: dir });
    const store = createMailConfigStore(configPath, MASTER_KEY);

    await test('enabled:"yes" (truthy non-boolean) normalizes to false', () => {
      store.write({ enabled: 'yes' });
      assert.equal(store.read().enabled, false);
    });

    await test('enabled:true normalizes to true', () => {
      store.write({ enabled: true });
      assert.equal(store.read().enabled, true);
    });

    await test('enabled:1 (number) normalizes to false', () => {
      store.write({ enabled: 1 });
      assert.equal(store.read().enabled, false);
    });

    await test('host is trimmed', () => {
      store.write({ host: '  smtp.example.com  ' });
      assert.equal(store.read().host, 'smtp.example.com');
    });

    await test('from is trimmed', () => {
      store.write({ from: '  Foo <foo@bar.com>  ' });
      assert.equal(store.read().from, 'Foo <foo@bar.com>');
    });

    await test('port: non-integer defaults to 465', () => {
      store.write({ port: 'abc' });
      assert.equal(store.read().port, 465);
    });

    await test('port: float (587.5) defaults to 465 (not an integer)', () => {
      store.write({ port: 587.5 });
      assert.equal(store.read().port, 465);
    });

    await test('port: integer 587 round-trips', () => {
      store.write({ port: 587 });
      assert.equal(store.read().port, 587);
    });

    await test('secure: false stays false', () => {
      store.write({ secure: false });
      assert.equal(store.read().secure, false);
    });

    await test('secure: undefined → true (default)', () => {
      store.write({});
      assert.equal(store.read().secure, true);
    });

    await test('write(null) is treated as empty patch, no throw', () => {
      // Should not throw; cache stays consistent.
      assert.doesNotThrow(() => store.write(null));
    });

    await test('constructor rejects non-32-byte masterKey', () => {
      assert.throws(
        () => createMailConfigStore(configPath, Buffer.alloc(16, 1)),
        /32-byte/,
      );
    });

  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Group 7 — write() aborts on unreadable/corrupt config (clobber-prevention lock)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n7 — write() aborts when config.json is unreadable/corrupt');
{
  // Shared fixture: config.json has OTHER keys that MUST survive a write().
  const OTHER_CONFIG = {
    dataDir: 'x',
    security: { wraps: ['W'] },
    port: 3000,
  };
  const MAIL_PATCH = { enabled: true, host: 'h', user: 'u', pass: 'P', from: 'f@x' };

  // 7a — happy-path first: write succeeds and preserves all other keys
  {
    const dir = tmpDir();
    try {
      const configPath = configIn(dir);
      writeConfig(configPath, { ...OTHER_CONFIG });
      const store = createMailConfigStore(configPath, MASTER_KEY);

      store.write(MAIL_PATCH);

      await test('successful write preserves pre-existing other keys (security.wraps, dataDir, port)', () => {
        const ondisk = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        assert.equal(ondisk.security?.wraps?.[0], 'W', 'security.wraps[0] must survive write');
        assert.equal(ondisk.dataDir, 'x', 'dataDir must survive write');
        assert.equal(ondisk.port, 3000, 'port must survive write');
        assert.ok(typeof ondisk.mail?.enc === 'string' && ondisk.mail.enc.length > 0, 'mail.enc written');
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  // 7b — corrupt config on disk after first successful write: write must throw and NOT clobber
  {
    const dir = tmpDir();
    try {
      const configPath = configIn(dir);
      writeConfig(configPath, { ...OTHER_CONFIG });
      const store = createMailConfigStore(configPath, MASTER_KEY);

      // First write succeeds — establishes a good in-memory cache.
      store.write(MAIL_PATCH);
      const afterFirst = store.read();

      // Now corrupt the on-disk config to simulate an I/O hiccup / mid-rename race.
      const CORRUPT = '{ not json';
      fs.writeFileSync(configPath, CORRUPT, 'utf8');

      await test('write() throws when config.json is corrupt (cannot parse)', () => {
        assert.throws(
          () => store.write({ enabled: true, host: 'h2', user: 'u', pass: 'P', from: 'f@x' }),
          'write() must throw when loadRawConfig fails',
        );
      });

      await test('config.json is NOT overwritten with {mail} after a failed read', () => {
        const ondisk = fs.readFileSync(configPath, 'utf8');
        assert.equal(ondisk, CORRUPT, 'config.json must be byte-unchanged after write abort');
      });

      await test('in-memory cache is unchanged after an aborted write', () => {
        // store.read() still returns the prior good values — cache not updated on failure.
        const r = store.read();
        assert.equal(r.host, afterFirst.host, 'cache.host must not change after aborted write');
        assert.equal(r.enabled, afterFirst.enabled, 'cache.enabled must not change after aborted write');
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Group 8 — write(null) state after clearing
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n8 — write(null) yields normalized defaults');
{
  const dir = tmpDir();
  try {
    const configPath = configIn(dir);
    writeConfig(configPath, { dataDir: dir });
    const store = createMailConfigStore(configPath, MASTER_KEY);

    // First set some values so we know null actually resets.
    store.write({ enabled: true, host: 'smtp.x', port: 587, secure: false, user: 'u', pass: 'P', from: 'f@x' });

    await test('write(null) does not throw', () => {
      assert.doesNotThrow(() => store.write(null));
    });

    await test('after write(null), read() equals normalized defaults (enabled false, port 465, secure true, empty strings)', () => {
      const r = store.read();
      // pass is preserved (no-op empty pass), but enabled/host/etc reset via normalize({pass:cache.pass})
      // null patch → incoming={} → resolvedPass = cache.pass (preserved); normalize rest from empty
      assert.equal(r.enabled, false, 'enabled reset to false');
      assert.equal(r.host, '', 'host reset to empty');
      assert.equal(r.port, 465, 'port reset to 465');
      assert.equal(r.secure, true, 'secure reset to true');
      assert.equal(r.user, '', 'user reset to empty');
      assert.equal(r.from, '', 'from reset to empty');
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────
console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
