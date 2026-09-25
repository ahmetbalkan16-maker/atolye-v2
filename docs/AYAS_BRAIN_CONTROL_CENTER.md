# AYAS Brain Control Center (Stage 11)

The owner's single control surface for AYAS, at `/brain`. It answers "is AYAS healthy, is anything
waiting for me, what changed, what stage are we on" without reading files, terminals or daemon logs.
It observes existing systems. It has no store, scheduler or authority of its own.

Code:
- `src/lib/brain/ui/AyasControlCenterModel.ts`: pure, client-safe read model (domains, owner
  attention, activity, capability labels). Only `import type` from other modules.
- `src/lib/brain/ui/AyasControlCenterCollector.ts`: server-only, read-only fact collector.
- `src/components/brain/AyasControlCenter.tsx`: presentational blocks and detail sections.
- `src/lib/ayas/security/AyasSecurityReviewRecord.ts`: the recorded Stage 9 review outcome.
- Wiring: `app/brain/page.tsx` (streamed initial read), `app/brain/observerActions.ts`
  (`refreshAyasControlCenter`), `BrainCoreConsole.tsx` / `BrainConsoleView.tsx` / `brainCore.ts`.

Evaluator: `npx tsx scripts/smoke-ayas-brain-control-center.ts [--baseline]`.

## 1. Architecture

```
/brain (Server Component, behind the access gate)
  ├─ existing loaders (unchanged): snapshot, autonomous loop, approval inbox, micro-batch,
  │  owner recommendations, goals, research engine, self-heal reports
  └─ loadAyasControlCenterFacts()  ── not awaited, streamed to the client as a promise
        health       AyasSelfImprovementHealthCollector + evaluate (M26)
        development  AyasRepositoryStateCollector + recoverAyasRepositoryState (Stage 10)
        graphify     collectAyasGraphifyFacts + evaluateAyasGraphifyState (Stage 10A)
        experiments  AyasResearchExperimentStore read methods (Stage 8)
        memory       AyasMemoryStore.snapshot(), reduced to counts in the collector
        capabilities inventoryAyasCapabilities (Stage 7) + the Ollama provider's own health probe
        security     resolveAccessGate mode + AYAS_LAST_SECURITY_REVIEW (Stage 9)
        atolye       loadAyasProjectCatalog (read-only, runtime-relative paths)
        roadmap      ROADMAP.md "Next roadmap stage" line

client: buildAyasControlCenterView({ server facts, + the views the console already holds })
```

One source of truth per domain. The server collector reads only what the page does not already
load. The approval, micro-batch, recommendation, research, goal, report and autonomous views are
passed to the pure model as they are and are never re-read. The model runs identically on the
server and the client. Its only "now" is the server's `generatedAt`, so hydration is deterministic.

Every source is independent and fail-soft. A failure or an 8 s timeout becomes an `unavailable`
fact with a closed code, while the other domains still render. Concurrent production reads (page
load racing a refresh, two tabs) share one in-flight read. Nothing is cached after it settles.

## 2. Layout and information architecture

Home (stage column, owner attention first):

1. **Kontrol Merkezi:** the overall verdict as text and level, the server read time, and the
   roadmap's next stage.
2. **Sahibin dikkatine:** every ACTION_REQUIRED item, plus other items up to four. The rest sit
   in a "Diğer N madde" disclosure that states their count by level. An ACTION_REQUIRED item is
   never folded.
3. The existing AYAS presence card (voice, mobile, security).
4. **Alanlar:** twelve domain tiles (health, autonomy, approvals, development, Graphify, research,
   experiments, memory, capabilities, security, Atölye, reports). Each tile shows its status in
   words, a summary and how fresh its data is. It opens the matching panel.
5. **Son etkinlik:** the bounded activity feed.

Command Center tabs (the existing tab strip, extended):

| Tab | Stage 11 content |
|---|---|
| Gelişim Merkezi | New "Depo ve geliştirme durumu" section, then the existing approvals, batches and owner recommendations (unchanged controls) |
| Araştırma | Was a "Not connected" placeholder. Now shows the existing goal/research panel (moved from Gelişim Merkezi) and the new "Araştırma → deney hattı" section |
| Memory | New long-term memory counts, then the existing experience-store panel |
| Autonomous | New "Öz-gelişim sağlığı" section, then the existing loop checkpoint |
| Atölye | Was a "Not connected" placeholder labelled "Production". Now read-only inventory |
| Sistem | New: Graphify, model/tool/skill/agent capabilities, security |

The old home status cards were removed. They were snapshot-only and showed a stale "Research:
Not connected / Production: Not connected".

## 3. Owner attention model

Levels: `ACTION_REQUIRED`, `WARNING`, `IN_PROGRESS`, `HEALTHY`, `INFORMATIONAL`. The level is always
printed as text, so colour is never the only signal. Every attention item carries a reason, its
source module, the time of the underlying fact (`null` when the source has none, never the UI clock)
and a classified next action. The overall level is the highest level across domains and items.
`INFORMATIONAL` never raises it.

| Domain | ACTION_REQUIRED | WARNING | IN_PROGRESS |
|---|---|---|---|
| Health (M26 verdict) | DOWN, STALLED | DEGRADED, UNKNOWN, unreadable | — |
| Autonomy | — | observer not running, ERROR/BACKOFF | — (PAUSED_* is informational) |
| Approvals | SAFE, approval-ready proposal; READY_FOR_REVIEW batch; legacy APPROVED awaiting YÜRÜT; RECOVERY_REQUIRED | REVIEW_REQUIRED/FORBIDDEN or incomplete (can only be rejected or deferred); inbox unreadable | executing, revalidating for a new HEAD, owner-approved waiting for the execution flag |
| Development | unmerged/unknown state, diverged, secret-risk paths | behind upstream; state not computable | uncommitted or unpushed work (first unfinished Stage 10 gate) |
| Graphify | — | STALE, MISSING, CONFIG_INVALID, EXTRACTION_FAILED, unreadable | — (PARTIAL, SEMANTIC_PENDING_ONLY, MCP_UNAVAILABLE are informational) |
| Research | goal research awaiting the owner | M26 research findings, uncertain run, unreadable | a run in progress |
| Experiments | — | UNCERTAIN experiment | active experiment |
| Capabilities | — | local model not configured or unreachable | — |
| Security | access gate misconfigured; open blocker/major | access gate disabled (local dev) | — |
| Reports | failed or awaiting-approval reports | — | investigating |

Stale is never actionable. `STALE`, `REVALIDATING_FOR_NEW_HEAD` and `WAITING_OTHER_PUBLICATION`
proposals are shown with "karar verilemez", not as a decision prompt. Development reads "TEMİZ ·
EŞİT" only when the tree is provably clean and in sync. If Stage 10 recovery could not be computed,
it reads "DURUM HESAPLANAMADI" (WARNING).

## 4. Action safety and authority

Every action is one of `READ_ONLY`, `OWNER_APPROVAL`, `SAFE_OPERATION`, `MUTATING_GOVERNED` or
`UNAVAILABLE`. The Control Center itself offers no mutation:

- `OWNER_APPROVAL` items open an existing panel whose own controls hold the authority:
  Gelişim Merkezi (ONAYLA / REDDET / SONRA, ONAYLA VE UYGULA, BATCH ONAYLA VE UYGULA, the owner
  recommendation APPROVE/REJECT), Araştırma (goal catch-up CONFIRM/SKIP/CANCEL) and AYAS Raporları.
  Those controls keep their hash binding and fail-closed server checks. The path is always
  UI → existing owner approval → existing execution gate.
- `SAFE_OPERATION` items show a command for the owner to run (`graphify update …`, the Stage 10
  handoff CLI). The UI never executes it.
- `npm run production:acceptance:readiness` is listed as a governed operator CLI (it writes a
  temporary probe into runtime storage). It is not presented as safe.

The model, collector and UI import no approval, execution, publication or mutation module. The
autonomous-execution flag is mirrored from `AYAS_AUTONOMOUS_EXECUTION_ENABLED` rather than
imported from `AyasAutonomousExecutionGate`, and a test pins the mirror to the original.

## 5. Domain details and sources

- **Health / autonomy:** the M26 verdict and findings (closed vocabulary, English messages),
  observer phase and heartbeat, next research times, the autonomous-execution flag.
- **Approvals:** the inbox view's identity, type (`mutationKind`), source (`discoverySource`),
  safety class and risk, `baseHead`, evidence and Graphify-evidence counts, status, display
  state and the requirement in words. Full proposal IDs are shown, because every live ID starts
  with `ayas-proposal-` and a truncated prefix identifies nothing.
- **Development:** branch, HEAD, upstream and fork point, ahead/behind, change counts and areas,
  recent commits, the known-unsafe test registry (`DO NOT RUN` observer-autostart smoke). While
  work is in progress it also shows Stage 10 recovery (mode, first unfinished gate, Git
  readiness, reason codes). The baseline is `merge-base(HEAD, @{upstream})`. The surface has no
  declared sprint scope (`**`) and no validation evidence, so uncommitted source honestly reports
  the VALIDATION gate. The real remote is not queried on page load. The handoff packet itself is
  generated only by the CLI.
- **Graphify:** classification, structural and semantic status, source / last-analyzed /
  built-from HEAD, `branch.json` update time (labelled "son Graphify güncellemesi", because it is
  metadata time rather than a separate analysis stamp), worktree coverage, node/edge/anomaly
  counts, files with no graph nodes (critical ones marked), CLI/local MCP/remote MCP, and
  repo-level consumers. GRAPH_PARTIAL is never shown as current.
- **Research:** the existing engine view (sources, cadence, PC-off catch-up counts, goal jobs)
  plus M26 research findings.
- **Experiments:** the finding funnel by outcome, hypothesis count, registered strategies and
  benchmarks, and per experiment: hypothesis, target benchmark and dimension, baseline →
  experiment, regression state, verdict, and the linked proposal found by `sourceReference ===
  experimentId`. The production strategy registry is intentionally empty (Stage 8), so the live
  panel shows findings and no experiments. Experiments are non-authoritative.
- **Memory:** total and capacity (`AYAS_MEMORY_MAX_RECORDS`), current vs superseded facts,
  expired, revision, counts by kind and importance, last record time. No title, body or value
  leaves the collector. Retrieval evaluation has no runtime record; it exists only as a smoke
  script, and the panel says so.
- **Capabilities:** Stage 7 inventory with the live Ollama probe. Labels: AVAILABLE,
  UNAVAILABLE, REGISTERED, LOCAL-ONLY, MANUAL-HANDOFF, NOT CONFIGURED. Claude and Codex are
  MANUAL-HANDOFF, because no dispatch adapter exists. Project-local skills read "installed but
  not registered with the AYAS runtime". Tools are folded under a disclosure.
- **Security:** live access-gate mode (the key never crosses the boundary), execution gate,
  autonomous-execution flag, and the recorded Stage 9 review: date, commit, blockers 0,
  unresolved majors 0, and four deferred checks. The review is a record, not a live scan. No
  scanner runs on page load.
- **Atölye:** runtime classification (not the path), project counts, resumable, final videos,
  unreadable `project.json`, status distribution, last update. The panel names what it does
  not measure: production runtime lifecycle, provider/media readiness, and Stage 12 director
  intelligence (not built).

## 6. Recent activity

Durable state transitions only. Included: proposal created / decided / result, micro-batch
opened / terminal status, light and deep research completed, goal research succeeded / failed,
experiment reserved / completed, commits, Graphify metadata updates. Heartbeats and polling never
appear. Items are deduplicated by id and kept only inside a 14-day window. Timestamps more than
5 minutes in the future are dropped. The feed is sorted newest first and capped at 12.

## 7. Freshness

Three separate clocks:
- **Data time (`dataAt`):** heartbeat, Graphify metadata update, last successful research,
  last commit, last memory record and similar.
- **Server read time (`observedAt`, `generatedAt`):** when the server read the source. Views
  loaded by their own loaders carry no server read time (`null`).
- **UI refresh time:** implicit. It is never shown as data freshness.

`ayasCcFormatTime` renders Istanbul time relative to the server read. Scheduled times show
"N sonra" and past times "N önce".

## 8. Refresh and performance

No polling. The Control Center is read on page load (streamed) and on the existing single
"Durumu yenile" click, together with the other existing read-only refreshes. Measured on the owner
workstation (live repo, read-only): full read 0.72–0.79 s; health 225 ms, Graphify 198 ms
(includes parsing the ~32 MB `graph.json`), repository 105 ms, Ollama probe 19 ms, memory 2 ms;
payload about 13.6 KB. Three concurrent reads coalesce into one read (~0.81 s). The pure build
over 200 proposals takes under 50 ms. In a TEMP production build the page reached the Control
Center in about 0.7 s warm and 1.8 s cold. Known cost: the Graphify summary parse is synchronous,
about 0.2 s per read.

## 9. Privacy, auth and trust boundaries

- `/brain` and its Server Actions sit behind `middleware.ts`. With `AYAS_ACCESS_KEY` set,
  unauthenticated GET and Server Action POST get 307 to `/login`, and cross-origin POST gets 403.
  With no key in production the gate is misconfigured and fails closed. There is no separate
  API route.
- Only sanitised, bounded facts cross to the client: no secrets, env values or absolute paths
  (repo-relative files, a runtime classification rather than a path), and no raw memory text.
  Free text passes through `ayasCcText`, which flattens control characters, collapses whitespace
  and truncates. React renders text only and there is no `dangerouslySetInnerHTML`, so research
  or proposal text is displayed, never executed.
- Client components use no fetch, polling or timer. The data path is Server Components plus
  Server Actions.

## 10. Mobile and accessibility

Phone-first (the Command Center column is ≤452 px even on desktop). At ≤640 px the tiles become
one column and action buttons are full-width with at least 44 px height; there is no horizontal
scroll at 390 px and no tables. Headings run h1 AYAS → h2 Kontrol Merkezi → h3 sections. Buttons
have text labels. Disclosures are native `<details>`. The overall verdict is a `role="status"`
region. Keyboard focus shows a 2 px ring. Loading states are `role="status"` with `aria-busy`,
and read failures are `role="alert"`. The Brain UI is dark-only by existing design.

## 11. States every panel handles

Loading (Suspense fallback), no data (`absent` → "VERİ YOK"), unavailable/timeout (code shown),
partial (per-source failure, the rest still renders), server read missing entirely ("Kontrol
merkezi sunucu okuması başarısız"), permission denied (gate redirect before render), stale
(Graphify/approval display states) and error (closed codes only).

## 12. Evaluation

`scripts/smoke-ayas-brain-control-center.ts`: 21 primary, 13 held-out and 4 TEMP-integration
scenarios. They cover healthy, degraded and partial Graphify, pending and stale approvals,
interrupted, behind and diverged development, research running, completed experiments, an
unavailable model, security deferred checks, no data, partial outage, unauthorized access,
secrets, raw memory, action authority, no mutation, mobile, freshness and activity filtering. The
clean `ae47309` baseline scored primary 1 PASS / 1 FAIL / 19 MISSING. The FAIL is a real baseline
defect: the home screen showed "Research / Production: Not connected" after Stage 8. Final: 21/21,
13/13, 4/4. Details are in `ATOLYE_CHECKPOINT.md`.

## 13. Limitations and findings

- The production runtime lifecycle is not shown. In the live Turbopack build,
  `app/api/runtime/health` carries its own inlined copy of `ProductionRuntimeCompositionRoot`,
  separate from the module `instrumentation.ts` initializes. A page reading
  `getProductionRuntimeStatus()` would therefore likely report a never-initialized runtime. This
  is based on bundle evidence and was not verified live, because the endpoint is auth-gated. The
  pre-existing `/api/runtime/health` is left unchanged for an owner decision.
- Provider and media readiness is not measured on page load, because
  `ProductionReadinessService.evaluate()` writes probe files and spawns ffmpeg.
- The security review is a static record. Update `AYAS_LAST_SECURITY_REVIEW` together with the
  security doc; the evaluator pins them.
- Health finding messages are English (M26 closed vocabulary).
- `collectAyasRepositoryState` hashes dirty files (≤2 MB each) for its state fingerprint. A very
  large untracked tree makes reads slower.
- The orb state is unchanged (`deriveBrainCoreState`). The attention level does not recolour it.
