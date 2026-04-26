# Pica — Time Management

A minimalistic, file-based web application for tracking and managing
employee working times. Runs on **Node.js alone** — zero npm dependencies,
zero build steps, zero external databases.

📜 **[See RELEASES.md](./RELEASES.md)** for the full version history and what's
changed in each iteration.

---

## Goal

Give small teams and solo employers a lightweight, self-hostable
time-tracking tool that:

- runs anywhere Node.js runs (laptop, Raspberry Pi, tiny VPS),
- stores everything as plain files — no database to install, migrate, or back up separately,
- keeps each employee's data private: only the employer (admin) and the employee themselves can see their details,
- works smoothly on a smartphone,
- speaks Portuguese and English.

The philosophy is deliberately linear and simple: prefer clarity over
cleverness, prefer files over frameworks, prefer doing less well over
doing more poorly.

---

## Requirements

### Users & profiles
- Add / edit / remove **employees** and **employer(s)**.
- Employee profile fields:
  - Full name
  - Age
  - Address
  - Contact (email, phone)
  - Picture
  - Role
  - Free-form comments
- Access control: an employee can see their own profile; only employers can see other employees' profiles.

### Time tracking
- Register **clock-in** (start of work) and **clock-out** (end of work).
- Optional comment per entry.
- Capture current **geolocation** on clock-in / clock-out (browser Geolocation API).
- Access control: an employee sees only their own punches. Employers see everyone's.

### Leaves
- Book leaves in **days** or **hours**.
- Categories: vacation, sick leave, personal appointment (e.g. doctor visit), other.
- Request → approve / reject / cancel workflow.
- Access control: an employee sees only their own leave requests. Employers see and act on all.

### Reports
- Per employee:
  - Worked hours by day, week, month.
  - Monthly leaves summary.
  - CSV export.
  - Printable view.

### Backups
- **Full** backup of the data directory.
- **Delta** backup (only files changed since the last snapshot).
- **Scheduler** to run backups automatically (hourly / daily / weekly).
- **Restore** from any backup archive, with a pre-restore safety copy.
- Backup archives are encrypted so they can be stored or moved safely.

### Platform
- Mobile-first, responsive UI.
- i18n: Portuguese (pt-PT) and English (en), switchable per user.
- **Zero npm dependencies** — Node.js stdlib only.

---

## Non-goals

- Multi-tenant SaaS features.
- Payroll calculation, taxes, or social-security integrations.
- Real-time collaboration / websockets.
- Any dependency on a build toolchain (no webpack, no TypeScript, no bundlers).
- Defending against a compromised server process or a malicious admin.

---

## Threat model

What Pica **tries to protect against**:

1. An anonymous visitor on the network seeing anything — mitigated by login.
2. A logged-in employee reading another employee's profile, punches, leaves, or geolocation — mitigated by authorization (RBAC).
3. An attacker with raw access to the `/data` directory (stolen disk, misplaced backup, cloud snapshot, curious VPS provider) reading employee PII, pictures, geolocation, or comments — mitigated by encryption at rest.
4. A backup archive leaking while in transit or at its destination — mitigated by encrypted archives.

What Pica **does not protect against**:

- A compromised Node process. If the server is running, the master key is in memory; an attacker who can read process memory can read everything.
- A malicious administrator who already has the passphrase.
- Network eavesdropping on the wire — **must** be solved by running behind a reverse proxy with TLS (Caddy, nginx). The browser Geolocation API also requires HTTPS.
- Targeted malware, phishing, or social engineering against the employer.

---

## Security model

### Authentication

- Passwords hashed with `crypto.scrypt` and a per-user random salt.
- Session cookies signed with HMAC-SHA256 using a server secret; flags: `HttpOnly`, `SameSite=Lax`, `Secure` (when served over HTTPS).
- Login endpoint is rate-limited to slow brute-force attempts.

### Authorization (RBAC)

Two roles:

| Role       | Can do                                                                     |
|------------|-----------------------------------------------------------------------------|
| `employer` | Manage all employees, view all profiles/punches/leaves, approve leaves, run and restore backups. |
| `employee` | View and edit a limited set of their own profile fields, clock in/out, submit leave requests, view their own reports. |

Every route enforces role and ownership checks on the **server**. An employee requesting another employee's data simply gets a `403`; the UI never even gets the chance to hide it.

### Encryption at rest

A **master key** is derived on server startup from an admin passphrase using `crypto.scrypt` (N=2¹⁷, r=8, p=1). The key lives only in RAM — it is never written to disk. A small verifier in `config.json` lets the server confirm the passphrase is correct before loading any data.

Encryption uses **AES-256-GCM** from Node's stdlib `crypto` module. Each encrypted blob carries its own random 12-byte IV and 16-byte auth tag. What we encrypt, and what stays plaintext:

| File / field                                  | Encrypted? | Why                                                    |
|-----------------------------------------------|------------|--------------------------------------------------------|
| `employees/<id>.json` (profile)               | Yes        | Contains all the PII.                                  |
| `employees/<id>.picture` (photo)              | Yes        | Biometric-ish; sensitive on its own.                   |
| Punches NDJSON — `comment` + `geolocation`    | Yes        | Geolocation reveals where people are at all hours.     |
| Punches NDJSON — `timestamp`, `employee_id`, `type` | No   | Needed for reporting without decrypting every line.    |
| Leaves NDJSON — `reason` + free-form notes    | Yes        | Can reveal health / personal info.                     |
| Leaves NDJSON — dates, type, status           | No         | Needed for calendar and reports.                       |
| `users.json` (usernames, password hashes, roles) | No      | Password hashes are already one-way; plaintext so the server can authenticate before deriving the master key. |
| `config.json`                                 | No         | Holds the KDF salt + verifier needed at startup.       |

This is deliberately **pragmatic encryption**, not full-disk encryption. It protects the data that actually hurts if it leaks, while keeping reports fast and the code simple.

### Backup encryption

- Both full and delta archives are encrypted with the master key before being written.
- Archives are self-describing: a small plaintext header identifies the format and KDF salt, so restore works on any machine that has the passphrase.
- Restoring an archive always takes a pre-restore safety snapshot of the current `/data` first.

### Passphrase handling

By default, the server **prompts for the passphrase on startup** via the TTY. For automation, two optional modes are available, each with a clear tradeoff:

- `PICA_PASSPHRASE` environment variable — convenient; security depends on who can read the process environment.
- Key file path in `config.json` — convenient; security depends on the key file's location and filesystem permissions (the docs will recommend putting it on a separate mount or removable media).

**No passphrase recovery**: if the passphrase is lost, the encrypted data is gone. This is a deliberate tradeoff for simplicity. The admin is responsible for storing the passphrase somewhere safe (a password manager).

### Transport

The app listens on HTTP locally. In any real deployment it **must** be placed behind a reverse proxy with TLS. A sample Caddy config will ship with the repo.

---

## Architecture (high level)

```
┌──────────────────────────────────────────────┐
│  Browser (mobile-first, vanilla JS + CSS)    │
└───────────────────┬──────────────────────────┘
                    │ HTTPS (via reverse proxy)
┌───────────────────▼──────────────────────────┐
│  Node.js HTTP server (http module)           │
│  ├── Router                                  │
│  ├── Auth (scrypt + signed session cookies)  │
│  ├── RBAC middleware                         │
│  ├── Crypto layer (AES-256-GCM, master key)  │
│  ├── i18n loader                             │
│  ├── Storage layer (JSON / NDJSON files)     │
│  ├── Scheduler (setInterval + timestamps)    │
│  └── Backup engine (encrypted archives)      │
└───────────────────┬──────────────────────────┘
                    │ master key held in RAM only
┌───────────────────▼──────────────────────────┐
│  /data                                       │
│    employees/<id>.json        (encrypted)    │
│    employees/<id>.picture     (encrypted)    │
│    punches/<yyyy>/<mm>.ndjson (mixed)        │
│    leaves/<yyyy>/<mm>.ndjson  (mixed)        │
│    users.json                 (plaintext)    │
│    config.json                (plaintext)    │
│  /backups                                    │
│    full-<timestamp>.bin       (encrypted)    │
│    delta-<timestamp>.bin      (encrypted)    │
└──────────────────────────────────────────────┘
```

### Storage choices
- **Employees / users / config**: one JSON file per entity — easy to diff, easy to hand-edit.
- **Punches and leaves**: append-only **NDJSON** partitioned by month — fast writes, easy to aggregate, and resilient (a single bad line can be dropped without losing the rest).
- **Pictures**: stored as encrypted files next to the employee JSON; served through an authenticated route that decrypts on read.

### Tech choices
- Node stdlib only: `http`, `fs`, `path`, `crypto`, `url`, `querystring`, `zlib`, `readline`, `child_process`.
- Vanilla ES modules in the browser. No framework.
- CSS with custom properties and a mobile-first media strategy.

---

## Roadmap

Split into small, shippable milestones. Each one leaves the app in a usable state.

### Milestone 0 — Project bootstrap ✅
- ✅ README, goal, requirements, threat model, roadmap (this document)
- ✅ Repository layout
- ✅ `LICENSE`, `.gitignore`, `.editorconfig`

### Milestone 1 — Server foundation ✅
- ✅ Minimal HTTP server (static files + JSON routes)
- ✅ Router with method/path matching
- ✅ Request helpers: body parser (JSON + `multipart/form-data` for uploads), cookie parser
- ✅ Response helpers: `json`, `html`, `redirect`, `notFound`, `forbidden`
- ✅ Config file (`config.json`) with port, data dir, backup dir
- ✅ Simple logger

### Milestone 2 — Security foundation ✅
- ✅ Passphrase prompt on startup + verifier check
- ✅ Master-key derivation with `crypto.scrypt`
- ✅ Crypto helpers: `encryptBlob`, `decryptBlob`, `encryptField`, `decryptField` (AES-256-GCM)
- ✅ Password hashing + verification (`crypto.scrypt`)
- ✅ Signed session cookies (HMAC-SHA256)
- ✅ Login / logout pages
- ✅ RBAC middleware: `requireAuth`, `requireRole('employer')`, `requireOwnerOrEmployer`
- ✅ Rate-limited login
- ✅ First-run setup wizard (creates first employer + picks passphrase)

### Milestone 3 — Employee management ✅
- ✅ List / create / edit / remove employees (employer only)
- ✅ Encrypted profile files (name, age, address, contact, role, comments)
- ✅ Encrypted picture upload (client-side resize; server writes ciphertext)
- ✅ Employee self-service: view own profile, edit allowed fields only
- ✅ Employer profile (same model, different role)

### Milestone 4 — Clock in / out ✅
- ✅ "Clock in" and "Clock out" buttons (authenticated employee only)
- ✅ Optional comment on each punch — encrypted
- ✅ Browser geolocation captured on punch — encrypted (`lat`, `lng`, `accuracy`)
- ✅ Guard against duplicate open punches
- ✅ Daily punch list: own punches for employees, all punches for employers

### Milestone 5 — Leaves ✅
- ✅ Book leave: day range or hour range
- ✅ Leave types: vacation, sick, appointment, other
- ✅ Reason / notes field — encrypted
- ✅ Employee requests → employer approves / rejects
- ✅ Calendar-style monthly view

### Milestone 6 — Reports ✅
- ✅ Worked hours per day / week / month (uses plaintext timestamps, no decryption needed)
- ✅ Monthly leaves summary
- ✅ CSV export (employer only for all; employees get their own data)
- ✅ Printable view

### Milestone 7 — Settings page ✅
- ✅ Settings page (employee: account section only; employer: all sections)
- ✅ Account settings (per user): language, color mode (light / dark / system)
- ✅ Organization settings (per company): default leave allowances per type (vacation / sick / appointment / other), per-employee override, annual carry-forward of unused leave
- ✅ Concurrent-leaves policy (yes / no) — stored; enforcement in M8
- ✅ Backup settings UI (scheduler + on-demand buttons) — scaffold only; wired up in M10
- ✅ Color mode applied immediately via `<html data-theme>` attribute

### Milestone 8 — UI polish (desktop, mobile, general look & feel)
Split into three drops:

**M8a — Navigation shell + company identity ✅**
- ✅ Sticky top menu bar across all pages (employer and employee variants)
- ✅ Role-filtered nav links (employee sees no Employees / Settings)
- ✅ Avatar dropdown on the right: user name + role + sign-out
- ✅ Hamburger drawer on mobile (same nav items)
- ✅ Company logo upload (encrypted at rest, like employee pictures)
- ✅ Company name field
- ✅ Logo + name shown in the top bar, clickable to go home
- ✅ New Settings section "Company" — employer only

**M8b — Visual polish (per-page iteration) ✅**
- ✅ Design-token pass: cohesive typography scale, spacing, color depth
- ✅ Desktop layout: wider containers, multi-column on larger screens, keyboard focus styles
- ✅ Mobile polish: touch targets ≥ 44px, larger tap zones (safe-area-inset deferred)
- ✅ Component refinement: buttons, forms, tables, empty states, loading states, toasts
- ✅ Accessibility pass (partial): focus-visible, prefers-reduced-motion, ARIA toasts (full audit deferred)
- ✅ Concurrent-leaves warning on approve (honors setting from M7)
- ✅ Leave-allowance cap enforcement at create + approve (honors per-employee overrides)
- ✅ Per-page iteration — polished Settings, Leaves, Punches, Dashboard, Preferences

**M8c — PWA + offline ✅**
- ✅ Web App Manifest + home-screen icon (installable PWA)
- ✅ Offline-friendly clock-in (queue locally, sync when online)

### Milestone 9 — i18n
- [ ] Language files: `i18n/en.json`, `i18n/pt.json`
- [ ] Language switcher (reads from M7's account settings)
- [ ] Per-user language preference (already stored in M7)
- [ ] Date / number formatting via the browser's `Intl` API

### Milestone 10 — Backups
- [ ] Encrypted full backup of `/data`
- [ ] Encrypted delta backup (files changed since last snapshot — manifest + mtime/hash)
- [ ] Restore from encrypted archive, with pre-restore safety snapshot
- [ ] Scheduler with cron-like intervals, honors M7 settings
- [ ] Wire up M7's Backup section buttons (run full, run delta, browse snapshots, restore)

### Milestone 11 — Hardening
- [ ] Input validation on every route
- [ ] CSRF protection on state-changing routes
- [ ] Audit log for sensitive actions (user/leave edits, restores, backup runs)
- [ ] Security headers (CSP, X-Frame-Options, Referrer-Policy)
- [ ] Smoke-test script using Node's built-in `assert` (no test framework)
- [ ] Sample Caddy / nginx TLS config

---

## Repository layout (planned)

```
pica/
  README.md
  LICENSE
  server.js                 # entry point (prompts for passphrase)
  src/
    router.js
    http/                   # request / response helpers
    auth/                   # passwords, sessions, RBAC
    crypto/                 # master key + AES-GCM helpers
    storage/                # file + NDJSON layer (encryption-aware)
    backup/                 # encrypted archive format
    scheduler/
    i18n/
  public/
    index.html
    app.js
    styles.css
  i18n/
    en.json
    pt.json
  deploy/
    Caddyfile.example
  data/                     # gitignored, created on first run
  backups/                  # gitignored, created on first run
  config.json.example
```

---

## Running (once implemented)

```bash
$ node server.js
Passphrase:  ********
Pica listening on http://localhost:8080
```

That's it. No `npm install`, no build step. Put it behind Caddy or nginx with TLS in production.

---

## License

TBD.
