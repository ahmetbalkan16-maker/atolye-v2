# AYAS MASTER SPRINT V3 — Continuation / 5-Hour Session Protocol

Purpose:
Cloud/Codex usage can stop mid-master-sprint. A new session MUST continue the exact same sprint without restarting, forgetting stages, changing rules, or skipping work.

## Canonical repo location

`docs/ayas-execution/2026-09-27-master/`

Required files:
- `MASTER_EXECUTION_ORDER_V3.md`
- `EXECUTION_LEDGER.md`
- `ACTIVE_CHECKPOINT.json`
- `NEW_FINDINGS.md`
- stage specifications
- `FINAL_EXECUTION_REPORT.md` only at the end

## Atomic work rule

Never start a giant 5-hour mutation.

Work in GREEN atomic packets:
- one substage or one narrow feature;
- source change;
- tests;
- Graphify;
- review;
- checkpoint.

The last committed checkpoint should normally be green.

## ACTIVE_CHECKPOINT.json

Must contain:
```json
{
  "schemaVersion": "1",
  "masterSprint": "AYAS_MASTER_SPRINT_V3",
  "branch": "...",
  "lastGreenHead": "40-char-sha",
  "currentHead": "40-char-sha",
  "stage": "15K",
  "subtask": "cost-preflight-reservation",
  "status": "IN_PROGRESS",
  "completedStages": [],
  "completedSubtasks": [],
  "currentFiles": [],
  "lastGreenTests": [],
  "graphify": {
    "head": "...",
    "stale": false,
    "needsUpdate": false
  },
  "blockers": [],
  "nextAction": "exact next command/task",
  "updatedAt": "ISO-8601"
}
```

Actual git/Graphify state ALWAYS outranks checkpoint text.

## Update cadence

Update `EXECUTION_LEDGER.md` and `ACTIVE_CHECKPOINT.json`:
- before starting a new atomic subtask;
- after every green subtask/commit;
- after a blocker;
- after any discovered regression;
- before switching stages.

Do not wait until the end of a 5-hour window.

## If usage ends mid-task

Next session MUST NOT start over.

Use this exact continuation instruction:

> Continue AYAS MASTER SPRINT V3 from the canonical repository checkpoint. Do not redesign, renumber, restart, or skip any stage. First read `docs/ayas-execution/2026-09-27-master/MASTER_EXECUTION_ORDER_V3.md`, `EXECUTION_LEDGER.md`, `ACTIVE_CHECKPOINT.json`, and `NEW_FINDINGS.md`. Then inspect the actual current git branch/HEAD/worktree/upstream and Graphify state. Actual repository truth outranks the checkpoint. If they match, resume exactly `ACTIVE_CHECKPOINT.current stage/subtask/nextAction`. If they do not match, enter recovery mode: preserve all user/unrelated changes, determine what was completed since `lastGreenHead`, rerun the required validation, update the checkpoint, then resume. Never use reset/clean/stash/force-push to simplify recovery. Keep Graphify current before/after source changes. Preserve all existing passing behavior and owner/security/cost boundaries. If a regression is found, repair it and add a regression test before continuing. At every green atomic boundary update the ledger/checkpoint and commit explicit intended paths only. Do not merge to canonical branches automatically. Continue until the master sprint’s next real owner-only blocker or until all tasks are REVIEW_READY.

## Recovery mode

If actual HEAD/worktree differs:
1. do not destroy anything;
2. identify lastGreenHead;
3. inspect commits/diff since it;
4. classify files:
   - validated completed
   - incomplete current subtask
   - unrelated user work
5. rerun focused tests;
6. update Graphify;
7. either finish the incomplete packet or revert it ONLY through a reviewed non-destructive patch if necessary;
8. update checkpoint.

No blind reapplication of previous patches.

## Commit rule

Every functional commit should include:
- production/source code
- its tests
- relevant spec/ledger/checkpoint update

Do not commit intentionally failing source just to create a checkpoint.
Split tasks small enough to finish green.

## Session report

At the end of each usable session, output only:
- stage/subtask reached;
- last green commit SHA;
- tests/Graphify status;
- new findings;
- blockers;
- exact next action.

This is the handoff for the next session.
