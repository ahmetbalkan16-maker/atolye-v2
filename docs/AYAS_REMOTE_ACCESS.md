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

Then put a TLS-terminating reverse proxy in front of it. Simplest is **Caddy**
(local CA — the phone trusts it after a one-time cert install, or use a real cert):

```
# install (operator runs this — the build agent must not):
winget install CaddyServer.Caddy

# Caddyfile
studio.local {
    reverse_proxy 127.0.0.1:3000
}
```

Point the phone at `https://studio.local` (add a hosts entry or use the Caddy
`192.168.2.74` site address). nginx / Traefik with your own cert are equally fine.
**Do not** install Tailscale, a VPN, buy a domain, or open a port to the internet
— LAN only.

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

## 3. First connection from the phone

1. Put the phone on the same network / tunnel.
2. Open `https://studio.local/brain` (or your chosen host).
3. You are redirected to `/login` — enter the passcode.
4. Send a text turn; confirm the reply streams token-by-token.
5. Tap the mic, accept the browser permission prompt, accept the in-app
   disclosure (cloud speech recognition), say "AYAS …".
6. Optionally "Add to Home Screen" to install the PWA.

## 4. Per-host settings

Already applied to `.env.local` (Sprint 211 — non-secret, AYAS/Brain-only, no
pipeline effect; the pipeline still uses `OLLAMA_MODEL=qwen2.5:3b`):

```
AYAS_OLLAMA_MODEL=qwen2.5:7b               # AYAS chat only (askAyas + the stream route)
ATOLYE_BRAIN_HARDWARE_PROFILE=rtx-a2000-12gb   # Brain Core snapshot / safety governor only
```

Still an operator choice (enable only after a browser check):

```
NEXT_PUBLIC_ATOLYE_PWA_SW=on            # the service worker — verify offline behaviour first
```

## What stays closed regardless

- **The Execution Gate stays `CLOSED`.** Logging in does not let AYAS run a
  pipeline, open the gate, or execute anything.
- **`resume-stage` write execution stays `DISABLED`** (`writeActionsEnabled`
  default `false`).
- Enabling either is a separate, explicitly authorized step — see
  `docs/AYAS_ACTIVATION.md` § 7.
