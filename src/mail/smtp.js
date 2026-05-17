/**
 * src/mail/smtp.js — minimal SMTP submission client
 *
 * Implements just enough of RFC 5321 to submit a single-recipient
 * text/plain message via AUTH LOGIN over implicit TLS (SMTPS/465)
 * or STARTTLS (587).  Zero npm dependencies: node:net, node:tls,
 * node:os, node:crypto only.
 *
 * Why AUTH LOGIN and not AUTH PLAIN: it is the lowest-common-denominator
 * mechanism universally supported by hosted SMTP relays (Gmail, Outlook,
 * SendGrid, etc.).  XOAUTH2 would be preferable for production deployments
 * but requires an OAuth flow that is out of scope for M14.
 *
 * Why base64 body (CTE: base64) and not quoted-printable: simpler encoder,
 * no edge-case around long lines, and universally supported by MUAs.
 */

import net from 'node:net';
import tls from 'node:tls';
import os from 'node:os';
import crypto from 'node:crypto';

const CRLF = '\r\n';

// ---------------------------------------------------------------------------
// Header helpers
// ---------------------------------------------------------------------------

/**
 * Strip CR, LF, and any ASCII control chars from a header value.
 * Prevents header-injection attacks when user-supplied strings
 * (to, from, subject) end up in the message headers.
 */
function stripHeader(s) {
  return String(s).replace(/[\r\n\x00-\x1f\x7f]/g, ' ').trim();
}

/**
 * Extract the addr-spec from a display-name + addr-spec field.
 * "Pica HR <user@example.com>" → "user@example.com"
 * "user@example.com" → "user@example.com"
 *
 * We ONLY strip display names here; the addr-spec itself is further
 * sanitised by stripHeader to remove any injected CRLF.
 */
function addrSpec(s) {
  const m = /<([^>]+)>/.exec(s);
  return stripHeader(m ? m[1] : s);
}

/**
 * RFC-2047 encode a subject if it contains non-ASCII characters.
 * ASCII subjects pass through as-is (after header sanitation).
 * Non-ASCII: =?UTF-8?B?<base64>?=
 *
 * We use the B (base64) encoding because it is simpler than Q
 * (quoted-printable for headers) and requires no word-boundary logic.
 */
function encodeSubject(s) {
  const v = stripHeader(s);
  // If the string is entirely printable ASCII, no encoding needed.
  return /[^\x20-\x7e]/.test(v)
    ? `=?UTF-8?B?${Buffer.from(v, 'utf8').toString('base64')}?=`
    : v;
}

/**
 * Encode text to base64 and split into ≤76-char lines (RFC 2045 §6.8).
 * Lines are joined with CRLF; no trailing CRLF (the caller adds the
 * blank-line separator before and the CRLF.CRLF terminator after).
 */
function b64lines(text) {
  const b = Buffer.from(text, 'utf8').toString('base64');
  // Insert CRLF every 76 characters.
  return b.replace(/(.{1,76})/g, `$1${CRLF}`).replace(/\r\n$/, '');
}

// ---------------------------------------------------------------------------
// Protocol helpers
// ---------------------------------------------------------------------------

/**
 * Wait for the server to send a final reply line (one matching /^\d{3} /).
 * Multi-line responses (250-...) are accumulated and the whole block is
 * returned on the final "250 " line so callers can inspect capabilities.
 *
 * Resolves when the first digit of the status code matches `okFirstDigit`.
 * Rejects with an Error carrying `.smtpCode` on 4xx/5xx.
 *
 * Why we parse CRLF ourselves rather than using readline: we need
 * deterministic control over the data listener lifecycle (on/off) to
 * avoid listener leaks across the multi-step handshake.
 */
function readReply(conn, okFirstDigit) {
  return new Promise((resolve, reject) => {
    let buf = '';
    let full = '';

    const onData = (chunk) => {
      buf += chunk.toString('utf8');
      let i;
      while ((i = buf.indexOf(CRLF)) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        full += line + '\n';

        // Final reply line: three digits followed by a space (not a dash).
        if (/^\d{3} /.test(line)) {
          conn.off('data', onData);
          conn.off('error', onError);
          const code = Number(line.slice(0, 3));
          const firstDigit = String(code)[0];
          if (firstDigit === okFirstDigit ||
              (okFirstDigit === '2' && firstDigit === '3')) {
            return resolve({ code, full });
          }
          const e = new Error(`SMTP ${code}`);
          e.smtpCode = code;
          return reject(e);
        }
      }
    };

    const onError = (err) => {
      conn.off('data', onData);
      conn.off('error', onError);
      reject(err);
    };

    conn.on('data', onData);
    conn.on('error', onError);
  });
}

/**
 * Read the multi-line EHLO response (250-CAP lines then "250 LAST").
 * Returns the concatenated text so the caller can check for STARTTLS.
 */
function readEhlo(conn) {
  // readReply already handles multi-line: it accumulates until "^\d{3} ".
  return readReply(conn, '2').then((r) => r.full.toUpperCase());
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * sendMail(opts) → Promise<void>
 *
 * opts:
 *   host, port, secure (bool), user, pass, from, to, subject, text
 *   timeoutMs (default 15000) — destroy socket and reject if exceeded
 *   _connect — optional injection point for testing; called as
 *               _connect({ tls: bool }) → socket-like object.
 *               For the STARTTLS upgrade called again as
 *               _connect({ tls: true, upgrade: <plain-conn> }) → socket.
 *
 * Never throws synchronously.  Always cleans up the socket on error.
 * Never includes `pass` in any error message or rethrown stack.
 */
export async function sendMail({
  host,
  port,
  secure,
  user,
  pass,
  from,
  to,
  subject,
  text,
  timeoutMs = 15_000,
  _connect,
}) {
  // os.hostname() may return an empty string in some container environments.
  const fqdn = os.hostname() || 'pica';

  // Factory for real connections; _connect overrides for tests.
  const mkConn = _connect || ((opts) => {
    if (opts.tls && opts.upgrade) {
      // STARTTLS: wrap the EXISTING plain socket in TLS (Node's documented
      // upgrade pattern); do not re-dial host/port — we're already connected.
      return tls.connect({ socket: opts.upgrade, servername: host });
    }
    return opts.tls
      ? tls.connect({ host, port, servername: host })   // rejectUnauthorized defaults to true
      : net.connect({ host, port });
  });

  let conn = mkConn({ tls: !!secure });
  let timer;

  // Re-arm the inactivity timer on every outgoing write.  If the server
  // stops responding within timeoutMs, the socket is destroyed and the
  // pending readReply rejects via the 'error' event.
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try { conn.destroy(new Error('SMTP timeout')); } catch { /* ignored */ }
    }, timeoutMs);
  };

  const send = (line) => {
    arm();
    conn.write(line + CRLF);
  };

  try {
    arm();
    await readReply(conn, '2');                          // 220 greeting

    send(`EHLO ${fqdn}`);
    let caps = await readEhlo(conn);

    if (!secure) {
      // STARTTLS path (port 587).
      // RFC 3207: require STARTTLS in the EHLO caps; fail fast if absent so
      // callers know the relay is misconfigured rather than silently sending
      // credentials in the clear.
      if (!caps.includes('STARTTLS')) {
        throw new Error('STARTTLS not advertised by server');
      }
      send('STARTTLS');
      await readReply(conn, '2');                        // 220 Ready

      // Upgrade the plain socket to TLS.
      conn = mkConn({ tls: true, upgrade: conn });
      arm();

      // After TLS handshake, RFC 3207 §4 requires another EHLO.
      send(`EHLO ${fqdn}`);
      caps = await readEhlo(conn);
    }

    // AUTH LOGIN: server challenges for username then password separately.
    send('AUTH LOGIN');
    await readReply(conn, '3');                          // 334 Username:
    send(Buffer.from(user, 'utf8').toString('base64'));
    await readReply(conn, '3');                          // 334 Password:
    send(Buffer.from(pass, 'utf8').toString('base64'));
    await readReply(conn, '2');                          // 235 Authenticated

    // Envelope.
    send(`MAIL FROM:<${addrSpec(from)}>`);
    await readReply(conn, '2');                          // 250

    send(`RCPT TO:<${addrSpec(to)}>`);
    await readReply(conn, '2');                          // 250

    send('DATA');
    await readReply(conn, '3');                          // 354 Start input

    // Compose and send the message.  All CRLF line endings per RFC 5321 §2.3.8.
    const safeAddrTo = addrSpec(to);
    const headers = [
      `From: ${stripHeader(from)}`,
      `To: ${safeAddrTo}`,
      `Subject: ${encodeSubject(subject)}`,
      `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
      `Message-ID: <${crypto.randomUUID()}@${fqdn}>`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
    ].join(CRLF);

    // The message body: headers + blank line + base64 body + CRLF.CRLF terminator.
    // Written directly via conn.write() (not send()) because send() is only for
    // single CRLF-terminated command lines; the multi-line message body must not
    // have arm() called between headers and body content.
    arm();
    conn.write(headers + CRLF + CRLF + b64lines(text) + CRLF + '.' + CRLF);
    await readReply(conn, '2');                          // 250 OK: queued

    // QUIT is fire-and-forget: message already queued; no need to await 221 before close.
    send('QUIT');
    clearTimeout(timer);
    try { conn.destroy(); } catch { /* ignored */ }
  } catch (rawErr) {
    clearTimeout(timer);
    try { conn.destroy(); } catch { /* ignored */ }

    // Wrap the error so we can guarantee `pass` never appears in the message.
    // We use a fixed prefix + the original code number (if any) so callers
    // can programmatically branch on smtpCode without parsing text.
    //
    // The strip below is defense-in-depth: rawErr.message is otherwise only
    // server reply text + fixed literals, so the password should never appear
    // there in normal operation.  We only strip when pass.length >= 4 because
    // an empty or very short password would create a regex that matches between
    // every character and garbles unrelated error text, making field debugging
    // impossible.  Real App Passwords are 16+ chars; short values are not
    // meaningful secrets worth stripping.
    const escaped = pass.length >= 4
      ? pass.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      : null;
    const msg = escaped
      ? rawErr.message.replace(new RegExp(escaped, 'g'), '***')
      : rawErr.message;

    const err = new Error(`mail send failed: ${msg}`);
    if (rawErr.smtpCode) err.smtpCode = rawErr.smtpCode;
    throw err;
  }
}
