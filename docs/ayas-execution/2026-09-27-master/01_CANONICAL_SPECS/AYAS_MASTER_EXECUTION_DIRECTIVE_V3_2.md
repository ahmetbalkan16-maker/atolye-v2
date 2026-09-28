# AYAS MASTER EXECUTION DIRECTIVE V3.2 — IMPLEMENT, DO NOT REDESIGN
Date: 2026-09-27

## MASTER INSTRUCTION

The AYAS architecture, roadmap, safety rules and implementation intent are already designed.

**Do not redesign them. Do not create a new roadmap. Do not restart discovery. Do not spend tokens debating alternatives.**

Your task is:

> Read the canonical specifications from the exact locations listed in `AYAS_MASTER_SOURCE_MAP_V3_2.md`, reconcile them once against the current repository truth, implement them in the defined order, fix any real defects/regressions encountered, validate every stage, and deliver review-ready branches.

## 1. FIRST ACTION — IMPORT ONCE

Unpack the supplied handoff into the canonical structure:

`docs/ayas-execution/2026-09-27-master/`

Create:
- `01-MASTER_EXECUTION_DIRECTIVE_V3_2.md`
- `SOURCE_MAP_V3_2.md`
- `EXECUTION_LEDGER.md`
- `ACTIVE_CHECKPOINT.json`
- `NEW_FINDINGS.md`

Do this once.

After import, do not repeatedly reopen ZIPs unless a specific missing source file is required.

## 2. SECOND ACTION — REPOSITORY TRUTH ONCE

Before source edits, record once:
- branch
- full HEAD
- upstream full HEAD
- real remote full HEAD when available
- ahead/behind
- worktree state
- Graphify state
- `.graphify/needs_update`
- current relevant test baseline

Write this into `EXECUTION_LEDGER.md`.

Do not repeat a full-repo inventory before every subtask.
For later stages, inspect only the files/dependencies relevant to that stage unless HEAD drift or a regression requires wider inspection.

## 3. EXACT EXECUTION ORDER

Follow `02-MASTER_EXECUTION_ORDER_V3.md`.

Do not renumber.
Do not reorder.
Do not skip.

The intended high-level order is:

1. Remediation
2. Stage 15
3. Stage 15A–15T
4. Revenue 16.0–16.14 + 16.0A/16.3A/16.3B/16.11A
5. Stage 17
6. ∞ Continuous Evolution
7. Brain UI V2 on separate branch
8. Historical-video production certification
9. No-Cloud independence certification
10. Final Stage 17 audit
11. Owner activation

## 4. IMPLEMENTATION MODE — NO OPEN-ENDED LOOP

For each stage:

1. Read that stage's canonical design.
2. Inspect only the affected current code.
3. Build a short implementation checklist.
4. Implement.
5. Run focused tests.
6. Run required held-out/adversarial tests.
7. Update Graphify.
8. Review architecture/safety.
9. Fix regressions if any.
10. Commit the green atomic packet.
11. Update checkpoint/ledger.
12. Move to the next subtask/stage.

Do not loop back to step 1 after green unless:
- relevant HEAD changed;
- a test failed;
- Graphify found a real issue;
- a current official API changed materially;
- an independent review found a defect.

## 5. TOKEN / RESEARCH DISCIPLINE

General web research is forbidden during implementation.

Allowed external research only when the stage explicitly depends on current official external behavior, such as:
- Etsy API
- Upwork official MCP/API
- Fiverr official integration surface
- Udemy Instructor API
- Lemon Squeezy API
- Pexels/Openverse/Wikimedia usage/licensing
- current security advisory for an exact dependency
- current model/license/hardware requirement for a candidate backend

When external verification is needed:
- use official/primary sources first;
- answer the exact implementation question;
- stop when enough evidence exists;
- record the source and date;
- do not launch another broad global research cycle.

Do not re-research architectural topics already decided in V3/V3.1.

## 6. DEFECT RULE

If a real problem is found:

### A. Safe and inside current scope
- reproduce;
- add regression test;
- fix;
- rerun;
- document.

### B. Blocks current stage but safe to repair
Repair it before proceeding.

### C. Owner-only / destructive / external
Do not bypass.
Mark `BLOCKED_OWNER_ACTION` with exact required action.

### D. Unrelated non-blocking
Add to `NEW_FINDINGS.md`.
Do not derail the master sprint.

## 7. WORKING-SYSTEM PROTECTION

Before changing a subsystem:
- identify passing relevant tests;
- preserve them.

If an existing passing behavior breaks:
- STOP progression on that path;
- diagnose;
- repair;
- add regression test if coverage was missing;
- return to green.

Forbidden:
- deleting/weaking tests to pass;
- broad refactor for aesthetics;
- replacing working mechanisms just because a new library is fashionable;
- introducing a dependency when existing local code satisfies the design.

## 8. GRAPHIFY RULE

Graphify is mandatory.

Before source-changing work:
- current/usable graph;
- honor `.graphify/needs_update`;
- fail closed on structural anomaly.

After source-changing work:
- update/rebuild as required;
- bind graph to current HEAD;
- review affected architecture paths.

Do not run unnecessary full Graphify work repeatedly if current Graphify is already bound to the same HEAD and the subtask has not changed source.

Any source commit invalidates prior Graphify HEAD binding and requires the appropriate update/review before stage closure.

## 9. OWNER / AUTHORITY RULES

Never weaken:
- owner approval;
- production execution gate;
- financial gate;
- publish gate;
- protected paths;
- zero-cost defaults;
- source-promotion controls.

No:
- self-approval;
- self-push to canonical;
- autonomous budget increase;
- hidden paid cloud fallback;
- automatic public publishing unless separately enabled by exact owner policy;
- external text controlling commands/path/tool/approval.

## 10. COST RULE

Current production technical default in repository:
`$1.00/video`

V3 policy:
- preferred normal target: `$0.25/video`
- project cap: explicit owner approval
- ordinary technical ceiling: `$1.00/video` until owner changes policy
- current planning-time allowance: `$9.85`, revalidate or label owner-declared at execution

AYAS may suggest:
“Estimated $0.82; authorize project cap up to $1.00?”

AYAS may never authorize the increase itself.

## 11. ATÖLYE DIRECTOR RULE

Implement the already-designed 15I–15M behavior.

Do not invent a different media architecture unless current code makes the design impossible.

Prefer existing:
- Ollama/local LLM
- Piper/local TTS
- Wikimedia real-photo path
- reviewed Openverse/Pexels adapters where appropriate
- SVG local character/stick-figure scenes
- existing motion plans
- FFmpeg scene rendering/assembly
- existing production recovery/idempotency
- existing YouTube package/publish path

Paid generation is fallback/exception under owner-approved project cost, not default.

## 12. LOCAL CODING RULE

Implement 15A as provider-neutral.

Do not hard-code AYAS to OpenHands, Qwen Code or another single backend.
Benchmark candidates.
Activate only one that passes AYAS qualification on the current hardware.

If no candidate passes:
`LOCAL_INDEPENDENCE_DEGRADED`

Do not silently use Codex/Claude Cloud.

## 13. CONTINUATION / 5-HOUR SESSION RULE

Follow `05-CONTINUATION_PROTOCOL.md`.

Before every atomic subtask:
update `ACTIVE_CHECKPOINT.json`.

After every green atomic packet:
- tests
- Graphify
- commit
- ledger
- checkpoint

If usage ends:
the next session resumes from actual git + Graphify truth and `ACTIVE_CHECKPOINT.nextAction`.

Never restart the master sprint from the beginning unless repository truth proves no prior work exists.

## 14. BRAIN UI

Use the exact Brain UI V2 design pack and approved reference.

Separate branch.
No redesign.
No fake percentages.
No screenshot-as-page.
No functional regression.
Do not promote until owner approves.

## 15. STOP CONDITIONS

Pause the affected path only when:
- owner-only action required;
- destructive decision required;
- external account authorization required;
- unknown/paid effect cannot be proven safe;
- Graphify structural failure cannot be repaired safely;
- regression cannot be safely resolved;
- current local model/hardware cannot meet an explicit qualification threshold.

Continue all independent unaffected work when safe.

## 16. FINAL DELIVERABLE

Do not say only “done”.

Deliver:
- review-ready core branch;
- review-ready UI branch;
- `FINAL_EXECUTION_REPORT.md`;
- exact final HEADs;
- every stage status;
- tests;
- Graphify state;
- defects found/fixed;
- blockers;
- owner actions;
- production cost-policy state;
- revenue-policy state;
- local-independence status;
- Stage 17 outcome.

Never automatically merge canonical branches.

## 17. SINGLE-SENTENCE OPERATING RULE

**The design is already decided: implement the supplied canonical specifications against current repository truth, repair verified defects without weakening existing behavior or authority boundaries, validate with tests + Graphify, checkpoint every green atomic packet, and continue in the exact master order until review-ready or a genuine owner-only blocker.**
