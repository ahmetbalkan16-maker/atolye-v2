# Stage 15K — closure

2026-10-02. Source `b95a71bde06974dbda916f64cf71cc31c6555ff2`. State: **CLOSED GREEN as a governor and a ledger. The pipeline does not call them yet.** Notes: `IMPLEMENTATION_NOTES.md`. Summary: `15K_RESULT.json`.

## What exists

- **A cost governor.** Three separate numbers (preferred target 0.25, the cap the owner approved for the project, technical ceiling 1.00) and one decision before any paid dispatch: continue, pause and ask the owner, or block.
- **The exact escalation.** Above the approved cap and within the ceiling it asks: "Estimated $0.82. Current cap $0.25. Authorize this project up to $1.00?" With no approved cap it asks for one. It returns the question; the answer is not taken there.
- **What the owner sees.** The estimate, the retry reserve, the conservative maximum, the zero-cost alternative for every paid line with what it gives up, and the allowance with a label that says whether it was revalidated.
- **A checkpoint** for the middle of a project: a billable call that would pass the reserved cap is paused before it is made.
- **A reservation ledger and its store.** A cap is reserved before execution, settled with the actual cost, and the rest released. Two projects cannot hold more than the allowance between them, also when they ask at the same moment.
- **An operator script** that prints the governor's report for a project from the pipeline's own estimate.

## What it does not do yet

The pipeline does not call the governor. A production is still stopped by the one technical ceiling, through the existing preflight and the existing guard, which are unchanged. No project cap and no allowance are stored anywhere: both are given per call. The ledger has no live location.

So today the owner can ask, for any project, what it would cost, whether that fits a cap, and what the free alternatives are. A running production is not yet held to a project cap below the ceiling.

## It never raises a cap

An approval above the technical ceiling counts only up to the ceiling. Across 126 combinations of cap, estimate and prior spend, no decision continues above what was approved, and no question names more than the ceiling. An unknown price is never read as zero. Numbers that cannot be trusted block.

## Every canonical item

Thirteen items; the table is in `IMPLEMENTATION_NOTES.md`. Unknown-pricing fail-closed and local-first provider selection were already in place.

## Not built, and who decides

| Not built | Why | Who |
|---|---|---|
| The pipeline calling the governor and the ledger | Changes when a real production stops; needs a stored approved cap first | The owner's approval path (Brain UI V2 cost tiles) and a real run |
| A stored project cap and allowance | The owner's own write | Brain UI V2 |
| A live location for the ledger | Follows from the two above | With the wiring |

## Tests

14 scenarios, 35 of 35 negative controls in a TEMP overlay, and the declared 84-suite baseline at the commit with no failure (cognitive 54/55 and held-out 4/5 unchanged). The scenarios include the pipeline's own estimate, a forced race for a ledger position, and six processes started together. No paid call, provider, model or push.

## Known limits

- The decision uses the estimate, as the design says. Whether the conservative maximum still fits the cap is reported, not enforced.
- The retry reserve is one more run of the most expensive remaining line.
- Video, music and SFX are listed at zero because they are local today.
- The quality tradeoffs of the free alternatives are named, not measured.
- The ledger's files are not signed; whoever can write the directory can add an event. A malformed or out-of-order one is detected and stops every reservation.

## Owner actions (none blocks the master order)

None new. The wiring waits on the cost tiles of Brain UI V2 and on a real production run.

## Next

Canonical Stage 15L — Autonomous Production Fault Repair + Resume.
