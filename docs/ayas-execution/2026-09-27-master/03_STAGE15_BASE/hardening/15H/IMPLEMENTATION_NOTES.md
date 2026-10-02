# Stage 15H — Autonomy Burn-In / No-Cloud Independence Certification Framework

Opened 2026-10-02 at `5ad8c0c`. Canonical section: master order STAGE 15H and `01_CANONICAL_SPECS/AYAS_MASTER_SPRINT_V3_PRE_ATOLYE.md` STAGE 15H. Post-freeze addendum: section 0 (unmeasured, unavailable and not-applicable are never counted as a pass; no silent cloud fallback) and section 1 (no blind replay) for the recovery faults.

## What the stage asks for, and where each item is

| Canonical item | Where |
|---|---|
| Cloud coding OFF | Condition `CLOUD_CODING_OFF`, proven by three scenarios of the closure audit and the model router suite |
| Fault matrix, 21 faults | `AYAS_INDEPENDENCE_FAULTS` in `src/lib/ayas/certification/AyasIndependenceCertification.ts`, in the master order's order; a test reads the list out of the master order and compares |
| Representative maintenance task, ten links | `AYAS_MAINTENANCE_CHAIN`, compared with the master order the same way |
| Where each fault and link is proven | `src/lib/ayas/certification/AyasIndependenceEvidenceMap.ts`: 32 requirements, 93 proofs |
| `LOCAL_INDEPENDENCE_READY` or honest `LOCAL_INDEPENDENCE_DEGRADED` | `evaluateAyasIndependence`; there is no third result |
| The record | `scripts/ayas-independence-certification.ts --out`, a sealed JSON file |

## 15H.0 — what already existed

The inspection listed every named scenario of the AYAS suites (2,886) and looked for each fault in them. Every fault already had a scenario that exercises it. Nothing in the recovery, approval or execution code was changed for this stage.

Two things were missing:

- Two suites that hold proofs were not in the eval manifest, so no baseline ran them: `smoke-ayas-research-source-resilience.ts` (rate limiting, a cut connection, a dead source) and `smoke-ayas-graphify-integration.ts` (the `needs_update` marker). Both are offline and write under TEMP only. They are now declared; the second runs with `--gate`, which fails on any case that is missing or failed.
- No suite sent a 5xx answer through the research fetch path. The 404 case took the same branch, but a 500 was never the input. One scenario was added for it, in this stage's suite.

## Design

**A proof** is a suite of the eval manifest plus one scenario of that suite by its exact name, and optionally a marker: a further literal the suite's script must contain, for the cases where the name does not say what the fixture is (the injected `ENOSPC`, the `needs_update` flag, the 401, 429 and 503 answers).

**The collector** (`AyasIndependenceCertificationCollector.ts`) reads, for each proof: whether the suite is declared; whether every file the manifest pins for it has the pinned SHA-256; whether the script holds the scenario name as a whole double-quoted literal; whether it holds the marker; and what the baseline report says about the suite. The scenario is looked for only in bytes the manifest vouches for. It also reads the commit, the tree state, the baseline report's own identity, and every coding model in the lifecycle registry with what `ayasLifecycleMayServe(entry, "AUTONOMOUS_CODING")` says. It is read-only: files, and two Git questions through the existing read-only probe. It runs no suite.

**The evaluator** (`AyasIndependenceCertification.ts`, pure) judges those facts.

- A requirement is `PROVEN` when it has at least one proof and every one of its proofs is bound and its suite passed in a baseline that speaks for this commit. A baseline speaks for this commit only when it ran this commit with this eval manifest.
- Without such a baseline every requirement is `NOT_MEASURED`. A broken binding or a failed suite is `UNPROVEN`, with the cause.
- A suite that passed with declared known limitations does not count: the named scenario could be one of them. Every cited suite is graded by exit status, so this does not arise today.
- The canonical set is closed. A fault or link that is missing, repeated or not in the master order is a gap.
- `LOCAL_INDEPENDENCE_READY` needs no gap at all: every requirement proven, a clean tree, a complete baseline with no failure, and at least one coding model the lifecycle registry lets serve autonomous coding.

**The seal.** The record carries a SHA-256 over its canonical JSON. Verification recomputes the evaluation from the facts in the record, so a record edited to say READY and hashed again is refused.

**Authority.** None. The record says `authority: "NONE"`. Nothing in `src/` or `app/` imports the certification modules or names the READY result; a test scans for it. A READY record would not enable anything by itself: enabling local coding is a lifecycle registry change, which is a reviewed change.

## Burn-in

The baseline runner already supports up to three trials per suite. The record states how many trials its baseline ran. A suite counts as passed only when every trial passed. No threshold was invented: the canonical text gives none.

No live burn-in was run. The observer was not restarted, no model or container was started, and nothing was sent to a provider. What a multi-day run of the real observer would show is not measured here.

## Limits

- A proof says that a scenario with that name is in a pinned suite that passed. It does not say the scenario ran: a suite that skipped a scenario at run time and still exited 0 would not be noticed. The cited scenarios are unconditional, with one exception: the first `needs_update` case in the Graphify suite depends on two modules being present, and `--gate` fails the suite when it is skipped.
- A marker is looked for in the whole script, not inside the scenario.
- Disk exhaustion is an injected `ENOSPC` and injected write failures. No volume is filled.
- The DNS scenario asks the machine's resolver for a reserved `.invalid` name.
- No suite gives a model a repository file with instructions written into it. No local coding model is qualified to read one.
- AYAS has no MCP client. The invalid-schema proofs cover the tool surface that exists; the closure audit pins the absence of an MCP client.
- External credentials: the cloud provider's 401 and the owner session's expiry are proven. The phone gateway's key handling is proven by a suite outside the declared baseline. Git push credentials are the owner's.
- The local patch in the chain comes from a registered deterministic strategy. A patch written by a local coding model is not proven: the one candidate is `DEGRADED` (Stage 15A), which is the gap that decides the result.

## Result

Expected and honest: `LOCAL_INDEPENDENCE_DEGRADED`, with `LOCAL_CODING_BACKEND_NOT_QUALIFIED` as the gap. The record for the stage's source commit is in this folder (`CERTIFICATION.json`), with the baseline report it quotes.

## Verification

- `scripts/smoke-ayas-independence-certification.ts`: 13 scenarios on fixture facts, TEMP repositories and a loopback fixture server.
- `scripts/smoke-ayas-independence-certification-mutations.ts`: 38 of 38 negative controls caught, in a TEMP overlay.
- Eval manifest `15F.4-v10`: 78 suites (four added); v9 kept.
