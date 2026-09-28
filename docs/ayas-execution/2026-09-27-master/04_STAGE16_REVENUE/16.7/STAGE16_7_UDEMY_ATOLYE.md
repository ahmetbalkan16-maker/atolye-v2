# Stage 16.7 — Udemy + Atölye Course Production Integration

## Verified current platform reality

Udemy Instructor API v1 is available to instructors and supports:
- taught courses read
- course reviews read
- course Q&A read/reply
- message threads read/reply

It is in maintenance mode and is not a general course-authoring/publishing API.

Therefore the safe architecture is:
`Atölye builds course assets -> owner reviews -> Udemy publish/upload remains owner-controlled -> AYAS may use official Instructor API for read/support workflows where appropriate`.

## Goal

Turn Atölye into a governed course-production engine while keeping Udemy account publication and monetization owner-controlled.

## Proposed files

- `src/lib/ayas/revenue/adapters/udemy/AyasUdemyAdapter.ts`
- `src/lib/ayas/revenue/adapters/udemy/AyasUdemyCourseReadModel.ts`
- `src/lib/ayas/revenue/adapters/udemy/AyasUdemySupportWorkflow.ts`
- `src/lib/ayas/revenue/content/AyasCourseProductionPlan.ts`
- `src/lib/ayas/revenue/content/AyasCourseAssetManifest.ts`
- `scripts/smoke-ayas-revenue-udemy-adapter.ts`
- `scripts/smoke-ayas-course-production-plan.ts`
- `docs/AYAS_REVENUE_UDEMY_ATOLYE.md`

## Transport

Official Udemy Instructor API v1 only for supported API operations.
No private/internal APIs.
No browser automation or scraping fallback.

Auth token remains server/connector managed and never enters AYAS memory, ledger, logs or artifacts.

## Read/support operations

Supported:
- `ACCOUNT_STATUS_READ`
- `LISTING_LIST_READ` mapped to taught courses
- `ANALYTICS_READ` limited to official fields/reviews/Q&A facts
- Q&A read
- Q&A reply draft
- message read
- message reply draft

External reply submission remains owner-required in this stage even if the API supports POST.

## Course production

Atölye owns the production pipeline, not Udemy.

Course plan:
- course title
- target learner
- prerequisites
- learning outcomes
- section order
- lesson order
- lesson duration target
- narration/script
- visual plan
- real/generated media policy
- quiz/exercise plan
- downloadable assets
- rights/licensing evidence
- accessibility/subtitles
- quality checklist

Every plan is immutable/versioned and linked to source evidence.

## Asset manifest

Per lesson:
- lesson id
- source script digest
- video asset digest/path reference
- audio digest/path reference
- subtitle/caption reference
- downloadable resource references
- source/right/license evidence
- production status
- validation status

No raw credentials or Udemy IDs used as filesystem paths.

## Publication readiness

Course can reach:
- `DRAFT`
- `CONTENT_READY`
- `MEDIA_READY`
- `QUALITY_REVIEW_REQUIRED`
- `OWNER_UPLOAD_READY`
- `OWNER_PUBLISHED_CONFIRMED`

AYAS cannot set `OWNER_PUBLISHED_CONFIRMED` without owner-entered or official read-back evidence.

No `AUTO_PUBLISHED` state exists.

## Instructor API policy

Reads can be owner-triggered or scheduled only after connection policy is approved.

Writes supported by the Instructor API (Q&A/message replies) are classified:
- EXTERNAL_WRITE
- owner approval required
- no autonomous sending

Course publishing is not exposed through this adapter.

## Privacy

Do not persist raw learner names/emails/message bodies beyond what is strictly necessary for a current owner-facing support draft.
Prefer ephemeral read -> local redacted draft -> discard.

Long-term revenue memory may retain only:
- course digest/id
- review aggregates
- rating aggregate
- question topic codes
- revenue/economic facts from separate official evidence

## Rate limiting

Udemy currently documents 100 requests per 10 seconds globally for Instructor API.
Implementation must not hardcode that as an eternal constant:
- parse current behavior/config;
- use conservative client limiter below documented max;
- 429 => back off;
- 503 => stop and surface maintenance;
- bounded pagination (API max page size currently 100).

## Revenue integration

Stage 16.2 ledger can receive:
- observed course gross revenue only if official/owner import provides it;
- fees/refunds only with explicit evidence.

Instructor API course/review data alone does not imply revenue.

## Quality checks

Before OWNER_UPLOAD_READY:
- no missing lesson asset
- no unresolved licensing issue
- no duplicate lesson
- no broken chronology/order
- audio intelligibility pass
- caption/subtitle coverage
- target learning outcomes mapped to lessons
- no unsupported medical/legal/financial claims
- platform policy checklist reviewed

## Evaluator

>= 50 primary + 12 held-out:
- taught course read
- pagination
- 429/503 handling
- token absent
- review normalization
- Q&A read
- message read
- local reply draft
- external reply send blocked
- internal/private API rejected
- course plan validation
- asset manifest validation
- missing asset prevents readiness
- rights uncertainty blocks readiness
- publish state cannot be inferred
- owner confirmation required
- PII not persisted
- API message content redaction
- no browser fallback
- no revenue inference from rating/reviews
- course asset path traversal blocked
- duplicate lesson ids refused
- malformed lesson order refused

## Completion

- official Instructor API adapter read/support path;
- Atölye course-production plan + asset manifest;
- no automated course publication;
- no autonomous Q&A/message send;
- owner upload/publish confirmation explicit;
- Graphify/TS/lint/security/media regressions/review green.
