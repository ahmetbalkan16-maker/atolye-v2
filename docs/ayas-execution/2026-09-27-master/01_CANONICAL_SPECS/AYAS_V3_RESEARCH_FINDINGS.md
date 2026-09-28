# AYAS V3 — Research Findings / Source Decisions

## Long-running agents
Current industry evidence supports:
- structured handoffs/checkpoints across long sessions;
- durable append-only session/task state;
- separate planner/generator/evaluator roles where complexity justifies them;
- stable interfaces between “brain” and sandbox/tools.

Decision:
AYAS V3 adds durable task runtime + checkpoint protocol, but avoids unnecessary multi-agent complexity until benchmarked.

## Agent runtime control
NIST 2026 work emphasizes agent interoperability, identity and authorization.
OWASP Agent Control Standard emphasizes runtime inspectability/control hooks.

Decision:
add agent identity + capability leases + global action firewall.

## Observability
OpenTelemetry GenAI semantic conventions provide a useful interoperability model.

Decision:
keep AYAS-owned durable trace schema, but make operation/model/tool/error semantics compatible in spirit; do not automatically export sensitive prompt bodies.

## Local coding
OpenHands currently supports local LLM servers and recommends large capable coding models; hardware requirements for its preferred local model exceed the current workstation GPU.

Decision:
backend-neutral local coding adapter + benchmark. Do not hard-wire a model. On current hardware, use the best model that passes AYAS qualification; otherwise mark DEGRADED.

## Video/media sourcing
Wikimedia Commons:
per-item license and attribution verification required.

Openverse:
large openly licensed image/audio search corpus, but license metadata must still be independently verified per work.

Pexels:
official free photo/video API; current default limits 200 requests/hour and 20,000/month. Attribution is requested; terms restrict standalone redistribution, competing-library use and ML dataset/training extraction.

Decision:
Wikimedia stays primary historical asset source.
Openverse adds images/audio discovery with license verification.
Pexels can add contextual B-roll/photo under a dedicated terms/attribution adapter, never as an ML training dataset.
No scraping.

## YouTube
Existing repository already has a YouTube Data API publish provider with reconciliation/idempotency behavior.

Decision:
keep publish owner-governed. V3 focuses on `YOUTUBE_READY_OWNER_REVIEW` by default.

## Cost
Current repository `AiCostBudget` has a `$1.00` hard default.

Decision:
separate owner-preferred normal target `$0.25` from technical `$1.00` ordinary ceiling and per-project owner-approved cap.
No automatic cap escalation.

## Agentic commerce
OpenAI ACP, Google UCP and AP2 are emerging commerce/distribution/payment standards.

Decision:
monitor as future optional revenue distribution surfaces.
Do not make them foundation dependencies and never use them to bypass owner financial authority.
