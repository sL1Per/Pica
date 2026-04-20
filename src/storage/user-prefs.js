import fs from 'node:fs';
import path from 'node:path';

/**
 * User preferences store.
 *
 * One JSON file at data/user-prefs.json, shape:
 *   { "prefs": { "<userId>": { "language": "en", "colorMode": "system" } } }
 *
 * Plaintext because none of this is sensitive — and it needs to be
 * readable before the master key is derived (e.g., to render the login
 * page in the user's preferred language, once M9 lands).
 *
 * The `language` and `colorMode` values go no-op today and become
 * functional in later milestones. See README M7/M8/M9.
 */

export const VALID_LANGUAGES = Object.freeze(['en', 'pt']);
export const VALID_COLOR_MODES = Object.freeze(['light', 'dark', 'system']);

export const DEFAULT_PREFS = Object.freeze({
  language: 'en',
  colorMode: 'system',
});

function atomicWrite(filePath, contents) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, contents, { mode: 0o600 });
  fs.renameSync(tmp, filePath);
}

export function createUserPrefsStore(dataDir) {
  const filePath = path.join(dataDir, 'user-prefs.json');
  let cache = null;

  function loadAll() {
    if (cache) return cache;
    if (!fs.existsSync(filePath)) {
      cache = { prefs: {} };
      return cache;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      cache = { prefs: (parsed && typeof parsed.prefs === 'object') ? parsed.prefs : {} };
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

  return {
    /** Return a user's prefs merged over DEFAULT_PREFS. Never returns null. */
    get(userId) {
      const data = loadAll();
      return { ...DEFAULT_PREFS, ...(data.prefs[userId] ?? {}) };
    },

    /**
     * Partial update: only keys in `patch` are written, and only keys that
     * pass validation. Unknown keys are silently dropped.
     */
    update(userId, patch) {
      if (!userId) throw new Error('userId required');
      const clean = {};
      if ('language' in patch) {
        if (!VALID_LANGUAGES.includes(patch.language)) {
          throw new Error(`language must be one of: ${VALID_LANGUAGES.join(', ')}`);
        }
        clean.language = patch.language;
      }
      if ('colorMode' in patch) {
        if (!VALID_COLOR_MODES.includes(patch.colorMode)) {
          throw new Error(`colorMode must be one of: ${VALID_COLOR_MODES.join(', ')}`);
        }
        clean.colorMode = patch.colorMode;
      }
      const data = loadAll();
      const existing = data.prefs[userId] ?? {};
      const next = { ...existing, ...clean };
      saveAll({ prefs: { ...data.prefs, [userId]: next } });
      return { ...DEFAULT_PREFS, ...next };
    },

    /** Drop a user's prefs entirely. Used when deleting a user. */
    removeUser(userId) {
      const data = loadAll();
      if (!data.prefs[userId]) return false;
      const next = { ...data.prefs };
      delete next[userId];
      saveAll({ prefs: next });
      return true;
    },

    /** Drop the in-memory cache — used in tests. */
    invalidate() { cache = null; },

    path: filePath,
  };
}
