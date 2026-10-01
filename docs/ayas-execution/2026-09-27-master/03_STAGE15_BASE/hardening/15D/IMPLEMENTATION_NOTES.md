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
