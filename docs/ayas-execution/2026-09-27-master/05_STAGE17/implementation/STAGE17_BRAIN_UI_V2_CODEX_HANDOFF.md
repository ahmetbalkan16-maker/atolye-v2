# Stage 17 / Foundation → Brain UI V2 — CODEX HANDOFF

Status date: 2026-10-07. Prepared by OpenCode at the mandatory stop boundary. This is a handoff, not an implementation start. **OpenCode did not touch any homepage/component/route/CSS/asset — Brain UI V2 implementation is reserved for Codex by owner instruction.**

## Repository state (verify with git, do not trust this text blindly)

- Branch: `wip/ayas-graphify-final-execution`
- Final evidence HEAD: `4dae16bf72d1b3b8b91b7163941ca412a06ff589` (Stage17 closure evidence commit; docs-only descendant of tested source)
- Qualified test source: `fde898f9305f4fd4d57c0f5c8230f50712b30374` — `src/` UNCHANGED fde898f..4dae16b (docs/checkpoint-only diffs, verified via `git diff --name-only fde898f..59e83cd` and the evidence commits that follow)
- local/origin: `0/0` (verified after push)
- Worktree: CLEAN (verified after push)
- This handoff file itself is the last docs-only commit after 4dae16b; resolve the actual HEAD with `git rev-parse HEAD` on arrival.

## Foundation final status

**FOUNDATION BLOCKED — correct fail-closed result; no blocker hidden.** Stage 17 technical/evidence scope completed by OpenCode:

- 152-criterion evidence matrix: `05_STAGE17/implementation/STAGE17_FOUNDATION_EVIDENCE_MATRIX_59e83cd.json` (+ `.md` summary) — 27 PASS_CURRENT_VERIFIED, 3 PASS_SAME_SOURCE_TEST, 5 PASS_DISCLOSED_LIMITATION, 9 PASS_DOCUMENTED_STATUS, 1 FAIL_RAW_PRESERVED, 6 OPEN_FINDING, 7 BLOCKED_OWNER_ACTION, 94 NOT_RUN.
- All 30 TEST/LIVE aggregate slots remain canonical NOT_RUN/COLLECTOR_NOT_BOUND, each now bound to its real evidence class (TEST = fde898f same-source witnesses including the 3 preserved FAILs; LIVE = fresh unauthenticated probes or explicitly none/owner-gated).
- Unified protected/external runtime scope classification: `STAGE17_UNIFIED_SCOPE_CLASSIFICATION_59e83cd.json` — A local protected / B configured external runtime / C authority canonical source lists; exclusions explicitly 0 across all cited intervals; separate interval measurements never combined into a unified PASS; combined canonical protected scope NOT_QUALIFIED (bounded implementation item open).
- Fresh canonical audits at 59e83cd: interval1 `PROTECTED_CHANGE_UNATTRIBUTED` (background brain-memory writes under `data/brain/Users`, 102 files/2h; attribution UNKNOWN by contract — no bounded writer receipt) PRESERVED; quiescent interval2 rerun with identical digests: `STAGE17_CURRENT_AUDIT_59e83cd.json` + `STAGE17_CURRENT_AUDIT_59e83cd_INTERVAL2.json`.
- Final owner-review readiness: `STAGE17_FINAL_OWNER_REVIEW_READINESS_59e83cd.json` — NOT_READY, ownerReviewDigest=null.
- Evidence registry: 110 entries, all digests from real file bytes.

## Full166 final result (immutable, do not touch)

- fde898f / v57: **166/166 declared suites executed; 163 PASS / 3 preserved raw FAIL** — `retrieval-evaluation` (raw FAIL exit1, exact12 IMPROVED review requests preserved, 16 known limits), `golden-vault-run`, `golden-sandbox-run` (PROMOTION_STOPPED solely for `golden.memory.retrieval-evaluation`). Receipts: `STAGE17_fde898f_FULL166.json`, `STAGE17_FULL166_QUALIFICATION_fde898f.json`.
- Historical 34ecb66 162 PASS / 4 raw FAIL receipt preserved immutably; no old receipt rebound or erased.
- Frozen rule: do NOT force these to PASS, loosen expectations, rewrite evidence, change raw output, or edit graders. Any evaluator succession needs an explicit owner-approved immutable versioned review.

## Graphify status

- At 59e83cd: analyzed/built == HEAD, stale=false, needs_update absent, integrity duplicateNodeIds=0, duplicateEdges=0, danglingEdges=0, selfLoops=0 (19242 nodes / 55159 links), structural PARTIAL (9 code files without nodes: 7 `.ps1` startup scripts, `.github/workflows/ayas-safe-ci.yml`, one thumbnail route — PowerShell grammar not installed; review those files directly), semantic PENDING.
- After this session's final commit, run `graphify update --scope all --no-description --no-label .` and re-verify `lastAnalyzedHead == HEAD`, `stale=false`, worktree covered (OpenCode runs this before stopping; Codex re-verifies on arrival).

## Open owner-action items (`STAGE17_OWNER_ACTION_REGISTER_59e83cd.json`)

1. AUTHENTICATED_RUNTIME_IDENTITY — owner-authenticated session proof for the running instance (never share credentials with any agent).
2. REAL_PHONE_VOICE_MEDIA_CONTINUITY — physical-device voice/wake/TTS/session continuity + approved live media/pixel/audio/E2E via designated gates.
3. ACTUAL_REBOOT_CONTINUITY — real Windows reboot + post-reboot continuity probes.
4. LEMON_TEST_BINDING — TEST-mode Lemon store/credential + connector/ingress binding through Stage16.8.
5. FIVERR_ORDER_REVENUE_LEDGER — official order/delivery/revenue/ledger evidence or explicit reviewed deferment.
6. FINAL_BOUND_OWNER_REVIEW — owner reviews the final audit packet digest and records the closure decision (after technical prerequisites).

OpenCode-completable items still open (NOT owner-only): combined protected-scope implementation, 30-slot collector binding (LIVE parts owner-dependent), installed-runtime lock migration (Next 16.2.10 → 16.3.8; restart window needs owner coordination), frozen evaluator succession (owner-approved versioned review).

## Brain UI V2 design pack / instructions (read these first)

- `docs/ayas-execution/2026-09-27-master/07_BRAIN_UI_V2/AYAS_BRAIN_UI_V2_IMPLEMENTATION_PLAN.md`
- `docs/ayas-execution/2026-09-27-master/07_BRAIN_UI_V2/AYAS_BRAIN_UI_V2_CODEX_CLOUD_TASK.md`
- `docs/ayas-execution/2026-09-27-master/07_BRAIN_UI_V2/AYAS_BRAIN_UI_V2_OWNER_PC_VALIDATION.md`
- `docs/ayas-execution/2026-09-27-master/07_BRAIN_UI_V2/ayas_yapay_zekâ_kontrol_merkezi.png` (visual reference)
- Canonical master order: `docs/ayas-execution/2026-09-27-master/00_COMMAND/AYAS_FINAL_CODEX_MASTER_EXECUTION_ORDER.md`
- Design intent (owner): sade, merkezi animasyonlu beyinli homepage; listening/thinking/speaking animasyonları; mevcut çalışan AYAS fonksiyonlarını BOZMA. New future features belong in appropriate sub-tabs, not scattered onto the homepage — but do NOT restructure the homepage principle by touching unrelated working features.

## Homepage / component / route short inventory

- Homepage: `app/page.tsx` (root layout `app/layout.tsx`).
- Brain console (Gelişim Merkezi): `app/brain/page.tsx` + `app/brain/{briefing,constitution,revenue,safe-mode,voice-lab,voice-lab/phone-llm,voice-lab/wake}/page.tsx`.
- Other routes: `app/login`, `app/offline`, `app/project/[slug]`, `app/research`, `app/scenes`, `app/script`, `app/visuals`, `app/api/*` (assets thumbnails route under `app/api/assets/thumbnails/[slug]/[fileName]`).
- Components: `src/components/{assets,brain,dashboard,projects,studio}`.
- UI work domain skills: check available skills (`frontend` for Brain console/app routes; UI/UX skill only if genuinely useful and safe).

## Net starting point for Codex

1. `git pull --ff-only`; verify branch/HEAD/0-0/clean; verify Graphify (`npx tsx scripts/ayas-graphify-status.ts`) — refresh if stale.
2. Read the design pack above; Graphify-first: `graphify explain`/`review-analysis` on `app/page.tsx`, `app/layout.tsx` and the `src/components/{brain,dashboard}` blast radius BEFORE any edit.
3. Implement the sade, centrally animated brain homepage (listening/thinking/speaking) without breaking existing AYAS functions; no new random homepage cards/controls; sub-tab principle for future features.
4. Standard gates: TypeScript/lint clean (13 inherited warnings known), affected smokes, Graphify refresh after code change, evidence under the canonical Stage area, ordinary commit/push (no force push), verify 0/0 + clean.
5. Stage17 frozen areas (graders/fixtures/pins/historical evidence/raw receipts) remain untouchable.

STOP_BOUNDARY_REACHED: BRAIN_UI_V2_CODEX_HANDOFF
