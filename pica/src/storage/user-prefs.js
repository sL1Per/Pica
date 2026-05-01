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

export const VALID_LOCALES = Object.freeze(['en-US', 'pt-PT']);
export const VALID_COLOR_MODES = Object.freeze(['light', 'dark', 'system']);

export const DEFAULT_PREFS = Object.freeze({
  locale: 'en-US',
  colorMode: 'system',
});

// Backward-compat: old stored prefs used a 2-letter `language` field.
// Map them to BCP-47 locale tags on read so the rest of the app sees a
// consistent shape. New writes use `locale` only.
const LEGACY_LANGUAGE_MAP = Object.freeze({
  en: 'en-US',
  pt: 'pt-PT',
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
    /** Return a user's prefs merged over DEFAULT_PREFS. Never returns null.
     * Resolves legacy `language` field to `locale` on the fly so old stored
     * prefs read back with the new shape. */
    get(userId) {
      const data = loadAll();
      const stored = data.prefs[userId] ?? {};
      const resolved = { ...stored };
      if (!resolved.locale && resolved.language && LEGACY_LANGUAGE_MAP[resolved.language]) {
        resolved.locale = LEGACY_LANGUAGE_MAP[resolved.language];
      }
      delete resolved.language;
      return { ...DEFAULT_PREFS, ...resolved };
    },

    /**
     * Partial update: only keys in `patch` are written, and only keys that
     * pass validation. Unknown keys are silently dropped.
     */
    update(userId, patch) {
      if (!userId) throw new Error('userId required');
      const clean = {};
      if ('locale' in patch) {
        if (!VALID_LOCALES.includes(patch.locale)) {
          throw new Error(`locale must be one of: ${VALID_LOCALES.join(', ')}`);
        }
        clean.locale = patch.locale;
      }
      if ('colorMode' in patch) {
        if (!VALID_COLOR_MODES.includes(patch.colorMode)) {
          throw new Error(`colorMode must be one of: ${VALID_COLOR_MODES.join(', ')}`);
        }
        clean.colorMode = patch.colorMode;
      }
      const data = loadAll();
      const existing = data.prefs[userId] ?? {};
      // Strip the legacy `language` field on write so we don't keep it
      // alongside a new `locale`.
      const { language: _legacy, ...existingClean } = existing;
      const next = { ...existingClean, ...clean };
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
