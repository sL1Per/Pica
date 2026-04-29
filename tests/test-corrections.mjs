#!/usr/bin/env node
/**
 * Corrections storage layer tests.
 * Built-in `assert` only.
 *
 * Run:  node tests/test-corrections.mjs
 */

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createCorrectionsStore } from '../src/storage/corrections.js';

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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-corrections-'));
const masterKey = randomBytes(32);

try {
  console.log('create + validation');

  await test('creates a pending correction with justification', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-cor-c1-'));
    try {
      const s = createCorrectionsStore(dir, masterKey);
      const c = s.create({
        employeeId: 'alice',
        start: '2026-04-20T09:00:00Z',
        end: '2026-04-20T11:00:00Z',
        justification: 'forgot phone',
      });
      assert.equal(c.status, 'pending');
      assert.equal(c.employeeId, 'alice');
      assert.equal(c.hours, 2);
      assert.equal(c.isJustified, true);
      assert.equal(c.justification, 'forgot phone');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('creates a pending correction without justification', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-cor-c2-'));
    try {
      const s = createCorrectionsStore(dir, masterKey);
      const c = s.create({
        employeeId: 'alice',
        start: '2026-04-20T09:00:00Z',
        end: '2026-04-20T11:30:00Z',
      });
      assert.equal(c.isJustified, false);
      assert.equal(c.justification, null);
      assert.equal(c.hours, 2.5);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('rejects empty start/end', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-cor-c3-'));
    try {
      const s = createCorrectionsStore(dir, masterKey);
      assert.throws(() => s.create({ employeeId: 'alice' }), /start and end are required/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('rejects end before start', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-cor-c4-'));
    try {
      const s = createCorrectionsStore(dir, masterKey);
      assert.throws(() => s.create({
        employeeId: 'alice',
        start: '2026-04-20T11:00:00Z',
        end: '2026-04-20T09:00:00Z',
      }), /end must be after start/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('rejects window > 24 hours', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-cor-c5-'));
    try {
      const s = createCorrectionsStore(dir, masterKey);
      assert.throws(() => s.create({
        employeeId: 'alice',
        start: '2026-04-20T09:00:00Z',
        end: '2026-04-21T10:00:00Z',
      }), /cannot exceed 24 hours/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('rejects window < 1 minute', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-cor-c6-'));
    try {
      const s = createCorrectionsStore(dir, masterKey);
      assert.throws(() => s.create({
        employeeId: 'alice',
        start: '2026-04-20T09:00:00Z',
        end: '2026-04-20T09:00:30Z',
      }), /at least 1 minute/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('justification truncated at 500 chars', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-cor-c7-'));
    try {
      const s = createCorrectionsStore(dir, masterKey);
      const long = 'x'.repeat(600);
      const c = s.create({
        employeeId: 'alice',
        start: '2026-04-20T09:00:00Z',
        end: '2026-04-20T10:00:00Z',
        justification: long,
      });
      assert.equal(c.justification.length, 500);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------

  console.log('\nlist + read');

  await test('lists own corrections only when filtering by employeeId', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-cor-l1-'));
    try {
      const s = createCorrectionsStore(dir, masterKey);
      s.create({ employeeId: 'alice', start: '2026-04-20T09:00:00Z', end: '2026-04-20T10:00:00Z' });
      s.create({ employeeId: 'bob',   start: '2026-04-20T09:00:00Z', end: '2026-04-20T10:00:00Z' });
      const a = s.list({ employeeId: 'alice' });
      const b = s.list({ employeeId: 'bob' });
      assert.equal(a.length, 1);
      assert.equal(b.length, 1);
      assert.equal(a[0].employeeId, 'alice');
      assert.equal(b[0].employeeId, 'bob');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('list with status filter', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-cor-l2-'));
    try {
      const s = createCorrectionsStore(dir, masterKey);
      const c1 = s.create({ employeeId: 'alice', start: '2026-04-20T09:00:00Z', end: '2026-04-20T10:00:00Z' });
      s.approve(c1.id, 'admin');
      s.create({ employeeId: 'alice', start: '2026-04-21T09:00:00Z', end: '2026-04-21T10:00:00Z' });
      assert.equal(s.list({ status: 'pending' }).length, 1);
      assert.equal(s.list({ status: 'approved' }).length, 1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('list returns newest first', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-cor-l3-'));
    try {
      const s = createCorrectionsStore(dir, masterKey);
      const c1 = s.create({ employeeId: 'alice', start: '2026-04-20T09:00:00Z', end: '2026-04-20T10:00:00Z' });
      // Sleep imperceptibly to ensure distinct createdAt timestamps.
      const ts1 = Date.parse(c1.createdAt);
      while (Date.now() === ts1) { /* spin */ }
      const c2 = s.create({ employeeId: 'alice', start: '2026-04-21T09:00:00Z', end: '2026-04-21T10:00:00Z' });
      const list = s.list({});
      assert.equal(list[0].id, c2.id);
      assert.equal(list[1].id, c1.id);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------

  console.log('\ntransitions');

  await test('pending → approved', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-cor-t1-'));
    try {
      const s = createCorrectionsStore(dir, masterKey);
      const c = s.create({ employeeId: 'alice', start: '2026-04-20T09:00:00Z', end: '2026-04-20T11:00:00Z' });
      const after = s.approve(c.id, 'admin');
      assert.equal(after.status, 'approved');
      assert.equal(after.decidedBy, 'admin');
      assert.ok(after.decidedAt);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('pending → rejected with notes (encrypted)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-cor-t2-'));
    try {
      const s = createCorrectionsStore(dir, masterKey);
      const c = s.create({ employeeId: 'alice', start: '2026-04-20T09:00:00Z', end: '2026-04-20T10:00:00Z' });
      const after = s.reject(c.id, 'admin', 'no evidence');
      assert.equal(after.status, 'rejected');
      assert.equal(after.notes, 'no evidence');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('pending → cancelled', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-cor-t3-'));
    try {
      const s = createCorrectionsStore(dir, masterKey);
      const c = s.create({ employeeId: 'alice', start: '2026-04-20T09:00:00Z', end: '2026-04-20T10:00:00Z' });
      const after = s.cancel(c.id, 'alice');
      assert.equal(after.status, 'cancelled');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('approved → cancelled allowed (e.g. employer reverses)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-cor-t4-'));
    try {
      const s = createCorrectionsStore(dir, masterKey);
      const c = s.create({ employeeId: 'alice', start: '2026-04-20T09:00:00Z', end: '2026-04-20T10:00:00Z' });
      s.approve(c.id, 'admin');
      const after = s.cancel(c.id, 'admin');
      assert.equal(after.status, 'cancelled');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('rejected → approved is illegal', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-cor-t5-'));
    try {
      const s = createCorrectionsStore(dir, masterKey);
      const c = s.create({ employeeId: 'alice', start: '2026-04-20T09:00:00Z', end: '2026-04-20T10:00:00Z' });
      s.reject(c.id, 'admin');
      assert.throws(() => s.approve(c.id, 'admin'), /Cannot approved a correction in status 'rejected'/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('approved → approved is illegal (idempotency at storage layer)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-cor-t6-'));
    try {
      const s = createCorrectionsStore(dir, masterKey);
      const c = s.create({ employeeId: 'alice', start: '2026-04-20T09:00:00Z', end: '2026-04-20T10:00:00Z' });
      s.approve(c.id, 'admin');
      assert.throws(() => s.approve(c.id, 'admin'), /Cannot approved/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------

  console.log('\nencryption');

  await test('justification persists across store restart with same key', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-cor-e1-'));
    try {
      const s1 = createCorrectionsStore(dir, masterKey);
      const c = s1.create({
        employeeId: 'alice',
        start: '2026-04-20T09:00:00Z',
        end: '2026-04-20T10:00:00Z',
        justification: 'sensitive: doctor visit',
      });
      const s2 = createCorrectionsStore(dir, masterKey);
      const got = s2.findById(c.id);
      assert.equal(got.justification, 'sensitive: doctor visit');
      assert.equal(got.isJustified, true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('justification cannot be decrypted with wrong key', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-cor-e2-'));
    try {
      const s1 = createCorrectionsStore(dir, masterKey);
      const c = s1.create({
        employeeId: 'alice',
        start: '2026-04-20T09:00:00Z',
        end: '2026-04-20T10:00:00Z',
        justification: 'top secret',
      });
      const wrongKey = randomBytes(32);
      const s2 = createCorrectionsStore(dir, wrongKey);
      const got = s2.findById(c.id);
      // Storage marks the record as decrypt-failed but doesn't crash.
      assert.equal(got.justification, null);
      assert.equal(got._decryptFailed, true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------

  console.log('\ncomputeBank');

  await test('bank is 0 when no approved corrections', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-cor-b1-'));
    try {
      const s = createCorrectionsStore(dir, masterKey);
      assert.equal(s.computeBank({ userId: 'alice' }), 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('bank includes approved unjustified corrections only', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-cor-b2-'));
    try {
      const s = createCorrectionsStore(dir, masterKey);
      // Three corrections of 2h each: justified, unjustified, unjustified.
      const c1 = s.create({ employeeId: 'alice', start: '2026-04-20T09:00:00Z', end: '2026-04-20T11:00:00Z', justification: 'ok' });
      const c2 = s.create({ employeeId: 'alice', start: '2026-04-21T09:00:00Z', end: '2026-04-21T11:00:00Z' });
      const c3 = s.create({ employeeId: 'alice', start: '2026-04-22T09:00:00Z', end: '2026-04-22T11:00:00Z' });
      s.approve(c1.id, 'admin');
      s.approve(c2.id, 'admin');
      s.approve(c3.id, 'admin');
      // Expected bank: 0 + 2 + 2 = 4.
      assert.equal(s.computeBank({ userId: 'alice' }), 4);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('bank ignores pending and rejected', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-cor-b3-'));
    try {
      const s = createCorrectionsStore(dir, masterKey);
      s.create({ employeeId: 'alice', start: '2026-04-20T09:00:00Z', end: '2026-04-20T11:00:00Z' }); // pending — ignored
      const c2 = s.create({ employeeId: 'alice', start: '2026-04-21T09:00:00Z', end: '2026-04-21T11:00:00Z' });
      s.reject(c2.id, 'admin');
      assert.equal(s.computeBank({ userId: 'alice' }), 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('bank ignores cancelled approved corrections', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-cor-b4-'));
    try {
      const s = createCorrectionsStore(dir, masterKey);
      const c = s.create({ employeeId: 'alice', start: '2026-04-20T09:00:00Z', end: '2026-04-20T11:00:00Z' });
      s.approve(c.id, 'admin');
      assert.equal(s.computeBank({ userId: 'alice' }), 2);
      s.cancel(c.id, 'admin');
      assert.equal(s.computeBank({ userId: 'alice' }), 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('bank scopes by userId — bob does not see alice', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-cor-b5-'));
    try {
      const s = createCorrectionsStore(dir, masterKey);
      const c1 = s.create({ employeeId: 'alice', start: '2026-04-20T09:00:00Z', end: '2026-04-20T11:00:00Z' });
      s.approve(c1.id, 'admin');
      assert.equal(s.computeBank({ userId: 'alice' }), 2);
      assert.equal(s.computeBank({ userId: 'bob' }), 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('bank handles fractional hours correctly', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-cor-b6-'));
    try {
      const s = createCorrectionsStore(dir, masterKey);
      const c = s.create({ employeeId: 'alice', start: '2026-04-20T09:00:00Z', end: '2026-04-20T09:30:00Z' });
      s.approve(c.id, 'admin');
      assert.equal(s.computeBank({ userId: 'alice' }), 0.5);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('bank requires userId', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-cor-b7-'));
    try {
      const s = createCorrectionsStore(dir, masterKey);
      assert.throws(() => s.computeBank({}), /userId/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
