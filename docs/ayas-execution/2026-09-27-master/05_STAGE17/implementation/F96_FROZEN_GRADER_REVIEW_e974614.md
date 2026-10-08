# F96 — frozen-grader review: `app/page.tsx` versus the pinned firewall grader

Date: 2026-10-08. Source: clean `e974614` (branch `wip/ayas-graphify-final-execution`). Owner decision 3 of the Stage 17 review: inspect only, no pin change.

**Status: REVIEWED, NOT APPLIED.** The pinned grader, the eval manifest and every test are unchanged. The suite keeps failing until the owner decides.

## What fails

- Suite `action-firewall-closure` = `scripts/smoke-ayas-action-firewall-closure.ts`, scenario 9 of 12: "every entry point that reaches leased or owner-only work is a mapped surface or a named operator script".
- Assertion: `a new entry point reaches leased or owner-only work … + ['app/page.tsx']`.
- Reproduced twice: in the bound full166 run at `e974614` (TEMP fixture `action-firewall-closure-0.stderr.txt`, same text), and in a separate `git archive` copy of `e974614` (8 scenarios pass, then this one fails).

## Cause

`4ca7e66` (2026-10-07, "implement owner-approved AYAS Brain UI V2 homepage") changed `app/page.tsx`:

```diff
-import HomeClient from "@/components/HomeClient";
+import { AyasConsolePage } from "@/components/brain/AyasConsolePage";
+import "@/components/homepage/AyasHomepage.css";
+export const dynamic = "force-dynamic";
 export default function Page() {
-  return <HomeClient />;
+  return <AyasConsolePage homepage />;
 }
```

The old dashboard moved unchanged to `app/studio/page.tsx`, which reaches no leased or owner-only module. The grader was last changed in `2bebdba` (2026-10-03) and lists `app/brain/page.tsx` in `OTHER_ENTRIES`, but not `/`. The grader did not regress: the source gained an entry point that it was never told about.

## Hashes

| | SHA-256 of `scripts/smoke-ayas-action-firewall-closure.ts` |
| --- | --- |
| Old (pinned, current) | `c57403df5ba9d8817a27fbf6fc6843bbd12bd5bd4fcf1d39168b7725260b2547` |
| New (with the one line below) | `a7824b99374826a4145894215182fe0ffe4aac3b87778b1c2eec60e9f4531308` |

The old value is the current file's bytes (LF; the `git archive` copy is byte-identical). That it equals the manifest pin is inferred, not read: the baseline runner refuses to start on any pin drift (`AYAS_EVAL_PIN_DRIFT`, `scripts/ayas-eval-baseline.ts:31`), and the bound run at `e974614` started. The manifest file itself was not opened in this review.

## Proposed one-line diff (not applied)

Insert before `"app/brain/briefing/page.tsx"` in `OTHER_ENTRIES`:

```diff
 const OTHER_ENTRIES: Readonly<Record<string, string>> = {
   "app/brain/page.tsx": "the Brain page; it imports the two owner-session action modules mapped above",
+  "app/page.tsx": "the owner homepage; it renders the same AyasConsolePage as the Brain page and imports the same two owner-session action modules mapped above",
   "app/brain/briefing/page.tsx": "the owner briefing page; a read-only GET that writes no metadata and imports the briefing action module mapped above",
```

With exactly this line the grader passes 12 of 12 in the same copy ("PASS (12 scenarios; 9 surfaces; 41 mapped modules; TEMP only)"). No other scenario changes outcome.

## Security impact

Measured with the grader's own import graph (copy of its code, run against the `e974614` copy):

| Check | `/` (`app/page.tsx`) | `/brain` (`app/brain/page.tsx`) |
| --- | --- | --- |
| Import closure | 325 files | 325 files; the only difference is the entry file itself |
| Leased or owner-only modules reached | 15 | the same 15 (TOOL/OWNER/DISCOVERY/DURABLE lease, OWNER_PUBLICATION) |
| Effectful modules reached | 33 | the same 33 |
| Entry points the scenario finds unregistered | `app/page.tsx` only | — |

- **No new capability.** `/` renders the same `AyasConsolePage` and reaches the same server-action modules (`app/brain/actions.ts`, `app/brain/observerActions.ts`). Server-action IDs in Next.js are not page-scoped, so these actions could already be called; the homepage adds a second page that posts them.
- **Same authentication.** `/` is in neither `OPEN_EXACT` nor `OPEN_PREFIXES` (`src/lib/auth/accessGate.ts`), so `middleware.ts` requires a valid `ayas_session` and, for POST, a same-origin request. The access daemon already tests this every 60 s: `Test-AccessGateResponse` expects `/` to answer 307 to `/login?next=%2F` (`scripts/ayas-access-daemon.ps1:143-160`).
- **Owner bindings unchanged.** Approval, batch and publication actions keep their own `proposalId`/`batchId` + hash binding; nothing in this line touches them.
- **The line does not weaken the grader.** `OTHER_ENTRIES` entries are not excused from module mapping: every effectful module `/` reaches is still checked by the adapter-map scenarios through `app/brain/actions.ts` and `app/brain/observerActions.ts`. The "remove these from OTHER_ENTRIES" assertion keeps the entry honest — it fails if `/` stops reaching that work. The scripts-only starter checks do not apply to `app/` entries, exactly as for `app/brain/page.tsx`.
- **Residual risk (same as `/brain` today).** If the homepage later imports a different owner-only module, this suite catches it only through the module maps, not through a `/`-specific map. A stricter alternative would assert that the closures of `/` and `/brain` stay equal; that is more than one line and is not proposed here.

## If the owner approves

1. Apply the one line above; nothing else in the grader.
2. Refresh the grader's SHA-256 pin to `a7824b99…1308` in `03_STAGE15_BASE/hardening/15F/EVAL_MANIFEST.json`, bump it to v58, and keep v57 as `EVAL_MANIFEST_V57.json`.
3. Run the declared full baseline at the commit; the expected result is three FAILs (the preserved raw FAILs `retrieval-evaluation`, `golden-vault-run`, `golden-sandbox-run`) and F96 closed.

Until then every full166 run reports four FAILs, F96 included.

## Evidence

- `F96_FROZEN_GRADER_REVIEW_e974614.json` (probe output: closures, module sets, run results).
- Bound full166 report at `e974614` (see the ledger entry of the same date).
