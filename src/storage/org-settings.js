import fs from 'node:fs';
import path from 'node:path';

/**
 * Organization-wide settings.
 *
 * One JSON file at data/org-settings.json. Plaintext — these are company
 * policy knobs, not secrets.
 *
 * Every value here is live (the early-milestone "scaffold" is long gone):
 *   - leaves.defaultAllowances / perEmployeeOverrides: the leave-request
 *     flow enforces caps (leaves.js wouldExceedCap) and the dashboard
 *     surfaces remaining allowance per employee.
 *   - leaves.carryForward / carryForwardExpiresAt: unused approved
 *     vacation from year N-1 rolls into year N until the expiry date,
 *     computed on the fly in computeBalances (no separate ledger).
 *   - leaves.concurrentAllowed: drives the booking-time refusal and the
 *     approval-time advisory warning.
 *   - leaves.blockedRanges: employer-blocked dates refused at booking.
 *   - backups.*: read by the backup scheduler.
 */

export const LEAVE_TYPES = Object.freeze(['vacation', 'sick', 'appointment', 'other']);
export const BACKUP_SCHEDULES = Object.freeze(['off', 'hourly', 'daily', 'weekly']);

// Upper bound on stored blocked ranges. The file is plaintext and read on
// every leave creation; 200 is far beyond any ≤50-employee org's real need
// while keeping the file and the per-request scan trivially small.
const MAX_BLOCKED_RANGES = 200;

/** "HH:MM" 24-hour clock, 00:00–23:59. */
export function isValidHhmm(s) {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

/** True iff `s` is a real calendar date in strict "YYYY-MM-DD" form. */
export function isValidYmd(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (m < 1 || m > 12) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  return d >= 1 && d <= dim;
}

/**
 * Does a leave hit any employer-blocked range?
 *
 * Pure function — no I/O. `leave` is the request shape the leaves route
 * already has: { unit, start, end }. Date math:
 *   - unit="days":  span is [start, end], both "YYYY-MM-DD".
 *   - unit="hours": intraday — the single date is start.slice(0,10)
 *     (the API contract guarantees hours-mode leaves are same-day).
 * A blocked range [bStart, bEnd] is hit iff bStart <= spanEnd AND
 * spanStart <= bEnd (lexicographic compare is correct for YYYY-MM-DD).
 *
 * Returns the FIRST matching range object (so the caller can name it in
 * the error), or null if nothing is hit. Caller is responsible for the
 * employer-exemption and sick-type-exemption policy — this is geometry
 * only.
 */
export function findBlockingRange(leave, blockedRanges) {
  if (!Array.isArray(blockedRanges) || blockedRanges.length === 0) return null;
  let spanStart, spanEnd;
  if (leave.unit === 'days') {
    spanStart = String(leave.start);
    spanEnd = String(leave.end ?? leave.start);
  } else {
    const d = String(leave.start).slice(0, 10);
    spanStart = d;
    spanEnd = d;
  }
  for (const r of blockedRanges) {
    if (r.start <= spanEnd && spanStart <= r.end) return r;
  }
  return null;
}

export const DEFAULT_ORG_SETTINGS = Object.freeze({
  company: {
    // Display name for the org. Null means "use the fallback" ('Pica').
    name: null,
  },
  leaves: {
    // Company-wide defaults — (b) and (c) combined: one default number
    // per leave type, applied to everyone unless overridden below.
    defaultAllowances: {
      vacation: 22,        // typical PT-EU baseline; adjust at will
      sick: 0,             // 0 = no cap by default
      appointment: 0,
      other: 0,
    },
    // (a) — per-employee overrides. Shape: { [userId]: { vacation: n, ... } }
    // Empty by default; employers fill in as needed.
    perEmployeeOverrides: {},
    // Unused vacation balance rolls into next year's budget if true.
    // Only `vacation` carries; sick/appointment/other reset every Jan 1.
    carryForward: true,
    // Date each year on which carried-over vacation expires. Format: "MM-DD".
    // E.g., "03-31" means carry-over from year N-1 is available in year N
    // until end-of-day 31 March, then drops to 0. Applied automatically every
    // year — operator does not need to update annually.
    carryForwardExpiresAt: '03-31',
    // Advisory flag used by M8 warning banner during approval.
    concurrentAllowed: true,
    // Employer-defined date ranges on which employees may NOT book leave
    // (company events, all-hands, peak periods). Each entry:
    //   { start: "YYYY-MM-DD", end: "YYYY-MM-DD", label: string }
    // start <= end; label optional (<=80 chars). Enforced for every leave
    // type EXCEPT sick (non-discretionary). The employer is never blocked.
    // Stored sorted by start. Empty = no restrictions (default).
    blockedRanges: [],
  },
  backups: {
    enabled: false,          // scheduler dormant until M10 lights it up
    schedule: 'daily',       // off | hourly | daily | weekly
    retention: 7,            // keep most-recent N snapshots
  },
  workingTime: {
    // Targets used by reports and the punch page's "today" indicator.
    // Default values apply to anyone WITHOUT a per-employee override.
    dailyHours: 8,           // expected hours per working day
    weeklyHours: 40,         // expected hours per working week
    expectedStart: '09:00',   // expected clock-in time, "HH:MM" 24h (punctuality)
    graceMinutes: 10,         // lateness tolerance before a clock-in counts late
    // Per-employee overrides. Shape: { [userId]: { dailyHours?, weeklyHours?, expectedStart? } }.
    // Either field may be omitted, meaning "use the org default for THIS field".
    // graceMinutes has no per-employee override — it is always org-level.
    // Mirrors the leaves.perEmployeeOverrides pattern.
    perEmployeeOverrides: {},
  },
  notifications: {
    // M14: org-level switches for email notification categories.
    // All default to true (send notifications). Setting a key to false
    // blocks all outgoing mail for that category regardless of user prefs.
    // The mailer gates on strictly === false so a missing key is treated as on.
    leaveDecision:      true,   // notify employee when a leave is approved/rejected
    correctionDecision: true,   // notify employee when a correction is approved/rejected
    leaveReminder:      true,   // send upcoming-leave reminder emails
  },
});

function atomicWrite(filePath, contents) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, contents, { mode: 0o600 });
  fs.renameSync(tmp, filePath);
}

function deepMerge(base, patch) {
  // Shallow-merge for nested objects we know about. Only keys present
  // in the schema are copied over; unknown keys are silently dropped.
  if (!patch || typeof patch !== 'object') return base;
  return { ...base, ...patch };
}

export function createOrgSettingsStore(dataDir) {
  const filePath = path.join(dataDir, 'org-settings.json');
  let cache = null;

  function loadAll() {
    if (cache) return cache;
    if (!fs.existsSync(filePath)) {
      cache = cloneDefault();
      return cache;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      cache = mergeOntoDefaults(parsed);
    } catch (err) {
      throw new Error(`Failed to parse ${filePath}: ${err.message}`);
    }
    return cache;
  }

  function saveAll(data) {
    fs.mkdirSync(dataDir, { recursive: true });
    atomicWrite(filePath, JSON.stringify(data, null, 2) + '\n');
    cache = data;
  }

  function cloneDefault() {
    return JSON.parse(JSON.stringify(DEFAULT_ORG_SETTINGS));
  }

  function mergeOntoDefaults(stored) {
    const defaults = cloneDefault();
    if (stored?.company) {
      if (typeof stored.company.name === 'string' || stored.company.name === null) {
        defaults.company.name = stored.company.name;
      }
    }
    if (stored?.leaves) {
      if (stored.leaves.defaultAllowances) {
        defaults.leaves.defaultAllowances = {
          ...defaults.leaves.defaultAllowances,
          ...stored.leaves.defaultAllowances,
        };
      }
      if (stored.leaves.perEmployeeOverrides) {
        defaults.leaves.perEmployeeOverrides = stored.leaves.perEmployeeOverrides;
      }
      if (typeof stored.leaves.carryForward === 'boolean') {
        defaults.leaves.carryForward = stored.leaves.carryForward;
      }
      if (typeof stored.leaves.carryForwardExpiresAt === 'string'
          && /^\d{2}-\d{2}$/.test(stored.leaves.carryForwardExpiresAt)) {
        defaults.leaves.carryForwardExpiresAt = stored.leaves.carryForwardExpiresAt;
      }
      if (typeof stored.leaves.concurrentAllowed === 'boolean') {
        defaults.leaves.concurrentAllowed = stored.leaves.concurrentAllowed;
      }
      if (Array.isArray(stored.leaves.blockedRanges)) {
        // Best-effort: keep only well-formed entries on read so a hand-edited
        // file can't crash the app. The strict validator runs on write.
        defaults.leaves.blockedRanges = stored.leaves.blockedRanges
          .filter((r) => r && isValidYmd(r.start) && isValidYmd(r.end) && r.start <= r.end)
          .map((r) => ({
            start: r.start,
            end: r.end,
            label: typeof r.label === 'string' ? r.label.slice(0, 80) : '',
          }))
          .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
      }
    }
    if (stored?.backups) {
      defaults.backups = deepMerge(defaults.backups, stored.backups);
    }
    if (stored?.workingTime) {
      defaults.workingTime = deepMerge(defaults.workingTime, stored.workingTime);
    }
    if (stored?.notifications) {
      // Only accept the three known boolean keys; unknown keys are dropped so
      // a hand-edited file can't inject arbitrary data into the notifications object.
      for (const key of ['leaveDecision', 'correctionDecision', 'leaveReminder']) {
        if (typeof stored.notifications[key] === 'boolean') {
          defaults.notifications[key] = stored.notifications[key];
        }
      }
    }
    return defaults;
  }

  // --------------------------------------------------------------------------
  // Validation helpers — return a cleaned patch or throw.
  // --------------------------------------------------------------------------

  function cleanAllowanceNumber(n, field) {
    if (n == null || n === '') return 0;
    const v = Number(n);
    if (!Number.isFinite(v) || v < 0 || v > 365) {
      throw new Error(`${field} must be a number between 0 and 365`);
    }
    return Math.round(v * 10) / 10; // one decimal for half-day precision
  }

  function cleanLeavesPatch(patch) {
    const out = {};
    if (patch.defaultAllowances) {
      out.defaultAllowances = {};
      for (const t of LEAVE_TYPES) {
        if (t in patch.defaultAllowances) {
          out.defaultAllowances[t] = cleanAllowanceNumber(
            patch.defaultAllowances[t], `defaultAllowances.${t}`,
          );
        }
      }
    }
    if (patch.perEmployeeOverrides && typeof patch.perEmployeeOverrides === 'object') {
      out.perEmployeeOverrides = {};
      for (const [userId, caps] of Object.entries(patch.perEmployeeOverrides)) {
        if (!caps || typeof caps !== 'object') continue;
        const userCaps = {};
        for (const t of LEAVE_TYPES) {
          if (t in caps) {
            userCaps[t] = cleanAllowanceNumber(caps[t], `override[${userId}].${t}`);
          }
        }
        if (Object.keys(userCaps).length > 0) {
          out.perEmployeeOverrides[userId] = userCaps;
        }
      }
    }
    if ('carryForward' in patch) {
      out.carryForward = !!patch.carryForward;
    }
    if ('carryForwardExpiresAt' in patch) {
      out.carryForwardExpiresAt = cleanCarryExpiresAt(patch.carryForwardExpiresAt);
    }
    if ('concurrentAllowed' in patch) {
      out.concurrentAllowed = !!patch.concurrentAllowed;
    }
    if ('blockedRanges' in patch) {
      out.blockedRanges = cleanBlockedRanges(patch.blockedRanges);
    }
    return out;
  }

  function cleanBlockedRanges(value) {
    if (!Array.isArray(value)) {
      throw new Error('leaves.blockedRanges must be an array');
    }
    if (value.length > MAX_BLOCKED_RANGES) {
      throw new Error(`leaves.blockedRanges cannot exceed ${MAX_BLOCKED_RANGES} entries`);
    }
    const out = [];
    for (const r of value) {
      if (!r || typeof r !== 'object') {
        throw new Error('each blocked range must be an object');
      }
      if (!isValidYmd(r.start) || !isValidYmd(r.end)) {
        throw new Error('blocked range start/end must be valid YYYY-MM-DD dates');
      }
      if (r.start > r.end) {
        throw new Error('blocked range start must be on or before end');
      }
      let label = '';
      if (r.label != null) {
        if (typeof r.label !== 'string') {
          throw new Error('blocked range label must be a string');
        }
        label = r.label.trim().slice(0, 80);
      }
      out.push({ start: r.start, end: r.end, label });
    }
    // Stable storage + display order. Ties broken by end then label so
    // re-saving an identical set is a no-op (no spurious file churn).
    out.sort((a, b) =>
      a.start !== b.start ? (a.start < b.start ? -1 : 1)
      : a.end !== b.end ? (a.end < b.end ? -1 : 1)
      : (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
    return out;
  }

  // "MM-DD" — month 01-12, day valid for the given month assuming a
  // non-leap year (so "02-29" is rejected; "02-28" is the latest February
  // value an operator should pick if they want every-year semantics).
  function cleanCarryExpiresAt(value) {
    if (typeof value !== 'string' || !/^\d{2}-\d{2}$/.test(value)) {
      throw new Error('leaves.carryForwardExpiresAt must be in MM-DD format');
    }
    const [m, d] = value.split('-').map(Number);
    if (m < 1 || m > 12) {
      throw new Error('leaves.carryForwardExpiresAt month must be 01-12');
    }
    // Days-per-month using a non-leap year (2025) as the reference. This
    // ensures the expiry triggers every year even outside leap years.
    const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
    if (d < 1 || d > daysInMonth) {
      throw new Error(`leaves.carryForwardExpiresAt day must be 01-${String(daysInMonth).padStart(2, '0')} for month ${String(m).padStart(2, '0')}`);
    }
    return value;
  }

  function cleanBackupsPatch(patch) {
    const out = {};
    if ('enabled' in patch) out.enabled = !!patch.enabled;
    if ('schedule' in patch) {
      if (!BACKUP_SCHEDULES.includes(patch.schedule)) {
        throw new Error(`backups.schedule must be one of: ${BACKUP_SCHEDULES.join(', ')}`);
      }
      out.schedule = patch.schedule;
    }
    if ('retention' in patch) {
      const r = Number(patch.retention);
      if (!Number.isInteger(r) || r < 1 || r > 365) {
        throw new Error('backups.retention must be an integer between 1 and 365');
      }
      out.retention = r;
    }
    return out;
  }

  function cleanWorkingTimePatch(patch) {
    const out = {};
    if ('dailyHours' in patch) {
      const v = Number(patch.dailyHours);
      if (!Number.isFinite(v) || v < 0 || v > 24) {
        throw new Error('workingTime.dailyHours must be a number between 0 and 24');
      }
      out.dailyHours = Math.round(v * 100) / 100; // 2-decimal precision
    }
    if ('weeklyHours' in patch) {
      const v = Number(patch.weeklyHours);
      if (!Number.isFinite(v) || v < 0 || v > 168) {
        throw new Error('workingTime.weeklyHours must be a number between 0 and 168');
      }
      out.weeklyHours = Math.round(v * 100) / 100;
    }
    if ('expectedStart' in patch) {
      if (!isValidHhmm(patch.expectedStart)) {
        throw new Error('workingTime.expectedStart must be "HH:MM" 24-hour');
      }
      out.expectedStart = patch.expectedStart;
    }
    if ('graceMinutes' in patch) {
      const g = Number(patch.graceMinutes);
      if (!Number.isFinite(g)) {
        throw new Error('workingTime.graceMinutes must be a number between 0 and 120');
      }
      out.graceMinutes = Math.min(120, Math.max(0, Math.round(g)));
    }
    // Per-employee overrides. Same shape rules as defaults but per user.
    // Each user's record may have dailyHours, weeklyHours, both, or neither
    // (empty object collapses to no override at all).
    if (patch.perEmployeeOverrides && typeof patch.perEmployeeOverrides === 'object') {
      out.perEmployeeOverrides = {};
      for (const [userId, fields] of Object.entries(patch.perEmployeeOverrides)) {
        if (!fields || typeof fields !== 'object') continue;
        const userFields = {};
        if ('dailyHours' in fields) {
          const v = Number(fields.dailyHours);
          if (!Number.isFinite(v) || v < 0 || v > 24) {
            throw new Error(`workingTime.perEmployeeOverrides[${userId}].dailyHours must be a number between 0 and 24`);
          }
          userFields.dailyHours = Math.round(v * 100) / 100;
        }
        if ('weeklyHours' in fields) {
          const v = Number(fields.weeklyHours);
          if (!Number.isFinite(v) || v < 0 || v > 168) {
            throw new Error(`workingTime.perEmployeeOverrides[${userId}].weeklyHours must be a number between 0 and 168`);
          }
          userFields.weeklyHours = Math.round(v * 100) / 100;
        }
        if ('expectedStart' in fields) {
          if (!isValidHhmm(fields.expectedStart)) {
            throw new Error(`workingTime.perEmployeeOverrides[${userId}].expectedStart must be "HH:MM" 24-hour`);
          }
          userFields.expectedStart = fields.expectedStart;
        }
        // Skip users with no fields at all — that's "no override", which
        // is the same as not having the user in the map.
        if (Object.keys(userFields).length > 0) {
          out.perEmployeeOverrides[userId] = userFields;
        }
      }
    }
    return out;
  }

  function cleanNotificationsPatch(patch) {
    const out = {};
    // Only the three known keys are accepted; non-boolean values for a known
    // key are silently ignored (not coerced) so that a stray truthy string
    // doesn't override a default-on switch in unexpected ways.
    for (const key of ['leaveDecision', 'correctionDecision', 'leaveReminder']) {
      if (key in patch && (patch[key] === true || patch[key] === false)) {
        out[key] = patch[key];
      }
    }
    return out;
  }

  function cleanCompanyPatch(patch) {
    const out = {};
    if ('name' in patch) {
      if (patch.name === null || patch.name === '') {
        out.name = null;
      } else if (typeof patch.name !== 'string') {
        throw new Error('company.name must be a string or null');
      } else {
        const trimmed = patch.name.trim();
        if (trimmed.length > 80) throw new Error('company.name must be 80 characters or fewer');
        out.name = trimmed === '' ? null : trimmed;
      }
    }
    return out;
  }

  // --------------------------------------------------------------------------

  return {
    /** Read the full settings object, merged over the defaults. */
    get() {
      return JSON.parse(JSON.stringify(loadAll()));
    },

    /**
     * Resolve the effective working-time targets for a specific user.
     * Per-field fallback: if the user has a `dailyHours` override but no
     * `weeklyHours`, weekly comes from the org default and vice versa.
     * Returns `{ dailyHours, weeklyHours, expectedStart, graceMinutes }`.
     * `expectedStart` falls back per-employee override → org default.
     * `graceMinutes` is org-level only; there is no per-employee override.
     */
    resolveWorkingTimeFor(userId) {
      const wt = loadAll().workingTime;
      const override = wt.perEmployeeOverrides?.[userId] ?? {};
      return {
        dailyHours:    override.dailyHours    ?? wt.dailyHours,
        weeklyHours:   override.weeklyHours   ?? wt.weeklyHours,
        expectedStart: override.expectedStart ?? wt.expectedStart,
        graceMinutes:  wt.graceMinutes,   // org-level only; no per-employee override
      };
    },

    /**
     * Partial update. Accepts a patch that may contain `company`, `leaves`,
     * `workingTime`, `backups`, and/or `notifications` sub-objects; only
     * known keys are persisted.
     */
    update(patch) {
      if (!patch || typeof patch !== 'object') throw new Error('patch must be an object');
      const data = loadAll();
      const next = JSON.parse(JSON.stringify(data));
      if (patch.company) {
        next.company = { ...next.company, ...cleanCompanyPatch(patch.company) };
      }
      if (patch.leaves) {
        const cleaned = cleanLeavesPatch(patch.leaves);
        // `defaultAllowances` merges per-type: a patch setting vacation=25
        // must not nuke sick/appointment/other. But `perEmployeeOverrides`
        // replaces the full map — that mirrors how the UI sends the table.
        if (cleaned.defaultAllowances) {
          next.leaves.defaultAllowances = {
            ...next.leaves.defaultAllowances,
            ...cleaned.defaultAllowances,
          };
          delete cleaned.defaultAllowances;
        }
        next.leaves = { ...next.leaves, ...cleaned };
      }
      if (patch.backups) next.backups = { ...next.backups, ...cleanBackupsPatch(patch.backups) };
      if (patch.workingTime) next.workingTime = { ...next.workingTime, ...cleanWorkingTimePatch(patch.workingTime) };
      if (patch.notifications) next.notifications = { ...next.notifications, ...cleanNotificationsPatch(patch.notifications) };
      saveAll(next);
      return JSON.parse(JSON.stringify(next));
    },

    /** Drop in-memory cache — used in tests. */
    invalidate() { cache = null; },

    path: filePath,
  };
}
