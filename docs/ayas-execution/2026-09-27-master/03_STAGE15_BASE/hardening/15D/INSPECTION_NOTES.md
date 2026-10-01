# Stage 15D — exact resumption point

Opened after the Stage 15C source packet, 2026-10-01. **15D.0 inspection is
complete; superseded continuation: 15D.1 reusable lease foundation, then 15D.2
dispatch binding.** See IMPLEMENTATION_NOTES.md for current evidence. The
remaining text records the original inspection, not current activation claims.

Canonical spec: `00_COMMAND/AYAS_FINAL_CODEX_MASTER_EXECUTION_ORDER.md`, Stage
15D; `01_CANONICAL_SPECS/AYAS_MASTER_SPRINT_V3_PRE_ATOLYE.md`, Stage 15D.
Implement the existing spec, not a new roadmap.

Inspected:

- `AyasDurableTask.ts`: shared domains and task/step identity, exact targets,
  effect declarations, bounded attempt lifetimes, restart-safe idempotency.
- `AyasDurableTaskRuntime.ts`: `admitStart` runs before recording an attempt;
  rereads/recovery are separate and must not accidentally be blocked by a new
  start-only admission gate. Registered activities already check effect/domain/
  target compatibility. Process ownership is liveness, not capability authority.
- `AyasExecutionAuthorityLock.ts`: mutual exclusion/liveness only, not a lease
  granting capabilities or proving owner delegation.
- `AyasAutonomousExecutionGate.ts`, `AyasApprovalBinding.ts`,
  `AyasOwnerApprovalProvenance.ts`, `AyasProposalApprovalService.ts`: reuse the
  existing current inbox/approval binding and execution/publication guards.
  A reason prefix, memory provenance or model-produced owner identity cannot
  be treated as standalone authority or used to widen an approved scope.
- `AyasToolRegistry.ts`: real tools derive from `AYAS_EXECUTION_ALLOWLIST` in
  `ayas/execution/AyasExecutionPolicy.ts`. Reserved writes stay closed. The
  research placeholder is descriptive, not an executor. Reuse this registry;
  do not create a second list granting actions.

Repository path correction: there is no `AyasExecutionService.ts`. The actual
executor seams are `AyasExecutionBridge.ts`, `AyasActionRuntime.ts`,
`AyasExecutionAuthorization.ts`, `AyasExecutionGate.ts`, `AyasSafeExecutors.ts`,
`AyasWriteExecutor.ts` and `AyasWriteActionPolicy.ts` under `ayas/execution/`.

Additional inspected headers: `AyasExecutionAuthorization.ts` already has durable
single-use request-bound grants with a default five-minute TTL, request digest,
audit identity and replay refusal. Reuse/extend this existing authority primitive;
do not build a parallel grant store. `AyasExecutionBridge.ts` consumes it behind
the write gate. `AyasActionRuntime.ts` is a separate, bounded read-only dispatch
path without those write authorizations. Both paths and the self-development
approval path must eventually share the new run/scope guard. Existing grants
are adjacent infrastructure, not a claim that global agent capability leases
or owner delegation binding are already complete.

Next action: finish inspecting those actual seams, their
policy and adapter call sites, the durable-task activity/recovery
admission seam and current owner-approval verification seam. Classify focused
execution/approval/lease tests for TEMP isolation. Then implement one additive
server-side run identity + exact-scope, expiring, revocable capability lease +
common guard, with closed decision codes `ALLOW_READ`, `ALLOW_BOUNDED_LOCAL`,
`REQUIRE_OWNER`, `DENY`. Derive identity/action classification from trusted
code and current registered policy; reject unknown schema/source/cost/resource.
External/model text cannot issue or widen a lease. Reuse existing durable
trace/journal and owner approval rather than adding a parallel authority store.
Financial/platform/publish/owner-policy actions retain owner control. Test
forged/cloned/serialized grants, changed task/repo/platform/target, expiry,
revocation, restart, replay and failure to record the guard decision before
considering adapter binding. Do not claim a global guard until every actual
executor route has been mapped and guarded.

Known activation actions from earlier stages persist (observer Scheduled Task,
phone/Worker external proof). They do not block this non-live inspection, do not
grant new authority and do not reopen Stage 15B or degraded Stage 15A.3.
