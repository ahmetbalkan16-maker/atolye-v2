# AYAS remote access — HTTPS + authentication runbook (operator)

AYAS is a **personal, self-hosted** studio. Reaching it from a phone needs an
HTTPS origin and the shared passcode. This runbook is the operator's checklist —
none of it can be done from the build environment, and **no secret in this repo**.

## Why HTTPS is required (not optional)

- **Microphone / speech recognition** (`webkitSpeechRecognition`, `getUserMedia`)
  only run in a *secure context* — `https://` or `http://localhost`. Over a plain
  `http://192.168.x.x` LAN address the browser blocks the mic outright.
- **Service worker / PWA install** also need a secure context.
- The **session cookie** is only marked `Secure` when the request is HTTPS
  (directly or via a trusted proxy — see below), so a plain-HTTP session would
  travel unencrypted on the LAN.

## 1. Set the passcode

```
# .env.local — operator sets this; never commit a real value, never log it.
AYAS_ACCESS_KEY=<a strong passphrase, >= 12 characters>
```

Until it is set, `resolveAccessGate` returns `disabled-dev` and **every page is
open** — that is fine for `localhost` dev, never for anything reachable from
another device.

## 2. Terminate TLS in front of the app

This PC (verified Sprint 211, read-only):

| | |
|---|---|
| host | `DESKTOP-9P0BG80` |
| LAN IP | `192.168.2.74` (Ethernet) |
| GPU | NVIDIA RTX A2000 12 GB (`nvidia-smi`: 12282 MiB) |
| reverse proxy installed | **none** (Caddy / nginx / Traefik / IIS all absent) |
| Windows Firewall | all profiles ON, no app-specific inbound rule |

Run the app on localhost:

```
npm run build
npm run start            # Next on 127.0.0.1:3000 (HTTP) — do NOT expose this port directly
```

Then put **Caddy** in front of it (`deploy/Caddyfile` is ready — its **primary
site is the LAN IP**, because the phone cannot resolve `studio.local`):

```powershell
winget install CaddyServer.Caddy            # operator; the build agent must not
cd <repo root>
caddy run --config deploy/Caddyfile         # foreground; or: caddy start ...
caddy trust                                 # trust Caddy's local CA on THIS PC
```

The phone reaches AYAS at **`https://192.168.2.74`** — no DNS anywhere.
`studio.local` also works, but only where that name resolves (this PC's hosts
file, or a router DNS entry). nginx / Traefik with your own cert are equally
fine. **Do not** install Tailscale, a VPN, buy a domain, or open a port to the
internet — LAN only.

### Trust the CA on the phone (one time)

`caddy trust` only covers this PC. Caddy's local root CA lives at
`%AppData%\Local\Caddy\pki\authorities\local\root.crt` (or
`caddy trust --help` to locate it). Get that file onto the phone and install it:

- **iOS:** AirDrop / email the `.crt` → Settings ▸ *Profile Downloaded* ▸ Install
  → then **Settings ▸ General ▸ About ▸ Certificate Trust Settings** → toggle it
  **on** (this second step is easy to miss and PWA install fails silently without it).
- **Android:** copy the file to the phone → Settings ▸ Security ▸ *Encryption &
  credentials* ▸ *Install a certificate* ▸ *CA certificate*.

Without this, the browser shows a cert warning and **the PWA will not install**
(a service worker will not register on an untrusted origin).

The proxy **must**:
- forward the original `Host` header (so the same-origin CSRF check passes);
- send `X-Forwarded-Proto: https` (so the app marks the session cookie `Secure` —
  `isRequestOverHttps` in `src/lib/auth/accessGate.ts` reads it; a spoofed value
  can only make the cookie *more* restrictive, never bypass auth — verified by
  `smoke-ayas-access-gate`);
- not buffer `text/event-stream` (the app already sends `X-Accel-Buffering: no`
  for the chat stream; nginx also needs `proxy_buffering off;` on that location;
  Caddy streams SSE unbuffered by default).

### Firewall — one narrow inbound rule (operator)

Only the HTTPS port, only the LAN subnet:

```powershell
New-NetFirewallRule -DisplayName "AYAS HTTPS (LAN)" -Direction Inbound `
  -Action Allow -Protocol TCP -LocalPort 443 -RemoteAddress 192.168.2.0/24
```

Do **not** open port 3000, and do **not** allow `Any` remote address.

### Next.js binding

`next start` is left on its default; the reverse proxy connects to
`127.0.0.1:3000` on the same host, so the HTTP port never needs to face the LAN.
If you must run Next without a proxy for a quick test, bind it explicitly to the
LAN IP (`next start -H 192.168.2.74`) — but then the mic / PWA will not work
(no secure context) and the session cookie will not be `Secure`.

## 3. Install AYAS as an app on the phone

**Prerequisites** (all above): passcode set, Caddy running, **CA trusted on the
phone**, phone on the same LAN.

1. Enable the service worker — add to `.env.local` and rebuild:
   ```
   NEXT_PUBLIC_ATOLYE_PWA_SW=on
   ```
   ```powershell
   npm run build && npm run start
   ```
   (Off by default; `PwaRegister` unregisters a stale worker if you turn it back
   off, so this is a clean revert.)
2. Phone browser → **`https://192.168.2.74/brain`** — no cert warning (CA trusted).
3. Log in with the passcode.
4. **Install:**
   - **Android/Chrome:** menu ▸ *Install app* / *Add to Home screen* (the prompt
     appears once the manifest + PNG icons + service worker are all seen).
   - **iOS/Safari:** Share ▸ *Add to Home Screen*.
5. An **AYAS icon** appears on the home screen. Tapping it opens `/brain`
   full-screen (`display: standalone`) — no browser chrome.
6. In the app: send a text turn (confirm it streams token-by-token).
7. **Voice — iPhone is single-shot** (Safari/WebKit): tap the mic, accept the OS
   permission + the in-app disclosure, then say the whole thing in **one breath**:
   *"AYAS, kaç proje var"*. If you only say *"AYAS"*, the app shows
   *"Uyandım. Şimdi mikrofona tekrar dokunup komutunu söyle."* — **tap the mic
   again** (that tap is the gesture iOS requires) and say the command. Confirm
   AYAS speaks the reply (first time may need a tap on the ▶ replay button).
   - iPhone needs Turkish dictation: **Settings ▸ General ▸ Keyboard ▸ Enable
     Dictation** + add **Turkish** under *Dictation Languages*. Without it the app
     shows "Türkçe konuşma tanıma bu cihazda etkin değil".
8. Confirm the **"Yürütme kapısı: CLOSED"** badge is shown. Do **not** actually
   run "pipeline çalıştır" — AYAS refuses it, which is the point.

**If "Install" does not appear (Chrome):** open `chrome://inspect` devtools on the
phone (or `?debug`), check *Application ▸ Manifest* for errors — the usual causes
are an untrusted cert (step "Trust the CA") or `NEXT_PUBLIC_ATOLYE_PWA_SW` not
set / not rebuilt.

## 4. Per-host settings

Already applied to `.env.local` (Sprint 211 — non-secret, AYAS/Brain-only, no
pipeline effect; the pipeline still uses `OLLAMA_MODEL=qwen2.5:3b`):

```
AYAS_OLLAMA_MODEL=qwen2.5:7b               # AYAS chat only (askAyas + the stream route)
ATOLYE_BRAIN_HARDWARE_PROFILE=rtx-a2000-12gb   # Brain Core snapshot / safety governor only
```

Required for the phone PWA install (§ 3):

```
NEXT_PUBLIC_ATOLYE_PWA_SW=on            # registers /sw.js — Chrome needs it for the install prompt
```

## What stays closed regardless

- **The Execution Gate stays `CLOSED`.** Logging in does not let AYAS run a
  pipeline, open the gate, or execute anything.
- **`resume-stage` write execution stays `DISABLED`** (`writeActionsEnabled`
  default `false`).
- Enabling either is a separate, explicitly authorized step — see
  `docs/AYAS_ACTIVATION.md` § 7.
