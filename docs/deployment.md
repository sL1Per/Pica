# Deploying Pica

_Last touched in 0.56.0._

This guide takes Pica from `node server.js` on your laptop to a service running
behind TLS that a team can use — on a Linux server **or** a Windows 11 machine.
Sample configs referenced here live in [`../deploy/`](../deploy/).

For the threat model and the cryptography this deployment protects, see
[security.md](./security.md); this guide is the operational companion to its
[Transport](./security.md#transport) section.

## Why a reverse proxy

Pica listens on `127.0.0.1:8080` by default and **does not terminate TLS
itself**. In production you put a TLS-terminating reverse proxy in front of it:

```
browser ──HTTPS:443──> reverse proxy ──HTTP──> node on 127.0.0.1:8080
```

TLS is not optional here — it is load-bearing for features, not just secrecy:

- The browser **Geolocation API** (the punch-clock map) only works over HTTPS.
- Pica only sets the **`Secure`** flag on the session cookie, and only emits
  **HSTS**, when the request arrived over HTTPS (via `X-Forwarded-Proto: https`
  from the proxy, or `NODE_ENV=production`).
- Without TLS, passwords and personal data cross the network in plaintext.

Pica bundles no proxy and no npm packages — you download the proxy yourself.

## Prerequisites

- **Node.js 22** (LTS) on the host.
- Pica's files unpacked somewhere stable (e.g. `/opt/pica` or `C:\Pica`).
- A **passphrase** for the encryption key (8+ characters).
- Either a **public domain** pointed at the host, or a decision to use
  **LAN/internal TLS** (below).

## Pick your path

| You have… | Use |
|-----------|-----|
| A public domain + internet-facing host | **Caddy**, public block (auto Let's Encrypt) |
| A LAN box, no public domain (typical Windows 11 office machine) | **Caddy**, `tls internal` + install the root cert on clients |
| nginx already in production | **nginx** + certbot |

Caddy is the recommended path on **both** Linux and Windows — it is a single
binary with automatic HTTPS and sane proxy-header defaults.

## TLS setup

### Public domain — Caddy (easiest)

Install Caddy (https://caddyserver.com/download), use the public block of
[`../deploy/Caddyfile`](../deploy/Caddyfile) with your domain, and run it. Caddy
provisions and renews a Let's Encrypt certificate automatically and forwards the
correct `X-Forwarded-Proto`. Nothing else to configure.

### LAN / no public domain — Caddy internal CA

When there is no public domain (a machine on the office network), use the
`tls internal` block of [`../deploy/Caddyfile`](../deploy/Caddyfile). Caddy
issues a certificate from its **own local CA**. Browsers will not trust it until
you install Caddy's **root certificate** on each client device:

- Find the root: `caddy trust` installs it into the local machine store on the
  host; the file is under Caddy's data dir
  (`...\caddy\pki\authorities\local\root.crt`).
- **Windows:** double-click `root.crt` → Install Certificate → Local Machine →
  "Trusted Root Certification Authorities".
- **macOS:** add it to the System keychain and set "Always Trust".
- **Linux:** copy to `/usr/local/share/ca-certificates/` and run
  `update-ca-certificates`.
- **iOS/Android:** email/AirDrop the `.crt`, install the profile, and enable
  full trust.

Until the root is trusted on a device, that device's punch-page geolocation and
Secure cookie will not work — this is the most common LAN gotcha.

### nginx + certbot

For an existing nginx, use [`../deploy/nginx/pica.conf`](../deploy/nginx/pica.conf)
and obtain a cert with certbot. The one line you must not omit:

```
proxy_set_header X-Forwarded-Proto $scheme;
```

Without it Pica never sees that the request was HTTPS, so it ships login cookies
without `Secure` and emits no HSTS. (Caddy does this for you.) On nginx older
than 1.25 also set `listen 443 ssl http2;` and pin `ssl_protocols TLSv1.2
TLSv1.3;` — modern packages default to safe protocols, older ones do not.

## Run Pica as a service

A service cannot answer the interactive `Passphrase:` prompt, so set
`PICA_PASSPHRASE` in the service's environment.

### Linux — systemd

Install [`../deploy/systemd/pica.service`](../deploy/systemd/pica.service) to
`/etc/systemd/system/`, create a dedicated user and the passphrase file:

```bash
sudo useradd --system --home /opt/pica --shell /usr/sbin/nologin pica
sudo chown -R pica:pica /opt/pica
echo 'PICA_PASSPHRASE=your-passphrase' | sudo tee /etc/pica.env
sudo chmod 600 /etc/pica.env
sudo systemctl daemon-reload
sudo systemctl enable --now pica
```

Check it: `systemctl status pica` and `journalctl -u pica -f`.

### Windows — WinSW (or NSSM / Task Scheduler)

See [`../deploy/windows/README.md`](../deploy/windows/README.md). Short version:
download WinSW, edit [`../deploy/windows/pica-service.xml`](../deploy/windows/pica-service.xml)
(node path, working dir, passphrase), lock the XML down, then
`pica-service.exe install && pica-service.exe start`.

## Hardening checklist

- [ ] **Run unprivileged.** A dedicated `pica` user (Linux) or a service account
      (Windows) — never root/Administrator.
- [ ] **Keep node on loopback.** The default `host` is `127.0.0.1`; leave it.
      Do **not** set it to `0.0.0.0` — let the proxy be the only thing that
      reaches node.
- [ ] **Firewall.** Allow 443 (and 80 for ACME redirects) inbound; node's 8080
      stays loopback-only.
- [ ] **Protect the passphrase file.** The systemd `EnvironmentFile` /
      WinSW XML holds the passphrase. Keeping it in a service file is a
      deliberate availability trade-off (it must survive unattended restarts);
      mitigate with strict ownership + permissions (`chmod 600` / `icacls`).
- [ ] **Lock down data.** `config.json`, `data/`, and `backups/` are owned by
      the service account and not world-readable. They hold encrypted data and
      the wrapped keys.
- [ ] **Back up.** Schedule backups in-app (Settings → Backups) and copy
      `backups/` **and `config.json`** off the host — `config.json` is *not*
      included in backups and is required to decrypt them. Losing it makes the
      data unrecoverable.
- [ ] **Updates.** Stop the service, replace the Pica files, start it again.
      After a *restore* the server enters a lockdown until restarted (see
      security.md / CLAUDE.md).

## Verify the deployment

1. Browse to `https://your-host/` — the certificate is trusted (no warning).
2. The response carries `Strict-Transport-Security` (DevTools → Network →
   response headers).
3. After login the `pica_session` cookie shows `Secure` (DevTools →
   Application → Cookies).
4. On the punch page the map/geolocation works — the end-to-end signal that the
   browser trusts the origin over HTTPS.

## Troubleshooting

- **Cookie has no `Secure`, no HSTS.** The proxy isn't passing
  `X-Forwarded-Proto: https`. nginx: add the `proxy_set_header` line. Confirm
  TLS actually terminates at the proxy.
- **Geolocation blocked / cookie warnings on the LAN.** The client doesn't
  trust the internal CA — install Caddy's root cert on that device.
- **Service won't start, no error.** node is waiting on the interactive
  passphrase prompt — set `PICA_PASSPHRASE` in the service environment.
- **Stuck on HTTPS for a plain-HTTP host.** A spoofed `X-Forwarded-Proto: https`
  over plain HTTP can trigger an HSTS pin. Mitigation: actually deploy TLS, and
  ensure the proxy strips client-supplied `X-Forwarded-*` (Caddy does; nginx
  setting the header explicitly overrides any inbound value).
