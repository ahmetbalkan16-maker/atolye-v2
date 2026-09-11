# AYAS phone gateway — Cloudflare Worker

Phase 2 · P0-A.4 · **Option A** (see `../docs/AYAS_PHONE_RUNTIME_DECISION.md`).

The one thing this Worker exists for: when the PC is fully off (cloudflared,
Next, Ollama all dead), give the already-installed phone PWA a stable,
independently-reachable `POST /api/ayas/chat/stream` so AYAS can still answer
— via a cloud LLM, honestly announcing it has no project/memory context. When
the PC is on, the phone keeps using the existing Quick Tunnel path unchanged;
this Worker is untouched until that path fails.

Source: [`src/worker.ts`](src/worker.ts). No routing/execution logic lives
here beyond the OpenAI-compatible SSE proxy — reasoning, context, and memory
stay on the PC (see the file's header comment for the full rationale).

## Prerequisites

- A Cloudflare account (the same one the operator already has — no new
  vendor).
- `npx wrangler` (no global install needed; the commands below use `npx`).
- An OpenAI-compatible API key for the cloud model (OpenAI / OpenRouter / Groq
  / Together / …) — the **same value** you'd put in `AYAS_CLOUD_API_KEY` in
  `.env.local` for the PC-side fallback, or a separate one if you want the
  phone path billed independently.
- A **phone key** you invent yourself — any random string ≥ 12 chars (e.g.
  `openssl rand -hex 24`). This is a second, separate secret: it authenticates
  the *phone* to the Worker. It is **not** the same as `AYAS_ACCESS_KEY` (the
  PC's session-cookie gate) and is never shared with any file in this repo.

## Deploy

Run from `cloudflare/ayas-phone-gateway/`:

```sh
# 1. Auth to Cloudflare for this shell only — a scoped, short-TTL API token is
#    recommended (dash.cloudflare.com/profile/api-tokens → Create Token →
#    Custom Token → Account > Workers Scripts > Edit, scoped to this account).
#    Revoke the token from the dashboard once the deploy below is confirmed.
export CLOUDFLARE_API_TOKEN="..."      # this shell/process only — never a file
export CLOUDFLARE_ACCOUNT_ID="..."

# 2. Deploy the Worker code (no secrets in it — see worker.ts).
npx wrangler deploy

# 3. Set the two secrets (each prompts on stdin; not passed as an argv/env
#    value that would land in shell history or a process list).
npx wrangler secret put AYAS_CLOUD_API_KEY
npx wrangler secret put AYAS_PHONE_KEY

# 4. Note the deployed URL from step 2's output, e.g.:
#    https://ayas-phone-gateway.<your-subdomain>.workers.dev
```

## Wire it to the phone

1. Set `NEXT_PUBLIC_AYAS_WORKER_URL=https://ayas-phone-gateway.<subdomain>.workers.dev`
   in `.env.local` (PC-side; it's a public URL, not a secret — safe as
   `NEXT_PUBLIC_*`) and rebuild (`npm run build && npm start`).
2. While the PC is on and the phone is on the same network as normal, open
   the installed PWA once with `?ayasPhoneKey=<the phone key from step 3
   above>` appended to the URL. The app stores it in that browser's
   `localStorage` and strips the parameter from the address bar immediately —
   the key is never sent to the PC, logged, or written to a file. Do this once
   per device.
3. From then on: PC reachable → unchanged Quick-Tunnel/Ollama path. PC
   unreachable (network error, not an HTTP error) → the client retries once
   against the Worker URL with `Authorization: Bearer <phone key>`.

## Verifying no secret leak

```sh
# Should be 401 (no key) — body must be exactly {"error":"unauthorized"}, no
# other detail.
curl -s -o - -w '\n%{http_code}\n' -X POST \
  https://ayas-phone-gateway.<subdomain>.workers.dev/api/ayas/chat/stream \
  -H 'Content-Type: application/json' -H 'Origin: https://192.168.2.74' \
  -d '{"text":"test"}'

# With the right key, response must stream `data: {...}` frames whose JSON
# never contains "AYAS_CLOUD_API_KEY", "Authorization", "sk-", or any header
# value — inspect the raw bytes, not just the rendered text.
```

## What this Worker does NOT do

- No filesystem, no Ollama, no `data/brain/`, no PC dependency of any kind.
- No context assembly / reference resolution / long-term memory (Phase B/C —
  PC-only; a phone-off-PC reply is deliberately "no memory" and says so).
- No WRITE/EXECUTE of any kind — text in, text out, same as every other AYAS
  model path. The Execution Gate is not reachable from here; nothing in this
  Worker imports or references it.
- No change to the existing Quick Tunnel, Caddy, or PC-side auth/session gate.
