# deploy/ — AYAS LAN HTTPS operator setup

This session verified the PC (non-admin, so nothing system-level was changed):

| | |
|---|---|
| host / LAN IP | `DESKTOP-9P0BG80` / `192.168.2.74` (Ethernet, /24) |
| GPU | NVIDIA RTX A2000 12GB (`nvidia-smi`: 12282 MiB, driver 595.95) |
| Ollama | `127.0.0.1:11434` — `qwen2.5:7b` (AYAS) + `qwen2.5:3b` (pipeline) |
| reverse proxy | **none installed** (Caddy available via `winget`) |
| ports 443 / 3000 | free (nothing listening) |
| hosts `studio.local` | not present |
| firewall rule `AYAS HTTPS (LAN)` | not present |
| this session | **not elevated** — the three steps below need an admin shell |

## Operator steps (all in an **elevated** PowerShell)

```powershell
# 1 — reverse proxy
winget install CaddyServer.Caddy

# 2 — DNS for the phone name (this PC; repeat the equivalent on the phone,
#     or skip and use the IP site block in Caddyfile)
Add-Content "$env:SystemRoot\System32\drivers\etc\hosts" "`n192.168.2.74 studio.local"

# 3 — one narrow inbound rule: HTTPS only, LAN subnet only
New-NetFirewallRule -DisplayName "AYAS HTTPS (LAN)" -Direction Inbound `
  -Protocol TCP -LocalPort 443 -RemoteAddress 192.168.2.0/24 -Action Allow

# 4 — set the passcode (>= 12 chars, operator-chosen — never commit it)
#     add a line to .env.local:  AYAS_ACCESS_KEY=<your strong passphrase>
```

## Run

```powershell
npm run build
npm run start                       # Next on 127.0.0.1:3000
caddy run --config deploy/Caddyfile # in the repo root, separate shell
caddy trust                         # trust Caddy's local CA on this PC
```

Then from the phone (same LAN): `https://studio.local/brain` — see
`docs/AYAS_REMOTE_ACCESS.md` § 3 and the Sprint 212 phone checklist.

## Stays closed regardless

Execution Gate `CLOSED`; `resume-stage` write execution `DISABLED`. Enabling
either is a separate, explicitly authorized step — `docs/AYAS_ACTIVATION.md` § 7.
