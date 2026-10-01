# Stage 15D — implementation evidence

## 15D.0 inspection complete / 15D.1 lease foundation

Canonical order and scope are unchanged. Stage 15C remains CLOSED/GREEN;
15B remains CLOSED and 15A.3 remains LOCAL_INDEPENDENCE_DEGRADED.

The initial packet extends `AyasExecutionAuthorizationStore`; there is no new
authority store, approval engine, mutation engine, tool allowlist or owner state.
`AyasCapabilityScope` is a strict data contract; parsed scopes grant nothing.
`AyasActionFirewall` wraps the existing request validator and durable grants.
Its run/task UUIDs and fixed server agent/built-in local delegation are created
in server code. `requestedBy` and `intent` remain untrusted audit labels. Owner
identity is explicitly null for built-in reads, never invented from a prefix.

Each opaque handle is bound to one server run/task, one exact allowlisted
capability, canonical request digest, physical repository/resource roots,
LOCAL platform, ZERO_LOCAL cost and READ/BOUNDED_LOCAL classification. The
existing canonical request intentionally excludes natural-language intent;
changing that text does not change authority or overwrite the original audit
intent. `run-developer-validation` launches a bounded process, so it receives
BOUNDED_LOCAL classification even though the old tool spec says write=false.

Grants expire in at most five minutes, are consumed once and can be revoked.
Handles live in a per-task WeakMap: serialization, spread, prototype clones,
foreign tasks and restart cannot restore a lease from JSON. Persisted grants
remain audit evidence. The consume record must reach fsync/rename before an
allow result. The existing store now uses an exclusive per-record mutation
lock, preventing two processes from consuming the same grant. A crashed
holder leaves that grant fail-closed; there is no automatic stale takeover.
New record/time/state validation rejects NaN expiry, clock reversal, oversized
TTL, scope downgrades and unknown fields. Revocation is monotonic in both the
live handle and persisted state. Settling an unused grant or overwriting a
terminal outcome is refused. Revocation cannot undo an already running effect.

Project/catalog issuance requires the actual trusted adapter resource resolver;
the repository root is never guessed to be the production storage root. The
resolver is checked again at admission. Existing filesystem containment and
per-tool semantic validation remain required; a digest alone is not a path
sandbox or a keyed signature authenticating a hostile filesystem writer.

Firewall vocabulary is closed: ALLOW_READ, ALLOW_BOUNDED_LOCAL, REQUIRE_OWNER,
DENY. Classification alone is informative, not a lease/admission. Reserved
pipeline/publish tools require owner control; unknown financial/provider/MCP
actions deny. There is no owner/financial issuer in this packet. No runtime
activation, model, container, public action, paid fallback or push occurred.

Verification: action firewall 46 adversarial scenarios, execution bridge 23,
write action 16, all PASS in TEMP roots. The firewall smoke includes two fresh
Node processes racing one grant. TypeScript and changed-file lint PASS;
diff check PASS. Graphify is updated and rebound for each local packet; the
known nine partial files and pending semantic extraction remain disclosed.

## Dispatch map and next packet

- `AyasActionRuntime.runAyasReadOnlyAction` dispatches the closed safe/developer
  executor registry. Callers: chat, product context, fault localization,
  guided repair and developer workflow. Bind the common firewall here next;
  retain the existing read outcome and write gate separation. Tests need a
  trusted TEMP authorization context so reads never create live audit grants.
- `AyasExecutionBridge` consumes legacy request-bound grants behind its gate.
  It has no current production caller. Preserve the default-disabled write
  ceremony while extending exact run/resource guard coverage.
- `AyasWriteExecutor` invokes one pipeline stage only after the bridge; its
  planner and the existing runtime storage authority remain mandatory.
- Self-development execution goes through `AyasProposalExecutionService` or
  `AyasMicroBatchExecutionService` into `AyasAutonomyDaemon.executeApproved`.
  The daemon reserves current inbox approval, holds the existing authority
  lock, revalidates exact proposal/hash/HEAD/files immediately before mutation,
  records the journal and invokes the mutation boundary. Reuse that proof for
  owner-bound leases; never use a reason prefix or snapshot as issuer proof.
- Durable-task activity registry currently contains only the approved graph
  state read. Admission before ATTEMPT_STARTED and recovery/reread are separate;
  recovery does not mint new write authority. Cover the actual collector seam,
  without broadening the owner-approved observer activity set.
- Descriptive `reasoning/AyasToolRegistry` derives from the existing allowlist;
  reserved writes and web-research placeholder have no executor. Future MCP
  adapters must be registered and guarded before they can dispatch.

**Stage 15D is not closed.** 15D.1 is the reusable foundation only; no existing
executor is bound yet. Next: 15D.2 common-guard binding for read dispatch, actual
resource resolution, TEMP isolation and failure-before-executor regression.
Then owner-proof/write/self-development/durable activity coverage and closure
audit. Stage 15E follows only after the complete Stage 15D scope is green.

## 15D.2 read dispatch bound

Source packet bbf7aa9c3ee3632bd122dafa91be6b7786bb6add. The common guard is now bound to AyasActionRuntime before every executor call, retaining the separate closed mutation gate. Project/catalog scope uses the same authoritative physical storage resolver as its adapters. Trusted AsyncLocalStorage contexts retain one task identity for related reads and isolate test audit writes in TEMP; absent a context, each read gets a new bounded server task. Owner/delegation still means built-in local read policy only.

Admission-write failure prevents execution; outcome-write failure preserves the true dispatch result, carries a closed auditFailure code through chat diagnostics and stops the developer workflow without retries or continuation. Captured scopes are checked independently of disk hashes, and a frozen plain request snapshot is passed to the adapter. Same-clock grants now have distinct execution IDs. The final lease suite has 49 scenarios; dispatch integration has 12. Affected regression evidence is in ACTIVE_CHECKPOINT/ledger. Product-context smoke has default-root reads and is not run; the source-junction test is executed in a verified disposable archive with current-source overlay.

The initial next-packet paragraph above is superseded: next is 15D.3 legacy bridge read binding using its SAME existing grant, then remaining owner/delegation/write/self-development/guided-repair/durable/direct-context seams. Direct product composition currently calls catalogue/self-heal readers outside Action Runtime; those are an explicit remaining coverage gap. No global closure or Stage 15E claim. NO PUSH.

## 15D.3 legacy read bridge bound — 2026-10-01

Source packet e28b54cc643b87fad4d01c6476197a3c1b2fed64. Read bridge attaches exact scope under the existing grant mutation lock, then admits through the SAME common guard before begin-execution. Authorization ID, execution ID, creation and expiry are preserved; no second grant and no TTL renewal. Scope metadata cannot be rebound to a different run/task or attached twice in the same firewall. Undeclared UNC/network/device roots reject before filesystem I/O. The default-disabled write path and gate ceremony are unchanged.

TEST/ADVERSARIAL: 12 bridge integration scenarios include two fresh processes racing one grant, request and classification tamper, closed gate, unknown/revoked/expired grant, lock contention, repeated/foreign attachment and network/device roots. Lease 49, read dispatch 12, original action runtime 17, bridge 23, write action 16 PASS. TypeScript, changed-file lint and diff check PASS. Graphify precommit head 9974783: 16,085 nodes / 46,647 links, no duplicates/dangling/self-loops; current PARTIAL with 9 known file gaps and semantic pending. Documentation descendant is followed by exact-HEAD per-machine refresh.

Next 15D.4: protected owner approval/reservation identity and exact write/self-development/guided-repair scope binding, reusing existing authority primitives. Durable and direct product-context read seams plus complete coverage audit remain after that. Stage 15D stays IN_PROGRESS, globalGuardBound=false; Stage 15E has not started. No runtime activation/model/container/financial action/push. Prior WIP push deviation remains recorded; no history rewrite.

## 15D.4a owner proof correction — 2026-10-01

Source 19c9e944003861081bb3f2bec074c1c628dae1d5. Inspection found requireBrainSession used async verifySession without await, treating its Promise as truthy. It now awaits the real verifier before all owner effects. A VM executes the actual extracted server-action guard with real token signing/verification and a mocked Next cookie boundary: missing/malformed/wrong-signer/expired/future/tampered tokens deny with zero owner effect; valid token waits; production missing/short key deny; existing local-dev mode remains. AST checks nine real owner actions await that guard first. No live token or secret was read.

Revalidation now requires the reserved decision to still be APPROVE, match the exact proposal hash and latest decision, remain unconsumed/unfinalized and have valid ordered decision/reservation times. Seven TEMP durable-state attacks refuse before callback. TEST/ADVERSARIAL: session 11, access gate 19, revalidation 37, daemon 9, proposal execution 29, micro batch 13, approval compatibility 24, daemon authority 23 PASS. TypeScript/lint/diff PASS. GRAPHIFY precommit716c5eb: 16097 nodes / 46673 links, anomalies0; PARTIAL9/semantic pending.

Next 15D.4b binds the existing owner reservation to an opaque lease and journal within the SAME common firewall and authority lock. Current app authentication is single shared-passcode, not named accounts: record that owner role and exact decision identity honestly; no invented human ID or reason-prefix proof. Owner lease/global coverage remain unfinished. Stage15D IN_PROGRESS;15E unopened. Local commits only; NO PUSH.

## 15D.4b owner reservation lease bound — 2026-10-01

Source 2f4168fb48d5166e851fe37c621b7a71f0a37f75. The SAME action firewall now binds an already-reserved owner approval through its existing inbox/micro-batch adapter and execution journal under the existing authority lock. No new approval/authority store or financial issuer. Fixed owner identity is the existing singleton shared-passcode role, with exact current decision ID as delegation, not invented per-person attribution. Scope pins run/task, proposal/hash/baseHEAD, resolved mutation kind, exact canonical physical-repo file scope, original authorization/reservation, LOCAL/ZERO_LOCAL/WRITE. TTL starts at reservation and is at most5min; it cannot renew. Parsed audit or model/tool text never restores a live handle.

Grant and consume audit metadata reach the existing journal before callback. A fresh revalidation follows the awaited mutation boundary, then admission consumes immediately before EXECUTING. Input arrays and resolved mutation identity are captured. No new journal phase, automatic restart replay or publication authority. The existing result/finalization/recovery ceremony remains. Revocation/refused current owner proof blocks new admission; already-running effects cannot be undone. Journal hashes/metadata do not authenticate a hostile filesystem/root writer (15N).

TEST/ADVERSARIAL: owner31 scenarios including actual TEMP daemon callback, current decision/cost/mutation changes, expiry during grant write, grant/consume journal errors, frozen request, forged/spread/prototype/JSON handles, fresh Node restart, TTL/clock/revoke/restore/tamper. Lease49/read12/bridge12/owner session11; daemon9/journal24/authority29/reservation23/proposal29/micro-batch13/artifact9/revalidation37/daemon boundary23 PASS. TypeScript/changed lint/diff PASS; full lint0errors/13existing warnings. GRAPHIFY precommit07c90d1 current PARTIAL9/semantic pending:16118nodes/46739links, duplicate/dangling/self-loop0. Local commit only; NO PUSH.

15D.5 next: guided repair uses plain authorization objects and a recomputable proposal SHA, which is integrity rather than issuer proof. Reuse existing explicit user-turn approval and repair primitive for opaque proof and exact workspace/files/operations lease; preserve bounded remediation and durable pending recovery. Dormant bridge write, durable activity and direct-context seams plus full audit remain. Stage15D IN_PROGRESS/globalGuardBound=false;15E unopened. No model/container/live mutation/publication/spend/push activation.
