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

Manifest v38: 124 suites /146 unique grader pins; v37 archived byte-for-byte from HEAD. Full lint PASS (0 errors /13 inherited warnings), diff PASS. Graphify refresh, source commit and exact clean complete v38 baseline are pending. Stage 16.1 is OPEN until that evidence is recorded.

## Limits and next

Policy/source evidence only. No money movement, network, credential, owner activation, persistent loop or host changes. Existing inherited Graphify coverage (9 files) and semantic PENDING remain explicit. Next: complete source validation/commit, Graphify bound to that HEAD, then the complete declared baseline without source mutations; closure only on evidence. Canonical next stage: 16.2 Unit-Economics Ledger. No push.
