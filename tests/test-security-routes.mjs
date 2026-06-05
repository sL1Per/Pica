// tests/test-security-routes.mjs
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createRouter } from '../src/router.js';
import { registerSecurityRoutes } from '../src/routes/security.js';
import { createRateLimiter } from '../src/auth/rate-limit.js';
import { newKdf, deriveKek, setSlot, writeConfigAtomic } from '../src/crypto/keyring.js';
import { wrapDek } from '../src/crypto/dek.js';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); passed++; }
  catch (e) { console.error(`FAIL ${name}\n${e.stack}`); failed++; }
}

function mockRes() {
  const r = {
    statusCode: null, body: null,
    json(d, s = 200) { r.statusCode = s; r.body = d; },
    badRequest(m, o) { r.statusCode = 400; r.body = { error: m, ...(o?.errorCode && { errorCode: o.errorCode }) }; },
    forbidden(m, o) { r.statusCode = 403; r.body = { error: m, ...(o?.errorCode && { errorCode: o.errorCode }) }; },
    unauthorized(m, o) { r.statusCode = 401; r.body = { error: m, ...(o?.errorCode && { errorCode: o.errorCode }) }; },
    serviceUnavailable(m, o) { r.statusCode = 503; r.body = { error: m, ...(o?.errorCode && { errorCode: o.errorCode }) }; },
  };
  return r;
}
const requireAuth = (h) => async (req, res) => req.user ? h(req, res) : res.unauthorized('x', { errorCode: 'unauthorized' });
const requireRole = (role) => (h) => async (req, res) => {
  if (!req.user) return res.unauthorized('x', { errorCode: 'unauthorized' });
  if (req.user.role !== role) return res.forbidden('x', { errorCode: 'forbidden' });
  return h(req, res);
};

async function fixture(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-sec-'));
  const configPath = path.join(dir, 'config.json');
  const dek = randomBytes(32);
  const kdf = newKdf();
  const kek = await deriveKek('current-pass', kdf);
  const config = { port: 8080, security: {} };
  setSlot(config.security, 'passphrase', kdf, wrapDek(dek, kek, 'passphrase'));
  writeConfigAtomic(configPath, config);
  const serverState = { passphraseResetRequired: false };
  const audited = [];
  const router = createRouter();
  registerSecurityRoutes(router, {
    configPath, masterKey: dek, serverState,
    requireAuth, requireRole,
    auditStore: { appendRecord: (r) => audited.push(r) },
    logger: { info() {}, warn() {}, error() {} },
    securityLimiter: opts.securityLimiter,
  });
  return { dir, configPath, router, audited, serverState };
}
async function rotFixture(rotateImpl) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-rot-'));
  const configPath = path.join(dir, 'config.json');
  const dataDir = path.join(dir, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'marker'), 'x');
  const dek = randomBytes(32);
  const kdf = newKdf();
  const kek = await deriveKek('current-pass', kdf);
  const config = { security: {} };
  setSlot(config.security, 'passphrase', kdf, wrapDek(dek, kek, 'passphrase'));
  writeConfigAtomic(configPath, config);
  const serverState = { rotateCompleted: false };
  const audited = [];
  const router = createRouter();
  registerSecurityRoutes(router, {
    configPath, masterKey: dek, dataDir, serverState,
    requireAuth, requireRole,
    auditStore: { appendRecord: (r) => audited.push(r) },
    logger: { info() {}, warn() {}, error() {} },
    rotate: rotateImpl || (async ({ stagingDir }) => { fs.mkdirSync(stagingDir, { recursive: true }); }),
  });
  return { dir, configPath, dataDir, router, audited, serverState };
}
async function call(router, method, urlPath, { user, body } = {}) {
  const m = router.match(method, urlPath);
  assert.ok(m && m.handler, `${method} ${urlPath} should be registered`);
  const req = { user, params: m.params || {}, query: {}, body: body || {}, socket: {} };
  const res = mockRes();
  await m.handler(req, res);
  return res;
}

await test('employee is forbidden from changing the passphrase', async () => {
  const f = await fixture();
  const res = await call(f.router, 'POST', '/api/security/passphrase',
    { user: { id: 'e', role: 'employee' }, body: { currentPassphrase: 'current-pass', newPassphrase: 'new-pass-123' } });
  assert.equal(res.statusCode, 403);
  fs.rmSync(f.dir, { recursive: true, force: true });
});

await test('M17 S15: security ops are rate-limited (429 after the cap)', async () => {
  const f = await fixture({ securityLimiter: createRateLimiter({ max: 2, windowSeconds: 3600 }) });
  const employerUser = { id: 'm', role: 'employer' };
  const body = { currentPassphrase: 'WRONG', newPassphrase: 'new-pass-123' };
  // First two attempts pass the limiter (and 400 on the wrong passphrase).
  const r1 = await call(f.router, 'POST', '/api/security/passphrase', { user: employerUser, body });
  const r2 = await call(f.router, 'POST', '/api/security/passphrase', { user: employerUser, body });
  assert.equal(r1.statusCode, 400);
  assert.equal(r2.statusCode, 400);
  // Third trips the limiter — 429, before the handler runs.
  const r3 = await call(f.router, 'POST', '/api/security/passphrase', { user: employerUser, body });
  assert.equal(r3.statusCode, 429);
  assert.equal(r3.body.errorCode, 'rate_limited');
  fs.rmSync(f.dir, { recursive: true, force: true });
});

await test('wrong current passphrase → 400', async () => {
  const f = await fixture();
  const res = await call(f.router, 'POST', '/api/security/passphrase',
    { user: { id: 'm', role: 'employer' }, body: { currentPassphrase: 'WRONG', newPassphrase: 'new-pass-123' } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.errorCode, 'wrong_passphrase');
  fs.rmSync(f.dir, { recursive: true, force: true });
});

await test('happy path re-wraps the DEK under the new passphrase', async () => {
  const f = await fixture();
  const res = await call(f.router, 'POST', '/api/security/passphrase',
    { user: { id: 'm', role: 'employer' }, body: { currentPassphrase: 'current-pass', newPassphrase: 'brand-new-pass' } });
  assert.equal(res.statusCode, 200);
  const cfg = JSON.parse(fs.readFileSync(f.configPath, 'utf8'));
  const { deriveKek: dk } = await import('../src/crypto/keyring.js');
  const { unwrapDek } = await import('../src/crypto/dek.js');
  const slot = cfg.security.wraps.passphrase;
  const kek = await dk('brand-new-pass', slot.kdf);
  assert.doesNotThrow(() => unwrapDek(slot.wrapped, kek, 'passphrase'));
  assert.ok(f.audited.some((a) => a.event === 'security.passphrase_changed'));
  fs.rmSync(f.dir, { recursive: true, force: true });
});

await test('missing currentPassphrase → 400 required', async () => {
  const f = await fixture();
  const res = await call(f.router, 'POST', '/api/security/passphrase',
    { user: { id: 'm', role: 'employer' }, body: { newPassphrase: 'new-pass-123' } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.errorCode, 'required');
  fs.rmSync(f.dir, { recursive: true, force: true });
});

await test('corrupt config is NOT masked as wrong passphrase (propagates)', async () => {
  const f = await fixture();
  const cfg = JSON.parse(fs.readFileSync(f.configPath, 'utf8'));
  cfg.security.wraps.passphrase.wrapped = 'AAAA'; // truncated → structural error
  fs.writeFileSync(f.configPath, JSON.stringify(cfg));
  await assert.rejects(() => call(f.router, 'POST', '/api/security/passphrase',
    { user: { id: 'm', role: 'employer' },
      body: { currentPassphrase: 'current-pass', newPassphrase: 'brand-new-pass' } }));
  fs.rmSync(f.dir, { recursive: true, force: true });
});

await test('set recovery code returns it once and stores a recovery slot', async () => {
  const f = await fixture();
  const res = await call(f.router, 'POST', '/api/security/recovery-code',
    { user: { id: 'm', role: 'employer' }, body: { currentPassphrase: 'current-pass' } });
  assert.equal(res.statusCode, 200);
  assert.match(res.body.code, /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){7}$/);
  const cfg = JSON.parse(fs.readFileSync(f.configPath, 'utf8'));
  assert.ok(cfg.security.wraps.recovery.wrapped);
  assert.ok(cfg.security.wraps.recovery.createdAt);
  assert.ok(f.audited.some((a) => a.event === 'security.recovery_code_set'));
  fs.rmSync(f.dir, { recursive: true, force: true });
});

await test('set recovery code with wrong passphrase → 400', async () => {
  const f = await fixture();
  const res = await call(f.router, 'POST', '/api/security/recovery-code',
    { user: { id: 'm', role: 'employer' }, body: { currentPassphrase: 'NOPE' } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.errorCode, 'wrong_passphrase');
  fs.rmSync(f.dir, { recursive: true, force: true });
});

await test('set recovery code missing currentPassphrase → 400 required', async () => {
  const f = await fixture();
  const res = await call(f.router, 'POST', '/api/security/recovery-code',
    { user: { id: 'm', role: 'employer' }, body: {} });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.errorCode, 'required');
  fs.rmSync(f.dir, { recursive: true, force: true });
});

await test('delete recovery code removes the slot', async () => {
  const f = await fixture();
  await call(f.router, 'POST', '/api/security/recovery-code',
    { user: { id: 'm', role: 'employer' }, body: { currentPassphrase: 'current-pass' } });
  const res = await call(f.router, 'DELETE', '/api/security/recovery-code',
    { user: { id: 'm', role: 'employer' }, body: { currentPassphrase: 'current-pass' } });
  assert.equal(res.statusCode, 200);
  const cfg = JSON.parse(fs.readFileSync(f.configPath, 'utf8'));
  assert.equal(cfg.security.wraps.recovery, undefined);
  assert.ok(f.audited.some((a) => a.event === 'security.recovery_code_removed'));
  fs.rmSync(f.dir, { recursive: true, force: true });
});

await test('employee is forbidden from recovery-code routes', async () => {
  const f = await fixture();
  for (const m of ['POST', 'DELETE']) {
    const res = await call(f.router, m, '/api/security/recovery-code',
      { user: { id: 'e', role: 'employee' }, body: { currentPassphrase: 'current-pass' } });
    assert.equal(res.statusCode, 403);
  }
  fs.rmSync(f.dir, { recursive: true, force: true });
});

await test('regenerating the recovery code replaces (never duplicates) the slot', async () => {
  const f = await fixture();
  const r1 = await call(f.router, 'POST', '/api/security/recovery-code',
    { user: { id: 'm', role: 'employer' }, body: { currentPassphrase: 'current-pass' } });
  const r2 = await call(f.router, 'POST', '/api/security/recovery-code',
    { user: { id: 'm', role: 'employer' }, body: { currentPassphrase: 'current-pass' } });
  assert.notEqual(r1.body.code, r2.body.code);
  const cfg = JSON.parse(fs.readFileSync(f.configPath, 'utf8'));
  assert.equal(Object.keys(cfg.security.wraps).filter((k) => k === 'recovery').length, 1);
  // old code must no longer unwrap the DEK
  const { deriveKek } = await import('../src/crypto/keyring.js');
  const { unwrapDek, normalizeRecoveryCode } = await import('../src/crypto/dek.js');
  const slot = cfg.security.wraps.recovery;
  const oldKek = await deriveKek(normalizeRecoveryCode(r1.body.code), slot.kdf);
  assert.throws(() => unwrapDek(slot.wrapped, oldKek, 'recovery'));
  fs.rmSync(f.dir, { recursive: true, force: true });
});

await test('deleting when no recovery code exists is an idempotent 200', async () => {
  const f = await fixture();
  const res = await call(f.router, 'DELETE', '/api/security/recovery-code',
    { user: { id: 'm', role: 'employer' }, body: { currentPassphrase: 'current-pass' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  fs.rmSync(f.dir, { recursive: true, force: true });
});

// Regression guard for the production bug the route-test harness masks:
// the harness sets req.body directly, but the real server only parses a
// request body for the methods in this list. DELETE MUST be present or
// DELETE /api/security/recovery-code is dead in production (always 400).
await test('server.js parses a request body for DELETE', () => {
  const src = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const m = src.match(/\[\s*'POST',\s*'PUT',\s*'PATCH',\s*'DELETE'\s*\]\.includes\(\s*nodeReq\.method\s*\)/);
  assert.ok(m, "server.js body-parse gate must include 'DELETE'");
});

await test('rotate: confirm required, then swaps dirs and locks down', async () => {
  const f = await rotFixture();
  let res = await call(f.router, 'POST', '/api/security/rotate',
    { user: { id: 'm', role: 'employer' }, body: { currentPassphrase: 'current-pass' } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.errorCode, 'confirm_required');

  res = await call(f.router, 'POST', '/api/security/rotate',
    { user: { id: 'm', role: 'employer' }, body: { currentPassphrase: 'current-pass', confirm: 'ROTATE' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.restartRequired, true);
  assert.equal(f.serverState.rotateCompleted, true);
  const aside = fs.readdirSync(f.dir).filter((n) => n.startsWith('data.pre-rotate-'));
  assert.equal(aside.length, 1);
  assert.equal(fs.readFileSync(path.join(f.dir, aside[0], 'marker'), 'utf8'), 'x');
  assert.ok(f.audited.some((a) => a.event === 'security.key_rotated'));
  const cfg = JSON.parse(fs.readFileSync(f.configPath, 'utf8'));
  assert.equal(cfg.security.wraps.recovery, undefined);
  fs.rmSync(f.dir, { recursive: true, force: true });
});

await test('rotate: employee forbidden; wrong/missing passphrase rejected', async () => {
  const f = await rotFixture();
  let res = await call(f.router, 'POST', '/api/security/rotate',
    { user: { id: 'e', role: 'employee' }, body: { currentPassphrase: 'current-pass', confirm: 'ROTATE' } });
  assert.equal(res.statusCode, 403);

  res = await call(f.router, 'POST', '/api/security/rotate',
    { user: { id: 'm', role: 'employer' }, body: { confirm: 'ROTATE' } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.errorCode, 'required');

  res = await call(f.router, 'POST', '/api/security/rotate',
    { user: { id: 'm', role: 'employer' }, body: { currentPassphrase: 'WRONG', confirm: 'ROTATE' } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.errorCode, 'wrong_passphrase');
  assert.equal(f.serverState.rotateCompleted, false);
  assert.equal(fs.readdirSync(f.dir).filter((n) => n.startsWith('data.pre-rotate-')).length, 0);
  fs.rmSync(f.dir, { recursive: true, force: true });
});

await test('rotate: rotateData failure aborts cleanly (data intact, no lockdown)', async () => {
  const f = await rotFixture(async () => { throw new Error('simulated disk error'); });
  const res = await call(f.router, 'POST', '/api/security/rotate',
    { user: { id: 'm', role: 'employer' },
      body: { currentPassphrase: 'current-pass', confirm: 'ROTATE' } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.errorCode, 'rotation_failed');
  assert.equal(f.serverState.rotateCompleted, false);
  assert.equal(fs.readdirSync(f.dir)
    .filter((n) => n.startsWith('data.staging-') || n.startsWith('data.pre-rotate-')).length, 0);
  assert.equal(fs.readFileSync(path.join(f.dataDir, 'marker'), 'utf8'), 'x');
  fs.rmSync(f.dir, { recursive: true, force: true });
});

await test('passphrase reset mode: no currentPassphrase needed; re-wraps in-memory DEK', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-sec-rst-'));
  const configPath = path.join(dir, 'config.json');
  const dek = randomBytes(32);
  const kdf = newKdf();
  const kek = await deriveKek('forgotten-pass', kdf);
  const config = { security: {} };
  setSlot(config.security, 'passphrase', kdf, wrapDek(dek, kek, 'passphrase'));
  writeConfigAtomic(configPath, config);
  const serverState = { passphraseResetRequired: true };
  const audited = [];
  const router = createRouter();
  registerSecurityRoutes(router, {
    configPath, masterKey: dek, serverState,
    requireAuth, requireRole,
    auditStore: { appendRecord: (r) => audited.push(r) },
    logger: { info() {}, warn() {}, error() {} },
  });
  const res = await call(router, 'POST', '/api/security/passphrase',
    { user: { id: 'm', role: 'employer' }, body: { newPassphrase: 'brand-new-pass' } });
  assert.equal(res.statusCode, 200);
  assert.equal(serverState.passphraseResetRequired, false);
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const { deriveKek: dk } = await import('../src/crypto/keyring.js');
  const { unwrapDek } = await import('../src/crypto/dek.js');
  const slot = cfg.security.wraps.passphrase;
  const kek2 = await dk('brand-new-pass', slot.kdf);
  assert.deepEqual(unwrapDek(slot.wrapped, kek2, 'passphrase'), dek);
  assert.ok(audited.some((a) => a.event === 'security.passphrase_changed'
    && a.details && a.details.viaRecovery === true));
  fs.rmSync(dir, { recursive: true, force: true });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
