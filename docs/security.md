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
| Corrections NDJSON — start, end, hours, status, kind  | No         | Needed for bank computation and reports.               |
| `users.json` (usernames, password hashes, roles)      | No         | Hashes are already one-way; plaintext so the server can authenticate before deriving the master key. |
| `user-prefs.json` (locale, colorMode)                 | No         | Used on every page render before auth completes; not sensitive. |
| `org-settings.json`                                   | No         | Org-wide policy, not personal data.                    |
| `config.json` (KDF salt, verifier, port)              | No         | Read at startup before the master key exists.          |

This is **pragmatic encryption**, not full-disk encryption. It
protects the data that actually hurts if it leaks (PII, photos,
locations, comments, justifications) while keeping reports fast
(integer math on plaintext timestamps) and the code simple. If your
threat model needs more, run Pica on a full-disk-encrypted volume
or in a Linux VM with LUKS.

---

## Passphrase handling

By default, the server **prompts for the passphrase on startup** via
the TTY. For automation, two optional modes are available, each with
a clear tradeoff:

- **`PICA_PASSPHRASE` environment variable** — convenient; security
  depends on who can read the process environment.
- **Key file path in `config.json`** — convenient; security depends
  on the key file's location and filesystem permissions. We
  recommend putting it on a separate mount or removable media.

**No passphrase recovery.** If the passphrase is lost, the encrypted
data is gone. This is a deliberate tradeoff for simplicity. The
admin is responsible for storing the passphrase somewhere safe
(a password manager).

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

A sample Caddy config will ship in `deploy/` (M12).

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

### No password change yet
As of 0.16.1, employees cannot change their initial password. The
employer creates the account with a known initial password and
shares it; the employee uses it forever (or until the employer
deletes and recreates the account). Password change + employer-side
reset are tracked under M12.

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

_Last touched in 0.16.1._
