#!/usr/bin/env node
/**
 * Reminder scheduler — unit tests.
 *
 * Covers:
 *   1. selectDueReminders() pure function — all filtering cases.
 *   2. makeReminderScheduler() tick — injected fakes, no real timers
 *      in assertions (tick() called directly).
 *   3. start()/stop() timer wiring — only tests that no timer leaks.
 *
 * TZ-robustness: the suite re-execs itself under TZ=America/Los_Angeles
 * (same mechanism as tests/test-reports-nav.mjs) to prove the local-
 * midnight math for days-unit leaves is correct in negative-UTC offsets.
 *
 * Run: node tests/test-reminder-scheduler.mjs
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createLeavesStore } from '../src/storage/leaves.js';

const __filename = fileURLToPath(import.meta.url);

// ---------------------------------------------------------------------------
// Import the module under test
// ---------------------------------------------------------------------------

import {
  selectDueReminders,
  makeReminderScheduler,
} from '../src/scheduler/reminder-scheduler.js';

// ---------------------------------------------------------------------------
// Fixtures — valid UUIDs (required by CLAUDE.md convention)
// ---------------------------------------------------------------------------

const LEAVE_ID_1 = '11111111-1111-4111-8111-111111111111';
const LEAVE_ID_2 = '22222222-2222-4222-8222-222222222222';
const LEAVE_ID_3 = '33333333-3333-4333-8333-333333333333';
const LEAVE_ID_4 = '44444444-4444-4444-8444-444444444444';
const EMP_ID     = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

// ---------------------------------------------------------------------------
// Minimal test runner
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

async function testAsync(name, fn) {
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
// selectDueReminders — pure function tests
// ---------------------------------------------------------------------------

console.log(`\nselectDueReminders (TZ=${process.env.TZ || 'host default'})`);

// now = 2026-06-09T09:00 LOCAL (within 24h before start 2026-06-10 midnight)
// For days-unit: startInstant = new Date(2026, 5, 10)  [local midnight June 10]
// So startInstant - 24h = 2026-06-09T00:00 local.
// now (09:00) >= that, AND startInstant (2026-06-10 00:00) > now → SELECTED.
const nowWithin24h = new Date(2026, 5, 9, 9, 0, 0);   // 2026-06-09 09:00 local

test('days-unit: approved, no reminderSentAt, within 24h, future → selected', () => {
  const leaves = [{
    id: LEAVE_ID_1,
    employeeId: EMP_ID,
    status: 'approved',
    unit: 'days',
    type: 'vacation',
    start: '2026-06-10',
    end: '2026-06-12',
    reminderSentAt: undefined,
  }];
  const result = selectDueReminders(leaves, nowWithin24h);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, LEAVE_ID_1);
});

test('days-unit: reminderSentAt set → NOT selected', () => {
  const leaves = [{
    id: LEAVE_ID_1,
    employeeId: EMP_ID,
    status: 'approved',
    unit: 'days',
    type: 'vacation',
    start: '2026-06-10',
    end: '2026-06-12',
    reminderSentAt: '2026-06-09T06:00:00.000Z',
  }];
  const result = selectDueReminders(leaves, nowWithin24h);
  assert.equal(result.length, 0);
});

test('status=pending → NOT selected', () => {
  const leaves = [{
    id: LEAVE_ID_2,
    employeeId: EMP_ID,
    status: 'pending',
    unit: 'days',
    type: 'vacation',
    start: '2026-06-10',
    end: '2026-06-10',
    reminderSentAt: undefined,
  }];
  const result = selectDueReminders(leaves, nowWithin24h);
  assert.equal(result.length, 0);
});

test('start in past → NOT selected', () => {
  // now = 2026-06-09T09:00, start = 2026-06-08 (yesterday) → startInstant < now
  const leaves = [{
    id: LEAVE_ID_3,
    employeeId: EMP_ID,
    status: 'approved',
    unit: 'days',
    type: 'sick',
    start: '2026-06-08',
    end: '2026-06-08',
    reminderSentAt: undefined,
  }];
  const result = selectDueReminders(leaves, nowWithin24h);
  assert.equal(result.length, 0);
});

test('start >48h away → NOT selected', () => {
  // now = 2026-06-09T09:00, start = 2026-06-11 (2+ days out)
  // startInstant - 24h = 2026-06-10 00:00 local > now → not selected
  const leaves = [{
    id: LEAVE_ID_4,
    employeeId: EMP_ID,
    status: 'approved',
    unit: 'days',
    type: 'vacation',
    start: '2026-06-11',
    end: '2026-06-11',
    reminderSentAt: undefined,
  }];
  const result = selectDueReminders(leaves, nowWithin24h);
  assert.equal(result.length, 0);
});

// hours-unit: start is a full ISO timestamp.
// now = 2026-06-09T14:30 local, startInstant = 2026-06-10T14:00:00 (local)
// startInstant - 24h = 2026-06-09T14:00 local ≤ now (14:30) → SELECTED.
// Note: new Date('2026-06-10T14:00:00') parses as LOCAL time in this context
// because the reminder-scheduler uses new Date(leave.start) for hours-unit.
// Per spec: hours-unit start is a full ISO ts → startInstant = new Date(start).
// To keep this fixture TZ-independent we use an explicit ISO UTC string and
// compare against a matching now so the delta (23.5h) holds regardless of TZ.
test('hours-unit: ISO timestamp start, within 24h, future → selected', () => {
  // Use UTC offsets so the arithmetic is TZ-independent:
  // startInstant = 2026-06-10T14:00:00Z (UTC), now = 2026-06-09T14:30:00Z
  const nowUTC = new Date('2026-06-09T14:30:00Z');
  const leaves = [{
    id: LEAVE_ID_1,
    employeeId: EMP_ID,
    status: 'approved',
    unit: 'hours',
    type: 'appointment',
    start: '2026-06-10T14:00:00Z',
    end: '2026-06-10T15:00:00Z',
    reminderSentAt: undefined,
  }];
  const result = selectDueReminders(leaves, nowUTC);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, LEAVE_ID_1);
});

// TZ-specific: days-unit local-midnight math test.
// now is 2026-06-09 09:00 local; start = '2026-06-10'.
// Correct: startInstant = new Date(2026, 5, 10) = LOCAL midnight.
// Wrong (UTC): new Date('2026-06-10') = UTC midnight → off by TZ offset in
// negative-UTC zones, which would cause startInstant to be in the past
// relative to local midnight and break the >now check.
// This is the exact bug the TZ re-exec exists to catch.
test('days-unit local midnight: start exactly 24h out from local midnight → boundary check', () => {
  // startInstant = local midnight of 2026-06-10 = new Date(2026,5,10)
  // now = exactly startInstant - 24h → now >= startInstant - 24h is true (==)
  // startInstant > now is true → SELECTED (boundary is inclusive on the 24h side)
  const startInstant = new Date(2026, 5, 10);        // local midnight 2026-06-10
  const nowExact = new Date(startInstant.getTime() - 24 * 60 * 60 * 1000); // exactly 24h before
  const leaves = [{
    id: LEAVE_ID_2,
    employeeId: EMP_ID,
    status: 'approved',
    unit: 'days',
    type: 'vacation',
    start: '2026-06-10',
    end: '2026-06-10',
    reminderSentAt: undefined,
  }];
  const result = selectDueReminders(leaves, nowExact);
  assert.equal(result.length, 1, 'boundary: exactly 24h before local midnight should be selected');
});

test('days-unit: start is exactly now (not future) → NOT selected', () => {
  // startInstant === now → startInstant > now is false
  const startInstant = new Date(2026, 5, 10); // local midnight
  const nowExact = new Date(startInstant.getTime());
  const leaves = [{
    id: LEAVE_ID_3,
    employeeId: EMP_ID,
    status: 'approved',
    unit: 'days',
    type: 'vacation',
    start: '2026-06-10',
    end: '2026-06-10',
    reminderSentAt: undefined,
  }];
  const result = selectDueReminders(leaves, nowExact);
  assert.equal(result.length, 0, 'start == now (not future) should NOT be selected');
});

test('empty input → empty result', () => {
  assert.deepEqual(selectDueReminders([], nowWithin24h), []);
});

test('multiple leaves: mixed selection', () => {
  const nowMixed = new Date(2026, 5, 9, 9, 0, 0);
  const leaves = [
    { id: LEAVE_ID_1, employeeId: EMP_ID, status: 'approved', unit: 'days', type: 'vacation', start: '2026-06-10', end: '2026-06-10', reminderSentAt: undefined }, // selected
    { id: LEAVE_ID_2, employeeId: EMP_ID, status: 'approved', unit: 'days', type: 'vacation', start: '2026-06-10', end: '2026-06-10', reminderSentAt: '2026-06-09T01:00:00Z' }, // already sent
    { id: LEAVE_ID_3, employeeId: EMP_ID, status: 'pending',  unit: 'days', type: 'vacation', start: '2026-06-10', end: '2026-06-10', reminderSentAt: undefined }, // pending
    { id: LEAVE_ID_4, employeeId: EMP_ID, status: 'approved', unit: 'days', type: 'vacation', start: '2026-06-11', end: '2026-06-11', reminderSentAt: undefined }, // >24h away
  ];
  const result = selectDueReminders(leaves, nowMixed);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, LEAVE_ID_1);
});

// ---------------------------------------------------------------------------
// makeReminderScheduler — tick() with injected fakes
// ---------------------------------------------------------------------------

console.log(`\nmakeReminderScheduler tick() (TZ=${process.env.TZ || 'host default'})`);

// Helpers for building fake stores/mailers
function makeFakeLeaves(leaves) {
  return {
    list() { return leaves; },
    markReminderSent(id) {
      const l = leaves.find((x) => x.id === id);
      if (l) l._markCalled = true;
    },
  };
}

function makeFakeMailer(sentResult = true) {
  const calls = [];
  return {
    calls,
    async notify(category, opts) {
      calls.push({ category, opts });
      return { sent: sentResult };
    },
  };
}

function makeFakeLogger() {
  const entries = [];
  return {
    entries,
    info(msg) { entries.push({ level: 'info', msg }); },
    error(msg) { entries.push({ level: 'error', msg }); },
  };
}

// Within the 24h window: start tomorrow, now is just inside the window.
// Use UTC-safe dates so tick tests are also TZ-independent.
const tickNow = new Date('2026-06-09T09:00:00Z');
const approvedLeave = {
  id: LEAVE_ID_1,
  employeeId: EMP_ID,
  status: 'approved',
  unit: 'hours',           // hours-unit so startInstant = new Date(start) — UTC-stable
  type: 'vacation',
  start: '2026-06-10T09:00:00Z',  // exactly 24h after tickNow
  end:   '2026-06-10T17:00:00Z',
  reminderSentAt: undefined,
};

await testAsync('tick: mailer.notify called once per due leave', async () => {
  const leavesStore = makeFakeLeaves([approvedLeave]);
  const mailer = makeFakeMailer(true);
  const logger = makeFakeLogger();
  // Inject now so selectDueReminders sees tickNow (not real clock).
  const sched = makeReminderScheduler({ leavesStore, mailer, logger, now: () => tickNow });
  await sched.tick();
  assert.equal(mailer.calls.length, 1);
  assert.equal(mailer.calls[0].category, 'leaveReminder');
  assert.equal(mailer.calls[0].opts.recipientUserId, EMP_ID);
  // vars must be exactly {type,start,end,unit}
  const { vars } = mailer.calls[0].opts;
  assert.equal(vars.type, 'vacation');
  assert.equal(vars.start, '2026-06-10T09:00:00Z');
  assert.equal(vars.end, '2026-06-10T17:00:00Z');
  assert.equal(vars.unit, 'hours');
});

await testAsync('tick: sent:true → markReminderSent called', async () => {
  const leaf = { ...approvedLeave, id: LEAVE_ID_2, _markCalled: false };
  const leavesStore = makeFakeLeaves([leaf]);
  const mailer = makeFakeMailer(true);
  const logger = makeFakeLogger();
  const sched = makeReminderScheduler({ leavesStore, mailer, logger, now: () => tickNow });
  await sched.tick();
  assert.ok(leaf._markCalled, 'markReminderSent should have been called');
});

await testAsync('tick: sent:false → markReminderSent NOT called', async () => {
  const leaf = { ...approvedLeave, id: LEAVE_ID_3, _markCalled: false };
  const leavesStore = makeFakeLeaves([leaf]);
  const mailer = makeFakeMailer(false);
  const logger = makeFakeLogger();
  const sched = makeReminderScheduler({ leavesStore, mailer, logger, now: () => tickNow });
  await sched.tick();
  assert.equal(leaf._markCalled, false, 'markReminderSent must NOT be called when sent:false');
});

await testAsync('tick: never throws even when mailer throws', async () => {
  const leavesStore = makeFakeLeaves([approvedLeave]);
  const throwingMailer = {
    async notify() { throw new Error('SMTP connection refused'); },
  };
  const logger = makeFakeLogger();
  const sched = makeReminderScheduler({ leavesStore, mailer: throwingMailer, logger, now: () => tickNow });
  // Must not throw
  await sched.tick();
  // Should have logged an error
  const errs = logger.entries.filter((e) => e.level === 'error');
  assert.ok(errs.length > 0, 'should log error on mailer failure');
});

await testAsync('tick: never throws even when leavesStore.list throws', async () => {
  const throwingStore = {
    list() { throw new Error('disk error'); },
    markReminderSent() {},
  };
  const mailer = makeFakeMailer(true);
  const logger = makeFakeLogger();
  const sched = makeReminderScheduler({ leavesStore: throwingStore, mailer, logger });
  // Must not throw
  await sched.tick();
  const errs = logger.entries.filter((e) => e.level === 'error');
  assert.ok(errs.length > 0, 'should log error on store failure');
});

await testAsync('tick: no due leaves → mailer.notify not called', async () => {
  const notDue = {
    ...approvedLeave,
    id: LEAVE_ID_4,
    start: '2026-06-20T09:00:00Z',  // far in the future
    end:   '2026-06-20T17:00:00Z',
  };
  const leavesStore = makeFakeLeaves([notDue]);
  const mailer = makeFakeMailer(true);
  const logger = makeFakeLogger();
  const sched = makeReminderScheduler({ leavesStore, mailer, logger, now: () => tickNow });
  await sched.tick();
  assert.equal(mailer.calls.length, 0);
});

// ---------------------------------------------------------------------------
// start()/stop() — timer wiring (no real tick, just verify cleanup)
// ---------------------------------------------------------------------------

console.log(`\nstart()/stop() timer wiring`);

test('start() returns object with stop() and tick()', () => {
  const leavesStore = makeFakeLeaves([]);
  const mailer = makeFakeMailer();
  const logger = makeFakeLogger();
  const sched = makeReminderScheduler({ leavesStore, mailer, logger, checkIntervalMs: 999999 });
  const handle = sched.start();
  assert.equal(typeof handle.stop, 'function');
  handle.stop();
});

test('stop() can be called twice without error', () => {
  const leavesStore = makeFakeLeaves([]);
  const mailer = makeFakeMailer();
  const logger = makeFakeLogger();
  const sched = makeReminderScheduler({ leavesStore, mailer, logger, checkIntervalMs: 999999 });
  const handle = sched.start();
  handle.stop();
  handle.stop(); // idempotent
});

// ---------------------------------------------------------------------------
// markReminderSent idempotency — real store, real disk
// ---------------------------------------------------------------------------

console.log(`\nmarkReminderSent idempotency (real store)`);

// Use a fresh tmpdir + real leavesStore so we can count raw event lines
// on disk. Fake store can't prove the guard stops the append.
await testAsync('markReminderSent called twice appends exactly one reminder_sent event', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-rs-idem-'));
  try {
    const masterKey = randomBytes(32);
    const store = createLeavesStore(tmpDir, masterKey);

    // Create and approve a leave so it lives on disk.
    const EMPLOYEE_UUID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    // Use a far-future start so it won't collide with "past" edge cases.
    const leave = store.create({
      employeeId: EMPLOYEE_UUID,
      type: 'vacation',
      unit: 'days',
      start: '2030-01-10',
      end:   '2030-01-14',
    });
    const EMPLOYER_UUID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    store.approve(leave.id, EMPLOYER_UUID);

    // First call — should append the event and return with reminderSentAt set.
    const result1 = store.markReminderSent(leave.id);
    assert.ok(result1.reminderSentAt, 'reminderSentAt must be truthy after first call');

    // Second call — must NOT append a second reminder_sent line.
    const result2 = store.markReminderSent(leave.id);
    assert.ok(result2.reminderSentAt, 'reminderSentAt still truthy after second call');
    assert.equal(result1.reminderSentAt, result2.reminderSentAt, 'reminderSentAt must not change on second call');

    // Count reminder_sent event lines on disk — must be exactly 1.
    const { listPartitions } = store;
    const partitions = store.listPartitions();
    let eventCount = 0;
    for (const { year, month } of partitions) {
      const file = store.paths.monthFile(year, month);
      if (!fs.existsSync(file)) continue;
      const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const ev = JSON.parse(line);
          if (ev.id === leave.id && ev.event === 'reminder_sent') eventCount++;
        } catch { /* skip */ }
      }
    }
    assert.equal(eventCount, 1, `Expected exactly 1 reminder_sent event on disk, got ${eventCount}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// tick() re-entry guard — concurrent calls only notify once
// ---------------------------------------------------------------------------

console.log(`\ntick() re-entry guard`);

await testAsync('concurrent tick() calls with slow mailer only send one notification', async () => {
  // A mailer that takes 20ms to respond — long enough for a second tick()
  // call to overlap if there were no guard.
  let notifyCalls = 0;
  let markCalls = 0;
  const slowMailer = {
    async notify(category, opts) {
      notifyCalls++;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { sent: true };
    },
  };
  const trackingStore = {
    list() {
      return [{
        id: LEAVE_ID_1,
        employeeId: EMP_ID,
        status: 'approved',
        unit: 'hours',
        type: 'vacation',
        start: '2026-06-10T09:00:00Z',
        end:   '2026-06-10T17:00:00Z',
        reminderSentAt: undefined,
      }];
    },
    markReminderSent(id) {
      markCalls++;
    },
  };
  const logger = makeFakeLogger();
  const sched = makeReminderScheduler({
    leavesStore: trackingStore,
    mailer: slowMailer,
    logger,
    now: () => tickNow,
  });

  // Fire two ticks without awaiting the first — the second must return early
  // because `running` will be true when it checks.
  const p1 = sched.tick();
  const p2 = sched.tick(); // should hit the `if (running) return` guard
  await Promise.all([p1, p2]);

  assert.equal(notifyCalls, 1, `mailer.notify must be called exactly once; got ${notifyCalls}`);
  assert.equal(markCalls, 1, `markReminderSent must be called exactly once; got ${markCalls}`);
});

// ---------------------------------------------------------------------------
// Summary + TZ re-exec
// ---------------------------------------------------------------------------

console.log('');
console.log(`${passed} passed, ${failed} failed`);

// Re-exec under a negative-UTC timezone to prove the local-midnight math
// for days-unit leaves is correct. Mirrors the mechanism in
// tests/test-reports-nav.mjs exactly.
let childFailed = false;
if (process.env.TZ !== 'America/Los_Angeles') {
  console.log('');
  console.log('Re-running under TZ=America/Los_Angeles ...');
  const r = spawnSync(process.execPath, [__filename], {
    env: { ...process.env, TZ: 'America/Los_Angeles' },
    stdio: 'inherit',
  });
  childFailed = r.status !== 0;
}

process.exit(failed > 0 || childFailed ? 1 : 0);
