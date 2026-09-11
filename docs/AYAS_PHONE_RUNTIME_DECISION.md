# AYAS phone runtime — Architecture Decision (Phase 2 · P0-A.4)

**Status: Option A CHOSEN by the operator. Code DONE, tested, built — see
`cloudflare/ayas-phone-gateway/`. Deploy itself is BLOCKED: this environment
has no Cloudflare account credentials at all (no `wrangler`, no
`~/.cloudflared` cert, no `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`, and
`wrangler login`'s browser OAuth cannot run in a non-interactive CLI session).
The operator has agreed to hand over a scoped, short-TTL API token for this
session only to complete the deploy — see the final Phase 2 report for the
exact ask. No external service has been created yet.**

## The goal

> "PC KAPALIYKEN TELEFONDA AYAS ÇALIŞMALI."

## Why it is not possible with the current architecture

The installed phone PWA is bound to `https://<x>.trycloudflare.com`. That name
resolves to Cloudflare's edge, which forwards to **cloudflared (PID 26852,
running on the PC)** → `localhost:3000` Next server → Ollama. All three are on
the PC.

**PC off ⇒** cloudflared dead, Next server dead, Ollama dead. The hostname
returns a 5xx from the edge. Every phone API call fails. **No router / provider /
fallback code runs, because the server it lives in is off.**

The model-provider abstraction and router (shipped in P0-A) do not change this:
they run *inside* the Next route, on the PC.

## What a fix requires

One **off-PC**, always-up, server-side endpoint that:

1. holds the cloud LLM key **server-side** (the phone must never get the key —
   decision honoured);
2. exposes the exact same `POST /api/ayas/chat/stream` contract the PWA already
   calls, so **no PWA change and no reinstall**;
3. is reachable at a **stable** URL (the current Quick Tunnel hostname rotates on
   every cloudflared restart — a PC-off design can't depend on it).

The `CloudAyasProvider` (P0-A) is already a drop-in for the model call such an
endpoint would make.

## Options (all need explicit authorisation — none done)

| Option | Fits "no new vendor"? | Effort | Notes |
|---|---|---|---|
| **A. Cloudflare Worker** proxying `/api/ayas/chat/stream` → cloud LLM | same Cloudflare account, no VPS/Vercel/Railway/Supabase | small | The natural fit given the tunnel is already Cloudflare. A Worker is not a "server" in the VPS sense. **Currently excluded by this phase's rules** ("Cloudflare Worker kurma"). |
| **B. Named Cloudflare Tunnel** to a tiny always-on origin (a $5 VPS / a Pi) running only the AYAS chat route + cloud key | new box | medium | Stable hostname; the PWA could keep pointing at it. |
| **C. Split origin**: PWA installed from a stable domain; that origin routes to the PC when reachable, else to a cloud LLM | new domain + edge logic | medium-large | The "proper" long-term shape (matches the Phase-2 node model). |
| **D. Accept the limitation**: PC-off ⇒ phone AYAS shows "PC erişilemiyor" and offers only offline-capable actions (recall cached memory, drafts) — no live model | none | tiny | Honest; defers the endpoint. |

## Recommendation

If PC-off phone AYAS is a hard requirement → **Option A** (a single Cloudflare
Worker, ~50 lines, same account, cloud key as a Worker secret) is the smallest
real fix. It needs one explicit "kur" from the operator, lifting this phase's
"no Worker" rule for that one file.

Until then → **Option D** is the current reality, and P0-A's router already
produces the honest "yerel model kapalı ve bulut modeli yapılandırılmamış"
message for it. The provider abstraction means switching to A/B/C later is a
config + one-endpoint change, not a rewrite.
