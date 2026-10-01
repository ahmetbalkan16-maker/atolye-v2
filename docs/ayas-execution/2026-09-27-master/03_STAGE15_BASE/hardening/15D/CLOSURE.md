# Stage 15D — closure record

Closed GREEN on 2026-10-01 at source `3c51589` (local commits only, not pushed).

Canonical requirement: every live agent or run receives an identity, an exact
capability set, an exact resource scope, a TTL, a cost class and a
classification; all tools, MCPs and adapters pass one runtime guard with four
decisions (ALLOW_READ, ALLOW_BOUNDED_LOCAL, REQUIRE_OWNER, DENY); there is no
autonomous financial approval.

## What passes the guard

One firewall (`AyasActionFirewall`) over one store
(`AyasExecutionAuthorizationStore`) and the existing owner approval,
reservation and journal primitives. No second authority engine or store.

| Dispatch | Lease | Bound in |
| --- | --- | --- |
| Chat and workflow read tools (Action Runtime) | one per call: tool, request digest, physical repository and resource roots | 15D.2 |
| Legacy read bridge | the same existing grant, scope attached | 15D.3 |
| Bridge write (`resume-stage`) | none: refused as REQUIRE_OWNER before any plan read or dispatch | 15D.6a |
| Self-development and micro-batch mutation | owner lease from the existing reservation and journal | 15D.4a, 15D.4b |
| Guided repair patch and validators | owner lease from the original user-turn approval receipt | 15D.5a, 15D.5b, 15D.7b |
| Durable task activity (Graphify state read) | one per attempt: task, step, attempt, repository and Graphify install roots | 15D.6b |
| Observer discovery child | one per run: closed capability set, repository, sandbox root, base HEAD, ledger run, research source digest | 15D.7a |
| Product context catalogue read | through the guarded `list-production-projects` tool | 15D.7b |

Every lease is created by server code, expires in at most five minutes, is
consumed durably before the adapter runs, can be revoked, and is recorded. A
lease handle is a live object: its copy, its serialization, a handle from
another run and a restart carry nothing. Model text and tool output cannot
create or widen one.

## The adapter map

`scripts/smoke-ayas-action-firewall-closure.ts` builds the import graph of
`src/`, `app/` and `scripts/` and pins, for eight surfaces, every module that
spawns a process or calls the network (41 modules), each with the guard that
admits it there. The five agent surfaces are the chat route, the discovery
child, the durable sweep, the observer and the owner-approved resume worker;
three more are owner-session surfaces (Brain actions, the development centre
read models, speech to text). The suite fails when:

- a surface reaches a new effectful module, or a new entry point reaches
  leased or owner-only work, until it is classified;
- an agent surface reaches publication, an owner-request adapter, a
  production provider, a paid model, the pipeline runner, a publisher or the
  dormant write bridge;
- a tool executor, a validator, the durable collector or a discovery
  capability can run before its admission;
- the decision vocabulary gains a fifth value, or the model router can
  select the cloud provider.

There is no MCP client in the application. A future one is an effectful
module on a surface and will fail the map until it is classified.

## Evidence

- DETERMINISTIC_TEST: 42 suites PASS on one HEAD (`5cbe607` plus the
  wiring-guard test fix `3c51589`), TEMP or fixture roots only. Firewall 52,
  read dispatch 12, legacy bridge 12, owner 32, owner session 11, access gate
  19, repair proof 26, discovery run 13, closure audit 12, durable recovery
  22, durable runtime 17, and the affected execution, workflow, repair,
  approval and discovery regressions. TypeScript PASS; full lint 0 errors and
  the 13 warnings that predate this stage; diff check PASS.
- Mutation audits, run in a TEMP copy of the working tree so the repository
  and the running observer never see a mutated file: discovery run lease
  21/21 caught; closure audit 17/17 caught and one equivalent (comment only).
- LIVE_READ_ONLY: the running observer's discovery child ran the leased
  script on 2026-10-01 from 15:49Z; each run left one completed lease record
  and a SUCCEEDED ledger entry.
- Not run: `smoke-ayas-observer-autostart` (UNSAFE_KNOWN), the Stage 8
  research-improvement evaluator and `smoke-ayas-product-brain` (the last
  reads default roots; the closure audit covers the same composition in a
  TEMP process).

## Found and fixed on the way

- `smoke-ayas-discovery-registry` failed at HEAD before this stage's last
  packets: its fixture predated the HEAD-bound freshness gate. Fixture
  repaired; gate and assertions unchanged.
- No test covered revoke-after-consume for owner leases. One scenario added.
- The operator script first sent the live durable sweep's audit to a new
  directory; it now uses the existing `data/brain/execution` root.

## Known limits, carried forward

1. Publication (commit and push) runs only inside the owner-approved
   execution services, after the owner lease for the same proposal was
   admitted, and is bound by the existing guarded publication checks. It
   takes no second lease record of its own.
2. Local model inference is governed by the zero-cost model router (the
   cloud provider is never selected), not leased per call. Model lifecycle
   is Stage 15E.
3. Fixed server context (console snapshot, self-heal summary, memory, studio
   context) is read by code that names its source; it is not a tool dispatch
   and takes no lease.
4. The discovery lease is per run. Capability calls are checked against the
   durably admitted set and are not recorded one by one.
5. A refused discovery admission also skips that tick's staleness
   reconciliation; execution-time revalidation still rejects a stale approval.
6. Audit records are unkeyed files: digests detect drift, they do not
   authenticate a hostile writer to the audit directory (Stage 15N).
7. Nothing prunes audit records: about 288 a day from the observer plus
   three per chat turn (retention is Stage 15F).
8. Owner identity is the single shared-passcode role, not a named person.
9. Revocation stops new admission and the rest of a discovery run; it cannot
   undo an effect that already ran.
10. The import graph is built from static import specifiers. A computed
    dynamic import would not be seen; none exists in the mapped surfaces.

## Owner actions outstanding (none blocks 15E)

- Restart the AYAS Autonomy Observer Scheduled Task so the running observer
  loads the durable sweep binding (approved on 2026-10-01). Discovery already
  runs the leased script, because the observer starts it fresh each tick.
- Push remains off: every commit after `36fa76b` is local only.
