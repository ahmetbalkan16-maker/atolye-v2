# Stage 16.4 — Etsy adapter takeover

Canonical design: final master §10 / 16.4 and 04_STAGE16_REVENUE/16.4. The attached post-freeze addendum matches the canonical copy byte-for-byte (SHA256 83000846508d32529918b00464c33d6a4fed4f1b1b25a3d67849baa2a584b9fa); its resource/continuation rules apply. No new architecture, production registration or external authority.

Takeover: 1ba03b4eb1abcf0a79d1ac599fd16a1f7606306b, 11 ahead / 0 behind; unstaged/untracked 16.4 source preserved. Initial Graphify was bound to e20eb57 and stale relative to HEAD/worktree. AST refresh before source changes: 18304 nodes / 52326 edges / 383 communities, zero integrity anomalies, correct current HEAD and worktree coverage; inherited PARTIAL nine files / semantic PENDING remain explicit. Relevant Graphify review: 139 impacted nodes / 31 files, existing 16.0 registry → operation/spend/connection gates → fixed GET transport → bounded normalization; mapper → 16.2 immutable ledger inputs only; webhook → verified pointer → canonical reread.

Inherited evaluator reproduced 67+12 PASS and 82/82 controls. Five new primary regressions first failed (67/72 +12/12), proving F62–F64. Repairs: check listing/payment shop identity and adjustment parent payment; bound and currency-bind mapper money, require both effect flags false, preflight descriptors/size/depth before copying one stable snapshot; oversized refund amount becomes unknown. Frozen held-out unchanged. Current focused 72+12 PASS, controls 89/89 assertion-caught, no equivalents. Public official OpenAPI re-fetch matches the inherited spec hash exactly; operation and money-field excerpt recorded in 16.4_OFFICIAL_SPEC_RECHECK.json. Authentication/rate-limit/webhook official pages were checked.

Review is inherited-source review plus same-session repair audit, not a separate-agent review. The mapping schema does not authenticate a fabricated envelope; a trusted collector must supply canonical adapter results. No live account, credentials, network adapter invocation, listing, money, model or host activation. Production registry empty.

Manifest v43:134 suites /162 unique pins; v42 archive preserved. Full v43 baseline NOT_RUN; last complete baseline remains 5cbb217 /v38. Focused/static evidence is recorded; selected regressions and exact source/Graphify closure pending. Stage 16 remains OPEN. Next canonical substage after closure:16.5 Upwork.

## Exact source closure — 2026-10-03T11:20:00.634Z

Exact source `6c96d07299eb743b45ff5474da6256f3a1c9a579`:72/72 primary +12/12 frozen held-out,89/89 assertion-caught controls;19 selected declared suites and6 extra regressions PASS on that same source with no source mutation.162 committed pins match current/committed bytes;134 suites declared in v43, fullv43 baseline NOT_RUN. TypeScript and changed lint PASS; full lint0 errors/13 inherited warnings; diff PASS before source commit. Graphify18305/52340 on exact source,stale=false,needs_update=false,zero integrity anomalies;PARTIAL9 andsemanticPENDING are inherited limitations, never COMPLETE claims.

F62–F64 reproduced before correction and repaired without changing frozen held-out assertions. Official Etsy OpenAPI public re-fetch matches the inherited hash. Source is read-only plus local drafts; verified webhook remains a pointer, ledger mapper produces inert inputs. No live account, credential, external listing, money, model or host activation. Production registry empty. Review: inherited-source review plus same-session repair audit; no separate-agent review.

Stage16 remains OPEN. Next canonical16.5 Upwork. Exact proof:16.4_EXACT_SOURCE_RECEIPT.json,16.4_REGRESSIONS.json,16.4_EXTRA_REGRESSIONS.json. Push remains at majorStage16 boundary.
