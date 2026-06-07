# Running Pica as a Windows service

Pica is `node server.js` — to keep it running across logoffs and reboots on a
Windows 11 (or Windows Server) machine, register it as a service. Three options,
easiest first. Full deployment context (TLS, hardening) is in
[`../../docs/deployment.md`](../../docs/deployment.md).

## Option A — WinSW (recommended)

[WinSW](https://github.com/winsw/winsw) wraps any executable as a service from a
single `.exe` + the XML in this folder. No npm, no installer.

1. Install [Node.js 22 LTS](https://nodejs.org/) and unpack Pica to e.g. `C:\Pica`.
2. Download `WinSW-x64.exe` from the WinSW releases page, rename it
   `pica-service.exe`, and place it next to `pica-service.xml` in `C:\Pica`.
3. Edit `pica-service.xml`: set `<executable>` to your `node.exe` path,
   `<workingdirectory>` to your Pica folder, and the `PICA_PASSPHRASE` value.
4. Lock the XML down so only Administrators + the service account can read it
   (it holds the passphrase):
   ```powershell
   icacls C:\Pica\pica-service.xml /inheritance:r /grant:r "Administrators:R" "SYSTEM:R"
   ```
5. In an elevated PowerShell:
   ```powershell
   C:\Pica\pica-service.exe install
   C:\Pica\pica-service.exe start
   ```
   The service now starts automatically at boot. `pica-service.exe stop` /
   `uninstall` manage it; logs roll next to the exe.

## Option B — NSSM

[NSSM](https://nssm.cc/) is an interactive alternative. After downloading
`nssm.exe`:
```powershell
nssm install Pica "C:\Program Files\nodejs\node.exe" server.js
nssm set Pica AppDirectory C:\Pica
nssm set Pica AppEnvironmentExtra PICA_PASSPHRASE=your-passphrase
nssm start Pica
```
Restrict the service's environment exposure the same way — treat the passphrase
as a secret.

## Option C — Task Scheduler (no extra tool)

Built into Windows, but it does not supervise/restart the process the way a real
service wrapper does. Create a task that runs at startup:
- Action: `C:\Program Files\nodejs\node.exe`, arguments `server.js`,
  "Start in" `C:\Pica`.
- "Run whether user is logged on or not", highest privileges.
- Set the `PICA_PASSPHRASE` environment variable for the account the task runs
  as (System Properties → Environment Variables), and protect that account.

## Notes

- Pica listens on `127.0.0.1:8080` by default — it is **not** reachable from
  other machines until you put a TLS reverse proxy in front of it. On Windows
  the simplest is **Caddy** (a single `caddy.exe`); see `../Caddyfile` and
  [`../../docs/deployment.md`](../../docs/deployment.md).
- `config.json` and the `data\` / `backups\` folders hold encrypted data and the
  wrapped keys. Keep them readable only by the service account. Losing
  `config.json` makes the data unrecoverable.
