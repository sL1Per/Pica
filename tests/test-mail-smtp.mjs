#!/usr/bin/env node
/**
 * test-mail-smtp.mjs — unit tests for src/mail/smtp.js
 *
 * Fully offline: every test uses a FakeSocket injected via _connect.
 * No real TCP/TLS connections are attempted anywhere.
 *
 * Run: node tests/test-mail-smtp.mjs
 */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { sendMail } from '../src/mail/smtp.js';

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
// FakeSocket — a deterministic duplex that captures writes and emits
// scripted server reply lines.
//
// Why EventEmitter and not PassThrough: we need fine-grained control over
// when server bytes arrive (one scripted "line" at a time, driven by the
// test's push() helper). PassThrough would buffer and release in a single
// tick which makes multi-step handshake scripting awkward.
// ---------------------------------------------------------------------------

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.written = '';   // accumulates everything the client sent
    this.destroyed = false;
  }

  write(s) {
    this.written += s;
  }

  // push a server reply line (without CRLF — added here for convenience)
  push(line) {
    // Defer emission so the client's await-on-data listener is registered first.
    // setImmediate gives control back to the event loop exactly once.
    setImmediate(() => this.emit('data', Buffer.from(line + '\r\n')));
  }

  destroy(err) {
    if (this.destroyed) return;
    this.destroyed = true;
    // Mimic net.Socket: emitting 'error' then 'close' when destroy() is called
    // with an error argument.  This unblocks any pending readReply promises
    // that are waiting on the 'error' event (e.g. the timeout path).
    setImmediate(() => {
      if (err) {
        if (this.listenerCount('error') > 0) {
          this.emit('error', err);
        }
      }
      this.emit('close');
    });
  }
}

// ---------------------------------------------------------------------------
// Script helpers
//
// A "script" is an array of [trigger, reply] pairs.  After the client
// sends a line that contains `trigger`, the fake emits `reply` as the
// server's response.  This works because we watch `written` in a polling
// setInterval and fire replies as soon as the trigger appears.
//
// Why polling instead of write-hook: the client may send several lines
// before the fake has had a chance to reply (e.g. EHLO then AUTH), and
// we want replies to arrive in order without coupling too tightly to the
// implementation's exact tick ordering.
// ---------------------------------------------------------------------------

/**
 * scriptSocket(sock, entries)
 *   entries: Array<{ trigger: string, reply: string | string[] }>
 *
 * Watches sock.written for each trigger in sequence (order matters);
 * once found, pushes the corresponding reply line(s).
 * Returns a cleanup function.
 */
function scriptSocket(sock, entries) {
  let idx = 0;
  const iv = setInterval(() => {
    if (idx >= entries.length) { clearInterval(iv); return; }
    const { trigger, reply } = entries[idx];
    if (sock.written.includes(trigger)) {
      idx++;
      const lines = Array.isArray(reply) ? reply : [reply];
      for (const line of lines) sock.push(line);
    }
  }, 1);
  return () => clearInterval(iv);
}

// ---------------------------------------------------------------------------
// Standard smtp.js call params
// ---------------------------------------------------------------------------

const BASE = {
  host: 'smtp.example.com',
  port: 465,
  secure: true,
  user: 'user@example.com',
  pass: 'S3cretPass!',
  from: 'Pica HR <user@example.com>',
  to: 'employee@example.com',
  subject: 'Hello',
  text: 'Hello, world!',
  timeoutMs: 2000,
};

const b64user = Buffer.from('user@example.com', 'utf8').toString('base64');
const b64pass = Buffer.from('S3cretPass!', 'utf8').toString('base64');

// ---------------------------------------------------------------------------
// Helper: build a _connect factory that hands out the given socket
// ---------------------------------------------------------------------------
function makeConnector(sock) {
  return (_opts) => sock;
}

// ---------------------------------------------------------------------------
// Test 1 — secure:true happy path; full protocol sequence asserted
// ---------------------------------------------------------------------------

console.log('secure:true happy path');

await test('full SMTP/S handshake and message delivery', async () => {
  const sock = new FakeSocket();
  const cleanup = scriptSocket(sock, [
    // server greeting — trigger is empty string so it fires immediately on first check
    { trigger: '',              reply: '220 smtp.example.com ESMTP' },
    { trigger: 'EHLO ',        reply: ['250-smtp.example.com Hello', '250 AUTH LOGIN PLAIN'] },
    { trigger: 'AUTH LOGIN',   reply: '334 VXNlcm5hbWU6' },    // Username: in base64
    { trigger: b64user,        reply: '334 UGFzc3dvcmQ6' },    // Password: in base64
    { trigger: b64pass,        reply: '235 2.7.0 Authentication successful' },
    { trigger: 'MAIL FROM:',   reply: '250 OK' },
    { trigger: 'RCPT TO:',     reply: '250 OK' },
    { trigger: 'DATA',         reply: '354 Start input' },
    { trigger: '\r\n.\r\n',    reply: '250 OK: queued' },
    { trigger: 'QUIT',         reply: '221 Bye' },
  ]);

  try {
    await sendMail({ ...BASE, _connect: makeConnector(sock) });
  } finally {
    cleanup();
  }

  const w = sock.written;

  // EHLO
  assert.match(w, /EHLO .+\r\n/, 'must send EHLO <fqdn>');

  // AUTH LOGIN sequence
  assert.ok(w.includes('AUTH LOGIN\r\n'), 'must send AUTH LOGIN');
  assert.ok(w.includes(b64user + '\r\n'), 'must send base64-encoded username');
  assert.ok(w.includes(b64pass + '\r\n'), 'must send base64-encoded password');

  // Envelope
  assert.match(w, /MAIL FROM:<user@example\.com>\r\n/, 'MAIL FROM must carry addr-spec');
  assert.match(w, /RCPT TO:<employee@example\.com>\r\n/, 'RCPT TO must carry addr-spec');
  assert.ok(w.includes('DATA\r\n'), 'must send DATA command');

  // Body terminator
  assert.ok(w.includes('\r\n.\r\n'), 'must end body with CRLF.CRLF');

  // QUIT
  assert.ok(w.includes('QUIT\r\n'), 'must send QUIT');

  // Headers in message body
  assert.match(w, /Content-Transfer-Encoding: base64/, 'must declare base64 CTE');
  assert.match(w, /MIME-Version: 1\.0/, 'must include MIME-Version');
  assert.match(w, /Content-Type: text\/plain; charset=UTF-8/, 'must set content-type');
  assert.match(w, /From: Pica HR <user@example\.com>/, 'must include From header');
  assert.match(w, /To: employee@example\.com/, 'must include To header');
  assert.match(w, /Subject: Hello/, 'must include Subject header');

  // Body is base64 of the text
  const expectedBody = Buffer.from('Hello, world!', 'utf8').toString('base64');
  assert.ok(w.includes(expectedBody), 'body must be base64 of the text');
});

// ---------------------------------------------------------------------------
// Test 2 — server 535 at AUTH; error carries smtpCode; pass NOT in message
// ---------------------------------------------------------------------------

console.log('\nAUTH rejection — 535');

await test('535 at AUTH rejects with smtpCode and no pass leak', async () => {
  const sock = new FakeSocket();
  const cleanup = scriptSocket(sock, [
    { trigger: '',            reply: '220 smtp.example.com ESMTP' },
    { trigger: 'EHLO ',       reply: ['250-smtp.example.com', '250 AUTH LOGIN PLAIN'] },
    { trigger: 'AUTH LOGIN',  reply: '334 VXNlcm5hbWU6' },
    { trigger: b64user,       reply: '334 UGFzc3dvcmQ6' },
    { trigger: b64pass,       reply: '535 5.7.8 Authentication credentials invalid' },
  ]);

  let err;
  try {
    await sendMail({ ...BASE, _connect: makeConnector(sock) });
  } catch (e) {
    err = e;
  } finally {
    cleanup();
  }

  assert.ok(err, 'should have rejected');
  assert.equal(err.smtpCode, 535, 'smtpCode must be 535');
  // Pass must NOT appear in message or stack
  assert.ok(!err.message.includes('S3cretPass!'), 'pass must not appear in err.message');
  assert.ok(!err.stack.includes('S3cretPass!'), 'pass must not appear in err.stack');
});

// ---------------------------------------------------------------------------
// Test 3 — 5xx at RCPT TO; rejects
// ---------------------------------------------------------------------------

console.log('\n5xx at RCPT');

await test('550 at RCPT TO rejects the promise', async () => {
  const sock = new FakeSocket();
  const cleanup = scriptSocket(sock, [
    { trigger: '',            reply: '220 smtp.example.com ESMTP' },
    { trigger: 'EHLO ',       reply: ['250-smtp.example.com', '250 AUTH LOGIN PLAIN'] },
    { trigger: 'AUTH LOGIN',  reply: '334 VXNlcm5hbWU6' },
    { trigger: b64user,       reply: '334 UGFzc3dvcmQ6' },
    { trigger: b64pass,       reply: '235 OK' },
    { trigger: 'MAIL FROM:',  reply: '250 OK' },
    { trigger: 'RCPT TO:',    reply: '550 5.1.1 No such user' },
  ]);

  let err;
  try {
    await sendMail({ ...BASE, _connect: makeConnector(sock) });
  } catch (e) {
    err = e;
  } finally {
    cleanup();
  }

  assert.ok(err, 'should have rejected');
  assert.equal(err.smtpCode, 550, 'smtpCode must be 550');
});

// ---------------------------------------------------------------------------
// Test 4 — timeout: no final line within timeoutMs → rejects
// ---------------------------------------------------------------------------

console.log('\ntimeout');

await test('no server reply within timeoutMs rejects', async () => {
  const sock = new FakeSocket();
  // Only send the greeting; then go silent. With timeoutMs:50 the socket
  // will be destroyed and the promise must reject.
  const cleanup = scriptSocket(sock, [
    { trigger: '',        reply: '220 smtp.example.com ESMTP' },
    { trigger: 'EHLO ',   reply: ['250-smtp.example.com', '250 AUTH LOGIN PLAIN'] },
    { trigger: 'AUTH LOGIN', reply: '334 VXNlcm5hbWU6' },
    // After this the server goes silent — no reply to the base64-encoded username
  ]);

  let err;
  try {
    await sendMail({ ...BASE, timeoutMs: 50, _connect: makeConnector(sock) });
  } catch (e) {
    err = e;
  } finally {
    cleanup();
  }

  assert.ok(err, 'should have rejected on timeout');
});

// ---------------------------------------------------------------------------
// Test 5 — CRLF injection sanitization in `to`
// ---------------------------------------------------------------------------

console.log('\nCRLF injection guard');

await test('newline in to field is stripped before RCPT/headers', async () => {
  const injectedTo = 'legit@example.com\r\nBcc:attacker@evil.com';

  const sock = new FakeSocket();
  // We still need to drive the connection to a point where RCPT is visible
  // in sock.written; a quick server that accepts everything up through RCPT.
  const cleanup = scriptSocket(sock, [
    { trigger: '',            reply: '220 smtp.example.com ESMTP' },
    { trigger: 'EHLO ',       reply: ['250-smtp.example.com', '250 AUTH LOGIN PLAIN'] },
    { trigger: 'AUTH LOGIN',  reply: '334 VXNlcm5hbWU6' },
    { trigger: b64user,       reply: '334 UGFzc3dvcmQ6' },
    { trigger: b64pass,       reply: '235 OK' },
    { trigger: 'MAIL FROM:',  reply: '250 OK' },
    { trigger: 'RCPT TO:',    reply: '250 OK' },
    { trigger: 'DATA',        reply: '354 Start input' },
    { trigger: '\r\n.\r\n',   reply: '250 OK: queued' },
    { trigger: 'QUIT',        reply: '221 Bye' },
  ]);

  try {
    await sendMail({ ...BASE, to: injectedTo, _connect: makeConnector(sock) });
  } finally {
    cleanup();
  }

  const w = sock.written;
  // The raw CRLF must not appear in RCPT TO or in the To: header
  assert.ok(!w.includes('\r\nBcc:'), 'RCPT TO must not contain injected Bcc header');
  // RCPT TO line must contain only the sanitized address (no literal CRLF in addr)
  const rcptMatch = w.match(/RCPT TO:<([^>]+)>/);
  assert.ok(rcptMatch, 'RCPT TO must be present');
  assert.ok(!rcptMatch[1].includes('\r'), 'addr in RCPT TO must have no CR');
  assert.ok(!rcptMatch[1].includes('\n'), 'addr in RCPT TO must have no LF');
});

// ---------------------------------------------------------------------------
// Test 6 — non-ASCII subject is RFC-2047 encoded
// ---------------------------------------------------------------------------

console.log('\nRFC-2047 subject encoding');

await test('non-ASCII subject is =?UTF-8?B?...?= encoded', async () => {
  const sock = new FakeSocket();
  const cleanup = scriptSocket(sock, [
    { trigger: '',            reply: '220 smtp.example.com ESMTP' },
    { trigger: 'EHLO ',       reply: ['250-smtp.example.com', '250 AUTH LOGIN PLAIN'] },
    { trigger: 'AUTH LOGIN',  reply: '334 VXNlcm5hbWU6' },
    { trigger: b64user,       reply: '334 UGFzc3dvcmQ6' },
    { trigger: b64pass,       reply: '235 OK' },
    { trigger: 'MAIL FROM:',  reply: '250 OK' },
    { trigger: 'RCPT TO:',    reply: '250 OK' },
    { trigger: 'DATA',        reply: '354 Start input' },
    { trigger: '\r\n.\r\n',   reply: '250 OK: queued' },
    { trigger: 'QUIT',        reply: '221 Bye' },
  ]);

  const subject = 'Férias';
  try {
    await sendMail({ ...BASE, subject, _connect: makeConnector(sock) });
  } finally {
    cleanup();
  }

  const w = sock.written;
  // Subject header must be RFC-2047 encoded (=?UTF-8?B?...?=)
  const encoded = `=?UTF-8?B?${Buffer.from('Férias', 'utf8').toString('base64')}?=`;
  assert.ok(w.includes(`Subject: ${encoded}`), `Subject must be RFC-2047: got ${w.match(/Subject: .+/)?.[0]}`);
});

// ---------------------------------------------------------------------------
// Test 7 — STARTTLS path (secure:false)
// ---------------------------------------------------------------------------

console.log('\nSTARTTLS path (secure:false)');

await test('STARTTLS: EHLO → STARTTLS → TLS upgrade → EHLO → AUTH → DATA', async () => {
  // Two sockets: plain phase and TLS phase.
  // _connect is called twice: first with { tls: false } → plainSock,
  // then with { tls: true, upgrade: plainSock } → tlsSock.
  const plainSock = new FakeSocket();
  const tlsSock = new FakeSocket();

  let plainDone = false;

  const _connect = (opts) => {
    if (!opts.tls) return plainSock;
    // tls upgrade — TLS phase socket
    plainDone = true;
    return tlsSock;
  };

  // Script the plain phase
  const cleanupPlain = scriptSocket(plainSock, [
    { trigger: '',          reply: '220 smtp.example.com ESMTP' },
    { trigger: 'EHLO ',     reply: ['250-smtp.example.com Hello', '250-STARTTLS', '250 AUTH LOGIN PLAIN'] },
    { trigger: 'STARTTLS',  reply: '220 Ready to start TLS' },
  ]);

  // Script the TLS phase (a fresh EHLO after upgrade)
  const cleanupTls = scriptSocket(tlsSock, [
    { trigger: 'EHLO ',      reply: ['250-smtp.example.com Hello', '250 AUTH LOGIN PLAIN'] },
    { trigger: 'AUTH LOGIN', reply: '334 VXNlcm5hbWU6' },
    { trigger: b64user,      reply: '334 UGFzc3dvcmQ6' },
    { trigger: b64pass,      reply: '235 OK' },
    { trigger: 'MAIL FROM:', reply: '250 OK' },
    { trigger: 'RCPT TO:',  reply: '250 OK' },
    { trigger: 'DATA',       reply: '354 Start input' },
    { trigger: '\r\n.\r\n', reply: '250 OK: queued' },
    { trigger: 'QUIT',       reply: '221 Bye' },
  ]);

  try {
    await sendMail({
      ...BASE,
      port: 587,
      secure: false,
      _connect,
    });
  } finally {
    cleanupPlain();
    cleanupTls();
  }

  // Plain socket must have sent EHLO and STARTTLS
  assert.match(plainSock.written, /EHLO .+\r\n/, 'plain phase must send EHLO');
  assert.ok(plainSock.written.includes('STARTTLS\r\n'), 'plain phase must send STARTTLS');

  // TLS socket must have sent EHLO again then AUTH and DATA
  assert.match(tlsSock.written, /EHLO .+\r\n/, 'TLS phase must re-send EHLO');
  assert.ok(tlsSock.written.includes('AUTH LOGIN\r\n'), 'TLS phase must do AUTH LOGIN');
  assert.ok(tlsSock.written.includes('\r\n.\r\n'), 'TLS phase must send message');

  // Ensure upgrade was attempted
  assert.ok(plainDone, '_connect should have been called with tls:true for upgrade');
});

// ---------------------------------------------------------------------------
// Test 8 — STARTTLS no-downgrade: server omits STARTTLS from caps → reject
//           AND no credentials sent on the plain socket
// ---------------------------------------------------------------------------

console.log('\nSTARTTLS no-downgrade guard');

await test('secure:false rejects when server does not advertise STARTTLS', async () => {
  const plainSock = new FakeSocket();

  const _connect = (_opts) => plainSock;

  // Server greets and answers EHLO with capabilities that do NOT include STARTTLS.
  const cleanup = scriptSocket(plainSock, [
    { trigger: '',      reply: '220 smtp.example.com ESMTP' },
    { trigger: 'EHLO ', reply: ['250-smtp.example.com', '250 AUTH LOGIN'] },
    // Nothing further — sendMail must throw before reaching AUTH
  ]);

  let err;
  try {
    await sendMail({
      ...BASE,
      port: 587,
      secure: false,
      _connect,
    });
  } catch (e) {
    err = e;
  } finally {
    cleanup();
  }

  assert.ok(err, 'should have rejected when STARTTLS is absent');
  assert.match(err.message, /STARTTLS/i, 'error message must mention STARTTLS');

  // Security: AUTH LOGIN, username, and password must NOT have been written
  // to the plain socket — credentials must never go out in the clear.
  const w = plainSock.written;
  assert.ok(!w.includes('AUTH LOGIN'), 'AUTH LOGIN must not be sent on plain socket');
  assert.ok(!w.includes(b64user), 'base64 username must not be sent on plain socket');
  assert.ok(!w.includes(b64pass), 'base64 password must not be sent on plain socket');
});

// ---------------------------------------------------------------------------

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
