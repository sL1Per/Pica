# Security

What Pica protects, what it doesn't, and how. This doc is for anyone
deploying or auditing the app.

> Doc scope: threat model, cryptography, session handling, deployment
> expectations, and known limitations. For code organization see
> [architecture.md](./architecture.md). For coding practices see
> [development.md](./development.md).

---

## Threat model

### What Pica tries to protect against

1. **An anonymous visitor on the network seeing anything.** Mitigated
   by login.
2. **A logged-in employee reading another employee's profile,
   punches, leaves, or geolocation.** Mitigated by authorization
   (RBAC) enforced on every server route.
3. **An attacker with raw access to the `/data` directory** (stolen
   disk, misplaced backup, cloud snapshot, curious VPS provider)
   reading employee PII, photos, geolocation, or comments. Mitigated
   by encryption at rest.
4. **A backup archive leaking in transit or at its destination**
   (M11 — backups are encrypted with the master key before being
   written; restore needs the passphrase).

### What Pica does NOT protect against

- **A compromised Node process.** If the server is running, the
  master key is in memory. An attacker who can read process memory
  can read everything.
- **A malicious administrator** who already has the passphrase. Pica
  trusts the employer.
- **Network eavesdropping on the wire.** This must be solved by
  running behind a reverse proxy with TLS (Caddy, nginx). The
  browser Geolocation API also requires HTTPS.
- **Targeted malware, phishing, or social engineering** against the
  employer.
- **Unauthorized physical access to a logged-in browser.** Sessions
  last as long as the cookie's lifetime; if a phone walks away
  unlocked, whoever picks it up has access until the session
  expires or is signed out.

---

## Authentication and authorization

### Passwords
- Hashed with `crypto.scrypt` and a per-user random salt.
- 8-character minimum (no maximum). Validated server-side in `src/auth/users.js`.
- Stored in `users.json` as `{ hash, salt, iterations }`.
- No client-side hashing — passwords cross the wire to the server.
  TLS is mandatory; see [Transport](#transport).

### Sessions
- Cookie-based. The cookie value is `<userId>.<expiry>.<HMAC-SHA256>`.
- The HMAC uses a server secret derived from the master key — when
  the server restarts, all sessions are invalidated until the
  passphrase is re-entered.
- Cookie flags: `HttpOnly`, `SameSite=Lax`, `Secure` (when served
  over HTTPS), `Path=/`.
- Default lifetime: 7 days. Configurable in `config.json`.
- No refresh tokens, no device tracking. A session is good until it
  expires; users sign out manually or wait it out.

### Login rate limit
- `/api/login` is rate-limited per source IP using an in-memory token
  bucket (`src/auth/rate-limit.js`).
- Default: 10 attempts per 5 minutes per IP.
- Bucket is process-local — restarts reset it. Acceptable because
  process restarts are rare and the limiter exists to slow
  brute-force, not stop a determined attacker (they need to use TLS
  reverse-proxy fail2ban for that).

### Roles

| Role       | Can do                                                                     |
|------------|-----------------------------------------------------------------------------|
| `employer` | Manage all employees, view all profiles/punches/leaves, approve leaves and corrections, run and restore backups (M11), edit org settings. |
| `employee` | View and edit a limited set of their own profile fields, clock in/out, submit leave requests, file corrections, view their own reports. |

### Server-side enforcement
Every route enforces role and ownership checks on the **server**.
The frontend sometimes hides UI affordances based on role (the
employer-only nav links don't show to employees), but those hides
are cosmetic. An employee POSTing directly to an employer endpoint
gets `403`.

The middleware functions live in `src/auth/rbac.js`:

| Function                                | Use                                                          |
|-----------------------------------------|--------------------------------------------------------------|
| `authenticate(req)`                     | Returns `{ user }` from a valid session cookie, or `null`.   |
| `requireAuth(handler)`                  | 401 unless authenticated.                                    |
| `requireRole('employer')(handler)`      | 403 unless the user has the role.                            |
| `requireOwnerOrEmployer(getOwnerId)(handler)` | 403 unless `user.id === getOwnerId(req)` OR `user.role === 'employer'`. |

### In-handler privacy filtering (0.22.4)

Some endpoints surface partial data based on role rather than
returning 403 outright. `GET /api/leaves/approved` is the canonical
example: every authenticated user can call it (the team calendar
needs capacity awareness), but employees see other people's leaves
anonymized — only `id + start + end + unit + anonymized: true`,
with `employeeId`, `username`, `fullName`, `type`, `reason`, and
`notes` stripped server-side. Employers see full data.

This is a "role-aware response shape" pattern rather than a hard
RBAC gate. Use it when the resource has legitimate cross-role
read value (capacity planning) but identity-level details should
not leak. The `tests/test-leaves-approved.mjs` suite locks the
contract: an employee's response object must not contain the
sensitive fields.

---

## Encryption at rest

A **master key** is derived on server startup from an admin
passphrase using `crypto.scrypt` (N=2¹⁷, r=8, p=1). The key lives
only in RAM — it is never written to disk. A small verifier in
`config.json` lets the server confirm the passphrase is correct
before loading any data.

Encryption uses **AES-256-GCM** from Node's stdlib `crypto` module.
Each encrypted blob carries its own random 12-byte IV and 16-byte
auth tag. Format: `iv || ciphertext || authTag`, base64-encoded
when stored as a string field.

### What's encrypted, what's plaintext

| File / field                                          | Encrypted? | Why                                                    |
|-------------------------------------------------------|------------|--------------------------------------------------------|
| `employees/<id>.json` (profile)                       | Yes        | Contains all the PII.                                  |
| `employees/<id>.picture` (photo)                      | Yes        | Biometric-ish; sensitive on its own.                   |
| `company-logo`                                        | Yes        | Same handling as employee pictures.                    |
| Punches NDJSON — `comment` + `geo`                    | Yes        | Geolocation reveals where people are at all hours.     |
| Punches NDJSON — `ts`, `employeeId`, `type`, `id`     | No         | Needed for reporting without decrypting every line.    |
| Leaves NDJSON — `reason` + free-form notes            | Yes        | Can reveal health / personal info.                     |
| Leaves NDJSON — dates, type, status, employeeId       | No         | Needed for calendar and reports.                       |
| Corrections NDJSON — `justification`                  | Yes        | Can reveal personal context.                           |
| Corrections NDJSON — start, end, hours, status, kind  | No         | Needed for missing-hours computation and reports.      |
| `users.json` (usernames, password hashes, roles)      | No         | Hashes are already one-way; plaintext so the server can authenticate before deriving the master key. |
| `user-prefs.json` (locale, colorMode)                 | No         | Used on every page render before auth completes; not sensitive. |
| `org-settings.json`                                   | No         | Org-wide policy, not personal data.                    |
| `config.json` (KDF salt, wrapped DEK, port; optional SMTP creds in the `mail.enc` blob are themselves AES-256-GCM-encrypted under the DEK, 0.26.0) | Mostly | The file itself is plaintext — read at startup before the master key exists; install-specific, never restored from backups. The SMTP credentials inside it are encrypted (0.26.0). |

This is **pragmatic encryption**, not full-disk encryption. It
protects the data that actually hurts if it leaks (PII, photos,
locations, comments, justifications) while keeping reports fast
(integer math on plaintext timestamps) and the code simple. If your
threat model needs more, run Pica on a full-disk-encrypted volume
or in a Linux VM with LUKS.

---

## Master key management (0.23.0)

### Envelope encryption — v2 scheme

From 0.23.0, the master key is a two-layer (envelope) scheme:

- **DEK** (data-encryption key, 32 bytes): the key that encrypts all
  data on disk. In prior releases this was derived directly from the
  passphrase via scrypt and held only in RAM. In v2 it is a random
  value that persists (wrapped) in `config.json`.
- **KEK** (key-encryption key): derived from the passphrase via scrypt
  (N=2¹⁷, r=8, p=1). The KEK is used only to wrap and unwrap the DEK;
  it is never written to disk.

The DEK is wrapped under the KEK using AES-256-GCM with slot-bound
AAD `pica-dek-wrap-v1:<slot>`. Wrapped values live in
`config.json` under `security.wraps`:

```json
{
  "security": {
    "version": 2,
    "kdfSalt": "<hex>",
    "verifier": "<base64>",
    "wraps": [
      { "slot": 0, "kdfSalt": "<hex>", "wrappedDek": "<base64>" },
      { "slot": 1, "kdfSalt": "<hex>", "wrappedDek": "<base64>" }
    ]
  }
}
```

Slot 0 is always the passphrase slot. Slot 1, when present, is the
recovery code slot. Additional slots could represent other KEKs; the
array is intentionally extensible.

**Migration (v1 → v2):** performed automatically on first boot after
upgrading to 0.23.0. The legacy scrypt output (the old master key) is
frozen as the DEK — no data file is re-encrypted during migration.
The v1 scrypt salt becomes the slot-0 wrap salt. The migration is
zero-touch from the operator's perspective.

### Passphrase handling

By default, the server **prompts for the passphrase on startup** via
the TTY. For automation, two optional modes are available, each with
a clear tradeoff:

- **`PICA_PASSPHRASE` environment variable** — convenient; security
  depends on who can read the process environment.
- **Key file path in `config.json`** — convenient; security depends
  on the key file's location and filesystem permissions. We
  recommend putting it on a separate mount or removable media.

### Recovery code

A recovery code can be generated from **Settings → Security**
(employer-only — the Settings page has a Security card whose button
opens the standalone `/security` page; as of 0.23.1 that card is the
only UI entry point). It is:

- 32 Crockford base32 characters displayed as 8 groups of 4
  separated by dashes (e.g. `ABCD-EFGH-JKMN-PQRS-TUVW-XY23-4567-ABCD`),
  providing 160 bits of entropy.
- Stored as a second wrapped-DEK entry in `config.json` (slot 1).
  The code itself is never stored in plaintext anywhere — only the
  wrapped DEK is persisted.
- Shown exactly **once** at generation time. If lost, remove it and
  generate a new one.
- **Passphrase-equivalent**: anyone with the recovery code can
  unlock the DEK. Guard it with the same care as the passphrase.

To recover a forgotten passphrase: boot with `PICA_RECOVERY_CODE=<code>`
set in the environment. The server unlocks the DEK from slot 1, then
enters a lockdown that allows only login, `/api/me`, logout, and the
passphrase-set endpoint (`POST /api/security/passphrase`). The
operator signs in and uses **Settings → Security** to set a new
passphrase; no current passphrase is required in that state (the
recovery-code boot already authenticated and the in-memory DEK is
re-wrapped under the new passphrase). The lockdown does not
auto-redirect pages.

After recovering, the operator should regenerate or remove the recovery
code from Settings → Security — a passphrase change does NOT invalidate
it (slot 1 is untouched). It is key rotation that drops the recovery
slot.

### Changing the passphrase

`POST /api/security/passphrase` (employer, requires current passphrase
in the request body). Derives a new KEK from the new passphrase,
re-wraps the DEK under it, and writes the new slot 0 to `config.json`.
The DEK itself does not change — no data re-encryption. If a recovery
code existed, it remains valid (slot 1 is untouched). Emits audit
event `security.passphrase_changed`.

### Key rotation

`POST /api/security/rotate` (employer, requires current passphrase and
new passphrase). Generates a fresh random DEK, then:

1. Stages a full re-encryption of `data/` under the new DEK.
2. Writes the new `config.json` (new DEK wrapped under the new KEK).
3. Atomically swaps the staging data directory into place.
4. Enters a 503 lockdown (restart required) so all in-memory stores
   are refreshed from the newly re-encrypted data.

A pre-rotation snapshot is taken at `data.pre-rotate-<ts>/` before
the swap. Emits audit event `security.key_rotated`.

**Important:** after rotation, pre-existing backup archives are
encrypted with the old DEK and cannot be restored under the new
passphrase. Take a fresh backup immediately after rotating.

### Wipe reset

Boot with `PICA_RESET=1` to discard all data and start fresh. The
server moves `data/` aside to `data.pre-reset-<ts>/` (never deleted),
generates a new random DEK, writes a new `config.json security` block,
and starts with an empty `data/` directory. The passphrase entered
at that boot becomes the new credential.

This is irreversible in the sense that all prior data is no longer
accessible under the new key. The moved-aside directory is preserved
if the operator needs it. Wipe-reset happens at boot, before the
audit store exists; it is recorded in the regular server log, not the
encrypted audit log.

### Audit events for security operations

The following events are written to the encrypted audit log:

- `security.passphrase_changed` — admin changed the passphrase via
  `POST /api/security/passphrase`.
- `security.recovery_code_set` — admin generated a recovery code via
  `POST /api/security/recovery-code`.
- `security.recovery_code_removed` — admin removed the recovery code
  via `DELETE /api/security/recovery-code`.
- `security.key_rotated` — key rotation completed via
  `POST /api/security/rotate`.

Wipe-reset and recovery-code unlock are **not** audit events — they
happen at boot before the audit store is initialized. Both are
recorded in the regular server log (stdout/stderr).

### Key management disclosures

- **Losing `config.json` makes all data unrecoverable.** The DEK
  wraps live there. Neither passphrase nor recovery code can help
  without the wrapped ciphertext to unwrap. `config.json` is NOT
  restored from backups — it is install-specific by design.
- **After rotation or wipe-reset, old backups cannot be restored**
  under the new passphrase. The DEK changed; old archives were
  encrypted with the previous DEK.
- **Rotation is a forward-looking control.** An attacker who copied
  the in-memory DEK before rotation is unaffected by it.
- **Weak passphrases remain bounded only by the scrypt cost.** The
  wrapping layer adds no extra KDF stretch.
- **Migrated installs carry a derived-then-frozen DEK** — the
  historical scrypt output, neither stronger nor weaker than before.

---

## Transport

The app listens on **HTTP locally**. In any real deployment it
**must** be placed behind a reverse proxy with TLS (Caddy, nginx,
Traefik). Reasons:

- The browser Geolocation API only works over HTTPS (or
  `localhost`).
- Session cookies set `Secure` only when the request is HTTPS — over
  plain HTTP they'd be sent over the wire in the clear.
- Without TLS, passwords and PII go over the wire as plaintext.

A sample Caddy config will ship with the M12 deployment guide.

### Security headers (added in M12 Drop 2, 0.20.0)

Every response carries:

- **`Content-Security-Policy`** — `default-src 'self'` baseline, with
  `script-src 'self' 'sha256-…'` allowing only the one canonical
  inline theme bootstrap, `frame-ancestors 'none'`, `object-src 'none'`,
  and tight `connect-src`/`img-src`/`font-src`/`form-action`. The
  hash is computed at server startup from the actual bootstrap, so
  edits don't require manual hash updates. A test (`test-security-headers.mjs`)
  verifies all HTML pages share a single byte-identical bootstrap
  and contain no inline event handlers, `style=""` attributes, or
  `<style>` elements.
- **`X-Content-Type-Options: nosniff`** — block MIME sniffing.
- **`X-Frame-Options: DENY`** — legacy-browser equivalent of
  `frame-ancestors 'none'`.
- **`Referrer-Policy: strict-origin-when-cross-origin`** — don't
  leak full URLs to third parties.
- **`Permissions-Policy`** — Pica needs `geolocation=(self)` (clock-in
  records the punch location); everything else (`camera`,
  `microphone`, `payment`, `usb`, `interest-cohort`) is denied.

### HSTS — conditional and assumes a trusted proxy

`Strict-Transport-Security` is only emitted when **both** are true:

1. `NODE_ENV=production` is set on the Pica process
2. The incoming request carries `X-Forwarded-Proto: https`

This conservative gate prevents the HSTS pin from being applied over
plain HTTP (which would lock clients into HTTPS even if the
deployment hasn't actually got TLS).

**The trust assumption is that the reverse proxy strips client-supplied
`X-Forwarded-Proto`** before forwarding. Caddy does this by default.
For nginx, the operator must use `proxy_set_header X-Forwarded-Proto $scheme;`
to overwrite (not append to) any client-supplied value. The M12
deployment guide will spell this out with sample configs.

If your proxy doesn't strip the header, a malicious client could
spoof `X-Forwarded-Proto: https` over plain HTTP and trigger an
HSTS pin from a non-HTTPS deployment. Mitigation: don't deploy
without HTTPS in the first place.

`HSTS preload` is **not** included in the header. Submitting a domain
to the browser preload list is a one-way commitment; it should be an
explicit operator decision, not a Pica default.

---

## Backup encryption (M11)

When backups land:

- Both full and delta archives are encrypted with the master key
  before being written.
- Archives are self-describing: a small plaintext header identifies
  the format and KDF salt, so restore works on any machine that
  has the passphrase.
- Restoring an archive always takes a pre-restore safety snapshot
  of the current `/data` first.

The KDF salt is in the archive header so you can restore on a
different machine — but the passphrase still has to be known
out-of-band. There's no "key in the archive" backdoor.

---

## Outbound email (M14, 0.25.0; encrypted config 0.26.0)

From 0.25.0 Pica can send plain-text notification emails. It only
**submits** mail through the operator's own authenticated relay; it
never receives mail and is not an MTA.

- **SMTP credentials are AES-256-GCM-encrypted** in `config.json`. As
  of **0.26.0** the optional `mail` block is a single encrypted blob —
  `"mail": { "enc": "<base64>" }` — keyed by the **DEK** (AAD
  `pica-mail-config-v1`), not plaintext. (This reverses the 0.25.0
  design, which stored the credentials as a plaintext `mail` block; the
  app password no longer sits in cleartext on disk.) The credentials
  are configured **from the app**, on Settings → Email notifications,
  via the employer-only `PUT /api/settings/mail`. The `pass` field is
  **write-only**: never returned by any endpoint, never logged, and
  never audited (the `settings.mail_updated` audit record carries no
  details for exactly this reason). `config.json` is **mutated at
  runtime** by the Settings save — the same behaviour class as the
  passphrase change / recovery code / key rotation, all of which
  already rewrite it via `writeConfigAtomic`; the mail write **aborts
  rather than clobber** if it cannot first read the existing file, so a
  transient read failure cannot destroy `security.wraps`. `config.json`
  is gitignored and is **not** included in Pica backups, so the
  credential does not travel inside an archive — after restoring data
  on a fresh machine the operator must re-enter the SMTP settings.
  Because the blob is keyed by the DEK, **outbound mail is unavailable
  during the recovery-code / passphrase-reset lockdown** (a rare safety
  state; mail is best-effort anyway). Use a **dedicated send-only
  account with an App Password** (Gmail / Workspace requires 2-Step
  Verification + an App Password), never a primary credential. Mail is
  off until the operator saves an enabled SMTP config from Settings.
  Only the encrypted `{ enc }` shape is read — a hand-edited plaintext
  `mail` block is ignored, and there is no migration from the
  never-shipped 0.25.0 plaintext design.
- **TLS is enforced.** The certificate is verified
  (`rejectUnauthorized` defaults to true). When `secure:false`,
  STARTTLS is **required** and is not silently downgraded to a
  plaintext session if the relay omits it. There is no MTA-STS
  policy fetch and no DANE/TLSA validation beyond standard
  certificate verification.
- **Authentication is `AUTH LOGIN` over TLS only** — no OAuth2 /
  XOAUTH2 token flow.
- Delivery is **best-effort**: a failed send is logged and swallowed,
  never failing the user-facing request. The in-app state and the
  audit log remain authoritative. There is no retry, outbox, or
  bounce handling.
- The password-reset notice is **informational only** (no token,
  link, or credential) and is intentionally **not** user-opt-outable
  — a user must learn their password was reset. It and the
  employer-only `POST /api/mail/test` config probe bypass the
  org/user opt-out layers but remain gated by a usable SMTP config
  (the store's `isConfigured()`, since 0.26.0) plus a recipient
  address.
- This release does **not** unblock the email-based KEK master-key
  recovery slot reserved in 0.23.0; the offline recovery code remains
  the master-key recovery path. There is still no self-service
  password recovery (see "Known limitations" below).

---

## Audit log (M12 Drop 3, 0.21.0)

Sensitive operations are recorded in an append-only encrypted log at
`data/audit/<yyyy>/<mm>.ndjson.enc`. Each line is one JSON record
encrypted independently with AES-256-GCM and base64-encoded. Files
rotate by calendar month.

### What's logged

- `setup.completed` — first-run admin creation
- `auth.login_success` / `auth.login_failure` / `auth.logout`
- `password.self_change` (success + invalid_credentials failure)
- `password.reset_by_employer`
- `employee.created` / `employee.deleted`
- `leave.decision` (approve, reject, cancelled-by-employer for
  someone else's leave)
- `correction.decision` (approve, reject)
- `settings.org_updated` (records which top-level keys were changed,
  not the values)
- `backup.created` / `backup.deleted`
- `backup.restore` (success + failure with errorCode)
- `security.passphrase_changed` (0.23.0)
- `security.recovery_code_set` (0.23.0)
- `security.recovery_code_removed` (0.23.0)
- `security.key_rotated` (0.23.0)

### What's NOT logged

- Reads (e.g. `GET /api/employees`). Audit value is low; volume would
  swamp investigations.
- Punch in/out. Punches are themselves an append-only domain log
  (`data/punches/<yyyy>/<mm>.ndjson.enc`).
- Self-cancellation of one's own pending leave. Routine user action.
- 403/forbidden denials (path validation, RBAC). Logged via the regular
  logger but not duplicated to audit; high volume from any port-scan.
- Successful self-service password change attempts where the new password
  fails validation (e.g. too short). UI-correctable user error, not
  forensic.

### Failure semantics

Audit writes are **best-effort**: a disk-full or permission-error on
audit append does NOT fail the user-facing request. The audit module
catches all errors internally and emits them via the regular logger
at ERROR level. Operators monitoring logs will see these. This is a
deliberate trade-off — the alternative ("we couldn't audit, so we
won't do the action") is too brittle for a small-team self-hosted app.

### Recovering from corruption

A line that fails decryption (tampering, partial write, bit flip)
makes `readMonth()` throw with the line number. Subsequent lines are
not read until the corrupt one is removed. To recover: copy the file
aside, delete the offending line manually with a text editor, restart
or re-read.

### IP addresses behind a proxy

The `actorIp` field comes from `req.socket.remoteAddress`, which
behind a TLS-terminating reverse proxy will always be the proxy's
loopback address (`127.0.0.1`). Pica does not currently trust
`X-Forwarded-For` for audit purposes — adding that requires a
configuration value listing trusted proxy IPs, which the current
threat model doesn't justify. If you need real client IPs in the
audit log, log them at the proxy level instead.

### No viewer UI yet

Audit logs are on-disk and on-master-key only. A future drop can add
`/api/audit/recent` (employer-only) and a viewer page. For now, use
the masterkey directly:

```js
import { initMasterKey } from './src/crypto/masterkey.js';
import { createAuditStore } from './src/storage/audit.js';
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
process.env.PICA_PASSPHRASE = '...';
const { masterKey } = await initMasterKey(config, 'config.json', null);
const store = createAuditStore({ dataDir: 'data', masterKey });
console.log(store.readMonth(2026, 5));
```

---

## Input validation (M12 Drop 5, 0.22.0)

Routes that take a `:id` URL parameter for an employee record now
reject anything that isn't a v4 UUID at two layers:

1. **Route layer** — `rejectIfBadId(req, res)` runs at the top of
   every `:id`-taking handler in `src/routes/employees.js`.
   Returns 400 with `errorCode: invalid_id`.
2. **Storage layer** — `src/storage/employees.js` re-validates ids
   in `profilePath()` and `picturePath()`. Throws on bad ids in
   write-side methods (caller bug = loud); silently returns
   "doesn't exist" on bad ids in query-side methods (`exists`,
   `hasPicture`, `remove`, `deletePicture`).

The validator is in `src/util/validators.js`:

```js
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}
```

It accepts only RFC 4122 v4 UUIDs (the format `crypto.randomUUID()`
produces) and is strict about case-insensitive hex, the version
nibble (must be `4`), and the variant nibble (must be `[89ab]`).
All-zero UUIDs and v1/v3/v5 UUIDs are rejected.

### Why two layers?

Defense in depth. The route layer gives a clean errorCode users can
localize. The storage layer is the safety net — even if a future
route forgets to call `rejectIfBadId`, the storage refuses to touch
disk paths derived from a malformed id.

### Other stores

`leaves`, `corrections`, `punches`, and `backups` use ids only as
record keys (inside NDJSON files keyed by year/month) — they never
flow through `path.join(dir, id)`. Bad ids return clean 404s from
`findById()` lookups. No additional UUID validation is required.

### Length caps on free-text fields

Free-text user input is capped at **500 characters** at the storage
layer:

| Field | Where |
|-------|-------|
| `punch.comment` | `src/routes/punches.js` validComment() |
| `correction.justification` | `src/storage/corrections.js` |
| `correction.notes` (employer reject) | `src/storage/corrections.js` |
| `leave.reason` | `src/storage/leaves.js` (added in 0.22.0) |
| `leave.notes` (employer reject) | `src/storage/leaves.js` (added in 0.22.0) |

The 5 MB body cap at the HTTP layer is the upper bound; without
storage caps an attacker submitting maximum-size requests could
bloat encrypted ledgers without forensic value. 500 chars matches
the punch-comment convention that has been in place since M2.

### Path-traversal advisory (CVE-style note)

**Affected versions:** Pica 0.16.4 through 0.21.0 inclusive.
**Fixed in:** 0.22.0.
**Severity:** Medium. Exploitable only by authenticated employers.

The `PUT /api/employees/:id/picture` endpoint computed disk paths
via `path.join(empDir, id + '.picture')`. Because the URL router
extracts `:id` via `decodeURIComponent`, an authenticated employer
sending `id = '..%2F..%2F<name>'` could write `<name>.json` and
`<name>.picture` files outside the data directory — anywhere
reachable via path.join from `data/employees/`.

What the attacker could do:
- Write attacker-controlled bytes to `<name>.json` / `<name>.picture`
  paths under the project directory.
- Fill the parent directory (DoS via disk consumption).

What the attacker could NOT do:
- Read arbitrary files on disk. The read-side endpoints checked
  existence via `fs.existsSync(picturePath(id))`; only files at
  the specific resolved path with the right suffix would be
  returned, and decryption with the masterKey would fail for
  anything that wasn't a Pica-encrypted picture in the first place.
- Overwrite Pica's own data files. The fixed suffix (`.json` or
  `.picture`) and AES-GCM AAD (which binds ciphertexts to specific
  ids) prevent collision with existing employee profiles.
- Affect availability of the running server. The server doesn't
  read the bogus files — they just sit on disk.

Required attacker capability:
- Valid `employer` role credentials. RBAC was always enforced;
  this was not a privilege-escalation vulnerability.

Discovery: an internal audit during M12 Drop 5 work. Not known to
have been exploited.

Mitigation in 0.22.0: the two-layer defense described above. A live
proof-of-concept (`curl PUT /api/employees/..%2F..%2Fmarker/picture`)
that wrote `pica-evil-marker.{json,picture}` to the project root in
0.21.0 returns `400 invalid_id` in 0.22.0, with no file written.

**Sibling finding — punches (M17 S1, fixed 0.54.1).** The 0.22.0 fix
covered the employees store but `GET /api/punches/by-employee/:id` was
missed: `punchesStore.monthFile()` joined the raw `:id` into
`data/punches/<yyyy>/<mm>/<id>.ndjson` with no UUID guard. **Severity:
lower than the 0.22.0 bug** — this is a *read* path, and only an
employer could reach it (a non-employer passes `requireOwnerOrEmployer`
only when `:id === their own user id`, which can't be a traversal
string). The read also could not disclose file contents: lines are
parsed as JSON punch records and decrypted under an AAD bound to the
id, so a non-Pica file yields `[]`. The practical impact was reading
arbitrary `*.ndjson`-suffixed paths (existence probing) — no data
disclosure, employer-only. Fixed with the same two-layer defense: the
route rejects a non-UUID `:id` with `400 invalid_id`, and
`punchesStore.monthFile()` throws `invalid_id` before any `path.join`.
Regression tests: `tests/test-punches-route.mjs` (route 400) and a
store-level traversal case in `tests/test-punches.mjs`.

### CSV / formula-injection advisory (M17 S2, fixed 0.54.2)

**Affected versions:** every build that exported report CSVs (M13's
0.24.0 onward) through 0.54.1 inclusive.
**Fixed in:** 0.54.2.
**Severity:** Medium. Requires opening an exported CSV in a spreadsheet
app; the injected value is employee-controlled.

The report CSV builders (`timesheetSingleCsv` / `timesheetMatrixCsv` /
`leavesSingleCsv` / `leavesMatrixCsv` in `src/storage/reports.js`) put
the employee's `fullName` into the export. `csvEscape` applied RFC-4180
quoting but did **not** neutralize a field whose first character is
`= + - @` — the lead-in spreadsheets (Excel, Google Sheets,
LibreOffice) read as a **formula**. An employee who set their display
name to `=HYPERLINK("http://evil","click")` (or `=cmd|…`, `+…`, `-…`,
`@…`) produced a CSV whose cell could execute when an employer opened
the export.

What the attacker could do:
- Have a formula evaluated in the *victim's* spreadsheet on open
  (data exfiltration via `=HYPERLINK`/`=WEBSERVICE`, or a command
  prompt via legacy DDE), within that spreadsheet app's own macro/
  formula-execution policy.

What the attacker could NOT do:
- Affect the Pica server or other users' data — this is entirely a
  client-side spreadsheet concern on the downloaded file.
- Inject via the on-screen report. The HTML render escapes through
  `esc()`; only the CSV path was affected.

Required attacker capability:
- Any authenticated employee (they control their own profile name).

Mitigation in 0.54.2: `csvEscape` prefixes a value whose first char is
`= + - @` (or a leading TAB / CR) with a single quote `'`, forcing the
cell to plain text, and still quotes per RFC-4180. Only a *leading*
trigger is neutralized (interior `a=b` is untouched); ordinary text and
non-negative numbers are unchanged. Direct regression tests on the
now-exported `csvEscape` plus a builder-level malicious-name case in
`tests/test-reports.mjs`.

---

## Service Worker caching

The Service Worker (`public/sw.js`) caches the shared shell
(CSS/JS/i18n/icon/manifest) for offline use, but **NOT HTML pages**.

This is a deliberate choice with a security flavor: HTML pages
embed per-user state via the server-injected
`<meta name="pica-locale">` and `<html lang>`. Caching HTML by URL
would let one user's locale bleed into another user's offline view
of the same path. The 0.15.2 release fixed exactly this bug — the
Caddyfile-style root cause is documented in that release entry.

The cost: no offline page loads. If the user is offline and tries
to open `/punch` for the first time, they see the browser's offline
UI. The punch page's offline-queue feature still works because that
runs entirely in `localStorage` + retried POSTs.

---

## Third-party connections

Pica's CSP allows two outbound destinations from the browser:

- `connect-src 'self' https://nominatim.openstreetmap.org` —
  reverse geocoding to render approximate addresses on punch
  lists (0.22.9).
- `img-src 'self' data: blob: https://tile.openstreetmap.org` —
  the static OSM map tile rendered under the punch page's
  "Location" card (0.22.10 unblocked this; the tile host had
  been silently blocked since the M12.2 CSP shipped).

Both are deliberate privacy trade-offs: each unique punch
location reveals coordinates to community OSM infrastructure —
once per 30-day cache window for Nominatim, and on every map
render for the tile fetch. The encrypted lat/lng on disk is
unchanged; OSM never sees employee identities, only points.

Operators who consider employee location data sensitive should
either:

- self-host a Nominatim instance and a tile server, then patch
  `public/geocode.js` and `public/punch.js`'s `mapTile.src`, or
- disable the address rendering by removing the `reverseGeocode`
  call sites and accept coordinates-only display, or
- hide the map preview entirely by setting `mapCard.hidden = true`
  permanently and skipping `renderMap()`.

---

## Supply chain

**Zero npm dependencies.** Every line of code that runs comes from
either:

- This repo
- The Node.js stdlib

The implications:

- No transitive package vulnerabilities to track. No `npm audit`,
  no Dependabot churn.
- No build step. The source files are what runs.
- The cost: we re-implement things that npm packages would solve
  (multipart parsing, cookie signing, etc.). Each is small enough
  to fit in a single file with a header comment explaining the
  approach.

This is a meaningful security property for a small self-hostable
app. It also limits the blast radius of a future supply-chain
attack (an `event-stream`-style trojan can't reach Pica because
Pica imports nothing).

---

## Known limitations and their reasoning

### No forgot-password / self-recovery flow
Pica has no email infrastructure, so there's no way for a user who
has forgotten their password to reset it themselves. The recovery
path is: employer uses the "Reset password" button on the employee
summary page (M12 Drop 1, 0.19.0) to set a new temporary password,
then hands it to the user out-of-band (in person, secure chat, etc.);
user logs in, is forced through `/change-password`, picks a permanent
password.

If the *only* employer forgets their password, recovery requires
manually editing `data/users.json` and restarting the server. Not
elegant, but acceptable for the deployment scale Pica targets.

### No 2FA
Out of scope for now. Could be added by integrating with TOTP
(`crypto.createHmac` + a base32 secret) without external deps. Not
on the roadmap because the threat model accepts that a stolen
password = compromised account, and the app is intended for small
teams using strong passwords behind a TLS proxy.

### No CSRF protection
The session cookie is `SameSite=Lax`, which blocks cross-site
form submissions in modern browsers. This is sufficient for the
threat model — see M12 for explicit token-based CSRF as belt-
and-suspenders.

### No audit log of approvals
Approving a leave or correction writes the decision to the NDJSON
event log, including the deciding user's ID. That's effectively an
audit log already. M12 will add a separate, append-only audit
record for sensitive operations like backup restores and user
deletions.

### No rate limit on non-login routes
Easy to add per route if abuse becomes a concern. Today the
assumption is that authenticated users are not adversarial — see
the threat model.

### No SOC2 / GDPR compliance claims
Pica is a tool. Compliance is a property of how you operate it.
We document what's encrypted and what isn't so you can make
informed decisions; we don't pretend to be a turnkey compliance
solution.

---

## Reporting a security issue

This is currently a personal/small-team project. If you find a
security issue, open an issue on the repository or email the
maintainer. Don't post exploit details publicly until there's a
patch.

---

_Last touched in 0.54.2 (M17 S2 — CSV / formula-injection advisory + fix)._
