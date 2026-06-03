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
// M15: the three design palettes. Each renders in both light and dark via the
// token cascade in app.css; `colorMode` and `palette` are orthogonal axes.
export const VALID_PALETTES = Object.freeze(['linen', 'slate', 'olive']);

// email sub-object defaults. Both keys default to true — absent or true → send;
// only strict false blocks sending (mirrors the mailer's `=== false` contract).
const DEFAULT_EMAIL_PREFS = Object.freeze({ notifications: true, reminders: true });

// A hand-edited prefs file could set `email` to a non-object (string, array,
// null). Treat any non-plain-object stored value as absent so garbage indexed
// keys (e.g. {0:'y',1:'e',2:'s'} from spreading a string) never reach callers
// or get persisted back to disk. Mirrors the org-settings read-path guard.
function withEmailDefaults(storedEmail) {
  const src = (storedEmail && typeof storedEmail === 'object' && !Array.isArray(storedEmail))
    ? storedEmail : {};
  return { ...DEFAULT_EMAIL_PREFS, ...src };
}

export const DEFAULT_PREFS = Object.freeze({
  locale: 'en-US',
  colorMode: 'light',
  // M15: the three palettes all live in app.css's token cascade. Slate is the
  // product default (applied via data-palette="slate"); linen remains the
  // bare-:root combo but is no longer the default a fresh user resolves to.
  palette: 'slate',
  // M14 §3.5: per-user email gating switches. Frozen copy here; get() and
  // update() always return a fresh plain object so callers cannot mutate it.
  email: DEFAULT_EMAIL_PREFS,
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
     * prefs read back with the new shape. Old prefs files with no `email` key
     * backfill to {notifications:true,reminders:true} via the DEFAULT_PREFS
     * spread, then the stored email sub-object (if any) is merged on top. */
    get(userId) {
      const data = loadAll();
      const stored = data.prefs[userId] ?? {};
      const resolved = { ...stored };
      if (!resolved.locale && resolved.language && LEGACY_LANGUAGE_MAP[resolved.language]) {
        resolved.locale = LEGACY_LANGUAGE_MAP[resolved.language];
      }
      delete resolved.language;
      // Spread defaults first, then override with stored values. For the email
      // sub-object, merge at one level deep so a stored {reminders:false}
      // doesn't wipe the notifications default (plain spread would replace the
      // whole email object). withEmailDefaults() also guards against a non-
      // plain-object stored value (string, array) producing garbage indexed keys.
      const merged = { ...DEFAULT_PREFS, ...resolved };
      merged.email = withEmailDefaults(resolved.email);
      return merged;
    },

    /**
     * Partial update: only keys in `patch` are written, and only keys that
     * pass validation. Unknown keys are silently dropped.
     *
     * For the `email` sub-object: only `notifications` and `reminders` are
     * accepted, and only if they are strictly boolean (true or false). Non-
     * boolean values (strings, numbers, null) are dropped without error —
     * this matches the mailer's strict `=== false` contract and the same
     * "drop, don't coerce" approach used by org-settings (Task 5 precedent).
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
      if ('palette' in patch) {
        if (!VALID_PALETTES.includes(patch.palette)) {
          throw new Error(`palette must be one of: ${VALID_PALETTES.join(', ')}`);
        }
        clean.palette = patch.palette;
      }
      if ('email' in patch && patch.email && typeof patch.email === 'object') {
        // Only whitelist the two known keys; unknown sub-keys are dropped.
        // Strict boolean: only true/false accepted; non-boolean silently dropped.
        const emailClean = {};
        if ('notifications' in patch.email && typeof patch.email.notifications === 'boolean') {
          emailClean.notifications = patch.email.notifications;
        }
        if ('reminders' in patch.email && typeof patch.email.reminders === 'boolean') {
          emailClean.reminders = patch.email.reminders;
        }
        clean.email = emailClean;
      }
      const data = loadAll();
      const existing = data.prefs[userId] ?? {};
      // Strip the legacy `language` field on write so we don't keep it
      // alongside a new `locale`.
      const { language: _legacy, ...existingClean } = existing;
      // Merge email at one level deep: preserve stored sibling keys not in this
      // patch. A partial {email:{reminders:false}} must not erase notifications.
      // Base the merge on withEmailDefaults(existingClean.email) so a garbage
      // non-plain-object stored value (string, array) can never produce indexed
      // keys in the written record — next.email is always a clean
      // {notifications,reminders} object before clean.email is spread.
      const next = { ...existingClean, ...clean };
      if (clean.email !== undefined) {
        next.email = { ...withEmailDefaults(existingClean.email), ...clean.email };
      }
      saveAll({ prefs: { ...data.prefs, [userId]: next } });
      // Return full prefs merged over defaults (same as get()).
      const returned = { ...DEFAULT_PREFS, ...next };
      returned.email = withEmailDefaults(next.email);
      return returned;
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
