import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { encryptField, decryptField } from '../crypto/aes.js';

/**
 * Leaves storage.
 *
 * File layout:
 *   data/leaves/<yyyy>/<mm>.ndjson
 *
 * Partitioned by the MONTH A LEAVE WAS CREATED — not the month the leave
 * falls in. This keeps the append-only model intact: once written to
 * 2026-04.ndjson, a leave's event stream stays in that file forever,
 * even if the leave is for July or gets cancelled in May.
 *
 * Each line is an event, not a record:
 *
 *   {"id":"<uuid>","ts":"...","event":"created","employeeId":"...","type":"vacation","unit":"days","start":"2026-05-01","end":"2026-05-05","hours":null,"enc":"<base64>"}
 *   {"id":"<uuid>","ts":"...","event":"approved","actorId":"<employer-uuid>"}
 *   {"id":"<uuid>","ts":"...","event":"rejected","actorId":"<employer-uuid>","enc":"<base64>"}
 *   {"id":"<uuid>","ts":"...","event":"cancelled","actorId":"<employee-or-employer-uuid>"}
 *
 * `reason` (set on create) and `notes` (set on reject/cancel) are the only
 * encrypted fields. Everything else is plaintext so calendars, per-month
 * aggregation and reports work without decrypting every leave.
 *
 * AAD = "leave:<leave-id>" binds each ciphertext to its leave record.
 *
 * Reading is a reduce: collect all events with a given id, apply them in
 * order, produce the current state. Because events only mutate state (never
 * delete it), the reducer is total and idempotent.
 */

const LEAVE_TYPES = Object.freeze(['vacation', 'sick', 'appointment', 'other']);
const LEAVE_UNITS = Object.freeze(['days', 'hours']);
const LEAVE_EVENTS = Object.freeze(['created', 'approved', 'rejected', 'cancelled']);

function padMonth(m) { return String(m).padStart(2, '0'); }

function aadFor(leaveId) {
  return `leave:${leaveId}`;
}

/**
 * Validate ISO-ish dates and hour-times coming from clients.
 *   - unit=days: start & end must be YYYY-MM-DD, start <= end
 *   - unit=hours: start & end must be full ISO timestamps, start < end
 */
function validateRange({ unit, start, end }) {
  if (unit === 'days') {
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRe.test(start) || !dateRe.test(end)) {
      throw new Error('start and end must be YYYY-MM-DD for unit="days"');
    }
    if (start > end) throw new Error('start must be on or before end');
    return;
  }
  if (unit === 'hours') {
    const a = new Date(start).getTime();
    const b = new Date(end).getTime();
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      throw new Error('start and end must be valid ISO timestamps for unit="hours"');
    }
    if (a >= b) throw new Error('start must be strictly before end');
    return;
  }
  throw new Error(`Invalid unit: ${unit}`);
}

export function createLeavesStore(dataDir, masterKey) {
  if (!Buffer.isBuffer(masterKey) || masterKey.length !== 32) {
    throw new TypeError('masterKey must be a 32-byte Buffer');
  }
  const rootDir = path.join(dataDir, 'leaves');
  fs.mkdirSync(rootDir, { recursive: true });

  function monthFile(year, month) {
    return path.join(rootDir, String(year), `${padMonth(month)}.ndjson`);
  }

  // --------------------------------------------------------------------------
  // Raw append
  // --------------------------------------------------------------------------

  function appendEvent(year, month, event) {
    const dir = path.join(rootDir, String(year));
    fs.mkdirSync(dir, { recursive: true });
    const file = monthFile(year, month);
    fs.appendFileSync(file, JSON.stringify(event) + '\n', { mode: 0o600 });
  }

  /**
   * Read and parse one NDJSON file. Drops invalid lines silently.
   */
  function readFile(year, month) {
    const file = monthFile(year, month);
    if (!fs.existsSync(file)) return [];
    const raw = fs.readFileSync(file, 'utf8');
    const events = [];
    for (const line of raw.split('\n')) {
      if (!line) continue;
      try {
        const ev = JSON.parse(line);
        if (ev && typeof ev.id === 'string' && LEAVE_EVENTS.includes(ev.event)) {
          events.push(ev);
        }
      } catch { /* skip */ }
    }
    return events;
  }

  /** List the (year, month) pairs present on disk, oldest first. */
  function listPartitions() {
    const parts = [];
    if (!fs.existsSync(rootDir)) return parts;
    const years = fs.readdirSync(rootDir).filter((n) => /^\d{4}$/.test(n)).sort();
    for (const yStr of years) {
      const yDir = path.join(rootDir, yStr);
      const months = fs.readdirSync(yDir).filter((n) => /^\d{2}\.ndjson$/.test(n)).sort();
      for (const mFile of months) {
        parts.push({ year: Number(yStr), month: Number(mFile.slice(0, 2)) });
      }
    }
    return parts;
  }

  // --------------------------------------------------------------------------
  // Reducer
  // --------------------------------------------------------------------------

  /**
   * Fold an event stream for a single leave id into its current state.
   * Handles decryption of the reason/notes fields.
   */
  function reduce(events, leaveId) {
    if (events.length === 0) return null;

    // The first event must be "created" — anything else is orphaned and dropped.
    let state = null;
    const aad = aadFor(leaveId);

    for (const ev of events) {
      if (ev.event === 'created') {
        let reason = null;
        if (ev.enc) {
          try {
            const plain = JSON.parse(decryptField(ev.enc, masterKey, aad));
            reason = plain.reason ?? null;
          } catch {
            // decryption failed — leave `reason` null but keep the leave visible
          }
        }
        state = {
          id: ev.id,
          employeeId: ev.employeeId,
          type: ev.type,
          unit: ev.unit,
          start: ev.start,
          end: ev.end,
          hours: ev.hours ?? null,
          reason,
          notes: null,
          status: 'pending',
          createdAt: ev.ts,
          decidedBy: null,
          decidedAt: null,
          cancelledBy: null,
          cancelledAt: null,
        };
      } else if (!state) {
        continue; // orphan event (e.g. approved without created) — ignore
      } else if (ev.event === 'approved') {
        state.status = 'approved';
        state.decidedBy = ev.actorId;
        state.decidedAt = ev.ts;
      } else if (ev.event === 'rejected') {
        state.status = 'rejected';
        state.decidedBy = ev.actorId;
        state.decidedAt = ev.ts;
        if (ev.enc) {
          try {
            state.notes = JSON.parse(decryptField(ev.enc, masterKey, aad)).notes ?? null;
          } catch { /* ignore */ }
        }
      } else if (ev.event === 'cancelled') {
        state.status = 'cancelled';
        state.cancelledBy = ev.actorId;
        state.cancelledAt = ev.ts;
      }
    }
    return state;
  }

  /**
   * Build a map of id → current state, across the given partitions.
   * Events for the same id must live in the same partition (enforced by create()).
   */
  function reduceAll(events) {
    const byId = new Map();
    for (const ev of events) {
      if (!byId.has(ev.id)) byId.set(ev.id, []);
      byId.get(ev.id).push(ev);
    }
    const out = [];
    for (const [id, stream] of byId) {
      const state = reduce(stream, id);
      if (state) out.push(state);
    }
    return out;
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Create a new leave. Returns the persisted record.
   */
  function create({ employeeId, type, unit, start, end, hours, reason }) {
    if (!LEAVE_TYPES.includes(type)) throw new Error(`Invalid type: ${type}`);
    if (!LEAVE_UNITS.includes(unit)) throw new Error(`Invalid unit: ${unit}`);
    if (!employeeId) throw new Error('employeeId is required');
    validateRange({ unit, start, end });

    const id = randomUUID();
    const ts = new Date().toISOString();
    const now = new Date(ts);
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;

    // Persist the id → (year, month) mapping inside the event itself, so we
    // never need a separate index. Partition chosen at creation time.
    const ev = {
      id, ts, event: 'created',
      employeeId, type, unit, start, end,
      hours: unit === 'hours' && typeof hours === 'number' ? hours : null,
    };
    if (reason && typeof reason === 'string' && reason.trim() !== '') {
      ev.enc = encryptField(JSON.stringify({ reason: reason.trim() }), masterKey, aadFor(id));
    }
    appendEvent(year, month, ev);
    return findById(id);
  }

  /**
   * Find a leave by id. Walks partitions from newest backward — in normal
   * use, a leave being accessed was usually created recently.
   */
  function findById(id) {
    const partitions = listPartitions().reverse();
    for (const { year, month } of partitions) {
      const events = readFile(year, month).filter((ev) => ev.id === id);
      if (events.length > 0) {
        const state = reduce(events, id);
        if (state) return { ...state, _partition: { year, month } };
      }
    }
    return null;
  }

  /** List every leave in the store (returns current states, newest first). */
  function list({ employeeId } = {}) {
    const all = [];
    for (const { year, month } of listPartitions()) {
      const events = readFile(year, month);
      for (const state of reduceAll(events)) {
        if (!employeeId || state.employeeId === employeeId) {
          all.push(state);
        }
      }
    }
    // Newest first, by createdAt.
    all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return all;
  }

  /**
   * Compute per-type balances for one employee, one year.
   *
   *   allowance  — configured days from org settings
   *                (perEmployeeOverrides beats defaultAllowances)
   *   pending    — sum of `approxDaysOff` over leaves with status='pending'
   *   booked     — sum of `approxDaysOff` over leaves with status='approved'
   *   remaining  — allowance - pending - booked (can be negative)
   *
   * `year` filters leaves by the year of their `start` field.
   * Rejected and cancelled leaves are excluded.
   *
   * Carry-forward is deferred — the `allowance` returned is the raw
   * configured value, no previous-year adjustment applied.
   */
  function computeBalances({ userId, year, orgSettings, leaveTypes, daysOf }) {
    if (!userId) throw new Error('userId is required');
    if (!Number.isInteger(year)) throw new Error('year must be an integer');
    if (typeof daysOf !== 'function') throw new Error('daysOf helper is required');
    const types = leaveTypes ?? LEAVE_TYPES;

    // 1. Resolve allowance per type.
    const defaults = orgSettings?.leaves?.defaultAllowances ?? {};
    const override = orgSettings?.leaves?.perEmployeeOverrides?.[userId] ?? {};
    const allowanceFor = (t) =>
      (t in override ? Number(override[t]) : Number(defaults[t])) || 0;

    // 2. Walk this employee's leaves within the given year.
    const byType = {};
    for (const t of types) byType[t] = { pending: 0, booked: 0 };

    for (const leave of list({ employeeId: userId })) {
      if (leave.status !== 'pending' && leave.status !== 'approved') continue;
      if (!byType[leave.type]) continue;
      const leaveYear = Number(leave.start.slice(0, 4));
      if (leaveYear !== year) continue;

      const days = daysOf(leave);
      if (leave.status === 'pending')  byType[leave.type].pending += days;
      if (leave.status === 'approved') byType[leave.type].booked  += days;
    }

    // 3. Shape output.
    return types.map((t) => {
      const allowance = allowanceFor(t);
      const { pending, booked } = byType[t];
      // Round to 0.5 to keep half-day math clean — accumulator can drift
      // slightly with lots of 8-hour-window conversions.
      const round = (n) => Math.round(n * 2) / 2;
      return {
        type: t,
        allowance: round(allowance),
        pending:   round(pending),
        booked:    round(booked),
        remaining: round(allowance - pending - booked),
      };
    });
  }

  /**
   * Apply a transition event to an existing leave, enforcing the workflow.
   */
  function transition(id, actorId, event, extra = {}) {
    const current = findById(id);
    if (!current) throw new Error('Leave not found');

    const valid = {
      pending:   ['approved', 'rejected', 'cancelled'],
      approved:  ['cancelled'],
      rejected:  [],
      cancelled: [],
    };
    const verb = { approved: 'approve', rejected: 'reject', cancelled: 'cancel' }[event] ?? event;
    if (!valid[current.status].includes(event)) {
      throw new Error(`Cannot ${verb} a leave that is ${current.status}`);
    }

    const ts = new Date().toISOString();
    const ev = { id, ts, event, actorId };
    if (event === 'rejected' && extra.notes && typeof extra.notes === 'string') {
      ev.enc = encryptField(JSON.stringify({ notes: extra.notes.trim() }), masterKey, aadFor(id));
    }

    // Append to the SAME partition the `created` event lives in. This is
    // what allows `list()` to work without cross-partition id scans.
    const { year, month } = current._partition;
    appendEvent(year, month, ev);
    return findById(id);
  }

  function approve(id, actorId)         { return transition(id, actorId, 'approved'); }
  function reject(id, actorId, notes)   { return transition(id, actorId, 'rejected', { notes }); }
  function cancel(id, actorId)          { return transition(id, actorId, 'cancelled'); }

  /**
   * Check whether booking `additionalDays` of `type` for `userId` in `year`
   * would push the user's booked total over their allowance.
   *
   * Allowance semantics (existing in this codebase):
   *   - allowance === 0 → no limit (special-case "unlimited", per the
   *     defaultAllowances comment in org-settings.js)
   *   - allowance > 0   → enforced cap; booked + additional must be ≤ allowance
   *
   * Returns:
   *   { exceeds: bool, allowance, currentBooked, wouldBe, type }
   *
   * The caller decides what to do on `exceeds: true` — typically respond
   * with a 4xx and a message including these numbers.
   */
  function wouldExceedCap({ userId, type, additionalDays, year, orgSettings, daysOf }) {
    if (typeof additionalDays !== 'number' || !Number.isFinite(additionalDays)) {
      throw new Error('additionalDays must be a finite number');
    }
    const balances = computeBalances({
      userId, year, orgSettings,
      leaveTypes: [type],
      daysOf,
    });
    const b = balances[0];
    if (!b) {
      // Unknown type — treat as no cap (defensive; caller should have validated).
      return { exceeds: false, allowance: 0, currentBooked: 0, wouldBe: additionalDays, type };
    }
    if (b.allowance === 0) {
      // Unlimited.
      return { exceeds: false, allowance: 0, currentBooked: b.booked, wouldBe: b.booked + additionalDays, type };
    }
    const wouldBe = b.booked + additionalDays;
    return {
      exceeds: wouldBe > b.allowance,
      allowance: b.allowance,
      currentBooked: b.booked,
      wouldBe,
      type,
    };
  }

  // --------------------------------------------------------------------------

  return {
    create,
    findById,
    list,
    computeBalances,
    wouldExceedCap,
    approve,
    reject,
    cancel,
    // Exposed for diagnostics / tests:
    paths: { rootDir, monthFile },
    listPartitions,
  };
}

export const LEAVE_TYPES_LIST = LEAVE_TYPES;
export const LEAVE_UNITS_LIST = LEAVE_UNITS;
