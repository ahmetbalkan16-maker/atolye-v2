# Current — 2026-10-08 / local-model fallback fixed in source (not deployed); voice FROZEN_BY_OWNER; Foundation BLOCKED
Claude continuation V4 started from clean `462f9f7` (origin 0/0, no live Codex process). Graphify was already at HEAD: structural PARTIAL 9, semantic PENDING.

**Local model.** Ollama was reachable throughout. The "Yerel modele ulaşılamadı" + "Anladım." screen had two causes (F95):
- A context-quality guard rejected the model's greeting reply whenever the conversation had history.
- The chat note labelled every fallback as "model unreachable".

Bounded source fix plus a new suite, `scripts/smoke-ayas-reply-fallback-truth.ts` (11 scenarios; it fails on the unfixed code). Isolated real-model probe: 15/15 model replies after the fix versus 2/9 before. Overlay full166: 162 PASS. The three preserved raw FAILs are unchanged. `action-firewall-closure` already fails at clean HEAD since the homepage commit `4ca7e66` (F96: pinned grader, owner approval needed for a v58 pin refresh). **Not deployed:** the live server still runs the previous build; rollout needs an owner-approved restart window. Small-model reply quality (F97) remains open. Evidence: `docs/ayas-runtime-recovery/2026-10-08/LOCAL_MODEL_FALLBACK.md`.

**Brain UI V2.** The working UI is preserved: no redesign and no homepage, layout or command-wiring change. Only the existing note text is now truthful.

**Voice: FROZEN_BY_OWNER.** No cloning, Chatterbox, model downloads, training or CALM/PROFESSIONAL/INTELLIGENT work. The existing assistant voice, Piper and browser TTS are untouched.

**Stage17/Foundation: BLOCKED.** Next is the opt-in combined protected-scope packet.

# Current owner order — 2026-10-08 / voice development indefinitely frozen
Owner indefinitely froze personal cloning and CALM/PROFESSIONAL/INTELLIGENT development. Do not resume generation, downloads, training, ASR/model optimization or paid API requests from previous voice orders. Latest Chatterbox trial stopped; only its verified private root and new untracked prototype removed (5,862,758,182 logical bytes, approximately 5.86 GB). Audio-free technical evidence retained privately outside Git; original owner recording/hash and all Program/Ses files preserved. Prior V2 model/env/samples preserved: automatic review rejected prior weight deletion outside inspection scope. Shared caches/global Python/CUDA/drivers/Piper/browser TTS/runtime/tunnel/tasks untouched.

Cleanup report: docs/ayas-voice-freeze/2026-10-08/CLEANUP_RESULT.md and SAFE_METADATA.json. TS PASS, lint 0 errors/13 inherited warnings; 406 existing regression checks PASS, v57 323 references/214 files unchanged. Local/public health PASS; same runtime PIDs, build, task XML/config hashes. Physical playback/phone/reboot NOT_RUN. Production source, frozen tests and canonical evidence unchanged. Graphify-first completed; structural PARTIAL9/semantic PENDING retained; final exact-HEAD graph and clean/origin equality resolve from Git and local final receipt.

Master Plan returned to Stage17/Foundation: actual read-only protected-hash audit at a60b3cf BLOCKED / PROTECTED_SCOPE_INCOMPLETE (local 6,580 files unchanged; external runtime unqualified; collector-bound acceptance 0/166). Four technical / six owner gaps remain. Next bounded source packet: opt-in combined protected inventory/attribution, then canonical collector bindings; no implementation or gate closure claimed in this cleanup session. Known installed Next16.2.10 versus locked16.3.8 persists; migrate only in coordinated restart window. Frozen retrieval succession and real owner evidence remain required. WakeV3 final study BLOCKED/closed. BrainUIV2/homepage STOP; no live voice/default/publication or homepage changes authorized. Save WIP commit/push; do not restart completed cleanup or frozen voice experiments.
# Current — 2026-10-08 / local male V2 review STOP; API forbidden

Owner explicitly requires local/open TTS only; never request paid API keys or resume API voices. Completed isolated Pocket Turkish male_1/male_3/male_2 preparation: three private owner WAVs and51 audio/19 local ASR/3 cancel probes, no runtime changes. Names CALM/PROFESSIONAL/INTELLIGENT are review labels, not approved subjective traits. CC-BY4 model/upstream, Apache2 wrapper/MIT runtime verified; synthetic teacher rights chain not fully public, quality/name/numeric/question and long-output clipping issues pending. No commercial-production acceptance. Preserve raw FAILs, reference, metadata hashes; no unlimited reruns. Report docs/ayas-male-voice-persona/2026-10-08/V2_LOCAL_RESULT.md. STOP for owner review, separate live approval plus rights/quality/WakePASS gates still mandatory. WakeV3 final study BLOCKED/closed; Stage17/FoundationBLOCKED and BrainUIV2/homepage STOP unchanged. Preserve browser voice/Piper/PWA/tunnel/tasks/frozen pins.

# Prior — 2026-10-08 / bounded Wake V3 BLOCKED; isolated male evaluation tested

Final mel study closed at fixed10 epochs: actual WASM120/122 acoustic,227/244 held-out,372/384 overlapping-source Tolga audit,59/60 new speech; numeric parityPASS only. No failed model or male voice promoted, no additional same-method search. Isolated20 Turkish Piper outputs tested; owner quality/device acceptance and unrestricted production license remain pending. DFKI CC-BY-NC-SA restriction verified; existing browser TTS/profile and Piper narration preserved. Details docs/ayas-wake-policy-v3/2026-10-07/FINAL_BLOCKED.md and docs/ayas-male-voice-persona/2026-10-08/PREPARATION.md. Stage17/FoundationBLOCKED, phoneNOT_RUN; Graphify structuralPARTIAL9/semanticPENDING. New homepage/BrainUIV2 design is an explicit STOP boundary under latest owner order; previous runtime UI/PWA/tunnel/tasks/frozen history untouched. Session save commit/push authorized; finalHEAD fromGit.

# Owner wake policy V3 — 2026-10-07 continuation

Latest explicit owner decision: exact AYAS/AYAZ/HAYAS are all valid wake names, case-insensitive. V1/V2 historical negative and classifier FAIL evidence is immutable; V2 archive commit41af9ee is pushed. Stop HAYAS-discrimination research. V3 exact production text binding is implemented and71 scenarios pass, but original acoustic model still fails AYAZ stochastic reliability and genuine remaining negatives; no rollout/male-persona Phase B before all Phase A gates PASS plus push and healthy canonical deployment. Preserve warm-up/catch-up/reset/epoch/single-flight/threshold/cooldown/pre-roll gains, Brain UI/PWA/tunnel/tasks/frozen Stage17 and Foundation BLOCKED. Current evidence docs/ayas-wake-policy-v3/2026-10-07. No real-phone acceptance claimed.

# Current — 2026-10-07 / full owner UI V2 deployed; authenticated/phone owner acceptance pending; Foundation BLOCKED

Canonical Access daemon deployed CLEAN 59e585ab4ac9acfcaedeaebf75099568c28512f3. All17 page routes retain V2 HOME or use shared V2 subpage appearance; /brain eleven panels and /studio/project actions preserved; no legacy owner orb, constant-ready badge or broken sidebar targets.24 suites/587 scenarios, TypeScript/lint0errors13inheritedwarnings, isolated and canonical production builds PASS. Local/public52 route responses+30 PWA/JS/CSS assets match expected gates and disk SHA; manifest200 start_url=/ scope=/ id=/brain. Single origin19960; same tunnel30200/supervisor2496/observer31556 and both Running tasks/config hashes. Readiness200/recoveryhealthy/runtimeerrlog0. No credentials, dependency migration or frozen evidence edits;323/323 pins match.105 inherited tracing warnings/middleware deprecation; installed16.2.10 vslock16.3.8 OPEN. 320/390 portrait,844landscape,1024/1366/1920 layouts measured with no document overflow in isolated fixture; public helper/login V2 render verified. Authenticated protected page visual/real phone wake,TTS,interrupt,continuity remain OWNER_ACTION_NOT_RUN. HOME autonomous protection expanded to shared workspace; new features must stay on topic subpages. Evidence: docs/ayas-execution/2026-09-27-master/07_BRAIN_UI_V2/owner-ui/OWNER_UI_V2_RESULT.md and rollout.json. Following documentation-only save is runtime-source-identical; final Graphify exact HEAD/integrity saved locally after that commit, inherited PARTIAL9/semanticPENDING disclosed. Foundation BLOCKED.

# Historical snapshot — 2026-10-07 / PWA homepage launch deployed; installed-device owner check pending; Foundation BLOCKED

Canonical Access daemon deployed CLEAN a4c807b. Local/public manifest200: start_url=/, scope=/, stable id=/brain. Worker manifest network-first; online homepage and legacy /brain unchanged; both launch entries retain offline lab fallback.145 focused scenarios, TypeScript/lint (0 errors/13 inherited warnings), build/diff PASS. Canonical Next16.2.10 build has105 tracing warnings plus middleware deprecation; installed/lock16.3.8 mismatch remains OPEN. Single origin10192; same tunnel30200, supervisor2496, observer31556; both tasks Running with identical XML hashes, tunnel config identical; readiness200.38 route/PWA asset responses plus12 homepage JS/CSS responses match expectations; new public bundle/responsive CSS hashes match deployed build. Protected pages307 and APIs401 preserved; no credentials used. Phone installed-launch/real voice remain OWNER_ACTION_NOT_RUN. Existing installed PWA may retain old start_url until manifest update; close/reopen or reinstall from https://ayas.atolyeayas.com/ if necessary; no blanket site-data purge. Foundation BLOCKED; frozen Stage17 graders/fixtures/pins/evidence unchanged,323/323 v57 pin references match. Evidence: docs/ayas-execution/2026-09-27-master/07_BRAIN_UI_V2/pwa-start-url/PWA_START_URL_2026-10-07.md. Final session HEAD is the following documentation save; deployed source remains a4c807b. Final Graphify HEAD/integrity recorded locally after that save; inherited PARTIAL9/semanticPENDING remain disclosed.

# Historical snapshot — 2026-10-07 / Brain UI V2 live rollout complete; phone owner validation pending; Foundation BLOCKED

Canonical Access daemon rebuilt CLEAN d931a18 and restarted the single localhost:3000 origin from old34ecb66/PID3416 to PID11472. Existing cloudflared30200, Access supervisor2496, observer31556 and both Running scheduled tasks are preserved; task XML and tunnel config hashes unchanged. Local/public login200, protected pages307, health/chat APIs401, cloudflared readiness200. Twelve public/local homepage JS/CSS responses200 match actual deployed build hashes. No credentials used for probes; authenticated homepage/image/chat/voice/device UI remains owner qualification. Source/features/ports/domain/tunnel/task configuration unchanged.85 relevant scenarios PASS; actual Next16.2.10 canonical build and its TypeScript PASS (104 tracing warnings plus middleware deprecation); installed16.2.10/lock16.3.8 mismatch remains OPEN.

Phone next: open https://ayas.atolyeayas.com/ directly; existing PWA starts /brain?source=pwa and intentionally opens the full detail console. Reload an already-open tab; only classify cache if the exact / route remains old after reload while new server artifacts are proven. Owner manual checks: homepage, menus, listening, thinking, speaking, wake/TTS/interrupt/continuity, responsive/horizontal overflow. Real phone tests NOT_RUN. Foundation BLOCKED and all frozen Stage17 evidence unchanged. Evidence: docs/ayas-execution/2026-09-27-master/07_BRAIN_UI_V2/rollout/BRAIN_UI_V2_ROLLOUT_2026-10-07.md and JSON. Deployed source d931a18; following session-save commit changes documentation only; resolve final HEAD/origin status from Git.

# Historical snapshot — 2026-10-07 / Brain UI V2 implemented; isolated validation PASS; Foundation BLOCKED

Implementation source: 4ca7e66c9070d41dd727477a710c736ced59acf9; the final evidence-only save follows this source. Owner's final visual supersedes previous alternatives. Homepage now has the central cyan/gold brain, fixed navigation/dock, real status rail and existing streaming chat/voice/tasks. Existing detail console stays at /brain; original production dashboard/pipeline at /studio. Explicit owner homepage instruction is required for all future homepage changes; BrainPatchSafety prevents automatic patches to its protected surfaces and policy.

TypeScript PASS, lint 0 errors/13 inherited warnings; 13 relevant suites/309 scenarios PASS including 11 new homepage cases. Standard Next16.3.8 lock-based isolated build PASS. Five browser sizes (1920x1080,1440x900,1366x768,1024x768,390x844) and 320px check show no horizontal overflow; 1920 fits one screen, smaller screens scroll vertically. Tasks, text draft/reducer, keyboard focus and Memory deep link verified. Screenshots are from an isolated loopback candidate with synthetic Git identity, not authenticated owner runtime. No actual microphone permission, physical phone speech/barge-in, deploy/restart or installed-lock migration performed. Running installed Next16.2.10 vs lock16.3.8 remains OPEN.

Foundation remains BLOCKED. Frozen Stage17 graders/fixtures/pins/raw receipts unchanged; historical fde898f full166163PASS/3FAIL remains historical and is not rebound to this changed source. No new all166 or Foundation-closure claim. Graphify must be refreshed at session-end HEAD; existing structural PARTIAL9/semantic PENDING remains disclosed. Current evidence: docs/ayas-execution/2026-09-27-master/07_BRAIN_UI_V2/implementation/BRAIN_UI_V2_RESULT.md. Resolve final Git HEAD and origin status after the session-save commits.

Next: coordinate runtime deployment/dependency alignment through the existing Stage17 process, then verify authenticated desktop and real phone voice continuity. Homepage implementation is complete; live owner validation remains NOT_RUN. Preserve all existing Foundation blockers.

# Historical snapshot — 2026-10-07 / fde898f v57 full166163PASS /3 preserved raw FAIL;Foundation BLOCKED

Approved occupancy barrier passes12 scenarios/45 unchanged controls on new source;v56 archive/two affected pins only. Original34ecb66 162/4 preserved. Fresh TS/lint PASS (13 inherited warnings), hosted named CI and local/hosted boundedCF49 PASS. Four historical SHA findings resolved by original canonical algorithm without frozen-field edits. Phone owner-confirmed/login200/single healthy origin-tunnel; authenticated runtime/real reboot unqualified. Actual backup inventory/manifest PASS only, no restore.15 domains/152criteria/30TEST-LIVE still not qualified; combined protection/real platform-device/final owner review open. Homepage NOT_STARTED,boundary NOT_REACHED. Exact evidence and remaining work: ATOLYE_CHECKPOINT.md and docs/ayas-execution/2026-09-27-master/05_STAGE17/implementation/STAGE17_CURRENT_RESULT.md.

# Historical snapshot — 2026-10-07 /approved occupancy synchronization correction;v57;clean-source qualification pending

Owner approved one frozen grader synchronization fix and versioned pins. Both2-record/results/peak assertions remain; v56 archived, only two references to the changed grader updated. Candidate12 scenarios/45 mutants/10 governance/TS/lintPASS (13 inherited warnings). Original34ecb66 full166162PASS4rawFAIL preserved. Next exact-new-HEAD credential-free full166 after commit/Graphify. FoundationBLOCKED; no homepage. See ATOLYE_CHECKPOINT.md.

# Historical snapshot — 2026-10-07 /phone reachable;exact34ecb66 full166162PASS4FAIL;FoundationBLOCKED

Fresh-lock166/166 complete at34ecb66(v56):162PASS/4rawFAIL; release-provenance regressions repaired. Frozen retrieval/Golden3 stops retained; additional frozen occupancy50ms timing race root-caused, unchanged45-control replayPASS, proposed barrier correction requires explicit owner exception and remains unapplied. Phone login owner-confirmed/HTTP200/single canonical origin-tunnel, task definitions unchanged; auth identity and real reboot unqualified. Local protected hashes complete/unchanged, separate external scans do not bind global scope;15domains/152criteria/30TEST-LIVE NOT_RUN. LemonUNBOUND/FiverrOWNER_REPORTED_ONLY/final owner reviewNOT_READY. No homepage boundary or implementation. Resolve final Git HEAD; tested-source receipts are not rebound to docs commits. Current evidence and exact next step: ATOLYE_CHECKPOINT.md and05_STAGE17/implementation/STAGE17_CURRENT_RESULT.md.

# Historical snapshot — 2026-10-07 /release-provenance repair;EOD evidence preserved;Foundation BLOCKED

HEAD36e794f full166 TEMP-clone receipt preserved canonically:166 suites,161 PASS,5 FAIL. Three fails are the known frozen limitations; the two release-provenance fails were root-caused to the0c325e1 lockfile regeneration and repaired bounded at AyasSbom.ts: install-script pins re-recorded at the re-read workerd1.20261001.1/onnxruntime-node1.30.0 (sharp pin dropped —0.35.5 declares no script), and bundled lockfile children are vouched only by a fully vouched bundling parent, disclosed as REVIEW, never standalone components; all other BLOCK behavior unchanged. Suites: provenance19 PASS, mutations34/34, governance10+8/8, firewall closure12, lint0/13 inherited. Manifestv55 archived and bumped tov56 (two suite pins only;323/323 verified). EOD cleanup:57,572 untracked files classified; durable evidence kept under05_STAGE17/implementation; temp clones/snapshots removed; opencode.json (live API key) ignored, never committed. tsc sharp error proven pre-existing (stale main node_modules vs locked0.35.5; clean under npm ci). Next: credential-free TEMP-clone full166 rerun at the new HEAD with matching lock, then actual protected/domain/live findings and owner-review prerequisites. Stage17/Foundation BLOCKED; homepage NOT_STARTED, boundary NOT_REACHED.

# Historical snapshot — 2026-10-05 /Lemon Stage16.8 re-audit verified; Foundation BLOCKED

Existing canonical five-file Lemon adapter confirmed, first commit53180cb (2026-10-03), source/frozen Lemon tests unchanged. Exact sourceb35cd634ce9e11f44d1666248cc585649fe8f509:9 selected suites PASS_WITH_KNOWN_LIMITATIONS, TS/focused lint/governance PASS; all214 pins/v55/166 declared unchanged, full baseline NOT_RUN. CF49 raw54/55 held4/5 remains open. Owner TEST store/credential creation remains OWNER_REPORTED; real connector/ingress/durable dedupe/production journal-store qualification UNBOUND/NOT_RUN/OWNER ACTION after Foundation. No secret/account/activation/financial write. Evidence: docs/ayas-execution/2026-09-27-master/04_STAGE16_REVENUE/implementation/16.8/16.8_CURRENT_HEAD_REAUDIT.json.

Resume exact infinity preparation:20 admission cases frozen only; implementation NOT_STARTED, persistent activation OFF. Stage17/Foundation BLOCKED; no homepage/Brain UI V2 work. Mandatory owner stop before design remains in force. Current Git HEAD may be a later documentation/session-save commit; resolve Git rather than promoting the tested-source hash to final HEAD.

# Historical snapshot —2026-10-05 /Stage17 framework verified; infinity preparation active

71b53b94654453223b7ca9d51750047f5ac49fc7:151 primary+30 frozen held+30 adversarial+9 independent controls;9 selected exact suites PASS_WITH_KNOWN_LIMITATIONS,214 pins/v55/166 declared,full baseline NOT_RUN. Current read-only audit BLOCKED: CF49 raw54/55 held4/5, complete protected scope and live/owner domain qualification missing. Measured fixed-root digest unchanged; external/private scope not presumed covered. Lemon/Fiverr owner setup reported; integration/ingress/orders/ledger/terms remain UNBOUND/NOT_RUN. Stage16/Master/Foundation OPEN. Next permitted infinity preparation only, persistent activation OFF; mandatory STOP before homepage/Brain UI V2 design.

# Historical snapshot — 2026-10-05 /16.14 source framework verified;17 active

Fiverr owner evidence2026-10-05: account/identity/Gig OWNER_REPORTED_ACTIVE/VERIFIED/ACTIVE; startup spend OWNER_REPORTED $0. Orders/fulfillment/ledger/terms/E2E NOT_RUN; AYAS and official API/OAuth/tool binding UNBOUND; automated writes CLOSED. Inbound messages are not revenue proof.

16.14 source c26075774762b54de1dc0a3f69c45f7de7a6b41b:131 primary,25 frozen held-out,25 adversarial and14 independent controls;62 selected canonical regressions PASS_WITH_KNOWN_LIMITATIONS, Stage9 additional4/4.208 pins unchanged/v54/163 declared; full baseline NOT_RUN. CF49 raw quality gap remains visible. Graphify current with385 communities/integrity0,PARTIAL9/semanticPENDING. Lemon store/test credential creation OWNER_REPORTED in TEST MODE; connection/ingress/journal/live activation UNBOUND/NOT_RUN/OWNER-GATED. Stage16/Master OPEN. Next Stage17 read-only framework/current audit and permitted infinity preparation; mandatory STOP before homepage/Brain UI V2 design. No persistent activation.

# Historical snapshot —2026-10-05 /16.13 framework verified;16.14 active

16.13 framework verified at a625b7e24a27bf78ad3c2413f1b33529f4e58a6f:73 primary+20 frozen held-out+13 independent controls;19 selected exact-source PASS,203 pins/v53/160 declared (full baseline NOT_RUN),TS/lint/diff PASS with13 inherited warnings. Graphify source current/379 communities/integrity0;PARTIAL9/semanticPENDING. Actual owner/account/pilot/scaling qualification UNBOUND/NOT_RUN; Stage16/Master OPEN. Next16.14 Revenue Center closure and deferred qualification debts. Then17 current-HEAD audit and permitted infinity preparation; mandatory STOP before homepage/Brain UI V2 design; no persistent activation.

# Historical snapshot —2026-10-05 /16.12 recovery;16.13 active

16.12 recovered and framework verified at ce160ed: primary112/112+held-out31/31 rechecked,198 pins unchanged. Current task16.13 Profit-Gated Scaling; prior stop revoked by direct owner continuation2026-10-05. Real account/pilot/platform/store qualification stays UNBOUND/NOT_RUN; Stage16/MasterOPEN. Graphify metadata HEAD matched but six dirty documentation paths required refresh; inheritedPARTIAL9/semanticPENDING remain. No restart, reset, clean, stash or live action.

# Historical snapshot —2026-10-04 /16.12 framework verified;STOPPED AS REQUESTED

16.12 framework verified at ce160ed18fcb2979054a65aaae2d921e0587c5d1:112 primary+31 held-out+31 independent controls;40 selected exact-source PASS,198 committed pins/157 v52 declared (full baseline NOT_RUN),TS/lint/diff PASS with13 inherited warnings. Graphify current/full382 communities/integrity0;structuralPARTIAL9/semanticPENDING. Store append history/CAS/SAFE, negative revisions/refunds, realized ledger economics and manual handoff/no executor verified;F86 nonpassive realized cost early-stop repaired/source verified. Actual authenticated owner/pilot/platform/store/journal qualification UNBOUND/NOT_RUN;Stage16/MasterOPEN. Latest owner instruction2026-10-04:16.12 bitince dur. STATUS STOPPED_AS_REQUESTED after16.12;16.13 and homepage implementation NOT_STARTED;await owner. Session-end recording uses ordinary commit/push/parity and current Graphify only; no subsequent Stage implementation is authorized.

# Historical snapshot —2026-10-04 /16.12 framework verified; exact source matrix pending

16.12 bounded pilot framework focused verified:112 primary+31 held-out (original20 preserved)+31 independent assertion-caught controls; explicit-root TEMP append history/CAS/SAFE/corruption/replay, immutable window/metric, negative evidence retained across revisions, full16MiB realized ledger/per currency/global reversals/later fees/refunds, manual owner handoff/no executor. TS/lint/diff/pins/governance/protection/security/compliance/free-first PASS;198 pins/157 v52 declared suites, full baseline NOT_RUN. Owner/authenticated source, production store/journal and actual pilot actions UNBOUND/NOT_RUN. Exact source matrix/full Graphify pending. Homepage NOT_STARTED;STOP before redesign.

# Historical snapshot —2026-10-04 /16.12 framework verified; exact source matrix pending

16.12 bounded pilot framework focused verified:112 primary+31 held-out (original20 preserved)+30 independent assertion-caught controls; explicit-root TEMP append history/CAS/SAFE/corruption/replay, immutable window/metric, negative evidence retained across revisions, full16MiB realized ledger/per currency/global reversals/later fees/refunds, manual owner handoff/no executor. TS/lint/diff/pins/governance/protection/security/compliance/free-first PASS;198 pins/157 v52 declared suites, full baseline NOT_RUN. Owner/authenticated source, production store/journal and actual pilot actions UNBOUND/NOT_RUN. Exact source matrix/full Graphify pending. Homepage NOT_STARTED;STOP before redesign.

# Historical snapshot —2026-10-04 /16.12 framework verified; exact source matrix pending

16.12 bounded pilot framework focused verified:112 primary+30 held-out (original20 preserved)+29 independent assertion-caught controls; explicit-root TEMP append history/CAS/SAFE/corruption/replay, immutable window/metric, negative evidence retained across revisions, full16MiB realized ledger/per currency/global reversals/later fees/refunds, manual owner handoff/no executor. TS/lint/diff/pins/governance/protection/security/compliance/free-first PASS;198 pins/157 v52 declared suites, full baseline NOT_RUN. Owner/authenticated source, production store/journal and actual pilot actions UNBOUND/NOT_RUN. Exact source matrix/full Graphify pending. Homepage NOT_STARTED;STOP before redesign.

# Historical snapshot —2026-10-04 /16.12 model packet verified;store/economics/handoff pending;STOP before Homepage Redesign

16.12 model/owner/admission packet verified:61 primary+20 frozen held-out+15 assertion-caught controls;TS/changed and whole lint/diff,governance/protection/security/spend/free-first PASS;193 old pins unchanged, new pilot graders NOT_REGISTERED until fullstage. Wholelint13 inherited warnings. Graphify quickcurrent/integrity0,PARTIAL9/semanticPENDING,clusteringSKIPPED—not finalstageGraphPASS. Durable store/economics/handoff and fullstage/exact-source qualification pending. No real pilot/platform action,approval authority or homepage change.

# Historical snapshot —2026-10-04 /16.11A framework verified;16.12 active; mandatory stop before Homepage Redesign

16.11A framework verified at adae61647d79dc3fde26e883c0c20b2420dd5ba8:62 primary+20 frozen adversarial+16 assertion-caught controls;37 selected exact-source PASS;193 committed pins/v51 (full baseline NOT_RUN),TS/lint/diff PASS with13 inherited warnings. Graphify current/full373 communities/integrity0,structuralPARTIAL9/semanticPENDING. Actual owner/professional/account/platform permission and current terms reader remainUNBOUND; Fiverr/Udemy full terms body unqualified. No legal conclusion/activation/spend/write. Stage16/MasterOPEN;next16.12 bounded pilot FRAMEWORK_ONLY. Latest owner instruction2026-10-04:continue canonical order but STOP before Homepage/BrainUIV2 redesign; homepage changes/controls/avatar/animations NOT_STARTED; later certifications outside current continuation.

# Historical snapshot —2026-10-03 /16.11A exact-source verification pending

16.11A focused framework verified:62 primary/20 frozen held-out/16 independent assertion-caught controls; TypeScript, changed/whole lint (0 errors,13 inherited warnings), diff, governance, exact patch safety and revenue security PASS. v51:154 declared suites/193 pins; full baseline NOT_RUN. F85 proxy preflight repaired. Actual review/permission/account qualification UNBOUND. Source commit, exact-source selected matrix and final clustered Graphify pending; Stage16/Master OPEN.

# Historical snapshot —2026-10-03 /16.11 framework verified with limitations;16.11A active

16.11 exact-source framework verified at 74b6c495813bbce9f6b405dc11f628900da99261:105 primary+20 frozen adversarial+17 assertion-caught controls;53 selected (52 plainPASS, cognitive CF49 known limitation),13 extra including Stage9 isolated/security PASS;188 committed pins,TS/lint/diff PASS (13 inherited warnings). Fullv50 NOT_RUN. Graphify current/integrity0/full clustering, structuralPARTIAL9/semanticPENDING. Historical metadata doc-stale checkpoint orchestration gap explicit; not retroactive Graphify-first PASS. No actual owner/platform qualification, production attachment/account-reader, webhook durable ingress/dedupe/ACK or write journal/executor. Stage16/Master OPEN; next16.11A terms/compliance.

# Historical snapshot —2026-10-03 /16.11 focused security verified; exact source checks pending

16.11 source implemented;105 primary+20 frozen adversarial+17 independent assertion-caught controls PASS. TS/changedlint/wholelint/diff PASS (13 inherited warnings). v50/151 suites/188 pins; full baseline NOT_RUN. F84 closed owner-requirement metadata false-positive fixed with P105, strict instruction/unknown-link rejection contracts preserved. Exact clean-source matrix and full clustered Graphify pending; no16.11A advancement. No actual owner auth, production attachment/account/HTTP webhook/journal qualification. One governance-metadata checkpoint step rejected a doc-only stale graph, but the following edit in the same orchestration cell was not stopped. Relevant code dependency context was already captured; subsequent refresh/current integrity checks and AST audit recover source truth. This historical process gap is recorded, not retroactively declared a Graphify-first PASS.

# Historical snapshot —2026-10-03 /16.10 framework verified with limitations;16.11 active

16.10 exact-source framework verified at 7195e96d1ae8345fb554391bc256012653a9ae5b: memory65+15/intelligence32+8/15 controls,183 committed pins, TS/lint/diff PASS (13 inherited warnings).46 selected:45 plainPASS and cognitive54/55+4/5 held-out PASS_WITH_KNOWN_LIMITATIONS(CF49);7 extra including chat-stream PASS. Fullv49 NOT_RUN. Graphify current/integrity0, structuralPARTIAL9/semanticPENDING. F82 stale-plan warning repaired; manifest kind corrected without validator changes. Ledger remains sole money truth; no production writer/HTTP snapshot binding or actual owner authentication. Stage16/Master OPEN; next16.11 security/fraud.

# Historical snapshot —2026-10-03 /16.10 source implemented; exact validation pending

16.10 dedicated business memory/source implemented: memory65+15 (includes actual captured chat prompt), intelligence32+8,15 assertion-caught controls; defaults unchanged, no writer/HTTP binding. F82 stale current plan masked by fresh ledger reproduced and fixed. Static/Graphify worktree checks PASS with inherited PARTIAL9/semanticPENDING; v49:148 suites/183 pins, full baseline NOT_RUN. Clean exact-source matrix/full clustered Graphify pending; no16.11 advancement.

# Historical snapshot —2026-10-03 /16.9 framework verified;16.10 active

16.9 framework exact-source verified at eee322cb8693a2fd8980d0c4a1d62ea924b17659:64+12/40 controls; adapter55+10/77 controls;35 selected+6 extra TEMP regressions;179 committed pins; TS/lint/diff PASS. F80 production digest isolation andF81 AST import grader repaired without broadening allowlists or weakening privacy/action gates. Graphify current/integrity0;PARTIAL9/semanticPENDING. Fullv48 NOT_RUN. Source policy disabled/0/emptycaps; no actual owner-reviewed source binding, financial authority, reservation or executor. Stage16/Master OPEN; next16.10.

# Historical snapshot —2026-10-03 /16.9 source implemented; exact validation pending

16.9 pure realized-ledger reinvestment advice implemented:63+12 and40/40 controls PASS; defaults disabled/0/emptycaps; exact-source closure pending. F77 expiry reproduced/fixed, F78 fixture false-positive isolated without scanner change, F79 independent prior-loss probe. No money/approval/reservation/executor or actual source-policy binding. v48:145 suites/179 pins; full baseline NOT_RUN.

# Historical snapshot —2026-10-03 /16.8 framework verified;16.9 active

Exact 8b55182062fd00576ffed6ecec1c2f3030c351c2: Lemon89+15/60 caught controls,33 selected+6 extra TEMP regressions,176 committed pins and TS/changed lint/diff PASS. Graphify18559/53182 current, integrity0;PARTIAL9/semanticPENDING retained. Fullv47 NOT_RUN. Owner Test-mode/durable ingress and16.5/16.7 qualification remain deferred; Stage16/Master OPEN. Next16.9 pure advisory reinvestment; no live effect, financial authority or production registration.

# Historical snapshot —2026-10-03 /16.8 source implemented; exact validation pending

Lemon Squeezy89+15 scenarios/60 assertion-caught controls PASS; TS/changed lint0/0, whole lint0 errors/13 inherited warnings. Manifestv47:143 suites/176 pins; fullbaseline NOT_RUN. Official GET/parent/mode, raw HMAC pointer→common-gated canonical refresh, inert ledger and local plans; all writes/money CLOSED. Actual owner Test-mode key/connection and durable HTTP ingress remain pending after foundation; no production binding. Carry16.5 official tool qualification and16.7 route gaps; Stage16/Master OPEN. Next33+6 exact-source regressions/Graphify, then independent16.9 in order. SeeACTIVE_CHECKPOINT.json.

# Historical snapshot — 2026-10-03 /16.7 framework verified;16.8 active

Exact source e634a73: course57+12/Udemy53+12,56 controls,31 selected+6 extra regressions and173 committed pins PASS. Graphify18498/52948 current, integrity clean; inheritedPARTIAL9/semanticPENDING. Fullv46 NOT_RUN. Udemy reviews/Q&A/individual-message route qualification remains pending;16.7 stageClosed=false.16.5 official tool qualification also pending. Independent16.8 Lemon Squeezy source proceeds in order. No live account, publication, send, money, provider/job or registration. Stage16/Master OPEN. Evidence:implementation/16.7/16.7_EXACT_SOURCE_RECEIPT.json; exact next ACTIVE_CHECKPOINT.json.

# Historical snapshot —2026-10-03 /16.7 source implemented; exact validation pending

Course57+12/Udemy53+12 and56 assertion-caught controls PASS; TS/changed lint0 errors, full lint0 errors/13 inherited warnings. Manifestv46:141 suites/173 pins; fullbaseline NOT_RUN. Two captured official GET routes, other review/Q&A/individual-message routes unqualified; Stage16.7 not fully closed. Coarse token policy source default closed; global scoped gate unchanged. No live account, provider/job, publication, send, money or registration. Stage16.5 qualification remains pending; Stage16/Master OPEN. Next31+6 exact-source regressions/Graphify/receipt, then independent16.8 in order. SeeACTIVE_CHECKPOINT.json.

# Historical snapshot — 2026-10-03 /16.6 source closed;16.7 active

Exact source f7a5188:52+12 scenarios;48 controls (46 caught,2 verified equivalents);23 selected+6 extra exact-source regressions,168 committed pins,TS/lint/diff PASS. Graphify18422/52712 current/integrity clean; inheritedPARTIAL9/semanticPENDING. Fullv45 baseline NOT_RUN; last completev38/5cbb217. Manual drafts/owner-reported imports only; no external effect or live certification.16.5 official qualification remains pending; Stage16/Master OPEN. Next16.7 Udemy/Atolye, Graphify-first and official scope limitations. SeeACTIVE_CHECKPOINT.json andimplementation/16.6/16.6_EXACT_SOURCE_RECEIPT.json.

---
Document: AI_MEMORY.md
Version: 1.0.0
Status: Active
Priority: High
Owner: Atölye V2
Last Updated: 2026-07-08
---

# Atölye V2 — AI Memory

## Amaç

Bu belge Atölye V2 geliştirme sürecinde edinilen deneyimleri, önemli dersleri ve tekrar edilmemesi gereken hataları kayıt altında tutar.

Bu belge teknik kuralları içermez.

Teknik kurallar için:

ATOLYE_AI_RULES.md

referans alınmalıdır.

---

# AI MEMORY-001

## Önce Mimari

### Öğrenilen Ders

Koddan önce mimari planlandığında hata oranı ciddi şekilde azalıyor.

### Sonuç

Her geliştirme önce analiz ile başlamalıdır.

---

# AI MEMORY-002

## Küçük Adımlar

### Öğrenilen Ders

Büyük refactor'lar risk oluşturuyor.

### Sonuç

Küçük ve kontrollü geliştirmeler tercih edilmeli.

---

# AI MEMORY-003

## Geriye Dönük Uyumluluk

### Öğrenilen Ders

Yeni özellikler mevcut sistemi bozmadan eklenebiliyor.

### Sonuç

Backward Compatibility korunmalı.

---

# AI MEMORY-004

## Service Layer

### Öğrenilen Ders

Business Logic UI içerisine taşındığında kod tekrarları oluşuyor.

### Sonuç

İş mantığı Service katmanında tutulmalı.

---

# AI MEMORY-005

## Manifest

### Öğrenilen Ders

Manifest sistemi proje ilerlemesini takip etmeyi kolaylaştırıyor.

### Sonuç

Yeni üretim aşamaları mümkün olduğunca manifest sistemine entegre edilmeli.

---

# AI MEMORY-006

## Asset Versioning

### Öğrenilen Ders

Asset geçmişinin korunması geliştirme sırasında büyük avantaj sağlıyor.

### Sonuç

Append-only yaklaşımı korunmalı.

---

# AI MEMORY-007

## AI Router

### Öğrenilen Ders

Tek AI sağlayıcısına bağımlı olmak uzun vadede risk oluşturuyor.

### Sonuç

Provider sistemi korunmalı.

---

# AI MEMORY-008

## Sprint Disiplini

### Öğrenilen Ders

Aşağıdaki sıra en güvenli yöntem oldu.

Analiz

↓

Onay

↓

Kod

↓

Test

↓

Rapor

↓

Checkpoint

↓

Git

---

# AI MEMORY-009

## Git Güvenliği

### Öğrenilen Ders

Her anlamlı geliştirme güvenli bir commit ile kayıt altına alınmalıdır.

### Sonuç

Uzun süre commit almadan çalışılmamalıdır.

---

# AI MEMORY-010

## Token Yönetimi

### Öğrenilen Ders

Token azaldığında yeni geliştirmeye başlamak risk oluşturuyor.

### Sonuç

Token düşükse;

- analiz hazırlanır,
- dokümantasyon geliştirilir,
- kodlama sonraki oturuma bırakılır.

---

# AI MEMORY-011

## Dokümantasyon

### Öğrenilen Ders

İyi dokümantasyon yeni AI oturumlarının adapte olma süresini ciddi şekilde azaltıyor.

### Sonuç

Kod kadar dokümantasyon da güncel tutulmalı.

---

# AI MEMORY-012

## Atölye Bir Platformdur

### Öğrenilen Ders

Bağımsız özellikler yerine üretim hattına entegre edilen modüller daha sürdürülebilir oluyor.

### Sonuç

Yeni geliştirmeler mevcut pipeline'a entegre edilmelidir.

---

# AI MEMORY-013

## Kullanıcı Tercihi

### Öğrenilen Ders

Projenin temel hedefi:

**En az hata ile en hızlı tamamlanan Atölye**

olmalıdır.

Hız önemlidir.

Ancak kalite ve sürdürülebilirlik daha önemlidir.

---

# AI MEMORY-014

## Yeni AI Oturumu

### Öğrenilen Ders

Yeni bir AI doğrudan kod yazmaya başlamamalıdır.

### Sonuç

Önce şu belgeler okunmalıdır:

- README.md
- ATOLYE_CHECKPOINT.md
- ATOLYE_AI_RULES.md
- ATOLYE_CONTEXT.md
- ROADMAP.md

---

# AI MEMORY-015

## Sürekli İyileştirme

### Öğrenilen Ders

Kod kadar süreç de geliştirilebilir.

Daha iyi bir yöntem bulunduğunda;

önce değerlendirilmeli,

uygunsa dokümantasyona eklenmelidir.

---

# AI MEMORY-016

## Kisisel AI Produksiyon Studyosu

### Ogrenilen Ders

Atolye ticari SaaS oncelikli bir urun olarak degil, kullanicinin kendi sunucusunda calisan guvenli kisisel AI calisma arkadasi olarak dusunulmelidir.

Kullanici yonetmendir; Atolye produksiyon ekibidir.

### Sonuc

Her sprint VISION.md ve PROJECT_PHILOSOPHY.md belgelerindeki Personal AI Production Studio vizyonuna gore degerlendirilmelidir.

Korunacak uzun vadeli sistemler: AI Director, Historical Documentary Engine, Knowledge Engine, Production Memory, AI Provider Agnostic Architecture ve Secure Remote Personal Studio.

---

# AI MEMORY-017

## Gercek Proje Bookkeeping Reconciliation

### Ogrenilen Ders

Gercek bir uretim projesinde manifest/job/history gibi bookkeeping dosyalari, fiziksel asset'lerin
gercekte ulastigi durumla senkron olmayabilir (orn. bir stage bookkeeping'de "failed"/"pending"
gorunurken diskte gecerli, tutarli bir cikti zaten var olabilir). Bu durumda ham JSON elle
duzenlenmemeli; ayni sonuca resmi, zaten var olan public API'ler (orn. `PipelineJobManager`'in
durum gecis metotlari + `ProjectManager.save<Stage>`) ile, mevcut diskteki veriyi degistirmeden
geri yazarak ulasilmalidir. Boylece bookkeeping gercek calisma zamaninin izledigi ayni kod yolundan
gecer ve sahte kanit uretilmez. Degisiklikten once ilgili dosyalarin yedegi alinmalidir.

### Sonuc

Boyle bir reconciliation ihtiyaci varsa: (1) once fiziksel veri ile bookkeeping arasindaki
celiskiyi net olarak raporla, (2) kullaniciya bunun gercek uretim ciktisi olup olmadigini
dogrulat, (3) yalniz mevcut public API'ler uzerinden, tek seferlik ve iyi belgelenmis bir script
ile uygula, (4) icerik dosyalarinda sifir diff oldugunu kanitla.

---

# AI MEMORY-018

## Maskelenmis Hata Ayiklama

### Ogrenilen Ders

Genis bir `catch { throw new GenericError(); }` bloğu, alttaki gercek hatayi (orn. eksik
`RuntimeStorageContext`) ayirt edilemeyen tek bir genel hata koduna donusturebilir. Boyle
durumlarda hatanin stack'i guvenlik amaciyla temizlenmis olabilir (`this.stack = undefined`).

### Sonuc

Kok nedeni bulmak icin ilgili error class'inin constructor'ina, yalniz acik bir debug env
degiskeniyle (orn. `ATOLYE_DEBUG_TRACE_X=1`) aktif olan gecici bir `console.trace()` eklenebilir;
bu, atilan hatanin kendisini degistirmez, yalniz ayri bir tanilama ciktisi verir. Kok neden
bulunduktan sonra bu enstrumantasyon eksiksiz geri alinmali ve `git diff` ile sifir kaldigi
dogrulanmalidir.

---

# AI MEMORY-019

## Izole Ortam Kopyalamalarinda Guvenlik ve Inode/Dev Bagimliligi

### Ogrenilen Ders

`AudioCompensationStore` ve `AudioPublicationIntentStore` gibi anti-tamper güvenlik katmanları, ses dosyalarının fiziki disk kimliklerini (`inode`, `device`), SHA-256 hash'lerini ve aktif `ProductionRuntimeOperationContext` (`resolverBindingIdentity`, `operationId`, `bindingFingerprint`) imzalarını denetler.

Dosyalar test veya POC amacıyla başka bir dizine kopyalandığında veya slug değiştirildiğinde, işletim sistemi seviyesinde yeni `dev`/`inode` değerleri oluşur ve kriptografik imzalar geçersiz kalır. Bu durum bir production pipeline hatası değil, güvenlik mekanizmasının doğal ve doğru bir koruma davranışıdır.

Canlı production pipeline akışı (`PipelineRunner.run`) zaten tüm adımları yetkili bir `runWithProductionRuntimeOperationContext` altında yürütür ve dosyaları yerinde üreterek fiziki `dev`/`inode`/`sha256` kayıtlarıyla %100 uyumlu olarak mühürler.

### Sonuc

İzole scratch kopyalamalarında görülen `AudioPublicationIntentError` / `AudioCompensationStoreError` hataları için production kodlarında (`VideoAssemblyManager`, `AssemblyManager`, `AudioStorage` veya güvenlik katmanları) gereksiz refactor veya güvenlik gevşetmesi yapılmamalıdır. Canlı üretim akışı zaten doğru bağlam ve doğru fiziki kimlikle çalışmaktadır.

---

# Yeni Memory Ekleme

Yeni önemli deneyimler bu belgeye sıradaki AI MEMORY numarası ile eklenmelidir.

Eski kayıtlar silinmemelidir.

Bu belge Atölye V2'nin kurumsal hafızasıdır.


## 2026-10-06 — Stage17 protected hash and bounded security source repair

# Historical snapshot Stage17 continuation — 2026-10-06 / security source repair; clean-HEAD qualification pending

Entry checkpoint68747ae40f53ce2358e1499363f66c999243d584 preserved. Protection source979f12a4a12d3a4fb456cce289d66fe50aa00c8c has real named component/Windows/media receipts under05_STAGE17/implementation. Streaming inventory covers all fixed local roots:623,539,744/623,541,535 bytes,0 exclusions,localComplete=true before/after. A concurrent extra file changed the digest:PROTECTED_CHANGE_UNATTRIBUTED retained; external runtime/authority remains unqualified. No durable final full166 receipt exists for979f12a, so that run is NOT_QUALIFIED rather than an invented full PASS. All old evidence remains separately bound.

Official online npm audit at979f12a found19 vulnerable packages (1critical/15high/3moderate). Reviewed isolated compatible update selects Next/eslint-config-next16.3.8 and non-force lock repairs; production advisory result0,all-dependency result5high dev-only braces-chain warnings with no published patched version. No framework downgrade, install script execution or lint weakening. Sharp default-export typing corrected. Runtime health response logic moved unchanged into its existing runtime layer so the route exports only supported Next entries; explicit Node instrumentation guard allows both webpack/Turbopack. Existing25 health cases retained;20 supplemental adversarial+5 assertion-caught mutations added. Candidate TS/lint0errors/13 inherited warnings,both actual builds/bundled health and13 synthetic mobile/wake/STT suites PASS. These are preparation receipts, not new clean-HEAD qualification. Running service/main installed dependencies were not migrated or restarted; authenticated runtime identity remains OWNER_ACTION_REQUIRED.

CF49 CLOSED_PASS retained;214 frozen pins/v55/166 suites unchanged. Raw retrieval FAIL,Golden promotion stop and16 remaining limitations stay visible. LemonUNBOUND/FiverrOWNER_REPORTED unchanged. Stage17/FoundationBLOCKED; Infinity/next master stages not advanced; Homepage/Brain UI V2NOT_STARTED/boundaryNOT_REACHED. Next: commit/push this bounded source repair,refresh Graphify,qualify exact clean source in a credential-free TEMP clone with matching dependency lock and a durable166 report,then refresh actual protected/domain/live findings and final owner-review prerequisites.
