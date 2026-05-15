// tests/test-security-routes.mjs
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createRouter } from '../src/router.js';
import { registerSecurityRoutes } from '../src/routes/security.js';
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

async function fixture() {
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
  });
  return { dir, configPath, router, audited, serverState };
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
