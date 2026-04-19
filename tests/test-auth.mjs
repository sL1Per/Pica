#!/usr/bin/env node
/**
 * M2b smoke tests — sessions, rate limiter, users store, RBAC middleware.
 * Built-in `assert` only, no test framework.
 *
 * Run:  node tests/test-auth.mjs
 */

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { deriveSessionKey, signSession, verifySession } from '../src/auth/sessions.js';
import { createRateLimiter } from '../src/auth/rate-limit.js';
import { createUsersStore } from '../src/auth/users.js';
import { createRBAC } from '../src/auth/rbac.js';
import { verifyPassword } from '../src/crypto/passwords.js';

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
console.log('Session cookies');
// ----------------------------------------------------------------------------

const masterKey = randomBytes(32);
const sessionKey = deriveSessionKey(masterKey);

await test('session key is 32 bytes', () => {
  assert.equal(sessionKey.length, 32);
});

await test('deriveSessionKey rejects non-32-byte master key', () => {
  assert.throws(() => deriveSessionKey(randomBytes(16)));
  assert.throws(() => deriveSessionKey('not-a-buffer'));
});

await test('sign → verify round trip', () => {
  const cookie = signSession({ uid: 'user-1', role: 'employer' }, sessionKey);
  const decoded = verifySession(cookie, sessionKey);
  assert.equal(decoded.uid, 'user-1');
  assert.equal(decoded.role, 'employer');
  assert.ok(decoded.exp > Math.floor(Date.now() / 1000));
});

await test('verify with different session key fails', () => {
  const cookie = signSession({ uid: 'u', role: 'employer' }, sessionKey);
  const otherKey = deriveSessionKey(randomBytes(32));
  assert.equal(verifySession(cookie, otherKey), null);
});

await test('tampered payload fails signature check', () => {
  const cookie = signSession({ uid: 'u', role: 'employee' }, sessionKey);
  // Flip a bit in the payload section (before the dot).
  const dot = cookie.indexOf('.');
  const tampered = 'X' + cookie.slice(1, dot) + cookie.slice(dot);
  assert.equal(verifySession(tampered, sessionKey), null);
});

await test('tampered signature fails', () => {
  const cookie = signSession({ uid: 'u', role: 'employee' }, sessionKey);
  const tampered = cookie.slice(0, -1) + (cookie.slice(-1) === 'A' ? 'B' : 'A');
  assert.equal(verifySession(tampered, sessionKey), null);
});

await test('expired session returns null', () => {
  const cookie = signSession({ uid: 'u', role: 'employee' }, sessionKey, -1);
  assert.equal(verifySession(cookie, sessionKey), null);
});

await test('malformed cookies return null (not throw)', () => {
  assert.equal(verifySession('', sessionKey), null);
  assert.equal(verifySession('no-dot-here', sessionKey), null);
  assert.equal(verifySession('.only-sig', sessionKey), null);
  assert.equal(verifySession('only-payload.', sessionKey), null);
  assert.equal(verifySession(null, sessionKey), null);
  assert.equal(verifySession(undefined, sessionKey), null);
});

// ----------------------------------------------------------------------------
console.log('\nRate limiter');
// ----------------------------------------------------------------------------

await test('allows the first N attempts, blocks N+1', () => {
  const rl = createRateLimiter({ max: 3, windowSeconds: 60 });
  assert.equal(rl.allow('ip-a'), true);
  assert.equal(rl.allow('ip-a'), true);
  assert.equal(rl.allow('ip-a'), true);
  assert.equal(rl.allow('ip-a'), false);
});

await test('different keys are independent', () => {
  const rl = createRateLimiter({ max: 2, windowSeconds: 60 });
  assert.equal(rl.allow('ip-a'), true);
  assert.equal(rl.allow('ip-a'), true);
  assert.equal(rl.allow('ip-a'), false);
  assert.equal(rl.allow('ip-b'), true); // unaffected
});

await test('reset clears state for one key', () => {
  const rl = createRateLimiter({ max: 1, windowSeconds: 60 });
  rl.allow('ip');
  assert.equal(rl.allow('ip'), false);
  rl.reset('ip');
  assert.equal(rl.allow('ip'), true);
});

await test('remaining() reports accurately', () => {
  const rl = createRateLimiter({ max: 5, windowSeconds: 60 });
  assert.equal(rl.remaining('ip'), 5);
  rl.allow('ip');
  rl.allow('ip');
  assert.equal(rl.remaining('ip'), 3);
});

await test('rejects bad constructor args', () => {
  assert.throws(() => createRateLimiter({ max: 0, windowSeconds: 1 }));
  assert.throws(() => createRateLimiter({ max: 1, windowSeconds: 0 }));
});

// ----------------------------------------------------------------------------
console.log('\nUsers store');
// ----------------------------------------------------------------------------

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-auth-'));

try {
  const store = createUsersStore(tmpDir);

  await test('empty store has no users', () => {
    assert.equal(store.hasAny(), false);
    assert.equal(store.count(), 0);
  });

  let alice;
  await test('create user returns record without password hash', async () => {
    alice = await store.create({
      username: 'alice',
      password: 'correct horse',
      role: 'employer',
    });
    assert.ok(alice.id);
    assert.equal(alice.username, 'alice');
    assert.equal(alice.role, 'employer');
    assert.ok(alice.createdAt);
    assert.equal(alice.passwordHash, undefined);
  });

  await test('findById returns the stored user (with hash)', () => {
    const u = store.findById(alice.id);
    assert.ok(u);
    assert.equal(u.username, 'alice');
    assert.ok(u.passwordHash); // hash IS present in the stored record
  });

  await test('findByUsername is case-insensitive', () => {
    assert.ok(store.findByUsername('alice'));
    assert.ok(store.findByUsername('ALICE'));
    assert.ok(store.findByUsername('Alice'));
  });

  await test('stored hash verifies against correct password', async () => {
    const u = store.findById(alice.id);
    assert.equal(await verifyPassword('correct horse', u.passwordHash), true);
    assert.equal(await verifyPassword('wrong', u.passwordHash), false);
  });

  await test('create rejects duplicate username (case-insensitive)', async () => {
    await assert.rejects(
      () => store.create({ username: 'ALICE', password: 'whatever', role: 'employee' }),
      /exists/i,
    );
  });

  await test('create rejects invalid role', async () => {
    await assert.rejects(
      () => store.create({ username: 'bob', password: 'something', role: 'admin' }),
      /role/i,
    );
  });

  await test('create rejects short password', async () => {
    await assert.rejects(
      () => store.create({ username: 'bob', password: 'short', role: 'employee' }),
      /8 characters/,
    );
  });

  await test('create rejects invalid username', async () => {
    await assert.rejects(
      () => store.create({ username: 'a', password: 'longenough', role: 'employee' }),
      /Invalid username/,
    );
    await assert.rejects(
      () => store.create({ username: 'has spaces', password: 'longenough', role: 'employee' }),
      /Invalid username/,
    );
  });

  await test('users.json is persisted and re-readable', () => {
    const fresh = createUsersStore(tmpDir);
    assert.equal(fresh.hasAny(), true);
    assert.equal(fresh.count(), 1);
    assert.ok(fresh.findByUsername('alice'));
  });

  await test('users.json file permissions are 0600', () => {
    const stat = fs.statSync(path.join(tmpDir, 'users.json'));
    const mode = stat.mode & 0o777;
    assert.equal(mode, 0o600);
  });

  // ----------------------------------------------------------------------------
  console.log('\nRBAC middleware');
  // ----------------------------------------------------------------------------

  const rbac = createRBAC({ sessionKey, usersStore: store });

  function mockReq({ cookie } = {}) {
    return {
      cookies: cookie ? { pica_session: cookie } : {},
    };
  }

  function mockRes() {
    return {
      _json: null, _status: null,
      unauthorized(msg) { this._json = { error: msg }; this._status = 401; },
      forbidden(msg)    { this._json = { error: msg }; this._status = 403; },
      json(data, status=200) { this._json = data; this._status = status; },
    };
  }

  await test('requireAuth rejects when no cookie', async () => {
    const handler = rbac.requireAuth(() => { throw new Error('should not run'); });
    const req = mockReq();
    const res = mockRes();
    await handler(req, res);
    assert.equal(res._status, 401);
  });

  await test('requireAuth rejects tampered cookie', async () => {
    const handler = rbac.requireAuth(() => { throw new Error('nope'); });
    const res = mockRes();
    await handler(mockReq({ cookie: 'tampered.sig' }), res);
    assert.equal(res._status, 401);
  });

  await test('requireAuth calls handler with req.user for valid cookie', async () => {
    const cookie = signSession({ uid: alice.id, role: alice.role }, sessionKey);
    let seen = null;
    const handler = rbac.requireAuth((req, res) => { seen = req.user; res.json({ ok: true }); });
    const res = mockRes();
    await handler(mockReq({ cookie }), res);
    assert.equal(res._status, 200);
    assert.equal(seen.username, 'alice');
  });

  await test('requireAuth rejects cookie for deleted user', async () => {
    // Sign a session for a user that doesn't exist in the store.
    const cookie = signSession({ uid: 'ghost-id', role: 'employer' }, sessionKey);
    const handler = rbac.requireAuth(() => { throw new Error('nope'); });
    const res = mockRes();
    await handler(mockReq({ cookie }), res);
    assert.equal(res._status, 401);
  });

  await test('requireRole("employer") passes for employer', async () => {
    const cookie = signSession({ uid: alice.id, role: alice.role }, sessionKey);
    let ran = false;
    const handler = rbac.requireRole('employer')((req, res) => { ran = true; res.json({}); });
    const res = mockRes();
    await handler(mockReq({ cookie }), res);
    assert.equal(ran, true);
    assert.equal(res._status, 200);
  });

  await test('requireRole("employer") rejects employee', async () => {
    // Create an employee for this test.
    const bob = await store.create({ username: 'bob', password: 'longenoughpass', role: 'employee' });
    const cookie = signSession({ uid: bob.id, role: 'employee' }, sessionKey);
    const handler = rbac.requireRole('employer')(() => { throw new Error('nope'); });
    const res = mockRes();
    await handler(mockReq({ cookie }), res);
    assert.equal(res._status, 403);
  });

  await test('requireOwnerOrEmployer allows employer for anyone\'s resource', async () => {
    const cookie = signSession({ uid: alice.id, role: 'employer' }, sessionKey);
    let ran = false;
    const handler = rbac.requireOwnerOrEmployer(() => 'somebody-else-id')((req, res) => {
      ran = true; res.json({});
    });
    const res = mockRes();
    await handler(mockReq({ cookie }), res);
    assert.equal(ran, true);
  });

  await test('requireOwnerOrEmployer allows owner of their own resource', async () => {
    const bob = store.findByUsername('bob');
    const cookie = signSession({ uid: bob.id, role: 'employee' }, sessionKey);
    let ran = false;
    const handler = rbac.requireOwnerOrEmployer(() => bob.id)((req, res) => {
      ran = true; res.json({});
    });
    const res = mockRes();
    await handler(mockReq({ cookie }), res);
    assert.equal(ran, true);
  });

  await test('requireOwnerOrEmployer rejects employee accessing another\'s resource', async () => {
    const bob = store.findByUsername('bob');
    const cookie = signSession({ uid: bob.id, role: 'employee' }, sessionKey);
    const handler = rbac.requireOwnerOrEmployer(() => 'somebody-else')(() => { throw new Error('nope'); });
    const res = mockRes();
    await handler(mockReq({ cookie }), res);
    assert.equal(res._status, 403);
  });

} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

// ----------------------------------------------------------------------------
console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
