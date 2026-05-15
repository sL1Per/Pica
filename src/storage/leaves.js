import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { encryptField, decryptField, encryptBlob, decryptBlob } from '../crypto/aes.js';

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
const LEAVE_EVENTS = Object.freeze([
  'created', 'approved', 'rejected', 'cancelled',
  'attachment_set', 'attachment_removed',
]);

function padMonth(m) { return String(m).padStart(2, '0'); }

function aadFor(leaveId) {
  return `leave:${leaveId}`;
}

// A distinct AAD for the binary attachment blob so its ciphertext can
// never be confused with the reason/notes field ciphertext (different
// purpose, different file). Same leave id binds them together.
function attachmentAadFor(leaveId) {
  return `leave-attachment:${leaveId}`;
}

// Leave ids are randomUUID(). Guard the on-disk attachment path against
// anything that isn't a plain UUID so a crafted id can't escape the dir.
function safeLeaveId(id) {
  if (typeof id !== 'string' || !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id)) {
    throw new Error('Invalid leave id');
  }
  return id;
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

  // One encrypted attachment file per leave (single-attachment model).
  // Kept OUT of the ndjson event log on purpose: a ≤5 MB blob would
  // bloat the append-only log (which is read+reduced in full on every
  // list()). The log only carries small encrypted metadata events.
  const attachmentsDir = path.join(rootDir, 'attachments');

  function attachmentFile(id) {
    return path.join(attachmentsDir, safeLeaveId(id));
  }

  function atomicWrite(filePath, buffer) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, buffer, { mode: 0o600 });
    fs.renameSync(tmp, filePath);
  }

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
          attachment: null,
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
      } else if (ev.event === 'attachment_set') {
        let meta = null;
        if (ev.enc) {
          try {
            meta = JSON.parse(decryptField(ev.enc, masterKey, aad)).attachment ?? null;
          } catch { /* decrypt failed — treat as no attachment */ }
        }
        state.attachment = meta;
      } else if (ev.event === 'attachment_removed') {
        state.attachment = null;
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
      // Cap reason length at 500 chars. The 5 MB body limit at the HTTP
      // layer is the upper bound, but storing 5 MB encrypted reasons
      // bloats the leaves log without adding forensic value. Pica
      // matches the 500-char convention used for punch comments.
      const trimmed = reason.trim().slice(0, 500);
      ev.enc = encryptField(JSON.stringify({ reason: trimmed }), masterKey, aadFor(id));
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
   *   allowance          — base allowance from org settings
   *                        (perEmployeeOverrides beats defaultAllowances)
   *   carryIn            — vacation only: unused approved days from year-1,
   *                        capped at base allowance, dropped to 0 once the
   *                        configured `carryForwardExpiresAt` passes in
   *                        the current calendar year. 0 for other types
   *                        and 0 for `allowance === 0` (unlimited) types.
   *   effectiveAllowance — allowance + carryIn. The cap-exceeded check
   *                        and the cap-display in the UI use this.
   *   pending            — sum of `daysOf(leave)` over status='pending'
   *   booked             — sum of `daysOf(leave)` over status='approved'
   *   remaining          — effectiveAllowance - pending - booked (can be
   *                        negative; the leave-cap check uses this).
   *   carryExpiresAt     — `YYYY-MM-DD` of the next expiry, or null when
   *                        carryIn === 0 (either no carry, expired, or
   *                        carryForward is disabled).
   *
   * `year` filters leaves by the year of their `start` field.
   * Rejected and cancelled leaves are excluded.
   *
   * `now` (optional) — anchor date for the expiry check. Defaults to
   * `new Date()`; tests inject a frozen value.
   */
  function computeBalances({ userId, year, orgSettings, leaveTypes, daysOf, now }) {
    if (!userId) throw new Error('userId is required');
    if (!Number.isInteger(year)) throw new Error('year must be an integer');
    if (typeof daysOf !== 'function') throw new Error('daysOf helper is required');
    const types = leaveTypes ?? LEAVE_TYPES;
    const anchor = now instanceof Date ? now : new Date();

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

    // 3. Carry-forward (vacation only). Only approved year-N-1 leaves
    //    count as "used"; pending requests in N-1 are ignored. The carry
    //    is capped at the base allowance — we don't surface "negative"
    //    or "over-allowance" carry. Once the current year's expiry
    //    `MM-DD` passes, carry drops to 0.
    const carryByType = {};
    for (const t of types) carryByType[t] = 0;
    let carryExpiresIso = null;

    const carryEnabled = orgSettings?.leaves?.carryForward !== false;
    const expiresMd = orgSettings?.leaves?.carryForwardExpiresAt || '03-31';
    if (carryEnabled && types.includes('vacation')) {
      const baseAllowance = allowanceFor('vacation');
      if (baseAllowance > 0) {
        // Sum vacation `booked` from year - 1.
        let prevBooked = 0;
        for (const leave of list({ employeeId: userId })) {
          if (leave.status !== 'approved') continue;
          if (leave.type !== 'vacation') continue;
          const ly = Number(leave.start.slice(0, 4));
          if (ly !== year - 1) continue;
          prevBooked += daysOf(leave);
        }
        const unused = Math.max(0, baseAllowance - prevBooked);
        // Carry is active up to and including the expiry date in the
        // current `year` (end-of-day local). After that, drops to 0.
        const expiry = new Date(`${year}-${expiresMd}T23:59:59.999`);
        if (anchor.getTime() <= expiry.getTime()) {
          carryByType.vacation = unused;
          if (unused > 0) carryExpiresIso = `${year}-${expiresMd}`;
        }
      }
    }

    // 4. Shape output.
    return types.map((t) => {
      const allowance = allowanceFor(t);
      const carryIn = carryByType[t] || 0;
      const effective = allowance > 0 ? allowance + carryIn : 0;
      const { pending, booked } = byType[t];
      // Round to 0.5 to keep half-day math clean — accumulator can drift
      // slightly with lots of 8-hour-window conversions.
      const round = (n) => Math.round(n * 2) / 2;
      return {
        type: t,
        allowance: round(allowance),
        carryIn:   round(carryIn),
        effectiveAllowance: round(effective),
        pending:   round(pending),
        booked:    round(booked),
        remaining: round(effective - pending - booked),
        carryExpiresAt: t === 'vacation' && carryIn > 0 ? carryExpiresIso : null,
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
      // Cap notes at 500 chars. Same reasoning as the reason cap on
      // create — bound storage growth, match punch comment convention.
      const trimmed = extra.notes.trim().slice(0, 500);
      ev.enc = encryptField(JSON.stringify({ notes: trimmed }), masterKey, aadFor(id));
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

  // --------------------------------------------------------------------------
  // Attachment (single justification file per leave). Only mutable while
  // the leave is pending — once decided/cancelled the attachment is
  // frozen alongside the rest of the record.
  // --------------------------------------------------------------------------

  function assertPending(current, verb) {
    if (current.status !== 'pending') {
      const e = new Error(`Cannot ${verb} the attachment of a leave that is ${current.status}`);
      e.code = 'attachment_locked';
      throw e;
    }
  }

  /**
   * Attach (or replace) the justification file. `data` is the raw bytes
   * (Buffer); the route is responsible for size/type validation. Writes
   * the encrypted blob to its own file and appends an `attachment_set`
   * event carrying the encrypted metadata. Replacing simply overwrites
   * the file and appends a new event (the reducer keeps the last one).
   */
  function setAttachment(id, { name, mime, size, data }) {
    const current = findById(id);
    if (!current) throw new Error('Leave not found');
    assertPending(current, 'change');
    if (!Buffer.isBuffer(data)) throw new TypeError('attachment data must be a Buffer');
    const meta = {
      name: String(name ?? 'attachment').slice(0, 255),
      mime: String(mime ?? 'application/octet-stream').slice(0, 100),
      size: Number.isFinite(size) ? size : data.length,
    };
    atomicWrite(attachmentFile(id), encryptBlob(data, masterKey, attachmentAadFor(id)));
    const ts = new Date().toISOString();
    const ev = {
      id, ts, event: 'attachment_set',
      enc: encryptField(JSON.stringify({ attachment: meta }), masterKey, aadFor(id)),
    };
    const { year, month } = current._partition;
    appendEvent(year, month, ev);
    return findById(id);
  }

  /** Remove the attachment (while pending). Best-effort file unlink. */
  function removeAttachment(id) {
    const current = findById(id);
    if (!current) throw new Error('Leave not found');
    assertPending(current, 'remove');
    if (!current.attachment) return current; // nothing to do — idempotent
    const ts = new Date().toISOString();
    const { year, month } = current._partition;
    appendEvent(year, month, { id, ts, event: 'attachment_removed' });
    try { fs.unlinkSync(attachmentFile(id)); } catch { /* already gone */ }
    return findById(id);
  }

  /**
   * Read and decrypt the attachment. Returns
   * { name, mime, size, data:Buffer } or null when there is none.
   */
  function readAttachment(id) {
    const current = findById(id);
    if (!current || !current.attachment) return null;
    const file = attachmentFile(id);
    if (!fs.existsSync(file)) return null;
    const data = decryptBlob(fs.readFileSync(file), masterKey, attachmentAadFor(id));
    return { ...current.attachment, data };
  }

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
  function wouldExceedCap({ userId, type, additionalDays, year, orgSettings, daysOf, now }) {
    if (typeof additionalDays !== 'number' || !Number.isFinite(additionalDays)) {
      throw new Error('additionalDays must be a finite number');
    }
    const balances = computeBalances({
      userId, year, orgSettings,
      leaveTypes: [type],
      daysOf, now,
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
    // Cap is the EFFECTIVE allowance (base + active carry-forward). Until
    // the configured expiry date passes, vacation carry-in expands the cap.
    const cap = b.effectiveAllowance ?? b.allowance;
    const wouldBe = b.booked + additionalDays;
    return {
      exceeds: wouldBe > cap,
      allowance: cap,
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
    setAttachment,
    removeAttachment,
    readAttachment,
    // Exposed for diagnostics / tests:
    paths: { rootDir, monthFile, attachmentsDir },
    listPartitions,
  };
}

export const LEAVE_TYPES_LIST = LEAVE_TYPES;
export const LEAVE_UNITS_LIST = LEAVE_UNITS;

/**
 * Do two leaves share at least one calendar day?
 *
 * Pure, no I/O. Both leaves are normalized to a [startDay, endDay]
 * date span: days-mode start/end are already "YYYY-MM-DD"; hours-mode
 * start/end are full ISO timestamps, so the first 10 chars are the
 * date. Mixed-unit comparisons therefore work (a days leave vs an
 * hours leave on one of those days overlaps). Lexicographic compare
 * is correct for "YYYY-MM-DD". Spans are inclusive on both ends.
 * Overlap iff aStart <= bEnd AND bStart <= aEnd.
 */
export function leavesShareADay(a, b) {
  const aS = String(a.start).slice(0, 10);
  const aE = String(a.end ?? a.start).slice(0, 10);
  const bS = String(b.start).slice(0, 10);
  const bE = String(b.end ?? b.start).slice(0, 10);
  return aS <= bE && bS <= aE;
}

/**
 * First APPROVED leave belonging to a DIFFERENT employee that shares
 * a calendar day with `candidate`, or null. Used to enforce the
 * "no concurrent leave" org policy at booking time. The caller owns
 * the policy (whether the setting is off, employer/sick exemptions);
 * this is the geometry + status/identity filter only.
 */
export function findConcurrentApprovedLeave(candidate, requesterId, allLeaves) {
  if (!Array.isArray(allLeaves)) return null;
  for (const l of allLeaves) {
    if (l.status !== 'approved') continue;
    if (l.employeeId === requesterId) continue;
    if (leavesShareADay(candidate, l)) return l;
  }
  return null;
}
