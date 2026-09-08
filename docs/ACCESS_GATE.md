# AYAS Access Gate

A single shared passcode in front of `/brain`, the studio pages and every
mutating `/api` route, for when AYAS is reached over the LAN. No accounts, no
external service, $0. Added in the Master Sprint (§24).

**This is an authentication boundary only. It is not the Execution Gate.** A
logged-in session still cannot run a pipeline, approve an autonomous proposal or
execute anything — that chain stays CLOSED.

## Setup

Set one env var (`.env.local`, or the process environment):

```
AYAS_ACCESS_KEY=<a long random string, >= 12 chars>
```

Restart the server. Visit any protected page → redirected to `/login` → enter
the key → a signed, HttpOnly session cookie is set for 12 hours.

| `AYAS_ACCESS_KEY` | `NODE_ENV` | Behaviour |
|---|---|---|
| set (≥ 12 chars) | any | **enforced** — session required |
| unset | not `production` | **disabled-dev** — open, `x-ayas-access-gate: disabled-dev` header |
| unset or too short | `production` | **misconfigured** — protected paths return 503 (fail closed) |

## What it does

- `middleware.ts` verifies the `ayas_session` cookie (HMAC-SHA256 over the
  payload, keyed by `AYAS_ACCESS_KEY`, 12 h TTL, 60 s clock skew) on every
  protected request. `src/lib/auth/accessGate.ts` holds the pure logic.
- Open paths: `/login`, `/api/auth/*`, `/_next/*`, `/favicon.ico`,
  `/robots.txt`, `/manifest.webmanifest`.
- CSRF backstop: a state-changing request (`POST`/`PUT`/`PATCH`/`DELETE`) whose
  `Origin`/`Referer` is present and cross-host is rejected with 403.
- Brute force: `/api/auth/login` is per-IP fixed-window rate limited
  (8 attempts / 10 min), process-local and best-effort.
- No CORS headers are emitted anywhere, so cross-origin reads stay blocked by
  the browser.
- `POST /api/auth/logout` clears the cookie.

## Limits (known)

- The rate limiter and its counters are per-process (single instance). Fine for
  a home studio; not a distributed limiter.
- The gate does not by itself make it safe to expose the host to the public
  internet. Keep AYAS on the LAN — no port forwarding, no Tailscale (§24).
- Coverage: `smoke-ayas-access-gate` (14 scenarios) — `npm run smoke:ayas-access-gate`.
