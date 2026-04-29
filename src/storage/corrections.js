import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { encryptField, decryptField } from '../crypto/aes.js';

/**
 * Time-correction storage.
 *
 * A "correction" is the employee's retroactive declaration that they worked
 * a window they forgot to clock. Storage flow:
 *
 *   1. Employee creates correction → status = pending. start/end + optional
 *      justification text are stored.
 *   2. Employer approves → status = approved. The frontend (or an API
 *      caller) materializes the in/out punches; storage just records the
 *      decision.
 *   3. Employer rejects → status = rejected.
 *   4. Owner cancels (only while pending) or employer cancels (any status
 *      → cancelled).
 *
 * Bank semantics:
 *   - Approved correction WITH justification → counts as worked time.
 *   - Approved correction WITHOUT justification → counts as worked time
 *     PLUS its duration is added to the employee's bank as "uncredited
 *     hours owed back to the company". Employer can later request
 *     compensation in the form of extra unpaid work.
 *   - Bank balance is computed (sum of approved unjustified durations) —
 *     no separate field on the user, single source of truth in the
 *     event stream.
 *
 * File layout: data/corrections/<yyyy>/<mm>.ndjson — partitioned by the
 * month the correction was CREATED (not the month it covers). This mirrors
 * the leaves store and keeps each correction's event stream in one file
 * forever once written.
 *
 * Each line is an event:
 *   {"id":"...","ts":"...","event":"created","employeeId":"...","start":"...","end":"...","enc":"<base64-encrypted-justification>"}
 *   {"id":"...","ts":"...","event":"approved","actorId":"..."}
 *   {"id":"...","ts":"...","event":"rejected","actorId":"...","enc":"<base64-encrypted-notes>"}
 *   {"id":"...","ts":"...","event":"cancelled","actorId":"..."}
 *
 * `justification` (optional, on create) and `notes` (optional, on reject)
 * are the encrypted fields. AAD = "correction:<correction-id>".
 */

const CORRECTION_EVENTS = Object.freeze(['created', 'approved', 'rejected', 'cancelled']);

const TRANSITIONS = Object.freeze({
  pending:   ['approved', 'rejected', 'cancelled'],
  approved:  ['cancelled'],
  rejected:  [],
  cancelled: [],
});

function padMonth(m) { return String(m).padStart(2, '0'); }
function aadFor(correctionId) { return `correction:${correctionId}`; }

/**
 * Validate ISO timestamps. Both must parse, end must be strictly after
 * start, and the window must be reasonable: at most 24 hours, at least
 * 1 minute. The 24-hour cap prevents nonsense like "I worked 3 days
 * straight" being filed as one correction.
 */
function validateWindow(start, end) {
  if (typeof start !== 'string' || typeof end !== 'string') {
    throw new Error('start and end are required');
  }
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (!Number.isFinite(s)) throw new Error('start is not a valid timestamp');
  if (!Number.isFinite(e)) throw new Error('end is not a valid timestamp');
  if (e <= s) throw new Error('end must be after start');
  const hours = (e - s) / 3_600_000;
  if (hours > 24) throw new Error('correction window cannot exceed 24 hours');
  if (hours < 1 / 60) throw new Error('correction window must be at least 1 minute');
  return { startIso: new Date(s).toISOString(), endIso: new Date(e).toISOString(), hours };
}

export function createCorrectionsStore(dataDir, masterKey) {
  const rootDir = path.join(dataDir, 'corrections');

  function monthFile(year, month) {
    return path.join(rootDir, String(year), `${padMonth(month)}.ndjson`);
  }

  function ensureDir(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  function appendEvent(file, line) {
    ensureDir(file);
    fs.appendFileSync(file, JSON.stringify(line) + '\n', { mode: 0o600 });
  }

  /** List all NDJSON files we know about. Returns [{year, month, file}]. */
  function listPartitions() {
    if (!fs.existsSync(rootDir)) return [];
    const out = [];
    for (const yname of fs.readdirSync(rootDir)) {
      const yearDir = path.join(rootDir, yname);
      if (!fs.statSync(yearDir).isDirectory()) continue;
      const year = Number(yname);
      if (!Number.isInteger(year)) continue;
      for (const fname of fs.readdirSync(yearDir)) {
        const m = fname.match(/^(\d{2})\.ndjson$/);
        if (!m) continue;
        out.push({ year, month: Number(m[1]), file: path.join(yearDir, fname) });
      }
    }
    return out;
  }

  /**
   * Read and reduce all events into a Map<id, state>. Each state has:
   *   { id, employeeId, status, start, end, hours, justification,
   *     createdAt, decidedAt, decidedBy, notes }
   * Cancelled-while-pending is collapsed to status='cancelled' with no
   * decidedAt. Decryption errors mark the correction with _decryptFailed.
   */
  function readAll() {
    const states = new Map();
    for (const part of listPartitions()) {
      const lines = fs.readFileSync(part.file, 'utf8').split('\n').filter(Boolean);
      for (const raw of lines) {
        let ev; try { ev = JSON.parse(raw); } catch { continue; }
        if (!ev.id || !CORRECTION_EVENTS.includes(ev.event)) continue;
        applyEvent(states, ev);
      }
    }
    return states;
  }

  function applyEvent(states, ev) {
    if (ev.event === 'created') {
      const window = validateWindow(ev.start, ev.end);
      let justification = null;
      let _decryptFailed = false;
      if (ev.enc) {
        try {
          const plain = decryptField(ev.enc, masterKey, aadFor(ev.id));
          const parsed = JSON.parse(plain);
          justification = parsed.justification ?? null;
        } catch {
          _decryptFailed = true;
        }
      }
      states.set(ev.id, {
        id: ev.id,
        employeeId: ev.employeeId,
        status: 'pending',
        start: window.startIso,
        end: window.endIso,
        hours: window.hours,
        justification,
        isJustified: !!justification && justification.trim().length > 0,
        createdAt: ev.ts,
        decidedAt: null,
        decidedBy: null,
        notes: null,
        _decryptFailed,
      });
      return;
    }
    const state = states.get(ev.id);
    if (!state) return; // event before its create — corrupt; skip.
    if (!TRANSITIONS[state.status]?.includes(ev.event)) return; // illegal transition; skip.
    state.status = ev.event === 'approved'  ? 'approved'
                 : ev.event === 'rejected'  ? 'rejected'
                 : ev.event === 'cancelled' ? 'cancelled'
                 : state.status;
    state.decidedAt = ev.ts;
    state.decidedBy = ev.actorId ?? null;
    if (ev.enc) {
      try {
        const plain = decryptField(ev.enc, masterKey, aadFor(ev.id));
        const parsed = JSON.parse(plain);
        if (parsed.notes) state.notes = parsed.notes;
      } catch {
        state._decryptFailed = true;
      }
    }
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Create a new pending correction. Returns the persisted record.
   * `justification` is optional; absence means it'll go to the bank if
   * approved.
   */
  function create({ employeeId, start, end, justification }) {
    if (!employeeId) throw new Error('employeeId is required');
    const window = validateWindow(start, end);
    const id = randomUUID();
    const ts = new Date().toISOString();

    const justText = (typeof justification === 'string' && justification.trim() !== '')
      ? justification.trim().slice(0, 500)
      : null;

    const event = {
      id,
      ts,
      event: 'created',
      employeeId,
      start: window.startIso,
      end: window.endIso,
    };
    if (justText) {
      event.enc = encryptField(JSON.stringify({ justification: justText }), masterKey, aadFor(id));
    }

    const d = new Date(ts);
    const file = monthFile(d.getUTCFullYear(), d.getUTCMonth() + 1);
    appendEvent(file, event);

    return {
      id, employeeId, status: 'pending',
      start: window.startIso, end: window.endIso, hours: window.hours,
      justification: justText,
      isJustified: !!justText,
      createdAt: ts,
      decidedAt: null, decidedBy: null,
      notes: null,
    };
  }

  function findById(id) {
    return readAll().get(id) ?? null;
  }

  function list({ employeeId, status } = {}) {
    const out = [];
    for (const state of readAll().values()) {
      if (employeeId && state.employeeId !== employeeId) continue;
      if (status && state.status !== status) continue;
      out.push(state);
    }
    out.sort((a, b) => b.createdAt.localeCompare(a.createdAt)); // newest first
    return out;
  }

  function transition(id, actorId, event, extra = {}) {
    const state = findById(id);
    if (!state) throw new Error('Correction not found');
    if (!TRANSITIONS[state.status]?.includes(event)) {
      throw new Error(`Cannot ${event} a correction in status '${state.status}'`);
    }
    const ts = new Date().toISOString();
    const line = { id, ts, event, actorId };
    if (event === 'rejected' && extra.notes && typeof extra.notes === 'string' && extra.notes.trim() !== '') {
      line.enc = encryptField(
        JSON.stringify({ notes: extra.notes.trim().slice(0, 500) }),
        masterKey, aadFor(id),
      );
    }
    // Append to the month the CORRECTION was created in (not "now" month) —
    // keeps each correction's event stream in one file.
    const created = new Date(state.createdAt);
    const file = monthFile(created.getUTCFullYear(), created.getUTCMonth() + 1);
    appendEvent(file, line);
    return findById(id);
  }

  function approve(id, actorId)        { return transition(id, actorId, 'approved'); }
  function reject(id, actorId, notes)  { return transition(id, actorId, 'rejected', { notes }); }
  function cancel(id, actorId)         { return transition(id, actorId, 'cancelled'); }

  /**
   * Bank balance = total hours from approved corrections that have NO
   * justification. The interpretation is "uncredited time" — the
   * employee admitted to missing the registration without an excuse, so
   * those hours don't count toward worked time and accumulate as
   * compensation owed back to the employer.
   *
   * Returns hours as a number (floating, fine for hour-resolution math).
   */
  function computeBank({ userId, asOf }) {
    if (!userId) throw new Error('userId is required');
    const cutoff = asOf ? new Date(asOf).getTime() : null;
    let total = 0;
    for (const state of readAll().values()) {
      if (state.employeeId !== userId) continue;
      if (state.status !== 'approved') continue;
      if (state.isJustified) continue;
      if (cutoff != null && new Date(state.decidedAt).getTime() > cutoff) continue;
      total += state.hours;
    }
    return Math.round(total * 100) / 100;
  }

  return {
    create,
    findById,
    list,
    approve,
    reject,
    cancel,
    computeBank,
    paths: { rootDir, monthFile },
    listPartitions,
  };
}
