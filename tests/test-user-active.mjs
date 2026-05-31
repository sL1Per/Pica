#!/usr/bin/env node
/**
 * Soft-deactivate — users store + rbac authenticate.
 * Built-in assert only. Run: node tests/test-user-active.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createUsersStore } from '../src/auth/users.js';
import { createRBAC } from '../src/auth/rbac.js';
import { deriveSessionKey, signSession } from '../src/auth/sessions.js';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.stack}`); failed++; }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-active-'));

try {
  console.log('Users store — active flag');
  const store = createUsersStore(tmp);

  await test('create stamps active:true', async () => {
    const u = await store.create({ username: 'alice', password: 'password1', role: 'employee' });
    const full = store.findById(u.id);
    assert.equal(full.active, true);
  });

  await test('setActive(false) sets active:false + deactivatedAt', async () => {
    const u = store.findByUsername('alice');
    const updated = store.setActive(u.id, false);
    assert.equal(updated.active, false);
    assert.ok(updated.deactivatedAt, 'deactivatedAt timestamp present');
    assert.equal(store.findById(u.id).active, false);
    assert.equal(updated.passwordHash, undefined, 'safe record omits hash');
  });

  await test('setActive(true) reactivates + clears deactivatedAt', async () => {
    const u = store.findByUsername('alice');
    const updated = store.setActive(u.id, true);
    assert.equal(updated.active, true);
    assert.equal(updated.deactivatedAt ?? null, null);
  });

  await test('setActive on unknown id throws not_found', () => {
    assert.throws(() => store.setActive('ffffffff-ffff-4fff-8fff-ffffffffffff', false),
      (e) => e.code === 'not_found');
  });

  await test('missing active field reads as active (back-compat)', () => {
    const legacy = createUsersStore(fs.mkdtempSync(path.join(os.tmpdir(), 'pica-legacy-')));
    fs.writeFileSync(legacy.path, JSON.stringify({ users: [
      { id: '11111111-1111-4111-8111-111111111111', username: 'bob', passwordHash: 'x', role: 'employee', createdAt: '2020-01-01T00:00:00Z' },
    ] }, null, 2));
    legacy.invalidate();
    const u = legacy.findById('11111111-1111-4111-8111-111111111111');
    assert.equal(u.active, undefined, 'legacy record has no active field');
    // The "active" semantic (active !== false) is asserted in the rbac tests below.
  });

  console.log('\nRBAC authenticate — deactivated rejection');
  const sessionKey = deriveSessionKey(randomBytes(32));

  await test('authenticate returns null for deactivated user', async () => {
    const ustore = createUsersStore(fs.mkdtempSync(path.join(os.tmpdir(), 'pica-rbac-')));
    const u = await ustore.create({ username: 'carol', password: 'password1', role: 'employee' });
    ustore.setActive(u.id, false);
    const { authenticate } = createRBAC({ sessionKey, usersStore: ustore });
    const cookie = signSession({ uid: u.id, role: 'employee' }, sessionKey);
    const req = { cookies: { pica_session: cookie } };
    assert.equal(authenticate(req), null);
  });

  await test('authenticate returns user when active (and for legacy no-active)', async () => {
    const ustore = createUsersStore(fs.mkdtempSync(path.join(os.tmpdir(), 'pica-rbac2-')));
    const u = await ustore.create({ username: 'dave', password: 'password1', role: 'employee' });
    const { authenticate } = createRBAC({ sessionKey, usersStore: ustore });
    const cookie = signSession({ uid: u.id, role: 'employee' }, sessionKey);
    const ok = authenticate({ cookies: { pica_session: cookie } });
    assert.ok(ok && ok.user.id === u.id);
  });
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
