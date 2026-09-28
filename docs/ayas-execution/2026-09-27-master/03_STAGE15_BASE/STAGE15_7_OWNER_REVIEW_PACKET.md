# Stage 15.7 — First production strategy owner review

Status: proposed only. No production strategy is registered and no patch is admitted.

## Current measured target

- `npx.cmd tsx scripts/smoke-ayas-cognitive-quality.ts --baseline` at `445cec65a4045faee910cfa5777c6b4880c0ae5d`: 53/55; held-out 4/5. The sole non-held-out failure is `stale-free-text-seed` (`STALE_CONTEXT_LEAKAGE`). `heldout-free-text` is the other known failure.
- The target corpus has an earlier `render için FFmpeg kullanacağız` decision and a later explicit correction, `artık render için Remotion kullanacağız`. The current query should receive Remotion without the obsolete FFmpeg decision.
- Both records lack `temporal.factKey`. `ayasMemoryRecordFact` deliberately returns null when v2 temporal metadata exists without a key, so `resolveAyasMemoryTemporal` treats both as independent current facts. `scripts/fixtures/ayas-memory-temporal-cases.ts` currently asserts that old behavior. The retrieval and cognitive evaluators measure it as stale context.

## Proposed narrow authority change for review

Register one deterministic `MEMORY_CONTEXT` strategy only after the owner accepts this exact read-side transition. Its generated sandbox patch would touch only `src/lib/ayas/memory/AyasMemoryTemporal.ts` (one exact source file, at most 80 changed lines). The strategy registration belongs in `src/lib/brain/autonomy/AyasResearchExperimentRegistry.ts`, in a separate owner-reviewed commit. No new dependency, network, provider, runtime/data write, approval, execution or push path is allowed.

The proposed predicate is limited to authoritative user `decision` records whose text explicitly states `render için <tool> kullanacağız`, with a later direct explicit correction of the same render-tool slot. It would derive a closed `user.decision.render-tool` slot and a bounded value from that exact statement shape. Other decisions, unrelated project facts, absent/ambiguous tool names, inferred/imported statements, questions, historical/as-of queries, and records carrying a different explicit fact key remain unchanged. Existing stored records remain immutable. No general free-text contradiction inference is proposed.

The strategy generator must use a fixed source anchor and fixed output, reject if the anchor/source hash differs, and stay within the exact file/line ceiling. The current Stage 8/15 isolated experiment and patch-artifact gates remain authoritative. The generated candidate cannot approve or execute itself; Stage 15.6 still defers unresolved structured impact.

Graphify review analysis for the temporal source and registry reports high blast score 270, 31 impacted files, 17 communities and two test-gap hints. The direct memory, cognitive, retrieval, Stage 8/15 and authority regressions below must close that graph risk; the graph report alone does not grant safety.

## Required proof after owner review

Freeze primary and held-out cases before implementation. The baseline target must fail before the patch, pass after it, and the held-out score must not fall below 4/5. Update the temporal seed's explicit expected state as part of the reviewed contract change; keep historical/as-of, unrelated decision, same-time conflict, imported/inferred, and adversarial false-supersession controls. Run cognitive, memory-temporal, retrieval, conversation, Stage 8, Stage 13/15, approval, artifact and Graphify regressions, plus TypeScript, lint and diff checks. The registry must remain empty if the proposed predicate cannot meet these gates.

## Owner decision needed

Approve or reject the bounded read-side interpretation of existing keyless render-tool decisions and the separate production strategy registration. Approval of this design does not grant approval or execution of any later generated proposal. Until this decision, Stage 15.7 is review-ready and fail-closed.

## 2026-09-28 implementation gate found after owner approval

The exact packet cannot yet pass the existing Stage 8 experiment gate and the required temporal regression together. `project-decision-free-text` in `scripts/fixtures/ayas-memory-temporal-cases.ts` asserts both records are `current` and both are selected. The proposed temporal source patch must make the older one `superseded` and exclude it. Leaving the old fixture makes the post-patch regression fail. Changing the fixture before the experiment makes its pre-patch baseline fail; `evaluateAyasExperiment` rejects any regression suite whose baseline does not pass with `REGRESSION_SUITE_BASELINE_FAILING`. The baseline temporal smoke still passes 52 scenarios on HEAD `445cec6`.

The generator may modify only its declared source `exactFiles`; test fixtures are protected from generated changes. Omitting the temporal suite, weakening its assertion, or applying the source fix first and then registering a strategy with no remaining measured baseline would not satisfy this packet's proof. No source, fixture or registry change has been made. A revised owner-reviewed sequence/test contract is required before implementation; current approval does not authorize widening `exactFiles`, bypassing the regression gate, or weakening the test.

The approved `exp-memory-render-tool-supersession` predicate was tested through the existing TEMP clone and bounded strategy writer using a source-hash-bound diagnostic generator (`scripts/smoke-ayas-stage15-7-candidate.ts`); it did not change the live temporal source. The same cognitive evaluator SHA reported 53/55 before and 54/55 after, with `stale-free-text-seed` fixed and held-out 4/5 unchanged. The existing temporal smoke passed before the candidate and failed afterward. This is a measured regression against the frozen temporal fixture, so no `IMPROVED` evidence, artifact or proposal was claimed and the production strategy registry remains empty. The diagnostic script is uncommitted and is not a production registry entry.

## 2026-09-28 test migration committed; retrieval bookkeeping gate remains

Owner-approved temporal test-contract migration is local commit `b2e8f5c122a8392cedd888122526f87ff3f51547`; the original `445cec6` baseline remains in the ledger. On this new HEAD, the registered strategy draft is uncommitted and the live temporal source is untouched. In TEMP, cognitive improves 53/55 to 54/55, held-out remains 4/5, and memory-temporal, memory and conversation regression suites pass before and after.

The retrieval evaluator alone exits 1 after the candidate because `seed:project-decision-free-text` now passes while still listed as a frozen `KNOWN_LIMITATIONS` entry. Its exact gate says `IMPROVED seed:project-decision-free-text: now passes — remove it from KNOWN_LIMITATIONS`; the other retrieval metrics improve or stay within prior limits. Removing the entry before the experiment would make the baseline fail as an unlisted known limitation; leaving it unchanged makes the candidate fail. No evaluator or known-limitation policy was changed. The candidate is not `IMPROVED` under the complete required regressions, so no artifact or proposal may be produced.

Additional owner review is needed for a bounded transitional known-limitation contract in `scripts/smoke-ayas-retrieval-evaluation.ts`: permit exactly this previously frozen case to be either a recorded limitation at baseline or a recorded resolution in the candidate while preserving all other gate checks, then remove its known-limitation entry in the later owner-approved source-promotion commit. This is an added test-file/policy change outside the earlier exact authorization; do not implement it without approval.

## 2026-09-28 owner-approved evaluator contract and TEMP result

The owner approved the exact evaluator contract. The global known-limitation list remains unchanged; only a measured passing `seed:project-decision-free-text` in the exact Stage 15.7 candidate context is classified `RESOLVED_KNOWN_LIMITATION`, with source/diff hashes. The old production source retains its 53/55 cognitive score, 4/5 held-out, retrieval known limitation and 52/52 temporal smoke. In an isolated TEMP clone, the registered strategy draft changed only 15 lines in the one approved temporal source; cognitive improved to 54/55, held-out stayed 4/5, the exact retrieval limitation resolved, and all four declared regression suites passed both before and after. A separate candidate-only acceptance verified FFmpeg superseded/historical, Remotion current/selected and no persistent rewrite. No live source promotion, durable artifact or owner proposal has yet occurred.

Stage 8 and Stage 13 regression tests contained two old assumptions that the production registry was globally empty. They now exercise their original unregistered and fixture-only conditions explicitly; the closed gates remain tested. Full Stage 8, Stage 13, approval, durable approval, daemon, artifact, mutation, execution, memory, temporal, retrieval, conversation, TypeScript, changed-file lint and diff checks passed. Final Graphify binding and clean-tree durable experiment remain next. The approved strategy registration creates no execution or approval authority.
