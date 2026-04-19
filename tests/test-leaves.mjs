#!/usr/bin/env node
/**
 * M5 smoke tests — leaves storage layer.
 * Built-in `assert` only.
 *
 * Run:  node tests/test-leaves.mjs
 */

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createLeavesStore } from '../src/storage/leaves.js';

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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-leaves-'));
const masterKey = randomBytes(32);

try {
  const store = createLeavesStore(tmpDir, masterKey);
  const aliceId = 'alice-uuid';
  const bobId   = 'bob-uuid';
  const adminId = 'admin-uuid';

  // ---------------------------------------------------------------------------
  console.log('Construction');
  // ---------------------------------------------------------------------------

  await test('requires a 32-byte master key', () => {
    assert.throws(() => createLeavesStore(tmpDir, randomBytes(16)));
  });

  await test('creates leaves directory', () => {
    assert.ok(fs.existsSync(path.join(tmpDir, 'leaves')));
  });

  // ---------------------------------------------------------------------------
  console.log('\nCreate — validation');
  // ---------------------------------------------------------------------------

  await test('rejects unknown type', () => {
    assert.throws(() => store.create({
      employeeId: aliceId, type: 'fishing', unit: 'days',
      start: '2026-05-01', end: '2026-05-03',
    }));
  });

  await test('rejects unknown unit', () => {
    assert.throws(() => store.create({
      employeeId: aliceId, type: 'vacation', unit: 'weeks',
      start: '2026-05-01', end: '2026-05-03',
    }));
  });

  await test('days mode requires YYYY-MM-DD dates', () => {
    assert.throws(() => store.create({
      employeeId: aliceId, type: 'vacation', unit: 'days',
      start: '2026-5-1', end: '2026-05-03',
    }));
  });

  await test('days mode rejects start > end', () => {
    assert.throws(() => store.create({
      employeeId: aliceId, type: 'vacation', unit: 'days',
      start: '2026-05-10', end: '2026-05-01',
    }));
  });

  await test('hours mode rejects start >= end', () => {
    assert.throws(() => store.create({
      employeeId: aliceId, type: 'appointment', unit: 'hours',
      start: '2026-05-01T10:00:00Z', end: '2026-05-01T10:00:00Z',
    }));
  });

  await test('missing employeeId is rejected', () => {
    assert.throws(() => store.create({
      type: 'vacation', unit: 'days',
      start: '2026-05-01', end: '2026-05-02',
    }));
  });

  // ---------------------------------------------------------------------------
  console.log('\nCreate — happy path');
  // ---------------------------------------------------------------------------

  let vacation;
  await test('create returns a pending leave with a UUID', () => {
    vacation = store.create({
      employeeId: aliceId,
      type: 'vacation', unit: 'days',
      start: '2026-07-01', end: '2026-07-10',
      reason: 'Summer trip to the Algarve',
    });
    assert.ok(vacation.id);
    assert.equal(vacation.status, 'pending');
    assert.equal(vacation.employeeId, aliceId);
    assert.equal(vacation.type, 'vacation');
    assert.equal(vacation.unit, 'days');
    assert.equal(vacation.start, '2026-07-01');
    assert.equal(vacation.end, '2026-07-10');
    assert.equal(vacation.reason, 'Summer trip to the Algarve');
    assert.ok(vacation.createdAt);
  });

  await test('reason is NOT visible on disk (encrypted at rest)', () => {
    const parts = store.listPartitions();
    assert.ok(parts.length >= 1);
    // Check every partition file.
    for (const { year, month } of parts) {
      const raw = fs.readFileSync(store.paths.monthFile(year, month), 'utf8');
      assert.equal(raw.includes('Summer trip to the Algarve'), false);
    }
  });

  await test('plaintext fields (type, start, end) ARE visible on disk', () => {
    const parts = store.listPartitions();
    const raw = fs.readFileSync(store.paths.monthFile(parts[0].year, parts[0].month), 'utf8');
    assert.match(raw, /"type":"vacation"/);
    assert.match(raw, /"start":"2026-07-01"/);
    assert.match(raw, /"end":"2026-07-10"/);
  });

  await test('findById returns the leave including decrypted reason', () => {
    const found = store.findById(vacation.id);
    assert.ok(found);
    assert.equal(found.reason, 'Summer trip to the Algarve');
  });

  await test('findById returns null for unknown id', () => {
    assert.equal(store.findById('no-such-id'), null);
  });

  // ---------------------------------------------------------------------------
  console.log('\nHours-mode leaves');
  // ---------------------------------------------------------------------------

  let doctor;
  await test('hours-mode leave created with hours payload', () => {
    doctor = store.create({
      employeeId: aliceId,
      type: 'appointment', unit: 'hours',
      start: '2026-05-14T14:00:00Z',
      end: '2026-05-14T16:00:00Z',
      hours: 2,
    });
    assert.equal(doctor.unit, 'hours');
    assert.equal(doctor.hours, 2);
  });

  // ---------------------------------------------------------------------------
  console.log('\nWorkflow transitions');
  // ---------------------------------------------------------------------------

  await test('approve: pending → approved, records actor and timestamp', () => {
    const r = store.approve(vacation.id, adminId);
    assert.equal(r.status, 'approved');
    assert.equal(r.decidedBy, adminId);
    assert.ok(r.decidedAt);
  });

  await test('cannot approve an already-approved leave', () => {
    assert.throws(() => store.approve(vacation.id, adminId), /approved/);
  });

  await test('cannot reject an already-approved leave', () => {
    assert.throws(() => store.reject(vacation.id, adminId, 'too late'), /approved/);
  });

  await test('can cancel an approved leave', () => {
    const r = store.cancel(vacation.id, adminId);
    assert.equal(r.status, 'cancelled');
    assert.equal(r.cancelledBy, adminId);
    assert.ok(r.cancelledAt);
    // Decision timestamps are preserved.
    assert.equal(r.decidedBy, adminId);
  });

  await test('cannot cancel a cancelled leave', () => {
    assert.throws(() => store.cancel(vacation.id, adminId), /cancelled/);
  });

  let sick;
  await test('reject: pending → rejected, notes encrypted and readable', () => {
    sick = store.create({
      employeeId: bobId, type: 'sick', unit: 'days',
      start: '2026-05-01', end: '2026-05-01',
      reason: 'flu',
    });
    const r = store.reject(sick.id, adminId, 'Doctor note required — please resubmit');
    assert.equal(r.status, 'rejected');
    assert.equal(r.decidedBy, adminId);
    assert.equal(r.notes, 'Doctor note required — please resubmit');
  });

  await test('rejected notes are NOT visible on disk', () => {
    const parts = store.listPartitions();
    for (const { year, month } of parts) {
      const raw = fs.readFileSync(store.paths.monthFile(year, month), 'utf8');
      assert.equal(raw.includes('Doctor note required'), false);
    }
  });

  await test('cannot cancel a rejected leave', () => {
    assert.throws(() => store.cancel(sick.id, adminId), /rejected/);
  });

  // ---------------------------------------------------------------------------
  console.log('\nList + filter');
  // ---------------------------------------------------------------------------

  await test('list returns all leaves newest-first', () => {
    const all = store.list();
    assert.equal(all.length, 3); // vacation, doctor, sick
    for (let i = 1; i < all.length; i++) {
      assert.ok(all[i - 1].createdAt >= all[i].createdAt);
    }
  });

  await test('list can filter by employeeId', () => {
    const alice = store.list({ employeeId: aliceId });
    assert.equal(alice.length, 2);
    assert.ok(alice.every((l) => l.employeeId === aliceId));

    const bob = store.list({ employeeId: bobId });
    assert.equal(bob.length, 1);
    assert.equal(bob[0].employeeId, bobId);
  });

  // ---------------------------------------------------------------------------
  console.log('\nAAD binding — tamper detection');
  // ---------------------------------------------------------------------------

  await test('swapping enc fields between leaves fails decryption', () => {
    // Create two leaves with distinct reasons in the same partition.
    const a = store.create({
      employeeId: aliceId, type: 'vacation', unit: 'days',
      start: '2026-08-01', end: '2026-08-02', reason: 'AAA secret reason',
    });
    const b = store.create({
      employeeId: bobId, type: 'vacation', unit: 'days',
      start: '2026-08-03', end: '2026-08-04', reason: 'BBB secret reason',
    });

    // Hand-rewrite the file, swapping the enc fields of the two created events.
    const parts = store.listPartitions();
    const newest = parts[parts.length - 1];
    const file = store.paths.monthFile(newest.year, newest.month);
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    const parsed = lines.map((l) => JSON.parse(l));

    const aLine = parsed.find((ev) => ev.id === a.id && ev.event === 'created');
    const bLine = parsed.find((ev) => ev.id === b.id && ev.event === 'created');
    const tmp = aLine.enc; aLine.enc = bLine.enc; bLine.enc = tmp;

    fs.writeFileSync(file, parsed.map((l) => JSON.stringify(l)).join('\n') + '\n');

    // After swap, reasons should be null (decryption failed silently),
    // everything else still works.
    const aAfter = store.findById(a.id);
    const bAfter = store.findById(b.id);
    assert.equal(aAfter.reason, null);
    assert.equal(bAfter.reason, null);
    assert.equal(aAfter.type, 'vacation');
    assert.equal(bAfter.type, 'vacation');
  });

  // ---------------------------------------------------------------------------
  console.log('\nCorruption tolerance');
  // ---------------------------------------------------------------------------

  await test('corrupt lines are dropped without breaking the file', () => {
    const parts = store.listPartitions();
    const file = store.paths.monthFile(parts[0].year, parts[0].month);
    const original = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, original + 'garbage not-json line\n');
    // list() still works, returns the same count.
    const after = store.list();
    assert.ok(after.length > 0);
    fs.writeFileSync(file, original);
  });

  // ---------------------------------------------------------------------------
  console.log('\nPersistence across store instances');
  // ---------------------------------------------------------------------------

  await test('second store with same key reads leaves', () => {
    const fresh = createLeavesStore(tmpDir, masterKey);
    const all = fresh.list();
    assert.ok(all.length >= 3);
  });

  await test('second store with different key can still read status/dates', () => {
    const wrong = createLeavesStore(tmpDir, randomBytes(32));
    const all = wrong.list();
    assert.ok(all.length >= 3);
    // Plaintext fields preserved for reports.
    const first = all[0];
    assert.ok(first.status);
    assert.ok(first.type);
    assert.ok(first.start);
    // Reason lost — this is by design.
    assert.equal(first.reason, null);
  });

} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
