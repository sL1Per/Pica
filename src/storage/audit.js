/**
 * Audit log storage.
 *
 * Append-only record of sensitive actions. Each line is one JSON
 * object encrypted independently with AES-256-GCM, base64-encoded,
 * with a trailing newline. Files rotate by month:
 *
 *   data/audit/<yyyy>/<mm>.ndjson.enc
 *
 * Per-line encryption (rather than whole-file) means:
 *   - Append works without re-encrypting the whole file
 *   - Partial corruption only loses the affected lines
 *   - Reads can stream — no need to buffer the entire file
 *   - The "last write was X" property survives crashes (each line
 *     is its own atomic write to a single line of the underlying
 *     fs.appendFileSync call)
 *
 * Failure semantics: appendRecord() catches all errors internally
 * and logs them via the logger. Audit miss is preferable to a
 * user-facing failure (caller can't fix audit-disk-full from
 * the UI). Operators monitoring logs will see "audit write failed"
 * messages.
 *
 * AAD = "pica-audit-v1" binds the encryption to this format. A
 * future audit-v2 (different schema, different parser) can use a
 * different AAD and v1 records will fail decryption rather than
 * be silently misinterpreted.
 */

import fs from 'node:fs';
import path from 'node:path';
import { encryptBlob, decryptBlob } from '../crypto/aes.js';

const AAD = Buffer.from('pica-audit-v1', 'utf8');

/**
 * Create the audit store.
 *
 * @param {object} opts
 * @param {string} opts.dataDir   data directory (audit lives at <dataDir>/audit)
 * @param {Buffer} opts.masterKey 32-byte AES key
 * @param {object} [opts.logger]  optional logger; receives errors
 * @param {function} [opts.now]   override for tests; returns Date
 */
export function createAuditStore({ dataDir, masterKey, logger = null, now = () => new Date() }) {
  if (!Buffer.isBuffer(masterKey) || masterKey.length !== 32) {
    throw new Error('createAuditStore: masterKey must be a 32-byte Buffer');
  }

  const auditDir = path.join(dataDir, 'audit');

  /**
   * Build the path to today's monthly file. Creates the year directory
   * if it doesn't exist.
   */
  function pathFor(date) {
    const y = String(date.getUTCFullYear());
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const yearDir = path.join(auditDir, y);
    fs.mkdirSync(yearDir, { recursive: true, mode: 0o700 });
    return path.join(yearDir, `${m}.ndjson.enc`);
  }

  /**
   * Append a single record. Returns true on success, false on
   * (logged) failure. Never throws.
   *
   * Required fields are auto-filled if missing:
   *   - ts          (current time)
   *   - outcome     ('success')
   *
   * The caller is expected to provide:
   *   - event       dotted snake_case identifier
   *   - actorId, actorUsername, actorRole — null for unauthenticated events
   *   - actorIp     from req.socket.remoteAddress, or 'unknown'
   *   - target?     optional { userId, username, ... }
   *   - details?    optional event-specific object
   */
  function appendRecord(record) {
    try {
      const enriched = {
        ts: record.ts ?? now().toISOString(),
        event: record.event,
        actorId: record.actorId ?? null,
        actorUsername: record.actorUsername ?? null,
        actorRole: record.actorRole ?? null,
        actorIp: record.actorIp ?? 'unknown',
        target: record.target ?? null,
        outcome: record.outcome ?? 'success',
        details: record.details ?? null,
      };

      if (typeof enriched.event !== 'string' || enriched.event === '') {
        throw new Error('audit record requires non-empty `event`');
      }

      const json = JSON.stringify(enriched);
      const ct = encryptBlob(Buffer.from(json, 'utf8'), masterKey, AAD);
      const line = ct.toString('base64') + '\n';

      const filePath = pathFor(now());
      fs.appendFileSync(filePath, line, { mode: 0o600 });
      return true;
    } catch (err) {
      if (logger) {
        logger.error(`audit write failed for event=${record?.event}: ${err.message}`);
      }
      return false;
    }
  }

  /**
   * Read all records for a given year+month. Returns an array of
   * decrypted records, oldest first. Throws on decryption failure
   * (deliberate — we want loud errors if the masterKey is wrong or
   * the file is tampered).
   *
   * Skips empty lines silently (trailing newline at EOF is normal).
   */
  function readMonth(year, month) {
    const yyyy = String(year);
    const mm = String(month).padStart(2, '0');
    const filePath = path.join(auditDir, yyyy, `${mm}.ndjson.enc`);
    if (!fs.existsSync(filePath)) return [];
    const text = fs.readFileSync(filePath, 'utf8');
    const lines = text.split('\n').filter((l) => l.length > 0);
    return lines.map((line, idx) => {
      try {
        const blob = Buffer.from(line, 'base64');
        const plaintext = decryptBlob(blob, masterKey, AAD);
        return JSON.parse(plaintext.toString('utf8'));
      } catch (err) {
        const e = new Error(`audit read failed at ${yyyy}-${mm} line ${idx + 1}: ${err.message}`);
        e.cause = err;
        throw e;
      }
    });
  }

  /**
   * List the (year, month) tuples for which audit files exist.
   * Sorted newest-first. Used by future viewer UIs.
   */
  function listMonths() {
    if (!fs.existsSync(auditDir)) return [];
    const years = fs.readdirSync(auditDir).filter((y) => /^\d{4}$/.test(y));
    const result = [];
    for (const y of years) {
      const months = fs.readdirSync(path.join(auditDir, y))
        .filter((f) => /^\d{2}\.ndjson\.enc$/.test(f))
        .map((f) => f.slice(0, 2));
      for (const m of months) {
        result.push({ year: parseInt(y, 10), month: parseInt(m, 10) });
      }
    }
    // Sort newest-first
    result.sort((a, b) => (b.year - a.year) || (b.month - a.month));
    return result;
  }

  return {
    appendRecord,
    readMonth,
    listMonths,
    /** Expose the directory for tests/diagnostics. */
    path: auditDir,
  };
}

/**
 * Helper: extract the audit-relevant context from a request. Returns
 * an object suitable for spreading into appendRecord arguments.
 *
 *   audit.appendRecord({ ...auditContext(req), event: 'foo.bar' });
 *
 * `req.user` may be null/undefined for unauthenticated events
 * (login attempts). The fields gracefully degrade to null in that case.
 */
export function auditContext(req) {
  return {
    actorId: req?.user?.id ?? null,
    actorUsername: req?.user?.username ?? null,
    actorRole: req?.user?.role ?? null,
    actorIp: req?.socket?.remoteAddress ?? 'unknown',
  };
}
