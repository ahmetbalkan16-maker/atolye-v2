# Stage 15P — Source Trust and Evidence Graph

Opened 2026-10-02 after Stage 15O source `d08fed060c0dff8601cf968715f2b2469f328d4a`. Authority: final execution order STAGE 15P; final freeze addendum 15P. Post-freeze addendum 0 and 9 apply; no separate Stage 15P section. No new roadmap or store.

## 15P.0 — existing seams and packet plan

- `AyasExternalResearchStore` already stores source URL, official-source declaration, last check, feature date, model confidence and license/cost status; it redacts summaries and acknowledges external text as untrusted. Existing records must stay readable.
- `AyasTechnologyCandidate.describeAyasTechnologySource` already normalizes URLs, refuses embedded credentials and derives conservative publisher independence. `AyasTechnologyWatch.verifyAyasTechnologySource` already verifies registered roots; preserve this behavior and share it without introducing a store/import cycle.
- `AyasDeepResearchEngine` chooses source identity from the host registry, while the model only emits a closed analysis schema. New derived evidence must not come from a model-supplied policy, trust score or approval field.
- `HistoricalFactPack` has explicit source/claim/scene links; the golden fixtures remain unchanged. Technology watch already has code-specific evidence constraints; its passing behavior stays intact.

Implement one bounded, sealed source/claim/evidence graph and four contextual policies (historical claims, code adoption, security guidance, platform terms). A source's reputation cannot transfer between uses. Missing, stale, future, unverified, model-only, unlicensed or conflicting evidence never becomes supported use. Trust inputs are separate from external graph text; every result remains DATA / authority NONE, with no permission to execute, adopt, approve, spend or publish.

Attach derived metadata to every newly recorded external research finding through the existing atomic store; ignore injected trust/policy fields. Legacy records remain readable and their absent graph is explicitly UNMEASURED when queried. Recompute trust at the caller's current time; never accept a persisted score as current truth. Add a read-only offline operator, meaningful scenario and adversarial suites, an eval manifest revision and focused/full regression evidence. No fetch, model, runtime activation or owner-only gate is required for this source packet.
