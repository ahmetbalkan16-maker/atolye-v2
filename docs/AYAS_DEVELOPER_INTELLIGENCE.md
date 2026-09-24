# AYAS Developer Intelligence — Stage 10

## Scope and authority boundary

Stage 10 makes AYAS better at the software-development loop around this repository: recover the real repository state, understand the request, pick the minimum useful skills, plan tests and review, and hand the remaining work to a developer agent without restarting it. It is intelligence, not authority.

The seven modules in `src/lib/ayas/developer/` are pure and advisory. They import only one another and Node built-ins. The one process call is read-only `git` in the collector (`status`, `rev-parse`, `merge-base --is-ancestor`, `log`, and `ls-remote` only when the caller opts in). Nothing in `app/`, chat, approval, the execution gate, the mutation registry or publication imports them. Graphify confirms zero outgoing edges from these modules and incoming edges only from the CLI and the evaluator. Planning, skill selection, agent selection, packet compilation and review classification therefore have no path to execution, approval, mutation or publication. Owner approval and the execution gate stay exactly where they were.

| Module | Responsibility |
| --- | --- |
| `AyasDeveloperTaskModel.ts` | Task kind, dimension flags, path → change-area rules, graph-first change plan |
| `AyasRepositoryRecovery.ts` | Porcelain-v2 parsing, scope classification, lifecycle, first unfinished gate, Git readiness, evidence trust, verified checkpoint lines |
| `AyasDeveloperSkillIntelligence.ts` | Host-aware skill catalog, minimum-skill selection, actual-use verification |
| `AyasDeveloperTestIntelligence.ts` | Known-unsafe registry, static test-safety classification, test strategy, failure triage, baseline-comparison decision |
| `AyasDeveloperReviewIntelligence.ts` | Review dimensions by change area, evidence-based finding classification |
| `AyasDeveloperHandoff.ts` | Agent choice, redaction, context compression, task-packet compiler |
| `AyasRepositoryStateCollector.ts` | Read-only Git/Graphify/skill-directory/test-index collection |

`scripts/ayas-developer-handoff.ts` is the operator entry point. It prints a packet for the owner to paste; it never dispatches an agent.

```
npx tsx scripts/ayas-developer-handoff.ts --task "<request>" --baseline <trusted-commit> \
  --scope <path|dir/|glob> ... [--host claude|codex] [--registered-skills a,b] \
  [--unavailable-agents codex] [--progress evidence.json] [--deferred <text>] [--done <text>] [--remote] [--json]
```

## Developer task model

Requests are classified into one of these kinds: investigation, bug fix, feature, refactor, test creation, security fix, documentation, code review, architecture review, recovery/continuation, migration, performance and integration. There is no single complexity score. Separate flags record mutating vs read-only, external, multi-component, authority-, data- and security-sensitive, requires tests / runtime validation / Graphify, failure triage, scope concern, lifecycle claim, handled locally, named agent, unavailable agents and privacy restriction. Change areas come from deterministic path rules: authority, execution-gate, security, storage, production-pipeline, video-audio, router, memory, conversational, trace, developer, frontend, tests, documentation, config, generated, data and secret.

Precedence is conservative. Continuation wording ("sürdür", "kaldığı yer", "yarım", a lifecycle claim such as "commit oldu ama push olmadı") wins over the topic. A polite Turkish request ("düzeltir misin?") is a request, not a question. A pure state question never becomes a mutation. An imperative change without a more specific shape is still a change. "gizli anahtar" (a secret key) is a security topic, not a privacy instruction.

## Repository recovery and continuation

`recoverAyasRepositoryState` combines the snapshot (branch, HEAD, tracking head, optional real remote head, ahead/behind, staged/unstaged/untracked/ignored entries, commits since the trusted baseline), the declared scope and the progress evidence. It returns:

- **Mode**: `CLEAN_START`, `RESUME_UNCOMMITTED`, `RESUME_COMMITTED_UNPUSHED`, `RESUME_CLOSURE_IN_PROGRESS`, `RESUME_PUSHED_NEEDS_CLOSURE`, `CLOSED`, `SYNC_REQUIRED`, `DIVERGED`, `STOP_SCOPE_DRIFT` or `STOP_UNKNOWN_STATE`.
- **First unfinished gate**: `SYNC → SCOPE_REVIEW → DISCOVERY → IMPLEMENTATION → VALIDATION → GRAPHIFY_REFRESH → REVIEW → DOCUMENTATION → STAGE → COMMIT → POST_COMMIT_GRAPHIFY → PUSH → CLOSURE → REMOTE_VERIFICATION → CLOSED`.
- **Separate lifecycle facts**: IMPLEMENTED, COMMITTED, PUSHED (with `REAL_REMOTE`, `TRACKING_REF_ONLY` or `NONE` evidence), DOCUMENTED and VERIFIED. Code committed is not pushed, pushed code is not a finished closure, and dirty docs do not mean incomplete code.
- **Git readiness**: `NOT_READY`, `READY_TO_STAGE`, `READY_TO_COMMIT`, `READY_TO_PUSH`, `PUSHED_NEEDS_CLOSURE` or `FULLY_CLOSED`, derived only from evidence.

Behaviour that matters for real interruptions:

- The existing implementation is always preserved. No gate implies reset, clean, stash, revert or restart.
- Ahead and behind together is `DIVERGED`: stop, no rebase or force.
- Behind with local changes stops for the owner. A real remote that moved past the tracking ref requires a fetch. After any sync, the packet asks for regeneration instead of listing IMPLEMENTATION again.
- Unexpected, config, generated, data or secret paths — dirty, staged, committed since the baseline, or the out-of-scope source of a rename — are `STOP_SCOPE_DRIFT`. Nothing is auto-staged.
- Ignored paths under a daemon-owned prefix (`data/brain/`) are attributed, never staged, and do not block.
- `COMMIT` requires every in-scope entry to be tracked, staged and unchanged since staging. A file edited again after staging (`MM`) returns to `STAGE`.
- `FULLY_CLOSED` needs a clean tree, 0/0, a docs-only closure commit when the convention requires one, and a real-remote match. A closed tree without accepted validation evidence carries `CLOSED_WITHOUT_ACCEPTED_VALIDATION_EVIDENCE`.
- The collector fails closed if status fails, the baseline log fails, or the baseline is unknown or not an ancestor of HEAD. The CLI then prints no packet.

## Evidence trust and Claude ↔ Codex continuation

Each validation record carries its source (`this-session`, `previous-agent` or `checkpoint`) and the state it was observed at. The state is a SHA-256 over HEAD, dirty paths and their contents; the CLI prints it so results can be recorded against it. Trust is `DIRECTLY_OBSERVED`, `INDEPENDENTLY_VERIFIED`, `RECORDED_FROM_PREVIOUS_AGENT` or `NOT_RERUN` (another state). A timeout or failure never counts as a pass. A previous agent's pass at the same state is reusable only when it is not safety-critical; authority, security and data-integrity checks must be rerun. The packet lists accepted, reusable and must-recheck evidence separately, so agent B knows what agent A finished, what not to redo and what to recheck.

## Skill intelligence

Registration is a fact about the receiving host, never about a file on disk:

| Source | Claude Code | Codex | AYAS runtime |
| --- | --- | --- | --- |
| Project-local `.claude/skills/ayas/*` (10 skills, gitignored) | installed, not registered (nested one level below Claude Code's discovery path — likely cause, not verified) | installed, not registered | none |
| Graphify skill | registered (`~/.claude/skills/graphify`) | CLI only, not a registered skill | none |
| `code-review`, `security-review` | built in, reported by the session | — | none |
| `review-agent` | — | registered Codex system skill | none |

The CLI lists skill directories only (no SKILL.md parsing), reads the host's own skill home for Codex/Claude, and accepts `--registered-skills` for built-ins it cannot see. Selection produces `REQUIRED`, `HELPFUL`, `NOT_NEEDED`, `UNAVAILABLE` or `INSTALLED_BUT_NOT_REGISTERED` (read the file directly; never claim it was invoked). Relevance follows the task and touched areas: storage → `ayas:storage`, approval/execution → `ayas:authority` + `ayas:execution-gate`, code change → `ayas:tests` + Graphify, frontend → `ayas:frontend`, security fix → `security-review`, and so on. Irrelevant registered skills stay `NOT_NEEDED`. `reportAyasSkillUsage` accepts a use only when the skill was selected, the delivery matches registration and concrete evidence is given.

**Skill quality review (Phase 25).** The local `ayas:tests` skill defined full regression as running *every* `smoke-ayas-*`. That set includes the known Scheduled Task hazard, and the skill said nothing about root isolation. The local copy now requires scope-derived selection, root classification and the explicit DO NOT RUN. The file is gitignored, so this correction does not travel between machines; the committed `AYAS_KNOWN_UNSAFE_TESTS` registry and every generated packet carry the hazard regardless. No other overlap or contradiction needed a Stage 10 change. Skill-path normalization belongs to later work.

## Agent choice and manual handoff

AYAS has no Claude or Codex dispatch adapter, so delivery is `MANUAL_OWNER_PASTE`. A registered adapter would still require owner approval (`ADAPTER_REQUIRES_OWNER_APPROVAL`). Routing depends on task needs and availability, not brand:

- A read-only state question → `local-tool` (`LOCAL_READ_ONLY_TOOLS`), even while the repository needs an owner decision.
- Drift, divergence, unknown state, or behind with local changes → `none` / `OWNER_DECISION_REQUIRED`.
- A continuation request on a closed repository → `NO_AGENT_NEEDED`.
- A privacy restriction → no external agent.
- An agent reported out of tokens or limits is excluded. If none remain: `WAIT_FOR_AGENT_AVAILABILITY`, and the packet is still produced.
- An owner-named agent wins. Otherwise strict prior evidence (0–5) breaks ties, the only remaining agent is used, or the target stays `any-developer-agent`.

Packet style is `IMPLEMENTATION` for mutating work (exact scope, tests, Git discipline) and `ANALYSIS` for read-only review and investigation.

## Task-packet compiler, scope control and token efficiency

Core sections are always present: **MUST KNOW**, **CURRENT STATE**, **FIRST OPEN GATE**, **MUST DO** and **MUST NOT DO**. Optional sections — SCOPE, GRAPHIFY, SKILLS, TESTS, REVIEW, DATA INTEGRITY, ACCEPTANCE, CONTEXT — appear only when relevant. MUST NOT DO always carries the Git-safety list (no reset, clean, stash, blind revert, force checkout, force push, `git add -A`/`.`, `commit -a` or `--no-verify`), the known-unsafe test registry, the root-isolation rule, the no-live-data/paid/dispatch rule and the secret rule, whatever the packet size. Mission and free text are redacted (keys, tokens, bearer headers, private-key blocks, password assignments). No raw memory or hidden reasoning is included. Staging instructions list every in-scope path explicitly and are never truncated.

Context compression keeps the newest checkpoint, dirty state, unfinished gate and latest evidence per check, plus every safety rule, owner decision and hazard. It drops superseded checkpoints and plans, older logs and closed investigations. Measured packet sizes: evaluator average 4,034 characters (read-only 2,581, mutating 4,277); the real-repository CLI packet for this sprint was 5,233 characters (~1.3k tokens).

## Change planning, test strategy and test safety

`planAyasDeveloperChange` orders: Graphify refresh if needed; locate symbols when there is no graph evidence (never a whole-repository read); `affected --depth 2`; read at most eight graph-named candidates; contracts → core → callers; direct tests; dependent regressions; authority/security regression; static checks; review; docs.

`planAyasTestStrategy` selects: changed tests; direct importers of each changed module; the touched boundary's area suites (authority, execution-gate, security, router, trace, memory, conversational, developer), selected only if present; and Graphify-affected dependents, capped at 12 for low-risk changes and uncapped for high-risk ones. Static checks are `tsc --noEmit --incremental false`, changed-file ESLint `--max-warnings 0` and `git diff --check`; docs-only changes need only the diff check.

Test safety is a static, conservative classification of each script's own source:

- `UNSAFE_KNOWN` — registry; currently `scripts/smoke-ayas-observer-autostart.ts` (its fixture can unregister or replace the real owner Scheduled Task).
- `REQUIRES_OWNER_APPROVAL` — Scheduled Task cmdlets or `schtasks`, service or registry writes, external network, paid provider keys, live Claude/Codex dispatch.
- `REQUIRES_TEMP_ROOT` — a runtime, authority, legacy or brain root may be live. For example, `withCanonicalSmokeRuntime` leaves the legacy `data/projects` root at the repository unless `ATOLYE_WORKSPACE_ROOT` is TEMP. Any Brain/AYAS store import without a TEMP `rootDir` counts too.
- `UNKNOWN` — a root assigned without TEMP evidence, or writes without TEMP evidence.
- `SAFE_ISOLATED` / `SAFE_READ_ONLY` — the only auto-runnable classes.

Identifier signals require usage (`new X`, `X.` or `X(`), so a label or comment is not a write path. Over the real 382 smoke scripts the classification is: 98 SAFE_ISOLATED, 5 SAFE_READ_ONLY, 230 REQUIRES_TEMP_ROOT, 28 REQUIRES_OWNER_APPROVAL, 20 UNKNOWN, 1 UNSAFE_KNOWN. This is deliberately cautious. A static reading cannot prove the transitive behaviour of every import, so manual root review can promote a script, but the classifier never does.

## Failure triage and baseline comparison

`triageAyasFailure` returns `TIMEOUT` (never a pass), `PERMISSION_FAILURE`, `ENVIRONMENTAL_FAILURE`, `PRE_EXISTING`, `FIXTURE_DEFECT`, `TEST_DEFECT`, `PRODUCT_REGRESSION` or `UNKNOWN`. Permission covers EPERM/EACCES, "Erişim engellendi", `.git/worktrees` lock errors and automatic approval or classifier rejections. Environmental covers missing ffmpeg/ffprobe or other tools, DNS or connection errors, and resource exhaustion. Known pre-existing signals match the real Graphify text `<file>.ps1: tree-sitter-powershell not available` and the semantic-pending marker. Otherwise the class comes from the baseline result and which files changed. With no baseline the answer is `UNKNOWN` / `BASELINE_COMPARISON_REQUIRED`.

`decideAyasBaselineComparison` requires a TEMP `git archive <trusted-head>` for improvement claims, unexplained failures and pre-existing claims. A scope question uses a read-only diff against the baseline. Permission, environment or timeout failures, all-pass runs, docs-only changes and an already recorded baseline for the same evaluator need no comparison. The main worktree is never reset.

## Code review intelligence

`planAyasReview` adds dimensions per touched area to the constant correctness and scope checks:

- security → injection, authority, path, secrets, replay
- storage → path, durability, migration, write authority
- router → false positive/negative, fallback, tool/agent authority
- memory → stale data, temporal correctness, privacy
- authority/execution gate → approval binding, replay, lock safety
- frontend → server/client boundary
- tests → isolation
- developer → Git safety, hardcoding
- docs → factual claims only

Mutating work gets two passes.

`classifyAyasReviewFinding` requires evidence. Disproven → FALSE_POSITIVE; on the trusted baseline and not introduced by the change → PRE_EXISTING; outside the task and not introduced → OUT_OF_SCOPE. A MAJOR or BLOCKER without demonstrated reachability and impact becomes MINOR. A BLOCKER needs authority, data-integrity, security or build impact.

## Checkpoint and continuity

`compileAyasVerifiedCheckpoint` emits only accepted passes, Graphify currency at the final HEAD with zero anomalies, and "Runtime/Test Mutation: NONE" only when every before/after fingerprint was measured and equal. Everything else is listed as omitted. Developer context uses the existing checkpoint and docs, not a new memory store.

## Evaluation, baseline and held-out cases

Run `npx tsx scripts/smoke-ayas-developer-intelligence.ts --gate`. It has 39 main flow scenarios, including all 30 roadmap scenarios, interruption cases (session limit during discovery, token limit after mutation, tests or commit, push blocked, closure interrupted), divergence, conflicts, stale or timeout evidence, committed drift, rename drift, `MM` staging and privacy. There are also 61 component checks and 14 integration checks on a disposable TEMP Git fixture with a local bare remote. That fixture covers real porcelain output, rename, daemon-ignored directory, content fingerprint, post-commit Graphify, push readiness, remote moved past tracking, fail-closed unknown and non-ancestor baselines, host-specific skill registration, and the CLI end to end with before/after proof that the worktree, index and refs are untouched. The real repository is classified read-only. There is no network (the real-remote check targets the local bare remote), no paid call and no agent dispatch.

Held-out: ten flow cases ("devam et", "kaldığı yerden", "commit oldu ama push olmadı", "Graphify işlendi mi?", "bir dosya farklı değişmiş", "test permission yüzünden çalışmadı", "Codex token bitti, Claude devam etsin", plus three novel combinations) and four component cases. The anti-hardcoding scan fails if any case text, held-out ID, fixture hash or 40-hex literal appears in production code.

Same evaluator (SHA-256 `e3e668fd286d2714bca357bb4d886464cf6d031c19418627d7b4c7caea0ab9f5`, fixture `4f5d97f8c5cd7ac0c40ce965a688c69b6bb384d154c88741b55c017a35d5eacd`) on a clean TEMP `git archive 644bc06` compared with final source:

| Metric | 644bc06 baseline | Final |
| --- | --- | --- |
| Main flow scenarios | 0/39 | 39/39 |
| Held-out flow | 0/10 | 9/10 |
| Task model fields (Stage 7 primitives at baseline) | 6/31 | 30/31 |
| Agent/handoff choice | 5/33 | 33/33 |
| Recovery (mode, gate, reasons) | 0/60 | 60/60 |
| Git state (readiness, lifecycle) | 0/25 | 25/25 |
| Scope correctness | 0/7 | 7/7 |
| Evidence reuse/recheck | 0/6 | 6/6 |
| Skill status / selection sets | 0/10, 0/2 | 10/10, 2/2 |
| Skill precision / recall / irrelevant selected | —, 0, 0 | 1.0, 1.0, 0 |
| Packet content checks | 0/24 | 24/24 |
| Components (triage, safety, strategy, baseline, review, findings, checkpoint, compression, skill use, plan, redaction, packet, parser) | 0/61 | 61/61 |
| Held-out components | 0/4 | 4/4 |
| TEMP Git + CLI integration | absent | 14/14 |

Baseline zeros mean the capability did not exist at `644bc06`; they are not evidence of a wrong decision there. The one held-out miss is honest: "Kapanış belgesi yazıldı ama henüz commitlenmedi" is classified as documentation rather than continuation. The recovery engine still returns the correct `STAGE` gate from repository state; only the task label differs. Production rules were not tuned to the held-out set after it was run.

Performance: 0.049 ms per full pure analysis (task, recovery, skills, tests, review, plan, agent, packet); 0.12 s to build the 382-script test index (built only when tests are needed); 0.9 s for the real-repository CLI including Git and a real-remote check. No LLM is called to choose an agent or model.

## Limitations and deferred work

- Test-safety classification is static and conservative; it can over-flag and cannot see every transitive write. Manual root review remains the authority for promoting a script.
- The task model is lexical Turkish/English. Novel phrasings can mislabel the kind (one held-out miss), though recovery gates come from Git state, not wording.
- Graphify cannot draw edges for the evaluator's dynamic imports, so `review-delta` reports "likely test gaps" for the new modules even though the evaluator exercises them.
- The project-local skills remain unregistered in Claude Code and Codex, and their gitignored files do not sync between machines.
- No chat or Brain UI integration and no Unified Trace span: the trace metadata contract is numeric/boolean-only and in-process, and the CLI has no trace root. Wiring developer intelligence into AYAS chat or the Brain Control Center belongs to later stages.
- Stage 10A — Graphify Validation, Recovery & Integration Normalization — is not implemented here. Canonical Graphify path/remote MCP consistency, the seven PowerShell parser warnings and the semantic-pending marker remain open and pre-existing.
