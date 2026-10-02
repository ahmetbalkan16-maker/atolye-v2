# Post-freeze addendum — integration closure

2026-10-02. Supplement: `01_CANONICAL_SPECS/AYAS_POST_FREEZE_DESIGN_ADDENDUM_V1.md` (SHA-256 `83000846508d32529918b00464c33d6a4fed4f1b1b25a3d67849baa2a584b9fa`, 27,396 bytes). Audit baseline `09e1c68825830924ee5c44ec815598704f443dcb`; last source packet `5c31024d414627d043281193a948d2e6248b1ab9`. Resolve the current HEAD with `git rev-parse HEAD`.

## The addendum's own closure criteria (its section 15)

| # | Criterion | State | Where |
|---|---|---|---|
| 1 | Stored in the canonical execution tree | Met | `01_CANONICAL_SPECS/AYAS_POST_FREEZE_DESIGN_ADDENDUM_V1.md`, byte-identical to the file the owner supplied (`ADOPTION.json`). |
| 2 | Source map and master order reference it as a supplement | Met | Last section of `01_CANONICAL_SPECS/AYAS_MASTER_SOURCE_MAP_V3_2.md` and of `00_COMMAND/AYAS_FINAL_CODEX_MASTER_EXECUTION_ORDER.md`. |
| 3 | Retroactive matrix complete for the stages already implemented | Met | `CONFORMANCE_MATRIX.json` and `.md`: 32 requirements. |
| 4 | Every safe gap fixed with evidence or tracked as a blocker | Met | Four found, four fixed, none open: whole-prompt context budget (`97463c9`), outcome classes and retry accounting (`9d3a159`), tool-action state and barge-in (`5c31024`). |
| 5 | Every owner-gated gap documented without bypass | Met | Two: the declared model window on each machine and on the Worker; acoustic barge-in (device validation). Neither blocks the master order. |
| 6 | Future stages reference the addendum | Met, as a rule to follow | The table below. Each stage's notes must cite the section it applied. |
| 7 | Graphify current after every source change | Met | Updated before and after each of the three source commits; at `5c31024`: 16,541 nodes, 47,796 edges, 9 known partial files, semantic pending. |
| 8 | Checkpoint and ledger reflect the integration | Met | `ACTIVE_CHECKPOINT.json` (`postFreezeAudit`), `EXECUTION_LEDGER.md` (four entries), `ATOLYE_CHECKPOINT.md`. |
| 9 | No stage number or order changed | Met | No stage was created, renamed, reordered or reopened. 15C and 15F stay closed; their notes gained a post-freeze section each. |
| 10 | No owner, security, cost or privacy boundary weakened | Met | Each change either refuses more (unknown window, prompt past the window) or only observes and displays. The execution gate, the action firewall, approvals, leases and budgets are untouched. |

## What the audit found, in one table

| Result | Count | Rows |
|---|---|---|
| Satisfied as built | 6 | memory firewall, telemetry privacy, no host tuning, local artifacts, voice gate, targeted work |
| Satisfied by an equivalent implementation | 6 | durable recovery, tool measurements, existing voice states, waiting-owner, recovering, continuation |
| Found as a safe gap and fixed | 4 | context budget, outcome classes and retry, tool-action state, barge-in |
| Owner-gated | 2 | declared model window, acoustic barge-in |
| Not currently applicable | 14 | browser executor (1), Stage 15Q (6), Stage 15S (4), Stage 15T (3) |

Not-applicable rows are not passes. Each names what must exist first.

## Evidence

- Full declared baseline at `5c31024`: 72 suites, no failure, `PASS_WITH_KNOWN_LIMITATIONS` (cognitive quality 54/55 with its one known limitation, held-out 4/5, both unchanged). Report `PF_AUDIT_CLOSURE_BASELINE.json`, SHA-256 `4b12ac217b0b639cb3952a4682983289531dfa5ac3f27e5b7a582b1667d01764`. Host RAM peak 52.75 %.
- Baseline at `97463c9` (71 suites) and the one before that commit: `PF15C_FULL_BASELINE.json`, `PF15C_PRECOMMIT_BASELINE.json`.
- Negative controls, each in a TEMP overlay: context budget 19/19, telemetry and evidence 16/16, voice and turn state 12/12.
- Production build of the tree at the third packet: PASS in a TEMP clone. The repository's own `.next`, which the owner's running server serves, was not touched.
- No model was run, no container was started, nothing was downloaded, nothing was pushed.

## What the owner has to do (none of it blocks the master order)

1. Set `OLLAMA_NUM_CTX` on every machine that runs AYAS chat. This workstation has 8192. Without it, every model turn answers that the window is not configured.
2. Before the phone gateway Worker is deployed again, set `AYAS_CLOUD_CONTEXT_TOKENS` in `cloudflare/ayas-phone-gateway/wrangler.toml` to the configured cloud model's window.
3. Accept or reject lifecycle entry `evaluator.retrieval.pf15c-v2` (one declared-window line; cases, graders and known limitations unchanged).
4. Rebuild and restart the Next server to load the three packets. Until then the running server serves the build it has.
5. Look at the console once after that: the "Araç çalışıyor" state during a tool turn and the "sözünü kes" control while AYAS speaks have not been seen in a browser.
6. Acoustic barge-in, if wanted, needs a device test first.

## How later stages use the addendum (its sections 12 and 16)

Read the stage's canonical pack first, then the addendum section below, and say in the stage's notes which section was applied.

| Stage or area | Addendum section | Already in place from this audit |
|---|---|---|
| 15Q Hardware / Resource Governor | 4, 9 | The telemetry class that keeps `RESOURCE_ABORT` / `HOST_PROTECTION` out of the failure count; the on-demand policy recorded at the 15A.3 closure. |
| 15S Portable Brain Snapshot | 5, 6 | The local artifact manifest under `bin/ayas-local-coding`. |
| 15T Owner Executive Briefing | 7 | Nothing: no alerting exists. |
| Brain UI V2 (master order section 14) | 8 | The stream's state event, `deriveBrainCoreLiveState`, `interruptSpeech()`. |
| Any stage that sends a prompt to a model | 2 | `AyasContextBudget`: declared window, reserve, shedding, refusal. |
| Any stage that adds a tool or an operation | 3 | Operation evidence and the nine outcome classes. |
| A browser or session executor, if one is ever added | 1 | The durable task journal and its recovery sweep. |
| Every handoff | 10, 11, 12 | `01_CANONICAL_SPECS/AYAS_CONTINUATION_PROTOCOL_V1.md`, `ACTIVE_CHECKPOINT.json`, `EXECUTION_LEDGER.md`. |

## Next

Canonical Stage 15G (SBOM / Provenance / Release Trust). Local commits only. No push.

## Re-evaluation at the Stage 15Q closure (2026-10-02)

The table above is the audit as it closed. Stage 15Q has since been built, so its six not-applicable rows were looked at again at the stage's source closure (`ab6e5312d7b8b8d8893b4dfca59bfe510bb29ef4`, `03_STAGE15_BASE/hardening/15Q/CLOSURE.md`):

| Row | Now | Why |
|---|---|---|
| 15Q-health | SATISFIED | Five classes; a sensor that cannot be read is absent, never a number. |
| 15Q-single-heavy | SATISFIED (found GAP_SAFE_TO_FIX, fixed) | One heavy capacity holder; the owner's RAM limit; resource abort apart from model failure. F31 and F32 were found and fixed in 15Q.3. |
| 15Q-on-demand | GAP_OWNER_GATED | The lifecycle is a tested source contract; the engine is unregistered and the logon startup entries are the owner's. |
| 15Q-lazy-prewarm | SATISFIED | Lazy by default; nothing prewarms. |
| 15Q-active-app | GAP_OWNER_GATED | Coarse signals inside the privacy boundary; the owner-activity signal is the owner's choice. |
| 15Q-image-cleanup | SATISFIED | Read-only classification; no prune surface. |

The matrix now reads 8 not applicable (browser executor 1, Stage 15S 4, Stage 15T 3), 6 equivalent, 14 satisfied, 4 owner-gated, no open safe gap.
