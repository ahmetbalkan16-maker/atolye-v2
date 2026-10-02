# Stage 15H — closure

2026-10-02. Source `930b53797fa8d84693d6c4d1d6e234bddf0e6b31`. State: **CLOSED. Certification result `LOCAL_INDEPENDENCE_DEGRADED`, one gap.** Notes: `IMPLEMENTATION_NOTES.md`. Record: `CERTIFICATION.json`. Summary: `15H_RESULT.json`.

## The result

`LOCAL_INDEPENDENCE_DEGRADED`, for one reason: `LOCAL_CODING_BACKEND_NOT_QUALIFIED`.

All 32 requirements are proven at this commit: the 21 faults of the matrix, the ten links of the representative maintenance task, and the cloud-off condition. The baseline ran 78 suites three times each with no failure. The tree was clean.

What is missing is a local coding model that may write the patch. The lifecycle registry holds one coding model, `coding-model.local-coding.qwen2.5-coder-14b-q4km`, in state `DEGRADED` with admission `NONE`: Stage 15A ran it on one case and it did not pass. The lifecycle's serving rule does not let it do autonomous coding, so the certification cannot be READY. Cloud coding stays off; nothing falls back to it.

So today AYAS can carry a maintenance task from detection to rollback without the cloud only when the patch comes from a registered deterministic strategy. It cannot write a new patch by itself.

## What exists

- The fault matrix and the maintenance chain as code, compared by a test with the master order's own text.
- An evidence map: for each of the 32 requirements, the named scenarios of declared suites that prove it (93 proofs), with what the proofs do not cover.
- A read-only collector and a pure evaluator. READY needs no gap at all. Anything unread, unbound or unmeasured is DEGRADED.
- A sealed record. One relabelled READY and hashed again is refused.
- An operator script that prints, writes a new record, or checks a stored one and names what changed.

## What was already there

Every fault had a proof before this stage. Two suites that hold proofs were not declared in the eval manifest and are now (research source resilience; Graphify integration with `--gate`). One scenario is new: a 5xx answer on the research fetch path. No recovery, approval or execution code changed.

## Tests

13 scenarios, 38 of 38 negative controls in a TEMP overlay, the firewall closure audit, eval governance, and the declared 78-suite baseline at the commit, three trials each, with no failure (cognitive 54/55 and held-out 4/5 unchanged). No model, container or network provider was used, and nothing was pushed.

## Known limits

A proof says a named scenario is in a pinned suite that passed; it does not see a scenario skipped at run time. Disk exhaustion is an injected `ENOSPC`. No live burn-in of the running observer was done. AYAS has no MCP client, so there is no MCP schema proof. The full list is in the notes.

## What would change the result

One thing: a local coding model that reaches `ACTIVE` through the lifecycle's promotion checks. That needs the owner's decision recorded at Stage 15A (a numeric threshold, another model or engine, or GPU passthrough) and a new qualification. Then run the baseline and the operator script again; nothing else in this stage has to change.

## Owner actions (none blocks the master order)

The Stage 15A decision above, if local coding is wanted. Everything else is unchanged from Stage 15G.

## Next

Canonical Stage 15I — AYAS ↔ Atölye Live Production Director.
