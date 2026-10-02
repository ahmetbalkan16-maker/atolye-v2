# Stage 15I — closure

2026-10-02. Source `ebc373cbbd5b5e734d2ee9c2b44eb043262c9a2a` (the feature is `10367e8`; `ebc373c` fixes one new test). State: **CLOSED GREEN as a control plane. Live binding and dispatch are owner-gated and not built.** Notes: `IMPLEMENTATION_NOTES.md`. Summary: `15I_RESULT.json`.

## What exists

- A director session: one read model of one production that binds the sixteen things of the canonical design from read/status evidence. Each binding says whether it is bound, not provided, not produced yet or unreadable.
- A decision per stage, one of five kinds: nothing, wait, a safe operation, a question for the owner, or a code defect routed to controlled self-evolution while the production holds.
- The four safe classes of the design: bounded transient retry, zero-cost provider fallback, regenerating a lost or corrupt local file, resuming an already-authorized stage.
- A read-only collector over the pipeline's own readers, and an operator script that prints the session for one project.

## What AYAS can and cannot do with it today

It can read a production and say exactly what is bound, what failed and why, and what the next safe step would be.

It cannot start any of those steps. Every safe operation is a plan marked `executableByAyas: false`: the one AYAS write action (`resume-stage`) is switched off and owner-gated since Stage 15D, and retry, regeneration and provider selection have no AYAS action at all. This stage opens none of them.

It never plans a spend. AYAS's own budget is zero, so a stage on a paid provider is always a question for the owner, with what was spent, the approved cap and the technical ceiling beside it. It never plans publication, a rights or quality gate pass, a budget increase or a source patch: those are not values of any decision.

## Every canonical item

Five items; the table is in `IMPLEMENTATION_NOTES.md`. The binding list is compared by a test with the canonical spec's own text, and the safe and forbidden lists with the master order's.

## Not built, and who decides

| Not built | Why | Who |
|---|---|---|
| Live watch on the observer tick | Same kind of step as the Stage 15B live binding | The owner approves it |
| Dispatch of a safe operation | The write path is closed | The owner's activation (Stage 15D) |
| A stored owner request per project | A write to project state by the owner's own action | Brain UI V2, Director Session tile (master order section 14) |
| A chat tool for the session | Changes tool routing on the chat path | Brain UI V2 |
| Per-run provider override | The pipeline resolves providers from the environment | A later pipeline change; the fallback is advice until then |

## Tests

17 scenarios, 45 of 45 negative controls in a TEMP overlay, the firewall closure audit, and the declared 80-suite baseline at `ebc373c` with no failure (cognitive 54/55 and held-out 4/5 unchanged). One read-only run against a real project of this workstation. No provider call, stage run, model or push.

The first baseline, at `10367e8`, failed one suite of 80: `durable-task-recovery`. The Stage 15B wiring guard lets no file other than the observer name the durable recovery script, and the new director suite named it. The feature had been committed without running that suite. The fix is in the new suite only; the guard is unchanged; the failed report is kept beside the passing one.

## Known limits

- Fault classes are read from the evidence the pipeline keeps. A stage that fails without structured evidence (the visuals stage on the real project did) is unexplained and goes to the owner.
- A code defect is suspected from the failure's phase or code. A wrong suspicion only holds the production; it changes nothing.
- A running stage is not checked for a live owner; it is reported and left alone.
- The zero-cost alternative for a stage is the one the production path recognises; whether it is installed on the host is not probed.
- The session is not persisted. Each call reads the project again.

## Owner actions (none blocks the master order)

Approve or decline a read-only director watch on the observer tick. The write activation is unchanged from Stage 15D.

## Next

Canonical Stage 15J — Historical Storytelling + Character / Stick-Figure Engine.
