# AYAS Autonomous Technology Watch & Capability Discovery — Stage 14

Status: **STAGE 14 — PR READY / PENDING LOCAL GRAPHIFY VALIDATION AND OWNER-SIDE PROMOTION.** It is not canonically COMPLETED. Stage 14 was built on the isolated cloud branch `cloud/stage14-technology-watch`, which was created from exactly `cb7db6436d9201e56691304e412b5779e803d31a` (the tip of `wip/ayas-graphify-final-execution`). Graphify was unavailable in the cloud, so **LOCAL_GRAPHIFY_REVALIDATION_REQUIRED** (§20).

Stage 14 lets AYAS notice that a technology exists and answer twelve questions about it:

1. What it is.
2. The evidence that it exists.
3. Whether it is current.
4. What capability it would add.
5. What AYAS already has for that capability.
6. Whether it is novel or a duplicate.
7. Whether it is compatible.
8. What it would cost.
9. Its licence, terms and provenance.
10. Its security and supply-chain posture.
11. Which prerequisites are missing.
12. Whether to watch it, research it further, send it to security review, or hand it to Stage 13.

**Discovery is not approval, installation, execution, spend or publication.** Stage 14 cannot install, fetch, execute, subscribe, spend, publish, deploy, enable a plugin, approve anything, bypass the owner or the execution gate, modify policy, or promote anything. Every assessment carries `executionAuthority: "NONE"` and `authority: "NONE"`, and every `may*` flag is `false`: `mayExecute`, `mayInstall`, `maySpend`, `mayPublish`, `mayApprove`, `mayEnable`, `mayDeploy` and `mayModifyPolicy`.

The code is pure: it does no I/O, except that the CLI reads one file.

- `src/lib/ayas/technology/AyasTechnologyCandidate.ts`: the canonical candidate model, normalization of observations, identity and anchors, ingestion into a bounded register, the material fingerprint, and integrity-checked serialization.
- `src/lib/ayas/technology/AyasTechnologyWatch.ts`: the assessment engine (evidence, freshness, capability and gap mapping, compatibility, cost, licensing, security, prerequisites, novelty, readiness) and the watch transitions (surfaced, handed off, dismissed).
- `src/lib/ayas/technology/AyasTechnologyIntegration.ts`: Stage 8 finding extraction, the Stage 13 hand-off, the Stage 10 advisory context, and one bounded watch cycle.
- `scripts/ayas-technology-watch.ts`: a read-only operator CLI over an explicit JSON file.
- `scripts/smoke-ayas-technology-watch.ts`: the deterministic evaluator.

```
npx tsx scripts/ayas-technology-watch.ts --input <watch.json> [--json]
npx tsx scripts/smoke-ayas-technology-watch.ts
```

## 1. Existing architecture reused

| Existing piece | Stage | How Stage 14 uses it | Duplicate avoided |
|---|---|---|---|
| `detectAyasResearchInstructionSignals`, `neutralizeAyasUntrustedText` | 8 | Every external text field is neutralized, bounded and scanned. A directive-shaped text blocks the candidate. | a second injection detector |
| `normalizeAyasResearchUrl`, `resolveAyasResearchSourceRegistry` | 8 | URL canonicalization; registered official roots mark a source `REGISTERED_OFFICIAL` | a source registry |
| `AYAS_RESEARCH_FRESH_DAYS` (30) / `AYAS_RESEARCH_STALE_DAYS` (180) | 8 | Freshness windows | freshness policy |
| `AyasCapabilityTaxonomy` (`isAyasCapabilityCategory`, related paths) | 8 | Capability domains; existing module paths for overlap reporting | domain enum |
| Recorded research findings (`AyasExternalResearchFinding`) | 8 | Input to the extractor (§11); never re-fetched | research engine |
| `evaluateAyasZeroCost` / `AyasCostClass` | policy | Cost class and the zero-cost decision | cost policy |
| `inventoryAyasCapabilities` / `AyasCapability` | 7 | "Does AYAS already use this?" (same technology) | capability registry |
| `normalizeAyasEvolutionOpportunity`, `appendAyasEvolutionOpportunity`, `qualifyAyasEvolutionOpportunity` | 13 | The hand-off target; Stage 13 stays authoritative for readiness, risk, cost and authority | proposal/opportunity system |
| `redactAyasHandoffText`, `AyasContextItem` | 10 | Advisory context lines for a developer task packet | hand-off system |

Stage 14 adds no scheduler, daemon, research engine, proposal, experiment, approval, execution, provider router, memory, capability authority, global queue or store. Only the CLI and the evaluator import `src/lib/ayas/technology/`, and no existing source file changed.

## 2. Candidate model

A candidate is made of three parts:

- **identity**: display name, name slug, category, vendor and anchors;
- **evidence**: a bounded, append-only list of source *claims*;
- **watch**: a bounded record of what the owner has seen.

Readiness, freshness, cost and risk are **not stored**. They are derived at assessment time, so a round trip can never carry a stale or forged verdict.

- **Identity.** Anchors are package coordinates (`NPM:name`, `PYPI:name`, ...), repositories (code host + owner + repo), homepages and version-free name slugs. The slug folds Turkish characters and drops `v1`/`2` segments. The key is `ayas-tech-<sha256(first package ?? repository ?? name)[0..24]>`.
  - The same package or repository merges into one candidate.
  - The same name with a *different* repository is `IDENTITY_CONFLICT_WITH_EXISTING` (possible impersonation), so it is never merged.
  - A conflicting anchor on a strong match is recorded as `IDENTITY_ANCHOR_CONFLICT` and not adopted.
- **Category.** A closed list with **no harmless OTHER**. An unrecognized category is `UNKNOWN`, keeps its slug as `categoryKey`, and needs research.
- **Claims.** There are twelve claim kinds: `EXISTS`, `RELEASE`, `WITHDRAWN`, `CAPABILITY`, `DELIVERY`, `REQUIREMENT`, `PRICING`, `LICENSE`, `PROVENANCE`, `MAINTENANCE`, `SECURITY_ADVISORY` and `COMPROMISE`. Each claim records:
  - its source: URL, class and publication time;
  - its extraction: `DIRECT_SOURCE`, `MODEL_SUMMARY` or `UNDECLARED`;
  - its origin, which the producer sets and never parses from the input: `RESEARCH_FINDING`, `OPERATOR_ENTRY` or `AYAS_SUGGESTION`;
  - a neutralized statement;
  - first and last observation times.
- **Bounds** (`AYAS_TECHNOLOGY_LIMITS`):
  - 400 candidates, and none is ever evicted: the ingest is refused instead;
  - 24 evidence items per observation and 48 per candidate;
  - 4 anchors per kind and 16 watch history entries plus a compacted counter;
  - text fields bounded to 120 or 480 characters, URLs to 400.

## 3. Evidence semantics

- **Source tier.**
  - PRIMARY: official documentation or release notes, source repository, package registry, model card, security advisory database.
  - SECONDARY: research paper, news, technical blog.
  - WEAK: vendor marketing, forum, issue tracker, social media, aggregator, unknown.
- **Epistemic class.** A claim is a `RESEARCH_CLAIM` only when it was read directly from the source and did not come from an AYAS suggestion. Everything else is a `HYPOTHESIS`.
- **Tier eligibility.** Existence, release, capability and delivery may be claimed by a SECONDARY source. Everything that could remove a restriction needs a PRIMARY one.
- **Verification.**
  - `REGISTERED_OFFICIAL`: a registered official root.
  - `IDENTITY_HOST`: the technology's own repository, homepage or package page.
  - `DECLARED`: anything else. An "official" label on a foreign host is only `DECLARED`.
- **Confirmed** means that at least one source is verified, or that at least two independent publishers agree. An independence key is the code-host owner, or else the last two host labels.

### The rule: any source can add a restriction; only adequate, confirmed evidence can answer a question

Every dimension keeps two answers apart:

- its **value**, the most restrictive value any source claims;
- whether it is **established**, meaning a current (≤ 180 days, not future-dated), tier-eligible, confirmed claim settles it.

| Dimension | Value from | Open question (RESEARCH) when not established |
|---|---|---|
| Cost | restrictive prices from any source; free prices only if established | `COST_UNKNOWN` (no counted price) / `COST_UNCORROBORATED` |
| Licence | restrictive or open terms from any source; permissive only if established | `LICENSE_UNKNOWN` / `LICENSE_UNCORROBORATED` |
| Maintenance (local) | abandoned/archived from any source | `MAINTENANCE_UNKNOWN` / `MAINTENANCE_UNCORROBORATED` |
| Provenance (local) | unverified publisher from any source | `PROVENANCE_UNKNOWN` / `PROVENANCE_UNCORROBORATED` |
| Requirements (local must-know, hosted must-know) | present from any claim or any claimed delivery | `<REQ>_UNKNOWN` / `<REQ>_UNCORROBORATED` |
| Delivery | any claimed delivery | `DELIVERY_UNKNOWN` (a claim of `UNKNOWN` never settles it) |
| Freshness | a withdrawal from any source adds `TECHNOLOGY_UNAVAILABLE` (WATCH) | the positive-evidence verdict (`FRESHNESS_UNKNOWN`, `EVIDENCE_STALE`, `EVIDENCE_AGING`, `EXISTENCE_UNCORROBORATED`) is kept |

- A requirement is established only in two ways: through a delivery that is itself confirmed (for example, a confirmed MCP server implies `BROAD_PERMISSIONS`), or through a confirmed claim about that requirement.
- Security advisories, compromises and withdrawals count from any source, and they never expire.
- A stale restrictive claim still counts; a stale permissive claim does not.

## 4. Freshness

The freshness states are:

- `CURRENTLY_VERIFIED`: confirmed adequate positive evidence ≤ 30 days old;
- `RECENTLY_OBSERVED`: seen ≤ 30 days ago, uncorroborated;
- `AGING`: 30–180 days;
- `STALE`: more than 180 days;
- `UNAVAILABLE`: withdrawn after the latest positive evidence;
- `UNKNOWN`: no positive evidence.

Future-dated evidence is never current. It raises `FUTURE_DATED_EVIDENCE`.

Each release is labelled `LATEST`, `SUPERSEDED`, `WITHDRAWN`, `UNVERIFIED` or `UNORDERED`:

- Only an eligible source sets the latest version.
- Only a verified, current release (`verifiedLatestVersion`) can retire an advisory.
- Version comparison is semver-aware and refuses to guess (`null`).

## 5. Novelty

- **Duplicates.** One technology seen from several sources is one candidate. Two records of one technology in a register (anchor union-find) report the later one as `DUPLICATE_OF_CANONICAL`. A shared source between different technologies is *overlap*, not duplication.
- **Material fingerprint.** A time-independent SHA-256 over the facts:
  - the latest major version;
  - capability domains and keys;
  - deliveries and requirement states;
  - pricing, licence, provenance and maintenance;
  - advisories, compromises and withdrawals.

  Restrictive facts count from any source; permissive facts only from an eligible one. A new URL, a re-observation, a patch or minor release, or an older release seen later changes nothing.
- **Watch suppression is about attention, never authority:**
  - `ALREADY_HANDED_OFF` and `DISMISSED_BY_OWNER` hold for the same fingerprint;
  - `COOLDOWN_ACTIVE` lasts 30 days after surfacing;
  - `SURFACE_LIMIT_REACHED` applies after 6 surfacings;
  - `REOPEN_LIMIT_REACHED` applies after 8 reopenings on material change.

## 6. Capability gap mapping

- Claimed domains come from any claim, including future-dated ones. Corroborated domains need current, adequate, confirmed claims.
- Coverage comes only from the operator's local facts (`domainCoverage`: PRESENT/PARTIAL/ABSENT/UNKNOWN). Stage 8's own gap verdict is ignored.
- The relation is one of:
  - `SAME_TECHNOLOGY`: installed package or Stage 7 inventory match. Outcome: WATCH.
  - `UNMAPPED`: no domain. Outcome: RESEARCH.
  - `UNKNOWN`: any unknown coverage or unknown domain key. Outcome: RESEARCH. **Unknown stays unknown; it is never counted as a gap.**
  - `GENUINE_GAP`: some domain ABSENT.
  - `COMPLEMENTARY`: some domain PARTIAL.
  - `OVERLAP_ONLY`: every domain PRESENT. Outcome: WATCH, and replacement is not recommended automatically.
- Existing equivalents are listed as `package:`, `inventory:`, `domain:` and `module:` references.

## 7. Compatibility and prerequisites

- **Deliveries.**
  - What a delivery implies holds whatever a source says:
    - hosted API: network access and sending data externally;
    - package, weights or skill: code execution;
    - host binary: native binary;
    - container: container runtime;
    - MCP server or extension: broad permissions.
  - A local delivery, an unknown delivery or `EXECUTES_CODE` makes the technology *locally executed*. Its security-sensitive requirements, native binary and network facts, provenance, maintenance and package identity must then be known.
  - A hosted delivery requires the secret/API-key and external-account facts.
- **Prerequisites.** Present requirements resolve only against the environment's stated facts (`hostBinaries`, `externalAccounts`) as SATISFIED, MISSING or UNKNOWN.
  - GPU, Python/Node runtime, container runtime and native toolchain become `HOST_BINARY` prerequisites.
  - An account or key becomes an `EXTERNAL_ACCOUNT` prerequisite.
  - A hosted service adds an `EXTERNAL_SERVICE` prerequisite.
  - Nothing is probed or installed.

## 8. Cost

- **UNKNOWN is not FREE, and FREE TIER is not ZERO.**
  - Pricing models map to the zero-cost policy's cost classes. `FREE_TIER` maps to `metered-free-tier`.
  - A spend requirement (card, credits, paid plan, listing fee, connects, ads, trial expiry) turns any "free" price into metered.
- A local-only free price claimed for a hosted delivery is `unknown-cost` (`COST_DELIVERY_MISMATCH`).
- Conflicting free and paid claims raise `COST_CLAIMS_CONFLICT`.
- A price the technology is known to have is not a blocker. Stage 13 requires `PAID_PROVIDER_APPROVAL` for anything the zero-cost policy does not allow.

## 9. Licensing, terms and provenance

- Unknown, unspecified-open-source, source-available, non-commercial and conflicting terms need research. Proprietary and copyleft terms are marked `TERMS_REVIEW`.
- Provenance is:
  - `VERIFIED_PUBLISHER` from a confirmed adequate claim, or from a registered official source;
  - `UNVERIFIED_PUBLISHER` from any source, which requires SECURITY_REVIEW.
- An aggregator cannot vouch for provenance.

## 10. Security and supply chain

- A compromise that affects the latest release, or whose version is unknown, is BLOCKED (`KNOWN_COMPROMISED`). A past compromise needs security review.
- An advisory affects the latest release unless a verified, current release at or after its fix exists. A malformed fix version never retires an advisory.
- Elevated privilege, install scripts and broad permissions require security review, and so does an unverified publisher.
- Abandoned or archived projects are watched.
- Security evidence that cannot be read raises `SECURITY_EVIDENCE_UNREADABLE`, which blocks and is reported in `security.concerns`. That covers a malformed item, a misspelled kind, truncation, and the capacity limit.
- Credentials in a URL, non-http(s) URLs and bad hosts are refused.
- Directive-shaped content anywhere, in any language, blocks (`UNTRUSTED_INSTRUCTION_CONTENT`).

## 11. Readiness

The readiness levels, from least to most ready, are `BLOCKED` < `RESEARCH_REQUIRED` < `WATCH` < `SECURITY_REVIEW_REQUIRED` < `HANDOFF_ELIGIBLE`:

- `BLOCKED`: corruption;
- `RESEARCH_REQUIRED`: uncertainty;
- `WATCH`: known, but not actionable;
- `SECURITY_REVIEW_REQUIRED`: known security concern.

The readiness is the lowest level among all blockers. Suppression (duplicate, cooldown) is separate: it sets the *recommendation* and `next` without changing readiness.

`handoffEligible` requires `HANDOFF_ELIGIBLE` and no suppression. **Adding uncertainty or corruption can never make a candidate more ready**, and the evaluator checks this exhaustively (V09, A01, A02, A10). Every assessment answers the twelve questions explicitly (P02).

## 12. Stage 8 integration: research → provenance → extraction → candidate

`extractAyasTechnologyObservationFromFinding` takes one recorded Stage 8 finding. It does not extract a finding without:

- a valid finding id;
- the explicit `treatedSourceAsUntrusted` acknowledgement;
- valid times;
- an http(s) source without credentials;
- a valid identity.

Each refusal has a reason code, and nothing throws.

- Only the fetch itself (`EXISTS`) is a direct claim. Stage 8's capability, price and licence readings are `MODEL_SUMMARY` hypotheses, so a "paid" verdict restricts, but a "free" one never resolves cost.
- Identity anchors come from the source only when it is official.

`runAyasTechnologyWatchCycle` is one bounded pass (`limit` 0..200, default 20):

1. extract;
2. ingest;
3. assess;
4. build the hand-off inputs.

It **submits nothing and writes nothing**. It returns the new register, the refusals and the would-be hand-offs, and it is idempotent.

## 13. Stage 13 hand-off

`buildAyasTechnologyEvolutionHandoff` builds an ordinary Stage 13 producer input only if all of these hold:

- the assessment was produced by this engine (checked against a WeakSet);
- it is `handoffEligible`;
- the material fingerprint is current;
- the candidate carries no issues or signals;
- the relation is `GENUINE_GAP` (kind `NEW_CAPABILITY`) or `COMPLEMENTARY` (kind `EXTENSION`).

The input is built as follows:

- **Origin.** It is hardcoded to `RESEARCH_LOOP`, and the evidence is research, so Stage 13 classifies it as a research claim and returns `RESEARCH_REQUIRED` until local corroboration exists.
- **Evidence.** Security evidence comes first, up to 24 items. If the security evidence alone exceeds 24, no hand-off is built.
- **Capability class and target.**
  - The delivery maps to a Stage 13 capability class. More than one class maps to `UNKNOWN`, never OTHER.
  - Side effects and resources are derived from requirements and cost.
  - The target key is `tech.<slug>-<key6>`, the domain is `technology.<category>`, and compatibility is `UNKNOWN`.
- **Omitted fields.** It never supplies a lifecycle, id, issue, signal, approval, evidence class or authority field.

`submitAyasTechnologyHandoff` works as follows:

1. It checks:
   - the closed field set;
   - that the input digest matches;
   - that the origin is `RESEARCH_LOOP`;
   - that the authority fields are `NONE`;
   - the Stage 13 register shape.
2. It re-normalizes through Stage 13, appends only if the opportunity is absent (so it is idempotent), and qualifies.
3. Stage 13 then decides readiness, risk, cost and required authority.

`recordAyasTechnologyHandoff` is gated. It requires a produced, current, eligible, unsuppressed assessment and a Stage 13 opportunity id.

## 14. Stage 10 advisory context

`buildAyasTechnologyDeveloperContext` returns one redacted `investigation` context item, for example: "Technology watch <key> (advisory; not installed): …". It returns nothing for a BLOCKED candidate. It carries no install, dispatch or approval.

## 15. Authority

- There is no new authority system, and no second owner-approval or execution gate.
- The runtime import closure of the three modules is 17 files. The only externals are `node:crypto`, `node:fs` and `node:path`: `node:fs` comes from the Stage 8 `AyasDeepAnalysis`/`AyasResearchNoveltyStore` modules. It is used only inside their other functions and never at module load. The two functions Stage 14 calls from them, `neutralizeAyasUntrustedText` and `normalizeAyasResearchUrl`, are pure.
  - The three Stage 14 modules import no `fs`, process, network or environment API.
  - The closure contains no approval, gate, mutation, publication, pipeline, production or daemon module.
  - Approval and daemon types appear only as `import type`.
- Watch transitions record attention (surfaced, handed off, dismissed) and grant nothing.

## 16. Persistence and serialization

- **No new store** (decision: reuse). The register is an immutable value, and the caller owns where it lives. The CLI prints it; nothing writes it. When a producer is wired, the register can live wherever the owner decides.
- `serializeAyasTechnologyRegister` → `{ schemaVersion, candidates, integrity: { algorithm: "sha256", digest } }`.
- `parseAyasTechnologyRegister` is strict:
  - It checks the digest first.
  - Every field must be present with its exact shape. An unknown field or a sparse array is refused.
  - Re-derived issues must be a subset of the carried issues. Unknown carried codes become `ISSUE_UNRECOGNIZED`/`SIGNAL_UNRECOGNIZED`, which block.
  - Any other violation is refused with `AyasTechnologyError`.
- **The round trip never reduces safety.** A serialize → parse → assess cycle is a fixed point (R01–R08 and the fuzz).
- The digest is a **content digest, not authentication**. Anyone who can write the file can re-sign an edit. Keyed tamper evidence is DEFERRED (§21).

## 17. Malformed input: PRESENT + MALFORMED is never ABSENT

- An absent field takes its documented default.
- A present value of the wrong shape, outside its closed vocabulary, or in a sparse array is a BLOCKING issue or a refusal. An unknown field is `UNKNOWN_FIELD`.
- A malformed restrictive claim keeps its most restrictive value rather than being dropped:
  - pricing becomes `PAID`;
  - licence becomes `NON_COMMERCIAL`;
  - provenance becomes `UNVERIFIED_PUBLISHER`;
  - maintenance becomes `ARCHIVED`;
  - a requirement becomes present;
  - an advisory's severity becomes `UNKNOWN`;
  - a version becomes `null`.
- Environment facts, the register boundary, the Stage 13 submission and the CLI all fail closed.

## 18. Invocation path

- The existing path is `scripts/ayas-discovery-daemon.ts` → `tickAyasResearchScheduler` → `createAyasExternalResearchStore().list()` → `runAyasResearchImprovementCycle`.
- `runAyasTechnologyWatchCycle` is a pure integration boundary over those same recorded findings. Stage 14 deliberately does **not** wire it into the daemon: that would need a persisted register, which is an owner decision (§21).
- Today the watch runs only on explicit operator input, through `scripts/ayas-technology-watch.ts --input <file.json>`. It reads that one file and prints:
  - the assessments;
  - the Stage 13 inputs it *would* build;
  - the refused findings;
  - the updated register.

  It writes, fetches, submits, installs and dispatches nothing, and exits 2 on malformed input.

## 19. Evaluation

The evaluator was written before the production code, and it is deterministic, offline and TEMP-only. It covers:

| Group | Scenarios | What it checks |
|---|---|---|
| primary | 55 | technology classes, the twelve questions, integration, authority boundary |
| held-out | 12 | written before implementation, frozen, never tuned; SHA-256 `9aa208c8b03cab2e81eca36a1ed9934bd751707b3ae69f7d6d668b9b228bd7eb` (11,382 bytes) |
| matrix | 3 (508 cases: 187 fresh, 257 persisted, 64 vocabulary) | PRESENT + MALFORMED is never ABSENT |
| roundTrip | 8 | serialize → parse never reduces safety |
| adversarial | 10 (incl. a 400-record seeded fuzz) | combinations, spoofing, typosquats, truncation, reordering |
| review | 10 | regressions added after implementation; each fails on the fault it pins |

- **Clean-base differential.** The same final evaluator (SHA-256 `af909f7d20340f7c13da5f3e465cae04668a062aa796bc78f6a35c6fcd0e5d4c`) reports all 98 scenarios `MISSING` on a clean `cb7db64` archive, and 98/98 `PASS` on this branch.
- **Frozen scenarios.** Every pre-review group is byte-identical to the version frozen before implementation, except the header comment and `TOTALS`.
- **Mutation testing.** 16 targeted mutations, and every one is caught. Examples:
  - a malformed price read as free;
  - carried issues dropped on load;
  - an unknown category folded into a known one;
  - vendor marketing treated as primary;
  - free tier treated as zero cost;
  - the digest not checked;
  - stale evidence read as current;
  - an owner origin forged;
  - silent truncation;
  - a handed-off technology resurfacing;
  - the directive scan skipped;
  - unknown coverage read as a gap;
  - a weak price settling cost;
  - an `UNKNOWN` delivery settling delivery;
  - a withdrawal hiding freshness questions;
  - a present requirement counted as established.
- **Out-of-repo adversarial harness.** It found 0 violations:
  - 10,000 fresh corruptions;
  - 8,000 re-signed persisted edits: 0 readiness increases; the only attention changes are cooldowns lifted by a material change, which is reopen-on-change by design;
  - 462,848 monotone uncertainty pairs;
  - 63 suppression-bypass attempts.

## 20. Review

- **Pass 1: five MINOR findings, all fixed.** Each is pinned by V02–V05.
  - Dropped security claims were invisible in the answers.
  - The capacity drop order was wrong.
  - The hand-off `createdAt` was unstable.
  - Future-dated capability claims were excluded from what is claimed.
  - A malformed Stage 13 register crashed submission.
- **Pass 2: three MAJOR findings, all fixed.**
  - Sparse arrays were accepted at the parse and environment boundaries (V06).
  - A weak restrictive claim resolved an open question, which made a candidate more ready: for example, a forum "paid" claim cleared `COST_UNKNOWN` (V07–V09).
  - A confirmed source that said the delivery was `UNKNOWN` settled the delivery (V10).
- **Totals:** BLOCKER 0, unresolved MAJOR 0.

### Graphify: cloud vs local

- **CLOUD_GRAPHIFY_UNAVAILABLE.** The cloud has no Graphify CLI and no `.graphify/`. Nothing was installed or bootstrapped, and no Graphify result is claimed.
- To compensate, the review used:
  - static import-closure analysis (§15);
  - importer search (only the CLI and the evaluator import the module);
  - two manual review passes;
  - the evaluator, held-out scenarios, mutation testing, the adversarial harness and the regressions.
- **LOCAL_GRAPHIFY_REVALIDATION_REQUIRED** before promotion. Run `graphify update --scope all --no-description --no-label .`, the freshness status, and `graphify review-analysis --files <the 5 files>`.

## 21. Limitations and deferred items

- **Keyed tamper evidence (DEFERRED).** The register digest detects accidental corruption, not a deliberate re-signed edit. That needs a keyed MAC and a key-custody decision.
- **Daemon wiring and a persisted register (DEFERRED, owner decision).** The cycle exists but is not scheduled.
- **An owner unblock path for permanently blocked candidates (DEFERRED).** Examples are a directive quoted in legitimate documentation, or a compromise report that later proves false. For now, a new candidate record is needed.
- **The reopen limit can suppress a new advisory's resurfacing (DEFERRED).** The advisory still shows in the assessment; only attention is limited.
- **A Stage 8-only path cannot reach hand-off.** Its readings are model summaries, so this is by design: local or primary corroboration is needed.
- **Source independence is approximated** by code-host owner or registrable domain.
- **Pre-existing:**
  - Stage 13 uses `every` on lists that could be sparse;
  - Stage 10 has its `heldout-closure-written` held-out miss;
  - `GRAPH_PARTIAL` covers the `.ps1` files and the thumbnails route;
  - the autonomous-execution-gate smoke needs the Graphify module and fails identically on the clean base in the cloud;
  - the Stage 10 static test-safety classifier rates this evaluator `REQUIRES_TEMP_ROOT` only because it imports a `/brain/` module, a read-only registry constant. This is the known over-flag already listed as a Stage 11 follow-up; the evaluator is TEMP-only.
