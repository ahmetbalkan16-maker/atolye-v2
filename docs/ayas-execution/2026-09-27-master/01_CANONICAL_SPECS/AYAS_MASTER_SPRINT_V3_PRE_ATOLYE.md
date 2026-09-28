# AYAS MASTER SPRINT V3 — Pre-Atölye Independence + Live Director + Self-Funding
Date: 2026-09-27
Canonical intent: Finish AYAS as a safe, local-first assistant/director that can supervise Atölye production for years, continuously improve itself under bounded authority, recover from faults, control production cost, and build owner-approved revenue channels.

## Truth rule

This sprint does NOT promise “zero bugs forever”.

Success means:
- errors are detected quickly;
- unsafe work stops fail-closed;
- durable state is not lost;
- safe operational faults are automatically recovered;
- code defects enter the controlled self-evolution path;
- last-known-good rollback exists;
- AYAS never hides a failure or invents a PASS.

## User operating intent

AYAS should act as:
1. personal assistant / co-director;
2. Atölye production supervisor;
3. safety and quality controller;
4. cost controller;
5. local-first self-improving developer;
6. research/technology scout;
7. revenue intelligence/operator under platform and owner rules.

Example production request:
“Çanakkale Savaşı’nı 10–15 dakikalık etkileyici bir video olarak hazırla.”

AYAS should orchestrate:
research → facts → narrative → scene plan → real/open media → character/stick-figure reenactment → narration → music/SFX → transitions → assembly → QA → cost report → owner review → YouTube-ready package.

---

# PHASE 0 — 2026-09-27 Remediation

Apply and validate the existing remediation bundle.

Mandatory:
- Graphify `.graphify/needs_update` fail-closed
- memory/retrieval correction + temporal supersession
- observer-autostart test isolation
- sparse-array hardening
- developer task lifecycle correction
- model-routing docs correction
- runtime-health evidence-driven follow-up
- phone model immutable revision/digest
- safe CI only after local green baseline

No Stage 15 work proceeds over a new regression.

---

# STAGE 15 — Controlled Self-Evolution

Implement existing Stage 15 design:
Stage 13 opportunity → current qualification → TEMP experiment → verified evidence → immutable patch artifact → proposal → explicit owner approval → existing Package C → post-execution verification.

No self-approval.
No self-push.
No paid fallback.

---

# STAGE 15A — Local Coding Runtime / No-Cloud Developer Capability

Goal:
AYAS can perform ordinary future code maintenance without requiring Codex/Claude Cloud.

Required:
- provider-neutral local coding agent adapter;
- local coding task contract;
- isolated coding sandbox/container;
- local planner/generator/evaluator;
- immutable patch artifact;
- existing proposal/owner approval bridge;
- no host credentials/network by default;
- no direct canonical branch mutation.

Backends are replaceable.
OpenHands/Qwen/etc are reference candidates, never automatic dependencies.

Qualification suite must use real AYAS historical defects and held-out tasks.
If hardware/model cannot meet the threshold:
`LOCAL_INDEPENDENCE_DEGRADED`
and no silent cloud fallback.

---

# STAGE 15B — Durable Long-Horizon Task Runtime

One shared durable task contract for:
- self-development;
- research;
- revenue;
- Atölye supervision.

Survive:
- process crash;
- reboot;
- model restart;
- network loss;
- owner waits;
- duplicate daemon;
- tool timeout.

Use append-only/event journal semantics.
Persist non-deterministic activity results before advancing.
Never blindly replay uncertain side effects.

Every side effect:
- idempotency key;
- exact target;
- attempt identity;
- current-state reread;
- bounded retry;
- uncertain terminal state when proof is missing.

---

# STAGE 15C — Memory Integrity / Context-Poisoning Firewall

Add:
- provenance/trust class;
- content digest;
- producer identity;
- security-screen result;
- suspicious-memory quarantine;
- protected fact keys;
- rapid-change anomaly detection;
- integrity snapshot;
- known-good rollback;
- read-time trust filtering.

External content never becomes privileged future instruction merely by entering memory.

---

# STAGE 15D — Agent Identity + Capability Leases + Global Action Firewall

Every live agent/run receives:
- agent identity;
- owner/delegation identity;
- task identity;
- exact capability set;
- exact resource scope;
- TTL;
- cost class;
- read/write/financial/production classification.

All tools/MCPs/adapters pass one runtime guard.

Decision:
- ALLOW_READ
- ALLOW_BOUNDED_LOCAL
- REQUIRE_OWNER
- DENY

No autonomous financial approval state.

---

# STAGE 15E — Model / Strategy Lifecycle Manager

Lifecycle:
DISCOVERED → PINNED → QUALIFIED → SHADOW → CANARY → ACTIVE → DEGRADED → RETIRED

For:
- local LLMs;
- coding models;
- TTS;
- image/video helpers;
- prompts;
- improvement strategies;
- evaluator versions.

Promotion requires:
- benchmark;
- held-out;
- security;
- hardware fit;
- repeated consistency;
- rollback target.

Newer != better.

---

# STAGE 15F — Durable Observability + Eval Governance + Reliability SLO

Extend Unified Trace from process-local to durable, privacy-bounded operational evidence.

Record:
task, agent, model version, tool/action, approval binding, retry, duration, outcome, error code, evidence digest.

Do not persist raw secrets/private bodies.

Eval system:
- capability suites;
- near-100% regression suites;
- frozen held-out;
- multiple trials;
- outcome + transcript + deterministic graders;
- model graders only when necessary;
- owner/human calibration.

Reliability SLO examples:
- unauthorized writes = 0
- duplicated external writes = 0
- stale-HEAD mutations = 0
- unexplained task loss = 0
- regression-gate bypass = 0

---

# STAGE 15G — SBOM / Provenance / Release Trust

Generate:
- dependency SBOM;
- dependency versions/digests;
- model/binary artifact digests;
- licenses;
- install-script classification;
- advisory state;
- Graphify HEAD;
- test matrix digest;
- build artifact digest;
- release provenance manifest.

No autonomous dependency upgrades.

---

# STAGE 15H — Autonomy Burn-In + No-Cloud Independence Certification

Cloud coding providers OFF.

Fault matrix:
process kill, reboot, model death, network loss, DNS failure, 429/500, disk fixture, corrupt state, bad clock, duplicate daemon, stale Graphify, needs_update, delayed owner, rejected proposal, stale HEAD, regression, memory poisoning, malicious repo content, invalid tool schema, auth expiry.

Representative local maintenance tasks must prove:
detect → plan → local patch → tests → Graphify → proposal → owner → apply → verify → recover/rollback.

Pass:
`LOCAL_INDEPENDENCE_READY`

Fail honestly:
`LOCAL_INDEPENDENCE_DEGRADED`

---

# STAGE 15I — AYAS ↔ Atölye Live Production Director Control Plane

AYAS becomes the live supervisor over the existing production pipeline.

New `AyasProductionDirectorSession` binds:
- owner request;
- topic;
- target duration;
- format;
- budget authorization;
- current pipeline stage;
- project HEAD/config identity;
- source/fact pack;
- scene plan;
- asset manifest;
- audio state;
- assembly state;
- quality findings;
- cost state;
- fault state;
- publication readiness.

AYAS watches every stage through read/status evidence.

It may autonomously perform only pre-approved SAFE_OPERATION classes:
- retry bounded transient reads;
- regenerate a missing/corrupt local artifact through existing stage contracts;
- resume an already-authorized stage using existing durable recovery rules;
- choose a zero-cost provider/fallback already allowed by policy.

It may NOT autonomously:
- change source code;
- spend beyond approved project cap;
- publish;
- change rights classification;
- bypass a production gate.

Source-code defect:
route into Stage 15 controlled self-evolution.
Production pauses at a safe checkpoint until validated repair is promoted.

---

# STAGE 15J — Historical Storytelling + Character / Stick-Figure Engine

Purpose:
10–15 minute engaging historical documentary/story videos with low-cost local visuals.

## Historical Fact Pack

Before script:
- key claims;
- dates;
- people;
- locations;
- uncertainty;
- primary/secondary source references;
- claim-to-scene mapping.

Factual claim without evidence cannot silently enter narration.

## Narrative contract

Default 10–15 minute structure:
- cold open / question / tension
- context
- stakes
- escalation
- turning point
- consequence
- payoff
- legacy / closing thought

Narrative quality checks:
- repeated facts;
- long exposition;
- unresolved setup;
- chronology break;
- abrupt transition;
- unsupported dramatic claim;
- excessive static visual time.

## Hybrid visual grammar

Scene media classes:
- real historical photo
- archival document
- map/timeline
- public-domain/open-license illustration
- contextual real B-roll
- local SVG stick-figure/character reenactment
- diagram/text card

Synthetic reenactment must be clearly classified/labeled when it could be mistaken for historical evidence.

## Stick-figure engine

Prefer deterministic local generation:
- SVG primitives/characters;
- reusable rigs;
- expressions/poses;
- props;
- environment layers;
- arrows/maps/timelines;
- pan/zoom/parallax;
- FFmpeg composition.

No paid image generation is required for normal character scenes.

Build:
- `CharacterRig`
- `CharacterPose`
- `CharacterExpression`
- `SceneBlocking`
- `PropLibrary`
- `HistoricalCostumeHint`
- `CameraBeat`
- `SvgSceneRenderer`
- `CharacterSceneManifest`

Reuse current motion-plan + FFmpeg scene-video pipeline instead of adding a heavy framework unless benchmark proves needed.

## Media sourcing

Current real-photo Wikimedia provider remains.
Add reviewed source adapters over time:
- Openverse for openly licensed images/audio, with per-item license verification;
- Pexels for contextual photos/videos only under current API/attribution/terms;
- other archives only after rights/API review.

Do not scrape.
Do not use NC/restricted media for monetized content.
Rights unknown => block/review.

## Voice / sound

Keep Piper as current stable Turkish local baseline.
Run a TTS bake-off under Stage 15E for any new local voice engine before adoption.

Music/SFX:
- local/user-owned assets first;
- public-domain/commercially-compatible open audio;
- license + attribution manifest;
- ducking/loudness/voice intelligibility checks.

No copyrighted commercial music without explicit rights.

---

# STAGE 15K — Production Cost Governor / Budget Approval

## Important current-code truth

Existing repo hard default:
`DEFAULT_AI_COST_BUDGET_USD = 1.00`

V3 separates:
1. technical maximum ceiling;
2. normal preferred target;
3. per-project owner-approved cap.

Initial owner policy:
- preferred target: `$0.25/video`
- ordinary technical ceiling: `$1.00/video`
- current owner-declared available production allowance: `$9.85` at planning time
- actual wallet/provider balance must be revalidated or labeled owner-declared/derived at execution.

## Preflight

Before paid dispatch, estimate:
- LLM
- image
- video
- TTS
- music/SFX
- retries/reserve

Output:
- estimated total
- conservative maximum
- free/local alternatives
- expected quality tradeoff
- projected wallet after job

### Decision

If estimate <= approved project cap:
continue.

If estimate > approved cap but <= ordinary technical ceiling:
pause BEFORE paid call and ask exact owner escalation:
“Estimated $0.82. Current approved cap $0.25. Authorize this project up to $1.00?”

AYAS never raises the cap itself.

If estimate > technical ceiling:
BLOCK by default and require a separately reviewed exceptional budget decision.

## Reservation

Reserve project cap from available production allowance before execution.
Prevent concurrent projects from oversubscribing budget.

After completion:
actual spend settles;
unused reserve releases.

Mid-project:
if projected remaining spend can exceed cap, pause before next billable call.

Unknown pricing => fail closed.

## Local-first cost order

Prefer where quality passes:
- Ollama/local LLM
- Piper/local TTS
- Wikimedia/Openverse/Pexels permitted free assets
- local SVG character scenes
- FFmpeg assembly
- cached/reused assets

Paid generation is an exception for quality gaps, not the default.

---

# STAGE 15L — Autonomous Production Fault Repair + Resume Supervisor

Fault classifier:
- TRANSIENT_EXTERNAL
- PROVIDER_UNAVAILABLE
- RATE_LIMIT
- ASSET_MISSING
- ASSET_CORRUPT
- RIGHTS_BLOCK
- QUALITY_BLOCK
- COST_BLOCK
- HOST_DEPENDENCY
- PIPELINE_STATE_DRIFT
- CODE_DEFECT
- UNKNOWN

Automatic safe repair examples:
- bounded retry/backoff;
- zero-cost allowed provider fallback;
- regenerate missing local scene asset;
- re-run deterministic assembly;
- resume from durable stage checkpoint;
- reconcile indeterminate YouTube upload without duplicate upload.

Must reuse:
- existing production idempotency;
- durable recovery;
- stage-bounded resume;
- retry budgets;
- Runtime Stability Guard.

`CODE_DEFECT`:
never hot-patch production directly.
Create Stage 15 coding task, run local sandbox, test/Graphify/review/promotion, then resume.

`UNKNOWN`:
fail closed and explain.

---

# STAGE 15M — Production Quality / YouTube-Ready Gate

Before READY:

## Fact quality
- claim references complete;
- dates/names/locations consistent;
- reconstruction labels;
- source quality adequate.

## Visual quality
- no off-topic/homonym assets;
- no low-resolution critical media;
- no excessive visual repetition;
- stick-figure character continuity;
- scene timing;
- transitions.

## Audio quality
- narration complete;
- no clipping;
- loudness/intelligibility;
- music ducking;
- scene/audio duration alignment;
- no long silence.

## Story quality
- hook;
- pacing;
- chronology;
- payoff;
- repeated narration;
- curiosity loop resolved;
- no unsupported sensationalism.

## Technical quality
- ffprobe duration;
- codec/container;
- 1080p target where intended;
- thumbnail;
- captions/subtitles;
- attribution/credits manifest.

## YouTube package
Generate:
- final MP4
- thumbnail
- title options
- description
- chapters/timestamps
- source/attribution block
- tags/keywords where useful
- subtitle file
- cost report
- quality report

Default outcome:
`YOUTUBE_READY_OWNER_REVIEW`

Existing YouTube Data API publish path remains owner-governed.
No automatic public upload unless owner separately enables exact governed publication.

---

# STAGE 16 — Revenue Center + Self-Funding

Keep all existing Stage 16.0–16.14 designs plus mandatory additions:

## 16.0A Account/Credential Boundary
minimum scopes, expiring connections, secrets external to memory/ledger.

## 16.3A Offer/Product Factory
AYAS turns proven capability into a sellable service/product package.

## 16.3B Fulfillment Quality Gate
AYAS never sells work it cannot reliably deliver.

## 16.11A Terms/Compliance Boundary
platform automation/terms/account/tax/legal uncertainty must be surfaced.

## Self-funding rule

Revenue and production are separate ledgers.

Realized revenue may fund production only through:
realized ledger → reserve → owner-reviewed reinvestment policy → production allowance.

No expected revenue.
No automatic cross-wallet spend.

Agentic commerce standards (ACP/UCP/AP2) are watched as future distribution opportunities, not mandatory dependencies.

---

# STAGE 17 — Full System Audit / Foundation Closure

Foundation closure now requires verification of:
- Phase 0
- Stage 15
- 15A–15M
- Stage 16 + additions
- existing runtime/security/memory/retrieval/voice/mobile/production
- Brain UI functional regression status
- no-cloud burn-in
- production director E2E
- cost governor E2E
- revenue framework closure

Closure:
BLOCKER 0
unresolved verified MAJOR 0
one current HEAD
Graphify current
truthful live/static/test evidence separation.

---

# ∞ CONTINUOUS EVOLUTION

After owner activation:
AYAS continuously observes:
- conversation quality
- memory/retrieval
- security
- dependency/model ecosystem
- production/media/director quality
- revenue performance
- runtime reliability

It may research and propose continuously.
It may run bounded TEMP experiments.
It never self-approves source promotion or unbounded spend.

---

# BRAIN UI V2

Proceed on separate branch.

Add V3 live tiles:
- Director Session
- Production Stage
- Current Video Cost / Approved Cap
- Production Allowance
- Fault/Recovery
- Revenue
- Continuous Evolution health

No fake percentages.

---

# FINAL PRE-ATÖLYE ACCEPTANCE TEST

Run one complete representative historical project, for example a 10–15 minute documentary fixture.

Required proof:
1. owner topic intake;
2. source/fact pack;
3. narrative/scene plan;
4. real media + local character scenes;
5. local narration;
6. music/SFX rights;
7. transitions/assembly;
8. fault injected mid-production and safe recovery demonstrated;
9. cost preflight;
10. budget escalation behavior tested;
11. actual cost report;
12. quality gate;
13. YouTube-ready package;
14. no unauthorized publish/spend;
15. Stage 17 mini/full audit;
16. protected data unchanged;
17. owner sign-off.

Then run No-Cloud Independence Certification with cloud coding disabled.

Only after both pass:
`AYAS FOUNDATION CLOSED`
`CONTINUOUS EVOLUTION ACTIVE`
`PRIMARY DEVELOPMENT FOCUS -> ATÖLYE`
