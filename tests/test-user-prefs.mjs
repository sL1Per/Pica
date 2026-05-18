#!/usr/bin/env node
/**
 * M7 tests — user-prefs storage.
 * Built-in `assert` only.
 *
 * Run:  node tests/test-user-prefs.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createUserPrefsStore,
  VALID_LOCALES,
  VALID_COLOR_MODES,
  DEFAULT_PREFS,
} from '../src/storage/user-prefs.js';

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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-userprefs-'));

try {
  const store = createUserPrefsStore(tmpDir);
  const aliceId = 'alice-uuid';
  const bobId   = 'bob-uuid';

  // ---------------------------------------------------------------------------
  console.log('Defaults + get');
  // ---------------------------------------------------------------------------

  await test('exposes the set of valid locales and color modes', () => {
    assert.deepEqual([...VALID_LOCALES], ['en-US', 'pt-PT']);
    assert.deepEqual([...VALID_COLOR_MODES], ['light', 'dark', 'system']);
  });

  await test('get() returns DEFAULT_PREFS for an unknown user', () => {
    const p = store.get('never-existed');
    assert.deepEqual(p, DEFAULT_PREFS);
    assert.equal(p.locale, 'en-US');
    assert.equal(p.colorMode, 'system');
  });

  await test('file is not created until first write', () => {
    assert.equal(fs.existsSync(store.path), false);
  });

  // ---------------------------------------------------------------------------
  console.log('\nUpdate + persistence');
  // ---------------------------------------------------------------------------

  await test('update() persists a partial patch', () => {
    const p = store.update(aliceId, { colorMode: 'dark' });
    assert.equal(p.colorMode, 'dark');
    assert.equal(p.locale, 'en-US'); // default merged in
  });

  await test('file on disk is valid JSON keyed by user id', () => {
    const raw = fs.readFileSync(store.path, 'utf8');
    const parsed = JSON.parse(raw);
    assert.ok(parsed.prefs[aliceId]);
    assert.equal(parsed.prefs[aliceId].colorMode, 'dark');
  });

  await test('file has restrictive permissions (mode 0600)', () => {
    const stat = fs.statSync(store.path);
    // On some filesystems, mode bits beyond 0777 are irrelevant — mask to match.
    assert.equal(stat.mode & 0o777, 0o600);
  });

  await test('update() is additive — later patch preserves earlier keys', () => {
    store.update(aliceId, { locale: 'pt-PT' });
    const p = store.get(aliceId);
    assert.equal(p.locale, 'pt-PT');
    assert.equal(p.colorMode, 'dark'); // preserved
  });

  await test('second store instance reads the same data', () => {
    const s2 = createUserPrefsStore(tmpDir);
    const p = s2.get(aliceId);
    assert.equal(p.locale, 'pt-PT');
    assert.equal(p.colorMode, 'dark');
  });

  await test('one user\'s prefs do not leak into another\'s', () => {
    store.update(bobId, { colorMode: 'light' });
    const alice = store.get(aliceId);
    const bob = store.get(bobId);
    assert.equal(alice.colorMode, 'dark');
    assert.equal(bob.colorMode, 'light');
    assert.equal(bob.locale, 'en-US'); // default, not alice's 'pt'
  });

  // ---------------------------------------------------------------------------
  console.log('\nValidation');
  // ---------------------------------------------------------------------------

  await test('rejects invalid locale', () => {
    assert.throws(() => store.update(aliceId, { locale: 'klingon' }), /locale/);
  });

  await test('rejects invalid colorMode', () => {
    assert.throws(() => store.update(aliceId, { colorMode: 'neon' }), /colorMode/);
  });

  await test('rejects update with no userId', () => {
    assert.throws(() => store.update('', { locale: 'en-US' }), /userId/);
  });

  await test('unknown patch keys are silently dropped', () => {
    store.update(aliceId, { nickname: 'Al', evil: true });
    const p = store.get(aliceId);
    assert.equal(p.nickname, undefined);
    assert.equal(p.evil, undefined);
  });

  // ---------------------------------------------------------------------------
  // Backward-compat: legacy `language` field migration
  // ---------------------------------------------------------------------------

  await test('legacy language="en" reads back as locale="en-US"', () => {
    // Simulate a pre-0.15 stored prefs file by writing the raw JSON.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-prefs-legacy-'));
    try {
      const filePath = path.join(dir, 'user-prefs.json');
      fs.writeFileSync(filePath, JSON.stringify({
        prefs: { 'old-user': { language: 'en', colorMode: 'dark' } },
      }));
      const s = createUserPrefsStore(dir);
      const p = s.get('old-user');
      assert.equal(p.locale, 'en-US');
      assert.equal(p.colorMode, 'dark');
      // The legacy field itself is stripped from the read result.
      assert.equal(p.language, undefined);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('legacy language="pt" reads back as locale="pt-PT"', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-prefs-legacy2-'));
    try {
      const filePath = path.join(dir, 'user-prefs.json');
      fs.writeFileSync(filePath, JSON.stringify({
        prefs: { 'old-user': { language: 'pt' } },
      }));
      const s = createUserPrefsStore(dir);
      assert.equal(s.get('old-user').locale, 'pt-PT');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('writing locale strips the stale language field on disk', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-prefs-legacy3-'));
    try {
      const filePath = path.join(dir, 'user-prefs.json');
      fs.writeFileSync(filePath, JSON.stringify({
        prefs: { 'old-user': { language: 'en' } },
      }));
      const s = createUserPrefsStore(dir);
      s.update('old-user', { locale: 'pt-PT' });
      const written = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      assert.equal(written.prefs['old-user'].locale, 'pt-PT');
      assert.equal(written.prefs['old-user'].language, undefined);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // ---------------------------------------------------------------------------
  console.log('\nRemoveUser');
  // ---------------------------------------------------------------------------

  await test('removeUser() returns true when user had prefs', () => {
    const removed = store.removeUser(bobId);
    assert.equal(removed, true);
    // Subsequent get() returns defaults.
    const p = store.get(bobId);
    assert.deepEqual(p, DEFAULT_PREFS);
  });

  await test('removeUser() returns false for unknown user', () => {
    assert.equal(store.removeUser('never-existed'), false);
  });

  // ---------------------------------------------------------------------------
  console.log('\nInvalidate');
  // ---------------------------------------------------------------------------

  await test('invalidate() forces re-read from disk', () => {
    // Externally mutate the file.
    const raw = JSON.parse(fs.readFileSync(store.path, 'utf8'));
    raw.prefs[aliceId].colorMode = 'light';
    fs.writeFileSync(store.path, JSON.stringify(raw));

    // Without invalidate, cache returns the old value.
    const cached = store.get(aliceId);
    assert.equal(cached.colorMode, 'dark');

    // After invalidate, reads pick up the change.
    store.invalidate();
    const fresh = store.get(aliceId);
    assert.equal(fresh.colorMode, 'light');
  });

  // ---------------------------------------------------------------------------
  console.log('\nEmail notification prefs (M14 §3.5)');
  // ---------------------------------------------------------------------------

  await test('DEFAULT_PREFS includes email:{notifications:true,reminders:true}', () => {
    assert.deepEqual(DEFAULT_PREFS.email, { notifications: true, reminders: true });
  });

  await test('get() returns email defaults for a user with no stored prefs', () => {
    const p = store.get('brand-new-user-1111-111111111111');
    assert.deepEqual(p.email, { notifications: true, reminders: true });
  });

  await test('email prefs backfill for old stored file with no email key', () => {
    // Simulate a pre-M14 stored file: has locale/colorMode but no email key.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-prefs-email-backfill-'));
    try {
      const filePath = path.join(dir, 'user-prefs.json');
      fs.writeFileSync(filePath, JSON.stringify({
        prefs: { 'old-user-1111-1111-1111-111111111111': { locale: 'pt-PT', colorMode: 'dark' } },
      }));
      const s = createUserPrefsStore(dir);
      const p = s.get('old-user-1111-1111-1111-111111111111');
      // Old prefs still intact
      assert.equal(p.locale, 'pt-PT');
      assert.equal(p.colorMode, 'dark');
      // email backfilled from defaults — all true
      assert.deepEqual(p.email, { notifications: true, reminders: true });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('update() with {email:{reminders:false}} persists and keeps notifications:true', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-prefs-email-partial-'));
    try {
      const s = createUserPrefsStore(dir);
      const uid = 'test-user-1111-1111-1111-111111111111';
      const p = s.update(uid, { email: { reminders: false } });
      assert.equal(p.email.reminders, false);
      assert.equal(p.email.notifications, true); // sibling preserved

      // Reload from disk — round-trips through real save/load.
      s.invalidate();
      const reloaded = s.get(uid);
      assert.equal(reloaded.email.reminders, false);
      assert.equal(reloaded.email.notifications, true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('update() with {email:{notifications:false}} persists and keeps reminders:true', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-prefs-email-notif-'));
    try {
      const s = createUserPrefsStore(dir);
      const uid = 'notif-user-1111-1111-1111-111111111111';
      const p = s.update(uid, { email: { notifications: false } });
      assert.equal(p.email.notifications, false);
      assert.equal(p.email.reminders, true);

      s.invalidate();
      const reloaded = s.get(uid);
      assert.equal(reloaded.email.notifications, false);
      assert.equal(reloaded.email.reminders, true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('non-boolean email values are dropped (not coerced)', () => {
    // Strict boolean acceptance: only true/false; strings, numbers, null dropped.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-prefs-email-nonbool-'));
    try {
      const s = createUserPrefsStore(dir);
      const uid = 'nonbool-user-111-1111-1111-111111111111';
      const p = s.update(uid, { email: { notifications: 'yes', reminders: 1 } });
      // Non-boolean values are dropped; defaults remain.
      assert.equal(p.email.notifications, true);
      assert.equal(p.email.reminders, true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('unknown sub-keys under email are silently dropped', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-prefs-email-unknown-'));
    try {
      const s = createUserPrefsStore(dir);
      const uid = 'unknown-sub-1111-1111-1111-111111111111';
      const p = s.update(uid, { email: { notifications: false, marketing: false, foo: true } });
      assert.equal(p.email.notifications, false);
      assert.equal(p.email.reminders, true); // default
      // Unknown sub-keys are not stored.
      assert.equal(p.email.marketing, undefined);
      assert.equal(p.email.foo, undefined);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('both employer and employee users get the same email prefs shape', () => {
    // The prefs store is role-agnostic; shape depends only on the user id.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-prefs-email-roles-'));
    try {
      const s = createUserPrefsStore(dir);
      const employerId = 'employer-uuid-111-1111-1111-111111111111';
      const employeeId = 'employee-uuid-111-1111-1111-111111111111';
      const ep = s.get(employerId);
      const sp = s.get(employeeId);
      assert.deepEqual(ep.email, { notifications: true, reminders: true });
      assert.deepEqual(sp.email, { notifications: true, reminders: true });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('patch {email:{}} (empty object) changes nothing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-prefs-email-empty-'));
    try {
      const s = createUserPrefsStore(dir);
      const uid = 'empty-email-11111-1111-1111-111111111111';
      // First set reminders to false
      s.update(uid, { email: { reminders: false } });
      // Then patch with empty email object — should not change anything
      const p = s.update(uid, { email: {} });
      assert.equal(p.email.reminders, false); // preserved
      assert.equal(p.email.notifications, true); // preserved
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // ---------------------------------------------------------------------------
  // Garbage `email` value resilience (hand-edited file defence)
  // Parallel to Task 5 org-settings garbage-type guard test. A hand-edited
  // prefs file could set `email` to a string, array, or other non-plain-object.
  // withEmailDefaults() must absorb the garbage; no indexed keys (0,1,2…) must
  // ever leak out of get() or be persisted by update().
  // ---------------------------------------------------------------------------
  console.log('\nGarbage email field resilience');

  await test('get() with stored email:"yes" returns all-true defaults (no indexed keys)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-prefs-garbage-str-'));
    try {
      const filePath = path.join(dir, 'user-prefs.json');
      // Simulate a hand-edited file where `email` is a string, not an object.
      fs.writeFileSync(filePath, JSON.stringify({
        prefs: { 'garbage-user': { locale: 'en-US', email: 'yes' } },
      }));
      const s = createUserPrefsStore(dir);
      const p = s.get('garbage-user');
      // Must return the all-true defaults — not indexed keys from spreading a string.
      assert.deepEqual(p.email, { notifications: true, reminders: true });
      assert.deepEqual(Object.keys(p.email).sort(), ['notifications', 'reminders']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('get() with stored email:[] returns all-true defaults (no indexed keys)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-prefs-garbage-arr-'));
    try {
      const filePath = path.join(dir, 'user-prefs.json');
      fs.writeFileSync(filePath, JSON.stringify({
        prefs: { 'garbage-user': { locale: 'en-US', email: [] } },
      }));
      const s = createUserPrefsStore(dir);
      const p = s.get('garbage-user');
      assert.deepEqual(p.email, { notifications: true, reminders: true });
      assert.deepEqual(Object.keys(p.email).sort(), ['notifications', 'reminders']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('update() with garbage email:"yes" on disk persists clean object (no indexed keys)', () => {
    // Disk: email:"yes"  → update({email:{reminders:false}}) → persisted: {notifications:true,reminders:false}
    // This locks the "persist-garbage" fix: withEmailDefaults() is used as the
    // merge base so {0:'y',1:'e',2:'s'} can never reach the write path.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-prefs-garbage-upd-'));
    try {
      const filePath = path.join(dir, 'user-prefs.json');
      fs.writeFileSync(filePath, JSON.stringify({
        prefs: { 'garbage-user': { locale: 'en-US', email: 'yes' } },
      }));
      const s = createUserPrefsStore(dir);
      const returned = s.update('garbage-user', { email: { reminders: false } });
      // Returned value must be clean.
      assert.equal(returned.email.notifications, true);
      assert.equal(returned.email.reminders, false);
      assert.deepEqual(Object.keys(returned.email).sort(), ['notifications', 'reminders']);

      // Reload from disk via a fresh store to confirm persisted value is clean.
      const s2 = createUserPrefsStore(dir);
      const reloaded = s2.get('garbage-user');
      assert.equal(reloaded.email.notifications, true);
      assert.equal(reloaded.email.reminders, false);
      // The critical assertion: only the two known keys exist — no indexed garbage.
      assert.deepEqual(Object.keys(reloaded.email).sort(), ['notifications', 'reminders']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // ---------------------------------------------------------------------------
  console.log('\nCorrupt file recovery');
  // ---------------------------------------------------------------------------

  await test('malformed prefs file throws on next access', () => {
    fs.writeFileSync(store.path, 'not-json{{');
    const s3 = createUserPrefsStore(tmpDir);
    assert.throws(() => s3.get(aliceId), /Failed to parse/);
  });

} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
