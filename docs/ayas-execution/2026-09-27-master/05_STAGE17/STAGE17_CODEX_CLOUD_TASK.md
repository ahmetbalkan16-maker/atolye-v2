# Codex / Claude Task — Stage 17 Full AYAS System Audit + Foundation Closure

Implement a READ-ONLY, HEAD-bound full-system audit.

Do not fix findings in the audit commit.
Do not start daemons, approve proposals, execute mutations, install packages, publish, run paid providers or mutate production/runtime/private stores.

Create:
- closed audit domain/evidence/severity/state model
- read-only collector interface
- evidence HEAD/freshness binding
- finding aggregation
- closure gate
- JSON/text report
- primary + held-out + adversarial evaluator

Audit these domains:
repository/CI, Graphify, conversation, memory/retrieval, model/voice/mobile,
autonomy/approval, security/supply-chain, privacy/governance, backup/DR,
runtime/remote access, production/media, research/evolution/watch,
developer intelligence, Revenue Center, docs/roadmap.

Seed and actively verify the known current open findings listed in the design.
No finding may close from documentation text alone.
Static review, deterministic test and live-read evidence are distinct.

Closure requires BLOCKER=0 and unresolved verified MAJOR=0 at one current HEAD.
