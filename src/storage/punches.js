import fs from 'node:fs';
import path from 'node:path';

import { encryptField, decryptField } from '../crypto/aes.js';

/**
 * Punches storage.
 *
 * File layout:
 *   data/punches/<yyyy>/<mm>/<employeeId>.ndjson
 *
 * Line schema (plaintext JSON, one per line):
 *   { "ts": "2026-04-19T14:07:32.490Z", "type": "in",  "enc": "<base64>" }
 *   { "ts": "2026-04-19T17:30:15.100Z", "type": "out", "enc": "<base64>" }
 *
 * Plaintext keys allow reports to aggregate hours without touching the key.
 * Inside `enc` is a base64 AES-256-GCM ciphertext of { comment, geo }, with
 * AAD = "punch:<employeeId>:<ts>" — binds each line to a specific employee
 * and instant, so an attacker can't replay or swap lines across records.
 *
 * Append semantics:
 *   fs.appendFileSync with default 'a' flag is an atomic single write for
 *   small payloads. One line = one transaction. A corrupted line can be
 *   dropped without losing the rest of the file.
 */

const PUNCH_TYPES = new Set(['in', 'out']);

function padMonth(m) { return String(m).padStart(2, '0'); }

function aadFor(employeeId, ts) {
  return `punch:${employeeId}:${ts}`;
}

export function createPunchesStore(dataDir, masterKey) {
  if (!Buffer.isBuffer(masterKey) || masterKey.length !== 32) {
    throw new TypeError('masterKey must be a 32-byte Buffer');
  }
  const rootDir = path.join(dataDir, 'punches');
  fs.mkdirSync(rootDir, { recursive: true });

  function monthDir(year, month) {
    return path.join(rootDir, String(year), padMonth(month));
  }

  function monthFile(employeeId, year, month) {
    return path.join(monthDir(year, month), `${employeeId}.ndjson`);
  }

  // --------------------------------------------------------------------------
  // Reading
  // --------------------------------------------------------------------------

  /**
   * Parse a whole NDJSON file, returning the lines that decrypt successfully.
   * Drops silently-corrupt lines rather than failing the whole load.
   */
  function readFile(employeeId, year, month) {
    const file = monthFile(employeeId, year, month);
    if (!fs.existsSync(file)) return [];
    const raw = fs.readFileSync(file, 'utf8');
    const out = [];
    for (const line of raw.split('\n')) {
      if (!line) continue;
      let parsed;
      try { parsed = JSON.parse(line); } catch { continue; }
      if (!parsed.ts || !PUNCH_TYPES.has(parsed.type)) continue;

      let extra = null;
      if (parsed.enc) {
        try {
          const plain = decryptField(parsed.enc, masterKey, aadFor(employeeId, parsed.ts));
          extra = JSON.parse(plain);
        } catch {
          extra = { _decrypt_failed: true };
        }
      }

      out.push({
        employeeId,
        ts: parsed.ts,
        type: parsed.type,
        comment: extra?.comment ?? null,
        geo: extra?.geo ?? null,
        geoSkipReason: extra?.geoSkipReason ?? null,
        decryptFailed: extra?._decrypt_failed ?? false,
      });
    }
    return out;
  }

  /**
   * Return every punch on a given calendar date for one employee.
   * Date is a YYYY-MM-DD string (server-local interpretation).
   */
  function listDay(employeeId, dateYmd) {
    const [y, m] = dateYmd.split('-').map(Number);
    const lines = readFile(employeeId, y, m);
    return lines.filter((p) => p.ts.startsWith(dateYmd));
  }

  /** Return every punch for one employee in a given month. */
  function listMonth(employeeId, year, month) {
    return readFile(employeeId, year, month);
  }

  /**
   * Return every punch from every employee on a given date.
   * Used for the employer's daily view.
   */
  function listDayAll(dateYmd) {
    const [y, m] = dateYmd.split('-').map(Number);
    const dir = monthDir(y, m);
    if (!fs.existsSync(dir)) return [];
    const files = fs.readdirSync(dir).filter((n) => n.endsWith('.ndjson'));
    const out = [];
    for (const name of files) {
      const employeeId = name.slice(0, -7); // strip ".ndjson"
      out.push(...readFile(employeeId, y, m).filter((p) => p.ts.startsWith(dateYmd)));
    }
    // Return chronologically — older first.
    out.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
    return out;
  }

  // --------------------------------------------------------------------------
  // Writing
  // --------------------------------------------------------------------------

  /**
   * Atomically append one punch line to the correct month file.
   * Creates the directory tree on demand. Returns the persisted record.
   */
  function append(employeeId, { type, ts, comment, geo, geoSkipReason }) {
    if (!PUNCH_TYPES.has(type)) throw new Error(`Invalid punch type: ${type}`);
    if (!ts || typeof ts !== 'string') throw new Error('ts is required');
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) throw new Error(`Invalid timestamp: ${ts}`);

    const year = d.getUTCFullYear();
    const month = d.getUTCMonth() + 1;
    const dir = monthDir(year, month);
    fs.mkdirSync(dir, { recursive: true });

    // Encrypt the optional payload. If there's nothing to hide, omit `enc`
    // entirely — keeps files smaller and makes it visible at a glance that
    // no comment/geo was stored for this line.
    // Note: geoSkipReason ('denied' / 'timeout' / 'unavailable') is also
    // encrypted alongside the rest, since it's a privacy-relevant detail.
    let enc;
    const hasReason = typeof geoSkipReason === 'string' && geoSkipReason !== '';
    if ((comment && comment !== '') || geo || hasReason) {
      const payload = JSON.stringify({
        comment: comment || null,
        geo: geo || null,
        geoSkipReason: hasReason ? geoSkipReason : null,
      });
      enc = encryptField(payload, masterKey, aadFor(employeeId, ts));
    }

    const record = { ts, type };
    if (enc) record.enc = enc;

    const file = monthFile(employeeId, year, month);
    fs.appendFileSync(file, JSON.stringify(record) + '\n', { mode: 0o600 });

    return {
      employeeId, ts, type,
      comment: comment || null,
      geo: geo || null,
      geoSkipReason: hasReason ? geoSkipReason : null,
    };
  }

  // --------------------------------------------------------------------------
  // Open-punch detection
  // --------------------------------------------------------------------------

  /**
   * Return the latest punch for an employee, or null if they have none on
   * file for the current or previous month. We check the previous month
   * too so a clock-in at 23:55 on the last of a month followed by a
   * clock-out at 00:10 of the next month works correctly.
   */
  function latest(employeeId, now = new Date()) {
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth() + 1;
    const current = readFile(employeeId, y, m);
    if (current.length > 0) return current[current.length - 1];

    // Step back to previous month.
    const prevDate = new Date(Date.UTC(y, m - 2, 15));
    const prev = readFile(employeeId, prevDate.getUTCFullYear(), prevDate.getUTCMonth() + 1);
    return prev.length > 0 ? prev[prev.length - 1] : null;
  }

  /**
   * True if the employee's most recent punch is a clock-in with no matching
   * clock-out — i.e., they're currently working.
   */
  function hasOpenPunch(employeeId, now = new Date()) {
    const last = latest(employeeId, now);
    return !!last && last.type === 'in';
  }

  // --------------------------------------------------------------------------

  return {
    append,
    listDay,
    listMonth,
    listDayAll,
    latest,
    hasOpenPunch,
    // Exposed for diagnostics / tests:
    paths: { monthDir, monthFile, rootDir },
  };
}
