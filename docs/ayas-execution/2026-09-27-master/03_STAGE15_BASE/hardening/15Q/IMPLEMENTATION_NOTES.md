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

## 15Q.R — failed full baseline retained

Full declaredv28 at exact cleane1cb95dd4a9d9cc0996160bdf10a6fdf8efbd8d6 is FAIL; failed=["durable-task-recovery"]. Recovery static audit rejects scripts/smoke-ayas-resource-governor.ts, which legitimately imports durable journal/runtime for its TEMP-only defer/resume scenario. No production binding regression identified. Packet not GREEN; preserve complete failed report and exact stderr/stdout, then narrowly admit the TEMP probe with confinement/negative controls. No guard/quality threshold lowered.

15Q.R focused GREEN: exact new probe allowlisted with explicit os.tmpdir prefix/one TEMP journal/no recovery sweep or side effects; four redirected-root/effect negative controls rejected. Recovery22/36 journal roots, resource19/34 mutants, eval10/8, TypeScript/changed lint PASS. v28 exact e1 Git bytes archived; v29 108 suites/127 pins. Full corrected baseline remains pending.

## 15Q.1 GREEN packet

15Q.1 exact clean source `b381ed44ca5c1a8575130721af8929e9df36ce79`: v29 declared108/108 PASS_WITH_KNOWN_LIMITATIONS, failed0, cognitive54/55 and held-out4/5 unchanged; 127 grader pins match committed blobs. Focused19 resource scenarios/34 mutants plus affected regressions; TypeScript/lint/diff PASS (13 old warnings). Sampled host RAM maximum54.4%. Graphify17443/49941, zero integrity anomalies; PARTIAL9/semantic pending retained. Admission/capacity source primitives only, not a hardware benchmark or real production/runtime binding.

See15Q1_RESULT.json and full baseline. Automatically proceed15Q.2: bounded STOPPED/STARTING/READY/BUSY/DRAINING/STOPPING/ERROR lifecycle, task/evidence persistence before unload, active/UNCERTAIN dependency protection, idle10min Podman stop, lazy/prewarm cancellation and dependency-aware image classification. Preserve existing unregistered/degraded engine boundary; no host-global startup/WSL changes.

## 15Q.2 — ON_DEMAND controller and image dependency contract

Base4828e44. Required injected current capability/pinned-backend ports; no production backend, CLI, default live journal, startup hook or import-time activation. Fixed HEAVY_LOCAL_AI under the host-common capacity mutex. Strict pinned model/runtime/profile and exact persisted coding-contract mapping; current task/runtime identity reread before effects/work. Ports are trusted host adapters, not model data or permissions. Existing engine registry remains empty.

Seven phase vocabulary through existing durable lifecycle-evidence ports. Verified missing prior phase required before admission and under lock; ERROR/partial/unknown prior phase requires reread, never automatic effect replay. Bounded reads/effects (max30s) and one bounded workload (max30min), abort signal, explicit resource outcome. An unconfirmed operation preserves the task and blocks replay; it cannot be reported as a qualified model run.

Terminal durable task sequence/digest and exact evidence/checkpoint receipts are read back before unload. Fresh complete dependent task inventory, exact server/container ownership and current authority checked at every cleanup boundary; ACTIVE/UNCERTAIN/unmeasured dependencies refuse stop. Confirm server stopped, exact task containers removed and model memory released. Idle machine stop only at600000ms with no demand/dependency/foreign containers, a fresh post-authority reread and exact owned-machine capability. No global WSL shutdown or prune surface.

Five read-only image classes: complete union of all-version qualification/provenance/rollback/durable references protects images even with partial inventory; current/rebuild-required and stale-rebuildable retained; only complete unused managed images classified RECLAIMABLE, still authority NONE. No image is deleted. Caller must supply a measured complete inventory and verified pinned rebuild inputs.

Lazy task demand only; prewarm remains disabled in this controller. Stage15Q.1 supplies measured-benefit/cancellation policy but no real prewarm consumer is activated. Host boot behavior was observed only during the prior baseline; no boot trace or host startup change claimed. Actual engine/model unload, hardware benchmarks and production/render common-capacity consumer binding remain NOT_WIRED/UNMEASURED. These source contracts preserve the existing15A/15H DEGRADED qualification boundary.

Focused initial controller11 and24 full-matrix mutants passed; final targeted-case mutation run and affected regressions in progress. Private mutation case selection is restricted to a gitless TEMP audit root; declared baseline still runs all11 scenarios. v29 exact Git bytes archived; v30 declares110 suites/129 unique grader pins. No physical start/provider/production/push.

Draft review: prior verified STOPPED may resume the same still-pending task, after current runtime/task reread; partial/ERROR/UNAVAILABLE phases never auto-replay. Priority/pressure DEFER returns TASK_DEFERRED, preserves the pending journal/attempt budget and can unload only after confirmed no runtime-dependent work. Later safe demand resumes the same durable task. Critical RESOURCE_ABORT stays distinct from model failure. Proof covers current own task as well as separately observed foreign ACTIVE/UNCERTAIN dependencies. Every asynchronous port is bounded; command ports receive an abort signal. Initial prefer-const lint and independent-dependency mutation coverage gap corrected before commit; draft evidence15Q2_DRAFT_REVIEW.json. Final tests in progress.

Final focused GREEN: controller11,24/24 targeted controls (48.9s; full unmutated11 verified first), recovery22/36 roots and runtime17/18 roots, resource19/34, eval10/8, TypeScript/changed lint PASS. Full lint0 errors/13 existing warnings. v30 110 suites/129 pins; v29 archived bytes exact4828e44. Separate foreign ACTIVE/UNCERTAIN observations repaired the coverage gap; no guard removed. Final source/Graphify/clean stage baseline pending.

Scope reconciliation before closing the stage: source controller alone does not establish a global concurrency guarantee. After15Q.2 local commit and exact clean pin-verified new suites, continue15Q.3: existing production/render/heavy caller integration with shared source governor/capacity and honest current context. Do not close15Q or open15R while this source integration remains. Full declared stage baseline follows that integration. Physical engine activation/hardware evidence stays independently owner-gated/unmeasured.

## OWNER STOP — 2026-10-02T17:56:36.681Z

Owner stopped development with "15O.2 bitince dur15O.3 e başlama". Requested15O.2 boundary had already passed before receipt. Source0763db5 already contains completed15O.3,15P,15Q.1 and focused-GREEN15Q.2.15Q.3 was not started. Lifecycle11/24 controls plus recovery22/runtime17/resource19/34/eval10/8 and TypeScript/lint PASS; full lint0 errors/13 existing warnings. Exact clean isolated new suites and fullv30 110 baseline NOT_RUN;15Q stage remains open. No physical engine/model/provider/production/host-global activation or push. Preserve all work; resume only after explicit owner instruction.

SeeOWNER_STOP.json. Source Graphify17491/50046, zero integrity anomalies, PARTIAL9/semantic pending at clean0763db5. No new heavy Graphify job after stop checkpoint; exact HEAD metadata refresh deferred to authorized resume.

## Owner scope updated — 2026-10-02T17:57:36.024Z

Latest request:15Q.2 bitir öyle dur. Previous15O.2 stop boundary superseded. Complete15Q.2 exact clean full declaredv30 110-suite validation and packet checkpoint, then OWNER_STOPPED. Source0763db5 focused GREEN retained.15Q.3 source integration and later stages are outside the resumed scope; Stage15Q overall remains open. NO PUSH.

## 15Q.2 GREEN — OWNER STOP

15Q.2 source0763db5 exact clean validation8d1c28c: full declaredv30 110/110 PASS_WITH_KNOWN_LIMITATIONS, failed0;129 committed grader pins; cognitive54/55 and held-out4/5 unchanged. Controller11/24 negative controls, recovery22/runtime17, resource19/34, eval10/8, TypeScript/lint PASS (13 old warnings). Sampled RAM max55.11%. Graphify17492/50048, zero integrity anomalies; PARTIAL9/semantic pending retained. Injected source controller/image contract only; real backend/physical hardware not qualified. Stage15Q remains open. Owner instruction: finish15Q.2 then STOP.

See15Q2_RESULT.json and full baseline. No15Q.3 or later work. Resume only with explicit owner direction.
