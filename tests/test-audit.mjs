#!/usr/bin/env node
/**
 * Audit log storage tests.
 *
 * Run:  node tests/test-audit.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

import { createAuditStore, auditContext } from '../src/storage/audit.js';

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

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pica-audit-test-'));
}
function rmRf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

console.log('Audit store — basic operations');

await test('appendRecord + readMonth round-trip', () => {
  const tmp = tmpDir();
  try {
    const store = createAuditStore({ dataDir: tmp, masterKey: randomBytes(32) });
    store.appendRecord({
      event: 'auth.login_success',
      actorId: 'u1', actorUsername: 'alice', actorRole: 'employer', actorIp: '127.0.0.1',
    });
    const today = new Date();
    const recs = store.readMonth(today.getUTCFullYear(), today.getUTCMonth() + 1);
    assert.equal(recs.length, 1);
    assert.equal(recs[0].event, 'auth.login_success');
    assert.equal(recs[0].actorUsername, 'alice');
    assert.equal(recs[0].outcome, 'success'); // default
    assert.match(recs[0].ts, /^\d{4}-\d{2}-\d{2}T/);
  } finally { rmRf(tmp); }
});

await test('appendRecord stamps a default ts when missing', () => {
  const tmp = tmpDir();
  try {
    const store = createAuditStore({ dataDir: tmp, masterKey: randomBytes(32) });
    store.appendRecord({ event: 'test.event' });
    const today = new Date();
    const recs = store.readMonth(today.getUTCFullYear(), today.getUTCMonth() + 1);
    assert.equal(recs.length, 1);
    // Should be a recent ISO timestamp
    const ageMs = Date.now() - new Date(recs[0].ts).getTime();
    assert.ok(ageMs < 5000, 'ts should be very recent');
  } finally { rmRf(tmp); }
});

await test('appendRecord uses provided ts when given', () => {
  const tmp = tmpDir();
  try {
    const store = createAuditStore({ dataDir: tmp, masterKey: randomBytes(32) });
    store.appendRecord({ event: 'test.event', ts: '2025-01-15T12:00:00.000Z' });
    const recs = store.readMonth(2025, 1);
    // The file rotation uses now() not the record's ts; we override the
    // store's now() to put it in the right month.
    // Actually — re-read: pathFor() uses now(), so this record goes
    // into THIS month's file. But the ts field is preserved in the
    // record itself. Verify that.
    const today = new Date();
    const thisMonth = store.readMonth(today.getUTCFullYear(), today.getUTCMonth() + 1);
    assert.equal(thisMonth.length, 1);
    assert.equal(thisMonth[0].ts, '2025-01-15T12:00:00.000Z');
  } finally { rmRf(tmp); }
});

await test('multiple records append in order', () => {
  const tmp = tmpDir();
  try {
    const store = createAuditStore({ dataDir: tmp, masterKey: randomBytes(32) });
    for (let i = 0; i < 5; i++) {
      store.appendRecord({ event: 'test.seq', details: { i } });
    }
    const today = new Date();
    const recs = store.readMonth(today.getUTCFullYear(), today.getUTCMonth() + 1);
    assert.equal(recs.length, 5);
    for (let i = 0; i < 5; i++) {
      assert.equal(recs[i].details.i, i);
    }
  } finally { rmRf(tmp); }
});

await test('appendRecord with non-string event returns false', () => {
  const tmp = tmpDir();
  try {
    const store = createAuditStore({ dataDir: tmp, masterKey: randomBytes(32) });
    assert.equal(store.appendRecord({ event: '' }), false);
    assert.equal(store.appendRecord({}), false);
    assert.equal(store.appendRecord({ event: null }), false);
  } finally { rmRf(tmp); }
});

await test('appendRecord never throws on disk error (best-effort)', () => {
  const tmp = tmpDir();
  try {
    // Create a regular file at the path we'll point dataDir at, so the
    // first mkdirSync fails (can't create a dir where a file exists).
    const filePath = path.join(tmp, 'not-a-dir');
    fs.writeFileSync(filePath, 'i am a file');
    const errs = [];
    const logger = { error: (m) => errs.push(m), info: () => {}, warn: () => {} };
    const store = createAuditStore({
      dataDir: filePath,        // points to a file, not a dir → mkdir will fail
      masterKey: randomBytes(32),
      logger,
    });
    const result = store.appendRecord({ event: 'will.fail' });
    assert.equal(result, false);
    assert.ok(errs.length > 0, 'logger should have received an error');
  } finally { rmRf(tmp); }
});

console.log('');
console.log('Audit store — encryption properties');

await test('readMonth throws loudly on wrong masterKey', () => {
  const tmp = tmpDir();
  try {
    const realKey = randomBytes(32);
    const wrongKey = randomBytes(32);
    const store1 = createAuditStore({ dataDir: tmp, masterKey: realKey });
    store1.appendRecord({ event: 'auth.login_success', actorUsername: 'alice' });

    const store2 = createAuditStore({ dataDir: tmp, masterKey: wrongKey });
    const today = new Date();
    assert.throws(
      () => store2.readMonth(today.getUTCFullYear(), today.getUTCMonth() + 1),
      /audit read failed/,
    );
  } finally { rmRf(tmp); }
});

await test('two records of same content produce different ciphertexts (per-record IV)', () => {
  const tmp = tmpDir();
  try {
    const store = createAuditStore({ dataDir: tmp, masterKey: randomBytes(32) });
    store.appendRecord({ event: 'test.event', actorUsername: 'alice' });
    store.appendRecord({ event: 'test.event', actorUsername: 'alice' });
    const today = new Date();
    const file = path.join(tmp, 'audit', String(today.getUTCFullYear()),
                            String(today.getUTCMonth() + 1).padStart(2, '0') + '.ndjson.enc');
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 2);
    assert.notEqual(lines[0], lines[1], 'same plaintext must produce different ciphertexts');
  } finally { rmRf(tmp); }
});

await test('tampering with a single line corrupts only that record on read', () => {
  const tmp = tmpDir();
  try {
    const store = createAuditStore({ dataDir: tmp, masterKey: randomBytes(32) });
    store.appendRecord({ event: 'first', actorUsername: 'alice' });
    store.appendRecord({ event: 'second', actorUsername: 'bob' });

    const today = new Date();
    const file = path.join(tmp, 'audit', String(today.getUTCFullYear()),
                            String(today.getUTCMonth() + 1).padStart(2, '0') + '.ndjson.enc');
    const original = fs.readFileSync(file, 'utf8');
    const lines = original.split('\n');
    // Replace 8 chars in the middle of line 0 with different base64 chars.
    // Targeting the middle ensures we're in the ciphertext, not the IV
    // prefix or the trailing tag/padding.
    const mid = Math.floor(lines[0].length / 2);
    const tampered = lines[0].slice(0, mid) + 'AAAAAAAA' + lines[0].slice(mid + 8);
    assert.notEqual(tampered, lines[0], 'sanity: tamper actually changed the line');
    const newContent = [tampered, lines[1], ''].join('\n');
    fs.writeFileSync(file, newContent);

    assert.throws(
      () => store.readMonth(today.getUTCFullYear(), today.getUTCMonth() + 1),
      /line 1/,
    );
  } finally { rmRf(tmp); }
});

console.log('');
console.log('Audit store — list / paths / context');

await test('listMonths returns nothing for an empty dataDir', () => {
  const tmp = tmpDir();
  try {
    const store = createAuditStore({ dataDir: tmp, masterKey: randomBytes(32) });
    assert.deepEqual(store.listMonths(), []);
  } finally { rmRf(tmp); }
});

await test('listMonths returns the months that have files', () => {
  const tmp = tmpDir();
  try {
    const store = createAuditStore({ dataDir: tmp, masterKey: randomBytes(32) });
    store.appendRecord({ event: 'test.event' });
    const months = store.listMonths();
    assert.equal(months.length, 1);
    const today = new Date();
    assert.equal(months[0].year, today.getUTCFullYear());
    assert.equal(months[0].month, today.getUTCMonth() + 1);
  } finally { rmRf(tmp); }
});

await test('readMonth returns [] for a month with no file', () => {
  const tmp = tmpDir();
  try {
    const store = createAuditStore({ dataDir: tmp, masterKey: randomBytes(32) });
    assert.deepEqual(store.readMonth(2020, 1), []);
  } finally { rmRf(tmp); }
});

await test('auditContext extracts fields from req.user and req.socket', () => {
  const ctx = auditContext({
    user: { id: 'u1', username: 'alice', role: 'employer' },
    socket: { remoteAddress: '10.0.0.1' },
  });
  assert.deepEqual(ctx, {
    actorId: 'u1', actorUsername: 'alice', actorRole: 'employer', actorIp: '10.0.0.1',
  });
});

await test('auditContext handles unauthenticated requests gracefully', () => {
  const ctx = auditContext({ socket: { remoteAddress: '10.0.0.1' } });
  assert.equal(ctx.actorId, null);
  assert.equal(ctx.actorUsername, null);
  assert.equal(ctx.actorRole, null);
  assert.equal(ctx.actorIp, '10.0.0.1');
});

await test('auditContext defaults actorIp to "unknown" if socket missing', () => {
  const ctx = auditContext({ user: { id: 'u1', username: 'alice', role: 'employer' } });
  assert.equal(ctx.actorIp, 'unknown');
});

console.log('');
console.log('Audit store — constructor validation');

await test('createAuditStore rejects non-Buffer masterKey', () => {
  const tmp = tmpDir();
  try {
    assert.throws(
      () => createAuditStore({ dataDir: tmp, masterKey: 'not-a-buffer' }),
      /must be a 32-byte Buffer/,
    );
  } finally { rmRf(tmp); }
});

await test('createAuditStore rejects wrong-length Buffer masterKey', () => {
  const tmp = tmpDir();
  try {
    assert.throws(
      () => createAuditStore({ dataDir: tmp, masterKey: randomBytes(16) }),
      /must be a 32-byte Buffer/,
    );
  } finally { rmRf(tmp); }
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
