---
name: ayas-ui-audit
description: Click through every AYAS page and button in an isolated copy of the app and report what is broken — runtime errors, hydration errors, failed requests, error pages, controls that throw. Use this whenever the owner asks whether AYAS's buttons/pages work ("butonlar çalışıyor mu", "sayfalara bak", "AYAS'ı tara", "bir şey bozuldu mu"), after changing UI in app/ or src/components/, and before taking a UI change live. Never test against the live app or its data; this skill starts its own throwaway server.
---

# AYAS UI audit

One command starts an isolated AYAS (`next dev` from this checkout on 127.0.0.1:3210) with a throwaway access key and
a temp copy of the V3 records, sweeps every page with headless Chromium over CDP, writes a report, and cleans up. It
was built on 3 Nov 2026 when the owner asked "ayasa bak bütün butonlar çalışıyor mu": 28 pages, 258 view controls,
one real bug found (the wake lab's hydration error, fixed in f112b7b5).

## Why it is isolated

A second server on live data is dangerous: `instrumentation.ts` starts the production worker and recovery at boot and
would race the live one, and AYAS's approve/apply buttons commit, push and publish. So the runner:

- refuses the canonical checkout (`D:\ÜRETİM\Atolye\atolye-v2`) and any checkout with a `.env`/`.env.local` — those
  point at the live runtime root, the live access key and the observer's `data/brain`. Run it from a development
  worktree such as `D:\ÜRETİM\Atolye\atolye-v2-v3`;
- blanks `OPENAI_API_KEY`, `ANIMATION_OPENAI_ENDPOINT`, `ATOLYE_DURABLE_PIPELINE_EXECUTION` and
  `AYAS_AUTONOMOUS_EXECUTION_ENABLED` (blank, not unset: Next never fills a variable that is set, even empty, from a
  `.env` file), so nothing spends money or executes;
- gives the server its own empty project storage and authority root in the temp area (`ATOLYE_RUNTIME_ROOT`,
  `ATOLYE_RUNTIME_AUTHORITY_ROOT`; a blank root is rejected as invalid by design), so the production worker that
  `instrumentation.ts` starts sees nothing of the live runtime;
- sets a fresh random `AYAS_ACCESS_KEY` (the gate stays enforced — with the gate open, briefing actions answer
  `AYAS_BRIEFING_OWNER_SESSION_REQUIRED` 500 by design) and logs in with it the way the login form does;
- points `ATOLYE_V3_WORK_ROOT` at a temp copy of the V3 `_kutuphane` records under 1 MB (orders, brains' memory,
  reports — no media), so the Atölye pages show real states without touching the real ones;
- uses the Chromium Playwright already installed (`%LOCALAPPDATA%\ms-playwright\chromium-*`); nothing is downloaded.

## Run it

From the worktree root (keep TEMP on D, owner rule):

```bash
cd "D:/ÜRETİM/Atolye/atolye-v2-v3"
TEMP="D:\\ÜRETİM\\private\\temp" TMP="D:\\ÜRETİM\\private\\temp" node .claude/skills/ayas-ui-audit/scripts/run-audit.mjs
```

It takes about 10–25 minutes (a cold dev server compiles each route on first visit), so run it in the background and
wait for it to finish. Options:

- `--actions` — also press the owner's everyday buttons on the test server: the 12 Control Center cards, the homepage
  views, chat "Gönder" (answered by the local Ollama `qwen2.5:3b`, so Ollama must be running), briefing "Gördüm",
  "Çıkış". Use it when the owner asks whether the buttons *work*, not only whether pages open.
- `--routes '["/","/brain?panel=chat"]'` — only these pages (default: every static page under `app/`, every
  `/brain?panel=<id>` from `BrainPanelId` in `src/components/brain/brainCore.ts`, and a missing project for the 404).
- `--probe '[{"route":"/brain?panel=development","label":"^Ölçüm ve dersler"}]'` — click each control whose label
  matches the regex, each on a freshly loaded page; it records whether a `<details>` opened. The runner already does
  this by itself for every toggle the sweep could not reach (a header nested in another one goes out of sight when a
  sibling opens) and counts it as broken only if that fails too; use `--probe` for a control you want to look at.

Exit code 0 means clean, 1 means problems were found, 2 means it refused or the server did not start (read the
message and `dev.log`).

## What it clicks, and what it never clicks

The sweep clicks only view controls — tabs, `<summary>` toggles, show/hide/details/refresh/next/previous — and goes
back to the page after any navigation. Anything whose label looks state-changing (onayla, uygula, reddet, sil, başlat,
gönder, yükle, kaydet, indir, commit, push, publish, mikrofon, konuş, …), every submit button and form field is only
listed as an "eylem düğmesi". Never extend it to press approve/apply/commit buttons, the microphone, or "MODELİ İNDİR",
even on the test server: approval binds to real batch hashes, apply runs the publication path, and the model download
is gigabytes.

## Reading the result

`D:\ÜRETİM\private\temp\ui-audit\<stamp>\out\OZET.md` lists each page (✓/✗) with its HTTP status, errors at load,
error text on the page, and every control that threw; `tarama/report.json` has the full detail and a screenshot per
page; `dev.log` is the server's own log (hydration errors show their component stack there).

Things that look like bugs but are the test setup:

- Panel tabs do not change the URL — the console keeps them in client state by design.
- Chat refuses to answer without `OLLAMA_NUM_CTX` (the runner sets it as the live `.env.local` does).
- A 404 on `/project/olmayan-proje` is the not-found page working.
- The test server keeps AYAS's own state in this checkout's git-ignored `data/brain` (briefing acknowledgements, chat
  activity, execution authorizations) — the worktree's, never live. Once every briefing item is acknowledged, the
  `--actions` "Gördüm" step reports "0 düğme, hepsi pasif"; that is not a fault.
- `next dev` appends a "nextjs-agent-rules" block to `AGENTS.md` at boot; the runner undoes it when `AGENTS.md` was
  clean before the run. If it was already edited, check `git diff AGENTS.md` yourself afterwards.

A real finding: `Runtime.exceptionThrown`, `console.error` with "Hydration", a `next overlay:` page problem, an HTTP
5xx on a page's own API call, or a control that is listed but cannot be clicked. Fix it in the component, run the
component's smoke script (`grep` `scripts/` for the file name), then re-run the audit on just that route with
`--routes` before going live.

## Afterwards

The runner deletes the key file, the V3 copy and the browser profile; only `out/` stays (reports, screenshots, dev
log). Report to the owner in Turkish: how many pages and controls, what was pressed for real, what was deliberately not
pressed, and each real finding with where it was fixed.
