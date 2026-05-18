#!/usr/bin/env node
/**
 * test-mail-mailer.mjs — unit tests for src/mail/mailer.js
 *
 * Fully offline: all stores and sendMail are injected fakes.
 * No real network, no real disk access.
 *
 * Run:  node tests/test-mail-mailer.mjs
 */

import assert from 'node:assert/strict';
import { makeMailer } from '../src/mail/mailer.js';

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
    if (err.stack) {
      for (const line of err.stack.split('\n').slice(1, 4)) {
        console.error(`    ${line.trim()}`);
      }
    }
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------

const RECIPIENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CONTACT_EMAIL = 'alice@example.com';
const SENTINEL_PASS = 'S3cretPass!';

// Base config with mail enabled and a sentinel password.
function makeConfig(overrides = {}) {
  return {
    mail: {
      enabled: true,
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      user: 'mailuser',
      pass: SENTINEL_PASS,
      from: '"Pica" <no-reply@example.com>',
      ...overrides.mail,
    },
    mailConfigured: true,
    ...overrides,
  };
}

// Fake stores with Task 5/6 switches absent (defaulting to on per spec).
function makeStores(overrides = {}) {
  return {
    usersStore: {
      findById: (id) => ({ id, username: 'alice', role: 'employee' }),
      ...overrides.usersStore,
    },
    employeesStore: {
      // employeesStore.readProfile(id) -> { id, contactEmail, ... } | null
      readProfile: (id) => ({
        id,
        fullName: 'Alice Example',
        contactEmail: CONTACT_EMAIL,
      }),
      ...overrides.employeesStore,
    },
    userPrefsStore: {
      // userPrefsStore.get(userId) -> { locale, colorMode, email? }
      // The email sub-object is added by Task 6; absent here = default-on.
      get: (id) => ({ locale: 'en-US', colorMode: 'system' }),
      ...overrides.userPrefsStore,
    },
    orgSettingsStore: {
      // orgSettingsStore.get() -> full org settings object
      // The notifications sub-object is added by Task 5; absent here = default-on.
      get: () => ({
        company: { name: null },
        leaves: {},
        backups: {},
        workingTime: {},
        // no notifications key yet — Task 5 adds it; mailer must default to on
      }),
      ...overrides.orgSettingsStore,
    },
  };
}

function makeLogger() {
  const calls = { warn: [], error: [], info: [] };
  return {
    warn: (...args) => calls.warn.push(args),
    error: (...args) => calls.error.push(args),
    info: (...args) => calls.info.push(args),
    calls,
  };
}

function makeAudit() {
  const records = [];
  return {
    appendRecord: (rec) => { records.push(rec); },
    records,
  };
}

// Vars for a basic leaveDecision call.
const LEAVE_VARS = { status: 'approved', type: 'vacation', start: '2026-06-01', end: '2026-06-05', unit: 'days' };

// ---------------------------------------------------------------------------
// Layer 1: config.mail.enabled !== true
// ---------------------------------------------------------------------------
console.log('\nGating layer 1 — mail disabled');

await test('mail disabled → {sent:false, reason:"mail_disabled"}, sendMail not called', async () => {
  const sendMailSpy = async () => { throw new Error('should not be called'); };
  const mailer = makeMailer({
    ...makeStores(),
    config: makeConfig({ mail: { enabled: false } }),
    logger: makeLogger(),
    audit: makeAudit(),
    sendMail: sendMailSpy,
  });
  const result = await mailer.notify('leaveDecision', { recipientUserId: RECIPIENT_ID, vars: LEAVE_VARS });
  assert.deepEqual(result, { sent: false, reason: 'mail_disabled' });
});

await test('mail.enabled missing → mail_disabled', async () => {
  const config = makeConfig();
  delete config.mail.enabled;
  const mailer = makeMailer({
    ...makeStores(),
    config,
    logger: makeLogger(),
    audit: makeAudit(),
    sendMail: async () => { throw new Error('should not be called'); },
  });
  const result = await mailer.notify('leaveDecision', { recipientUserId: RECIPIENT_ID, vars: LEAVE_VARS });
  assert.deepEqual(result, { sent: false, reason: 'mail_disabled' });
});

// ---------------------------------------------------------------------------
// Layer 2: org switch off → org_disabled
// ---------------------------------------------------------------------------
console.log('\nGating layer 2 — org disabled');

await test('org notifications.leaveDecision:false → {sent:false, reason:"org_disabled"}', async () => {
  const mailer = makeMailer({
    ...makeStores({
      orgSettingsStore: {
        get: () => ({ notifications: { leaveDecision: false, correctionDecision: true, leaveReminder: true } }),
      },
    }),
    config: makeConfig(),
    logger: makeLogger(),
    audit: makeAudit(),
    sendMail: async () => { throw new Error('should not be called'); },
  });
  const result = await mailer.notify('leaveDecision', { recipientUserId: RECIPIENT_ID, vars: LEAVE_VARS });
  assert.deepEqual(result, { sent: false, reason: 'org_disabled' });
});

await test('org notifications.correctionDecision:false → org_disabled for correctionDecision', async () => {
  const mailer = makeMailer({
    ...makeStores({
      orgSettingsStore: {
        get: () => ({ notifications: { leaveDecision: true, correctionDecision: false, leaveReminder: true } }),
      },
    }),
    config: makeConfig(),
    logger: makeLogger(),
    audit: makeAudit(),
    sendMail: async () => { throw new Error('should not be called'); },
  });
  const result = await mailer.notify('correctionDecision', {
    recipientUserId: RECIPIENT_ID,
    vars: { status: 'approved', date: '2026-06-01' },
  });
  assert.deepEqual(result, { sent: false, reason: 'org_disabled' });
});

await test('org notifications.leaveReminder:false → org_disabled for leaveReminder', async () => {
  const mailer = makeMailer({
    ...makeStores({
      orgSettingsStore: {
        get: () => ({ notifications: { leaveDecision: true, correctionDecision: true, leaveReminder: false } }),
      },
    }),
    config: makeConfig(),
    logger: makeLogger(),
    audit: makeAudit(),
    sendMail: async () => { throw new Error('should not be called'); },
  });
  const result = await mailer.notify('leaveReminder', {
    recipientUserId: RECIPIENT_ID,
    vars: { type: 'vacation', start: '2026-06-01', end: '2026-06-05', unit: 'days' },
  });
  assert.deepEqual(result, { sent: false, reason: 'org_disabled' });
});

await test('org notifications absent (Task 5 not yet done) → defaults to on (passes layer 2)', async () => {
  // sendMail throws so we'll get send_error, proving we got past layer 2
  const mailer = makeMailer({
    ...makeStores({
      orgSettingsStore: { get: () => ({}) }, // no notifications key
    }),
    config: makeConfig(),
    logger: makeLogger(),
    audit: makeAudit(),
    sendMail: async () => { throw new Error('forced failure'); },
  });
  const result = await mailer.notify('leaveDecision', { recipientUserId: RECIPIENT_ID, vars: LEAVE_VARS });
  // Should reach send attempt — not org_disabled
  assert.notEqual(result.reason, 'org_disabled', 'should not be org_disabled when notifications key missing');
});

// ---------------------------------------------------------------------------
// Layer 3: per-user switch
// ---------------------------------------------------------------------------
console.log('\nGating layer 3 — user opted out');

await test('user email.notifications:false → user_opted_out for leaveDecision', async () => {
  const mailer = makeMailer({
    ...makeStores({
      userPrefsStore: {
        get: (id) => ({ locale: 'en-US', colorMode: 'system', email: { notifications: false, reminders: true } }),
      },
    }),
    config: makeConfig(),
    logger: makeLogger(),
    audit: makeAudit(),
    sendMail: async () => { throw new Error('should not be called'); },
  });
  const result = await mailer.notify('leaveDecision', { recipientUserId: RECIPIENT_ID, vars: LEAVE_VARS });
  assert.deepEqual(result, { sent: false, reason: 'user_opted_out' });
});

await test('user email.notifications:false → user_opted_out for correctionDecision', async () => {
  const mailer = makeMailer({
    ...makeStores({
      userPrefsStore: {
        get: (id) => ({ locale: 'en-US', colorMode: 'system', email: { notifications: false, reminders: true } }),
      },
    }),
    config: makeConfig(),
    logger: makeLogger(),
    audit: makeAudit(),
    sendMail: async () => { throw new Error('should not be called'); },
  });
  const result = await mailer.notify('correctionDecision', {
    recipientUserId: RECIPIENT_ID,
    vars: { status: 'approved', date: '2026-06-01' },
  });
  assert.deepEqual(result, { sent: false, reason: 'user_opted_out' });
});

await test('user email.reminders:false → user_opted_out for leaveReminder', async () => {
  const mailer = makeMailer({
    ...makeStores({
      userPrefsStore: {
        get: (id) => ({ locale: 'en-US', colorMode: 'system', email: { notifications: true, reminders: false } }),
      },
    }),
    config: makeConfig(),
    logger: makeLogger(),
    audit: makeAudit(),
    sendMail: async () => { throw new Error('should not be called'); },
  });
  const result = await mailer.notify('leaveReminder', {
    recipientUserId: RECIPIENT_ID,
    vars: { type: 'vacation', start: '2026-06-01', end: '2026-06-05', unit: 'days' },
  });
  assert.deepEqual(result, { sent: false, reason: 'user_opted_out' });
});

await test('user email.reminders:false does NOT block leaveDecision (different toggle)', async () => {
  // email.reminders=false should only block leaveReminder, not leaveDecision.
  // sendMail throws so we get send_error — proves we got past the user layer.
  const mailer = makeMailer({
    ...makeStores({
      userPrefsStore: {
        get: (id) => ({ locale: 'en-US', colorMode: 'system', email: { notifications: true, reminders: false } }),
      },
    }),
    config: makeConfig(),
    logger: makeLogger(),
    audit: makeAudit(),
    sendMail: async () => { throw new Error('forced'); },
  });
  const result = await mailer.notify('leaveDecision', { recipientUserId: RECIPIENT_ID, vars: LEAVE_VARS });
  assert.notEqual(result.reason, 'user_opted_out', 'reminders:false must not block leaveDecision');
});

await test('user email sub-object absent (Task 6 not done) → defaults to on (passes layer 3)', async () => {
  // No email sub-object → treat all as true.
  const mailer = makeMailer({
    ...makeStores({
      userPrefsStore: {
        get: (id) => ({ locale: 'en-US', colorMode: 'system' }),
      },
    }),
    config: makeConfig(),
    logger: makeLogger(),
    audit: makeAudit(),
    sendMail: async () => { throw new Error('forced failure'); },
  });
  const result = await mailer.notify('leaveDecision', { recipientUserId: RECIPIENT_ID, vars: LEAVE_VARS });
  assert.notEqual(result.reason, 'user_opted_out', 'should not be user_opted_out when email sub-object absent');
});

// ---------------------------------------------------------------------------
// Layer 4: no address
// ---------------------------------------------------------------------------
console.log('\nGating layer 4 — no contact address');

await test('contactEmail empty string → {sent:false, reason:"no_address"}', async () => {
  const mailer = makeMailer({
    ...makeStores({
      employeesStore: {
        readProfile: (id) => ({ id, fullName: 'Alice', contactEmail: '' }),
      },
    }),
    config: makeConfig(),
    logger: makeLogger(),
    audit: makeAudit(),
    sendMail: async () => { throw new Error('should not be called'); },
  });
  const result = await mailer.notify('leaveDecision', { recipientUserId: RECIPIENT_ID, vars: LEAVE_VARS });
  assert.deepEqual(result, { sent: false, reason: 'no_address' });
});

await test('contactEmail null → no_address', async () => {
  const mailer = makeMailer({
    ...makeStores({
      employeesStore: {
        readProfile: (id) => ({ id, fullName: 'Alice', contactEmail: null }),
      },
    }),
    config: makeConfig(),
    logger: makeLogger(),
    audit: makeAudit(),
    sendMail: async () => { throw new Error('should not be called'); },
  });
  const result = await mailer.notify('leaveDecision', { recipientUserId: RECIPIENT_ID, vars: LEAVE_VARS });
  assert.deepEqual(result, { sent: false, reason: 'no_address' });
});

await test('employee profile not found → no_address', async () => {
  const mailer = makeMailer({
    ...makeStores({
      employeesStore: {
        readProfile: (id) => null,
      },
    }),
    config: makeConfig(),
    logger: makeLogger(),
    audit: makeAudit(),
    sendMail: async () => { throw new Error('should not be called'); },
  });
  const result = await mailer.notify('leaveDecision', { recipientUserId: RECIPIENT_ID, vars: LEAVE_VARS });
  assert.deepEqual(result, { sent: false, reason: 'no_address' });
});

await test('contactEmail whitespace-only → no_address (exercises the .trim() === "" guard)', async () => {
  const mailer = makeMailer({
    ...makeStores({
      employeesStore: {
        readProfile: (id) => ({ id, contactEmail: '   ' }),
      },
    }),
    config: makeConfig(),
    logger: makeLogger(),
    audit: makeAudit(),
    sendMail: async () => { throw new Error('should not be called'); },
  });
  const result = await mailer.notify('leaveDecision', { recipientUserId: RECIPIENT_ID, vars: LEAVE_VARS });
  assert.deepEqual(result, { sent: false, reason: 'no_address' });
});

// ---------------------------------------------------------------------------
// Happy path — all layers pass, sendMail called correctly
// ---------------------------------------------------------------------------
console.log('\nHappy path — all-on');

await test('all-on: calls sendMail once with correct args, returns {sent:true}, audit mail.sent', async () => {
  const logger = makeLogger();
  const audit = makeAudit();
  const sendMailCalls = [];
  const mailer = makeMailer({
    ...makeStores(),
    config: makeConfig(),
    logger,
    audit,
    sendMail: async (args) => { sendMailCalls.push(args); },
  });
  const result = await mailer.notify('leaveDecision', { recipientUserId: RECIPIENT_ID, vars: LEAVE_VARS });

  assert.deepEqual(result, { sent: true });
  assert.equal(sendMailCalls.length, 1, 'sendMail called exactly once');

  const call = sendMailCalls[0];
  // Must pass config.mail creds
  assert.equal(call.host, 'smtp.example.com');
  assert.equal(call.port, 587);
  assert.equal(call.user, 'mailuser');
  assert.equal(call.pass, SENTINEL_PASS);
  assert.equal(call.from, '"Pica" <no-reply@example.com>');
  // Must pass resolved recipient address
  assert.equal(call.to, CONTACT_EMAIL);
  // Must pass rendered subject and text
  assert.ok(typeof call.subject === 'string' && call.subject.length > 0, 'subject non-empty');
  assert.ok(typeof call.text === 'string' && call.text.length > 0, 'text non-empty');

  // Audit must record mail.sent with category + recipientId, NO email/body
  const sentRecord = audit.records.find((r) => r.event === 'mail.sent');
  assert.ok(sentRecord, 'audit mail.sent recorded');
  assert.equal(sentRecord.category, 'leaveDecision');
  assert.equal(sentRecord.recipientId, RECIPIENT_ID);
  // Ensure no logger warnings were emitted on the happy path
  assert.equal(logger.calls.warn.length, 0, 'no warnings on success');
});

await test('sendMail called once (not multiple times)', async () => {
  let count = 0;
  const mailer = makeMailer({
    ...makeStores(),
    config: makeConfig(),
    logger: makeLogger(),
    audit: makeAudit(),
    sendMail: async () => { count++; },
  });
  await mailer.notify('leaveDecision', { recipientUserId: RECIPIENT_ID, vars: LEAVE_VARS });
  assert.equal(count, 1);
});

// ---------------------------------------------------------------------------
// send error — sendMail throws → resolves send_error, no throw
// ---------------------------------------------------------------------------
console.log('\nError handling — sendMail throws');

await test('sendMail throws → resolves {sent:false, reason:"send_error"} (never throws)', async () => {
  const errWithCode = new Error('SMTP 550');
  errWithCode.smtpCode = 550;
  const logger = makeLogger();
  const audit = makeAudit();
  const mailer = makeMailer({
    ...makeStores(),
    config: makeConfig(),
    logger,
    audit,
    sendMail: async () => { throw errWithCode; },
  });
  const result = await mailer.notify('leaveDecision', { recipientUserId: RECIPIENT_ID, vars: LEAVE_VARS });
  assert.deepEqual(result, { sent: false, reason: 'send_error' });
});

await test('on send error: logger.warn is called', async () => {
  const logger = makeLogger();
  const mailer = makeMailer({
    ...makeStores(),
    config: makeConfig(),
    logger,
    audit: makeAudit(),
    sendMail: async () => { throw new Error('boom'); },
  });
  await mailer.notify('leaveDecision', { recipientUserId: RECIPIENT_ID, vars: LEAVE_VARS });
  assert.ok(logger.calls.warn.length > 0, 'logger.warn must be called on send failure');
});

await test('on send error: audit mail.send_failed recorded with category + recipientId', async () => {
  const audit = makeAudit();
  const mailer = makeMailer({
    ...makeStores(),
    config: makeConfig(),
    logger: makeLogger(),
    audit,
    sendMail: async () => { throw new Error('boom'); },
  });
  await mailer.notify('leaveDecision', { recipientUserId: RECIPIENT_ID, vars: LEAVE_VARS });
  const failRecord = audit.records.find((r) => r.event === 'mail.send_failed');
  assert.ok(failRecord, 'audit mail.send_failed must be recorded');
  assert.equal(failRecord.category, 'leaveDecision');
  assert.equal(failRecord.recipientId, RECIPIENT_ID);
});

await test('on send error: smtpCode in audit when present on error', async () => {
  const audit = makeAudit();
  const err = new Error('rejected');
  err.smtpCode = 421;
  const mailer = makeMailer({
    ...makeStores(),
    config: makeConfig(),
    logger: makeLogger(),
    audit,
    sendMail: async () => { throw err; },
  });
  await mailer.notify('leaveDecision', { recipientUserId: RECIPIENT_ID, vars: LEAVE_VARS });
  const failRecord = audit.records.find((r) => r.event === 'mail.send_failed');
  assert.ok(failRecord, 'fail record must exist');
  assert.equal(failRecord.smtpCode, 421, 'smtpCode must be forwarded when present');
});

await test('CRITICAL: pass sentinel never appears in any logger or audit arg on error', async () => {
  const logger = makeLogger();
  const audit = makeAudit();
  const mailer = makeMailer({
    ...makeStores(),
    config: makeConfig(),
    logger,
    audit,
    sendMail: async () => { throw new Error('SMTP error ' + SENTINEL_PASS); },
  });
  await mailer.notify('leaveDecision', { recipientUserId: RECIPIENT_ID, vars: LEAVE_VARS });

  const allLogArgs = [
    ...logger.calls.warn.flat(),
    ...logger.calls.error.flat(),
    ...logger.calls.info.flat(),
  ].map((a) => (typeof a === 'string' ? a : JSON.stringify(a)));

  for (const s of allLogArgs) {
    assert.ok(!s.includes(SENTINEL_PASS), `pass must not appear in logger args: ${s}`);
  }

  const allAuditArgs = audit.records.map((r) => JSON.stringify(r));
  for (const s of allAuditArgs) {
    assert.ok(!s.includes(SENTINEL_PASS), `pass must not appear in audit records: ${s}`);
  }
});

await test('CRITICAL: contactEmail never appears in audit records or logger calls', async () => {
  const logger = makeLogger();
  const audit = makeAudit();
  const mailer = makeMailer({
    ...makeStores(),
    config: makeConfig(),
    logger,
    audit,
    sendMail: async () => {},
  });
  await mailer.notify('leaveDecision', { recipientUserId: RECIPIENT_ID, vars: LEAVE_VARS });

  // Scan audit records (original assertion — must not be weakened).
  for (const rec of audit.records) {
    const s = JSON.stringify(rec);
    assert.ok(!s.includes(CONTACT_EMAIL), `contactEmail must not appear in audit record: ${s}`);
  }

  // Parity with the pass-sentinel test: also scan all logger args so that
  // a future refactor cannot accidentally leak the address into a log line.
  const allLogArgs = [
    ...logger.calls.warn.flat(),
    ...logger.calls.error.flat(),
    ...logger.calls.info.flat(),
  ].map((a) => (typeof a === 'string' ? a : JSON.stringify(a)));
  for (const s of allLogArgs) {
    assert.ok(!s.includes(CONTACT_EMAIL), `contactEmail must not appear in logger args: ${s}`);
  }
});

// ---------------------------------------------------------------------------
// passwordResetNotice — bypasses org + user layers
// ---------------------------------------------------------------------------
console.log('\npasswordResetNotice — bypasses org+user gating');

await test('passwordResetNotice sends even when org notifications all false', async () => {
  let sent = false;
  const mailer = makeMailer({
    ...makeStores({
      orgSettingsStore: {
        get: () => ({ notifications: { leaveDecision: false, correctionDecision: false, leaveReminder: false } }),
      },
    }),
    config: makeConfig(),
    logger: makeLogger(),
    audit: makeAudit(),
    sendMail: async () => { sent = true; },
  });
  const result = await mailer.notify('passwordResetNotice', { recipientUserId: RECIPIENT_ID, vars: {} });
  assert.deepEqual(result, { sent: true });
  assert.ok(sent, 'sendMail must be called for passwordResetNotice even with org flags off');
});

await test('passwordResetNotice sends even when user email.notifications AND reminders are false', async () => {
  let sent = false;
  const mailer = makeMailer({
    ...makeStores({
      userPrefsStore: {
        get: (id) => ({ locale: 'en-US', colorMode: 'system', email: { notifications: false, reminders: false } }),
      },
    }),
    config: makeConfig(),
    logger: makeLogger(),
    audit: makeAudit(),
    sendMail: async () => { sent = true; },
  });
  const result = await mailer.notify('passwordResetNotice', { recipientUserId: RECIPIENT_ID, vars: {} });
  assert.deepEqual(result, { sent: true });
  assert.ok(sent, 'sendMail must be called for passwordResetNotice even with user opts-out');
});

await test('passwordResetNotice still blocked by mail_disabled', async () => {
  const mailer = makeMailer({
    ...makeStores(),
    config: makeConfig({ mail: { enabled: false } }),
    logger: makeLogger(),
    audit: makeAudit(),
    sendMail: async () => { throw new Error('should not be called'); },
  });
  const result = await mailer.notify('passwordResetNotice', { recipientUserId: RECIPIENT_ID, vars: {} });
  assert.deepEqual(result, { sent: false, reason: 'mail_disabled' });
});

await test('passwordResetNotice still blocked by no_address', async () => {
  const mailer = makeMailer({
    ...makeStores({
      employeesStore: { readProfile: () => ({ id: RECIPIENT_ID, contactEmail: '' }) },
    }),
    config: makeConfig(),
    logger: makeLogger(),
    audit: makeAudit(),
    sendMail: async () => { throw new Error('should not be called'); },
  });
  const result = await mailer.notify('passwordResetNotice', { recipientUserId: RECIPIENT_ID, vars: {} });
  assert.deepEqual(result, { sent: false, reason: 'no_address' });
});

// ---------------------------------------------------------------------------
// Locale handling
// ---------------------------------------------------------------------------
console.log('\nLocale handling');

await test('userPrefsStore returns pt-PT → sendMail called with pt-PT rendered content', async () => {
  const sendMailCalls = [];
  const mailer = makeMailer({
    ...makeStores({
      userPrefsStore: {
        get: (id) => ({ locale: 'pt-PT', colorMode: 'system' }),
      },
    }),
    config: makeConfig(),
    logger: makeLogger(),
    audit: makeAudit(),
    sendMail: async (args) => { sendMailCalls.push(args); },
  });
  await mailer.notify('leaveDecision', { recipientUserId: RECIPIENT_ID, vars: LEAVE_VARS });
  assert.equal(sendMailCalls.length, 1);
  // pt-PT template should render Portuguese content (not English)
  // We just verify it's different from the en-US subject as a sanity check,
  // but mainly we trust that renderEmail forwards the locale correctly.
  const call = sendMailCalls[0];
  assert.ok(typeof call.subject === 'string' && call.subject.length > 0, 'subject present');
  // pt-PT leaveDecision subject should NOT be the English version
  assert.ok(!call.subject.startsWith('Your'), 'pt-PT subject should not start with English "Your"');
});

await test('unknown locale → falls back to en-US (no throw)', async () => {
  const sendMailCalls = [];
  const mailer = makeMailer({
    ...makeStores({
      userPrefsStore: {
        get: (id) => ({ locale: 'xx-XX', colorMode: 'system' }),
      },
    }),
    config: makeConfig(),
    logger: makeLogger(),
    audit: makeAudit(),
    sendMail: async (args) => { sendMailCalls.push(args); },
  });
  const result = await mailer.notify('leaveDecision', { recipientUserId: RECIPIENT_ID, vars: LEAVE_VARS });
  assert.deepEqual(result, { sent: true });
  assert.equal(sendMailCalls.length, 1, 'sendMail called even with unknown locale');
  // Should fall back to en-US
  assert.ok(sendMailCalls[0].subject.startsWith('Your'), 'en-US fallback subject used');
});

await test('userPrefsStore locale absent → defaults to en-US', async () => {
  const sendMailCalls = [];
  const mailer = makeMailer({
    ...makeStores({
      userPrefsStore: {
        get: (id) => ({ colorMode: 'system' }), // no locale field
      },
    }),
    config: makeConfig(),
    logger: makeLogger(),
    audit: makeAudit(),
    sendMail: async (args) => { sendMailCalls.push(args); },
  });
  const result = await mailer.notify('leaveDecision', { recipientUserId: RECIPIENT_ID, vars: LEAVE_VARS });
  assert.deepEqual(result, { sent: true });
  assert.equal(sendMailCalls.length, 1);
});

// ---------------------------------------------------------------------------
// Unknown category — programmer error must not throw out of notify
// ---------------------------------------------------------------------------
console.log('\nUnknown category — programmer error containment');

await test('unknown category → resolves (does not throw), returns sent:false', async () => {
  const mailer = makeMailer({
    ...makeStores(),
    config: makeConfig(),
    logger: makeLogger(),
    audit: makeAudit(),
    sendMail: async () => {},
  });
  // Must not throw — void-safe
  const result = await mailer.notify('bogusCategory', { recipientUserId: RECIPIENT_ID, vars: {} });
  assert.equal(result.sent, false, 'unknown category must return sent:false');
});

// ---------------------------------------------------------------------------
// notify always resolves (never rejects) — even on store accessor failure
// ---------------------------------------------------------------------------
console.log('\nNever-throws guarantee');

await test('employeesStore.readProfile throws → notify resolves (never rejects)', async () => {
  const mailer = makeMailer({
    ...makeStores({
      employeesStore: {
        readProfile: () => { throw new Error('disk error'); },
      },
    }),
    config: makeConfig(),
    logger: makeLogger(),
    audit: makeAudit(),
    sendMail: async () => {},
  });
  const result = await mailer.notify('leaveDecision', { recipientUserId: RECIPIENT_ID, vars: LEAVE_VARS });
  assert.equal(result.sent, false, 'must return sent:false on store failure');
});

await test('orgSettingsStore.get throws → notify resolves (never rejects)', async () => {
  const mailer = makeMailer({
    ...makeStores({
      orgSettingsStore: {
        get: () => { throw new Error('store error'); },
      },
    }),
    config: makeConfig(),
    logger: makeLogger(),
    audit: makeAudit(),
    sendMail: async () => {},
  });
  const result = await mailer.notify('leaveDecision', { recipientUserId: RECIPIENT_ID, vars: LEAVE_VARS });
  assert.equal(result.sent, false);
});

await test('userPrefsStore.get throws → notify resolves (never rejects)', async () => {
  const mailer = makeMailer({
    ...makeStores({
      userPrefsStore: {
        get: () => { throw new Error('prefs error'); },
      },
    }),
    config: makeConfig(),
    logger: makeLogger(),
    audit: makeAudit(),
    sendMail: async () => {},
  });
  const result = await mailer.notify('leaveDecision', { recipientUserId: RECIPIENT_ID, vars: LEAVE_VARS });
  assert.equal(result.sent, false);
});

// ---------------------------------------------------------------------------
// testEmail — bypasses org+user, still gated by mail_disabled and no_address
// ---------------------------------------------------------------------------
console.log('\ntestEmail — bypasses org+user gating');

await test('testEmail sends even when org notifications all false', async () => {
  let sent = false;
  const mailer = makeMailer({
    ...makeStores({
      orgSettingsStore: {
        get: () => ({ notifications: { leaveDecision: false, correctionDecision: false, leaveReminder: false } }),
      },
    }),
    config: makeConfig(),
    logger: makeLogger(),
    audit: makeAudit(),
    sendMail: async () => { sent = true; },
  });
  const result = await mailer.notify('testEmail', { recipientUserId: RECIPIENT_ID, vars: {} });
  assert.deepEqual(result, { sent: true });
  assert.ok(sent, 'sendMail must be called for testEmail even with org flags off');
});

await test('testEmail sends even when user email.notifications AND reminders are false', async () => {
  let sent = false;
  const mailer = makeMailer({
    ...makeStores({
      userPrefsStore: {
        get: (id) => ({ locale: 'en-US', colorMode: 'system', email: { notifications: false, reminders: false } }),
      },
    }),
    config: makeConfig(),
    logger: makeLogger(),
    audit: makeAudit(),
    sendMail: async () => { sent = true; },
  });
  const result = await mailer.notify('testEmail', { recipientUserId: RECIPIENT_ID, vars: {} });
  assert.deepEqual(result, { sent: true });
  assert.ok(sent, 'sendMail must be called for testEmail even when user opts-out of all notifications');
});

await test('testEmail still blocked by mail_disabled', async () => {
  const mailer = makeMailer({
    ...makeStores(),
    config: makeConfig({ mail: { enabled: false } }),
    logger: makeLogger(),
    audit: makeAudit(),
    sendMail: async () => { throw new Error('should not be called'); },
  });
  const result = await mailer.notify('testEmail', { recipientUserId: RECIPIENT_ID, vars: {} });
  assert.deepEqual(result, { sent: false, reason: 'mail_disabled' });
});

await test('testEmail still blocked by no_address', async () => {
  const mailer = makeMailer({
    ...makeStores({
      employeesStore: { readProfile: () => ({ id: RECIPIENT_ID, contactEmail: '' }) },
    }),
    config: makeConfig(),
    logger: makeLogger(),
    audit: makeAudit(),
    sendMail: async () => { throw new Error('should not be called'); },
  });
  const result = await mailer.notify('testEmail', { recipientUserId: RECIPIENT_ID, vars: {} });
  assert.deepEqual(result, { sent: false, reason: 'no_address' });
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
