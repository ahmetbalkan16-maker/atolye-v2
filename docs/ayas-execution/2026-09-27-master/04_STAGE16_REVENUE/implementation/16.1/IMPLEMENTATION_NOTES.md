# Stage 16.1 — Revenue Zero-Cost / Spend Gate

Canonical authority: final execution order §16.1, source-map Revenue Center, and the three existing files under 04_STAGE16_REVENUE/16.1. The adopted post-freeze supplement matches the attached addendum byte-for-byte (83000846…84b9fa); its completed retroactive audit is reused.

## Resume truth

Started at ee2118452d9df58bb78fc1035419a7ae40a0df2a on wip/ayas-graphify-final-execution; git pull up to date, origin parity 0/0. Inherited uncommitted policy, two evaluators, policy document, registry binding and BrainPatchSafety protection. No staged work. Checkpoint was the older 16.0/16.0A closure. Preserved all six WIP paths. Latest owner command explicitly says PUSH YOK / LOCAL COMMIT; it supersedes the older push authorization and AGENTS.md session-end push exception.

## Review and changes

Current Codex reviewed the previous author's WIP against the canonical design, existing action policy, global zero-cost policy and Graphify context before repairing it. This is the independent continuation review of the inherited work; the repairs below were authored and self-verified by the current reviewer, with no second reviewer on those repairs.

- Literal zero autonomous/upfront budgets, exact-key intent, closed money-event/cost/source/currency classes, bounded integer minor units. No FX, balances or expected/realized revenue offsets.
- Every financial operation and active monetary event denied; missing amount and unknown cost denied; passive fee observation only a READ_ONLY PLATFORM_FACT with an amount. Zero-cost external writes remain subject to the existing owner action gate; spend neutrality grants no action authority.
- The unchanged global AyasZeroCostPolicy decides transport cost. Local/offline reads remain eligible; drafts require local-zero-cost. The existing read/draft runner invokes the spend policy before dispatch. No live adapter, credential, executor, account or financial IO added.
- F44: reproduced 36/38 primary + 10/10 held-out. Fixed the unjustified refusal of local zero-cost reads and passive fee rejection classification for drafts; original assertions retained.
- F45: code review found nested amount getters executed by structuredClone and throwing Proxy reflection escaped the decision. Descriptor validation precedes clone; hostile exceptions become INVALID_MONEY_INTENT. Added primary P39/P40; held-out cases unchanged.
- F46: mutation replacements were stale after the prior author's policy rewrite. Rebound them to the actual guards; added getter, Proxy exception and nested authority-field controls. Mutants count as caught only by an assertion in the named scenario; loader errors/timeouts never count.
- F47: standalone eval-governance smoke still expected 114 suites (even baseline v37 has 122). Reproduced 124 != 114; updated the exact count to 124 and required all six revenue suite identities. Validator and grading thresholds unchanged.

## Evidence before source commit

40 primary + 10 frozen held-out PASS in the mutation audit's owned gitless TEMP copy; 36/36 negative controls PASS. TypeScript --noEmit --incremental false PASS; changed-file ESLint 0/0 PASS. Adapter-standard, account-boundary, global zero-cost, firewall closure PASS via the existing isolated baseline runner. Nine additional BrainPatchSafety/manifest regressions PASS in a TEMP local clone with no remote/credential environment (details in 16.1_FOCUSED.json). Eval-governance 10 scenarios and 8/8 mutants PASS.

Manifest v38: 124 suites /146 unique grader pins; v37 archived byte-for-byte from HEAD. Full lint PASS (0 errors /13 inherited warnings), diff PASS. Source commit 5cbb21706eb12693555a9fefbc7554fadf175049; Graphify bound to it, stale=false / needs_update=false, zero integrity anomalies. Exact clean v38 full baseline124/124 PASS_WITH_KNOWN_LIMITATIONS (cognitive-quality), no unexpected failure. Stage16.1 remains OPEN pending independent review of the repairs authored by this session.

## Limits and next

Policy/source evidence only. No money movement, network, credential, owner activation, persistent loop or host changes. Existing inherited Graphify coverage (9 files) and semantic PENDING remain explicit. Next: complete source validation/commit, Graphify bound to that HEAD, then the complete declared baseline without source mutations; closure only on evidence. Canonical next stage: 16.2 Unit-Economics Ledger. No push.

## Current handoff / review gate

Full baseline SHA-256 ed7427231bb84921fb6bf921b7df2d601523831adf52ed3a59fe4f64370edd09; sampled RAM maximum 63.83%. All146 grader pins match committed and worktree bytes. Test/source/fixture integrity checks passed. No live revenue directory exists. The final repair delta has not been reviewed by a second reviewer; an explicit owner authorization request for read-only review subagents is pending. An unanswered/preselected option grants no permission. This is TESTED_SOURCE_PENDING_REVIEW, not a closed GREEN stage.

The source commit is 5cbb21706eb12693555a9fefbc7554fadf175049. A following documentation-only WIP save may be the actual Git HEAD; resolve it with git rev-parse HEAD and verify the local worktree. No push. Required next action: obtain the reviewer authorization (or owner review), complete the final independent review, minimally repair any actual defect and run affected tests/Graphify, then close16.1 and continue16.2. Do not rerun the unchanged32.7-minute full baseline without a change/failure that justifies it.

16.2 preparation was read-only: canonical16.2 pack, RuntimeStoragePaths ensureSafeContainedDirectory/requireContainedRealDirectory, AyasExecutionAuthorityLock, and existing atomic/fsync writer idioms were inspected. No16.2 source exists and no new stage was certified. Revenue and production ledgers must stay separate; any ledger write must respect SAFE_READ_ONLY and keep live data untouched by tests.

## Independent closure — 2026-10-03T06:51:20.587Z

Owner devam et authorized the pending read-only independent review. Reviewer /root/revenue_review inspected ee21184..5cbb217, confirmed baseline digest/124 results/146 pins/v37 archive, and found no defect. No tests, edits, commit or push by reviewer. Repairs now independently reviewed; Stage16.1 source CLOSED_GREEN. Last exact full baseline remains5cbb217; docs-only review closure does not relabel it. Next canonical16.2, local commits only / NO PUSH.
