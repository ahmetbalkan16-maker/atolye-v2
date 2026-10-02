# Stage15Q — Hardware / Resource Governor

Opened 2026-10-02 after source `409ef9616b9477e9047b5028bcc92cbf50ea309e` closed15P. Authority:final execution order15Q, freeze15Q, post-freeze4 and global0/9. Extend existing Machine Health; preserve current architecture.

## 15Q.0 — existing seams

- Telemetry already reads CPU/RAM/GPU/VRAM/disk and coarse ffmpeg/model-process signals; unavailable sensors stay UNKNOWN. Model-process presence does not prove loaded-model footprint. No keystrokes/screens/window titles.
- MachineHealthGuard gates production admission/owned boundary, execution revalidation and observer/discovery. Existing owner constitution carries configurable maxRamAdmissionPercent (current90) and ON_DEMAND. Preserve old actions while adding contextual admission.
- Durable runtime admitStart refuses before ATTEMPT_STARTED; DEFER preserves journal bytes and attempt budget. Existing authority lock gives PID/start-time mutual exclusion.
- Qualification runner refuses stopped Podman, removes exact task containers in finally and retains qualification evidence. No registered production local coding engine (15A/15H DEGRADED). On-demand README is a manual lifecycle; controller must persist task/evidence before unload, refuse active/UNCERTAIN dependencies, scope stop to AYAS-owned runtime, idle10min and never global WSL shutdown.
- Five workload classes, one heavy admission, configurable90% policy, explicit owner/production priority, separate HOST_PROTECTION abort, UNKNOWN sensors, lazy default/cancellable measured prewarm. Protect pinned qualification/provenance dependencies before any image cleanup; no blind prune.

## Host observation

15Q_HOST_OBSERVATION_DURING_15P_BASELINE.json is a read-only inventory during serial baseline, not a boot trace. Podman stopped; no llama-server/Qwen/render process; Ollama app/server presence with model-loaded UNKNOWN. PodmanDesktop/Ollama startup names observed and unchanged; AYAS observer/access scheduled tasks running. No command lines/screens/window titles/keystrokes. It does not prove boot timing or loaded-model memory. Host-global startup changes retain an owner gate.

## Next packet

Implement contextual resource admission and bounded durable ON_DEMAND lifecycle through these seams, with read-only operator/inventory. No actual model activation or host-global mutation. Test required boundaries/negative controls, TypeScript/lint/pins, Graphify and local commit; update checkpoint and automatically next packet/stage. NO PUSH.

## 15Q.1 — contextual resource admission / common capacity

Implemented AyasResourceGovernor through the existing Machine Health evaluator, telemetry collector and owner constitution (current90% admission). Five classes, explicit owner/production priority, fresh snapshots (30s conservative metadata bound), required CPU/GPU/core sensors, projected peak memory, unknown external model/render occupancy, UNCERTAIN dependencies and hardware-change recalibration. Optional unmeasured metrics remain UNKNOWN/null; process presence is not loaded-model footprint. Prewarm requires measured benefit and safe headroom and is cancelled by priority/pressure. No action/approval authority is granted.

Existing telemetry now includes measured host RAM total/free bytes; old Machine Health refuses non-finite/out-of-range percentages. Common capacity reuses the PID/start-time authority lock for the entire heavy operation, rereads pressure after acquisition, requires an absolute local host-common root with no live default, and separates capacity-busy from a domain error after execution began. All heavy consumers must use the same host-owned root; current production/local qualification callers have not yet been bound to this new primitive. No live concurrency or hardware benchmark is claimed.

19 synthetic snapshot/TEMP scenarios and34 negative controls passed, including real concurrent promises under the filesystem lock, post-lock pressure race, operation-domain lock failure, preserved durable journal/attempt budget and later resume. Existing Machine Health20/non-GPU36, constitution binding18, self-heal14, exact patch23, vault13 (v2/18), durable runtime17 and eval governance10/8 mutants passed. TypeScript/changed lint and manifest v28 (108 suites/127 pins; v27 archive identical) passed. Full lint/Graphify/source commit/full declared baseline follow. Initial scenario harness used the durable creation API incorrectly; corrected to its real signature and COMPLETED task status before validation, without changing that runtime.

Resource policy/graders are never-autonomous in every Windows spelling. Source packet only: no physical model/runtime start, no host startup/WSL mutation, no production/push. Next15Q.2:bounded ON_DEMAND lifecycle, durable evidence before unload, active/UNCERTAIN stop protection, idle10min and image dependency classification.

Final full lint0 errors/13 existing warnings. F28 confirmed against parent6f0649b:diskFreePercent NaN previously ALLOW, now BLOCK NEW HEAVY WORK. Offline transpilation/VM with inert imports; no host effect. Guard validator and negative controls cover this boundary.
