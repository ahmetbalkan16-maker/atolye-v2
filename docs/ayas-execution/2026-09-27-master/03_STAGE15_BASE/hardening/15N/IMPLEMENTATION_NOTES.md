# Stage15N — Owner Constitution / Root of Trust

Opened after15M source e1241dfd5246adb03690080a1b8a8ac0c3bbba65. Canonical final-order15N and V3.1 freeze15N read; prior lower-priority next16 projection superseded. Only16.0 spec inventory was read; no16 source implementation.

One versioned owner-only constitution covers approval, spend, publishing, production, protected data/paths, privacy, zero-cost, Graphify-first, no silent cloud fallback and no self-approval/promotion. AYAS may propose, never edit/activate autonomously. Every long-running agent/tool/revenue/self-evolution run must bind current digest.

15N.0 existing-seam inspection completed. Stage not complete, no owner-only blocker asserted until concrete source/review work is prepared. NO PUSH; PC HEALTH and ON_DEMAND retained.

## 15N.0 inspection and bounded implementation plan

Existing owner boundary: accessGate signed12-hour HttpOnly session, requireBrainSession server actions; local-dev missing key may bypass the general guard, so constitution activation must explicitly require configured owner key and a verified session. Reuse that authentication, not a model-written owner flag. Existing authority mutex/atomic fsync-link publication and contained runtime directory helpers are reused. Reader/binding module must import no approval/execution writer, preserving observer transitive-authority isolation. Owner-only writer and UI action stay separate. No new issuer or financial authority.

Plan15N.1: closed conservative constitution schema/digest; public Ed25519 verification rooted in an immutable owner-published public-key anchor and signed append-only versions, tied to physical repository root. Bootstrap publishes anchor+version1 as one staged directory; updates append one version under existing mutex with expected previous digest. Owner signing material derives privately from the existing access key after real session verification and never reaches policy/log/memory. Reader uses only public verification, no secret. Run binding rechecks current digest before new dispatch, refuses change/uncertainty, never converts a serialized digest into approval. Draft/current-state page and existing-cookie owner server action provide a concrete review/activation route. No activation by this coding agent.

Plan15N.2: bind common action firewall plus observer/discovery/durable new-start seams, preserving cleanup/recovery and inherited valid behavior while MISSING is explicitly unadopted. Invalid/changed policy must refuse new work; no silent fallback to unadopted after activation. Every active run must have digest evidence. Remaining revenue runs register the same guard when built in Stage16. Tests/audits before actual owner activation; no new blocking gate asserted until source/UI/review packet is ready.

## Implemented source and validation boundary

15N.1 closed proposal schema, real owner-only signed bootstrap/append writer, immutable public anchor/contiguous signed version reader and exact digest review action/page implemented. Writer authenticates before payload/fs and again under the existing authority lock. Public reader imports no auth/signer/writer and gives no approval authority. Owner key rotation refuses implicit rebind. No host activation.

15N.2 common action firewall checks binding at all six issue/admit seams and each discovery capability; protected source/data paths are withheld even with an existing owner reservation. Observer main binds once; tick holds children on change/uncertainty. Durable operator gates enqueue/new starts while recovery can settle uncertain work. Research tick, LIGHT/DEEP scans and parent runs bind independently; every HTTP redirect/retry and each new model/entry dispatch rechecks. Normal evidence exposes domain/run/digest/state/authority NONE. Revenue/self-evolution share the generic binding and common tool guard; no Stage16 revenue adapter exists yet. No alternative execution issuer.

Machine health reads the owner RAM threshold, default90 when unadopted; invalid policy refuses new heavy admission. Existing critical/high pressure and owned-work cleanup remain. ON_DEMAND unchanged; no host daemon/server/model/provider/container was started or restarted.

Focused core16 and final run-binding18 scenarios; core17/17 mutations caught plus1 explicit equivalent control, binding13/13 caught. Development fixture/mutation discoveries retained in TEST_DEVELOPMENT_FINDINGS.json. Manifest v19 archived unchanged; v20 declares95 suites/108 unique pins. TypeScript and changed lint PASS; full baseline/final Graphify/source commit pending.

Trust boundary: owner authentication uses the existing shared access key/session, not a new individual owner identity. Public anchor is protected by the owner writer/path admission and trusted host filesystem; an attacker controlling the complete host filesystem is outside this boundary. Binding checks before new effects do not undo an already-started external effect. MISSING preserves inherited behavior explicitly unadopted with digest null, never ACTIVE/READY. Existing resident processes need owner-controlled restart after adoption. Runtime live certification and browser-render validation are not claimed. Initial owner adoption remains pending; only this exact reviewed owner session action can activate it.

## Fullv20 finding / v21 final validation

Fullv20 completed all95 suites:94 green or declared known limitation; only durable-task-recovery static importer inventory failed on the two new TEMP CLI fixtures. Both are now explicitly listed with independent no-runtime-import/TEMP-root/isolated-cwd assertions. Production caller set, owner off switch, exact-one and journal assertions unchanged. Initial FULL_BASELINE_V20.json and failure output retained. Binding mutation suite13/13 passed in117166ms; the two new aggregate constitution mutation suites receive a300s outer runner deadline while each trial remains30/60s bounded. Historical graders/manifestv20 archived; v21/95 with108 unique pins was prepared. No full v21 run was made: the session ended here and v21 was superseded by v22 below.

## Handoff review before the source commit (Codex -> Claude, 2026-10-02)

The previous session stopped after the v20 repair above, with the packet uncommitted and the checkpoint still naming 15N.0. The repository was taken as the truth: the draft was read and measured at this workstation's real values before it was validated. Two defects were found and fixed; both failed closed, and neither could weaken a rule.

1. The bound repository depended on how the caller spelled its path. The reader hashed `fs.realpathSync(repoRoot)`, which on Windows keeps the caller's drive-letter and casing spelling, and a child process inherits its parent's spelling of the working directory. Measured here: a process started from `c:\Users\...` (how the editor spells this workspace) and one started from `C:\Users\...` produced different root digests for the same directory. After the owner's adoption the server, the observer and an operator shell could therefore disagree: one would read the signed policy as unverifiable and refuse every new run, and an owner append from another spelling would be refused. The suites did not see it because each TEMP root was used under one spelling. Fix: one helper, `constitutionPhysicalRoot` (`fs.realpathSync.native`), used by the reader, the run binding and the owner writer. New scenario: three other spellings of one adopted TEMP repository read, bind and append the same constitution. Negative control (Windows only, where a second spelling exists): restoring the old call fails that scenario.

2. The adoption state was not ignored by Git. `data/brain/owner-constitution/`, the writer's lock directory and the bootstrap staging directory had no `.gitignore` rule, unlike every sibling `data/brain` runtime subtree. The owner's adoption would have left untracked files: the observer would report the repository as not clean, the cleanliness gates would hold, the eval baseline would refuse to start (`AYAS_EVAL_OVERLAY_UNEXPECTED`), and a broad `git add` could have committed a machine-bound signed record. Fix: three anchored `.gitignore` rules. New scenario: the rules are present and they name everything the writer creates beside the tracked README. Negative control: removing the rule fails it.

Owner constitution suite: 18 scenarios. Negative controls: 19/19 caught plus the one declared equivalent. Run binding 18, durable task recovery 22 (the v20 failure, now green), eval governance 10, firewall closure 12, discovery registry 15, TypeScript, changed-file lint and diff check PASS on the worktree. Manifest v21 archived unchanged; v22 has the same 95 suites and 108 unique pins and differs only in the two owner-constitution grader pins.

Limits found in the review and left as they are, because closing them needs an owner decision or a later stage:

- Removing the whole `data/brain/owner-constitution` directory returns a process that starts afterwards to the unadopted state. A run bound before the removal refuses new work. This is inside the declared boundary (the host file system is trusted); there is no second anchor outside that directory. The owner page shows "not adopted" when it happens.
- The page offers the first adoption only. The writer can append a signed later version, but no owner route calls it yet.
- A process that was already running when the owner adopts holds new work until it is restarted: the observer logs `CONSTITUTION_HOLD` on every tick.

The full declared baseline is run once, at the source commit, on v22.

## Source closure (2026-10-02)

Source commit `9cdf5dbdede418dd35c6a9a1c5057299c20af693`. Declared baseline on v22 at that commit with a clean tree: 95 of 95 suites, PASS_WITH_KNOWN_LIMITATIONS, no failure, cognitive 54/55 and held-out 4/5 unchanged, host RAM peak 50.59 %. 108 unique grader pins match the committed blobs. Full lint 0 errors / 13 existing warnings. Production build PASS in a TEMP clone; the repository `.next` and the running server were not touched. Graphify at the commit: 17,202 nodes / 49,285 links, no anomaly, PARTIAL 9 and semantic pending.

Stage 15N is closed as source. Nothing was adopted on this host; adoption is the owner's action and does not block later stages. See `CLOSURE.md`, `15N_RESULT.json` and `OWNER_REVIEW_PACKET.json`.
