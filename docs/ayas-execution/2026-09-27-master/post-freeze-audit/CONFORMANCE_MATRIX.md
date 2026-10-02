# Targeted post-freeze conformance audit

Status: **COMPLETE**. Supplement: `01_CANONICAL_SPECS/AYAS_POST_FREEZE_DESIGN_ADDENDUM_V1.md`. Audit baseline: `09e1c68825830924ee5c44ec815598704f443dcb`. Resolve the current HEAD with `git rev-parse HEAD`.

This audit creates no stage and re-runs no closed stage. It checks only the requirements the addendum added. A row found as a safe gap and then fixed reads SATISFIED and names what the audit found.

32 requirements: 8 NOT_CURRENTLY_APPLICABLE, 6 SATISFIED_BY_EQUIVALENT_IMPLEMENTATION, 14 SATISFIED, 4 GAP_OWNER_GATED. Found as a safe gap and fixed: 5. Safe gaps still open: 0. The six Stage 15Q rows were re-evaluated at the Stage 15Q closure (2026-10-02, source `ab6e5312d7b8b8d8893b4dfca59bfe510bb29ef4`); the audit's own counts at its closure are in `CLOSURE.md`.

| ID | Stage | Addendum | Status | Requirement |
|---|---|---|---|---|
| 15B-applicability | 15B | 1.3 | NOT_CURRENTLY_APPLICABLE | Detect whether a real browser or session executor exists before building a watchdog |
| 15B-durable-recovery | 15B | 1.2, 1.4-1.6 | SATISFIED_BY_EQUIVALENT_IMPLEMENTATION | Durable identities, bounded retry, inspect and reread first, no blind replay, uncertainty never becomes success |
| 15C-dynamic-budget | 15C | 2 | SATISFIED (found GAP_SAFE_TO_FIX, fixed) | Whole-prompt budget: known window, reply reserve, deterministic trimming, protected retention, refusal when the mandatory part does not fit |
| 15C-memory-firewall | 15C | 2.3 | SATISFIED | Quarantined and suspicious memory kept out of the prompt; external content stays data; no memory value changes policy |
| 15C-live-window-config | 15C | 2.4 | GAP_OWNER_GATED | The model window is known for a live call |
| 15F-tool-measurements | 15F | 3.2, 3.4 | SATISFIED_BY_EQUIVALENT_IMPLEMENTATION | Per-operation event with task, agent, tool, model, attempt, lease binding, duration, outcome, error code and digest; counts, latency and retry views; no invented thresholds |
| 15F-outcome-detail | 15F | 3.3, 3.6 | SATISFIED (found GAP_SAFE_TO_FIX, fixed) | Timeout, owner wait and resource abort as their own classes; an owner wait is not a failure; one retry counted once |
| 15F-privacy | 15F | 3.2, 3.5 | SATISFIED | No credential, token, message body or free text in telemetry; live state from real transitions |
| 15Q-health | 15Q | 4.2, 4.3 | SATISFIED | Resource classes and a resource snapshot in which an unavailable sensor is UNKNOWN |
| 15Q-single-heavy | 15Q | 4.4, 9.2, 9.3 | SATISFIED (found GAP_SAFE_TO_FIX, fixed) | One heavy workload at a time; no new heavy job at 90 % host RAM or above as owner policy; RESOURCE_ABORT / HOST_PROTECTION kept apart from model failure |
| 15Q-on-demand | 15Q | 4.5, 4.6, 9.1 | GAP_OWNER_GATED | On-demand local coding runtime lifecycle, unload after a task, Podman idle stop, no automatic wsl --shutdown, no model preload at Windows startup |
| 15Q-lazy-prewarm | 15Q | 4.7 | SATISFIED | Lazy load by default; prewarm only on measured benefit and safe headroom, cancellable at once |
| 15Q-active-app | 15Q | 4.8 | GAP_OWNER_GATED | Coarse active-application awareness with no keystrokes, screen contents or stored window titles |
| 15Q-image-cleanup | 15Q | 4.9 | SATISFIED | Classify Podman images before any prune; never prune a qualification or provenance dependency blindly |
| 15Q-host-tuning | 15Q | 9.4 | SATISFIED | No autonomous overclock, undervolt, BIOS change, thermal-protection change, rootful Podman conversion or global WSL/Windows mutation |
| artifacts-local | GLOBAL | 5 | SATISFIED | Verified model and engine artifacts kept locally and git-ignored, hash-identified, not re-downloaded, not duplicated, no credentials beside them |
| 15S-manifest | 15S | 6.2 | NOT_CURRENTLY_APPLICABLE | Migration manifest covering local models, engine and tool artifacts, voice assets, runtime policy, governor configuration and hashes |
| 15S-images | 15S | 6.3 | NOT_CURRENTLY_APPLICABLE | For each required Podman image: export and import, or rebuild from a pinned base and verified inputs, stated in the manifest |
| 15S-restore | 15S | 6.4, 6.5 | NOT_CURRENTLY_APPLICABLE | Secrets outside the snapshot; PASS only after dependencies, paths, hashes, Graphify, benchmark, stores, policy and a TEMP import drill are verified |
| 15S-old-pc | 15S | 6.6 | NOT_CURRENTLY_APPLICABLE | Nothing deleted from the old machine before the new one is verified and the owner confirms |
| 15T-priority | 15T | 7.3, 7.4 | NOT_CURRENTLY_APPLICABLE | CRITICAL / ACTION_REQUIRED / MATERIAL_INFO / ROUTINE with alert metadata |
| 15T-cooldown-dedupe | 15T | 7.5 | NOT_CURRENTLY_APPLICABLE | One dedupe key per issue, cooldown, re-notify only on material change |
| 15T-discipline | 15T | 7.2, 7.6 | NOT_CURRENTLY_APPLICABLE | Proactivity may notify, summarize, recommend or request approval and nothing more; routine events do not interrupt |
| voice-existing-state | BRAIN_UI_VOICE | 8.2, 8.3, 8.6 | SATISFIED_BY_EQUIVALENT_IMPLEMENTATION | IDLE, LISTENING, THINKING, SPEAKING and ERROR shown only from real voice or turn events; text chat keeps working when audio fails |
| voice-tool-action | BRAIN_UI_VOICE | 8.2, 8.3 | SATISFIED (found GAP_SAFE_TO_FIX, fixed) | TOOL_ACTION shown when a real tool executes and withdrawn when it returns |
| voice-waiting-owner | BRAIN_UI_VOICE | 8.2 | SATISFIED_BY_EQUIVALENT_IMPLEMENTATION | WAITING_OWNER shown when an owner gate is pending |
| voice-recovering | BRAIN_UI_VOICE | 8.2 | SATISFIED_BY_EQUIVALENT_IMPLEMENTATION | RECOVERING shown for a recoverable fault |
| voice-barge-in | BRAIN_UI_VOICE | 8.4 | SATISFIED (found GAP_SAFE_TO_FIX, fixed) | The owner can cut in while AYAS speaks: speech stops, AYAS listens, the turn and recorded results are untouched |
| voice-barge-in-acoustic | BRAIN_UI_VOICE | 8.4 | GAP_OWNER_GATED | Speech stops by itself when the owner begins to speak |
| voice-gate | BRAIN_UI_VOICE | 8.5 | SATISFIED | Voice and UI can request, display, narrate and interrupt audio; they cannot grant a capability or an approval, clear SAFE_READ_ONLY, raise a budget or run a privileged action |
| continuation | GLOBAL | 10, 12 | SATISFIED_BY_EQUIVALENT_IMPLEMENTATION | Handoff reconciles repository, worktree, checkpoint, ledger and Graphify; exact HEAD and next action recorded; no reset, clean, stash, force checkout or force push to ease continuation |
| targeted-work | GLOBAL | 11, 13 | SATISFIED | Relevant skills only; no whole-repository re-inventory, no closed stage redone; test, Graphify, local commit, checkpoint; no push |

## Owner-gated rows

- **15C-live-window-config**: BLOCKED_OWNER_ACTION, not blocking the master order. (1) OLLAMA_NUM_CTX must be set on every machine that runs AYAS chat; this workstation has 8192, a machine without it answers every model turn that the window is not configured. (2) AYAS_CLOUD_CONTEXT_TOKENS must be set in wrangler.toml before the phone gateway Worker is deployed again; the deployed Worker is unchanged. No window is chosen or raised without the owner.
- **15Q-on-demand**: BLOCKED_OWNER_ACTION, not blocking the master order. The lifecycle is built and tested as a source contract. (1) The local coding engine is unregistered (the Stage 15A/15H owner decision), so the controller has no real backend and model unload and the Podman idle stop are not observed behaviour. (2) Podman Desktop and Ollama have logon startup entries, observed and unchanged; removing one is a host-global change and the owner's.
- **15Q-active-app**: BLOCKED_OWNER_ACTION, not blocking the master order. Coarse process presence and published production stages are in place, inside the privacy boundary. The owner chooses the coarse signal for "the owner is using the machine"; until then owner interaction is UNKNOWN and a new heavy local model start is deferred.
- **voice-barge-in-acoustic**: BLOCKED_OWNER_ACTION, not blocking the master order: device validation. It needs the microphone open while AYAS speaks, with the device separating AYAS's voice from the owner's, which can only be judged on a real phone and a real PC microphone. Not built, and not claimed from a mock.

## Not currently applicable

Stages 15S and 15T are not reached, and no browser or session executor exists. Each row in `CONFORMANCE_MATRIX.json` names what must exist first and when to look again. Nothing was built as a stand-in, and none of these rows counts as a pass.

Evidence paths, limits and notes for every row are in `CONFORMANCE_MATRIX.json`. Findings: `NEW_FINDINGS.md`, PF1 to PF9. Nothing was pushed.
