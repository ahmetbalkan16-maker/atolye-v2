---
Document: ROADMAP.md
Version: 1.0.0
Status: Active
Priority: High
Owner: Atölye V2
Last Updated: 2026-07-14
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

Sprint 116 — Animation Motion Plan Production Contract (Completed)

Siradaki Planlama Adimi

Sonraki sprint — Planning

Sprint 116 Animation Motion Plan Production Contract tamamlandi. Sonraki sprint yalniz Planning durumundadir; kapsami ayrica planlanacak ve onaylanacaktir.

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

# Sprint 85

## Retry Execution Failure Response Hardening

Completed

- Stage execution exception runner icinde yapilandirilmis retry sonucuna cevrildi.
- Execution failure iki retry endpoint'inde ortak sozlesmeyle doner: HTTP 500, success: false, blocked: false, error: "Pipeline retry execution failed." ve result.status: 500.
- Basarili retry HTTP 200; dependency-blocked ve conflict akislari HTTP 409 davranisini korur.
- Job endpoint'i jobs ve execution alanlarini geriye uyumlu olarak korur.
- Provider/stage exception ayrintilari istemciye sizdirilmaz; gercek hata sunucu logu ve failure persistence akisinda kalir.
- TypeScript, hedefli smoke ve npm run build basarili.

Kalan riskler:

- Lock process-localdir.
- Filesystem persistence transaction degildir.
- Sunucu log erisimi guvenli tutulmalidir.

---

# Sprint 86

## Retry Dependency Preflight Hardening

Completed

- Dependency retry plani herhangi bir job mutation'indan once olusturuldu.
- Dependency blocked durumda HTTP 409 ve blocked: true doner; prepareJobRetry cagrilmaz, status, attempts, cancelRequestedAt ve tum zaman alanlari korunur.
- Ready durumda preflight -> prepareJobRetry -> scheduler/atomik claim -> execution akisi korundu.
- Basarili retry HTTP 200; cancel, conflict ve manifest/job tutarsizligi HTTP 409 davranisini korur.
- Sprint 85 execution-failure HTTP 500 sozlesmesi aynen korunur.
- Review sirasinda gereksiz ikinci dependency plan hesaplamasi kaldirildi.
- TypeScript, hedefli smoke ve npm run build basarili.

Kalan riskler:

- Planlama ile preparation arasinda kisa bir race window vardir.
- Lock process-localdir ve filesystem persistence transaction degildir.
- Dependency disi scheduler/state-load bloklarinda queued kalma riski ayri bir gelecek istir.

---

# Sprint 87

## Retry State-Load Preflight Hardening

Completed

- Read-only job lookup -> dependency preflight -> state-load preflight -> prepareJobRetry -> scheduler/atomik claim -> execution sirasi kuruldu.
- State yuklenemezse HTTP 409, blocked: true ve "Project could not be read." sonucu doner; prepareJobRetry cagrilmaz, job status, attempts, cancellation ve zaman alanlari korunur.
- Seed edilmemis job storage icin getJobReadOnly ve getJobForStageReadOnly mevcut pipeline-jobs.json iceriğini yalnizca okur; manifestten seed etmez ve dosya yazmaz.
- Storage'da bulunmayan gecerli retry job ID'si icin stage, tam proje slug prefix'i ve pipeline stage whitelist'i ile guvenli bicimde turetilir.
- State basariyla yuklendikten sonra mevcut seed/preparation, scheduler/atomik claim ve execution davranisi korunur.
- Basarili retry HTTP 200, cancel/conflict HTTP 409 ve Sprint 85 execution-failure HTTP 500 sozlesmeleri degismedi.
- Yeni job state'i, API alani, UI davranisi veya persistence mimarisi eklenmedi.
- TypeScript, hedefli smoke ve npm run build basarili; Turbopack dinamik dosya izleme uyarisi build'i engellemedi.

Kalan riskler / takip isleri:

- State ile execution arasindaki mevcut eszamanli manuel-save penceresi uzar.
- Scheduler sonrasinda queued kalma riski ayri bir takip isidir.
- JSON filesystem persistence transaction veya mutlak dosya atomikligi saglamaz.

---

# Sprint 88

## Retry Post-Preparation Compensation Hardening

Completed

- Scheduler stage dondurmezse prepared target job, yalniz ayni queued attempt icinse preparation oncesi snapshot'a kosullu olarak geri alinir.
- prepareJobRetry internal basari sonucu previousJob, queued prepared job ve guncel job listesini tasir; HTTP/API response alanlari degismedi.
- Compensation lock altinda storage'i yeniden okur; ayni job ID, queued status, prepared attempt ve bos cancelRequestedAt kosullarinda restore uygular.
- Status, attempts, error, cancellation ve job zaman alanlari tam previous snapshot'tan geri yuklenir; diger job'lar korunur.
- Cancelled, running/claimed veya sonraki attempt'e gecmis job geri alinmaz; kosullar eslesmezse write yapilmaz.
- Runner compensation'i yalniz scheduler stage dondurmediginde cagirir; startStage conflict/cancel ve execution-failure yollarinda calismaz.
- Scheduler blocked HTTP 409, ready retry HTTP 200, preparation/cancel/conflict HTTP 409 ve Sprint 85 execution-failure HTTP 500 sozlesmeleri korundu.
- TypeScript, izole compensation smoke ve npm run build basarili; Turbopack dinamik dosya izleme uyarisi build'i engellemedi.

Kalan riskler / takip isleri:

- Compensation write basarisiz olursa endpoint 500 donebilir ve queued job geri alinamamis olur.
- Preparation ve compensation iki ayri JSON write islemidir; transaction degildir.
- Process-local lock surecler arasi atomiklik saglamaz; lock disi ayni queued attempt yazimi eski snapshot ile ezilebilir.

---

# Sprint 89

## Retry Persistence Failure Hardening

Completed

- Pipeline job persistence benzersiz temporary file ve ayni klasorde atomic rename kullanir.
- Preparation persistence write veya rename hatasinda mevcut destination dosyasi, previous job snapshot'i ve onceki attempt state'i korunur.
- Scheduler blocked retry basarili compensation sonrasinda HTTP 409 ve blocked: true donmeye devam eder.
- Compensation restore persistence hatasi HTTP 500, success: false ve blocked: false internal failure sonucu doner.
- Basarili retry HTTP 200; normal dependency, state ve scheduler conflict sonuclari HTTP 409 olarak korunur.
- Sprint 88 previousJob snapshot contract'i ile cancelled, running/claimed ve new-attempt compensation guard'lari degismedi.
- JSON storage, process-local locking ve non-distributed concurrency sinirlari korunur.
- TypeScript validation, Sprint 89 retry persistence smoke ve git diff --check basarili.
- Windows destination replacement davranisi dogrulandi.

Kalan riskler / takip isleri:

- Preparation ve compensation ayri JSON persistence islemleridir; transaction degildir.
- Process-local lock surecler arasi veya distributed atomiklik saglamaz.
- Eszamanli surecler arasi yazimlarda son basarili rename kazanir; revision/lost-update korumasi yoktur.
- Temporary file cleanup persistence hatalarinda best-effort'tur.

---

# Sprint 90

## Pipeline History Persistence Hardening

Completed

- pipeline-history.json persistence mevcut writeJSONAtomically() mekanizmasini kullanir.
- Sprint 89 pipeline-jobs.json atomic persistence yolu degismedi.
- History schema ve persistence payload shape korundu.
- Mevcut event sirasi korunur ve yeni event listenin sonuna append edilir.
- Mevcut limitsiz retention davranisi degismedi; trimming veya limit eklenmedi.
- Temporary write, JSON serialization veya rename hatasi mevcut destination'i byte-for-byte korur.
- Orijinal persistence error object maskelenmeden yukari tasinir; cleanup best-effort'tur ve cleanup hatasi orijinal hatanin yerini almaz.
- Cancel ve completed/failed transition history yazimlari ortak atomic recordHistoryEvent() yolunu kullanir.
- Normal ProjectWriter.writeJSON(), UI, API ve HTTP contract davranislari degismedi.
- npx tsc --noEmit, Sprint 90 pipeline history persistence smoke ve git diff --check basarili.

Kalan riskler / takip isleri:

- JSON storage, process-local locking ve non-distributed concurrency sinirlari degismedi.
- Cleanup basarisizliginda artik temporary file kalabilir; orijinal persistence hatasi korunur.
- Surecler arasi eszamanli history yazimlarinda revision/lost-update korumasi yoktur.

---

# Sprint 91

## Pipeline State Corruption Detection

Completed

- pipeline-jobs.json ve pipeline-history.json corruption-aware state reader kullanir.
- Missing, parsed ve malformed read sonuclari ayri ele alinir.
- Yalniz ENOENT missing file olarak kabul edilir; diger filesystem hatalari internal failure olarak propagate edilir.
- Malformed JSON ve structural validation failure ayri hata turleri olarak raporlanir.
- Error mesajlari etkilenen state filename/type bilgisini tasir ve raw dosya icerigi sizdirmaz.
- Corrupted state dosyalari write, truncate, rename, delete veya silently replace edilmez.
- Missing jobs/history dosyalari mevcut empty-state payload davranisini korur.
- Generic ProjectReader.readJSON() davranisi degismedi; job ve history schema contract'lari korundu.
- Mevcut stored pipeline state dosyalari yeni validation kurallariyla uyumlu bulundu.
- Null optional alanlar, unknown stage veya slug mismatch iceren legacy-invalid data artik sessizce filtrelenmek yerine reddedilir.
- npx tsc --noEmit, Sprint 91 pipeline state corruption smoke ve git diff --check basarili.

Kalan riskler / takip isleri:

- attempts finite number olarak dogrulanir; integer/non-negative olmasi zorunlu degildir.
- Timestamp alanlari string olarak dogrulanir; parse edilebilir ISO date olmasi zorunlu degildir.

---

# Sprint 92

## Pipeline State Error Contract Hardening

Completed

- Malformed, structurally invalid ve non-ENOENT read failure'lari typed PipelineStateError contract'i kullanir.
- Jobs stable code'lari: PIPELINE_JOBS_STATE_MALFORMED, PIPELINE_JOBS_STATE_INVALID, PIPELINE_JOBS_STATE_READ_FAILED.
- History stable code'lari: PIPELINE_HISTORY_STATE_MALFORMED, PIPELINE_HISTORY_STATE_INVALID, PIPELINE_HISTORY_STATE_READ_FAILED.
- Ilgili alti pipeline API route ortak createPipelineStateErrorResponse() helper'ini kullanir.
- Public state-error response HTTP 500 ve yalniz success: false, code ve fixed safe error message alanlarini tasir.
- Raw JSON, absolute path, stack, permission/filesystem details ve Error.cause public response'a sizmaz.
- Non-ENOENT original error Error.cause olarak korunur ve server-side diagnostics icin kullanilir.
- Typed discrimination trusted Symbol.for + WeakSet registry ile stable field validation kullanir; yalniz instanceof'e dayanmaz.
- State error'lar stage, runner, retry execution ve compensation catch'lerinden degistirilmeden propagate edilir.
- Typed error logging yalniz ortak API helper'a aittir; runStage generic failure persistence uygulamaz.
- Non-state runner/stage logging ve generic failure contract'lari degismedi.
- HTTP 200, 404 ve valid 409 contract'lari korundu.
- UI, storage schema, persistence format ve recovery davranisi degismedi.
- npx tsc --noEmit, 18-case Sprint 92 pipeline state error contract smoke ve git diff --check basarili.

---

# Sprint 93

## Pipeline Orchestration Foundation

Completed

- Merkezi pipelineRecoveryStageOrder ile getNextPipelineStage() helper'i eklendi.
- Downstream orchestration yalniz running -> completed transition sonrasinda calisir.
- Completed source ve eksik downstream queued job ayni pipeline-jobs.json atomic write isleminde persist edilir.
- Export final stage olarak kalir; yeni job olusturmaz.
- Failed, cancelled, queued ve invalid transition durumlari downstream tetiklemez.
- Herhangi bir existing downstream stage kaydi duplicate olusumunu engeller ve aynen korunur.
- Deterministik project+stage tek-job modeli korunur; failed/cancelled downstream ayni job uzerinde retry attempt kullanir.
- Retry, polling, tekrar completion ve same-process concurrent completion idempotent'tir.
- Jobs/history ayri atomic islemlerdir; history failure completed source + queued downstream state'ini rollback etmez ve error propagate edilir.
- withProjectLock() ayni-process completion cagrilarini serialize eder; processler arasi distributed lock yoktur ve JSON lost-update siniri devam eder.
- pipelineRecoveryStageOrder adi Sprint 93 kapsaminda degistirilmedi.
- API, UI, persistence schema ve HTTP 200/404/409/safe 500 contract'lari korundu.
- npx tsc --noEmit, 10-scenario Sprint 93 orchestration smoke, 18-case Sprint 92 state error smoke ve git diff --check basarili.

---

# Sprint 94

## Planning

Durum

Planning

- Sprint 93 tamamlandi.
- Next sprint planning; kesin kapsam henuz belirlenmedi.

---

# Sprint 95.3

## Read-Only Production Snapshot Builder

Durum

Completed

- Production snapshot kaynaklarinin tamami mevcut PipelineJobManager project-level lock altinda ve write-free okunur.
- Yeni lock, execution entrypoint veya duplicate execution path eklenmedi; snapshot pipeline state mutation yapmaz.
- Project slug, manifest dis slug, manifest.project.slug, AI usage log slug ve tum AI usage kayitlarinin projectSlug degerleri dogrulanir.
- Slug uyusmazliklari mevcut malformed source durumuyla raporlanir; unavailable ve error propagation sozlesmeleri korunur.
- Torn-state concurrency senaryosu ve dort wrong-project-slug senaryosu smoke kapsamindadir.
- Runner, scheduler, retry ve auto-continuation akislari degistirilmedi.
- Final review P0-P3 bulgusuz gecti.
- npx tsc --noEmit --incremental false, Sprint 95.3 smoke PASS (29 senaryo) ve git diff --check basarili.
- Gecici fixture kalmadi.

Sonraki gorev:

- Sprint 95.4 — Health Check Rules Foundation.

---

# Sprint 98.0

## Production Execution Persistence Adapter Foundation

Durum

Completed

- Transaction, operation journal, idempotency ve reservation icin ortak persistence adapter interface'i tamamlandi; frozen schema v1 contract'lari korunuyor.
- JSON/file adapter canonical serialization, exclusive unique temp write, temp read/validation ve hard-link no-replace commit kullanir.
- Paralel writer davranisi ayni payload icin created + idempotent replay, farkli payload icin created + stable conflict olarak dogrulandi.
- Frozen transaction builder/validator, journal builder/validator, idempotency identity builder/replay evaluator ve reservation validator kullanilir.
- Invalid incoming payload, corrupt existing record, filesystem failure ve cleanup diagnostic contract'lari ayridir.
- Gateway disabled/preview-only; dispatch, execution, provider, mutation, queue, worker ve UI execution kapali kalir.
- Review: P0 0, P1 0. P2 inherited transaction schema v1 actor/project integrity kapsami; P3 runtime shape gate bakim/drift riski.
- Frozen v1 degistirilmeyecek. Actor/project integrity kapsami transaction schema v2, migration ve version negotiation takip maddesidir.
- Sprint 98.0 smoke 70 senaryo PASS; Sprint 97 zinciri 10/10 ve tum Sprint 89-98 smoke betikleri 34/34 PASS. TypeScript, lint 0 warning, build ve diff check PASS.

Sonraki planlama adimi:

- Sprint 98.1 — Durable Idempotency and Reservation Storage Integration.
- Sprint 98.1 otomatik uygulanmayacak ve gercek execution acilmayacak.

---

# Sprint 99.1

## Durable Storage Recovery & Index Hardening

Completed

- Canonical durable reservation ve append-only idempotency kayitlari tek source of truth'tur; recovery veya index canonical corruption'i overwrite etmez ve implicit empty state uretmez.
- Deterministik, write-free scan ile explicit cleanup/quarantine apply islemleri ayridir.
- Atomic write'tan kalan valid unique temp artifact'lari orphan olarak siniflandirilir; valid target varsa temp kaynak gerceklik sayilmaz. Partial, malformed ve ambiguous artifact otomatik silinmez, recovery-required kalir.
- Reservation, idempotency key ve request ID lookup icin content-addressed immutable index canonical kayitlardan deterministik rebuild edilir. Index derived artifact'tir; authorization, execution veya business decision kaynagi degildir.
- Missing, stale, malformed veya integrity mismatch index canonical kayitlara zarar vermez. Rebuild canonical validation, temp validation ve hard-link no-replace commit sinirini yeniden kullanir.
- Directory durability supported, unsupported, failed ve indeterminate olarak acik modellenir; unsupported platformlarda fsync garantisi verilmez ve platform-specific hata public contract'a sizmaz.
- Recovery caller-driven explicit servistir. Execution, queue, worker, provider/network, UI execution, polling, timer ve background/startup cleanup kapali kalir.
- Sprint 99.1 smoke 29/29, Sprint 97.1–99.0 regresyonu 11/11 ve genel smoke runner 36/36 PASS.
- TypeScript, lint ve production build PASS. Legacy Turbopack NFT whole-project trace warning devam eder.
- Commit ve push yapilmadi.

---

# Sprint 100

## Durable Lease & Worker Ownership Foundation

Completed

- Server-controlled canonical worker ve worker-session identity ile reservation/execution-bound durable lease contract'i tamamlandi.
- Acquire, heartbeat/renewal, explicit expiry evaluation, takeover ve release operation'lari append-only immutable record version'lari ve expectedVersion CAS kullanir.
- Ayni request replay-safe'tir; stale/version/next-version, owner/session/lease-ID ve active ownership conflict'leri stable reason code'larla ayrilir.
- Heartbeat geriye gidemez; renewal expiry'yi ileri tasir ve acik policy maximum window/duration sinirlarina uyar. Expired veya released lease implicit revive edilmez.
- Expiry background timer olmadan yalniz explicit evaluatedAt ile hesaplanir. Active takeover deny; expired takeover explicit evaluation + mutation ile yeni version olusturur.
- Release ile cancel semantigi ayridir; yalniz owner release yapar ve release replay-safe'tir.
- Corrupt/integrity-mismatch/recovery-required canonical kayit mutation ile overwrite edilmez veya empty state kabul edilmez.
- Gercek worker process, queue consumer/dispatch, pipeline execution, provider/network, scheduler, polling, startup recovery, execution API ve UI execution kapali kalir.
- Sprint 100 smoke 40/40, Sprint 97.1–99.1 regresyonu 12/12 ve genel smoke runner 37/37 PASS.
- TypeScript, lint ve production build PASS; legacy Turbopack NFT trace warning ve Sprint 99.1 directory fsync platform limitation degismedi.
- Commit ve push yapilmadi.

---

# Sprint 101

## Durable Execution Claim & Recovery Coordination

Completed

- Reservation, idempotency record ve durable lease canonical source'lari write-free preflight ile tek claim binding snapshot'inda yeniden dogrulanir.
- Claim coordination source kayitlarini kopyalamaz; tek append-only `claims/<claimId>-vN.json` coordination record'i kullanir.
- Claim acquire/release/abandon expected claim version CAS, unique temp validation, hard-link no-replace ve readback validation uygular. Exact replay write-free'dir.
- Coordination transactional degildir: intended writes ve stabil commit order aciktir, implicit rollback yoktur. Partial commit canonical write'i overwrite etmez; recovery/compensation-required olarak raporlanir.
- Recovery assessment write-free; no claim, active/replay-safe, expired/released lease, missing/stale link, partial, malformed/integrity/unsupported/ambiguous ve recovery-required durumlarini ayirir.
- Lease/reservation expiry yalniz explicit evaluatedAt ile belirlenir. Released claim yeniden active olmaz; abandon release'den ayri recovery operation'idir.
- Gercek execution, worker, queue consumer/dispatch, provider/network, process spawn, timer, polling, scheduler, startup recovery, API route, UI execution ve distributed lock kapali kalir.
- Sprint 101 smoke 39/39, Sprint 97.1–100 regresyonu 13/13 ve genel smoke runner 38/38 PASS.
- TypeScript, lint ve production build PASS; legacy Turbopack trace warning ve directory fsync platform limitation devam eder.
- Commit ve push yapilmadi.

---

# Sprint 102

## Durable Execution Attempt & Outcome Journal Foundation

Completed

- Active claim/reservation/lease ownership altinda append-only attempt lifecycle ve canonical binding tamamlandi.
- Attempt journal embedded append-only source-of-truth; sequence contiguous/monotonic, entry replay-safe ve payload public-safe'tir.
- Outcome proposal terminal degildir; matching explicit finalization success/failure/cancelled terminal state uretir.
- Attempt, journal ve outcome mutation'lari tek `attempts/<attemptId>-vN.json` CAS zincirinde unique temp -> validation -> no-replace -> readback sirasi kullanir.
- Coordination transactional degildir, implicit rollback yoktur; partial/ambiguous durum recovery/compensation-required kalir.
- Recovery assessment write-free; linked claim/lease/reservation canonical olarak yeniden dogrulanir.
- Execution, provider/network, queue, worker process, timer/polling, scheduler, startup recovery, API/UI ve distributed lock kapali kalir.
- Sprint 102 smoke 58/58, Sprint 97.1–101 regresyonu 14/14 ve genel runner 39/39 PASS; TypeScript/lint/build PASS.
- Legacy Turbopack trace warning ve unsupported directory fsync limitation devam eder. Commit/push yapilmadi.

---

# Sprint 103

## Production Execution Coordinator Foundation

Completed

- Tek public `coordinate` girisi claim, lease ve durable attempt acilisini merkezi olarak koordine eder.
- Write-free claim preflight ve lease evaluation mevcut servisler uzerinden sirali calisir; claim, lease, worker ve session conflict'leri deterministik olarak raporlanir.
- Durable attempt ilk istekte create/open edilir; ayni idempotency request exact replay'de mevcut attempt write-free doner, farkli payload deterministik conflict uretir.
- Attempt version ve embedded journal butunlugu korunur; yeni persistence formati eklenmedi.
- Mevcut CAS, immutable versioning, canonical validation, no-replace ve recovery sozlesmeleri korunur. Replay, recovery ve worker execution davranislari degismez.
- Sprint 103 smoke 9/9 PASS; `npx tsc --noEmit`, hedefli ESLint ve `git diff --check` PASS.
- Acik risk: claim ve lease coordinator cagrisi oncesinde mevcut olmalidir; katmanlar arasi atomik transaction henuz yoktur.
- Commit veya push yapilmadi.

---

# Sprint 104

## Durable Attempt Lifecycle Foundation

Completed

- Tek public lifecycle `mutate` API ile created/prepared -> running, running -> completed/failed ve active -> cancelled gecisleri merkezilestirildi.
- Completed public lifecycle sonucu mevcut durable attempt `succeeded` state'ine eslenir; failed ve cancelled terminaldir.
- Expected-version CAS, claim/worker/session/lease ownership dogrulamasi ve mutation basina tek immutable attempt version korunur.
- Journal append-only source of truth'tur; sequence contiguous ve monotoniktir. Exact replay write-free, ayni event ID/farkli payload conflict ve stale version conflict deterministiktir.
- Gecersiz transition sirasi ve terminal attempt mutation'i reddedilir.
- Sprint 104 smoke 16/16 PASS; `npx tsc --noEmit`, hedefli ESLint ve `git diff --check` PASS.
- Acik riskler: claim ve lease onceden mevcut olmalidir; katmanlar arasi atomik transaction yoktur; worker execution entegrasyonu henuz yapilmadi.
- Commit veya push yapilmadi.

---

# Sprint 105

## Durable Worker Execution Foundation

Completed

- Tek public `execute` API coordinator attempt create/open/replay, lifecycle running/terminal transition ve generic handler execution akislarini birlestirir.
- Success completed/succeeded, handler error failed, pre/post cancellation cancelled uretir. Running transition basarisizsa handler cagrilmaz.
- Terminal exact replay handler'i yeniden calistirmadan ve write uretmeden mevcut sonucu dondurur.
- Claim/lease/worker/session ownership ve expired lease engeli korunur; duplicate concurrent execution deterministik conflict uretir.
- Handler bir kez cagrilir; yalniz guvenli serializable ozet persist edilir. Raw error stack, secret veya kontrolsuz payload journal'a girmez.
- Mutation basina tek version artisi ve contiguous/monotonik journal sequence korunur; yeni persistence formati eklenmedi.
- Sprint 105 worker smoke 18/18 ve Sprint 97.7 worker regresyonu 55/55 PASS; `npx tsc --noEmit`, hedefli ESLint ve `git diff --check` PASS.
- Acik riskler: duplicate lock instance-scope'tur ve distributed lock degildir; handler yan etkileri attempt persistence ile atomik degildir; running sonrasi process kesintisi recovery sozlesmeleriyle ele alinmalidir.
- Commit veya push yapilmadi.

---

# Sprint 106

## Pipeline Stage Durable Execution Integration

Completed

- `PipelineRunner.runStage`, opsiyonel durable adapter ile sarildi; durable baslangic olmadan job claim ve stage handler calismaz, adapter yoksa legacy davranis korunur.
- Mevcut handler'lar adapter/wrapper ile `ProductionExecutionWorkerExecutionService` uzerinden calisir; handler implementasyonlari yeniden yazilmadi.
- Success/failure/cancellation/replay mevcut boolean/exception sozlesmesine cevrilir. Exact replay handler'i tekrar calistirmaz.
- Minimal guvenli metadata journal'a yazilir; raw output, secret ve stack persist edilmez. Public API/UI degismez.
- Retry, queue, scheduler, history, auto-continuation ve recovery davranislari regresyonsuz korunur.
- Sprint 106 smoke 17/17, retry persistence 5/5 grup, orchestration 10/10, history 6/6 ve auto-continuation 18/18 PASS; TypeScript, hedefli ESLint ve diff check PASS.
- Acik riskler: composition root adapter/request factory saglamalidir; pipeline job ile attempt persistence atomik degildir; duplicate lock instance-scope'tur ve distributed lock garantisi yoktur.
- Commit veya push yapilmadi.

---

# Sprint 107

## Durable Pipeline Composition Root Wiring

Completed

- Normal pipeline run, stage retry API, pipeline resume API ve job-action retry API ayni merkezi composition factory ile configured `PipelineRunner` kullanir; auto-continuation ayni runner uzerinden ilerler.
- `ProductionPipelineExecutionFactory`, job-attempt identity'sini deterministik uretir. Ayni attempt ayni identity'yi, yeni retry attempt farkli identity'yi alir.
- Mevcut reservation/record replay kullanilir; claim ve lease stage handler'dan once hazirlanir. Hazirlik basarisizsa handler ve legacy job claim zinciri calismaz.
- `ATOLYE_DURABLE_PIPELINE_EXECUTION=enabled` guard acikken durable adapter etkinlesir; guard kapaliyken legacy davranis korunur.
- Public API ve UI sozlesmeleri degismedi; retry, queue, scheduler, history, recovery ve auto-continuation davranislari korundu.
- Sprint 107 wiring smoke 19/19, retry persistence 5/5 grup, pipeline orchestration 10/10, history persistence 6/6, auto-continuation 18/18 ve state corruption/recovery 8/8 PASS.
- `npx tsc --noEmit`, hedefli ESLint ve `git diff --check` PASS.
- Acik riskler: `PipelineRunner` konfigurasyonu process-global'dir; job/durable persistence atomik degildir; duplicate lock instance-scope'tur; distributed lock garantisi yoktur; reservation/lease sure politikasi operasyonel config'e tasinmalidir.
- Commit veya push yapilmadi.

---

# Sprint 108

## Durable Recovery Bootstrap Integration

Completed

- Tek public `bootstrapRecovery` API durable attempt'leri read-only tarar ve active, running, terminal, orphaned, expired-lease ve replayable olarak siniflandirir.
- Immutable version zinciri, append-only journal ve contiguous sequence dogrulanir; exact bootstrap replay deterministik ve write-free kalir.
- Mevcut lifecycle recovery degerlendirmesi kullanilir; `PipelineRecoveryPlanner` icin guvenli ve deterministik normalize edilmis plan ciktisi uretilir.
- Terminal attempt'ler yeniden planlanmaz; expired lease attempt'ler recovery adayi olur. Yeni persistence formati veya mutation eklenmedi.
- Pipeline, retry, scheduler, queue, history ve auto-continuation davranislari degistirilmedi.
- Sprint 108 recovery bootstrap 15/15; durable storage recovery 29/29; pipeline state corruption/recovery 18/18; pipeline orchestration 10/10; production execution persistence 70/70 PASS.
- `npx tsc --noEmit`, hedefli ESLint ve `git diff --check` PASS.
- Sprint 99–108 Durable Production Execution fazi bu sprint ile tamamlandi.
- Acik riskler: process-start composition root wiring eksiktir; snapshot isolation yoktur ve eszamanli mutation indeterminate sonuc uretebilir; expired lease remediation coordinator/lifecycle/worker hattindadir; distributed recovery, leader election ve distributed lock garantisi yoktur.
- Commit veya push yapilmadi.

---

# Sprint 109

## Process Startup Bootstrap Integration

Completed

- `instrumentation.ts/register()` process-start hook'u `ProductionRuntimeCompositionRoot` uzerinden runtime initializer'a baglanir.
- Idempotent `ProductionRuntimeInitializer`, ilk initialization Promise'ini instance/process kapsaminda cache eder; tekrar cagri duplicate bootstrap uretmez.
- Tek timestamp ile projeler deterministik sirada taranir ve proje basina mevcut `bootstrapRecovery` API cagrilir.
- Recovery bootstrap write-free kalir; sonucu dogrulanmadan initialized karari verilmez.
- Startup fail-closed ve yapilandirilmis hata davranisina sahiptir; partial initialization olusmaz.
- Terminal attempt'ler yeniden planlanmaz; expired lease attempt'ler yalniz recovery adayi olarak raporlanir.
- Scheduler, worker ve remediation davranislari degistirilmedi; persistence formati veya yeni durable mutation eklenmedi.
- Sprint 109 startup smoke 11/11; Sprint 108 recovery bootstrap 15/15; pipeline orchestration 10/10; production execution persistence 70/70 PASS.
- `npx tsc --noEmit`, hedefli ESLint ve `git diff --check` PASS.
- Acik riskler: once-only garantisi process kapsamindadir; development HMR yeniden yukleme riski vardir; snapshot isolation yoktur; proje sayisi startup suresini artirabilir; distributed recovery, leader election, distributed lock ve expired lease remediation sonraki kapsamdir.
- Commit veya push yapilmadi.

---

# Sprint 110

## Production Worker Lifecycle

Completed

- `created -> starting -> ready -> draining -> stopped` ve `failed` durum modeli merkezi `ProductionWorkerLifecycle` tarafindan yonetilir.
- Recovery initialization ve sonuc dogrulamasi tamamen basarili olmadan worker `ready` olmaz; startup failure partial initialization birakmadan `failed` durumuna gecer.
- `ProductionRuntimeCompositionRoot` tek lifecycle instance'ini initializer ve gercek pipeline execution factory'siyle paylasir.
- Gercek execution yolundaki admission gate reservation, claim, lease ve handler yan etkilerinden once calisir. Kabul kontrolu ile active-count artirimi atomiktir ve arada async bosluk yoktur.
- Kabul edilen execution sync veya async hata verse de active-count `finally` ile azalir. Drain yeni execution'i reddeder ve aktif execution'lar tamamlanana kadar bekler.
- `start()`, `drain()` ve `stop()` instance-scoped cached Promise kullanarak idempotent davranir; bos drain hemen tamamlanir. `draining`, `stopped` ve `failed` durumlari yeni execution'i deterministik reddeder.
- Scheduler, persistence formati, recovery bootstrap ve execution sonuc sozlesmeleri korunur; yeni durable mutation eklenmez.
- Sprint 110 worker lifecycle 16/16; Sprint 109 startup 11/11; Sprint 108 recovery bootstrap 15/15; Sprint 107 wiring 19/19; pipeline orchestration 10/10; production execution persistence 70/70; worker execution regresyonlari 55/55 ve 18/18 PASS.
- `npx tsc --noEmit`, hedefli ESLint ve `git diff --check` PASS.
- SIGTERM/SIGINT, framework shutdown wiring, distributed drain ve cross-process coordination kapsam disidir.
- Acik riskler: lifecycle process/instance kapsamindadir; in-flight handler ile process shutdown atomik degildir; distributed drain ve cross-process admission garantisi yoktur.
- Commit veya push yapilmadi.

---

# Sprint 111

## Production Worker Health & Runtime Diagnostics

Completed

- Merkezi lifecycle singleton'i read-only `ProductionRuntimeStatus` snapshot'inin tek state, active-count ve admission kaynagidir; composition root ayni instance uzerinden senkron `getProductionRuntimeStatus()` getter'i sunar.
- Snapshot lifecycle state, gercek active execution count, execution acceptance, initialized, recovery-completed, worker-ready, draining, startup ve last-transition timestamp'leri ile normalize initialization failure bilgisini ayri anlamlarla raporlar.
- Created, starting, ready, draining, stopped ve failed durumlari deterministik olarak gozlemlenir; recovery dogrulanmadan ready veya acceptance true olmaz. Basarili initialization bilgisi drain ve stop sonrasinda korunurken current readiness kapanir.
- Her cagri yeni ve frozen write-free value object dondurur; nested failure nesnesi de frozen'dir. Raw Error, message, stack, cause, path, Promise veya mutable internal collection disari sizmaz; failed project slug yalniz guvenli validation sonrasinda eklenir.
- Status okumalari lifecycle state mutation, persistence write, scheduler action, recovery bootstrap veya execution side effect uretmez. Mevcut scheduler, persistence, recovery bootstrap, startup ve execution admission sozlesmeleri degismez.
- API endpoint, UI, polling/timer, OS signal/shutdown hook ve distributed/cross-process status coordination kapsam disinda kalir.
- Final reviewde ready transition timestamp semantigi duzeltildi ve smoke kapsami tekrar initialize/start stabilitesi, state boolean matrisi, timestamp transition-only davranisi, nested immutability ve failure sanitization senaryolariyla genisletildi.
- Sprint 111 runtime status smoke 15/15; Sprint 110 worker lifecycle 16/16; Sprint 109 runtime startup 11/11 PASS. `npx tsc --noEmit`, hedefli ESLint ve `git diff --check` PASS.
- Commit veya push yapilmadi.

---

# Sprint 112

## Production Runtime Health API

Completed

- `GET /api/runtime/health`, yalniz mevcut `ProductionRuntimeCompositionRoot.getProductionRuntimeStatus()` getter'ini kullanir ve yeni runtime graph, lifecycle, initializer, recovery, scheduler, persistence veya execution baslatmaz.
- Discriminated union HTTP envelope `schemaVersion: "1"`, normalize API status, readiness, execution acceptance, Sprint 111 runtime snapshot'i ve yalniz API gozlem zamanini ifade eden `observedAt` alanlarini sunar.
- Healthy ve execution kabul eden runtime HTTP 200; starting, draining, stopped ve failed HTTP 503; getter hatasi, bilinmeyen lifecycle veya readiness tutarsizligi HTTP 503 unavailable doner.
- Tum readiness invariant'lari fail-closed dogrulanir. Tutarsiz veya guvenli olmayan snapshot `runtime:null` ile kapanir; failed lifecycle yalniz normalize guvenli failure bilgisini tasir.
- `Cache-Control: no-store`, Node.js runtime, force-dynamic ve `revalidate=0` static caching'i kapatir. Endpoint process-local health sunar; distributed health garantisi vermez.
- Gercek GET wiring'i, tekrarlanan cagrilarin write-free davranisi ve snapshot mutasyon siniri dogrulandi.
- Sprint 112 health API smoke 24/24; Sprint 111 runtime status 15/15; Sprint 110 worker lifecycle 16/16; Sprint 109 runtime startup 11/11 PASS. TypeScript, hedefli ESLint ve `git diff --check` PASS.
- Final review bloklayici veya bloklayici olmayan bulgu olmadan tamamlandi.
- Commit veya push yapilmadi.

---

# Sprint 113

## Production Visual Asset Pipeline Activation

Completed

- `IMAGE_PROVIDER` tanimsiz/bos durumda mock-first default kullanir; `mock` `MockImageProvider`, `openai` `OpenAIImageProvider` secer ve bilinmeyen deger safe configuration error ile fail-closed kapanir.
- Provider resolution import sirasinda ag cagrisi, image generation veya yeni runtime graph olusturmaz.
- Pipeline visuals stage mevcut `VisualAssetPipeline` ile gercek asset generation'a baglidir. Visual plan korunur ve success persistence yalniz asset batch basarisindan sonra calisir.
- Her scene sonucu kendi sceneId degeriyle deterministik eslestirilir. Bos scene listesi, positive safe-integer olmayan sceneId ve duplicate sceneId provider cagrisi veya asset write oncesinde reddedilir.
- Gercek provider MIME allowlist'i `image/png`, `image/jpeg` ve `image/webp` ile sinirlidir.
- Dis URL yalniz HTTP/HTTPS olabilir. Application-local URL yalniz exact `/api/assets/images/{slug}/{fileName}` contract'i, `ImageStorage.getImageUrl()` sonucu ve filePath filename eslesmesiyle kabul edilir.
- File path yalniz guvenli project-relative ImageStorage kokundeki tek-dosya yoludur; traversal, absolute/drive, UNC, root-relative, backslash, alt klasor ve storage disi path reddedilir.
- Gecerli OpenAI base64/storage yolu gercek `OpenAIImageProvider` ve `ImageStorage` uzerinden file write, asset registry ve batch success ile dogrulandi.
- Mock result exact provider `mock`, dogru sceneId, `image/mock`, `filePath: ""`, `url: ""` ve gecerli createdAt invariant'lariyla runtime'da dogrulanir. Malformed ve getter exception ureten sonuclar safe failed asset/stage failure uretir.
- Raw provider error, secret, stack, unsafe locator veya hassas path persistence/loglara sizmaz.
- Kismi uretim append-only kalir; production rollback/cleanup eklenmez. Batch ve stage failed olur.
- Gercek runner failure yolunda failed job, failed manifest, failed history, downstream animation enqueue engeli ve completed persistence engeli dogrulandi.
- Yeni runner, lifecycle, initializer, composition root veya paralel execution graph eklenmedi; Sprint 109-112 davranislari korundu.
- Sprint 113 smoke 54/54; pipeline orchestration 10/10; durable execution 17/17; durable wiring 19/19; runtime health API 24/24; runtime status 15/15; worker lifecycle 16/16; runtime startup 11/11 PASS.
- TypeScript, hedefli ESLint ve `git diff --check` PASS; fixture cleanup temiz.
- Takip: wrong-slug ve filePath-URL filename mismatch negatif smoke'lari eklenebilir; full scheduled-runner completed-persistence call engeli ve gercek durable terminal persistence daha guclu ayrica dogrulanabilir; ayni scene icin tekrarli basarili calismalarda current/version selection politikasi belirlenmelidir.
- Commit veya push yapilmadi.

---

# Sprint 114

## Production Narration Audio Pipeline Activation

Completed

- `AUDIO_PROVIDER` tanimsiz/bos durumda mock-first default kullanir; `mock` `MockAudioProvider`, `openai` `OpenAIAudioProvider` secer ve bilinmeyen deger safe configuration error ile fail-closed kapanir. Provider resolution import sirasinda ag veya generation baslatmaz.
- `OPENAI_TTS_MODEL` server-side config'ten okunur; default `tts-1` korunur. Whitespace-only API key fetch oncesinde reddedilir.
- OpenAI request'leri bagimsiz AbortController kullanir. Timeout default 60000 ms, response limiti default 64 MiB'dir. Content-Length preflight ve headersiz chunk-by-chunk bounded read uygulanir; oversize/never-ending stream iptal edilir, null/empty/truncated body reddedilir.
- Audio stage mevcut plan -> tum section/mix asset generation -> `saveAudio` -> stage success sirasina baglandi. Section `sceneId = chapterId`, mix `audio.outputAssetId` sozlesmeleri korundu.
- Batch preflight bos section listesi, non-positive/non-safe/duplicate chapterId ve bos narration'i provider cagrisindan once reddeder. Provider/target/chapter mismatch, malformed object ve getter exception fail-closed kapanir.
- Gercek success yalniz `audio/wav`, guvenli project-relative storage path, exact `/api/assets/audio/{slug}/{fileName}` URL, gercek byteLength ve positive finite duration ile kabul edilir; storage readback metadata'si provider sonucuyla eslesmelidir.
- WAV parser RIFF/WAVE, tam birer fmt/non-empty data chunk, size/bounds, audio format alanlari ve bounded duration validation uygular. Duplicate fmt/data ve truncated chunk reddedilir; ancillary chunk ve odd padding korunur.
- Audio route yalniz guvenli `.wav` dosyalarini `audio/wav` ile sunar; traversal, absolute/drive, UNC, root-relative, backslash ve storage disi path'ler guvenli 404 ile reddedilir.
- Mock exact `audio/mock`, bos locator ve zero byte/duration sentinel contract'ini korur.
- Storage, registry ve stage persistence failure'lari normalize edilir; raw provider/fetch/filesystem error, narration, secret, stack veya hassas path asset/job/manifest/history/durable/log alanlarina sizmaz.
- Kismi production append-only kalir; rollback/orphan cleanup eklenmez. Failure stage/job/manifest/history'yi failed yapar; assembly enqueue, audio success persistence ve completed persistence engellenir.
- Gercek durable production adapter yolunda versioned failed attempt ve terminal journal event storage'dan yeniden okundu. Yeni runner, lifecycle, composition root veya execution graph eklenmedi; Sprint 109-113 davranislari korundu.
- Audio wiring 74/74; visual wiring 54/54; orchestration 10/10; durable execution 17/17; durable wiring 19/19; health API 24/24; runtime status 15/15; worker lifecycle 16/16; startup 11/11 PASS. TypeScript, hedefli ESLint ve `git diff --check` PASS; `fixture_count=0`.
- Takip: exact-limit success ve ayri Content-Length/null/empty smoke'lari; durable filesystem-failure matrisi ve terminal payload assertion'i; audio-specific asset discriminated type; AudioPipeline/smoke validator-helper ayrismasi ileride ele alinabilir.
- Commit veya push yapilmadi.

---

# Sprint 115

## Production Video Assembly Activation

Completed

- `FFmpegVideoAssemblyProvider` ve `VideoAssemblyManager` mevcut assembly stage'e entegre edildi; mock-first plan davranisi ve mevcut pipeline mimarisi korundu.
- Assembly plan ile secilen `audioAssetId`, canonical scene/visual/audio kimlik setleri, section audio asset'leri ve project-level mix asset render oncesinde registry ve storage readback verileriyle dogrulanir.
- Image/audio/video storage path security; canonical project-relative locator, realpath containment, symlink/junction reddi, storage-root containment ve structural file validation kontrolleriyle fail-closed calisir.
- FFmpeg temporary output -> MP4/FFprobe validation -> atomic final rename -> generated video asset registry persistence sirasi uygulandi. Video asset route yalniz dogrulanmis `.mp4` dosyalarini guvenli 404 siniriyla sunar.
- Process runner bounded stdout/stderr, timeout, two-phase kill, forced settlement, listener/timer cleanup ve late-error absorption uygular; raw process/filesystem detaylari public veya durable kayitlara sizmaz.
- Runner/provider/storage/registry/persistence failure'lari stage failure'a propagate olur; assembly success persistence, downstream enqueue ve project completion engellenir.
- Sprint 115 smoke 46/46; Sprint 114 audio 74/74; Sprint 113 visual 54/54; orchestration 10/10; durable execution 17/17; durable wiring 19/19 PASS.
- Runtime health API 24/24, runtime status 15/15, worker lifecycle 16/16 ve runtime startup 11/11 PASS. TypeScript, hedefli ESLint ve `git diff --check` PASS.
- `tsx` yerel dev dependency olarak eklendi; `package.json` ve `package-lock.json` guncellendi. LF -> CRLF Git uyarilari non-blocking olarak kaydedildi.
- Final review P0-P3 bulgusuz tamamlandi. Commit veya push yapilmadi.

---

# Sprint 116

## Animation Motion Plan Production Contract

Completed

- Merkezi pipeline sirasi `research -> script -> scenes -> visuals -> animation -> video -> audio -> assembly`, recovery graph, video/assembly davranisi ve continuation wiring degistirilmedi.
- Animation stage fiziksel medya render etmez; scene-level motion-plan artifact uretir. `schemaVersion: "2"`, `artifactType: "motion-plan"` ve registry MIME `application/vnd.atolye.motion-plan+json` contract'i uygulanir; filePath/url yazilmaz.
- `sourceImageAssetId` ayni scene'in dogrulanmis visual asset kimliginden gelir ve provider inputu, animation.json ve registry source baglantisinda korunur. Visual retry history'sinde registry append sirasindaki son generated image deterministik secilir.
- `animationAssetId` ile `outputAssetId` aynidir. Duration, supported motion/transition, start/end crop containment, scale, translation ve tum numeric alanlar finite/range validation'dan gecer.
- Deterministik `MockAnimationProvider`, mock-first provider config/router ve executor provider injection eklendi; bilinmeyen provider fail-closed, generation mode merkezi karardir.
- Merkezi validator legacy, mixed ve full-v2 kayitlari ayirir. Kismi/bozuk v2 marker veya scene verisi legacy fallback olmadan reddedilir. Merge, animation/video API, service ve pipeline state loading ortak guard kullanir.
- Provider sonuclari batch registry write oncesinde tamamen dogrulanir. Herhangi bir malformed/missing/mismatched sonuc partial batch persistence'i engeller.
- Animation failure video stage enqueue etmez; completed-stage replay write-free/idempotent kalir. Job, manifest, history, retry, recovery ve durable execution sozlesmeleri korunur.
- Final review'de iki P1 giderildi: visual retry coklu image preflight blokaji son appended generated image secimiyle; bozuk v2'nin legacy kabul edilmesi merkezi derin validator ile cozuldu. Acik P0/P1 yoktur.
- Non-blocking P2 takip: registry -> animation.json/manifest -> job/history cok-dosyali yazim tam transaction degildir; registry sonrasinda orphan motion-plan kalabilir ve job list/history arasinda mevcut transaction siniri vardir. Sprint 116'ya ozgu olmayan bu konular yanlis downstream yurutme uretmez ve ileriki mimari hardening kapsamindadir.
- Sprint 116 motion plan 21; Sprint 115 video assembly 46; Sprint 114 audio 74; Sprint 113 visuals 54; pipeline orchestration 10; auto-continuation 18; durable execution 17; durable wiring 19 PASS.
- Runtime startup 11/11, worker lifecycle 16/16, runtime status 15/15, runtime health 24/24 PASS. TypeScript PASS; hedefli ESLint PASS (0 warning); `git diff --check` PASS. LF -> CRLF uyarilari non-blocking'dir.
- Dokumantasyon kapanisi tamamlandi; commit veya push yapilmadi.

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
