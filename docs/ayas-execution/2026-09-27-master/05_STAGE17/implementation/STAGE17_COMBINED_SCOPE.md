# Stage 17 — opt-in combined protected inventory — 2026-10-08

Implements steps 1–3 of [STAGE17_PROTECTED_SCOPE_INTEGRATION_REVIEW_fde898f.md](STAGE17_PROTECTED_SCOPE_INTEGRATION_REVIEW_fde898f.md). Steps 4–5 (full166 receipt import, per-domain TEST/LIVE binding) are not part of this packet. Foundation remains **BLOCKED**.

## What changed

- **New `src/lib/ayas/audit/AyasSystemAuditCombinedScope.ts`.** `inventoryAyasAuditCombinedScope({repository, runtime, authority})` measures the six fixed repository roots plus the explicit runtime and authority roots under one coverage manifest (`COMBINED_REPOSITORY_RUNTIME_AUTHORITY_V1`).
  - External roots are resolved and validated only (`validateSafeAncestorChain`, real directory, no link). Nothing is created, no authority is acquired, no env or credential body is opened.
  - The manifest digest binds the scope, the budget, root ids, required stores and a digest of each root's real path plus device/inode identity. The output contains no absolute paths.
  - Required stores, each inside exactly one measured root: private memory (`data/brain/memory`), approvals (`data/brain/autonomy`), revenue (`data/brain/revenue`), production projects (runtime `projects`), runtime authority (authority root).
  - Budget `combined-budget-v1`: 40,000 files, 2 GiB, 16 MiB per file (unchanged), depth 20 (unchanged), 300 s. Measured scope on 2026-10-08: about 8,958 files / 1.24 GB; largest runtime file 12.6 MB.
  - Fail-closed reasons: `RUNTIME|AUTHORITY_ROOT_INVALID|ABSENT`, `ROOT_OVERLAP:*`, `STORE_UNCOVERED:*`, `LINK_OR_SPECIAL_ENTRY:*`, `CREDENTIAL_EXCLUDED:*`, `SIZE_OR_BYTE_BUDGET_EXCEEDED`, `FILE_OR_DEPTH_BUDGET_EXCEEDED`, `TIME_BUDGET_EXCEEDED`, `UNREADABLE_OR_CHANGED:*`, `ROOT_IDENTITY_CHANGED:*`. Any reason means `complete=false`.
- **`AyasSystemAuditCollector.ts` (additive).**
  - The credential path rule is exported as `AYAS_AUDIT_CREDENTIAL_PATH` and used unchanged.
  - The bounded file reader and ancestry check are exported under aliases.
  - The inventory type admits the combined scope.
  - `mutation.complete` now also requires the same coverage-manifest digest before and after the interval (`manifestStable`; always true for the local scopes).
  - Combined runs report `protectedCoverageManifestBefore/After/Stable` and `externalRuntimeQualified`. Default and streaming-local outputs are byte-identical in shape.
- **`scripts/ayas-system-audit.ts`.** New opt-in `--protected-combined --runtime-root <abs> --authority-root <abs>`. It is exclusive with `--protected-hash` and takes explicit roots only; no env file is read. Default invocation unchanged.

Not changed: Policy, Gate, Registry, Report, the 166-suite manifest, all frozen graders/fixtures/held files, and every mutation anchor (each still occurs exactly once). An unexplained digest change still yields `PROTECTED_CHANGE_UNATTRIBUTED`. Attribution still requires a real writer receipt; none is accepted from an inventory object.

## Verification

| Suite | Result |
| --- | --- |
| New `scripts/smoke-ayas-system-audit-combined-scope.ts` | PASS, 23 scenarios (C01–C23) |
| Its `--mutations` | 6/6 source mutations caught (credential opened, overlap ignored, missing root accepted, identity change ignored, manifest drift completes interval, hardlink measured) |
| `smoke-ayas-system-audit.ts` (frozen grader) | PASS, 151 |
| `smoke-ayas-system-audit-adversarial.ts` | PASS, held-out 30/30, adversarial 30/30 |
| `smoke-ayas-system-audit-mutations.ts` | PASS, 9/9 caught |
| `smoke-ayas-system-audit-protection.ts` / `--mutations` | PASS 14+6 / 6/6 caught |
| `smoke-ayas-system-audit-boundary.ts` | PASS, 10 checks (real repository git/Graphify probes, read-only) |
| Repo-wide guards | `durable-task-recovery` PASS 22, `discovery-registry` PASS 15. `action-firewall-closure` shows only the pre-existing `app/page.tsx` gap (F96); the CLI adds no entry point or effect |
| `tsc --noEmit`, ESLint on changed files | PASS; 0 problems |
| Repository `data/brain` + `data/projects` fingerprint across all runs | unchanged; no TEMP fixture left |

Attack coverage (review's list): root escape and junction inside a root (C12), junction root (C05), junction ancestor (C06), hardlink (C11), credential canaries never opened (C09, C10), changed coverage manifest across the interval (C13, C14), background write during the interval (C15), forged writer attribution (C16), overlap (C07, C08), budgets (C18–C20), root replaced mid-walk (C21), file growing during its own read (C22), default collector unchanged (C23). C17 shows a complete, quiescent combined interval still does not close Foundation: executed 0/166, every TEST/LIVE slot NOT_RUN.

## Real read-only run

Receipt: [STAGE17_COMBINED_AUDIT_f8143e2.json](STAGE17_COMBINED_AUDIT_f8143e2.json) (SHA-256 `d1f0a2b2a6f47a1331837f1b780cea9308c8b325feb27f0faf2dd29e975c4a6d`). It contains no absolute paths. The run was `scripts/ayas-system-audit.ts --protected-combined` with the configured runtime and authority roots passed explicitly, at clean HEAD `f8143e21a0223a57f7ee54b8549dd0825845c16e`, 2026-10-08T09:00:01.700Z–09:00:11.476Z. Graphify was analyzed and built at that HEAD: not stale, integrity 0, structural PARTIAL, semantic PENDING.

| Measure | Result |
| --- | --- |
| Scope | `COMBINED_REPOSITORY_RUNTIME_AUTHORITY_V1`, manifest stable before/after |
| Files / bytes hashed, before = after | 8,996 / 1,237,387,138 |
| Exclusions (credential, size/budget, link, depth/file, unreadable) | 0 / 0 / 0 / 0 / 0 |
| Protected digest before = after | `ce22006d7a65bc7097f44567bda91bc3cdb19847734fdc6d7bb6f10511a400b5`; attribution `NONE` |
| `mutation.complete`, `externalRuntimeQualified` | true, true |
| Branch/HEAD changed | false |
| Closure decision | `STATIC_AUDIT_COMPLETE`; only reason `LOCAL_OR_LIVE_QUALIFICATION_INCOMPLETE` |
| Coverage | declared 166, executed 0; all 30 TEST/LIVE slots NOT_RUN / COLLECTOR_NOT_BOUND |

This is the first canonical audit without `PROTECTED_SCOPE_INCOMPLETE`. The previous a60b3cf run was BLOCKED. It is one quiescent ~10 s interval; the live server can write `data/brain` during a longer one. It qualifies the protected scope only under the `combined-budget-v1` constants, which still need independent review. It is not a Foundation closure: full166 coverage, the 30 TEST/LIVE bindings and the owner gates are untouched.

## Remaining Stage 17 work

1. The combined budget `combined-budget-v1` was chosen in this packet from measured sizes. It needs independent review before a combined result counts as qualified evidence.
2. One quiescent interval passed. An audit interval that also runs suites will span live `data/brain` writes (phone-access heartbeat, traces), so it needs a bounded writer receipt; until then such a change stays `PROTECTED_CHANGE_UNATTRIBUTED`.
3. Review steps 4–5: same-source full166 receipt import, then per-domain TEST/LIVE binding.
4. Six owner evidence gates (authenticated runtime identity, phone continuity/voice, reboot continuity, Lemon TEST ingress, Fiverr order/revenue/ledger evidence, digest-bound owner review).
5. Next 16.2.10 versus lock 16.3.8 migration in a coordinated restart window.
6. Frozen retrieval-golden succession review.
7. The pinned `action-firewall-closure` grader needs a v58 registration of `app/page.tsx` (F96).
