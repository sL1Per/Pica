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

await test('en-US dictionary loads as an object with string values', () => {
  assert.equal(typeof enUS, 'object');
  assert.ok(Object.keys(enUS).length > 0);
  for (const [k, v] of Object.entries(enUS)) {
    assert.equal(typeof v, 'string', `key ${k} must be a string`);
  }
});

await test('pt-PT dictionary loads as an object with string values', () => {
  assert.equal(typeof ptPT, 'object');
  assert.ok(Object.keys(ptPT).length > 0);
  for (const [k, v] of Object.entries(ptPT)) {
    assert.equal(typeof v, 'string', `key ${k} must be a string`);
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

await test('all keys use dotted-namespace style', () => {
  for (const k of Object.keys(enUS)) {
    assert.match(k, /^[a-z][a-zA-Z0-9.]*$/, `key ${k} should be lowerCamelCase with dot namespacing`);
  }
});

await test('placeholders in en-US match placeholders in pt-PT', () => {
  // Every {name}-style placeholder in the English template should also
  // exist in the Portuguese one (otherwise dynamic data would be lost
  // when the locale switches).
  const placeholderPattern = /\{(\w+)\}/g;
  for (const k of Object.keys(enUS)) {
    const enPlaceholders = [...enUS[k].matchAll(placeholderPattern)].map((m) => m[1]).sort();
    const ptPlaceholders = [...ptPT[k].matchAll(placeholderPattern)].map((m) => m[1]).sort();
    assert.deepEqual(ptPlaceholders, enPlaceholders,
      `key ${k}: pt-PT placeholders ${ptPlaceholders.join(',')} differ from en-US ${enPlaceholders.join(',')}`);
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

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
