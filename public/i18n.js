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
 *
 * Example:
 *   t('dashboard.welcome', { name: 'Alice' })
 *   → "Welcome to Alice"  (en-US)
 *   → "Bem-vindo a Alice" (pt-PT)
 */
export function t(key, params = {}) {
  const tmpl = dict[key];
  if (tmpl == null) {
    // Surface missing keys clearly — better than silent empty string.
    return `[${key}]`;
  }
  return tmpl.replace(/\{(\w+)\}/g, (match, name) => {
    return Object.prototype.hasOwnProperty.call(params, name)
      ? String(params[name])
      : match;
  });
}

/** Return the active locale (BCP-47 tag). */
export function getLocale() { return currentLocale; }

/** Return the list of supported locales for UI use. */
export function getSupportedLocales() { return Object.keys(DICTIONARIES); }
