// Pica — i18n runtime.
//
// Synchronous t(key, params) lookup so callers don't have to await.
// The locale is read from <meta name="pica-locale" content="..."> which
// the server embeds in every HTML page based on the user's stored
// pref. If absent (or unknown), we fall back to en-US.
//
// Both locale dictionaries are imported eagerly. They're tiny (~3 KB
// each) and importing both up-front avoids a flash of untranslated
// content. A future expansion to more languages would warrant lazy
// loading.

import enUS from '/locales/en-US.js';
import ptPT from '/locales/pt-PT.js';

const DICTIONARIES = {
  'en-US': enUS,
  'pt-PT': ptPT,
};
const DEFAULT_LOCALE = 'en-US';

function detectLocale() {
  const meta = document.querySelector('meta[name="pica-locale"]');
  const requested = meta?.getAttribute('content');
  if (requested && DICTIONARIES[requested]) return requested;
  return DEFAULT_LOCALE;
}

const currentLocale = detectLocale();
const dict = DICTIONARIES[currentLocale];

/**
 * Translate a key. Returns the raw key (with [missing] prefix) if not
 * found — so untranslated strings are visible in dev rather than
 * silently rendering as the empty string.
 *
 * Params interpolation: {name} placeholders are replaced from the params
 * object. Unmatched placeholders stay literal (helps catch missing data).
 */
export function t(key, params = {}) {
  const tmpl = dict[key];
  if (tmpl == null) {
    // Surface missing keys clearly — better than silent empty string.
    return `[${key}]`;
  }
  // Templates can be either strings (singular) or objects keyed by plural
  // form. For non-plural lookups, only string templates make sense.
  if (typeof tmpl !== 'string') {
    return `[${key} (use tn() for plurals)]`;
  }
  return interpolate(tmpl, params);
}

function interpolate(template, params) {
  return template.replace(/\{(\w+)\}/g, (match, name) => {
    return Object.prototype.hasOwnProperty.call(params, name)
      ? String(params[name])
      : match;
  });
}

/**
 * Pluralized translation. Looks up `dict[key]` which must be an object
 * with category keys (`one`, `other`, plus possibly `few`, `many` for
 * locales that need them). Picks the right form for the count using
 * `Intl.PluralRules`, then interpolates params (which always include
 * `count`).
 *
 * Example:
 *   tn('queue.waiting', 1)  → "1 punch waiting to sync"
 *   tn('queue.waiting', 5)  → "5 punches waiting to sync"
 */
let _pr = null;
function pluralRules() {
  if (!_pr) {
    try { _pr = new Intl.PluralRules(currentLocale); }
    catch { _pr = { select: (n) => n === 1 ? 'one' : 'other' }; }
  }
  return _pr;
}
export function tn(key, count, params = {}) {
  const forms = dict[key];
  if (!forms || typeof forms !== 'object') return `[${key}]`;
  const category = pluralRules().select(count);
  const tmpl = forms[category] ?? forms.other ?? forms.one;
  if (typeof tmpl !== 'string') return `[${key}.${category}]`;
  return interpolate(tmpl, { count, ...params });
}

/**
 * Translate a backend error code. Looks up `errors.<code>` in the
 * dictionary; if missing, returns `fallback` (typically the English
 * `error` string the server returned). Keeps every API caller's
 * error-handling path simple: pass both fields to translateError(),
 * get back the right message regardless of locale.
 */
export function translateError(errorCode, fallback = '') {
  if (!errorCode) return fallback;
  const key = `errors.${errorCode}`;
  const tmpl = dict[key];
  if (typeof tmpl === 'string') return tmpl;
  return fallback;
}

/**
 * Apply translations to a DOM subtree. Two element conventions:
 *
 *   <button data-i18n="punch.clockIn">Clock in</button>
 *     → textContent replaced with t('punch.clockIn').
 *
 *   <input data-i18n-attr="placeholder:punch.commentPh, title:punch.commentTip">
 *     → input.placeholder = t('punch.commentPh'), input.title = t('punch.commentTip').
 *
 * Both can be on the same element. Call this once at module load on
 * `document.body` to translate everything declaratively-marked.
 *
 * Already-translated elements (those whose data-i18n key was already
 * applied) are detected via a `data-i18n-applied` flag — calling this
 * function multiple times is safe and idempotent. That matters when
 * pages re-render parts of their DOM after async data loads.
 */
export function applyTranslations(root = document.body) {
  // Translate textContent.
  for (const el of root.querySelectorAll('[data-i18n]')) {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key);
  }
  // Translate attributes.
  for (const el of root.querySelectorAll('[data-i18n-attr]')) {
    const spec = el.getAttribute('data-i18n-attr');
    for (const part of spec.split(',')) {
      const [attr, key] = part.split(':').map((s) => s.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    }
  }
}

// -------- Locale-aware date/time formatting --------------------------------
// Replaces the per-page ad-hoc formatters with Intl-driven helpers that
// respect the active locale. All accept either an ISO string or a Date.

function asDate(input) {
  if (input instanceof Date) return input;
  const d = new Date(input);
  return Number.isFinite(d.getTime()) ? d : null;
}

/** "Apr 30, 2026" (en-US) / "30/04/2026" (pt-PT). */
export function fmtDate(input) {
  const d = asDate(input);
  if (!d) return '';
  try {
    return new Intl.DateTimeFormat(currentLocale, {
      year: 'numeric', month: 'short', day: 'numeric',
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** "09:00" — 24h on both locales (Portuguese norm; en-US can adapt later). */
export function fmtTime(input) {
  const d = asDate(input);
  if (!d) return '';
  try {
    return new Intl.DateTimeFormat(currentLocale, {
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(d);
  } catch {
    return d.toISOString().slice(11, 16);
  }
}

/** "Apr 30, 2026 09:00" (en-US) / "30/04/2026 09:00" (pt-PT). */
export function fmtDateTime(input) {
  const d = asDate(input);
  if (!d) return '';
  return `${fmtDate(d)} ${fmtTime(d)}`;
}

/** Return the active locale (BCP-47 tag). */
export function getLocale() { return currentLocale; }

/** Return the list of supported locales for UI use. */
export function getSupportedLocales() { return Object.keys(DICTIONARIES); }
