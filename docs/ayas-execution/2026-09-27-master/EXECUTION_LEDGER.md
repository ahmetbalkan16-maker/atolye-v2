# AYAS master execution ledger

## 2026-09-28 — Baseline and canonical pack import

- Status: IN_PROGRESS; Phase 0, baseline and package import.
- Repository: `wip/ayas-graphify-final-execution` at `823e7a547bc2a8fd9f80ce72bcedcef7b33d772a`.
- Upstream and real `origin/wip/ayas-graphify-final-execution`: same HEAD; ahead/behind `0/0`; tracked and untracked worktree clean before import. `git pull --ff-only`: already up to date.
- Graphify: `lastAnalyzedHead` equals HEAD; `stale=false`; `.graphify/needs_update` absent; 15,436 nodes / 44,699 edges; duplicate nodes/edges, dangling edges and self-loops all zero. `.graphify_describe_pending` remains; no semantic completion is claimed.
- Protected live roots identified: `data/brain`, `data/projects`, `data/e2e-output`, and the AYAS access supervisor state under `%LOCALAPPDATA%/AtolyeAyasAccess`. These are not package-import destinations.
- Supplied ZIP: 79 entries, no absolute/traversal paths. `README_FIRST.md` was read before `00_COMMAND/AYAS_FINAL_CODEX_MASTER_EXECUTION_ORDER.md`. Repository behavior and passing tests take precedence over historical package assumptions.
- Next: import only human-readable specification/evidence files and the approved UI reference into this directory; keep the archive and patches out of the repository. Then establish focused Phase 0 test baselines before source changes.

### Package import complete

- Imported 75 `.md`/`.json`/`.png` entries, preserving the ZIP directory tree. Four `.patch` entries remain in the ZIP and were neither copied nor applied. No ZIP archive was committed or placed in the repository.
- The V3.2 source map describes older flattened filenames; the higher-priority final master order requires preserving this final package's directory structure. The original paths under `00_COMMAND`, `01_CANONICAL_SPECS`, `02_REMEDIATION` and later stages are retained.
- Phase 0 patches were prepared against `035b407`, while current HEAD is `823e7a5`; they require independent re-review against current code. No patch has been applied.
- Package import is documentation/reference only. All 75 entries initially matched the ZIP byte-for-byte; both JSON files parsed and no patch entered the repo. One reference-only Markdown file had an extra blank line at EOF in the supplied ZIP; that single trailing byte was normalized so `git diff --check` passes. The packet commit hash is obtained from Git after commit, not embedded in its own commit.

### Docs packet committed and Phase 0 baseline established

- Docs-only commit: `efbd27b7c59faa221408aafa7638ada31e20f679` (`docs(ayas): import canonical master execution pack`). No push; branch is one commit ahead of origin and worktree was clean before this checkpoint update.
- Graphify was refreshed after the commit: `lastAnalyzedHead=efbd27b`, `stale=false`, `.graphify/needs_update` absent, 15,437 nodes / 44,701 edges, duplicate node/edge 0/0, dangling 0, self-loop 0. Semantic description remains pending; seven PowerShell parser limitations remain known.
- Clean-source baseline: memory 29 PASS, context 32 PASS, memory-temporal 51 PASS, chat-quality 35 PASS, conversation-quality-master 37 PASS. Cognitive-quality completed 53/55 with two known limitations. Retrieval evaluation completed 74 cases with 30 known limitations, four determinism, eight error, eight isolation/privacy and seven chat-chain checks.
- First remediation patch has only been read from the ZIP. Current HEAD differs from its `035b407` base, so no blind patch application. Graphify review-analysis on five affected source files reported high blast radius across ten communities and eight bridge nodes. Source remains unchanged; the next task is independent code review and narrow regression coverage.

### Phase 0 conversation safe remediation — validated packet

- Reviewed the first archive patch against current code and adapted it manually; no archive patch was applied. Decision and short identity extraction, explicit matching conversation-constraint release, question deferral, correction-aware old-turn summary, Turkish history cue and RAM/bellek prompt delivery are covered by regression tests.
- The archive's wider prompt synonym list raised stale and contradictory chat-context rates beyond evaluator ceilings. Narrowed the prompt addition to RAM/bellek, reran all 74 evaluation cases and reached PASS. This does not claim retrieval-ranking synonymy is solved; the held-out RAM/bellek ranking limitation remains.
- The new “ne zaman” handling resolved `seed:historical-recorded-today` at all layers; removed only that proven limitation from the evaluator registry. Two separate free-text stale memory cases remain known in the cognitive-quality suite.
- Validation: memory 30 PASS; context 34 PASS; memory-temporal 51 PASS; chat-quality 36 PASS; conversation-quality-master 37 PASS; cognitive-quality 53/55 with two known limitations; retrieval evaluation PASS (74 cases, 29 known limitations, 4 determinism, 8 error, 8 isolation/privacy, 7 chat chains); Graphify integration 46 PASS; developer-intelligence gate PASS; open-ended evolution 109 PASS; technology watch 129 PASS; TypeScript PASS; changed-file lint PASS; full lint 0 errors/13 pre-existing warnings; `git diff --check` PASS.
- Graphify refreshed on the dirty source worktree: `stale=false`, analyzed HEAD still `efbd27b`, `needs_update` absent, 15,441 nodes / 44,707 edges, duplicate node/edge 0/0, dangling 0, self-loop 0. Review-analysis remains high blast (score 163), ten communities, eight bridge nodes, five graph test-gap hints although focused tests ran. No authority imports were added. Re-refresh after commit to bind its new HEAD.

### Conversation packet committed

- Commit `747c6d292f599fec1bab1f00fe1d36037cc73851` (`fix(ayas): close bounded conversation memory gaps`) contains only the 13 reviewed source/test/checkpoint files. No push. Worktree was clean immediately after commit; branch ahead origin by two commits.
- Post-commit Graphify refresh: `lastAnalyzedHead=747c6d2`, `stale=false`, 15,442 nodes / 44,719 edges, duplicate node/edge 0/0, dangling 0, self-loop 0. Known seven PowerShell parser gaps and semantic description pending remain.
- Next in Phase 0: re-review the temporal computer-plan patch against this HEAD, including negative cases for unrelated specs, preferences, history and other decisions. The archive patch remains unapplied.

### Phase 0 typed computer purchase-plan packet — validated

- Re-reviewed the second archive patch against `747c6d2`; adapted rather than applying it. A `decision` is assigned the closed `user.decision.computer-purchase-plan` slot only when the statement names a computer and explicitly says `almaya/toplamaya/kurmaya karar`. Specs, preferences and other PC decisions remain independent.
- The archive patch's raw 180-character `factValue` failed the existing memory schema (`<=40` token); an initial regression exposed `invalid` instead of `superseded`. The implementation hashes the full normalized decision with SHA-256 into a 40-character token. This preserves distinct plan versions within the existing schema without broad free-text matching.
- TEMP-only tests cover new/old plan supersession, independence of specs/preferences/other decisions, durable write/reload, and rejection of inferred text as authority over a user decision. No live memory/proposal files were changed.
- Validation: memory-temporal 52 PASS, memory 30 PASS, context 34 PASS, chat-quality 36 PASS, conversation-quality-master 37 PASS, cognitive-quality 53/55 with two known limitations, retrieval evaluator PASS 74 cases with 29 unchanged known limitations, TypeScript PASS, changed-file lint PASS, `git diff --check` PASS.
- Graphify refreshed on dirty source: `stale=false`, 15,442 nodes / 44,719 edges, no duplicate/dangling/self-loop. Review-analysis blast score 194 over 19 impacted files, nine communities, eight bridge nodes, two test-gap hints (tests ran). No approval, execution or persistent-state mutation authority was added.
- Existing temporal records with no `factKey` remain untyped by the current read-side contract. The evaluator's historical PC plan fixture uses that form, so it does not improve; no known limitation was removed or falsely marked solved. Retyping prior records would require separate migration/read-side authority review.

### Typed-plan packet committed

- Commit `9e51840c2645447e3b8ee18d9277c209ffa4b852` (`feat(ayas): type explicit computer purchase plans`) contains five reviewed source/test/checkpoint files. No push; branch ahead origin by three commits and worktree clean immediately after commit.
- Post-commit Graphify: `lastAnalyzedHead=9e51840`, `stale=false`, 15,443 nodes / 44,723 edges, duplicate node/edge 0/0, dangling 0, self-loop 0. Semantic description and seven PowerShell parser limitations remain.
- Next: system-static remediation patch, reviewed independently against current code. The observer-autostart suite remains unsafe without owner-supervised proof of the real Scheduled Task state.

### Continuation audit at `9e51840`

- Actual branch/upstream: `wip/ayas-graphify-final-execution` tracking `origin/wip/ayas-graphify-final-execution`; local ahead/behind `3/0`. HEAD `9e51840c2645447e3b8ee18d9277c209ffa4b852` is the last committed green packet, with its recorded 52 temporal scenarios, 74-case retrieval gate, TypeScript, focused lint and diff checks. No push occurred.
- Completed the post-commit Graphify binding/integrity check: `branch.lastAnalyzedHead=graph.built_from_commit=HEAD=9e51840`, `stale=false`, `needs_update` absent, 15,443 nodes / 44,723 edges, duplicate node/edge 0/0, dangling 0, self-loop 0. Semantic description pending and seven PowerShell parser limitations remain known.
- Preserved uncommitted work, with no reset/clean/stash. All eight initial dirty files belong to the partially implemented Phase 0 system-static packet: `ACTIVE_CHECKPOINT.json` and `EXECUTION_LEDGER.md` are progress documentation; `ayas-discovery-daemon.ts`, `AyasDeveloperTaskModel.ts`, `AyasEvolutionOpportunity.ts`, `AyasEvolutionQualification.ts` are partial source changes; `smoke-ayas-graphify-integration.ts` and `smoke-ayas-open-ended-evolution.ts` are partial regressions. No unrelated dirty file or completed uncommitted packet was found.
- Continue from this exact partial diff. Do not repeat the earlier conversation or typed-plan remediation. The observer-autostart test is still `UNSAFE_KNOWN` and must not run without the documented owner-supervised Scheduled Task proof.

### Phase 0 system-static remediation — safe packet validated

- Discovery now refuses Graphify freshness when `.graphify/needs_update` exists. Evolution record and environment containers reject sparse arrays, including arrays with inherited numeric entries. Developer task classification recognizes an explicitly written but uncommitted closure. The model-routing document now matches the verified zero-cost router: unknown-cost cloud is not auto-selected.
- Every nine `-ForceStartupShortcut` invocation in the observer-autostart smoke now supplies a unique test `-TaskName`; static scan found zero misses. The suite remains `UNSAFE_KNOWN` in the real test index and was not executed, because owner-supervised proof of the live Scheduled Task's XML/state is a prerequisite.
- Validation: Graphify integration 47 PASS, open-ended evolution 110 PASS, developer intelligence main 39/39 and held-out 10/10, model router 17 PASS, TypeScript PASS, changed-file lint PASS, full lint 0 errors / 13 pre-existing warnings, `git diff --check` PASS. The observer-autostart smoke has no run result.
- Graphify refreshed after the final source change: `lastAnalyzedHead=graph.built_from_commit=9e51840`, `stale=false`, `needs_update` absent, 15,444 nodes / 44,728 edges, duplicate node/edge 0/0, dangling 0, self-loop 0. Review-analysis blast score 158, nine communities, eight bridge nodes, five test-gap hints; no authority coupling was introduced. Rebind the graph after the packet commit.

### System-static packet committed; safe CI reviewed

- Commit `b8515013a0114d2922180caa4a7ea618db928e28` (`fix(ayas): fail closed on static system gaps`) contains the ten reviewed files. No push; branch ahead origin by four commits and worktree clean immediately after commit.
- Post-commit Graphify: `lastAnalyzedHead=graph.built_from_commit=b851501`, `stale=false`, `.graphify/needs_update` absent, 15,445 nodes / 44,737 edges, duplicate node/edge 0/0, dangling 0, self-loop 0. Semantic description and seven PowerShell parser limitations remain known.
- The archive's safe CI patch was reviewed against current code after the local deterministic gates passed. Its hosted workflow uses read-only repository permissions and excludes observer-autostart, Graphify host state, provider/network and production runtime tests. The proposed commands passed locally: TypeScript, full lint (0 errors, 13 existing warnings), cognitive quality (53/55 with two known limitations), retrieval evaluation (74 PASS), developer intelligence (39/39 main, 10/10 held-out), open-ended evolution (110 PASS), technology watch (129 PASS). YAML parsed with the installed `js-yaml`; workflow has one job, pull-request and specified push triggers, and `contents: read` only. Hosted CI has not run because no push occurred.
- Next Phase 0 requirement after safe CI: runtime-health issue proof on the actual Next runtime. No production runtime change or automatic cloud/provider spend is authorized by this CI packet.

### Safe CI committed; runtime-health evidence in progress

- Commit `b865b6b8c8f0d9d8a22c6a0ca32a27773bd5f7bc` (`ci(ayas): add read-only safe regression gate`) contains the reviewed workflow and checkpoint packet. No push; branch ahead origin by five commits, behind zero; worktree was clean immediately after commit.
- Post-commit Graphify refresh bound `branch.lastAnalyzedHead=graph.built_from_commit=b865b6b`, `stale=false`, `.graphify/needs_update` absent, 15,446 nodes / 44,739 edges, duplicate node/edge 0/0, dangling 0, self-loop 0. Semantic description and seven PowerShell parser limitations remain known.
- The prior checkpoint still named `b851501` because the safe CI commit could not include its own resulting hash. It is now advanced to the actual verified HEAD. `9e51840` was the last green commit at the earlier continuation point; `b851501` and `b865b6b` are subsequent locally validated commits.
- Runtime-health evidence is the next Phase 0 packet. Existing unit smoke uses an injected status getter and does not prove whether the real Next instrumentation and route load the same module instance. No runtime code change is justified until a real build provides both observations.

### Phase 0 runtime-health instance split — reproduced and fixed locally

- Built the unmodified `b865b6b` source with Next 16.2.10/Turbopack. In one isolated Node process using the emitted instrumentation and route bundles, the initializer returned `RUNTIME_INITIALIZED` with worker `ready` and `acceptingExecutions=true`, while the route's status remained `created`, `initialized=false`, HTTP 503 `starting`. A separate authenticated GET to an isolated `next start` on port 39017 reproduced HTTP 503 `created`. Only throwaway TEMP runtime and authority roots were used; no live runtime state or project data was changed.
- The root cause is separate bundle module instances: instrumentation initializes its module-local `ProductionWorkerLifecycle`, while the health route imports a fresh composition-root instance. The route did not invoke another initializer. The existing injected-status smoke could not detect this split.
- A process-global `Symbol.for` status projection now registers only the initialized lifecycle's read-only snapshot function after authority enforcement and before initialization. Every bundled reader uses that function. An unregistered reader still yields the existing `created` 503 state; malformed projection, thrown reader, or conflicting second initializer fails closed. No lifecycle, execution method, approval, provider or persistent state is shared by the projection.
- Rebuilt the changed source and reran isolated `next start`: authenticated `/api/runtime/health` returned HTTP 200 with `healthy`, lifecycle `ready`, `initialized=true`, `workerReady=true`. Added a built-bundle smoke that runs the emitted instrumentation and route in the same isolated process. Validation: bundle smoke PASS; health API 25/25; runtime status 15/15; startup 11/11; production readiness acceptance 26 PASS; TypeScript PASS; changed-file lint PASS; `git diff --check` PASS.
- Graphify refreshed on the dirty source: `lastAnalyzedHead=graph.built_from_commit=b865b6b`, `stale=false`, `.graphify/needs_update` absent, 15,458 nodes / 44,758 edges, duplicate nodes/edges 0/0, dangling 0, self-loop 0. Review-analysis reports high blast score 306 across 39 files and 19 communities, with eight bridge nodes and three graph test-gap hints; the focused tests above ran despite those hints. No unexpected authority coupling was introduced; the new module imports only a status type.
- Next: commit this validated packet and bind Graphify to its new HEAD, then proceed in Phase 0 order to immutable phone-model revision evidence. No push or hosted CI run.

### Runtime-health packet committed; phone-model evidence collected

- Commit `ad3b16e481bd9c3f8e6aa8f7f10457debc1910e3` (`fix(runtime): share initialized health status across Next bundles`) contains exactly the seven validated files. No push; branch ahead origin by six commits and worktree clean immediately after commit.
- Post-commit Graphify: `lastAnalyzedHead=graph.built_from_commit=ad3b16e`, `stale=false`, `.graphify/needs_update` absent, 15,459 nodes / 44,765 edges, duplicate nodes/edges 0/0, dangling 0, self-loop 0. Seven PowerShell parser limitations and semantic description pending remain known.
- Read-only `git ls-remote` and metadata-only `git clone --filter=blob:none --depth=1 --no-checkout` verified current public Hugging Face revisions, all four required paths per repository, and the Git LFS weight pointer SHA256 without downloading weights: SmolLM2 `12fd25f77366fa6b3b4b768ec3050bf629380bac` / `9358cd4ce037c304621f8c194a525607ae7c5ea73239fcae4c21bd02f2e34ff7`; Qwen 0.5B `cc5cc01a65cc3ff17bdb73a7de33d879f62599b0` / `b11c1dd99efd57e6c6e5bc4443a019931a5fbd5dd500d48644d8225f5ce0b2cb`; Qwen 1.5B `6287331f475a3e20e8c879be8fd4bf3551ad9d34` / `19dec9f63488016185ba997d5e4492b5ac5b4f7ef1abb45243a91de958838dcd`. These are source evidence for the next packet, not yet application config changes.

### Phase 0 phone-model immutable pinning — validated packet

- Each canonical phone-model entry now carries its verified 40-character commit revision and the published LFS SHA256 for its q4f16 weight. The full-weight SHA256 is recorded evidence, not a claim that the browser hashes a 117 MB–1.22 GB download. Exact provenance: public Git HEAD and `git ls-tree`/LFS pointer at the named revision for each repository; required `config.json`, `tokenizer.json`, `tokenizer_config.json`, and `onnx/model_q4f16.onnx` were present at all three revisions. Metadata-only TEMP clones were removed after verification.
- Direct URL and IndexedDB cache-key construction use the pinned revision; `pipeline()` passes the same `revision` to the installed Transformers.js library. The smoke compares both direct URL and custom-cache key with that library's actual `buildResourcePaths`. Mutable/empty/malformed or non-catalog revisions are rejected before download or pipeline load. Old `/resolve/main/` cache entries remain on disk but cannot satisfy the new pinned cache check; nothing is deleted.
- The Next app's closed gateway route list and the Cloudflare Worker source's closed path/upstream allowlist use the same two pinned revisions. No deployed Worker configuration was changed; rollout requires its ordinary separately authorized deployment sequence. Historical Range evidence was for mutable `main`; the pinned route has not yet been tested on a real phone. No provider key, owner gate, model execution authority or live project state changed.
- Validation: phone capability 11 PASS, IndexedDB storage 13 PASS, diagnostics 11 PASS, memory probe 8 PASS, diagnostic tests 5 PASS, Range diagnostic 8 PASS, precache 23 PASS, runner 10 PASS, Worker runtime 40 PASS; TypeScript PASS; changed-file lint PASS; `git diff --check` PASS. Graphify refreshed on dirty source: analyzed HEAD `ad3b16e`, `stale=false`, `.graphify/needs_update` absent, 15,460 nodes / 44,773 edges; duplicate node/edge 0/0, dangling 0, self-loop 0. Review-analysis high blast score 230 with 24 impacted files and five graph test-gap hints; direct phone suites above ran. No authority imports were added.
