# F98 — independent Codex re-review of the revision

Date: 2026-10-08 (Europe/Istanbul). Reviewer: separate Codex reviewer agent.

**Verdict: QUALIFIED_PASS_WITH_LIMITATIONS for the revised source packet. No remaining HIGH finding was demonstrated. Both original HIGH findings are closed by the revision and independent TEMP replay.** This is permission to promote the reviewed source packet after the main session's required checks, not a protected-scope PASS receipt or Stage17/Foundation closure.

Reviewed revision: `C:/Users/Metod/AppData/Local/Temp/ayas-codex-stage17-20261008/repo`, based on `265f16f`, six changed source files. The two added security-module changes only export existing pure shape validators; no production writer or reader behavior changes. Reviewer made a separate 22-file static dependency copy at `C:/Users/Metod/AppData/Local/Temp/f98-codex-rereview-3df6ff64950e4224aecdc1c3e1c3d9c6/repo`. All executed scenarios, mutations and additional attacks ran there or in reviewer-owned synthetic TEMP fixtures. Main and revision source remained read-only. No live runtime/authority/credential body was accessed, and Full166 was neither duplicated nor interrupted.

## Conditions 1–5

| Condition | Result | Verification |
| --- | --- | --- |
| Missing required root/store or dangling link produces a reason; declared exception is never full scope | PASS | C24–C28 and the required store/root implementation. Exceptions retain scope/reason and absence remains incomplete. Runtime/authority exceptions require both canonical MATCH values as well as ACTIVE_MATCH. |
| Receipt root states/files/bytes, store presence, budget id/limits | PASS | C17. Both endpoint summaries retain the rows, binding, reasons and budget.id/values. |
| Canonical configured realpath/identity binding | PASS within the explicit trusted-input boundary | NOT_PROVIDED and MISMATCH now both add reasons; C29/C31/C34/C35 and independent missing-config/substitute-pair attacks pass. CLI supplies process configuration separately from explicit audited-root flags. |
| maxFiles/total maxBytes exact and crossed boundaries plus source mutations | PASS | Independent --mutations execution: 37 primary scenarios / 21 caught mutations. C32/C33 retain exact and one-below controls and refused budget loosening. |
| Attribution NONE explicitly endpoint-only | PASS | C17 and receipt protectedAttributionScope=ENDPOINT_SNAPSHOTS_ONLY. |

## Original HIGH findings

**H1 CLOSED:** Missing trusted configuration cannot qualify. The independent harness built a canonical pair and a different self-published alternate pair for the same workspace. The alternate's internally coherent ACTIVE_MATCH does not overcome the canonical mismatch: both NOT_CONFIGURED reasons appear, complete=false and no FULL qualification. Omitting configuration produces the same two reasons. Empty/partial values are covered by C34. Configured junction ancestors are refused by C35. Successful fixture inventories use separately supplied canonical fixture roots.

Trust boundary: the inventory accepts a `configured` argument from its trusted caller; it cannot prove that a malicious caller has not falsified both audited and configured inputs. CLI binds this argument to process configuration. Evidence promotion must still establish that these process values are the actual operator/service configuration. A new live receipt with externally corroborated canonical values is required; the old f8143e2 receipt is not retroactively upgraded.

**H2 CLOSED:** Binding no longer calls generic production file readers. It uses auditReadFile with bounded body inclusion, checks credential names before access, validates ancestors, rejects hardlinks and unsafe entries, verifies file identity across the read, and observes binding limits/deadline. The shape validators are pure. The independent credential transition canary was instrumented at both fs.openSync and fs.readFileSync: zero body access attempts occurred. C36 independently includes the same regression. No credential exception is used to reach completion.

Active authority identity, resolver binding and generation must all agree with expected identity, and all expected marker fields must agree. A missing/corrupt marker, corrupt active identity, transition in progress, or quarantine presence leaves the binding UNBOUND. Quarantine/lift is intentionally conservative: the audit does not inherit a production rollback exception automatically.

## Independent executed checks beyond the revised smoke

All **11/11 PASS**, recorded in `F98_REVISION_INDEPENDENT_CHECKS.json` with executable `independent-checks.ts` beside this report:

1. Missing canonical configuration stays incomplete.
2. A self-published substitute pair is rejected against canonical configuration.
3. A credential-named transition has zero open/readFileSync accesses.
4. A hardlinked runtime marker has zero open/readFileSync accesses.
5. A pre-existing authority control-plane junction permits zero outside-body accesses and is UNBOUND.
6. An oversized active record is rejected before opening.
7. A binding byte budget below the active record size refuses that body before opening.
8. Corrupt active authorityIdentity is UNBOUND.
9. A valid transition record in progress is UNBOUND.
10. Any quarantine mark is refused conservatively.
11. The manifest independently rebuilt from reviewed exported scope/budget/store/exception definitions, canonical fixture native realpaths and fresh fs.stat dev:ino identities hashes to the candidate coverageManifestDigest using node:crypto rather than auditDigest.

The revised smoke/mutation command, executed from the reviewer's copy, returned `PASS`, primary=37, sourceMutationsCaught=21. This verifies source controls fail by assertions, not syntax/module errors.

## Nonblocking limitations; no stronger claim accepted

- This is a static endpoint inventory. A write reverted inside the interval, a write behind a completed walk, empty-directory/metadata/ADS changes, and control-plane changes after their binding read are outside its atomicity guarantees. Existing file-identity and ancestry checks detect many concurrent changes but do not create a filesystem transaction. Concurrent adversarial ancestor/junction replacement between path checks and open is not proved impossible; the final component O_NOFOLLOW and post-read checks do not themselves prove atomic ancestor isolation. No fully immutable live interval or credential isolation against an actively hostile filesystem writer is claimed by this review.
- Directory listings are still read/sorted whole. A wide directory's allocation is not independently capped before readdir completes. This inherited LOW limitation remains.
- Binding has bounded readFiles/readBytes counters separate from the inventory's unique-file counters and shares the deadline. Reading binding records and later hashing them introduces bounded extra I/O, so receipt bytesHashed describes inventory bytes, not every byte read including binding overhead. There is no unbounded production-reader scan in the binding now.
- The conservative quarantine refusal can block an otherwise valid production rollback with a lift. It must be documented; no automatic full-scope exception is granted.
- Missing legacy roots/store gaps will continue to produce INCOMPLETE; this is the owner policy, not a reason to fabricate directories or loosen a test.
- No live manifest, prior real receipt, authenticated runtime identity, TEST/LIVE qualification, Full166 import, TypeScript, broad regression or Graphify claim was independently certified here. Main session retains those checks.

## Reviewed revision SHA-256

| File | SHA-256 |
| --- | --- |
| src/lib/ayas/audit/AyasSystemAuditCombinedScope.ts | 9f764dd8af8bdefd5f932dd112f3986da41beea5ab9bfcf9e3bab3f683065ad4 |
| src/lib/ayas/audit/AyasSystemAuditCollector.ts | d504b032c06a076766bf42094695ed9bb6e44aa19a6f1799dd8a3e73844511f9 |
| scripts/ayas-system-audit.ts | aa61927c84249ade01d2682636ecbc4e5fa1c19706369167c0a9af96d0f33dbd |
| scripts/smoke-ayas-system-audit-combined-scope.ts | 89154fbdfb7cc06603e930ba633912d83607e9923f7332d25d579597b719bed4 |
| src/lib/runtime/security/RuntimeAuthorityGenerationMarker.ts | 3531dc0911eb7f5468d985db0c4c9089f04b44a3363e554e50280244d72f9e6f |
| src/lib/runtime/security/RuntimeAuthorityTransition.ts | eb9674de30ade54eedd1b5a59590dc51adffdce1e22c319ab0935c825dde5ce2 |

Approval is tied to these bytes and the limitations above. Material source changes require another review. The original rejection report is retained separately as history; it does not describe this revised packet's current status.
