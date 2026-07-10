---
Document: CHANGELOG.md
Version: 1.0.0
Status: Active
Priority: Medium
Owner: AtÃ¶lye V2
Last Updated: 2026-07-10
---

# AtÃ¶lye V2 â€” Changelog

## AmaÃ§

Bu belge AtÃ¶lye V2'nin Ã¶nemli geliÅŸtirme kilometre taÅŸlarÄ±nÄ± kronolojik olarak kayÄ±t altÄ±nda tutar.

Bu belge gelecek planlarÄ±nÄ± iÃ§ermez.

Gelecek geliÅŸtirmeler iÃ§in:

ROADMAP.md

referans alÄ±nmalÄ±dÄ±r.

---

# Version 1.x

## 2026-07

### Foundation

TamamlandÄ±

- AI Router
- Provider Architecture
- Project Manager
- Manifest System
- Asset Pipeline
- Progress System

---

### Research Engine

TamamlandÄ±

- Research API
- AI Integration
- JSON Storage
- Project Save

---

### Script Engine

TamamlandÄ±

- Script Generator
- AI Provider Integration
- Pipeline Connection

---

### Scene Engine

TamamlandÄ±

- Scene Generator
- Scene Mapping
- Scene Storage

---

### Visual Engine

TamamlandÄ±

- Visual Prompt Generator
- Asset Generation
- Provider Router

---

### Animation Engine

TamamlandÄ±

- Animation Prompt Builder
- Animation Prompt Generator
- Animation API
- Animation Service
- Animation UI
- Animation Manifest
- Animation Asset Pipeline

---

### Animation Scene-Level Regeneration

TamamlandÄ±

- Tek sahne animation regenerate akÄ±ÅŸÄ± eklendi
- animation.json merge mantÄ±ÄŸÄ± ile korunur hale getirildi
- Yeni animation asset outputAssetId ile ilgili sahneye baÄŸlandÄ±
- Animasyon kartlarÄ±nda Yeniden Ãœret aksiyonu aktif edildi

---

### Video Engine Foundation

TamamlandÄ±

- Video type modeli eklendi
- Mock video provider mimarisi kuruldu
- Video pipeline ve service katmanÄ± eklendi
- Aktif animation assetlerinden mock video Ã¼retimi eklendi
- video.json ve append-only video asset kaydÄ± eklendi
- Manifest ve progress sÄ±rasÄ±na video aÅŸamasÄ± eklendi

---

### Audio Engine Foundation

TamamlandÄ±

- Audio type modeli aktif asset alanlarÄ±yla geniÅŸletildi
- Mock audio provider mimarisi kuruldu
- Audio pipeline ve service katmanÄ± eklendi
- Mevcut audio plan Ã¼retimi korunarak mock audio asset Ã¼retimi eklendi
- audio.json ve append-only audio asset kaydÄ± eklendi
- Audio paneline minimal Ses Ãœret aksiyonu eklendi

---

### Assembly Engine Foundation

TamamlandÄ±

- Assembly modeli final production package alanlarÄ±yla geniÅŸletildi
- Video, audio ve animation aktif asset referanslarÄ± assembly.json iÃ§ine baÄŸlandÄ±
- Assembly API tÃ¼m proje Ã¼retim Ã§Ä±ktÄ±larÄ±nÄ± okuyacak ÅŸekilde geniÅŸletildi
- Kurgu paneline minimal Kurgu paketi oluÅŸtur aksiyonu eklendi
- Progress sÄ±rasÄ±nda assembly audio sonrasÄ±na taÅŸÄ±ndÄ±

---

### Final Pipeline Integration

TamamlandÄ±

- PipelineRunner tam Ã¼retim orchestrator'Ã¼ne dÃ¶nÃ¼ÅŸtÃ¼rÃ¼ldÃ¼.
- Research â†’ Export uÃ§tan uca Ã¼retim hattÄ± tamamlandÄ±.
- Stage bazlÄ± orchestration eklendi.
- Manifest ve progress senkronizasyonu gÃ¼Ã§lendirildi.
- Hata yÃ¶netimi iyileÅŸtirildi.
- Mock-first mimarisi korunarak mevcut engine'ler entegre edildi.

---

### AI Reliability & Observability Foundation

Tamamlandi

- AI cagri usage metadata modeli eklendi.
- Proje bazli append-only ai-usage.json kaydi eklendi.
- Provider, model, sure, fallback, hata ve prompt/response boyutu metadata olarak izlenebilir hale getirildi.
- Prompt ve response icerigi kaydedilmeden guvenli observability temeli kuruldu.
- Text AI manager cagrilari observed request helper uzerinden gecirildi.
- PipelineRunner AI cagrilarina projectSlug/stage context aktarmaya basladi.

---

### Usage Viewer / AI Diagnostics Panel

Tamamlandi

- AI usage kayitlari icin read-only public okuma metodu eklendi.
- GET /api/projects/[slug]/ai-usage endpoint'i eklendi.
- Proje workspace icinde AI Diagnostics paneli eklendi.
- Panel son AI usage kayitlarini stage, operation, provider, model, status, fallback, duration ve createdAt alanlariyla gosterir hale getirildi.
- PipelineRunner ve AI cagri davranisi degistirilmeden observability gorunurlugu saglandi.

---

### AI Usage Diagnostics Summary

Tamamlandi

- AI Diagnostics paneline toplam AI cagrisi, success, fallback ve failed summary kartlari eklendi.
- Ortalama sure ve son AI cagrisi zamani read-only usage kayitlarindan hesaplanir hale getirildi.
- Provider dagilimi kompakt metin olarak gosterildi.
- Mevcut son 20 kayit tablosu ve API contract korunarak UI okunabilirligi artirildi.

---

### AI Usage Filters & Diagnostics Search

Tamamlandi

- AI Diagnostics paneline stage, provider ve status filtreleri eklendi.
- Operation, stage, provider, model ve status alanlarinda basit text search eklendi.
- Summary metrikleri filtrelenmis kayitlar uzerinden hesaplanir hale getirildi.
- Mevcut son 20 kayit tablosu, API contract ve read-only davranis korundu.

---

### Pipeline Retry & Resume Planning Foundation

Tamamlandi

- Pipeline recovery plan tipleri eklendi.
- Stage order ve stage dependency map tanimlandi.
- Resume plan, ilk tamamlanmamis asamadan itibaren calisacak stage listesini uretir hale getirildi.
- Retry plan, yalnizca failed stage icin dependency readiness kontrolu yapacak sekilde planlanir hale getirildi.
- Execution, API ve UI aksiyonu eklenmeden read-only planning foundation kuruldu.

---

### Pipeline Resume Execution Foundation

Tamamlandi

- PipelineRunner icine internal resume(projectSlug) foundation eklendi.
- Resume, PipelineRecoveryPlanner planini kullanarak blocked durumda execution baslatmadan guvenli sonuc doner hale getirildi.
- Completed stage'ler tekrar calistirilmadan ilk incomplete stage'den devam akisi eklendi.
- Stage inputlari mevcut proje dosyalarindan ProjectManager read metodlariyla yuklenir hale getirildi.
- API, UI ve retry execution eklenmeden mevcut run(topic) davranisi korundu.

---

### Pipeline Resume API Foundation

Tamamlandi

- Project-scoped POST /api/projects/[slug]/pipeline/resume endpoint eklendi.
- Endpoint slug validation ve ProjectManager.getProject(slug) kontrolu yapar hale getirildi.
- Blocked resume planlari HTTP 409 ile guvenli response doner hale getirildi.
- Success response resume execution result bilgisini doner hale getirildi.
- /api/pipeline, UI ve retry endpoint eklenmeden Sprint 56 tamamlandi.

---

### Pipeline Resume Studio Action

Tamamlandi

- Project workspace icine PipelineResumeAction component'i eklendi.
- Resume aksiyonu PipelineStatus altinda ve AIUsagePanel oncesinde gosterilir hale getirildi.
- Production tamamlandiginda resume butonu gizlenir, running stage varken disabled olur hale getirildi.
- Resume API success durumunda router.refresh() ile workspace verileri yenilenir hale getirildi.
- Blocked, success ve error durumlari UI icinde kisa mesajlarla gosterilir hale getirildi.
- Retry UI, PipelineRunner ve Resume API endpoint'i degistirilmeden Sprint 57 tamamlandi.

---

### Pipeline Retry Execution Foundation

Tamamlandi

- PipelineRetryResult tipi eklendi.
- PipelineRunner.retryStage(projectSlug, stage) internal foundation olarak eklendi.
- Retry execution sadece PipelineRecoveryPlanner.createRetryPlan sonucu blocked degilse baslar hale getirildi.
- Sadece failed stage retry edilebilir; completed, pending, missing ve running stage'ler planner tarafindan blocked kalir.
- Retry yalnizca istenen tek stage'i calistirir, pipeline otomatik devam etmez.
- API, UI, downstream reset, resume(projectSlug) ve run(topic) davranislari degistirilmeden Sprint 58 tamamlandi.

---

### Pipeline Retry API Foundation

Tamamlandi

- Project-scoped POST /api/projects/[slug]/pipeline/retry endpoint eklendi.
- Request body icindeki stage alani whitelist ile validate edilir hale getirildi.
- Endpoint slug validation, body parse, project existence ve blocked retry response kontrollerini yapar hale getirildi.
- Blocked retry sonuclari HTTP 409 ile guvenli response doner hale getirildi.
- Resume endpoint, /api/pipeline route'u, UI ve retry execution davranisi degistirilmeden Sprint 59 tamamlandi.

---

### Pipeline Retry Studio Action

Tamamlandi

- PipelineStatus failed stage'lerde Retry butonu gosterir hale getirildi.
- Retry aksiyonu projectSlug ile POST /api/projects/[slug]/pipeline/retry endpoint'ine baglandi.
- Retry sirasinda ilgili stage icin button disabled olur ve "Retrying..." metni gosterilir hale getirildi.
- Retry basarili olunca router.refresh() ile pipeline gorunumu yenilenir hale getirildi.
- Hata durumunda kullaniciya basit error mesaji gosterilir hale getirildi.
- npx tsc --noEmit temiz gecti.
- npm run typecheck script'i yok.
- npm run lint existing unrelated lint issues nedeniyle bu sprint degisikliginden bagimsiz hatalara takiliyor.

---

### Pipeline Recovery UX Hardening

Tamamlandi

- PipelineStatus stage kartlari expandable hale getirildi.
- Stage details paneli eklendi.
- Stage details panelinde stage name, status, startedAt, completedAt, duration, failed error ve usage metadata optional olarak gosterilir hale getirildi.
- Retry button expand davranisiyla cakismayacak sekilde ayrildi.
- Invalid date fallback eklendi.
- Retry/running sirasinda eski completedAt ve durationMs tasinmaz hale getirildi.
- Manifest/progress tipleri optional timing ve usage metadata ile genisletildi.
- npx tsc --noEmit temiz gecti.

---

### Pipeline Recovery Diagnostics Polish

Tamamlandi

- Pipeline diagnostics details UI polish tamamlandi.
- Status badge/label gorunumu iyilestirildi.
- startedAt / completedAt daha kullanici dostu formatlandi.
- durationMs okunabilir hale getirildi.
- Error mesaji ayri, scroll guvenli blokta gosterilir hale getirildi.
- Usage metadata kompakt kutucuklarla gosterilir hale getirildi.
- Retry button ve expand davranisi korundu.
- npx tsc --noEmit temiz gecti.

---
### Pipeline Recovery Diagnostics Data Wiring

Tamamlandi

- Stage metadata standardi attempts, lastAttemptAt ve lastRunType alanlariyla gelistirildi.
- Provider bagimsiz usage mapping ai-usage kayitlarindan manifest stage usage alanina baglandi.
- Retry metadata initial/resume/retry run type ayrimi ve retry attempt sayisi ile genisletildi.
- ProjectManager ve projectProgress akisi optional metadata alanlarini tasiyacak sekilde guncellendi.
- PipelineStatus stage details icinde attempt bilgisi optional olarak gosterilir hale getirildi.
- npx tsc --noEmit temiz gecti.

---

### Pipeline Queue / Job Management Foundation

Tamamlandi

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

### Pipeline Queue Execution Wiring

Tamamlandi

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

### Pipeline Queue Scheduler

Tamamlandi

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


### Pipeline Queue UI Controls Hardening

Tamamlandi

- Pipeline Queue / Jobs panelinde loading, success, error, disabled, invalid-data ve unsupported-state feedback netlestirildi.
- Duplicate action submission prevention eklendi.
- Client-side guard'lar invalid slug, job ID, payload ve unsupported action durumlarini kapsayacak sekilde guclendirildi.
- API unsupported job state transition icin HTTP 409 doner hale getirildi.
- Mevcut response contract korundu: { success, error?, jobs? }.
- Malformed stored job kayitlari tek tek filtrelenir hale getirildi; valid queue state korunur.
- npx tsc --noEmit temiz gecti.
- Manuel browser/UI testi yapilmadi.
- Existing unrelated lint issues ve dependency advisories bu sprint kapsami disinda birakildi.

---
### Existing Lint Issues Cleanup Planning

Tamamlandi

- npm run lint mevcut durumda 7 errors ve 12 warnings ile fail ediyor.
- Toplam belirlenen lint issue sayisi: 19.
- React hook/effect state management kategorisinde 4 errors ve 1 warning kaydedildi.
- JSX unescaped entities kategorisinde 3 errors kaydedildi.
- Unused vars/imports kategorisinde 10 warnings kaydedildi.
- Next image optimization kategorisinde 1 warning kaydedildi.
- Bu lint issue'larinin Sprint 67 degisikliklerinden bagimsiz oldugu dogrulandi.
- AssetGallery.tsx ve hook cleanup daha yuksek riskli alanlar olarak kaydedildi.
- Lint'in CI/pre-commit workflow'larini bloke edebilecegi kaydedildi.
- Onerilen phased cleanup sirasi belirlendi: JSX unescaped entities, unused vars/imports, React hook cleanup, Next image optimization.
- Kaynak kod, dokumantasyon disi dosyalar, commit ve push islemleri yapilmadi.

---
### JSX Unescaped Entities Cleanup

Tamamlandi

- Kapsam yalnizca src/components/studio/AssemblyPanel.tsx ve src/components/studio/ProjectActions.tsx olarak tutuldu.
- Tum react/no-unescaped-entities error'lari giderildi.
- UI davranisi korundu.
- npx tsc --noEmit temiz gecti.
- npm run lint yalnizca scope disi kalan issue'lar nedeniyle fail ediyor.
- Kalan lint durumu kaydedildi: 16 total problems, 4 errors, 12 warnings.
- Kalan issue'lar: 4 react-hooks/set-state-in-effect errors, 10 @typescript-eslint/no-unused-vars warnings, 1 react-hooks/exhaustive-deps warning, 1 @next/next/no-img-element warning.
- Kaynak kodda Sprint 69 kapsami disinda degisiklik, commit veya push yapilmadi.

---
### Unused Vars and Imports Cleanup

Tamamlandi

- Tum 10 @typescript-eslint/no-unused-vars warning'i giderildi.
- Kapsam app/api/assembly/route.ts, src/lib/animation/providers/MockAnimationProvider.ts, src/lib/assets/providers/MockImageProvider.ts, src/lib/export/providers/MockExportProvider.ts, src/lib/video/providers/MockVideoProvider.ts, src/lib/visuals/AnimationPromptEngine.ts ve src/lib/visuals/ThumbnailConceptEngine.ts ile sinirli tutuldu.
- Mock/foundation function signature'lari korundu.
- Intentionally unused parametreler davranis degistirmeden ele alindi.
- Assembly route icindeki unused research fetch/type kaldirildi.
- npx tsc --noEmit temiz gecti.
- npm run lint artik 6 total problems rapor ediyor: 4 errors, 2 warnings.
- Kalan issue'lar: 4 react-hooks/set-state-in-effect errors, 1 react-hooks/exhaustive-deps warning, 1 @next/next/no-img-element warning.
- Kaynak kodda Sprint 70 kapsami disinda degisiklik, commit veya push yapilmadi.

---
### React Hook State and Effect Cleanup

Tamamlandi

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
- Kaynak kodda Sprint 71 kapsami disinda degisiklik, commit veya push yapilmadi.

---
### Asset Image Rendering Cleanup

Tamamlandi

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
- Kaynak kodda Sprint 72 kapsami disinda degisiklik, commit veya push yapilmadi.

---
### Documentation Vision Alignment

Tamamlandi

- PROJECT_PHILOSOPHY.md projenin varlik nedeni icin dolduruldu.
- VISION.md nihai urun pusulasi olarak konumlandirildi.
- Dokuman rolleri PROJECT_PHILOSOPHY, VISION, MASTER_ROADMAP, ROADMAP, CHECKPOINT, CHANGELOG, ADR ve AI_MEMORY icin netlestirildi.
- Kisisel AI produksiyon studyosu, Secure Remote Personal Studio ve kullanici yonetmen / Atolye produksiyon ekibi dili dokumanlarda ortak tema haline getirildi.

---

### Studio

TamamlandÄ±

- Dashboard
- Project Workspace
- Pipeline Status
- Asset Gallery

---

### Documentation

Eklendi

- README.md
- PROJECT_PHILOSOPHY.md
- VISION.md
- ATOLYE_CHECKPOINT.md
- ATOLYE_AI_RULES.md
- ATOLYE_CONTEXT.md
- ROADMAP.md
- ATOLYE_MASTER_ROADMAP.md
- ARCHITECTURE_DECISIONS.md
- CHANGELOG.md
- AI_MEMORY.md

---

# Version History

## v1.0

Ä°lk bÃ¼yÃ¼k mimari tamamlandÄ±.

Foundation katmanÄ± hazÄ±r.

Animation sistemi hazÄ±r.

Manifest sistemi hazÄ±r.

Pipeline sistemi hazÄ±r.

AtÃ¶lye artÄ±k Video Engine geliÅŸtirme aÅŸamasÄ±na geÃ§meye hazÄ±rdÄ±r.
