# Stage 15K — Production Cost Governor

Opened 2026-10-02 at `4e458f4`. Canonical section: master order STAGE 15K; `01_CANONICAL_SPECS/AYAS_MASTER_SPRINT_V3_PRE_ATOLYE.md` STAGE 15K; directive V3.2 section 10. Post-freeze addendum: section 0 was applied (no autonomous spend; unknown pricing and unknown authority fail closed; nothing here raises a cap).

## What the stage asks for, and where each item stands

| Canonical item | State | Where |
|---|---|---|
| Three separate numbers: preferred target, project-approved cap, technical ceiling | Built | `PRODUCTION_COST_POLICY` and `governProductionCost` in `src/lib/production/ProductionCostGovernor.ts` |
| Initial policy: 0.25 target, 1.00 ceiling, 9.85 owner-declared allowance, labelled when used | Built | The policy constants; the allowance carries its basis and a label |
| Preflight before paid dispatch: LLM, image, video, TTS, music/SFX, retry reserve | Lines built on the existing estimate | `costComponentsFromEstimate`; retry reserve in the report |
| Output: estimated total, conservative max, free/local alternatives, quality tradeoff, projected remaining allowance | Built | `CostGovernorReport` |
| Estimate within the approved cap: continue | Built | `WITHIN_APPROVED_CAP` |
| Above the cap, within the ceiling: pause and ask the exact escalation | Built | `ABOVE_APPROVED_CAP`, with the design's sentence |
| AYAS cannot raise the cap | Held | The governor returns a question; an approval above the ceiling counts only up to the ceiling |
| Above the ceiling: block | Built | `ABOVE_TECHNICAL_CEILING` |
| Reserve the approved cap before execution; concurrent projects cannot oversubscribe | Built as a ledger and a store; not connected to a production run | `ProductionCostReservationLedger.ts`, `ProductionCostReservationStore.ts` |
| Completion: settle the actual cost, release the unused reserve | Built | `SETTLE` and `RELEASE` events |
| Mid-project projected exceed: pause before the next billable call | Built as a decision; the existing guard already blocks at the ceiling | `governProductionCostCheckpoint`; `AiCostBudget` / `MediaGenerationCostGuard` |
| Unknown pricing fails closed | Already in place, and held in the governor | `evaluateAiCostBudget`; `UNKNOWN_PRICING` |
| Prefer local and free where quality passes; paid generation is the exception | Already in place as provider selection; the report lists the zero-cost alternative for every paid line | `ProductionProviderResolution`; `alternatives` |

## 15K.0 — what already existed

- `ProductionCostEstimate`: a conservative, provider-aware pre-run estimate with a per-component breakdown. A component without a price row makes the whole estimate `unknown`.
- `ProductionCostPreflight`: estimate plus observed spend against one budget, with a pass or a block.
- `AiCostBudget` and `MediaGenerationCostGuard`: the runtime guard that blocks a paid token, image or speech call before it is sent when the projected spend would pass the budget, or when any price is unknown.
- `ProductionCostReceipt` and `ProductionCostReport`: what a run cost, after it.
- One number for all of it: the technical ceiling, 1 USD by default (`ATOLYE_AI_COST_BUDGET_USD`).

Missing: a project-approved cap distinct from the ceiling; the pause between cap and ceiling; the allowance; any reservation across projects.

## Design

**Governor** (`governProductionCost`, pure). It takes the remaining estimate per line, what was already spent, the cap the owner approved for this project (or none), the policy and the allowance, and returns one of three decisions with the reason:

| Situation | Decision |
|---|---|
| Nothing to pay | `CONTINUE`, nothing reserved |
| Any price unknown | `BLOCK` |
| Estimate above the technical ceiling | `BLOCK` |
| No cap approved for the project | `PAUSE_ASK_OWNER` |
| Estimate above the approved cap | `PAUSE_ASK_OWNER`, with "Estimated $0.82. Current cap $0.25. Authorize this project up to $1.00?" |
| No allowance declared | `PAUSE_ASK_OWNER` |
| Reserving the cap would pass the allowance | `BLOCK` |
| Otherwise | `CONTINUE`, reserve the approved cap |

The preferred target is a target. A paid estimate under it still needs a cap the owner approved: the directive says a project cap is the owner's explicit approval. The question then suggests the target when the estimate fits it, and the ceiling otherwise.

The estimate is what was spent plus what the rest is estimated to cost. The retry reserve is one more run of the most expensive remaining line; the conservative maximum is the estimate plus that. The decision uses the estimate, as the design says; whether the conservative maximum still fits the cap is reported beside it.

Numbers that cannot be trusted (negative, not finite, a line twice, an unknown line, an allowance that contradicts its basis) block.

**Checkpoint** (`governProductionCostCheckpoint`). Before the next billable call in a running project: a free call continues; a paid call with nothing reserved pauses; a projected total above the reserved cap pauses; an unknown price blocks.

**Ledger** (pure). Three events: `RESERVE` a cap for a project, `SETTLE` it with the actual cost, `RELEASE` it unused. One active reservation per project. Settled spend and every active cap count against the allowance; a reservation that would pass it is refused. A settlement above its cap is counted in full and named as an overrun. A malformed event, a reused id or a settlement of nothing makes the ledger untrusted, and an untrusted ledger admits nothing.

**Store.** One file per event, named by its position. An event is written whole to a private file and then linked into place; the link fails if the position is taken. A writer that loses a position reads the ledger again and decides again. Six processes started together, each asking for 0.3 of an allowance of 1.0, end with exactly three reservations. A gap in the numbering, a stray file or a damaged record makes the store untrusted.

**Operator script** (`scripts/run-production-cost-governor.ts`). Builds the pipeline's own preflight for a project and prints the governor's report. It reads a ledger when given one. It reserves nothing and makes no paid call. Exit code 0, 2 or 3 for continue, pause or block.

## What is not built, and why

- **The pipeline does not call the governor.** The acceptance preflight and the runtime guard still use the one technical ceiling. Putting a project cap into them changes when a real production stops, and that needs the owner's approved cap to exist somewhere durable first.
- **No stored project cap or allowance.** The cap and the allowance are given per call. A durable record is the owner's own write; it belongs with the Director Session and cost tiles of Brain UI V2.
- **The ledger has no live location.** The store takes a directory from its caller; nothing points it at the runtime root.
- **Music and SFX and video are listed at zero** because they are local today. A paid music source would need its own line and price.
- **The quality tradeoffs are named, not measured.** No local model is qualified (Stage 15E), and the report says so for the text lines.

## Verification

- `scripts/smoke-ayas-production-cost-governor.ts`: 14 scenarios on fixture numbers and TEMP directories, including the pipeline's own estimate, a forced race and six real concurrent processes.
- `scripts/smoke-ayas-production-cost-governor-mutations.ts`: 35 of 35 negative controls caught, in a TEMP overlay.
- Eval manifest `15F.4-v14`: 84 suites (two added); v13 kept.
