#!/usr/bin/env node
/**
 * Unit tests for src/mail/templates.js
 *
 * Run:  node tests/test-mail-templates.mjs
 */

import assert from 'node:assert/strict';
import { renderEmail } from '../src/mail/templates.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
console.log('\nleaveDecision — en-US');
// ---------------------------------------------------------------------------

const ldEnUS = renderEmail('leaveDecision', 'en-US', {
  status: 'approved',
  type: 'vacation',
  start: '2026-06-01',
  end: '2026-06-05',
  unit: 'days',
});

test('returns an object with subject and text', () => {
  assert.ok(ldEnUS && typeof ldEnUS === 'object', 'result is an object');
  assert.ok(typeof ldEnUS.subject === 'string', 'subject is a string');
  assert.ok(typeof ldEnUS.text === 'string', 'text is a string');
});

test('subject is non-empty', () => {
  assert.ok(ldEnUS.subject.length > 0, 'subject non-empty');
});

test('text is non-empty', () => {
  assert.ok(ldEnUS.text.length > 0, 'text non-empty');
});

test('subject contains "approved"', () => {
  assert.ok(
    ldEnUS.subject.toLowerCase().includes('approved'),
    `expected "approved" in subject, got: ${ldEnUS.subject}`,
  );
});

test('text contains start date 2026-06-01', () => {
  assert.ok(
    ldEnUS.text.includes('2026-06-01'),
    `expected start date in text, got:\n${ldEnUS.text}`,
  );
});

test('text contains end date 2026-06-05', () => {
  assert.ok(
    ldEnUS.text.includes('2026-06-05'),
    `expected end date in text, got:\n${ldEnUS.text}`,
  );
});

// ---------------------------------------------------------------------------
console.log('\nleaveDecision — pt-PT');
// ---------------------------------------------------------------------------

const ldPtPT = renderEmail('leaveDecision', 'pt-PT', {
  status: 'approved',
  type: 'vacation',
  start: '2026-06-01',
  end: '2026-06-05',
  unit: 'days',
});

test('returns subject and text', () => {
  assert.ok(typeof ldPtPT.subject === 'string' && ldPtPT.subject.length > 0);
  assert.ok(typeof ldPtPT.text === 'string' && ldPtPT.text.length > 0);
});

test('pt-PT subject differs from en-US subject (real translation)', () => {
  assert.notEqual(ldPtPT.subject, ldEnUS.subject);
});

test('pt-PT text differs from en-US text (real translation)', () => {
  assert.notEqual(ldPtPT.text, ldEnUS.text);
});

test('pt-PT text contains Portuguese wording (e.g. férias or aprovado)', () => {
  const ptText = ldPtPT.subject + ldPtPT.text;
  const hasPortuguese =
    ptText.includes('férias') ||
    ptText.includes('aprovad') ||   // aprovado / aprovada
    ptText.includes('ausência') ||
    ptText.includes('pedido');
  assert.ok(hasPortuguese, `expected Portuguese wording, got:\n${ptText}`);
});

// ---------------------------------------------------------------------------
console.log('\nlocale fallback — unknown locale → en-US copy');
// ---------------------------------------------------------------------------

const ldUnknown = renderEmail('leaveDecision', 'fr-FR', {
  status: 'approved',
  type: 'vacation',
  start: '2026-06-01',
  end: '2026-06-05',
  unit: 'days',
});

test('unknown locale returns same subject as en-US', () => {
  assert.equal(ldUnknown.subject, ldEnUS.subject);
});

test('unknown locale returns same text as en-US', () => {
  assert.equal(ldUnknown.text, ldEnUS.text);
});

// ---------------------------------------------------------------------------
console.log('\ncorrectionDecision — renders');
// ---------------------------------------------------------------------------

const cdEnUS = renderEmail('correctionDecision', 'en-US', {
  status: 'rejected',
  date: '2026-05-10',
});

test('correctionDecision subject is non-empty', () => {
  assert.ok(cdEnUS.subject.length > 0);
});

test('correctionDecision text is non-empty', () => {
  assert.ok(cdEnUS.text.length > 0);
});

test('correctionDecision text contains the date', () => {
  assert.ok(
    cdEnUS.text.includes('2026-05-10'),
    `expected date in text, got:\n${cdEnUS.text}`,
  );
});

const cdPtPT = renderEmail('correctionDecision', 'pt-PT', {
  status: 'approved',
  date: '2026-05-10',
});

test('correctionDecision pt-PT subject non-empty', () => {
  assert.ok(cdPtPT.subject.length > 0);
});

test('correctionDecision pt-PT differs from en-US', () => {
  assert.notEqual(cdPtPT.subject, cdEnUS.subject);
});

// ---------------------------------------------------------------------------
console.log('\ncorrectionDecision — pt-PT empty vars graceful degradation');
// ---------------------------------------------------------------------------

test('correctionDecision pt-PT with empty vars — subject is a non-empty string', () => {
  const r = renderEmail('correctionDecision', 'pt-PT', {});
  assert.ok(typeof r.subject === 'string' && r.subject.length > 0, `subject: ${r.subject}`);
});

test('correctionDecision pt-PT with empty vars — text is a non-empty string', () => {
  const r = renderEmail('correctionDecision', 'pt-PT', {});
  assert.ok(typeof r.text === 'string' && r.text.length > 0, `text: ${r.text}`);
});

test('correctionDecision pt-PT with empty vars — subject has no "undefined" literal', () => {
  const r = renderEmail('correctionDecision', 'pt-PT', {});
  assert.ok(!r.subject.includes('undefined'), `subject: ${r.subject}`);
  assert.ok(!r.text.includes('undefined'), `text: ${r.text}`);
});

test('correctionDecision pt-PT with empty vars — subject has no "[object Object]"', () => {
  const r = renderEmail('correctionDecision', 'pt-PT', {});
  assert.ok(!r.subject.includes('[object Object]'), `subject: ${r.subject}`);
  assert.ok(!r.text.includes('[object Object]'), `text: ${r.text}`);
});

// ---------------------------------------------------------------------------
console.log('\nleaveReminder — renders');
// ---------------------------------------------------------------------------

const lrEnUS = renderEmail('leaveReminder', 'en-US', {
  type: 'sick',
  start: '2026-07-01',
  end: '2026-07-01',
  unit: 'days',
});

test('leaveReminder subject is non-empty', () => {
  assert.ok(lrEnUS.subject.length > 0);
});

test('leaveReminder text is non-empty', () => {
  assert.ok(lrEnUS.text.length > 0);
});

test('leaveReminder text contains start date', () => {
  assert.ok(lrEnUS.text.includes('2026-07-01'));
});

const lrPtPT = renderEmail('leaveReminder', 'pt-PT', {
  type: 'vacation',
  start: '2026-07-01',
  end: '2026-07-05',
  unit: 'days',
});

test('leaveReminder pt-PT subject non-empty', () => {
  assert.ok(lrPtPT.subject.length > 0);
});

test('leaveReminder pt-PT differs from en-US', () => {
  assert.notEqual(lrPtPT.subject, lrEnUS.subject);
});

// Regression: pt-PT leaveReminder must use gender-neutral "pedido de" structure
// so it agrees grammatically for all leave types (doença, consulta, ausência, férias).
// Prior defect: "as suas doença começam amanhã" — wrong gender and number for non-férias types.

const lrPtPTSick = renderEmail('leaveReminder', 'pt-PT', {
  type: 'sick',
  start: '2026-06-10',
  end: '2026-06-12',
  unit: 'days',
});

test('leaveReminder pt-PT sick — subject is non-empty', () => {
  assert.ok(typeof lrPtPTSick.subject === 'string' && lrPtPTSick.subject.length > 0);
});

test('leaveReminder pt-PT sick — text is non-empty', () => {
  assert.ok(typeof lrPtPTSick.text === 'string' && lrPtPTSick.text.length > 0);
});

test('leaveReminder pt-PT sick — subject is single line (no CR/LF)', () => {
  assert.ok(
    !lrPtPTSick.subject.includes('\r') && !lrPtPTSick.subject.includes('\n'),
    `subject must be single line, got: ${JSON.stringify(lrPtPTSick.subject)}`,
  );
});

test('leaveReminder pt-PT sick — subject contains Portuguese word', () => {
  // "pedido" is the neutral anchor noun used in the fixed template.
  assert.ok(
    lrPtPTSick.subject.includes('pedido') || lrPtPTSick.subject.includes('Lembrete'),
    `expected Portuguese wording in subject, got: ${lrPtPTSick.subject}`,
  );
});

test('leaveReminder pt-PT sick — broken "as suas" fragment is absent (grammar regression)', () => {
  const combined = lrPtPTSick.subject + ' ' + lrPtPTSick.text;
  assert.ok(
    !combined.includes('as suas'),
    `"as suas" must not appear — grammar regression detected. Got:\n${combined}`,
  );
});

test('leaveReminder pt-PT sick — differs from en-US leaveReminder (real translation)', () => {
  assert.notEqual(lrPtPTSick.subject, lrEnUS.subject);
  assert.notEqual(lrPtPTSick.text, lrEnUS.text);
});

// ---------------------------------------------------------------------------
console.log('\npasswordResetNotice — renders');
// ---------------------------------------------------------------------------

const prEnUS = renderEmail('passwordResetNotice', 'en-US', {});

test('passwordResetNotice subject is non-empty', () => {
  assert.ok(prEnUS.subject.length > 0);
});

test('passwordResetNotice text is non-empty', () => {
  assert.ok(prEnUS.text.length > 0);
});

test('passwordResetNotice text mentions password reset', () => {
  const combined = prEnUS.subject + prEnUS.text;
  assert.ok(
    combined.toLowerCase().includes('password') || combined.toLowerCase().includes('palavra'),
    `expected password mention, got:\n${combined}`,
  );
});

test('passwordResetNotice text mentions "next login" or equivalent', () => {
  const lower = prEnUS.text.toLowerCase();
  assert.ok(
    lower.includes('next login') || lower.includes('sign in') || lower.includes('log in'),
    `expected login mention, got:\n${prEnUS.text}`,
  );
});

test('passwordResetNotice text contains NO token or link (security)', () => {
  const lower = prEnUS.text.toLowerCase();
  assert.ok(!lower.includes('http'), 'must not include URLs');
  assert.ok(!lower.includes('token'), 'must not include token');
});

const prPtPT = renderEmail('passwordResetNotice', 'pt-PT', {});

test('passwordResetNotice pt-PT subject non-empty', () => {
  assert.ok(prPtPT.subject.length > 0);
});

test('passwordResetNotice pt-PT differs from en-US', () => {
  assert.notEqual(prPtPT.subject, prEnUS.subject);
});

// ---------------------------------------------------------------------------
console.log('\nunknown category — throws');
// ---------------------------------------------------------------------------

test('unknown category throws Error', () => {
  assert.throws(
    () => renderEmail('nonExistentCategory', 'en-US', {}),
    (err) => {
      assert.ok(err instanceof Error, 'is an Error');
      assert.ok(
        err.message.includes('nonExistentCategory'),
        `expected category name in message, got: ${err.message}`,
      );
      return true;
    },
  );
});

test('unknown category error message contains "unknown email category"', () => {
  assert.throws(
    () => renderEmail('bogus', 'en-US', {}),
    /unknown email category bogus/,
  );
});

// ---------------------------------------------------------------------------
console.log('\nsanitization — CR/LF in a var collapses to a single line in subject');
// ---------------------------------------------------------------------------

const injected = renderEmail('leaveDecision', 'en-US', {
  status: 'approved\r\nX-Injected: evil',
  type: 'vacation',
  start: '2026-06-01',
  end: '2026-06-05',
  unit: 'days',
});

test('subject with CRLF-containing var is a single line (no \\r or \\n)', () => {
  assert.ok(
    !injected.subject.includes('\r') && !injected.subject.includes('\n'),
    `subject must not contain CR/LF, got: ${JSON.stringify(injected.subject)}`,
  );
});

// ---------------------------------------------------------------------------
console.log('\nmissing / undefined vars — graceful degradation');
// ---------------------------------------------------------------------------

test('leaveDecision with no vars does not throw', () => {
  const r = renderEmail('leaveDecision', 'en-US', {});
  assert.ok(typeof r.subject === 'string');
  assert.ok(typeof r.text === 'string');
});

test('leaveDecision with no vars subject has no "undefined" literal', () => {
  const r = renderEmail('leaveDecision', 'en-US', {});
  assert.ok(!r.subject.includes('undefined'), `subject: ${r.subject}`);
  assert.ok(!r.text.includes('undefined'), `text: ${r.text}`);
});

test('leaveDecision with no vars subject has no "[object Object]"', () => {
  const r = renderEmail('leaveDecision', 'en-US', {});
  assert.ok(!r.subject.includes('[object Object]'));
  assert.ok(!r.text.includes('[object Object]'));
});

test('renderEmail with undefined vars arg does not throw', () => {
  // The spec says vars defaults to {} when undefined.
  const r = renderEmail('passwordResetNotice', 'en-US', undefined);
  assert.ok(typeof r.subject === 'string' && r.subject.length > 0);
});

// ---------------------------------------------------------------------------
console.log('\nSummary');
// ---------------------------------------------------------------------------

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
