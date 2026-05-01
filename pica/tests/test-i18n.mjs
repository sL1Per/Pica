#!/usr/bin/env node
/**
 * i18n module + locale dictionaries — unit tests.
 *
 * The actual i18n.js can only run in a browser (it reads
 * <meta name="pica-locale">), so we test it indirectly by:
 *   1. Loading the dictionaries directly and asserting structure.
 *   2. Reimplementing the interpolation logic here to test it.
 *
 * Run:  node tests/test-i18n.mjs
 */

import assert from 'node:assert/strict';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

// ---- Dictionary parity ----------------------------------------------------

console.log('Dictionary structure');

const enUS = (await import('../public/locales/en-US.js')).default;
const ptPT = (await import('../public/locales/pt-PT.js')).default;

await test('en-US dictionary loads as an object with string or plural values', () => {
  assert.equal(typeof enUS, 'object');
  assert.ok(Object.keys(enUS).length > 0);
  for (const [k, v] of Object.entries(enUS)) {
    if (typeof v === 'string') continue;
    // Plural: must be an object with at least an `other` form, all strings.
    assert.equal(typeof v, 'object', `key ${k} must be string or plural object`);
    assert.ok(typeof v.other === 'string', `plural key ${k} must have .other (string)`);
    for (const [cat, form] of Object.entries(v)) {
      assert.equal(typeof form, 'string', `plural key ${k}.${cat} must be a string`);
    }
  }
});

await test('pt-PT dictionary loads as an object with string or plural values', () => {
  assert.equal(typeof ptPT, 'object');
  assert.ok(Object.keys(ptPT).length > 0);
  for (const [k, v] of Object.entries(ptPT)) {
    if (typeof v === 'string') continue;
    assert.equal(typeof v, 'object', `key ${k} must be string or plural object`);
    assert.ok(typeof v.other === 'string', `plural key ${k} must have .other (string)`);
  }
});

await test('en-US and pt-PT have identical keys', () => {
  const enKeys = Object.keys(enUS).sort();
  const ptKeys = Object.keys(ptPT).sort();
  const missingInPt = enKeys.filter((k) => !(k in ptPT));
  const extraInPt   = ptKeys.filter((k) => !(k in enUS));
  assert.equal(missingInPt.length, 0,
    `pt-PT is missing keys: ${missingInPt.join(', ')}`);
  assert.equal(extraInPt.length, 0,
    `pt-PT has extra keys not in en-US: ${extraInPt.join(', ')}`);
});

await test('plural keys have matching shape (same plural categories)', () => {
  for (const k of Object.keys(enUS)) {
    const en = enUS[k];
    const pt = ptPT[k];
    if (typeof en !== 'object') continue;
    const enCats = Object.keys(en).sort();
    const ptCats = Object.keys(pt).sort();
    assert.deepEqual(ptCats, enCats,
      `plural key ${k}: pt-PT categories ${ptCats.join(',')} differ from en-US ${enCats.join(',')}`);
  }
});

await test('all keys use dotted-namespace style', () => {
  for (const k of Object.keys(enUS)) {
    // Allow underscores (used in errors.* codes which mirror backend style)
    // and dots (for namespacing).
    assert.match(k, /^[a-z][a-zA-Z0-9._]*$/, `key ${k} should be lowerCamelCase with dot namespacing`);
  }
});

await test('placeholders in en-US match placeholders in pt-PT', () => {
  // Every {name}-style placeholder in the English template should also
  // exist in the Portuguese one (otherwise dynamic data would be lost
  // when the locale switches). Plural keys are checked per-category.
  const placeholderPattern = /\{(\w+)\}/g;
  const placeholders = (str) => [...str.matchAll(placeholderPattern)].map((m) => m[1]).sort();

  for (const k of Object.keys(enUS)) {
    const en = enUS[k];
    const pt = ptPT[k];
    if (typeof en === 'string') {
      assert.deepEqual(placeholders(pt), placeholders(en),
        `key ${k}: pt-PT placeholders differ from en-US`);
    } else {
      // Plural: each form's placeholders must match.
      for (const cat of Object.keys(en)) {
        assert.deepEqual(placeholders(pt[cat]), placeholders(en[cat]),
          `plural key ${k}.${cat}: pt-PT placeholders differ from en-US`);
      }
    }
  }
});

// ---- Interpolation logic --------------------------------------------------

console.log('\nInterpolation');

// Reimplementation of i18n.js's t() — testing the algorithm, not the
// runtime module (which needs browser DOM).
function makeT(dict) {
  return (key, params = {}) => {
    const tmpl = dict[key];
    if (tmpl == null) return `[${key}]`;
    return tmpl.replace(/\{(\w+)\}/g, (match, name) => {
      return Object.prototype.hasOwnProperty.call(params, name)
        ? String(params[name])
        : match;
    });
  };
}

const tEn = makeT(enUS);
const tPt = makeT(ptPT);

await test('returns the raw template when no params', () => {
  assert.equal(tEn('app.suffix'), 'Time management');
  assert.equal(tPt('app.suffix'), 'Gestão de tempo');
});

await test('substitutes a single placeholder', () => {
  assert.equal(tEn('dashboard.welcome', { name: 'Alice' }),
    'Welcome to Alice');
  assert.equal(tPt('dashboard.welcome', { name: 'Alice' }),
    'Bem-vindo a Alice');
});

await test('substitutes multiple placeholders', () => {
  assert.equal(
    tEn('dashboard.signedIn', { name: 'Pedro', role: 'employer' }),
    'Signed in as Pedro (employer). Use the top menu to navigate.',
  );
});

await test('leaves unmatched placeholders literal', () => {
  // Caller forgot to pass `role` — the placeholder stays so the gap is
  // visible rather than producing a misleading rendered string.
  const out = tEn('dashboard.signedIn', { name: 'Pedro' });
  assert.match(out, /\{role\}/);
});

await test('returns [key] for unknown key', () => {
  assert.equal(tEn('nonexistent.key'), '[nonexistent.key]');
});

await test('coerces non-string params to strings', () => {
  // A number or boolean param should render naturally.
  assert.match(tEn('dashboard.welcome', { name: 42 }), /42$/);
});

// ---- Plural logic (tn) ----------------------------------------------------

console.log('\nPluralization');

// Reimplementation of i18n.js's tn() — testing the algorithm only.
function makeTn(dict, locale) {
  const pr = new Intl.PluralRules(locale);
  return (key, count, params = {}) => {
    const forms = dict[key];
    if (!forms || typeof forms !== 'object') return `[${key}]`;
    const cat = pr.select(count);
    const tmpl = forms[cat] ?? forms.other ?? forms.one;
    return tmpl.replace(/\{(\w+)\}/g, (m, name) => {
      const all = { count, ...params };
      return Object.prototype.hasOwnProperty.call(all, name) ? String(all[name]) : m;
    });
  };
}

await test('tn picks "one" form for count=1 in en-US', () => {
  const tn = makeTn(enUS, 'en-US');
  assert.equal(tn('punch.queueWaiting', 1), '1 punch waiting to sync');
});

await test('tn picks "other" form for count=5 in en-US', () => {
  const tn = makeTn(enUS, 'en-US');
  assert.equal(tn('punch.queueWaiting', 5), '5 punches waiting to sync');
});

await test('tn picks "one" form for count=1 in pt-PT', () => {
  const tn = makeTn(ptPT, 'pt-PT');
  assert.equal(tn('punch.queueWaiting', 1), '1 marcação a aguardar sincronização');
});

await test('tn picks "other" form for count=5 in pt-PT', () => {
  const tn = makeTn(ptPT, 'pt-PT');
  assert.equal(tn('punch.queueWaiting', 5), '5 marcações a aguardar sincronização');
});

await test('tn returns [key] for missing or non-object value', () => {
  const tn = makeTn(enUS, 'en-US');
  assert.equal(tn('nonexistent.plural', 3), '[nonexistent.plural]');
});

// ---- Error code translation -----------------------------------------------

console.log('\nError code translation');

// Reimplementation of translateError() — testing the algorithm only.
function makeTranslateError(dict) {
  return (errorCode, fallback = '') => {
    if (!errorCode) return fallback;
    const tmpl = dict[`errors.${errorCode}`];
    return typeof tmpl === 'string' ? tmpl : fallback;
  };
}

await test('translateError returns dictionary message for known code', () => {
  const te = makeTranslateError(enUS);
  assert.equal(te('already_clocked_in', 'fallback'), 'You are already clocked in.');
});

await test('translateError returns localized message in pt-PT', () => {
  const te = makeTranslateError(ptPT);
  assert.equal(te('already_clocked_in', 'fallback'), 'Já tem entrada marcada.');
});

await test('translateError returns fallback for unknown code', () => {
  const te = makeTranslateError(enUS);
  assert.equal(te('mystery_code', 'Server error'), 'Server error');
});

await test('translateError returns fallback when code is empty', () => {
  const te = makeTranslateError(enUS);
  assert.equal(te(null, 'fallback'), 'fallback');
  assert.equal(te('', 'fallback'), 'fallback');
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
