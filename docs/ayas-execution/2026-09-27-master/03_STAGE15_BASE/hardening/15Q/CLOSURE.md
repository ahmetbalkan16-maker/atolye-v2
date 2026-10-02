# Stage 15Q — source CLOSED GREEN with declared gaps (2026-10-02)

Stage 15Q source is closed at `ab6e5312d7b8b8d8893b4dfca59bfe510bb29ef4`. The full declared v31 baseline ran at that exact clean commit: 112/112 suites, no failure, `PASS_WITH_KNOWN_LIMITATIONS`; cognitive 54/55 and held-out 4/5 unchanged; sampled host RAM peak 55.55 %. 131 grader pins match the committed bytes. The production build passes in a TEMP clone. Nothing here is a hardware benchmark or a live runtime proof.

## What the stage built

The existing Machine Health guard is extended, not replaced.

| Packet | Commit | What it is |
|---|---|---|
| 15Q.1 | `b381ed4` | Five workload classes and a contextual admission decision (`AyasResourceGovernor`): owner RAM admission policy from the constitution, critical pressure as a resource abort that is never a model-quality failure, owner and production priority, one heavy workload, unknown sensors and unknown occupancy as unknown, projected memory, prewarm only on measured benefit. One host-common capacity lock held for the whole heavy operation (`AyasResourceCapacity`). |
| 15Q.2 | `0763db5` | The bounded on-demand lifecycle controller (STOPPED → STARTING → READY → BUSY → DRAINING → STOPPING, ERROR) behind injected ports: evidence and checkpoint read back before unload, no stop while an active or uncertain task depends on the runtime, ten-minute idle stop of the exact owned machine, no WSL shutdown or prune surface. Read-only image dependency classification. |
| 15Q.3 | `ab6e531` | The shared occupancy inventory and its consumers: production publishes its stages and has priority; a render stage and a loaded local model never start together; heavy self-development (the discovery child and its sandbox lanes) waits for production, for another heavy workload and for an unreadable inventory, and honours the owner RAM policy; a read-only operator view. |

## Canonical rules and where each stands

| Rule | State |
|---|---|
| Owner chat stays responsive | An INTERACTIVE request is always admitted; heavy work never takes its place. No owner-activity signal is measured, so background work is not paused for a chat turn (gap 2). |
| Production gets explicit priority | Enforced in source: published stages pause discovery and defer any non-production capacity holder; production is never held by an unreadable inventory. Live only after the owner rebuilds and restarts the Next server. |
| Heavy self-evolution pauses under pressure | Enforced: PAUSE, STOP and now BLOCK NEW HEAVY WORK hold the sandbox lanes (F32); the discovery child reads the owner RAM policy (F31). |
| No big model and heavy render together unless benchmarked | Enforced in source in both start orders. No registered engine publishes a model record today. |
| Hardware change recalibrates benchmarks | The context carries a hardware fingerprint and the governor defers on a mismatch. No benchmark is bound to a fingerprint yet, so nothing is compared (gap 4; Stage 15S migration). |
| No task lost when throttling | Deferred and refused work keeps its durable task and attempt budget (15Q.1 and 15Q.3 scenarios). |

## Declared gaps

1. **The local coding engine is not registered** (Stage 15A/15H: LOCAL_INDEPENDENCE_DEGRADED). The on-demand controller has no real backend ports and nothing calls it outside its tests. Model unload, Podman idle stop and prewarm are contracts, not observed behaviour. OWNER_DECISION, unchanged from Stage 15A.
2. **Owner interaction is not measured.** Addendum 4.8 forbids keystrokes, screen contents and stored window titles; which coarse signal to use (an AYAS chat turn in flight, a recent-chat window, an operating-system idle time) is the owner's choice. Until then the value is UNKNOWN and a new heavy local model start is deferred. OWNER_DECISION.
3. **Loaded-model footprint, thermal state, queue depth and host-protection events (OOM, swap thrash, responsiveness) have no measured source.** Critical RAM, VRAM and disk pressure from the existing telemetry is what produces a resource abort. The A2000 60 °C stop stays in the Brain probe layer for GPU work.
4. **No benchmark is bound to the hardware fingerprint**, and the fingerprint has no GPU identity.
5. **Operator-run heavy tools are not capacity holders**: the eval baseline, a build, a Graphify refresh and the local-coding qualification runner are admitted by whoever runs them, under the PC-health rule. Owner-approved governed execution keeps its pressure check only, because its one-shot authorization is reserved before the check.
6. **Windows startup was observed, not traced.** Podman Desktop and Ollama have logon startup entries; the Podman machine was stopped and no model process was present when observed (15Q_HOST_OBSERVATION_DURING_15P_BASELINE.json). AYAS adds no startup preload. Changing a host startup entry is the owner's.
7. **Production suites are outside the declared baseline** (F33): nine of 31 fail in an isolated clone at clean HEAD for reasons that predate this stage.

## Owner actions (none blocks the master order)

- Rebuild and restart the Next server so production publishes its stages; restart the AYAS Autonomy Observer Scheduled Task (already pending since Stage 15B). The discovery child already runs the new source.
- Decide gap 1 (existing local-coding re-qualification decision) and gap 2 (owner-activity signal).
- `npx tsx scripts/ayas-resource-status.ts` shows the governor's view at any time.

## Evidence

15Q1_RESULT.json, 15QR_FULL_BASELINE_V29.json, 15Q2_RESULT.json, 15Q2_FULL_BASELINE_V30.json, 15Q3_FOCUSED.json, 15Q3_PRODUCTION_REGRESSION.json, 15Q3_RESULT.json, 15Q3_FULL_BASELINE_V31.json, GRAPHIFY_15Q3_SOURCE_COMMIT.json, the failed v28 report kept as 15Q1_FULL_BASELINE_V28_FAILED.json, and the post-freeze conformance rows for 15Q in `post-freeze-audit/CONFORMANCE_MATRIX.json`. No model, container, provider, production stage, host setting or push in the whole stage.

Next: canonical Stage 15R (Global SAFE_READ_ONLY Emergency Stop). PC HEALTH / ON_DEMAND / NO PUSH retained.
