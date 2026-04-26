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

  // ---------------------------------------------------------------------------
  console.log('\ncomputeBalances');
  // ---------------------------------------------------------------------------
  // Use an isolated directory so leaves from earlier tests don't interfere.
  const balDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-leaves-bal-'));
  try {
    const bstore = createLeavesStore(balDir, masterKey);
    // Inline helper matching approxDaysOff (hours/8, inclusive day count).
    const daysOf = (l) => {
      if (l.unit === 'hours') return (typeof l.hours === 'number') ? l.hours / 8 : 0;
      const s = new Date(l.start + 'T00:00:00Z').getTime();
      const e = new Date(l.end   + 'T00:00:00Z').getTime();
      return Math.round((e - s) / 86_400_000) + 1;
    };
    const types = ['vacation', 'sick', 'appointment', 'other'];
    const baseSettings = {
      leaves: {
        defaultAllowances: { vacation: 20, sick: 10, appointment: 3, other: 2 },
        perEmployeeOverrides: {},
      },
    };

    // Fixtures — Alice has vacation:pending(5), vacation:approved(2), sick:rejected(1d hours), sick:cancelled(2).
    const l1 = bstore.create({ employeeId: aliceId, type: 'vacation', unit: 'days', start: '2026-03-01', end: '2026-03-05' });
    const l2 = bstore.create({ employeeId: aliceId, type: 'vacation', unit: 'days', start: '2026-06-10', end: '2026-06-11' });
    bstore.approve(l2.id, adminId);
    const l3 = bstore.create({ employeeId: aliceId, type: 'sick', unit: 'hours', start: '2026-04-01T08:00:00Z', end: '2026-04-01T16:00:00Z', hours: 8 });
    bstore.reject(l3.id, adminId, 'no');
    const l4 = bstore.create({ employeeId: aliceId, type: 'sick', unit: 'days', start: '2026-05-01', end: '2026-05-02' });
    bstore.approve(l4.id, adminId);
    bstore.cancel(l4.id, adminId);
    // Different year — must be excluded.
    bstore.create({ employeeId: aliceId, type: 'vacation', unit: 'days', start: '2025-12-28', end: '2025-12-30' });
    // Different employee — must be excluded.
    bstore.create({ employeeId: bobId, type: 'vacation', unit: 'days', start: '2026-07-01', end: '2026-07-05' });

    await test('baseline balance: pending + booked counted, rejected + cancelled excluded', () => {
      const out = bstore.computeBalances({ userId: aliceId, year: 2026, orgSettings: baseSettings, leaveTypes: types, daysOf });
      const vac = out.find((b) => b.type === 'vacation');
      assert.equal(vac.allowance, 20);
      assert.equal(vac.pending, 5);
      assert.equal(vac.booked, 2);
      assert.equal(vac.remaining, 13);
      const sick = out.find((b) => b.type === 'sick');
      assert.equal(sick.pending, 0);
      assert.equal(sick.booked, 0);
      assert.equal(sick.remaining, 10);
    });

    await test('per-employee override beats default allowance', () => {
      const settings = { leaves: { ...baseSettings.leaves, perEmployeeOverrides: { [aliceId]: { vacation: 25 } } } };
      const out = bstore.computeBalances({ userId: aliceId, year: 2026, orgSettings: settings, leaveTypes: types, daysOf });
      const vac = out.find((b) => b.type === 'vacation');
      assert.equal(vac.allowance, 25);
      assert.equal(vac.remaining, 18);
      // Unrelated types unchanged.
      assert.equal(out.find((b) => b.type === 'sick').allowance, 10);
    });

    await test('leaves in a different year are excluded', () => {
      const out = bstore.computeBalances({ userId: aliceId, year: 2025, orgSettings: baseSettings, leaveTypes: types, daysOf });
      const vac = out.find((b) => b.type === 'vacation');
      assert.equal(vac.pending, 3); // the 2025-12-28..30 leave, still pending
      assert.equal(vac.booked, 0);
    });

    await test('one user\'s leaves do not bleed into another\'s balance', () => {
      const out = bstore.computeBalances({ userId: bobId, year: 2026, orgSettings: baseSettings, leaveTypes: types, daysOf });
      const vac = out.find((b) => b.type === 'vacation');
      assert.equal(vac.pending, 5); // bob's own pending leave
      assert.equal(vac.booked, 0);
    });

    await test('hours-unit leave is counted as hours/8 days', () => {
      // Fresh store isolates this leave from the others.
      const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-leaves-bal2-'));
      try {
        const s = createLeavesStore(d, masterKey);
        const h = s.create({ employeeId: aliceId, type: 'appointment', unit: 'hours', start: '2026-02-01T09:00:00Z', end: '2026-02-01T13:00:00Z', hours: 4 });
        s.approve(h.id, adminId);
        const out = s.computeBalances({ userId: aliceId, year: 2026, orgSettings: baseSettings, leaveTypes: types, daysOf });
        const app = out.find((b) => b.type === 'appointment');
        assert.equal(app.booked, 0.5);
        assert.equal(app.remaining, 2.5);
      } finally {
        fs.rmSync(d, { recursive: true, force: true });
      }
    });

    await test('unknown type in override is ignored (not returned)', () => {
      const settings = { leaves: { ...baseSettings.leaves, perEmployeeOverrides: { [aliceId]: { sabbatical: 99 } } } };
      const out = bstore.computeBalances({ userId: aliceId, year: 2026, orgSettings: settings, leaveTypes: types, daysOf });
      assert.equal(out.find((b) => b.type === 'sabbatical'), undefined);
      assert.equal(out.length, 4);
    });

    await test('remaining can go negative when overbooked', () => {
      const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-leaves-bal3-'));
      try {
        const s = createLeavesStore(d, masterKey);
        // Two-year-stretching accrual not supported yet; all in-year.
        for (let i = 0; i < 3; i++) {
          const l = s.create({ employeeId: aliceId, type: 'vacation', unit: 'days', start: `2026-0${i + 1}-01`, end: `2026-0${i + 1}-10` });
          s.approve(l.id, adminId);
        }
        const settings = { leaves: { defaultAllowances: { vacation: 5, sick: 0, appointment: 0, other: 0 }, perEmployeeOverrides: {} } };
        const out = s.computeBalances({ userId: aliceId, year: 2026, orgSettings: settings, leaveTypes: types, daysOf });
        const vac = out.find((b) => b.type === 'vacation');
        assert.equal(vac.booked, 30);
        assert.equal(vac.remaining, -25);
      } finally {
        fs.rmSync(d, { recursive: true, force: true });
      }
    });

    await test('missing userId throws', () => {
      assert.throws(() => bstore.computeBalances({ year: 2026, orgSettings: baseSettings, leaveTypes: types, daysOf }), /userId/);
    });

    await test('non-integer year throws', () => {
      assert.throws(() => bstore.computeBalances({ userId: aliceId, year: 2026.5, orgSettings: baseSettings, leaveTypes: types, daysOf }), /year/);
    });
  } finally {
    fs.rmSync(balDir, { recursive: true, force: true });
  }

  // --------------------------------------------------------------------------

  console.log('\nwouldExceedCap');

  const capDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-leaves-cap-'));
  try {
    const cstore = createLeavesStore(capDir, masterKey);
    const types = ['vacation', 'sick', 'appointment', 'other'];
    const daysOf = (l) => {
      if (l.unit === 'hours') return (typeof l.hours === 'number') ? l.hours / 8 : 0;
      const s = new Date(l.start + 'T00:00:00Z').getTime();
      const e = new Date(l.end   + 'T00:00:00Z').getTime();
      return Math.round((e - s) / 86_400_000) + 1;
    };
    const settings = {
      leaves: {
        defaultAllowances: { vacation: 10, sick: 0, appointment: 5, other: 0 },
        perEmployeeOverrides: {},
      },
    };

    await test('allowance===0 means unlimited (never exceeds)', () => {
      const out = cstore.wouldExceedCap({
        userId: aliceId, type: 'sick', additionalDays: 1000,
        year: 2026, orgSettings: settings, leaveTypes: types, daysOf,
      });
      assert.equal(out.exceeds, false);
      assert.equal(out.allowance, 0);
    });

    await test('positive cap allows exactly up to the limit', () => {
      const out = cstore.wouldExceedCap({
        userId: aliceId, type: 'vacation', additionalDays: 10,
        year: 2026, orgSettings: settings, leaveTypes: types, daysOf,
      });
      assert.equal(out.exceeds, false);
      assert.equal(out.wouldBe, 10);
    });

    await test('positive cap rejects beyond the limit', () => {
      const out = cstore.wouldExceedCap({
        userId: aliceId, type: 'vacation', additionalDays: 11,
        year: 2026, orgSettings: settings, leaveTypes: types, daysOf,
      });
      assert.equal(out.exceeds, true);
      assert.equal(out.allowance, 10);
      assert.equal(out.wouldBe, 11);
    });

    await test('cap counts approved (booked) leaves only, not pending', () => {
      // Approve 7 vacation days, leave 5 pending. Adding 4 more should NOT
      // exceed because 7 (booked) + 4 = 11 > 10 → does exceed (booked counts).
      // Adding 3 should be OK because 7 + 3 = 10 → not exceed.
      // Pending 5 is irrelevant to wouldExceedCap.
      const u = 'cap-user-1';
      const a = cstore.create({ employeeId: u, type: 'vacation', unit: 'days', start: '2026-02-01', end: '2026-02-07' });
      cstore.approve(a.id, adminId);
      cstore.create({ employeeId: u, type: 'vacation', unit: 'days', start: '2026-08-01', end: '2026-08-05' }); // pending
      const ok = cstore.wouldExceedCap({ userId: u, type: 'vacation', additionalDays: 3, year: 2026, orgSettings: settings, leaveTypes: types, daysOf });
      assert.equal(ok.exceeds, false);
      assert.equal(ok.currentBooked, 7);
      assert.equal(ok.wouldBe, 10);
      const bad = cstore.wouldExceedCap({ userId: u, type: 'vacation', additionalDays: 4, year: 2026, orgSettings: settings, leaveTypes: types, daysOf });
      assert.equal(bad.exceeds, true);
    });

    await test('per-employee override beats default for cap purposes', () => {
      const u = 'cap-user-2';
      const ov = { leaves: { ...settings.leaves, perEmployeeOverrides: { [u]: { vacation: 30 } } } };
      const out = cstore.wouldExceedCap({ userId: u, type: 'vacation', additionalDays: 25, year: 2026, orgSettings: ov, leaveTypes: types, daysOf });
      assert.equal(out.exceeds, false);
      assert.equal(out.allowance, 30);
    });

    await test('cancelled leaves free up cap space', () => {
      const u = 'cap-user-3';
      const a = cstore.create({ employeeId: u, type: 'vacation', unit: 'days', start: '2026-03-01', end: '2026-03-08' });
      cstore.approve(a.id, adminId);
      let out = cstore.wouldExceedCap({ userId: u, type: 'vacation', additionalDays: 5, year: 2026, orgSettings: settings, leaveTypes: types, daysOf });
      assert.equal(out.exceeds, true); // 8 booked + 5 = 13 > 10
      cstore.cancel(a.id, adminId);
      out = cstore.wouldExceedCap({ userId: u, type: 'vacation', additionalDays: 5, year: 2026, orgSettings: settings, leaveTypes: types, daysOf });
      assert.equal(out.exceeds, false); // 0 booked + 5 = 5 ≤ 10
    });

    await test('cap is year-scoped (last year does not block this year)', () => {
      const u = 'cap-user-4';
      const a = cstore.create({ employeeId: u, type: 'vacation', unit: 'days', start: '2025-11-01', end: '2025-11-10' });
      cstore.approve(a.id, adminId);
      const out = cstore.wouldExceedCap({ userId: u, type: 'vacation', additionalDays: 10, year: 2026, orgSettings: settings, leaveTypes: types, daysOf });
      assert.equal(out.exceeds, false);
    });

    await test('hours unit converted to days (8h = 1d) for cap math', () => {
      const u = 'cap-user-5';
      // Approve 7 days, then ask about 8 more hours → 7 + 1 = 8 ≤ 10 → ok.
      const a = cstore.create({ employeeId: u, type: 'vacation', unit: 'days', start: '2026-04-01', end: '2026-04-07' });
      cstore.approve(a.id, adminId);
      const out = cstore.wouldExceedCap({ userId: u, type: 'vacation', additionalDays: 1, year: 2026, orgSettings: settings, leaveTypes: types, daysOf });
      assert.equal(out.exceeds, false);
    });

  } finally {
    fs.rmSync(capDir, { recursive: true, force: true });
  }

} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
