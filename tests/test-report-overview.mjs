import assert from 'node:assert/strict';
import { buildOverview } from '../src/storage/report-overview.js';

// --- Minimal in-memory fakes -------------------------------------------------
function fakePunches(byUser) {
  return {
    listMonth(userId, year, month) {
      return (byUser[userId] || []).filter((p) => {
        const d = new Date(p.ts);
        return d.getFullYear() === year && d.getMonth() + 1 === month;
      });
    },
  };
}
function fakeLeaves(byUser) {
  return {
    list({ employeeId }) { return byUser[employeeId] || []; },
    computeBalances() { return []; },
  };
}
const wt = () => ({ dailyHours: 8, expectedStart: '09:00', graceMinutes: 10 });
const leaveCtx = { orgSettings: {}, leaveTypes: ['vacation','sick','appointment','other'], daysOf: () => 1 };

let passed = 0; const test = (n, f) => { f(); passed++; console.log('ok -', n); };

test('worked, target and overtime for one person', () => {
  // Mon 2026-05-11 09:00–18:00 = 9h worked; target = 8h/day × 1 weekday = 8h.
  const punches = fakePunches({
    u1: [
      { type: 'in',  ts: '2026-05-11T09:00:00' },
      { type: 'out', ts: '2026-05-11T18:00:00' },
    ],
  });
  const r = buildOverview({
    punchesStore: punches, leavesStore: fakeLeaves({}),
    people: [{ id: 'u1', name: 'Ann', role: 'employee' }],
    from: '2026-05-11', to: '2026-05-11', bucketBy: 'day', label: 'Mon',
    workingTimeFor: wt, leaveCtx, scope: 'me',
    now: new Date('2026-05-12T00:00:00'),
  });
  assert.equal(r.people[0].worked, 9);
  assert.equal(r.people[0].target, 8);
  assert.equal(r.people[0].overtime, 1);
  assert.equal(r.kpis.totalHours, 9);
  assert.equal(r.kpis.targetHours, 8);
  assert.equal(r.kpis.overtimeHours, 1);
  assert.equal(r.kpis.vsTargetPct, 113); // 9/8*100 rounded
});

test('punctuality: on-time %, avg clock-in, late days', () => {
  // Two worked weekdays. Day 1 in 08:55 (on time, ≤ 09:10). Day 2 in 09:30 (late).
  const punches = fakePunches({
    u1: [
      { type: 'in',  ts: '2026-05-11T08:55:00' }, { type: 'out', ts: '2026-05-11T17:00:00' },
      { type: 'in',  ts: '2026-05-12T09:30:00' }, { type: 'out', ts: '2026-05-12T17:00:00' },
    ],
  });
  const r = buildOverview({
    punchesStore: punches, leavesStore: fakeLeaves({}),
    people: [{ id: 'u1', name: 'Ann', role: 'employee' }],
    from: '2026-05-11', to: '2026-05-12', bucketBy: 'day', label: 'wk',
    workingTimeFor: wt, leaveCtx, scope: 'me',
    now: new Date('2026-05-13T00:00:00'),
  });
  const row = r.people[0];
  assert.equal(row.lateDays, 1);
  assert.equal(row.onTimePct, 50);    // 1 of 2 days on time
  assert.equal(row.avgClockIn, '09:12'); // mean of 08:55 and 09:30 = 09:12.5 → 09:12
});

console.log(`\n${passed} passed`);
