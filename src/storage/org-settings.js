import fs from 'node:fs';
import path from 'node:path';

/**
 * Organization-wide settings.
 *
 * One JSON file at data/org-settings.json. Plaintext — these are company
 * policy knobs, not secrets.
 *
 * The values are a SCAFFOLD for M7. Enforcement is scheduled as follows:
 *   - leaves.defaultAllowances / perEmployeeOverrides: enforced in M8
 *     (leaves request flow honors caps) and later when the dashboard
 *     surfaces remaining allowance per employee.
 *   - leaves.carryForward: in M8, unused approved allowance from year N-1
 *     rolls into the year-N budget. A per-year counter ledger will be
 *     introduced at that time.
 *   - leaves.concurrentAllowed: warning banner added in M8's leaves-
 *     polish (employer can still approve; it's advisory).
 *   - backups.*: wired up in M10.
 */

export const LEAVE_TYPES = Object.freeze(['vacation', 'sick', 'appointment', 'other']);
export const BACKUP_SCHEDULES = Object.freeze(['off', 'hourly', 'daily', 'weekly']);

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
    // Unused balance rolls into next year's budget if true.
    carryForward: true,
    // Advisory flag used by M8 warning banner during approval.
    concurrentAllowed: true,
  },
  backups: {
    enabled: false,          // scheduler dormant until M10 lights it up
    schedule: 'daily',       // off | hourly | daily | weekly
    retention: 7,            // keep most-recent N snapshots
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
      if (typeof stored.leaves.concurrentAllowed === 'boolean') {
        defaults.leaves.concurrentAllowed = stored.leaves.concurrentAllowed;
      }
    }
    if (stored?.backups) {
      defaults.backups = deepMerge(defaults.backups, stored.backups);
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
    if ('concurrentAllowed' in patch) {
      out.concurrentAllowed = !!patch.concurrentAllowed;
    }
    return out;
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
     * Partial update. Accepts a patch that may contain `company`, `leaves`
     * and/or `backups` sub-objects; only known keys are persisted.
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
      saveAll(next);
      return JSON.parse(JSON.stringify(next));
    },

    /** Drop in-memory cache — used in tests. */
    invalidate() { cache = null; },

    path: filePath,
  };
}
