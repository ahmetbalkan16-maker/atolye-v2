# AYAS — FINAL CODEX MASTER EXECUTION ORDER
Version: V3.2 FINAL + V3.1 Freeze + Revenue Dashboard + Final Audit
Date: 2026-09-28
Mode: IMPLEMENTATION, NOT REDESIGN

## 0. MASTER MISSION

AYAS’ın temel mimarisi, güvenlik kuralları, self-evolution sistemi, Revenue Center, Atölye Director, Brain UI V2 ve final kapanış kriterleri önceden tasarlandı.

Bu görevin amacı yeni bir mimari tasarlamak DEĞİLDİR.

Görevin:
- bu paketteki kanonik tasarımları exact kaynaklarından oku;
- mevcut repository gerçekliğiyle BİR KEZ reconcile et;
- belirlenen sırayla uygula;
- çalışan davranışları koru;
- gerçek bir eksik/bug/regresyon bulursan reproduce et, regression testi ekle, onar ve tekrar yeşile getir;
- Graphify’ı kaynak değişikliklerinden önce/sonra güncel tut;
- her yeşil atomik iş paketinde checkpoint bırak;
- tüm işler review-ready olana veya gerçek owner-only blocker’a kadar devam et;
- finalde AYAS’ın bütün sistemlerini tek HEAD üzerinde baştan sona audit et;
- owner onayı olmadan canonical merge/push/publish/spend/approval yetkisi üretme.

AYAS’ın hedefi:
1. uzun yıllar local-first şekilde güvenli çalışmak;
2. kendi konuşma/memory/security/research/coding yeteneklerini kontrollü geliştirmek;
3. Atölye’yi canlı yönetmen/supervisor gibi yönetmek;
4. production hatalarını güvenli biçimde bulmak, mümkünse toparlamak ve devam ettirmek;
5. video başına maliyeti owner sınırları içinde kontrol etmek;
6. güvenli revenue kanalları kurmak;
7. ne yaptığını owner’a şeffaf şekilde göstermek;
8. sıradan gelecekteki geliştirmelerde Codex/Claude Cloud’a mecbur olmamak;
9. sorun çıktığında “gizli kötü devam” yerine fail-closed / rollback / owner escalation kullanmak.

Bu komutun ve paketin içeriği implementation authority’dir. Yeni roadmap üretme.

---

# 1. SOURCE OF TRUTH / KAYNAKLAR

Bu final handoff paketinin dizin yapısını koru.

Kanonik repository dokümantasyon konumu:

`docs/ayas-execution/2026-09-27-master/`

Repo içine yalnız human-readable spec/evidence dosyalarını ve onaylı UI referansını kopyala.
ZIP arşivlerini repo içine commit etme.

Öncelik sırası:

1. CURRENT VERIFIED REPOSITORY BEHAVIOR + PASSING TESTS
2. `00_COMMAND/AYAS_FINAL_CODEX_MASTER_EXECUTION_ORDER.md`
3. `01_CANONICAL_SPECS/AYAS_MASTER_EXECUTION_DIRECTIVE_V3_2.md`
4. `01_CANONICAL_SPECS/AYAS_MASTER_EXECUTION_ORDER_V3.md`
5. `01_CANONICAL_SPECS/AYAS_MASTER_SPRINT_V3_PRE_ATOLYE.md`
6. `01_CANONICAL_SPECS/AYAS_MASTER_SPRINT_V3_1_FINAL_FREEZE_ADDENDUM.md`
7. `01_CANONICAL_SPECS/AYAS_V3_2_REVENUE_ACTIVITY_DASHBOARD_ADDENDUM.md`
8. stage-specific specifications in this pack
9. reference-only historical/context documents

Eski bir tasarım maddesi daha yeni, doğrulanmış ve çalışan koda ters düşüyorsa:
- yeni doğru davranışı KORU;
- çatışmayı kaydet;
- tasarımı mevcut doğru davranışa adapte et;
- regression testi ekle/güncelle;
- sırf eski dokümana uymak için sistemi geriletme.

Doküman yazılmış olması implementation kanıtı değildir.
Kod + test + Graphify + current evidence gerekir.

---

# 2. TOKEN / LOOP DISCIPLINE

Bu görevde açık uçlu araştırma veya yeniden tasarım yapma.

YASAK:
- yeni roadmap üretmek;
- stage’leri yeniden numaralandırmak;
- alternatif mimarileri uzun uzun tartışmak;
- aynı repo inventory’sini sebepsiz tekrar tekrar yapmak;
- aynı stage’i green olduktan sonra tekrar analiz etmek;
- eski V1/V2 tasarım paketlerini yeni authority gibi kullanmak;
- “daha güzel olur” diye broad refactor yapmak;
- internette genel AI araştırmasına yeniden başlamak.

Her stage için sadece:

READ SPEC -> INSPECT AFFECTED CODE -> IMPLEMENT -> TEST -> GRAPHIFY -> REVIEW -> FIX IF NEEDED -> COMMIT -> CHECKPOINT -> NEXT.

Bir stage’e ancak şu durumlarda geri dön:
- ilgili HEAD değişti;
- test/regression başarısız;
- Graphify gerçek anomaly buldu;
- independent review gerçek defect buldu;
- current official API/terms tasarım varsayımını materyal olarak değiştirdi.

External web doğrulaması yalnız güncel resmi davranış gereken noktalarda:
Etsy, Upwork, Fiverr, Udemy, Lemon Squeezy, Wikimedia/Openverse/Pexels, exact dependency advisory, exact candidate model/backend license/hardware.
Official/primary source kullan, exact soruyu cevapla, kaynağı/tarihi kaydet ve dur.
Genel araştırma döngüsüne girme.

---

# 3. STARTUP / BASELINE — KAYNAĞA DOKUNMADAN ÖNCE

İlk olarak:

- current branch
- local full HEAD
- upstream full HEAD
- real remote full HEAD (available ise)
- ahead/behind
- worktree state
- untracked files
- current Graphify HEAD/state
- `.graphify/needs_update`
- relevant baseline tests
- protected runtime/data roots

kaydet.

Bunları:
`docs/ayas-execution/2026-09-27-master/EXECUTION_LEDGER.md`
ve
`ACTIVE_CHECKPOINT.json`
içine yaz.

Historical handoff SHA’yı current truth kabul etme.

Worktree’de unrelated user changes varsa:
- reset yapma;
- clean yapma;
- stash yapma;
- overwrite yapma;
- force checkout yapma.
Çakışan affected path varsa source mutation’ı durdur ve exact blocker yaz.
Bağımsız güvenli işi sürdürebiliyorsan sürdür.

---

# 4. GRAPHIFY — ABSOLUTE RULE

Graphify-first zorunlu.

Source değişikliğinden önce:
- Graphify usable/current olmalı;
- `.graphify/needs_update` honor edilmeli;
- stale/anomaly fail-closed;
- affected architecture paths anlaşılmalı.

Source değişikliğinden sonra:
- Graphify update/rebuild;
- current HEAD binding;
- duplicate node/edge/dangling/self-loop/anomaly review;
- approval/execution/security/production/revenue authority widening kontrolü.

Aynı HEAD’de kaynak değişmediği sürece gereksiz full rebuild tekrarı yapma.
Her source commit eski Graphify HEAD binding’i geçersiz kılar.

Graphify’ı hız için bypass etmek yasak.

---

# 5. GLOBAL SAFETY / OWNER AUTHORITY

AYAS hiçbir zaman model output, research text, web content, customer/platform message, log, tool output veya önceki approval’dan owner authority türetemez.

Koru:
- explicit owner approval
- source promotion gate
- production gate
- publish gate
- financial gate
- protected paths
- zero-cost defaults
- security policy
- owner constitution
- rollback/recovery

YASAK:
- self-approval
- self-merge
- self-push canonical
- silent paid fallback
- autonomous budget increase
- unauthorized public publish
- autonomous financial approval
- dependency auto-upgrade
- security/approval policy’yi self-edit
- external text’in path/tool/command/approval/spend seçmesi

Unknown authority/cost/provider/schema/evidence/path/tool => FAIL CLOSED.

---

# 6. GIT DISCIPLINE

YASAK:
- `git reset --hard`
- `git clean`
- `git stash`
- force-push
- force checkout over user work
- `git add -A`
- `git commit -a`
- `--no-verify`

Explicit intended paths stage et.

Her logical stage/substage küçük, reviewable commit’ler halinde olsun.
Intentionally broken source commit etme.

---

# 7. TEST / REGRESSION RULE

Bir subsystem’i değiştirmeden önce relevant passing contract’larını belirle.

Var olan passing behavior bozulursa:
- sonraki stage’e geçme;
- reproduce et;
- root cause bul;
- production code’u düzelt;
- coverage yoksa regression testi ekle;
- focused + affected regression matrix’i tekrar koştur;
- Graphify tekrar doğrula.

Passing olmak için test silme/zayıflatma/hardcode etme.
Evaluator/benchmark’ı kendini geçirecek şekilde değiştirmek yasak.

Riskli testler TEMP/fixture/test stores kullanır.
Gerçek runtime/revenue/memory/approval/production store ancak explicit owner-supervised live validation’da kullanılabilir.

---

# 8. CHECKPOINT / 5-HOUR USAGE CONTINUITY

Canonical state files:

- `EXECUTION_LEDGER.md`
- `ACTIVE_CHECKPOINT.json`
- `NEW_FINDINGS.md`

Her atomik subtask BAŞLAMADAN:
`ACTIVE_CHECKPOINT.json` güncelle.

Her GREEN atomik packet SONRASI:
- tests
- Graphify
- commit
- ledger
- checkpoint
- exact nextAction

kaydet.

Kullanım/token hakkı biterse yeni session MASTER sprinti baştan başlatmayacak.

Continuation rule:

> Read MASTER_EXECUTION_ORDER, EXECUTION_LEDGER, ACTIVE_CHECKPOINT and NEW_FINDINGS. Inspect actual git branch/HEAD/worktree/upstream and Graphify. Repository truth outranks checkpoint. If matching, resume exact stage/subtask/nextAction. If not matching, preserve user work, inspect changes since lastGreenHead, classify completed/incomplete/unrelated work, rerun focused validation, repair checkpoint and resume. Never reset/clean/stash/force-push to simplify recovery.

Session sonunda kısa handoff:
- stage/subtask
- last green SHA
- tests
- Graphify
- findings
- blockers
- exact nextAction

---

# 9. EXECUTION ORDER — EXACT

Aşağıdaki sırayı değiştirME:

## PHASE 0 — Remediation

Kaynak:
`02_REMEDIATION/`

Uygula/re-review:
- conversation/retrieval safe remediation
- temporal supersession / PC→laptop decision correctness
- Graphify `.graphify/needs_update` fail-closed
- observer-autostart TaskName isolation
- Stage 13 dense/sparse-array hardening
- developer lifecycle classification correction
- model-routing docs correction
- safe CI only after local deterministic green
- runtime-health issue evidence-driven
- phone/local model immutable revision/digest; SHA uydurma yok

Remediation yeni regression bırakırsa Stage 15’e geçme.

---

## STAGE 15 — Controlled Self-Evolution

Kaynak:
`03_STAGE15_BASE/`

Canonical flow:

Stage13 opportunity
-> current qualification
-> registered Stage8 TEMP experiment
-> measured evidence
-> immutable patch artifact
-> normal proposal
-> explicit owner approval
-> existing Package C / reviewed execution
-> post-execution verification

Yeni second authority/mutation/approval engine kurma.

Framework green olmadan real strategy ekleme.
Framework green olduktan sonra ilk production strategy:
- narrow
- deterministic
- owner-reviewed
- separate commit
- preferably <=2 files / <=80 changed lines
- robust primary + held-out tests

Production strategy registry’nin boş kalması Local Independence hedefini kapatamaz.

---

## STAGE 15A — Local Coding Runtime / No-Cloud Developer Capability

AYAS sıradan gelecekteki coding maintenance’i local yapabilsin.

Kur:
- provider-neutral coding adapter
- coding task contract
- isolated sandbox/container boundary
- planner/generator/evaluator
- patch artifact
- proposal bridge
- owner approval path

Sandbox:
- only intended repo/worktree
- no host credentials
- network denied by default
- no production/private data
- no package install without separate approval
- no arbitrary host shell

OpenHands/Qwen Code vb. yalnız candidate/reference.
Hard-wire etme.
Current hardware’da benchmark yap.

Qualification:
- historical AYAS bugs
- held-out coding tasks
- Graphify tasks
- memory/retrieval fixes
- security fixes
- UI fixes
- TypeScript refactors

Measure:
pass@1, repeated consistency/pass^k, regressions, tool misuse, scope violations, latency, hardware/resource use.

Hiçbir local backend threshold’u geçmezse:
`LOCAL_INDEPENDENCE_DEGRADED`
de.
Quality bar düşürme.
Silent Codex/Claude Cloud fallback yapma.

---

## STAGE 15B — Durable Long-Horizon Task Runtime

Self-development, research, revenue ve Atölye supervision için shared durable task contract.

Survive:
- process crash
- Windows reboot
- local model restart
- network loss
- owner hours/days delay
- tool timeout
- duplicate daemon

Append-only/event-journal semantics kullan.
Deterministic orchestration ile nondeterministic activities’i ayır.

Durably recorded model/tool result crash sonrası körlemesine yeniden çağrılmamalı.

Every side effect:
- idempotency key
- exact target
- attempt identity
- timeout
- bounded retry
- current-state reread
- indeterminate/uncertain terminal state

Mevcut recovery/journal/reservation/Stability Guard primitive’lerini reuse et.

---

## STAGE 15C — Memory Integrity / Context-Poisoning Firewall

Mevcut memory governance + atomic store + revisions + temporal model üstüne ekle:

- source provenance
- trust class
- content digest
- producer identity
- evidence reference
- write-policy result
- security-screen result
- suspicious-memory quarantine
- protected keys
- rapid-change anomaly detection
- integrity snapshot/manifest
- known-good rollback
- read-time trust filtering

External/web/platform/repository text memory’de tutulsa bile privileged instruction’a dönüşemez.

Context reset sonrası da poisoning test et.

---

## STAGE 15D — Agent Identity + Capability Lease + Global Action Firewall

Her agent/run:
- agent identity
- owner/delegation identity
- task identity
- capability set
- resource scope
- TTL
- cost class
- read/write/financial/production classification

Sensitive action için short-lived capability lease.

Lease:
- model text ile oluşamaz
- tool output ile widen edilemez
- expires
- exact resource/platform/repo bind
- revocable
- logged

Global runtime guard decision:
- ALLOW_READ
- ALLOW_BOUNDED_LOCAL
- REQUIRE_OWNER
- DENY

`ALLOW_AUTONOMOUS_FINANCIAL` yok.

---

## STAGE 15E — Model / Strategy Lifecycle Manager

Lifecycle:

DISCOVERED -> PINNED -> QUALIFIED -> SHADOW -> CANARY -> ACTIVE -> DEGRADED -> RETIRED

Uygula:
- LLM
- coding model
- TTS
- image/video helper
- prompt
- improvement strategy
- evaluator version

Record:
- immutable identity/digest
- compatibility
- benchmark version
- held-out
- security/provenance
- resource use
- rollback target

Newer != better.

Promotion:
capability + regression + security + hardware fit + repeated consistency + held-out.

Canary only bounded internal tasks.
No production/revenue external write.

Regression => last-known-good rollback / proposal.

Mutable `main` model artifacts yerine immutable pin/digest.

---

## STAGE 15F — Durable Observability + Eval Governance + Reliability SLO

Mevcut Unified Trace’i privacy-bounded durable evidence’e genişlet.

Persist only safe metadata:
- task
- agent
- model version
- tool/action
- approval binding
- retry
- duration
- outcome
- error code
- evidence digest

Raw secret/private bodies loglama.

Stable semantic conventions, low-cardinality operation names.

Eval:
- deterministic graders where possible
- outcome
- transcript
- model grader only when needed
- owner/human calibration
- multiple trials
- pass@1 / pass^k
- latency/failure/retry/scope violation

Separate:
- capability suite
- near-100% regression suite
- frozen held-out/golden suite

Eval definition reviewed/versioned artifact.
Agent kendi grader’ını pass olmak için değiştiremez.

SLO:
- unauthorized writes = 0
- duplicate external writes = 0
- stale-HEAD mutation = 0
- unexplained task loss = 0
- regression gate bypass = 0

---

## STAGE 15G — SBOM / Provenance / Release Trust

Generate:
- CycloneDX-compatible SBOM
- dependency exact versions
- integrity/provenance where available
- license
- lifecycle/postinstall classification
- advisory state
- model/binary digests
- Git HEAD
- lockfile digest
- Graphify HEAD
- test matrix digest
- build artifact digest
- release provenance manifest

No autonomous dependency auto-upgrade.
Online signing optional, owner-reviewed.
Offline/local hash manifest mandatory.

---

## STAGE 15H — Autonomy Burn-In / No-Cloud Independence Certification Framework

Cloud coding OFF.

Fault matrix:
- process kill
- reboot
- model death
- network loss
- DNS failure
- 429/500
- disk exhaustion fixture
- corrupt state
- backward/future clock
- duplicate daemon
- stale Graphify
- needs_update
- delayed owner
- rejected proposal
- stale proposal after new HEAD
- failed regression
- memory poisoning
- malicious repo content
- dependency-install request
- invalid MCP/tool schema
- external auth expiry

Representative maintenance task must prove:
detect -> plan -> local patch -> tests -> Graphify -> proposal -> owner path -> execute -> post-verify -> recover/rollback.

Result:
`LOCAL_INDEPENDENCE_READY`
or honest
`LOCAL_INDEPENDENCE_DEGRADED`.

---

## STAGE 15I — AYAS ↔ ATÖLYE LIVE PRODUCTION DIRECTOR

AYAS is live assistant/director over existing pipeline.

Create Director Session binding:
- owner request/topic
- target duration/format
- approved budget
- current pipeline stage
- config/head identity
- source/fact pack
- scene plan
- asset manifest
- audio
- assembly
- quality findings
- cost
- fault state
- publish readiness

Read/status evidence ile her stage’i izle.

Autonomous SAFE operational actions only:
- bounded transient retry
- allowed zero-cost provider fallback
- missing/corrupt local artifact regenerate via existing stage contract
- resume already-authorized stage via durable recovery

YAPAMAZ:
- source code hot-patch
- budget cap increase
- rights classification bypass
- publish
- production gate bypass

CODE_DEFECT => Stage 15 controlled self-evolution; production safe checkpoint’te pause.

---

## STAGE 15J — Historical Storytelling + Character / Stick-Figure Engine

Target:
10–15 minute engaging historical documentary/story videos.

Flow:
topic
-> research/fact pack
-> source/evidence map
-> narrative
-> scene plan
-> media plan
-> local character/stick-figure scenes
-> narration
-> music/SFX
-> transitions
-> assembly

Historical Fact Pack:
- claims
- dates
- people
- locations
- uncertainty
- source refs
- claim-to-scene map

Unsupported factual claim narration’a silently giremez.

Narrative structure:
- cold open / question / tension
- context
- stakes
- escalation
- turning point
- consequence
- payoff
- legacy/closing thought

Check:
repetition, exposition, unresolved setup, chronology, abrupt transition, unsupported drama, static visual duration.

Media classes:
- real historical photo
- archival document
- map/timeline
- open/public-domain illustration
- contextual real B-roll
- local SVG stick-figure/character reenactment
- diagram/text card

Synthetic historical reenactment, evidence sanılabilecek yerde label/classify.

Stick-figure/character engine local-first:
- CharacterRig
- CharacterPose
- CharacterExpression
- SceneBlocking
- PropLibrary
- HistoricalCostumeHint
- CameraBeat
- SvgSceneRenderer
- CharacterSceneManifest

Reuse current motion plan + FFmpeg.
Heavy new video framework only benchmark proves necessary.

Media:
- existing Wikimedia historical path
- Openverse discovery only with per-item license verification
- Pexels only contextual media under current terms/attribution
- no scraping
- rights unknown => block/review
- NC/restricted monetized use => block unless explicit valid rights

Voice:
- Piper current local baseline
- new TTS only 15E qualification after quality/hardware/security benchmark

Music/SFX:
- local/owned first
- commercial-compatible open/public-domain where verified
- attribution manifest
- loudness/ducking/intelligibility checks
- no unlicensed copyrighted commercial music

---

## STAGE 15K — Production Cost Governor

Current repository hard technical default:
`$1.00/video`

V3 policy separates:
1. preferred normal target
2. project-approved cap
3. technical ceiling

Initial policy:
- preferred target = `$0.25/video`
- ordinary technical ceiling = `$1.00/video`
- planning-time owner-declared available allowance = `$9.85`
- execution-time allowance must be revalidated or clearly labeled owner-declared/derived

Preflight BEFORE paid dispatch:
- LLM
- image
- video
- TTS
- music/SFX
- retry reserve

Output:
- estimated total
- conservative max
- free/local alternatives
- quality tradeoff
- projected remaining allowance

If estimate <= approved cap: continue.

If estimate > approved cap but <= technical ceiling:
PAUSE before paid call and ask exact owner escalation:
“Estimated $0.82. Current cap $0.25. Authorize this project up to $1.00?”

AYAS cap’i kendi yükseltemez.

Estimate > technical ceiling:
BLOCK; exceptional owner budget policy required.

Reserve approved project cap before execution.
Concurrent projects cannot oversubscribe.
Completion => actual settle, unused reserve release.
Mid-project projected exceed => pause before next billable call.
Unknown pricing => fail closed.

Prefer local/free where quality passes:
- Ollama/local
- Piper
- Wikimedia/Openverse/Pexels permitted media
- local SVG
- FFmpeg
- cache/reuse

Paid generation exception, not default.

---

## STAGE 15L — Autonomous Production Fault Repair + Resume

Classify:
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

Safe auto repair:
- bounded retry/backoff
- already-approved zero-cost fallback
- missing local scene asset regenerate
- deterministic assembly rerun
- durable stage resume
- indeterminate YouTube upload reconcile without duplicate upload

Reuse:
- idempotency
- durable recovery
- stage-bounded resume
- retry budget
- Runtime Stability Guard

CODE_DEFECT:
no direct production hot patch.
Create Stage15 coding task -> local sandbox -> test -> Graphify -> proposal -> owner promotion -> resume.

UNKNOWN:
fail closed + explain.

---

## STAGE 15M — Production Quality / YouTube-Ready Gate

Before READY:

Fact:
- claim refs
- date/name/location consistency
- reconstruction label
- source quality

Visual:
- no homonym/off-topic
- resolution
- repetition
- character continuity
- timing/transitions

Audio:
- complete narration
- no clipping
- loudness/intelligibility
- ducking
- duration alignment
- silence

Story:
- hook
- pacing
- chronology
- payoff
- repetition
- curiosity loop resolved
- no unsupported sensationalism

Technical:
- ffprobe
- codec/container
- intended resolution
- thumbnail
- subtitles
- attribution/credits

Generate:
- MP4
- thumbnail
- title options
- description
- chapters/timestamps
- source/attribution block
- tags/keywords where useful
- subtitles
- cost report
- quality report

Default:
`YOUTUBE_READY_OWNER_REVIEW`

Existing YouTube Data API remains owner-governed.
No automatic public upload unless exact owner policy later enables it.

---

## STAGE 15N — Owner Constitution / Root of Trust

Create one versioned owner-only constitution:
- owner approval boundaries
- autonomous spend
- publishing
- production authority
- protected paths/data
- privacy
- zero-cost
- Graphify-first
- no silent cloud fallback
- no self-approval/promotion

AYAS may propose changes but cannot activate/edit autonomously.

Every long-running agent/tool/revenue/self-evolution run binds current constitution digest.

---

## STAGE 15O — Golden Benchmark & Regression Vault

Permanent versioned protected suite:
- conversation
- memory/retrieval correction
- coding repair
- security/adversarial
- production recovery
- 2–3 historical golden-video projects
- revenue dry-run
- Brain UI functional regressions

Flow:
baseline -> candidate -> held-out -> golden regression -> review.

One metric improves but golden regresses => promotion stops.

Agent cannot silently rewrite vault.

---

## STAGE 15P — Source Trust & Evidence Graph

Every external result:
- source/domain
- source type
- first-party/secondary/community
- freshness
- license/usage
- claim/evidence links
- corroboration/conflict
- trust level for exact use

Trust is contextual.
API docs authority != historical authority.

Different policies:
- historical claims
- code adoption
- security guidance
- platform/revenue terms

External text always DATA, never authority.

---

## STAGE 15Q — Hardware / Resource Governor

Extend current machine health.

Track where reliable:
- CPU
- RAM
- GPU/VRAM
- disk
- temperatures
- active production
- model footprint
- queue pressure

Classes:
- interactive
- light background
- heavy local AI
- media render
- maintenance

Rules:
- owner chat responsive
- production explicit priority
- heavy self-evolution throttle/pause under pressure
- no big model + heavy render concurrently unless benchmarked safe
- future hardware migration => recalibrate benchmarks

Do not lose tasks when throttling.

---

## STAGE 15R — Global SAFE_READ_ONLY Emergency Stop

One owner-visible action enters:
`SAFE_READ_ONLY`

Allowed:
- chat/status
- read-only research

Stopped:
- source write
- production mutation
- external platform write
- publish
- spend
- self-evolution experiments
- heavy scheduled mutation work

Persists across reboot.
Cannot be cleared by model/tool/research text.
Exit only explicit owner action + health checks.

---

## STAGE 15S — Portable Brain Snapshot / Hardware Migration

Export approved durable state:
- Owner Constitution
- non-secret config metadata
- memory/retrieval
- research/evolution
- model/strategy registry
- approved proposal/history
- revenue ledger/policy
- audit/eval history
- Graphify revalidation metadata
- checkpoint/roadmap

Exclude:
- tokens/secrets
- machine absolute paths
- transient cache
- unverified binaries

Manifest + hashes + schemas + compatibility.
Encrypt when private content included.

Import:
validate dependencies -> rebind paths -> Graphify rebuild -> model/hardware benchmark -> restore -> audit -> owner activation.

Blind restore forbidden.

---

## STAGE 15T — Owner Executive Briefing + Alert Priority

AYAS owner’a daemon log spam’i değil material briefing verir.

Include:
- system health
- improvements
- failures/recoveries
- pending owner decisions
- production jobs/cost
- realized revenue/fees/profit
- security findings
- model/tech opportunities
- capacity/blockers

Alert priority:
- CRITICAL: immediate owner notification
- ACTION_REQUIRED: approval queue
- MATERIAL_INFO: next briefing
- ROUTINE: audit log only

Her küçük internal event için owner’ı rahatsız etme.
Underlying evidence always available.

---

# 10. STAGE 16 — REVENUE CENTER — EXACT ORDER

Detailed specs:
`04_STAGE16_REVENUE/`

## 16.0 Platform Adapter Standard
Unified read/local-draft/external-write/financial operation classes.
Production registry initially empty where not connected.
External write owner-gated.
No financial autonomy.

## 16.0A External Account Connection / Credential Boundary
Implement framework now.
REAL account onboarding LATER, after AYAS Foundation closure and owner decides.

Connection metadata only:
platform, opaque account id, scopes, expiry, reauth, health.

Secrets/tokens:
OS/server/connector managed; never memory/ledger/log.
Minimum scope; expiry/scope drift detect.

## 16.1 Zero-Cost / Spend Gate
autonomous/upfront budget = 0.
Unknown/paid/subscription/metered => deny unless exact owner path.
Passive platform fee may be read/economically modeled but is not autonomous spend authority.
Expected profit cannot fund spend.

## 16.2 Unit-Economics Ledger
Immutable/atomic/fsync/lock.
Integer minor units.
Per-currency; no invented FX.
Idempotency/conflict/reversal.
Payout != double-count revenue.
PII-minimized.
Realized money source of truth.

## 16.3 Free-First Validation
Zero-cost/read/local evidence.
Capability, demand, competition, differentiation, economics, rights.
Scenario estimates separate from realized ledger.
Model opinion != market proof.
Unknown fee != zero.

## 16.3A Offer / Product Factory
Platform-independent sellable offer:
- value proposition
- target customer
- deliverables
- capability requirements
- rights
- price scenario
- revision/support
- delivery-time scenario
- portfolio evidence
- platform mapping

Cannot sell if fulfillment capability not proven.

## 16.3B Fulfillment & Delivery Quality Gate
order/job -> requirements -> plan -> produce -> QA -> delivery manifest -> owner/platform handoff -> observed completion -> ledger.

Check:
requirements, rights, quality, file hashes, promises, revisions, deadline, delivery proof.

AYAS cannot sell faster/more than it can deliver.

## 16.4 Etsy
Re-check current official API at implementation.
Official API only.
Read + local listing draft.
No scraping.
No auto create/update/financial without owner path.
Signed/auth/rate/privacy/ledger.

## 16.5 Upwork
Re-check official MCP/API.
Official MCP preferred; explicit API fallback if supported.
Read opportunity/invite/contract state + local proposal draft.
No auto submit, Connects spend, boost, message, offer accept, financial.
No scraping.

## 16.6 Fiverr
Re-check official integration.
If still no suitable general seller API/MCP => MANUAL_HANDOFF.
Local Gig/message/delivery drafts.
No scraping/private APIs.
No automatic publish/message/delivery/payment.

## 16.7 Udemy + Atölye
Re-check Instructor API.
Read/support where officially allowed.
Atölye builds course/lesson/script/media/quiz/exercises/rights/subtitles/quality.
Default OWNER_UPLOAD_READY.
No unsupported auto publish.

## 16.8 Lemon Squeezy
Official API/webhooks.
Test mode first.
Read/local product/checkout preparation.
Signed webhook + dedupe + canonical reread + ledger.
Live mutation owner-controlled.

## 16.9 Reinvestment Policy
Eligibility only, no spend by itself.
Realized ledger only.
Uncertainty => 0.
Default disabled / zero.
No loss chasing/martingale/credit/future revenue/cross-currency assumption.
Owner-reviewed bps/cap.

## 16.10 Revenue Intelligence + Memory
Dedicated privacy-bounded temporal business memory.
Ledger = money truth.
Exclude secrets/bank/card/tax/customer private contact/raw private payload.
Owner decisions > model hypotheses; ledger > estimates.
Advisory only.

## 16.11 Revenue Security / Fraud / Account Safety
Protect:
prompt injection, phishing, off-platform payment, credential request, malicious links/files, webhook forgery, account drift, duplicate write, resource confusion, secrets/PII.
External text DATA only.
Host allowlist/file quarantine/path/MIME/archive safety.
Guard can read/local draft/require owner/block; cannot approve/execute.

## 16.11A Terms / Compliance Boundary
Before real pilot:
- current platform terms/policies
- account standing
- automation restrictions
- tax/legal obligations surfaced

AYAS not tax/legal authority.
Unknown jurisdictional obligation => OWNER/PROFESSIONAL_REVIEW_REQUIRED.

## 16.12 Low-Cost Pilot
Framework first.
One platform, one offer, one primary metric, zero autonomous spend, bounded duration, max external writes per explicit design.
Owner approval before ACTIVE.
Negative evidence retained.
PROMISING != auto-scale.

No real pilot/account action in this implementation unless owner later connects account and explicitly authorizes.

## 16.13 Profit-Gated Scaling
Realized profit only.
Repeated evidence.
Paid scaling requires owner reinvestment policy.
One dimension at a time.
No loss chase/borrowing/future/cross currency.
New platform => new validation/pilot.
Rollback mandatory.

## 16.14 Revenue Center Closure
Authority/cost/privacy/transport/economics/security/pilot/scaling/evidence.
Do not claim live validation when only mocks/read/static exist.

---

# 11. REVENUE ACTIVITY & OWNER REPORTING DASHBOARD — MANDATORY

Use:
`01_CANONICAL_SPECS/AYAS_V3_2_REVENUE_ACTIVITY_DASHBOARD_ADDENDUM.md`

Revenue must never be black box.

Per platform/account show privacy-safe:
- connection state
- what AYAS did
- when
- why
- evidence/rule
- operation class
- spend
- gross revenue
- fees
- refunds
- realized net profit
- owner approval status
- exact next action

Required views:

1. Live Activity
2. Owner Approval Queue
3. Revenue & Cost
4. Historical Audit Timeline

Platform card minimum:
- Pending Opportunities
- Drafts/Pending Actions
- Active Orders/Work
- Today Revenue
- Realized Net Profit
- Owner Approvals Pending

Brain UI natural queries must answer from durable ledger/activity evidence, not guesses:
“Bugün para kazanmak için ne yaptın?”
“Benden hangi onayları bekliyorsun?”
“Bugünkü net gelir/harcama?”
“Upwork teklifini neden uygun buldun?”

Privacy:
no token, bank/card/tax IDs, customer private contact.

Stage16.14 cannot REVIEW_READY until:
- activity/audit records
- approval queue
- ledger reconciliation
- estimates vs realized separation
- historical “why” reconstruction
- Brain UI evidence-based summary
- privacy/security tests

REAL ACCOUNT ONBOARDING IS DEFERRED UNTIL AFTER AYAS FINAL CLOSURE.
Implement framework/test adapters only now.

---

# 12. STAGE 17 — FULL AYAS SYSTEM AUDIT / FOUNDATION CLOSURE

Use:
`05_STAGE17/`

HEAD-bound read-only audit framework.

Audit:
- repo/build/CI
- Graphify
- conversation/intent/context/Turkish
- memory/retrieval/temporal
- model/provider
- voice/mobile
- autonomy/approval/execution
- security/supply chain
- privacy/data governance
- backup/disaster recovery
- runtime/access/autostart
- production/storage/media
- Atölye Director
- cost governor
- research/evolution/watch
- local coding/developer intelligence
- Revenue Center/dashboard
- docs consistency
- Brain UI functional status

Evidence classes:
STATIC_SOURCE
DETERMINISTIC_TEST
LIVE_READ_ONLY
EXTERNAL_OFFICIAL
OWNER_DECISION

States:
PASS
FAIL
BLOCKED
NOT_RUN
STALE
UNKNOWN
NA

Historical evidence != current live proof.
Wrong HEAD => stale.
Missing => NOT_RUN/BLOCKED, never synthetic PASS.

Closure:
BLOCKER = 0
unresolved VERIFIED MAJOR = 0
Graphify current
protected roots unchanged
truthful live/test/static separation.

Audit itself must not mutate live system.

### Additional Stage17 mandatory drills

Periodically and at final closure run controlled disaster/recovery drill:
- backup verify
- restore-verify
- reboot/startup recovery
- durable task resume
- SAFE_READ_ONLY persistence
- portable brain snapshot TEMP import drill

No “backup exists” claim without restore proof.

---

# 13. ∞ CONTINUOUS EVOLUTION

Use:
`06_INFINITY/`

Permanent loop:

OBSERVE
-> MEASURE
-> RESEARCH/WATCH
-> QUALIFY
-> TEMP EXPERIMENT
-> PROPOSAL
-> OWNER APPROVAL
-> EXISTING EXECUTION
-> VERIFY
-> AUDIT
-> LEARN
-> WAIT

No ceiling on improvement quality, but authority remains bounded.

Never:
self-approve, self-install, self-spend, self-publish, self-merge/push, edit owner/security/approval policy autonomously.

Persistent/autostart activation OFF until:
- deterministic
- held-out
- adversarial
- crash/race
- owner-PC dry/read-only tick
- single-instance
- final audit
- explicit owner activation

PC-off catch-up coalesced; no replay storm.
Rejection unchanged => cooldown/terminal.
Benchmark/evaluator rewrite for pass => forbidden.

---

# 14. BRAIN UI V2 — SEPARATE BRANCH

Use:
`07_BRAIN_UI_V2/`

Approved visual reference supplied.

Do NOT use screenshot as page background.
Rebuild real responsive UI around existing functional:
- `/brain`
- BrainCoreConsole
- BrainConsoleView
- BrainCoreOrb
- BrainCore.css
- AyasControlCenter + model/collector

Target:
- top nav
- left real status rail
- central holographic BrainCore
- right existing Command Center
- bottom module dock

Add V3 live tiles:
- Director Session
- Production Stage
- Current Video Cost / Approved Cap
- Production Allowance
- Fault/Recovery
- Revenue
- Continuous Evolution health

No fake percentages.
Unavailable = unavailable/planned.
No new polling.
No new authority.
CSS/SVG/DOM first.
No initial Three.js unless benchmark justifies.
Preserve chat/stream/voice/approval.
Desktop/tablet/mobile + reduced motion + keyboard + contrast.

Separate UI branch.
Do not replace working UI until functional regression + visual validation + owner approval.

---

# 15. FINAL HISTORICAL VIDEO E2E CERTIFICATION

After core implementation, run one full representative 10–15 minute historical project fixture/demo.

Prove:
1. owner topic intake
2. source/fact pack
3. narrative/scene plan
4. real/open media
5. local SVG character/stick-figure scenes
6. local narration
7. music/SFX rights
8. transitions/assembly
9. injected fault mid-production
10. safe recovery/resume
11. cost preflight
12. budget escalation behavior
13. actual cost report
14. quality gate
15. YouTube-ready package
16. no unauthorized publish
17. no unauthorized spend
18. Stage17 mini/full audit
19. protected stores unchanged
20. owner review handoff

Paid calls only within owner-approved project cap.
Do not perform real public publish.

---

# 16. FINAL NO-CLOUD INDEPENDENCE CERTIFICATION

Cloud coding providers disabled.

Representative maintenance tasks must show:
- defect discovery
- plan
- local coding
- sandbox
- tests
- Graphify
- proposal
- owner gate
- execution
- post-verify
- recovery/rollback

If hardware/local model quality cannot pass:
report `LOCAL_INDEPENDENCE_DEGRADED`
with exact gap.
Do not fake READY.
Do not silently call Codex/Claude.

---

# 17. FINAL COMPLETE AYAS SYSTEM TEST — ABSOLUTE LAST STEP

After ALL implementation work, run a complete system-wide validation on ONE current HEAD.

This is separate from normal stage tests.

Validate end-to-end:

- UI/API startup
- AYAS chat
- intent
- Turkish nuance
- context continuity
- memory write/read/supersession
- retrieval
- model routing
- zero-cost behavior
- tool routing
- agent identity/capability lease/action firewall
- owner approval
- developer workflow
- local coding path
- controlled self-evolution
- research/watch
- durable long-horizon recovery
- trace/observability
- security/supply-chain/SBOM/provenance
- backup/restore
- runtime/autostart/remote access
- SAFE_READ_ONLY
- portable brain snapshot drill
- hardware/resource governor
- voice/mobile
- production Director
- cost governor
- fault repair/resume
- historical video production
- YouTube-ready package
- Revenue Center framework
- Revenue Activity Dashboard
- owner briefing
- Continuous Evolution dry-run
- Brain UI functional regression
- Graphify current

Fault injection:
- model off
- network off/timeout
- process kill
- duplicate daemon
- stale Graphify
- needs_update
- corrupt fixture state
- invalid tool schema
- memory poisoning attempt
- budget exceed
- production interruption
- auth expiry fixture
- regression candidate

Final closure only if:
- BLOCKER 0
- unresolved verified MAJOR 0
- all critical regression/golden suites green
- Graphify current
- reboot/recovery green
- backup restore proof green
- historical-video E2E green
- no-cloud result truthfully classified
- no unauthorized writes/spend/publish
- owner review package complete

Then and ONLY THEN:
`AYAS FOUNDATION CLOSED`
`CONTINUOUS EVOLUTION READY_FOR_OWNER_ACTIVATION`

Persistent ∞ activation requires explicit owner action.

After owner activation:
`CONTINUOUS EVOLUTION ACTIVE`

Then:
`PRIMARY DEVELOPMENT FOCUS -> ATÖLYE`

---

# 18. REAL REVENUE ACCOUNT ONBOARDING — NOT PART OF THIS EXECUTION

Do NOT create/connect real Fiverr/Upwork/Etsy/Udemy/Lemon Squeezy accounts in this sprint.

After AYAS final closure, owner will manually:
- create/verify accounts
- identity/KYC
- payout/bank/tax required data
- accept platform terms

Then AYAS connections will be added one-by-one with minimum scopes and staged read-only/test validation.

Planned onboarding order may be revisited from current official facts, but no real account mutation now.

---

# 19. NEW FINDING POLICY

If implementation reveals missing work:

Inside affected scope + safe:
reproduce -> test -> fix -> validate -> document.

Blocks stage + safe:
repair before continue.

Owner/destructive/external:
`BLOCKED_OWNER_ACTION` + exact action/reason.
Continue independent safe work.

Unrelated non-blocking:
`NEW_FINDINGS.md`
Do not derail master sprint.

Do not expand foundation scope with speculative “nice-to-have”.

V3.1 FREEZE RULE:
After 15N–15T, no new foundation feature unless Stage17 BLOCKER/verified MAJOR proves necessity.
New ideas -> Technology Watch -> qualification -> backlog -> Controlled Self-Evolution.

---

# 20. FINAL DELIVERABLES

Maintain:
`docs/ayas-execution/2026-09-27-master/EXECUTION_LEDGER.md`
`ACTIVE_CHECKPOINT.json`
`NEW_FINDINGS.md`

At end:
`FINAL_EXECUTION_REPORT.md`

Final report must contain:
- starting/final branch and SHA
- remote/upstream/ahead-behind
- clean/dirty state
- stage/substage table
- commits
- tests
- Graphify
- defects found/fixed
- blocked owner actions
- live validation level
- owner constitution digest
- local independence status
- production budget policy state
- revenue framework state
- Brain UI state
- Stage17 audit result
- final full-system test result
- exact owner actions remaining

Branch outcome:
- NOT READY
- REVIEW READY
- OWNER VALIDATION REQUIRED

Never auto-merge canonical.

---

# 21. SUCCESS DEFINITION

Success is NOT “lots of code written”.

Success is:
- every canonical task addressed;
- no stage silently skipped;
- existing working behavior preserved;
- verified defects repaired;
- no authority weakening;
- no hidden spend/cloud fallback;
- no unsafe publish;
- Graphify current;
- checkpoints durable;
- final audit truthful;
- full-system validation complete;
- AYAS ready to be owner-activated and then used as long-term assistant/director for Atölye.

FINAL OPERATING SENTENCE:

**Tasarım hazırdır. Yeniden tasarlama; bu paketteki kanonik spesifikasyonları mevcut repository gerçekliğine uygula, çalışan sistemi koru, doğrulanmış hataları regression testleriyle onar, Graphify’ı güncel tut, her yeşil atomik adımda checkpoint bırak, exact sırayı bozmadan ilerle ve yalnız tam sistem final audit + E2E + no-cloud doğrulaması tamamlandıktan sonra owner review’a teslim et.**
