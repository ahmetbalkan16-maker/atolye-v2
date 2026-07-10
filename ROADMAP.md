---
Document: ROADMAP.md
Version: 1.0.0
Status: Active
Priority: High
Owner: Atölye V2
Last Updated: 2026-07-10
---

# Atölye V2 — Development Roadmap

## Amaç

Bu belge önümüzdeki sprintlerde yapılacak teknik geliştirmeleri içerir.

Bu belge yaşayan bir dokümandır.

Sprint tamamlandıkça güncellenmelidir.

Nihai urun vizyonu icin:

VISION.md

referans alinmalidir.

Uzun vadeli fazlar icin:

ATOLYE_MASTER_ROADMAP.md

referans alınmalıdır.

---

# Mevcut Durum

Aktif Faz

Phase 2 — Production Engine

Aktif Sprint

Sprint 84

---

# Sprint 41

## Animation Scene-Level Regeneration

Durum

Completed

### Görevler

- Scene bazlı animation regenerate
- animation.json merge
- Asset versioning koruma
- Animation active version seçimi
- UI regenerate butonu

---

# Sprint 42

## Video Engine Foundation

Completed

- Video Provider
- Video Service
- Video Pipeline
- Video API
- Video Types

---

# Sprint 43

## Audio Engine Foundation

Completed

- Audio Provider
- Audio Service
- Audio Pipeline
- Audio API
- Audio Asset

---

# Sprint 44

## Assembly Engine Foundation

Completed

- Final production package
- Video/audio/animation asset references
- Render plan
- Assembly API
- Assembly UI action

---

# Sprint 45

## Thumbnail Engine Foundation

Planlanan

- Thumbnail type model
- Thumbnail provider
- Thumbnail service
- Thumbnail API
- Thumbnail UI action

---

# Sprint 46

## SEO Engine Foundation

Planlanan

- SEO type model
- SEO provider
- SEO service
- SEO API
- SEO UI action

---

# Sprint 47

## Export Engine Foundation

Planlanan

- Export package model
- Export provider
- Export service
- Export API
- Export UI action

---

# Sprint 48

## Final Pipeline Integration

Completed

- Research → Export tam akış kontrolü
- PipelineRunner uçtan uca orchestrator
- Manifest/progress senkronizasyonu
- Stage bazlı hata yönetimi

---

# Sprint 49

## Real AI Provider Integration Guardrails

Completed

- Real provider adapters
- Provider configuration
- Error handling
- Cost and usage safeguards

---

# Sprint 50

## AI Reliability & Observability Foundation

Completed

- Append-only ai-usage.json
- AI provider usage metadata
- Fallback/error observability
- Pipeline AI context propagation

---

# Sprint 51

## Usage Viewer / AI Diagnostics Panel

Completed

- ai-usage.json viewer
- Read-only AI diagnostics panel
- Project workspace usage records view
- API endpoint for project AI usage

---

# Sprint 52

## AI Usage Diagnostics Summary

Completed

- Total AI calls summary
- Success/fallback/failed counts
- Average duration and last call time
- Provider distribution summary

---

# Sprint 53

## AI Usage Filters & Diagnostics Search

Completed

- Stage/provider/status filters
- Filtered usage records table
- Summary metrics aligned with active filters
- Basic diagnostics search

---

# Sprint 54

## Pipeline Retry & Resume Planning Foundation

Completed

- Retry/resume requirements analysis
- Manifest-aware continuation plan
- Minimum safe pipeline recovery architecture
- Stage dependency readiness checks

---

# Sprint 55

## Pipeline Resume Execution Foundation

Completed

- Internal PipelineRunner.resume(projectSlug)
- Blocked recovery plan handling
- Completed stage skip behavior
- Existing project stage input loading

---

# Sprint 56

## Pipeline Resume API Foundation

Completed

- Project-scoped POST /api/projects/[slug]/pipeline/resume endpoint
- Slug validation and project existence check
- Blocked resume plan response with HTTP 409
- Resume execution result response without UI or retry endpoint

---

# Sprint 57

## Pipeline Resume Studio Action

Completed

- Project workspace resume action
- Loading, success, blocked and error states
- No retry execution

---

# Sprint 58

## Pipeline Retry Foundation

Completed

- Retry foundation scope
- Stage dependency readiness for retry
- No UI action until safe API contract is ready

---

# Sprint 59

## Pipeline Retry API Foundation

Completed

- Project-scoped retry endpoint
- Failed stage retry request validation
- No UI action until API behavior is verified

---

# Sprint 60

## Pipeline Retry Studio Action

Completed

- PipelineStatus failed stage'lerde Retry butonu gosterir hale getirildi.
- Retry request POST /api/projects/[slug]/pipeline/retry endpoint'ine stage key ile gonderilir hale getirildi.
- Retry sirasinda per-stage loading state "Retrying..." olarak gosterilir hale getirildi.
- Retry basarili olunca router.refresh() ile pipeline gorunumu yenilenir hale getirildi.
- Hata durumunda kullaniciya basit error mesaji gosterilir hale getirildi.
- npx tsc --noEmit temiz gecti.
- npm run typecheck script'i yok.
- npm run lint existing unrelated lint issues nedeniyle bu sprint degisikliginden bagimsiz hatalara takiliyor.

---

# Sprint 61

## Pipeline Recovery UX Hardening

Completed

- PipelineStatus stage kartlari expandable hale getirildi.
- Stage details panelinde stage name, status, startedAt, completedAt, duration, failed error ve usage metadata gosterilir hale getirildi.
- Optional stage detail alanlari veri yoksa gizlenir hale getirildi.
- Retry button expand davranisiyla cakismayacak sekilde ayrildi.
- Invalid date fallback eklendi.
- Retry/running sirasinda eski completedAt ve durationMs tasinmaz hale getirildi.
- Manifest/progress tipleri optional timing ve usage metadata ile genisletildi.
- npx tsc --noEmit temiz gecti.

---

# Sprint 62

## Pipeline Recovery Diagnostics Polish

Completed

- Pipeline diagnostics details UI polish tamamlandi.
- Status badge/label gorunumu iyilestirildi.
- startedAt / completedAt daha kullanici dostu formatlandi.
- durationMs okunabilir hale getirildi.
- Error mesaji ayri, scroll guvenli blokta gosterilir hale getirildi.
- Usage metadata kompakt kutucuklarla gosterilir hale getirildi.
- Retry button ve expand davranisi korundu.
- npx tsc --noEmit temiz gecti.

---

# Sprint 63

## Pipeline Recovery Diagnostics Data Wiring

Completed

- Stage metadata standardi attempts, lastAttemptAt ve lastRunType alanlariyla gelistirildi.
- Provider bagimsiz usage mapping ai-usage kayitlarindan manifest stage usage alanina baglandi.
- Retry metadata initial/resume/retry run type ayrimi ve retry attempt sayisi ile genisletildi.
- ProjectManager ve projectProgress akisi optional metadata alanlarini tasiyacak sekilde guncellendi.
- PipelineStatus stage details icinde attempt bilgisi optional olarak gosterilir hale getirildi.
- npx tsc --noEmit temiz gecti.

---
# Sprint 64

## Pipeline Queue / Job Management Foundation

Completed

- Pipeline Queue / Job Management temeli eklendi.
- PipelineJob domain modeli olusturuldu.
- PipelineJobManager eklendi.
- Proje bazli pipeline-jobs.json storage eklendi.
- GET /api/projects/[slug]/pipeline/jobs endpointi eklendi.
- POST /api/projects/[slug]/pipeline/jobs/[jobId] endpointi eklendi.
- cancel / retry job aksiyonlari eklendi.
- Studio tarafina PipelineJobsPanel eklendi.
- Proje sayfasina PipelineJobsPanel baglandi.
- Mevcut PipelineStatus ve diagnostics yapisina dokunulmadi.
- npx tsc --noEmit temiz gecti.

---
# Sprint 65

## Pipeline Queue Execution Wiring

Completed

- Pipeline Queue Execution Wiring tamamlandi.
- PipelineJobManager lifecycle helper'lari eklendi: markStageRunning, markStageCompleted, markStageFailed.
- PipelineRunner stage lifecycle ile job lifecycle senkronize edildi.
- Stage baslarken job running olur hale getirildi.
- Stage basariyla tamamlaninca job completed olur hale getirildi.
- Stage hata alinca job failed olur ve error bilgisi kaydedilir hale getirildi.
- PipelineStatus, diagnostics ve retry davranisi korundu.
- attempts sayaci yalnizca retry sirasinda artar hale getirildi.
- npx tsc --noEmit temiz gecti.

---
# Sprint 66

## Pipeline Queue Scheduler

Completed

- Pipeline Queue Scheduler eklendi.
- PipelineQueueScheduler ilk calistirilabilir stage'i seciyor.
- Ayni anda birden fazla running stage engelleniyor.
- completed stage'ler otomatik atlaniyor.
- failed ve cancelled stage'ler otomatik calistirilmiyor.
- PipelineRunner initial ve resume akislari scheduler uzerinden ilerliyor.
- Scheduler manifest ve job durumlarini guvenli sekilde degerlendiriyor.
- Stage bilgisi eksik oldugunda crash olusmuyor.
- npx tsc --noEmit temiz gecti.

---
# Sprint 67

## Pipeline Queue UI Controls Hardening

Completed

- Pipeline Queue / Jobs panelinde loading, success, error, disabled, invalid-data ve unsupported-state feedback netlestirildi.
- Job action duplicate submission engeli eklendi.
- Client tarafinda invalid slug, job ID, payload ve unsupported action guard'lari eklendi.
- API unsupported job state transition icin HTTP 409 doner hale getirildi.
- Mevcut response contract korundu: { success, error?, jobs? }.
- Malformed stored job kayitlari tek tek filtrelenir hale getirildi; valid queue state korunur.
- npx tsc --noEmit temiz gecti.
- Manuel browser/UI testi yapilmadi.
- Existing unrelated lint issues ve dependency advisories bu sprint kapsami disinda birakildi.

---
# Sprint 68

## Existing Lint Issues Cleanup Planning

Completed

- npm run lint mevcut durumda 7 errors ve 12 warnings ile fail ediyor.
- Toplam belirlenen lint issue sayisi: 19.
- React hook/effect state management: 4 errors, 1 warning.
- JSX unescaped entities: 3 errors.
- Unused vars/imports: 10 warnings.
- Next image optimization: 1 warning.
- Issue'lar Sprint 67 degisikliklerinden bagimsizdir.
- AssetGallery.tsx ve hook cleanup daha yuksek riskli alanlar olarak kaydedildi.
- Lint mevcut haliyle CI/pre-commit workflow'larini bloke edebilir.
- Onerilen cleanup sirasi: JSX unescaped entities, unused vars/imports, React hook cleanup, Next image optimization.

---
# Sprint 69

## JSX Unescaped Entities Cleanup

Completed

- Kapsam sadece src/components/studio/AssemblyPanel.tsx ve src/components/studio/ProjectActions.tsx olarak tutuldu.
- Tum react/no-unescaped-entities error'lari giderildi.
- UI davranisi korundu.
- npx tsc --noEmit temiz gecti.
- npm run lint yalnizca scope disi kalan issue'lar nedeniyle fail ediyor.
- Kalan lint durumu: 16 total problems, 4 errors, 12 warnings.
- Kalan lint kategorileri: 4 react-hooks/set-state-in-effect errors, 10 @typescript-eslint/no-unused-vars warnings, 1 react-hooks/exhaustive-deps warning, 1 @next/next/no-img-element warning.

---
# Sprint 70

## Unused Vars and Imports Cleanup

Completed

- Tum 10 @typescript-eslint/no-unused-vars warning'i giderildi.
- Kapsam app/api/assembly/route.ts, MockAnimationProvider.ts, MockImageProvider.ts, MockExportProvider.ts, MockVideoProvider.ts, AnimationPromptEngine.ts ve ThumbnailConceptEngine.ts ile sinirli tutuldu.
- Mock/foundation function signature'lari korundu.
- Intentionally unused parametreler davranis degistirmeden ele alindi.
- Assembly route icindeki unused research fetch/type kaldirildi.
- npx tsc --noEmit temiz gecti.
- npm run lint artik 6 total problems rapor ediyor: 4 errors, 2 warnings.
- Kalan lint kategorileri: 4 react-hooks/set-state-in-effect errors, 1 react-hooks/exhaustive-deps warning, 1 @next/next/no-img-element warning.

---
# Sprint 71

## React Hook State and Effect Cleanup

Completed

- Kapsam src/components/HomeClient.tsx ve src/components/assets/AssetGallery.tsx olarak tutuldu.
- Tum react-hooks/set-state-in-effect error'lari giderildi.
- react-hooks/exhaustive-deps warning'i giderildi.
- HomeClient loading-step reset'i pipeline start event'ine tasindi.
- AssetGallery asset loading stale-safe async akislar olarak refactor edildi.
- projectSlug degisimleri icin cancellation/stale-result guard'lari eklendi.
- Manual reload ve generation loading davranisi korundu.
- Effect-based editable visual/animation prop sync yerine guarded render-time synchronization kullanildi.
- Review sirasinda manual reload stale-result riski bulundu ve giderildi.
- npx tsc --noEmit temiz gecti.
- npm run lint 0 errors ve 1 warning ile basarili calisiyor.
- Kalan warning: @next/next/no-img-element in AssetGallery.tsx.
- Manuel browser/UI testi yapilmadi.
- Kalan async/UI risk dusuk-orta olarak kaydedildi.

---
# Sprint 72

## Asset Image Rendering Cleanup

Completed

- Kapsam src/components/assets/AssetGallery.tsx olarak tutuldu.
- Existing plain <img> implementation bilincli olarak korundu.
- next/image migration reddedildi; AssetGallery http/https sources, local API-served paths, data:image URLs ve blob/object URLs destekliyor.
- next.config.ts icinde remote image domain/remotePatterns configuration bulunmadigi kaydedildi.
- Bunun yerine dar kapsamli, gerekceli lint suppression eklendi.
- Existing layout, aspect ratio, sizing, lazy loading, fallback ve onError davranisi korundu.
- npx tsc --noEmit temiz gecti.
- npm run lint 0 errors ve 0 warnings ile temiz gecti.
- Rendering risk dusuk olarak kaydedildi.
- Manuel browser/UI testi yapilmadi.

---
# Sprint 73

## Production Engine Smoke Validation

Completed

- Production Engine Smoke Validation tamamlandi.
- Structured research rendering compatibility duzeltildi.
- timeline, characters ve keyEvents hem legacy string hem structured object verilerini guvenli render ediyor.
- TypeScript validation passed.
- Smoke validation basarili.
- Production Engine pipeline davranisi dogrulandi.

---

# Sprint 74

## Pipeline Queue UX Hardening

Completed

- PipelineJobsPanel UI state handling iyilestirildi.
- Proje degisiminde stale job listesi temizleniyor.
- Invalid slug, API error ve fetch error yollarinda stale state temizleniyor.
- Action state ve action lock guvenli sekilde sifirlaniyor.
- Runtime action validation eklendi.
- Action feedback daha tutarli hale getirildi.
- TypeScript validation passed.

---

# Sprint 75

## Pipeline Queue Reliability

Completed

- 5-second polling only while queued/running jobs exist.
- Polling stops when active jobs finish.
- Silent refresh on window focus and tab visibility return.
- Overlapping refresh requests prevented.
- Stale project request results prevented from updating new project state.
- Background refresh preserves the current loading/empty UI.
- API contracts and existing action behavior unchanged.
- npx tsc --noEmit passed.

---

# Sprint 76

## Pipeline Observability UI Layer

Completed

- Added job timestamp visibility.
- Added duration calculations.
- Running job live elapsed time calculated client-side.
- Completed/failed/cancelled duration derived from existing timestamps.
- Retry attempts visibility.
- Existing failed job error visibility preserved.
- No API contract changes.
- PipelineJobManager unchanged.
- Sprint 75 refresh/action behavior preserved.
- npx tsc --noEmit passed.

---

# Sprint 77

## Pipeline Execution History Foundation

Completed

- Added pipeline-history.json storage layer.
- Preserved pipeline-jobs.json behavior.
- Added terminal lifecycle history events.
- Recorded completed, failed and cancelled job events.
- Stored job metadata including timestamps.
- No UI changes.
- No API contract changes.
- Retry/running/queued states do not create history events.
- npx tsc --noEmit passed.

---

# Sprint 78

## Pipeline History API Foundation

Completed

- Added PipelineJobManager.listHistory().
- Added GET /api/projects/[slug]/pipeline/history.
- Exposed existing pipeline-history.json safely.
- Empty history fallback preserved.
- Existing pipeline job APIs unchanged.
- No UI changes.
- No API contract changes.
- API contract compatibility preserved.
- npx tsc --noEmit passed.

---

# Sprint 79

## Pipeline History Viewer Foundation

Completed

- Execution history UI PipelineJobsPanel icinde eklendi.
- Existing GET /api/projects/[slug]/pipeline/history endpoint'i tuketildi.
- Loading, empty ve error state'leri eklendi.
- History refresh active job polling ile senkronize edildi.
- Basarili retry/cancel job action'lari history refresh'i guvenilir sekilde tetikliyor.
- Existing job actions ve API contracts preserved.
- PipelineJobManager unchanged.
- npx tsc --noEmit passed.

---

# Sprint 80

## Pipeline Execution Timeline Foundation

Completed

- PipelineJobsPanel history section timeline-style viewer haline getirildi.
- History events timestamp'e gore siralaniyor.
- Event time bilgisi net gosteriliyor.
- completed, failed ve cancelled status visualization eklendi.
- Existing loading, empty ve error state'leri korundu.
- Existing job actions ve API contracts preserved.
- PipelineJobManager unchanged.
- npx tsc --noEmit passed.

---



# Sprint 81

## Pipeline Intelligence Foundation

Completed

- Client-side Pipeline Intelligence eklendi.
- History ve jobs verilerinden derived metrikler uretildi.
- Success Rate, Failures, Average Duration, Last Event ve Queue Health gosteriliyor.
- Intelligence paneli history bos olsa bile render ediliyor.
- API, PipelineJobManager ve contract degismedi.
- TypeScript ve smoke test basarili gecti.

---

# Sprint Öncelik Kuralları

Her sprint;

- küçük olmalı
- bağımsız tamamlanabilmeli
- TypeScript testi geçmeli
- mevcut sistemi bozmamalı

---

# Sprint 83

## Pipeline Job State Consistency

Completed

- Merkezi ve kuralli job transition modeli eklendi:
  - queued -> running/cancelled
  - running -> completed/failed/cancelled
  - failed/cancelled -> queued retry
- completed durumu terminal olarak korundu.
- cancelRequestedAt kalici olarak kaydedilir; retry attempt'i artirir ve cancellation bilgisini temizler.
- Proje bazli async lock ile cancellation-aware persistence coordinator eklendi.
- startStage, persistStageSuccess, persistStageFailure ve persistProjectCompletion ortak persistence sinirini olusturur.
- PipelineStageExecutor persist akislari coordinator uzerinden gecirildi.
- Scheduler cancelled job durumunu manifest completed durumundan once degerlendirir.
- Cancellation stop reason runner ve /api/pipeline seviyesine tasindi.
- Cancelled execution sonrasi stage output, manifest completed/failed ve proje completed durumu persist edilmez.
- Manuel API save yollari job state'inden ayri tutulur; cancelled queue yeniden baslatilmaz.
- TypeScript validation, final code review ve tum runtime smoke senaryolari basarili.
- Gecici smoke fixture ve harness dosyalari temizlendi.

Kalan riskler:

- Lock process-localdir.
- Dosya yazimlari gercek transaction degildir.
- Paralel manuel save/pipeline execution icin ileride revision/transaction tabanli iyilestirme gerekebilir.
- Cancel uzun suren AI/asset uretimini fiziksel olarak durdurmaz; sonucu persist etmeyi engeller.

---

# Sprint 84

## Retry Execution Integration

Completed

- PipelineRunner.executeJobRetry tek retry execution entrypoint'i oldu.
- failed/cancelled -> queued hazirligi lock altinda yapilir; attempt artar ve cancelRequestedAt temizlenir.
- startStage atomik queued -> running claim'i ile paralel retry cagrilarindan yalnizca birinin execution baslatmasini saglar; diger istek conflict alir.
- Hedef stage job.stage alanindan secilir, dependency readiness kontrol edilir ve yalnizca hedef stage calisir.
- Downstream stage'ler retry sonucunda otomatik baslamaz.
- /pipeline/retry ve job action retry ayni runner akisinda birlestirildi.
- UI gercek retry execution sonucunu completed veya blocked olarak gosterir.
- TypeScript validation, tum runtime smoke testleri ve final code review basarili.

Kalan riskler:

- Dependency blocked retry job'i queued durumda kalir; ileride explicit blocked state gerekebilir.
- Stage execution error durumunda route genel 500 response doner; ileride yapilandirilmis execution result response eklenmeli.

---

# Tamamlanma Kriteri

Bir sprint aşağıdaki şartlar sağlanınca tamamlanır.

- Kod tamamlandı
- TypeScript geçti
- Rapor hazırlandı
- Checkpoint güncellendi
- Git commit
- Git push

---

# Sonraki Güncelleme

Sprint tamamlandığında;

- Aktif Sprint değiştirilir.
- Tamamlanan sprint kaldırılmaz.
- Durumu "Completed" yapılır.
