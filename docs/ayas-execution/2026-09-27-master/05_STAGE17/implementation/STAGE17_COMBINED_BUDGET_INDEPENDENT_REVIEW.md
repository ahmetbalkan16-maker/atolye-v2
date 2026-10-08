# Stage 17 — independent review of `combined-budget-v1`

Date: 2026-10-08. Subject: the opt-in combined protected-scope inventory from `f8143e2` and its real-interval receipt `STAGE17_COMBINED_AUDIT_f8143e2.json` (8,996 files / 1,237,387,138 bytes, zero exclusions, closure `STATIC_AUDIT_COMPLETE`). Owner decision 4: an independent review is required before the evidence may be promoted.

**Verdict: QUALIFIED_PASS_WITH_CONDITIONS — NOT PROMOTED.** The budget limits fail closed. The receipt still does not qualify as protected-scope evidence, because missing roots and stores count as covered, and nothing binds the external roots to the configured ones. The receipt stays as recorded; the closure label is not upgraded.

## Method

- Reviewer: a separate cold-start agent with no access to the authoring session's reasoning. Read-only on the repository. It executed code only in its own `git archive e974614` copy against TEMP fixtures, never against the real runtime or authority roots. It removed the copy afterwards; the repository stayed clean at `e974614`.
- The main session re-checked the two HIGH findings against the real repository and the receipt (below).
- Not independent of the model family: the author and the reviewer are both Claude. A Codex or human review would add independence.

## Limits (`src/lib/ayas/audit/AyasSystemAuditCombinedScope.ts:34-41`)

| Limit | Value | Applies to | Recorded run | Headroom |
| --- | ---: | --- | ---: | ---: |
| maxFiles | 40,000 | union of roots | 8,996 | 4.4× |
| maxBytes | 2,147,483,648 | union of roots | 1,237,387,138 | 1.74× |
| maxFileBytes | 16,777,216 | each file (never opened above it) | largest 12.6 MB (from the doc, not re-measured) | 1.33× — tightest |
| maxDepth | 20 | per root, from 0 | not recorded | unknown |
| deadlineMs | 300,000 | each inventory | ~9.8 s whole audit | ~30× |

Files are streamed in 256 KiB chunks. Hitting any limit adds a reason, so the closure becomes `PROTECTED_SCOPE_INCOMPLETE` / BLOCKED. This is fail-closed, and the reviewer executed it. Links, junctions, hardlinks (nlink ≠ 1), non-regular entries, credential-named files, read errors and files that change while being read also add a reason. A single file over 16 MiB (for example one rendered video in the runtime) blocks every combined audit: fail-closed, but it stops audits from passing.

## Findings

| # | Severity | Finding | Verified by |
| --- | --- | --- | --- |
| B1 | HIGH | **An absent root or store counts as covered, with no reason.** An ABSENT repository root only sets `state: ABSENT` (`:236-240`). Store coverage is a lexical containment check (`:149-155`) that never tests existence. Three empty directories reproduce the same closure as the real receipt: `STATIC_AUDIT_COMPLETE`, complete, attribution NONE, 0 exclusions. In the real repository, `runtime`, `authority`, `projects` and `.atolye` (protected repository roots) and the `data/brain/revenue` store do not exist. The smoke fixture never creates `revenue`, yet C02 asserts it is covered. | Reviewer executed it; main session confirmed the absent paths and the code lines. |
| B2 | HIGH | **External roots are not bound to the configured roots.** Swapping the runtime and authority roots still gives complete = true; any two existing, link-free, non-overlapping directories pass. The receipt omits `roots`, `stores`, `incompleteReasons`, `budgetId` and the paths. Only `coverageManifestDigest` binds them, and it has not been recomputed independently. The 8,996-file count suggests the right roots but does not prove it. | Reviewer executed the swap; main session confirmed that the receipt has none of those fields. |
| B3 | MEDIUM | A protected repository root that is a dangling junction reads as ABSENT (`fs.existsSync`), with complete = true and no LINK reason. | Reviewer executed it. |
| B4 | MEDIUM | The smoke never reaches the maxFiles or total maxBytes boundary. With both checks removed and both caps raised 1000×, it still passes 23/23. The byte cap has a backstop (`UNREADABLE_OR_CHANGED`); the file cap has none. `--mutations` has no budget controls. Exactly-at-limit is correct. On its own this loses a resource bound, not completeness. | Reviewer executed it. |
| B5 | MEDIUM | Attribution NONE means only that the two endpoint snapshots match. A write that is reverted inside the interval, a write behind the "after" walk, and changes to empty directories, metadata or NTFS alternate data streams are invisible. | Reading. |
| B6 | LOW | Directory listings are read whole (`readdirSync` + sort) and do not count toward maxFiles. A very wide tree is bounded only by depth and the deadline. | Reading. |
| B7 | LOW | Locked files, long paths and other reparse tags appear to throw and therefore fail closed. | Reading only. |

## Conditions before the evidence may be promoted (no test is loosened)

1. A missing required root or store, or a dangling link, produces an explicit reason, or the review accepts it explicitly per store. This is an owner/design decision, because four legacy repository roots and the revenue store legitimately do not exist today.
2. The receipt carries, per root: state, files and bytes; per store: presence; and the budget id and values.
3. `coverageManifestDigest` is recomputed independently from the configured `ATOLYE_RUNTIME_ROOT` / authority realpaths and dev:ino, or the CLI validates the roots against them.
4. Boundary tests and mutation controls for maxFiles and total maxBytes (for example through an injectable budget).
5. The evidence states that attribution NONE is endpoint-only.

## Not verified

The real largest file and depth; recomputation of the manifest digest; whether `existsSync` swallows EPERM on this host; the commit's 6/6 `--mutations` claim (not re-run).
