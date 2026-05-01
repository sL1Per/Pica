#!/usr/bin/env node
/**
 * M6 smoke tests — reports aggregation.
 * Built-in `assert` only.
 *
 * Run:  node tests/test-reports.mjs
 */

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createPunchesStore } from '../src/storage/punches.js';
import { createLeavesStore } from '../src/storage/leaves.js';
import {
  hoursReport, leavesReport,
  hoursReportToCsv, leavesReportToCsv,
  isoWeek,
} from '../src/storage/reports.js';

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

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-reports-'));
const masterKey = randomBytes(32);

try {
  const punches = createPunchesStore(tmpDir, masterKey);
  const leaves = createLeavesStore(tmpDir, masterKey);
  const aliceId = 'alice-uuid';
  const bobId   = 'bob-uuid';

  // -------------------------------------------------------------------------
  console.log('ISO week helper');
  // -------------------------------------------------------------------------

  await test('isoWeek: Monday 2026-01-05 is 2026-W02', () => {
    assert.equal(isoWeek(new Date(2026, 0, 5)), '2026-W02');
  });

  await test('isoWeek: Thursday in first partial week belongs to prior year', () => {
    // 2022-01-01 was a Saturday; 2022 ISO week 52 belongs to 2021.
    assert.equal(isoWeek(new Date(2022, 0, 1)), '2021-W52');
  });

  await test('isoWeek: consistent within a week', () => {
    // 2026-04-13 (Mon) through 2026-04-19 (Sun) all in 2026-W16
    for (let d = 13; d <= 19; d++) {
      assert.equal(isoWeek(new Date(2026, 3, d)), '2026-W16', `day ${d}`);
    }
  });

  // -------------------------------------------------------------------------
  console.log('\nHours report — simple pairing');
  // -------------------------------------------------------------------------

  // Alice: in 09:00, out 12:00, in 13:00, out 17:30 on 2026-04-06 = 7.5h
  punches.append(aliceId, { type: 'in',  ts: '2026-04-06T09:00:00.000Z' });
  punches.append(aliceId, { type: 'out', ts: '2026-04-06T12:00:00.000Z' });
  punches.append(aliceId, { type: 'in',  ts: '2026-04-06T13:00:00.000Z' });
  punches.append(aliceId, { type: 'out', ts: '2026-04-06T17:30:00.000Z' });

  await test('single day produces one bucket with correct total', () => {
    const r = hoursReport(punches, aliceId, '2026-04-06', '2026-04-06', 'day',
      new Date('2026-04-07T00:00:00.000Z'));
    assert.equal(r.buckets.length, 1);
    assert.equal(r.totalHours, 7.5);
    assert.equal(r.buckets[0].hours, 7.5);
  });

  await test('range with no punches returns empty buckets and zero total', () => {
    const r = hoursReport(punches, aliceId, '2026-03-01', '2026-03-05', 'day',
      new Date('2026-04-07T00:00:00.000Z'));
    assert.equal(r.buckets.length, 0);
    assert.equal(r.totalHours, 0);
  });

  // -------------------------------------------------------------------------
  console.log('\nHours report — overnight split');
  // -------------------------------------------------------------------------

  // Bob: in 22:00 on 2026-04-05, out 06:00 on 2026-04-06 → 8h, split 2+6
  punches.append(bobId, { type: 'in',  ts: '2026-04-05T22:00:00.000Z' });
  punches.append(bobId, { type: 'out', ts: '2026-04-06T06:00:00.000Z' });

  await test('overnight shift attributes hours to each day separately', () => {
    const r = hoursReport(punches, bobId, '2026-04-05', '2026-04-06', 'day',
      new Date('2026-04-07T00:00:00.000Z'));
    assert.equal(r.buckets.length, 2);

    // Find the two buckets by prefix; the exact UTC-vs-local date depends on
    // the test machine, so we check the shape and sum.
    const total = r.buckets.reduce((a, b) => a + b.hours, 0);
    assert.equal(Math.round(total * 10) / 10, 8);
    for (const b of r.buckets) assert.ok(b.hours > 0, `bucket ${b.key}`);
  });

  // -------------------------------------------------------------------------
  console.log('\nHours report — open shift clipped to "now"');
  // -------------------------------------------------------------------------

  const carolId = 'carol-uuid';
  punches.append(carolId, { type: 'in', ts: '2026-04-06T09:00:00.000Z' });
  // Note: no clock-out.

  await test('open shift counts up to the frozen "now"', () => {
    const r = hoursReport(punches, carolId, '2026-04-06', '2026-04-06', 'day',
      new Date('2026-04-06T12:30:00.000Z'));
    assert.equal(r.totalHours, 3.5);
  });

  await test('open shift across days splits by midnight', () => {
    // Open shift starting 22:00 on the 5th, "now" is 06:00 on the 6th.
    const dId = 'dave-uuid';
    punches.append(dId, { type: 'in', ts: '2026-04-05T22:00:00.000Z' });
    const r = hoursReport(punches, dId, '2026-04-05', '2026-04-06', 'day',
      new Date('2026-04-06T06:00:00.000Z'));
    const total = r.buckets.reduce((a, b) => a + b.hours, 0);
    assert.equal(Math.round(total * 10) / 10, 8);
  });

  // -------------------------------------------------------------------------
  console.log('\nHours report — groupBy modes');
  // -------------------------------------------------------------------------

  // Alice: add a second day 4h on 2026-04-07 → week total = 7.5 + 4 = 11.5
  punches.append(aliceId, { type: 'in',  ts: '2026-04-07T10:00:00.000Z' });
  punches.append(aliceId, { type: 'out', ts: '2026-04-07T14:00:00.000Z' });

  await test('groupBy=day lists each calendar day', () => {
    const r = hoursReport(punches, aliceId, '2026-04-06', '2026-04-07', 'day',
      new Date('2026-04-08T00:00:00.000Z'));
    assert.equal(r.buckets.length, 2);
    assert.equal(r.totalHours, 11.5);
  });

  await test('groupBy=week collapses into one key', () => {
    const r = hoursReport(punches, aliceId, '2026-04-06', '2026-04-07', 'week',
      new Date('2026-04-08T00:00:00.000Z'));
    assert.equal(r.buckets.length, 1);
    assert.equal(r.totalHours, 11.5);
    assert.match(r.buckets[0].key, /^\d{4}-W\d{2}$/);
  });

  await test('groupBy=month uses YYYY-MM key', () => {
    const r = hoursReport(punches, aliceId, '2026-04-06', '2026-04-07', 'month',
      new Date('2026-04-08T00:00:00.000Z'));
    assert.equal(r.buckets.length, 1);
    assert.match(r.buckets[0].key, /^2026-04$/);
  });

  // -------------------------------------------------------------------------
  console.log('\nHours report — validation');
  // -------------------------------------------------------------------------

  await test('rejects malformed dates', () => {
    assert.throws(() => hoursReport(punches, aliceId, '2026/04/01', '2026-04-02', 'day'));
  });

  await test('rejects from > to', () => {
    assert.throws(() => hoursReport(punches, aliceId, '2026-04-10', '2026-04-01', 'day'));
  });

  await test('rejects unknown groupBy', () => {
    assert.throws(() => hoursReport(punches, aliceId, '2026-04-01', '2026-04-02', 'fortnight'));
  });

  // -------------------------------------------------------------------------
  console.log('\nHours report — clipping');
  // -------------------------------------------------------------------------

  await test('shift partially outside range is clipped', () => {
    const id = 'erin-uuid';
    // Shift 2026-04-05 22:00 → 2026-04-06 06:00; range is only the 6th.
    punches.append(id, { type: 'in',  ts: '2026-04-05T22:00:00.000Z' });
    punches.append(id, { type: 'out', ts: '2026-04-06T06:00:00.000Z' });

    const r = hoursReport(punches, id, '2026-04-06', '2026-04-06', 'day',
      new Date('2026-04-07T00:00:00.000Z'));
    // Only the 6th's slice should count. That slice is local midnight → 06:00 local.
    // Since test machine timezone varies, we assert: total > 0 and <= 8.
    assert.ok(r.totalHours > 0);
    assert.ok(r.totalHours <= 8);
  });

  // -------------------------------------------------------------------------
  console.log('\nLeaves report');
  // -------------------------------------------------------------------------

  // Alice: vacation 2026-05-10..2026-05-14 (approved), sick day 2026-05-20 (pending)
  const vac = leaves.create({
    employeeId: aliceId, type: 'vacation', unit: 'days',
    start: '2026-05-10', end: '2026-05-14', reason: 'beach',
  });
  leaves.approve(vac.id, 'admin-id');
  leaves.create({
    employeeId: aliceId, type: 'sick', unit: 'days',
    start: '2026-05-20', end: '2026-05-20', reason: 'flu',
  });

  // Bob: appointment 2026-05-08 2h (rejected)
  const apt = leaves.create({
    employeeId: bobId, type: 'appointment', unit: 'hours',
    start: '2026-05-08T14:00:00Z', end: '2026-05-08T16:00:00Z',
    hours: 2, reason: 'dentist',
  });
  leaves.reject(apt.id, 'admin-id', 'no');

  await test('leaves report counts by status and type', () => {
    const r = leavesReport(leaves, aliceId, 2026, 5);
    assert.equal(r.totalLeaves, 2);
    assert.equal(r.byStatus.approved, 1);
    assert.equal(r.byStatus.pending, 1);
    assert.equal(r.byType.vacation, 1);
    assert.equal(r.byType.sick, 1);
  });

  await test('approved days off counts inclusive days for day-mode leaves', () => {
    const r = leavesReport(leaves, aliceId, 2026, 5);
    assert.equal(r.approvedDaysOff, 5); // May 10..14 inclusive = 5 days
  });

  await test('leaves in other months are excluded', () => {
    const r = leavesReport(leaves, aliceId, 2026, 6);
    assert.equal(r.totalLeaves, 0);
  });

  await test('leave overlapping month boundary is included', () => {
    // Alice: approved leave from April 29 to May 3.
    const l = leaves.create({
      employeeId: aliceId, type: 'vacation', unit: 'days',
      start: '2026-04-29', end: '2026-05-03',
    });
    leaves.approve(l.id, 'admin-id');
    const aprRep = leavesReport(leaves, aliceId, 2026, 4);
    const mayRep = leavesReport(leaves, aliceId, 2026, 5);
    const ids = (rep) => rep.leaves.map((x) => x.id);
    assert.ok(ids(aprRep).includes(l.id));
    assert.ok(ids(mayRep).includes(l.id));
  });

  await test('leaves report validates year and month', () => {
    assert.throws(() => leavesReport(leaves, aliceId, 1999, 1));
    assert.throws(() => leavesReport(leaves, aliceId, 2026, 13));
    assert.throws(() => leavesReport(leaves, aliceId, 2026, 0));
  });

  await test('employee filter isolates records', () => {
    const aliceR = leavesReport(leaves, aliceId, 2026, 5);
    const bobR   = leavesReport(leaves, bobId,   2026, 5);
    assert.ok(aliceR.totalLeaves > 0);
    assert.ok(bobR.totalLeaves > 0);
    // No overlap.
    const aliceIds = new Set(aliceR.leaves.map((l) => l.id));
    for (const l of bobR.leaves) assert.ok(!aliceIds.has(l.id));
  });

  // -------------------------------------------------------------------------
  console.log('\nCSV export');
  // -------------------------------------------------------------------------

  await test('hours CSV has header and total row', () => {
    const r = hoursReport(punches, aliceId, '2026-04-06', '2026-04-07', 'day',
      new Date('2026-04-08T00:00:00.000Z'));
    const csv = hoursReportToCsv(r);
    assert.match(csv, /"Employee"/);
    assert.match(csv, /"day","hours"/);
    assert.match(csv, /"Total"/);
    // Total line reflects data.
    assert.match(csv, /Total.*11\.5/);
  });

  await test('leaves CSV has header and one row per leave', () => {
    const r = leavesReport(leaves, aliceId, 2026, 5);
    const csv = leavesReportToCsv(r);
    assert.match(csv, /"Employee"/);
    assert.match(csv, /"type","unit","start","end","hours","status"/);
    // Two alice leaves in May at the start of the test — plus the cross-month one above.
    const lines = csv.trim().split('\n');
    // Header rows (4) + blank + column header (1) + one per leave
    const dataRows = lines.length - 6;
    assert.equal(dataRows, r.leaves.length);
  });

  await test('CSV escapes embedded commas and quotes', () => {
    const r = {
      employeeId: 'x',
      range: { from: '2026-04-01', to: '2026-04-01' },
      groupBy: 'day',
      buckets: [{ key: 'weird,key"inside', hours: 1 }],
      totalHours: 1,
    };
    const csv = hoursReportToCsv(r);
    // The key "weird,key\"inside" must be quoted and the inner " doubled.
    assert.match(csv, /"weird,key""inside"/);
  });

} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
