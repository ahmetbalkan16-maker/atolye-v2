# Stage 15T — Owner Executive Briefing + Alert Priority

Canonical sources: final execution order, STAGE 15T; freeze addendum 15T; post-freeze design addendum §7
(controlled proactive initiative); V3.2 revenue addendum (briefing integration).

## Provenance

- A Codex candidate was started in an isolated checkout at `cd435bc` and saved unmerged at the owner's
  stop as `codex/ayas-stage15t-paused` (`03cddde`, pushed). Its state at the stop: initial 24 scenarios
  passed before later hardening; mutation audit FAILED (33/34, `unexpected journal files ignored`
  survived); TypeScript not rerun; browser, lint, baseline NOT_RUN; Graphify NOT_CURRENT.
- 2026-10-03 owner order: complete 15T, close Stage 15, commit + push, then Stage 16. Resumed on
  `wip/ayas-graphify-final-execution` at `dd119b3` (15S closure + owner-stop record, docs only after the
  tested 15S source `cd435bc`). The candidate files were brought over unchanged (`BrainPatchSafety.ts`
  and `AyasControlCenter.tsx` were byte-identical between `cd435bc` and `dd119b3`) and reproduced as
  found: focused 24/24 PASS, TypeScript PASS, mutation 33/34 with the same survivor.

## Review findings on the candidate (fixed here)

1. **Cooldown never suppressed anything.** Every reopen and every evidence change set an escalation
   reason, and any escalation reason bypassed the cooldown; a delivered alert could only become
   eligible again through one of those paths. A flapping issue therefore re-notified on every reopen.
   The old cooldown scenario passed only on a hand-built state the reducer cannot produce.
   Now only `SEVERITY_INCREASED` and `MATERIAL_EVIDENCE_CHANGED` bypass the cooldown; a reopened issue
   with no higher severity (`REOPENED`) and a lower severity (reason `null`) wait for it; a reopen at a
   higher severity is `SEVERITY_INCREASED`.
2. **Unbounded state and history.** Resolved alerts were kept forever (1,000-alert cap, then every
   write failed), every record held the whole state, and every read replayed the whole chain under a
   16 MiB / 1.5 s budget, so the store would turn permanently UNAVAILABLE in ordinary use. Now:
   resolved alerts are pruned after 30 days and beyond 64; active alerts are capped at 128 and fail
   closed above it (never dropped); a read verifies the last 64 records chained to a self-verifying
   anchor record, and checks the numbering of the whole history (six-digit names, lowest 1, highest
   n, so a record outside the window can be neither removed nor replaced); history is capped at
   100,000 records; `scripts/ayas-executive-alerts.ts --verify-full` replays the whole chain.
3. **ROUTINE churn.** ROUTINE (Control Center IN_PROGRESS items, e.g. changing file counts) was stored
   and appended a full-state record on every change. ROUTINE is now audit-only: never stored, never
   notified, listed with its evidence on the full briefing page; an issue reported as ROUTINE counts
   as absent and resolves only when its area was fully observed.
4. **No reliability link.** The 15F reliability counters (`readAyasReliabilityState`, read-only) now
   feed the "failures/recoveries" area: a `BREACH` counter is a CRITICAL alert
   (`failures:reliability-<counter>`); `UNKNOWN` is shown as "ölçülemedi", never as zero; unread
   counters keep the area uncovered.
5. **Unreadable sources were silent.** Items of an unreadable domain were dropped. They are now one
   aggregated MATERIAL_INFO notice (`health:sources-unavailable`) under its own key, so it can never
   replace or lower a known condition (e.g. a CRITICAL health condition stays CRITICAL while health is
   unreadable). A failed report-center read (shown by the Control Center as NO_DATA) is reported as
   unreadable.
6. **Page robustness.** The collector is called with the same last-resort `.catch(() => null)` as
   `/brain`; the alert projection (`AyasExecutiveOwnerView.ts`) never throws for metadata — an
   unreadable history, a clock behind the stored history or a refused write shows the briefing with
   persistence `UNAVAILABLE` and nothing eligible.
7. **Surviving mutant adjudicated.** Under the old full-replay reader the filename regex was subsumed
   by the sequential-name check (an equivalent mutant). Under the windowed reader it is the only guard
   for records outside the window; scenario 26 now kills it. Three checks that were provably redundant
   (explicit active cap in `observe`, record `previousDigest` shape, `:unavailable` id filter) were
   removed instead of being recorded as equivalent survivors; their contracts stay enforced by the
   state assertion, the chain link and the readable-domain filter.

## Design (as integrated)

- `src/lib/ayas/briefing/AyasExecutiveAlerts.ts` — pure reducer: four priorities, one issue key per
  alert, material fingerprint (observation time excluded), owner acknowledgement bound to the exact
  fingerprint, cooldown starting at actual delivery, coverage-gated resolution, bounded state.
  Queues: CRITICAL → immediate; ACTION_REQUIRED → approval queue; MATERIAL_INFO → next briefing;
  ROUTINE → audit only. `grantsAuthority: false` everywhere.
- `AyasExecutiveAlertStore.ts` — append-only hash-chained records under the ignored
  `data/brain/execution/owner-alerts`, exclusive create + re-read; SAFE_READ_ONLY respected before and
  at the write; ACKNOWLEDGE/DELIVERED need a verified owner session (enforced access gate only).
- `AyasExecutiveBriefing.ts` — nine canonical areas from the existing Control Center facts and the 15F
  counters; revenue and production cost `NOT_CONFIGURED` (no live ledger; never zero);
  `monetaryAuthority: NONE`; transport `LOCAL_OWNER_UI_ONLY`.
- `AyasExecutiveOwnerView.ts` (projection, no loaders) and `AyasExecutiveBriefingService.ts` (loaders).
- UI: `/brain/briefing` (GET is read-only; the hydrated client syncs through the owner-session action),
  compact panel on the existing Control Center home. A delivery is recorded only when the alert was
  rendered in a visible document. No proposal decision, execution, tool, spend or external transport.
- `BrainPatchSafety`: the briefing modules, actions, panel, alert history, operator and graders are
  `FORBIDDEN_AUTONOMOUS` / yardstick files (more restrictive only).
- Firewall closure map: `app/brain/briefing/actions.ts` is a mapped read-model surface (same read set
  as `observerActions`, guards READ_ONLY_PROBE / LOCAL_MODEL / IMPORT_ONLY); the page is a named entry.

## Evidence (uncommitted overlay on `dd119b3`)

- Focused `scripts/smoke-ayas-executive-briefing.ts`: 30 scenarios PASS (TEMP only).
- Negative controls `scripts/smoke-ayas-executive-briefing-mutations.ts`: 68/68 caught, every one by
  an assertion of its named scenario.
- TypeScript PASS (`--incremental false`); changed-file ESLint 0/0; `git diff --check` PASS.
- Affected suites outside the declared baseline, TEMP clone: brain-control-center 22 + 13 held-out +
  integration PASS; brain-core-ui 43; patch-detectors 37; brain-selfheal 41; selfheal-security 14;
  selfheal-e2e-v2 3; adaptation-pipeline 7; autonomous-foundation-acceptance 42.
- Repo-wide guards through the baseline runner on the overlay: durable-task-recovery PASS,
  discovery-registry PASS, exact-proposal-safety PASS; action-firewall-closure first FAILED (new entry
  points not registered), then PASS after registration (12 scenarios, 9 surfaces, 41 mapped modules).
- Real hydrated browser (TEMP clone, `next build` + `next start` on 127.0.0.1:3917, fixture access key,
  TEMP runtime root, headless Chrome over CDP): no session → `/login`, no record; owner session →
  hydrated VERIFIED panel, 4 alerts (CRITICAL with `role=alert`), 9 areas, revenue NOT_CONFIGURED;
  records OBSERVE + 4 DELIVERED; reload added nothing; the real "Gördüm" button added one ACKNOWLEDGE;
  `/brain` shows the compact panel; no console errors; chain intact. Screenshot SHA-256
  `6348a7c34e8755ff0487cf4b552944bd525ceb3be628e3183a3944a31aa1693a` (kept outside the repository).
- Manifest `15F.4-v35`: 118 suites (adds `executive-briefing`, `executive-briefing-mutations`),
  139 unique pins; refreshed pin: `action-firewall-closure`; v34 archived as `EVAL_MANIFEST_V34.json`.

## Known limitations

- Delivery is the owner's open Brain UI only (`LOCAL_OWNER_UI_ONLY`). There is no push/phone channel
  in the repository; adding one is new external transport and stays owner-gated. "Immediate" means the
  next visible render of the briefing or the Control Center home.
- Observation is written only on an authenticated owner refresh; nothing observes in the background.
- Revenue, fees, profit and production cost stay `NOT_CONFIGURED` until Stage 16 / a live cost ledger
  bind into the briefing; Stage 16 must add its material changes (V3.2 revenue addendum list).
- Resource bounds not exercised by tests: 16 MiB window bytes, 1.5 s read deadline, 100,000 records.
- History files are never pruned (append-only); growth is bounded only by the record cap.
- The live owner server keeps serving its old build until the owner rebuilds and restarts it
  (OWNER_ACTION, not blocking). The briefing page uses unstyled native controls (cosmetic).
