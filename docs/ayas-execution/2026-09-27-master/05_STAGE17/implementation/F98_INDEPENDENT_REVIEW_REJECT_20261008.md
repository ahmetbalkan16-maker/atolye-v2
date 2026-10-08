# F98 — independent Codex review of the original candidate

Date: 2026-10-08 (Europe/Istanbul). Reviewer: separate Codex agent, independent of the Claude author/reviewer session.

**Verdict: REJECT — TWO HIGH FINDINGS REMAIN. Do not promote this original candidate.**

Scope: candidate checkout `C:/Users/Metod/AppData/Local/Temp/f98-dev-5bLB/repo`, base `265f16f`, four dirty files only. Main repository and candidate source were read-only. All attack fixtures, control-plane writes, canaries and report artifacts lived in reviewer-owned TEMP. No live runtime, authority or credential bodies were read. The ongoing Full166 process was neither duplicated nor interrupted.

Read: the owner continuation order, `STAGE17_COMBINED_SCOPE.md`, `STAGE17_COMBINED_BUDGET_INDEPENDENT_REVIEW.md`, the four-file candidate diff, and the production authority reader implementations called by the new binding function.

## Conditions 1–5

| Condition | Result | Evidence |
| --- | --- | --- |
| 1. Missing required root/store or dangling link has a reason; explicit exceptions do not yield full scope | PASS | C24–C28; required absence fails; declared exceptions yield INCOMPLETE_DECLARED_EXCEPTIONS_ONLY and complete=false; lstat distinguishes a dangling link. |
| 2. Receipt includes per-root states/files/bytes, per-store presence and budget id/limits | PASS | C17; protectedCombinedBefore/After contain these records; budget.id supplies the id. |
| 3. External roots bind to the canonical configured realpaths and dev:ino or CLI validates them | FAIL / HIGH H1 | Configured roots are optional. A separate self-published pair qualifies when both configured states are NOT_PROVIDED. |
| 4. maxFiles and total maxBytes boundaries and mutation controls | PASS | Independent execution of --mutations: 33 primary scenarios and 17 caught mutations. C32/C33 exercise exact and one-below boundaries; budgets cannot be loosened. |
| 5. Attribution NONE states endpoint-only | PASS | Receipt protectedAttributionScope=ENDPOINT_SNAPSHOTS_ONLY; collector comment and C17 assert it. |

## H1 — HIGH: a self-published noncanonical root pair still qualifies

Location: `AyasSystemAuditCombinedScope.ts:222–256`; `scripts/ayas-system-audit.ts:12`; C14/C29.

`bindExternalRoots` constructs its context from the caller's runtime and authority and reads the active record from that same caller-selected authority directory. This checks internal agreement, not agreement with independently known canonical configuration. `configuredState(undefined)` returns NOT_PROVIDED; only MISMATCH adds an incomplete reason. CLI passes process environment values, which can be absent even while a running service has a canonical configuration.

Executed TEMP attack: one repository, canonical pair A and independently self-published pair B. Pair A had an extra canonical project file. A inventory: 3 files / 820 bytes. B inventory: 2 files / 794 bytes, ACTIVE_MATCH, configuredRuntime=NOT_PROVIDED, configuredAuthority=NOT_PROVIDED, no incomplete reasons, complete=true, coverage=FULL, externalRuntimeQualified=true. A collector interval using B twice produced mutation.complete=true, attribution=NONE and externalRuntimeQualified=true. The report still said BLOCKED for unrelated evidence gaps; this does not repair the false protected-scope qualification.

Providing A as configured while measuring B correctly produced RUNTIME_ROOT_NOT_CONFIGURED and AUTHORITY_ROOT_NOT_CONFIGURED. Thus the missing-config acceptance is the demonstrated bypass.

Artifacts: `canonical-binding-repro.ts` and `F98_CANONICAL_BINDING_REPRO.json` beside this report. Required repair: refuse completeness/FULL qualification unless both canonical configured roots are independently supplied and MATCH. Keep internal published-authority/marker/recovery checks as additional checks. Add missing-one/missing-both, empty-config, self-published alternate-pair and CLI absent-environment controls. A caller merely relabeling its own explicit roots as configured is not independent configuration evidence.

## H2 — HIGH: binding opens a credential-named file before credential exclusion

Location: `AyasSystemAuditCombinedScope.ts:213`, calling `ProductionRuntimeAuthorityGenerationEnforcement.ts` → `assertAuthorityTransitionState` → `RuntimeAuthorityTransitionStore.listTransitions` (`RuntimeAuthorityTransition.ts:354`) → `readJson` (`:716–733`).

The new binding runs before the bounded inventory and uses a production control-plane reader. `listTransitions` accepts a credential-named transition filename and `readJson` reads its UTF-8 body. The inventory credential rule executes later. Returning incomplete after the attempted read does not satisfy the existing “credentials are never opened” contract.

Executed TEMP canary: `authority-transition-v1/transitions/secret-canary-123.json`, containing only synthetic data. Instrumented fs.readFileSync to throw before reading this specific file. One attempted body read occurred during binding. Final inventory was incomplete with CREDENTIAL_EXCLUDED:authority and EXTERNAL_ROOTS_UNBOUND, proving exclusion occurred too late. Both configured roots were MATCH, so fixing H1 alone does not close H2.

Artifacts: `credential-binding-repro.ts` and `F98_CREDENTIAL_REPRO.json`. Required repair: ensure every binding control-plane read obeys the audit credential policy before body access, and retains safe ancestor/link/hardlink/bounded-read behavior. Add a canary inside transitions, not only a credential file at the authority root. The existing C09/C10 noOpen instrumentation patches fs.openSync; Node 24's UTF-8 fs.readFileSync path can bypass the public openSync function, so instrument readFileSync as well for this attack.

## Digest / receipt verification

Independently rebuilt the manifest JSON from exported reviewed scope/budget/store/exception definitions, fixture realpaths and fresh fs.stat dev:ino identities, and hashed it with node:crypto instead of auditDigest. Configured canonical fixture digest `5e677c1379e415a53e21eca9b4e082268801ad86c47a26c6f5207559451e2117` matched the candidate result. This verifies digest construction on a synthetic configured fixture only. It does not validate the prior real f8143e2 receipt or authorize a new live audit. The old receipt lacks these new rows/binding fields and cannot be retroactively upgraded.

Endpoint snapshots remain unable to see writes reverted within the interval, empty-directory/metadata/ADS changes, or changes after a location's walk. The receipt now states the relevant endpoint-only limitation; no stronger interval immutability claim is accepted.

## Executed verification and limits

- `node --import tsx scripts/smoke-ayas-system-audit-combined-scope.ts --mutations`: PASS, primary=33, sourceMutationsCaught=17.
- Separate canonical substitution attack: reproduced H1.
- Separate binding credential canary: reproduced H2 without reading a credential body.
- Independent synthetic manifest recomputation: MATCH.
- Candidate status after tests: the same four dirty source files. No reviewer edits to candidate/main.
- Sandbox TEMP realpath denied initially; the identical explicitly authorized TEMP-only tests were rerun with escalation. No auto-review rejection occurred.
- Did not re-run Full166, broad regressions, Graphify, TypeScript or live audits. Main session owns those validations.

Candidate source SHA-256 at review completion:

| File | SHA-256 |
| --- | --- |
| src/lib/ayas/audit/AyasSystemAuditCombinedScope.ts | c14e324704b4c0c1e251d603e6a81021d85041474c562d8174553229e8d1d5a3 |
| src/lib/ayas/audit/AyasSystemAuditCollector.ts | d504b032c06a076766bf42094695ed9bb6e44aa19a6f1799dd8a3e73844511f9 |
| scripts/ayas-system-audit.ts | aa61927c84249ade01d2682636ecbc4e5fa1c19706369167c0a9af96d0f33dbd |
| scripts/smoke-ayas-system-audit-combined-scope.ts | 6586f4ed09aef2dbcabafe89f884bc48d298be5d88d430bb4e4cb917b8f77215 |

Revised code must receive another independent review and TEMP attack replay before promotion. This report approves neither original candidate migration nor protected-scope/Stage17/Foundation closure.
