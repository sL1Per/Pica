/**
 * Leave justification attachments (0.22.18).
 *
 *   A. Storage: setAttachment / readAttachment / removeAttachment,
 *      encrypted-at-rest, pending-only, replace, AAD safety.
 *   B. validateAttachment pure policy (size / type).
 *   C. Routes: POST create-with-file, GET/PUT/DELETE attachment,
 *      and the core privacy rule — another employee gets 403.
 *
 * Run:  node tests/test-leaves-attachment.mjs
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createLeavesStore } from '../src/storage/leaves.js';
import { createRouter } from '../src/router.js';
import { registerLeaveRoutes, validateAttachment } from '../src/routes/leaves.js';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (err) { console.error(`  ✗ ${name}\n    ${err.message}`); failed++; }
}

// ===========================================================================
console.log('\nStorage: attachment lifecycle');
// ===========================================================================

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-att-'));
const masterKey = randomBytes(32);
const store = createLeavesStore(tmpDir, masterKey);

const PDF = Buffer.from('%PDF-1.4 hello world ' + 'x'.repeat(100));

function freshLeave() {
  return store.create({
    employeeId: 'emp-1', type: 'vacation', unit: 'days',
    start: '2026-08-01', end: '2026-08-03', reason: 'trip',
  });
}

await test('setAttachment populates state.attachment', () => {
  const lv = freshLeave();
  const updated = store.setAttachment(lv.id, { name: 'note.pdf', mime: 'application/pdf', size: PDF.length, data: PDF });
  assert.equal(updated.attachment.name, 'note.pdf');
  assert.equal(updated.attachment.mime, 'application/pdf');
  assert.equal(updated.attachment.size, PDF.length);
});

await test('attachment file on disk is encrypted (not the raw bytes)', () => {
  const lv = freshLeave();
  store.setAttachment(lv.id, { name: 'a.pdf', mime: 'application/pdf', size: PDF.length, data: PDF });
  const file = path.join(store.paths.attachmentsDir, lv.id);
  const onDisk = fs.readFileSync(file);
  assert.ok(!onDisk.includes(Buffer.from('%PDF-1.4 hello')), 'plaintext leaked to disk');
});

await test('readAttachment round-trips exact bytes + metadata', () => {
  const lv = freshLeave();
  store.setAttachment(lv.id, { name: 'b.png', mime: 'image/png', size: PDF.length, data: PDF });
  const got = store.readAttachment(lv.id);
  assert.deepEqual(got.data, PDF);
  assert.equal(got.name, 'b.png');
  assert.equal(got.mime, 'image/png');
});

await test('replace swaps bytes + metadata', () => {
  const lv = freshLeave();
  store.setAttachment(lv.id, { name: 'old.pdf', mime: 'application/pdf', size: PDF.length, data: PDF });
  const NEW = Buffer.from('PNG-ish ' + 'y'.repeat(50));
  store.setAttachment(lv.id, { name: 'new.png', mime: 'image/png', size: NEW.length, data: NEW });
  const got = store.readAttachment(lv.id);
  assert.equal(got.name, 'new.png');
  assert.deepEqual(got.data, NEW);
});

await test('removeAttachment clears state + deletes file', () => {
  const lv = freshLeave();
  store.setAttachment(lv.id, { name: 'x.pdf', mime: 'application/pdf', size: PDF.length, data: PDF });
  const after = store.removeAttachment(lv.id);
  assert.equal(after.attachment, null);
  assert.equal(store.readAttachment(lv.id), null);
  assert.equal(fs.existsSync(path.join(store.paths.attachmentsDir, lv.id)), false);
});

await test('attachment is pending-only (locked after approve)', () => {
  const lv = freshLeave();
  store.setAttachment(lv.id, { name: 'x.pdf', mime: 'application/pdf', size: PDF.length, data: PDF });
  store.approve(lv.id, 'boss');
  assert.throws(() => store.setAttachment(lv.id, { name: 'y.pdf', mime: 'application/pdf', size: PDF.length, data: PDF }),
    /attachment of a leave that is approved/);
  assert.throws(() => store.removeAttachment(lv.id), /attachment of a leave that is approved/);
  // But the already-attached file is still readable on the decided leave.
  assert.ok(store.readAttachment(lv.id));
});

await test('removeAttachment with no attachment is idempotent', () => {
  const lv = freshLeave();
  const after = store.removeAttachment(lv.id);
  assert.equal(after.attachment, null);
});

await test('attachment survives a fresh store (persisted, decryptable)', () => {
  const lv = freshLeave();
  store.setAttachment(lv.id, { name: 'persist.pdf', mime: 'application/pdf', size: PDF.length, data: PDF });
  const store2 = createLeavesStore(tmpDir, masterKey);
  const got = store2.readAttachment(lv.id);
  assert.equal(got.name, 'persist.pdf');
  assert.deepEqual(got.data, PDF);
});

await test('a different master key cannot read the attachment', () => {
  const lv = freshLeave();
  store.setAttachment(lv.id, { name: 'secret.pdf', mime: 'application/pdf', size: PDF.length, data: PDF });
  const evil = createLeavesStore(tmpDir, randomBytes(32));
  // findById can't decrypt the metadata → attachment null → readAttachment null.
  assert.equal(evil.readAttachment(lv.id), null);
});

// ===========================================================================
console.log('\nvalidateAttachment (policy)');
// ===========================================================================

const okFile = (over = {}) => ({ filename: 'note.pdf', contentType: 'application/pdf', data: PDF, ...over });

await test('accepts a normal PDF', () => {
  assert.equal(validateAttachment(okFile()).ok, true);
});
await test('accepts image types', () => {
  for (const [fn, mt] of [['a.jpg','image/jpeg'],['a.png','image/png'],['a.gif','image/gif'],['a.webp','image/webp']]) {
    assert.equal(validateAttachment(okFile({ filename: fn, contentType: mt })).ok, true, fn);
  }
});
await test('tolerates application/octet-stream when extension is allowed', () => {
  assert.equal(validateAttachment(okFile({ contentType: 'application/octet-stream' })).ok, true);
});
await test('rejects a disallowed extension', () => {
  const r = validateAttachment(okFile({ filename: 'evil.exe', contentType: 'application/octet-stream' }));
  assert.equal(r.ok, false);
  assert.equal(r.errorCode, 'attachment_bad_type');
});
await test('rejects oversize', () => {
  const big = Buffer.alloc(5 * 1024 * 1024 + 1);
  const r = validateAttachment(okFile({ data: big }));
  assert.equal(r.ok, false);
  assert.equal(r.errorCode, 'attachment_too_large');
});
await test('rejects missing data', () => {
  assert.equal(validateAttachment({ filename: 'a.pdf' }).ok, false);
});

// ===========================================================================
console.log('\nRoutes: create-with-file + attachment authz');
// ===========================================================================

function mockRes() {
  const r = {
    statusCode: null, body: null, headers: null, raw: null,
    json(d, s = 200) { r.statusCode = s; r.body = d; },
    badRequest(m, o) { r.statusCode = 400; r.body = { error: m, ...(o?.errorCode && { errorCode: o.errorCode }) }; },
    notFound(m, o)   { r.statusCode = 404; r.body = { error: m, ...(o?.errorCode && { errorCode: o.errorCode }) }; },
    forbidden(m, o)  { r.statusCode = 403; r.body = { error: m, ...(o?.errorCode && { errorCode: o.errorCode }) }; },
    unauthorized(m, o){ r.statusCode = 401; r.body = { error: m, ...(o?.errorCode && { errorCode: o.errorCode }) }; },
    writeHead(s, h) { r.statusCode = s; r.headers = h; },
    end(buf) { r.raw = buf; },
  };
  return r;
}
const requireAuth = (h) => async (req, res) => req.user ? h(req, res) : res.unauthorized('x', { errorCode: 'unauthorized' });
const requireRole = () => (h) => async (req, res) => h(req, res);

// In-memory leave fixture the mock store serves.
function makeStore(initial) {
  let leave = initial;
  let attData = null;
  return {
    _get: () => leave,
    create: (o) => { leave = { id: 'L1', status: 'pending', attachment: null, ...o }; return leave; },
    findById: (id) => (leave && leave.id === id ? leave : null),
    list: () => (leave ? [leave] : []),
    wouldExceedCap: () => ({ exceeds: false }),
    setAttachment: (id, m) => { attData = m.data; leave = { ...leave, attachment: { name: m.name, mime: m.mime, size: m.size } }; return leave; },
    removeAttachment: () => { attData = null; leave = { ...leave, attachment: null }; return leave; },
    readAttachment: (id) => (leave?.attachment ? { ...leave.attachment, data: attData } : null),
  };
}

function buildRouter(leavesStore) {
  const router = createRouter();
  registerLeaveRoutes(router, {
    leavesStore,
    usersStore: { list: () => [] },
    employeesStore: { list: () => [] },
    orgSettingsStore: { get: () => ({ leaves: { blockedRanges: [], concurrentAllowed: true } }) },
    leaveTypes: ['vacation', 'sick', 'appointment', 'other'],
    daysOf: () => 1,
    requireAuth, requireRole, auditStore: null,
  });
  return router;
}
async function hit(router, method, path, { user, body } = {}) {
  const m = router.match(method, path);
  assert.ok(m && m.handler, `${method} ${path} should be registered`);
  const res = mockRes();
  await m.handler({ user, params: m.params || {}, query: {}, body }, res);
  return res;
}

await test('POST /api/leaves multipart with a valid file attaches it', async () => {
  const ls = makeStore(null);
  const router = buildRouter(ls);
  const res = await hit(router, 'POST', '/api/leaves', {
    user: { id: 'emp-1', role: 'employee' },
    body: { fields: { type: 'vacation', unit: 'days', start: '2026-08-01', end: '2026-08-02' },
            files: [{ field: 'file', filename: 'note.pdf', contentType: 'application/pdf', data: PDF }] },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.leave.attachment.name, 'note.pdf');
});

await test('POST with oversize file → 400, leave not created', async () => {
  const ls = makeStore(null);
  const res = await hit(buildRouter(ls), 'POST', '/api/leaves', {
    user: { id: 'emp-1', role: 'employee' },
    body: { fields: { type: 'vacation', unit: 'days', start: '2026-08-01', end: '2026-08-02' },
            files: [{ field: 'file', filename: 'big.pdf', contentType: 'application/pdf', data: Buffer.alloc(5*1024*1024+1) }] },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.errorCode, 'attachment_too_large');
  assert.equal(ls._get(), null); // create() never ran
});

await test('POST with bad type → 400 attachment_bad_type', async () => {
  const res = await hit(buildRouter(makeStore(null)), 'POST', '/api/leaves', {
    user: { id: 'emp-1', role: 'employee' },
    body: { fields: { type: 'vacation', unit: 'days', start: '2026-08-01', end: '2026-08-02' },
            files: [{ field: 'file', filename: 'x.exe', contentType: 'application/octet-stream', data: PDF }] },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.errorCode, 'attachment_bad_type');
});

const OWNED = { id: 'L9', employeeId: 'emp-1', status: 'pending',
                type: 'vacation', unit: 'days', start: '2026-08-01', end: '2026-08-02',
                attachment: { name: 'doc.pdf', mime: 'application/pdf', size: PDF.length } };

await test('GET attachment: owner gets the file as a download', async () => {
  const ls = makeStore({ ...OWNED }); ls.setAttachment('L9', { name: 'doc.pdf', mime: 'application/pdf', size: PDF.length, data: PDF });
  const res = await hit(buildRouter(ls), 'GET', '/api/leaves/L9/attachment', { user: { id: 'emp-1', role: 'employee' } });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['Content-Disposition'], /^attachment;/);
  assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
  assert.deepEqual(res.raw, PDF);
});

await test('GET attachment: employer can download', async () => {
  const ls = makeStore({ ...OWNED }); ls.setAttachment('L9', { name: 'doc.pdf', mime: 'application/pdf', size: PDF.length, data: PDF });
  const res = await hit(buildRouter(ls), 'GET', '/api/leaves/L9/attachment', { user: { id: 'boss', role: 'employer' } });
  assert.equal(res.statusCode, 200);
});

await test('GET attachment: ANOTHER employee is forbidden (privacy)', async () => {
  const ls = makeStore({ ...OWNED }); ls.setAttachment('L9', { name: 'doc.pdf', mime: 'application/pdf', size: PDF.length, data: PDF });
  const res = await hit(buildRouter(ls), 'GET', '/api/leaves/L9/attachment', { user: { id: 'emp-2', role: 'employee' } });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.errorCode, 'forbidden');
});

await test('GET attachment: 404 when none', async () => {
  const ls = makeStore({ ...OWNED, attachment: null });
  const res = await hit(buildRouter(ls), 'GET', '/api/leaves/L9/attachment', { user: { id: 'emp-1', role: 'employee' } });
  assert.equal(res.statusCode, 404);
});

await test('PUT attachment: another employee forbidden', async () => {
  const ls = makeStore({ ...OWNED });
  const res = await hit(buildRouter(ls), 'PUT', '/api/leaves/L9/attachment', {
    user: { id: 'emp-2', role: 'employee' },
    body: { fields: {}, files: [{ field: 'file', filename: 'n.pdf', contentType: 'application/pdf', data: PDF }] },
  });
  assert.equal(res.statusCode, 403);
});

await test('PUT attachment: owner replaces (200)', async () => {
  const ls = makeStore({ ...OWNED });
  const res = await hit(buildRouter(ls), 'PUT', '/api/leaves/L9/attachment', {
    user: { id: 'emp-1', role: 'employee' },
    body: { fields: {}, files: [{ field: 'file', filename: 'n.png', contentType: 'image/png', data: PDF }] },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.leave.attachment.name, 'n.png');
});

await test('DELETE attachment: owner removes (200)', async () => {
  const ls = makeStore({ ...OWNED });
  const res = await hit(buildRouter(ls), 'DELETE', '/api/leaves/L9/attachment', { user: { id: 'emp-1', role: 'employee' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.leave.attachment, null);
});

await test('DELETE attachment: another employee forbidden', async () => {
  const ls = makeStore({ ...OWNED });
  const res = await hit(buildRouter(ls), 'DELETE', '/api/leaves/L9/attachment', { user: { id: 'emp-2', role: 'employee' } });
  assert.equal(res.statusCode, 403);
});

fs.rmSync(tmpDir, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
