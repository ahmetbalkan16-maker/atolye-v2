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

Run `npm run build && npm run start` (Next on `:3000`, HTTP, localhost) and put a
TLS-terminating reverse proxy in front of it. Any of these is fine — pick one:

- **Caddy** (simplest — automatic local CA or a real cert):
  ```
  studio.local {
      reverse_proxy 127.0.0.1:3000
  }
  ```
- **nginx** / **Traefik** with your own cert.
- A tunnel you already trust. **Do not** have the build agent install Tailscale,
  a VPN, or buy a certificate — that is an operator decision.

The proxy **must**:
- forward the original `Host` header (so the same-origin CSRF check passes);
- send `X-Forwarded-Proto: https` (so the app marks the session cookie `Secure` —
  `isRequestOverHttps` in `src/lib/auth/accessGate.ts` reads it);
- not buffer `text/event-stream` (the app already sends `X-Accel-Buffering: no`
  for the chat stream; nginx also needs `proxy_buffering off;` on that location).

## 3. First connection from the phone

1. Put the phone on the same network / tunnel.
2. Open `https://studio.local/brain` (or your chosen host).
3. You are redirected to `/login` — enter the passcode.
4. Send a text turn; confirm the reply streams token-by-token.
5. Tap the mic, accept the browser permission prompt, accept the in-app
   disclosure (cloud speech recognition), say "AYAS …".
6. Optionally "Add to Home Screen" to install the PWA.

## 4. Optional per-host settings

```
# .env.local
AYAS_OLLAMA_MODEL=qwen2.5:7b            # better Turkish / instruction-following for AYAS chat only
ATOLYE_BRAIN_HARDWARE_PROFILE=rtx-a2000-12gb   # this workstation's GPU
NEXT_PUBLIC_ATOLYE_PWA_SW=on            # enable the service worker AFTER verifying offline behaviour in a browser
```

## What stays closed regardless

- **The Execution Gate stays `CLOSED`.** Logging in does not let AYAS run a
  pipeline, open the gate, or execute anything.
- **`resume-stage` write execution stays `DISABLED`** (`writeActionsEnabled`
  default `false`).
- Enabling either is a separate, explicitly authorized step — see
  `docs/AYAS_ACTIVATION.md` § 7.
