# Stage 15R — source CLOSED GREEN, not live (2026-10-03)

Stage 15R source is closed at `a00091fdcc68f4588b2403b67e008ce796e117a1`. The full declared v32 baseline ran at that exact clean commit: 114/114 suites, no failure, `PASS_WITH_KNOWN_LIMITATIONS`; cognitive 54/55 and held-out 4/5 unchanged; sampled host RAM peak 65.51 %. 133 grader pins match the committed bytes. A real Next server in a TEMP clone drove the owner page end to end. The mode was never entered on the live checkout, and the owner's running server does not carry this source until it is rebuilt and restarted.

## The canonical requirement and where it stands

| Requirement | State |
|---|---|
| One owner-visible action enters SAFE_READ_ONLY | The button on `/brain/safe-mode`; also `npx tsx scripts/ayas-safe-mode.ts enter` at the machine. Proven end to end on a TEMP server. |
| Chat and status allowed | The firewall issues and admits reads in every state; the chat, intake and speech-to-text routes are not guarded. |
| Read-only research allowed | Read tools through chat stay available. The observer's scheduled research tick is held with the rest of the discovery run (allowed, not required). |
| Source write stopped | Firewall owner reservations refused; the approval entry points and `executeApproved` refuse before a decision or reservation; the self-heal CLI's applies refuse. |
| Production mutation stopped | No new stage is admitted; the sixteen mutating production routes answer 423 before reading their body. A stage already running is not interrupted. |
| External platform write and publish stopped | `YouTubePublishPipeline.publishStoredPackage` refuses; git publication happens only inside the approval services, which refuse. |
| Spend stopped | No stage starts, the routes that call providers answer 423, and a new cost reservation is refused. |
| Self-evolution experiments and heavy scheduled work stopped | The discovery child holds its whole run before its ledger entry and lease; the firewall refuses the lease and every capability if that is bypassed. |
| Persists across reboot | The mode is files, read at every decision; no process holds it. Shown across processes; an operating-system reboot was not performed. |
| Cannot be cleared by model, tool or research text | The mode is not an action; nothing on the allowlist or among the reserved actions names it; the CLI has no exit; no component imports the store; the one importer of the exit is the owner page's action. |
| Exit only by explicit owner action plus health checks | The owner session from the cookie, verified before the store is read and again before the write; five checks read at that moment and stored in the EXIT event; the form binds the mode the owner was shown. |

## Declared limits

1. **Not live.** The owner's Next server and the observer process run the build and the source they loaded. Only the discovery child, started fresh each tick, honours the mode today.
2. **A running stage is not interrupted.** There is no safe cancellation contract for a stage handler.
3. **Raw file access is outside the boundary.** A process that can write the repository's `data/` tree can also write the log, as it can the execution gate. A forged EXIT that is not shaped like an owner exit clears nothing; a well-formed one would.
4. **The console has no indicator.** The mode shows on its page, in the CLI and in every refusal reason; an indicator in the main console belongs to Brain UI V2.
5. **Operator tools are not bound.** The runtime backup tooling, a manual `git` operation, a manual build and the production acceptance CLIs outside stage execution are the operator's own actions; stage execution through them is refused at admission.
6. **Not driven:** the hydrated in-browser form submit, an operating-system reboot, a refusal on the owner's real server.
7. **Production suites are outside the declared baseline** (F33): 36 were run in an isolated clone, with the same non-passing set as clean HEAD.

## Owner actions (none blocks the master order)

- Rebuild and restart the Next server and restart the AYAS Autonomy Observer Scheduled Task to load Stages 15Q.3 and 15R. Then open `/brain/safe-mode` once: the page has not been seen in the owner's browser.
- Leaving the mode needs the configured access key (`AYAS_ACCESS_KEY`) and a signed-in session. On a machine without it the mode can be entered but not left through the page.

## Evidence

15R_RESULT.json, 15R_FULL_BASELINE_V32.json, 15R_FOCUSED.json, 15R_OWNER_PAGE_E2E.json, 15R_PRODUCTION_REGRESSION.json, GRAPHIFY_15R_PRECOMMIT.json, GRAPHIFY_15R_SOURCE_COMMIT.json. Findings: F34 (two packet-caused failures found on the overlay and fixed before the commit). No model, container, provider, production stage, publish or host setting changed. Source publication on this WIP branch is authorized by the current owner request.

Stage 17 keeps its own drill for this stage: SAFE_READ_ONLY persistence across a real restart.

Next: canonical Stage 15S (Portable Brain Snapshot / Hardware Migration). PC HEALTH / ON_DEMAND retained. The owner request of 2026-10-03 authorizes commit/push after Stage 15 closure and at session end; it supersedes historical NO PUSH entries.
