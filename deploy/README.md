# Pica deployment samples

Copy-pasteable starting points for putting Pica behind TLS and running it as a
service. **Read [`../docs/deployment.md`](../docs/deployment.md) first** — it
explains which file to use and why.

| File | What it is |
|------|------------|
| `Caddyfile` | Caddy reverse proxy — public (auto Let's Encrypt) or LAN (`tls internal`). Recommended on both Linux and Windows. |
| `nginx/pica.conf` | nginx TLS + reverse-proxy server block (Linux). |
| `systemd/pica.service` | Linux systemd unit to run `node server.js` as a hardened service. |
| `windows/pica-service.xml` | WinSW definition to run Pica as a Windows service. |
| `windows/README.md` | Windows service walkthrough (WinSW / NSSM / Task Scheduler). |

These are samples, not turnkey configs — fill in your domain, certificate paths,
install paths, and passphrase. Pica bundles no binaries: download Caddy / WinSW
yourself.
