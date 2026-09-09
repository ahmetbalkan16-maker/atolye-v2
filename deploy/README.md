# deploy/ — AYAS phone PWA install (operator)

Goal: tap an **AYAS icon** on the phone home screen → `/brain` opens full-screen,
chat + voice work, `Yürütme kapısı: CLOSED` stays.

## What the repo already provides

- `deploy/Caddyfile` — reverse proxy; **primary site is the LAN IP** (`https://192.168.2.74`)
  because the phone can't resolve `studio.local`. `Host` + `X-Forwarded-Proto`
  passthrough, SSE unbuffered.
- `public/icons/` — real PNG icons (192 / 512 / maskable / apple-touch, built by
  `npm run build:pwa-icons`), committed so a plain checkout is installable.
- `app/manifest.ts` — `display: standalone`, `id`, PNG icons, `start_url /brain`.
- `public/sw.js` — conservative service worker (`/api/**` never cached; nav
  network-first + `/offline`), registered only when `NEXT_PUBLIC_ATOLYE_PWA_SW=on`.

## PC (verified read-only this session — non-admin, nothing changed)

| | |
|---|---|
| host / LAN IP | `DESKTOP-9P0BG80` / `192.168.2.74` (Ethernet /24) |
| GPU | NVIDIA RTX A2000 12 GB |
| Ollama | up — `qwen2.5:7b` (AYAS) + `qwen2.5:3b` (pipeline) |
| reverse proxy | none installed (Caddy in winget) |
| ports 443 / 3000 | free |
| `studio.local` hosts entry / `AYAS HTTPS (LAN)` rule | not present |
| `AYAS_ACCESS_KEY` | **SET** (operator added it — value never shown/logged) |
| `NEXT_PUBLIC_ATOLYE_PWA_SW` | NOT SET → service worker not yet registered |

## Operator steps

```powershell
# 1 — reverse proxy (elevated shell for the install; `caddy run` itself is fine unelevated)
winget install CaddyServer.Caddy

# 2 — one narrow inbound rule: HTTPS only, LAN subnet only (elevated)
New-NetFirewallRule -DisplayName "AYAS HTTPS (LAN)" -Direction Inbound `
  -Protocol TCP -LocalPort 443 -RemoteAddress 192.168.2.0/24 -Action Allow

# 3 — enable the service worker (needed for the Chrome install prompt)
#     add to .env.local:  NEXT_PUBLIC_ATOLYE_PWA_SW=on

# 4 — run
npm run build
npm run start                              # Next on 127.0.0.1:3000
caddy run --config deploy/Caddyfile        # separate shell, from the repo root
caddy trust                                # trust Caddy's local CA on THIS PC (elevated)

# 5 — trust Caddy's CA ON THE PHONE (one time) — see docs/AYAS_REMOTE_ACCESS.md
#     "Trust the CA on the phone". iOS also needs the extra
#     Settings > General > About > Certificate Trust Settings toggle.
```

Then on the phone (same LAN): `https://192.168.2.74/brain` → log in → browser
menu → *Install app* / *Add to Home Screen*. Full checklist + troubleshooting:
`docs/AYAS_REMOTE_ACCESS.md` § 3.

## Stays closed regardless

Execution Gate `CLOSED`; `resume-stage` write execution `DISABLED`. Enabling
either is a separate, explicitly authorized step — `docs/AYAS_ACTIVATION.md` § 7.
