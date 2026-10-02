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
