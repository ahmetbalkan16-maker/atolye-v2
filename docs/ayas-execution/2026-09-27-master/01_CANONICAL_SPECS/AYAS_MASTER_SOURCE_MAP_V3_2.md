# AYAS MASTER SOURCE MAP V3.2
Date: 2026-09-27

## Canonical repo destination

All human-readable design/spec files from this handoff must be placed under:

`docs/ayas-execution/2026-09-27-master/`

Do not commit nested ZIP archives. Unpack Markdown/spec files and the approved UI reference only.

## Precedence

1. Current verified repository behavior and passing tests.
2. `01-MASTER_EXECUTION_DIRECTIVE_V3_2.md`
3. `02-MASTER_EXECUTION_ORDER_V3.md`
4. `03-MASTER_SPRINT_V3_PRE_ATOLYE.md`
5. `04-V3_1_FINAL_FREEZE_ADDENDUM.md`
6. Stage-specific design files.
7. Historical checkpoint/context files.

If an older design conflicts with newer correct code:
preserve the newer correct behavior and adapt the implementation.
Do not redesign the stage from scratch.

## Source package -> canonical destination

### Root
- `AYAS_2026-09-27_SUNDAY_MASTER_CHECKPOINT.md`
  -> `00-SUNDAY_MASTER_CHECKPOINT.md`
- `AYAS_MASTER_SPRINT_V3_CLOUD_CODEX_COMMAND.md`
  -> historical command reference only
- `AYAS_MASTER_EXECUTION_ORDER_V3.md`
  -> `02-MASTER_EXECUTION_ORDER_V3.md`
- `AYAS_MASTER_SPRINT_V3_PRE_ATOLYE.md`
  -> `03-MASTER_SPRINT_V3_PRE_ATOLYE.md`
- `AYAS_MASTER_SPRINT_V3_1_FINAL_FREEZE_ADDENDUM.md`
  -> `04-V3_1_FINAL_FREEZE_ADDENDUM.md`
- `AYAS_CONTINUATION_PROTOCOL_V1.md`
  -> `05-CONTINUATION_PROTOCOL.md`
- `AYAS_ACTIVE_CHECKPOINT_TEMPLATE.json`
  -> template for `ACTIVE_CHECKPOINT.json`
- `AYAS_V3_RESEARCH_FINDINGS.md`
  -> `06-V3_RESEARCH_FINDINGS.md`

### Remediation
From:
`AYAS_2026-09-28_REMEDIATION_BUNDLE.zip`

Unpack under:
`docs/ayas-execution/2026-09-27-master/remediation/`

Use every Markdown/patch/checklist in that package.
Do not re-invent the remediation.

### Stage 15
From:
`AYAS_STAGE15_DESIGN_PACK.zip`

Unpack under:
`.../stage15/base/`

### Stage 15A–15T
Canonical design source:
- `03-MASTER_SPRINT_V3_PRE_ATOLYE.md`
- `04-V3_1_FINAL_FREEZE_ADDENDUM.md`
- `06-V3_RESEARCH_FINDINGS.md`

Create implementation notes under:
`.../stage15/hardening/15A/` through `15T/`

These notes summarize implementation evidence only.
They do not replace the canonical design text.

### Revenue Center
From:
- `AYAS_STAGE16_0_DESIGN_PACK.zip`
- ...
- `AYAS_STAGE16_14_DESIGN_PACK.zip`

Unpack each into:
`.../revenue/16.0/`
...
`.../revenue/16.14/`

Revenue additions:
- 16.0A
- 16.3A
- 16.3B
- 16.11A

Canonical design source for those additions:
`03-MASTER_SPRINT_V3_PRE_ATOLYE.md`

### Stage 17
From:
`AYAS_STAGE17_DESIGN_PACK.zip`

Unpack under:
`.../stage17/`

### Continuous Evolution
From:
`AYAS_INFINITY_CONTINUOUS_EVOLUTION_DESIGN_PACK.zip`

Unpack under:
`.../infinity/`

### Brain UI V2
From:
`AYAS_BRAIN_UI_V2_DESIGN_PACK.zip`

Unpack under:
`.../brain-ui-v2/`

Approved visual:
`.../brain-ui-v2/approved-reference/ayas-brain-control-center-v2.png`

Do not use the screenshot as the entire UI background.
Follow the existing UI design pack exactly.

## Execution-state files

Maintain:
- `EXECUTION_LEDGER.md`
- `ACTIVE_CHECKPOINT.json`
- `NEW_FINDINGS.md`
- `FINAL_EXECUTION_REPORT.md` only when all work reaches review-ready/blocked terminal states.

## No duplicate design work

The files above are the design authority.

Do NOT:
- write another architecture proposal for a stage already designed;
- generate alternative roadmaps;
- rename/reorder stages;
- repeat global research;
- repeat source inventory after it is recorded, unless current HEAD changed in a relevant way;
- reopen an already resolved design choice because another implementation is possible.

The only allowed design deviation is a narrowly documented reconciliation required by newer repository truth, a failing test, an incompatible current API, or a verified security issue.

## Owner-adopted post-freeze canonical supplement (2026-10-01)

`01_CANONICAL_SPECS/AYAS_POST_FREEZE_DESIGN_ADDENDUM_V1.md` is the later owner-adopted design authority for its covered requirements. SHA-256: `83000846508d32529918b00464c33d6a4fed4f1b1b25a3d67849baa2a584b9fa`. It supplements the existing packs; it creates no stage, changes no master order, and weakens no owner/security/approval/cost boundary. Verified correct current behavior is preserved, including equivalent implementations. For each new stage read its existing canonical pack first, then the relevant addendum section. Adoption and targeted retroactive conformance evidence: `post-freeze-audit/ADOPTION.json` and `post-freeze-audit/CONFORMANCE_MATRIX.json`. Original design packs remain intact.
