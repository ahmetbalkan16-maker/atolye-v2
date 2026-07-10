---
Document: ATOLYE_CHECKPOINT.md
Version: 1.0.0
Status: Active
Priority: Critical
Owner: Atölye V2
Last Updated: 2026-07-11
---

# ⚠️ AI START HERE

# Atölye V2 — Project Checkpoint

Bu belge Atölye V2 projesinin resmi geliştirme checkpoint dosyasıdır.

Her yeni AI oturumunda okunacak ilk belge budur.

Bu belge okunduktan sonra aşağıdaki belgeler sırasıyla okunmalıdır:

1. PROJECT_PHILOSOPHY.md
2. VISION.md
3. ATOLYE_AI_RULES.md
4. ATOLYE_CONTEXT.md
5. ROADMAP.md
6. ATOLYE_MASTER_ROADMAP.md
7. ARCHITECTURE_DECISIONS.md
8. CHANGELOG.md
9. AI_MEMORY.md

---

# 📌 Dashboard

## Proje

**Atölye V2**

Türkçe öncelikli AI destekli kişisel içerik üretim stüdyosu.

---

## Mevcut Faz

**Phase 2 — Production Engine**

---

## Aktif Sprint

**Sprint 87**

Retry State-Load Preflight Hardening

**Durum**

Completed

Sprint 87 tamamlandi.

- Read-only job lookup, dependency planı ve state-load preflight queued mutation oncesinde tamamlanir.
- State yuklenemezse HTTP 409, blocked: true ve "Project could not be read." sonucu doner; prepareJobRetry cagrilmaz.
- Seed edilmemis job storage icin read-only lookup manifestten seed etmez ve dosya yazmaz.
- Ready durumda mevcut seed/preparation -> scheduler/atomik claim -> execution akisi korunur.
- Basarili retry HTTP 200; cancel/conflict HTTP 409 ve Sprint 85 execution-failure HTTP 500 sozlesmesi korunur.
- Job ID -> stage turetmesi tam slug prefix'i ve pipeline stage whitelist'i ile sinirlandirildi.
- TypeScript, hedefli smoke ve npm run build dogrulamalari basarili.

Not:

- State ile execution arasindaki mevcut eszamanli manuel-save penceresi daha uzundur.
- Scheduler sonrasinda queued kalma riski ayri bir takip isidir.
- JSON filesystem persistence transaction veya mutlak dosya atomikligi saglamaz.

---

## Git Durumu

Branch

main

Son Commit

7afa3c8ed2d4b40ad39127ceaa6a5560ad6da81e

Durum

✅ GitHub ile senkron

---

# ✅ Tamamlanan Büyük Modüller

## Foundation

- AI Router
- Provider Architecture
- Project Manager
- Manifest System
- Asset Pipeline
- Progress System

---

## Content Pipeline

- Research Engine
- Script Engine
- Scene Engine
- Visual Engine
- Animation Engine
- Video Engine
- Audio Engine
- Assembly Engine

Mevcut pipeline sırası:

Research → Script → Scenes → Visuals → Animation → Video → Audio → Assembly → Thumbnail → SEO → YouTube → Export

Canonical vizyon akisi: Tek konu -> Research -> Script -> Scene Planning -> Visual Production -> Animation -> Audio -> Video Editing -> Thumbnail -> SEO -> Publishing

---

## Animation

- Animation Prompt Builder
- Animation Prompt Generator
- Animation API
- Animation Service
- Animation UI
- Animation Manifest Stage

---

## Studio

- Dashboard
- Project Workspace
- Asset Gallery
- Pipeline Status

---

# 📅 Son Tamamlanan Sprintler

## Sprint 40

Animation Manifest Stage

✅ Tamamlandı

---

## Sprint 41

Animation Scene-Level Regeneration

✅ Tamamlandı

---

## Sprint 42

Video Engine Foundation

✅ Tamamlandı

---

## Sprint 43

Audio Engine Foundation

✅ Tamamlandı

---

## Sprint 44

Assembly Engine Foundation

✅ Tamamlandı

---

## Sprint 45

Thumbnail Engine Foundation

✅ Tamamlandı

---

## Sprint 46

YouTube Engine Foundation

✅ Tamamlandı

---

## Sprint 47

Export Engine Foundation

✅ Tamamlandı

---

## Sprint 48

Final Pipeline Integration

Completed

---

## Sprint 49

Real AI Provider Integration Guardrails

Completed

---

## Sprint 50

AI Reliability & Observability Foundation

Completed

---

## Sprint 51

Usage Viewer / AI Diagnostics Panel

Completed

---

## Sprint 52

AI Usage Diagnostics Summary

Completed

---

## Sprint 53

AI Usage Filters & Diagnostics Search

Completed

---

## Sprint 54

Pipeline Retry & Resume Planning Foundation

Completed

---

## Sprint 55

Pipeline Resume Execution Foundation

Completed

---

## Sprint 56

Pipeline Resume API Foundation

Completed

---

## Sprint 57

Pipeline Resume Studio Action

Completed

---

## Sprint 58

Pipeline Retry Execution Foundation

Completed

---

## Sprint 59

Pipeline Retry API Foundation

Completed

---

## Sprint 60

Pipeline Retry Studio Action

Completed

---

## Sprint 61

Pipeline Recovery UX Hardening

Completed

---

## Sprint 62

Pipeline Recovery Diagnostics Polish


---

## Sprint 63

Pipeline Recovery Diagnostics Data Wiring


---

## Sprint 64

Pipeline Queue / Job Management Foundation

Completed
Completed
Completed

---

## Sprint 65

Pipeline Queue Execution Wiring

Completed

---

## Sprint 66

Pipeline Queue Scheduler

Completed

---

## Sprint 67

Pipeline Queue UI Controls Hardening

Completed

---

## Sprint 39

Pipeline Status Panel

✅ Tamamlandı

---

## Sprint 38

Animation Asset UI Separation

✅ Tamamlandı

---

# Sprint 45
## Thumbnail Engine Foundation

Durum:
✅ Tamamlandı

İçerik:
- Thumbnail type sistemi oluşturuldu.
- Thumbnail provider mimarisi eklendi.
- MockThumbnailProvider oluşturuldu.
- ThumbnailProviderRouter oluşturuldu.
- ThumbnailEngine oluşturuldu.
- Thumbnail config yapısı eklendi.
- POST /api/thumbnails endpoint oluşturuldu.
- ProjectManager üzerinden thumbnail.json kayıt desteği bağlandı.

Yeni dosyalar:

app/api/thumbnails/route.ts

src/lib/thumbnail/
- ThumbnailEngine.ts
- ThumbnailProviderConfig.ts
- ThumbnailProviderRouter.ts
- providers/ThumbnailProvider.ts
- providers/MockThumbnailProvider.ts

Güncellenen dosyalar:

src/types/thumbnail.ts
src/lib/thumbnail/ThumbnailManager.ts

Mimari kararlar:
- Mock-first yaklaşımı korundu.
- Gerçek görsel üretimi yapılmadı.
- Provider mimarisi ileride farklı AI servisleri eklenebilecek şekilde hazırlandı.
- Mevcut thumbnail sistemi bozulmadan yeni engine katmanı eklendi.

Test:
npx tsc --noEmit --incremental false

Sonuç:
Başarılı.

---

# Sprint 46
## YouTube Engine Foundation

Durum:
✅ Tamamlandı

Yapılanlar:
- YouTube type sistemi oluşturuldu.
- YouTube provider mimarisi kuruldu.
- MockYouTubeProvider eklendi.
- YouTubeEngine oluşturuldu.
- POST /api/youtube endpoint eklendi.
- youtube.json ProjectManager desteği eklendi.
- Manifest ve progress sistemine youtube aşaması bağlandı.

Yeni dosyalar:
src/types/youtube.ts

src/lib/youtube/
- YouTubeEngine.ts
- YouTubeProviderConfig.ts
- YouTubeProviderRouter.ts
- providers/YouTubeProvider.ts
- providers/MockYouTubeProvider.ts

app/api/youtube/route.ts

Güncellenen:
src/types/project.ts
src/lib/projects/ProjectManager.ts
src/lib/projects/projectProgress.ts
app/project/[slug]/page.tsx

Mimari:
- Mock-first yaklaşım korundu.
- Gerçek YouTube API/OAuth/upload yapılmadı.
- Thumbnail Engine provider modeli tekrar kullanıldı.

Test:
npx tsc --noEmit --incremental false

Sonuç:
Başarılı.

---

# Sprint 47
## Export Engine Foundation

Durum:
✅ Tamamlandı

İçerik:

- Export type sistemi oluşturuldu.
- Export provider mimarisi eklendi.
- MockExportProvider oluşturuldu.
- ExportProviderRouter oluşturuldu.
- ExportEngine oluşturuldu.
- POST /api/export endpoint oluşturuldu.
- export.json ProjectManager desteği eklendi.
- Manifest ve progress sistemine export aşaması bağlandı.

Yeni dosyalar:

src/types/export.ts

src/lib/export/
- ExportEngine.ts
- ExportProviderConfig.ts
- ExportProviderRouter.ts
- providers/ExportProvider.ts
- providers/MockExportProvider.ts

app/api/export/route.ts

Güncellenen dosyalar:

src/types/project.ts
src/lib/projects/ProjectManager.ts
src/lib/projects/projectProgress.ts
app/project/[slug]/page.tsx

Mimari kararlar:

- Mock-first yaklaşımı korundu.
- Gerçek zip/folder üretimi yapılmadı.
- Render veya upload yapılmadı.
- Export katmanı metadata/package planı olarak tasarlandı.
- Engine/provider/router mimarisi korundu.

Test:

npx tsc --noEmit --incremental false

Sonuç:
Başarılı.

---

# Sprint 48
## Final Pipeline Integration

Durum:
Completed

İçerik:

- Final Pipeline Integration tamamlandı.
- PipelineRunner uçtan uca orchestrator haline getirildi.
- Research → Script → Scenes → Visuals → Animation → Video → Audio → Assembly → Thumbnail → SEO → YouTube → Export akışı bağlandı.
- Manifest/progress entegrasyonu tamamlandı.
- Kontrollü hata yönetimi ve stage bazlı orchestration eklendi.
- Mock-first yaklaşımı korundu.

Test:
npx.cmd tsc --noEmit --incremental false

Sonuç:
Başarılı.

---

# Sprint 50
## AI Reliability & Observability Foundation

Durum:
Completed

İçerik:

- AI çağrı metadata kaydı eklendi.
- data/projects/{slug}/ai-usage.json append-only usage dosyası oluşturuldu.
- Provider, model, süre, fallback, hata ve prompt/response boyutu metadata olarak kaydedilir hale getirildi.
- Prompt ve response içeriği kaydedilmeden observability temeli kuruldu.
- PipelineRunner ilgili AI manager çağrılarına projectSlug/stage context aktarmaya başladı.
- Mock-first yaklaşımı korundu.

Test:
npx.cmd tsc --noEmit --incremental false

Sonuç:
Başarılı.

---

# Bir Sonraki Gorev

# Sprint 73
## Production Engine Smoke Validation

Amac:

Son hardening sprintlerinden sonra Production Engine yuzeylerinde kucuk, bagimsiz manual smoke validation yapmak.

Kapsam:

- Project workspace production surfaces
- Pipeline status / queue / jobs gorunumu
- AssetGallery preview ve asset reload davranisi
- Recent lint hardening sonrasi UI regresyon kontrolu

Plan:

- Production Engine Smoke Validation tamamlandi.
- Structured research rendering compatibility duzeltildi.
- timeline, characters ve keyEvents hem legacy string hem structured object verilerini guvenli render ediyor.
- TypeScript validation passed.
- Smoke validation basarili.
- Production Engine pipeline davranisi dogrulandi.

---

# Sprint 74
## Pipeline Queue UX Hardening

Amac:

Pipeline Queue / Jobs panelinde kalan UI state ve action feedback edge case'lerini kucuk kapsamda guvenli hale getirmek.

Plan:

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

Amac:

Pipeline Queue / Jobs panelinin refresh guvenilirligini API contract degistirmeden iyilestirmek.

Plan:

- 5-second polling only while queued/running jobs exist.
- Polling stops when active jobs finish.
- Silent refresh on window focus and tab visibility return.
- Overlapping refresh requests prevented.
- Stale project request results prevented from updating new project state.
- Background refresh preserves the current loading/empty UI.
- API contracts and existing action behavior unchanged.
- npx tsc --noEmit passed.

---

# Sprint 78
## Pipeline History API Foundation

Amac:

Mevcut pipeline-history.json execution history verisini guvenli bir read API uzerinden acmak.

Plan:

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

Amac:

Pipeline execution history verisini Studio icinde read-only bir UI bolumu olarak gorunur hale getirmek.

Plan:

- Execution history UI PipelineJobsPanel icine eklendi.
- Existing GET /api/projects/[slug]/pipeline/history endpoint'i tuketildi.
- Loading, empty ve error state'leri eklendi.
- History refresh active job polling ile senkronize edildi.
- Basarili retry/cancel job action'lari history refresh'i guvenilir sekilde tetikliyor.
- Existing job action davranislari ve API contracts korundu.
- PipelineJobManager unchanged.
- npx tsc --noEmit passed.

---

# Sprint 80
## Pipeline Execution Timeline Foundation

Amac:

Existing execution history verisini timeline-style bir gorunumle daha okunabilir hale getirmek.

Plan:

- PipelineJobsPanel history section timeline-style viewer haline getirildi.
- History events timestamp'e gore siralaniyor.
- Event time bilgisi net gosteriliyor.
- completed, failed ve cancelled status visualization eklendi.
- Existing loading, empty ve error state'leri korundu.
- Existing job actions ve API contracts preserved.
- PipelineJobManager unchanged.
- npx tsc --noEmit passed.

---

# Sprint 83
## Pipeline Job State Consistency

Durum:
Completed

Kapsam:

- Job transition modeli: queued -> running/cancelled, running -> completed/failed/cancelled, failed/cancelled -> queued.
- completed terminal state olarak korunur.
- cancelRequestedAt cancel istegini kaydeder; retry attempt'i artirir ve bu bilgiyi temizler.
- startStage, persistStageSuccess, persistStageFailure ve persistProjectCompletion proje bazli async lock kullanir.
- PipelineStageExecutor persistence coordinator uzerinden output/manifest/job sonucunu yazar.
- Cancelled execution stage output, manifest completed/failed ve proje completed durumunu persist edemez.
- Scheduler cancelled job durumunu manifest durumundan daha otoriter kabul eder.
- Cancellation stop reason runner ve /api/pipeline seviyesine tasinir.
- Manuel API save yollari job state'i degistirmez ve cancelled queue yeniden baslatilmaz.
- TypeScript validation, final review ve runtime smoke testleri basarili; fixture/harness temizlendi.

Kalan riskler:

- Lock process-localdir; filesystem yazimlari transaction degildir.
- Paralel manuel save/pipeline execution icin ileride revision/transaction tabanli iyilestirme gerekebilir.
- Cancel uzun suren AI/asset uretimini fiziksel olarak durdurmaz.

---

# Sprint 84
## Retry Execution Integration

Durum:
Completed

Kapsam:

- PipelineRunner.executeJobRetry tek retry execution entrypoint'i olarak eklendi.
- failed/cancelled -> queued hazirligi lock altinda yapilir; attempt artar ve cancelRequestedAt temizlenir.
- queued -> running claim'i atomiktir; paralel retry cagrilarindan yalnizca biri execution baslatir, digeri conflict alir.
- Retry hedefi job.stage alanindan alinir ve dependency readiness kontrolunden sonra yalnizca hedef stage calisir.
- Downstream stage'ler otomatik baslamaz.
- /pipeline/retry ve job action retry ayni runner akisinda birlestirildi.
- UI retry sonucunu queued yerine gercek execution completed/blocked durumu olarak gosterir.
- TypeScript validation, tum runtime smoke testleri ve final code review basarili.

Kalan riskler:

- Dependency blocked retry job'i queued durumda kalir; ileride explicit blocked state gerekebilir.
- Stage execution error durumunda route genel 500 response doner; ileride yapilandirilmis execution result response eklenmeli.

---

# Sprint 85
## Retry Execution Failure Response Hardening

Durum:
Completed

Kapsam:

- Stage execution exception runner icinde yapilandirilmis retry sonucuna cevrildi.
- Execution failure iki retry endpoint'inde HTTP 500, success: false, blocked: false, error: "Pipeline retry execution failed." ve result.status: 500 ile ortak sozlesmeye baglandi.
- Basarili retry HTTP 200; dependency-blocked ve conflict akislari HTTP 409 olarak korundu.
- Job endpoint'i jobs ve execution alanlarini geriye uyumlu olarak korudu.
- Provider/stage exception ayrintilari istemciye sizdirilmaz; gercek hata sunucu logu ve failure persistence akisinda kalir.
- TypeScript, hedefli smoke ve npm run build basarili.

Kalan riskler:

- Lock process-localdir ve filesystem persistence transaction degildir.
- Sunucu log erisimi guvenli tutulmalidir.

---

# Sprint 86
## Retry Dependency Preflight Hardening

Durum:
Completed

Kapsam:

- Dependency retry plani herhangi bir job mutation'indan once olusturuldu.
- Dependency blocked durumda HTTP 409 ve blocked: true doner; prepareJobRetry cagrilmaz.
- Blocked job icin status, attempts, cancelRequestedAt ve tum zaman alanlari degismez.
- Ready durumda preflight -> prepareJobRetry -> scheduler/atomik claim -> execution akisi korundu.
- Basarili retry HTTP 200; cancel, conflict ve manifest/job tutarsizligi HTTP 409 olarak korundu.
- Sprint 85 execution-failure HTTP 500 sozlesmesi aynen korundu.
- Review sirasinda gereksiz ikinci dependency plan hesaplamasi kaldirildi.
- TypeScript, hedefli smoke ve npm run build basarili.

Kalan riskler:

- Planlama ile preparation arasinda kisa bir race window vardir.
- Lock process-localdir ve filesystem persistence transaction degildir.
- Dependency disi scheduler/state-load bloklarinda queued kalma riski ayri bir gelecek istir.

---

# Sprint 87
## Retry State-Load Preflight Hardening

Durum:
Completed

Kapsam:

- Read-only job lookup -> dependency preflight -> state-load preflight -> prepareJobRetry -> scheduler/atomik claim -> execution sirasi kuruldu.
- State yuklenemezse HTTP 409, blocked: true ve "Project could not be read." sonucu doner; prepareJobRetry cagrilmaz.
- Bu durumda job status, attempts, cancellation ve zaman alanlari degismez.
- Seed edilmemis job storage icin getJobReadOnly ve getJobForStageReadOnly eklendi; mevcut pipeline-jobs.json okunur, manifestten seed edilmez ve dosya yazilmaz.
- Storage'da bulunmayan gecerli retry job ID'si icin stage, tam proje slug prefix'i ve pipeline stage whitelist'i ile guvenli bicimde turetilir.
- State basariyla yuklendikten sonra mevcut seed/preparation, scheduler/atomik claim ve execution davranisi korunur.
- Basarili retry HTTP 200, cancel/conflict HTTP 409 ve Sprint 85 execution-failure HTTP 500 sozlesmeleri degismedi.
- Yeni job state'i, API alani, UI davranisi veya persistence mimarisi eklenmedi.
- TypeScript, hedefli smoke ve npm run build basarili; Turbopack dinamik dosya izleme uyarisi build'i engellemedi.

Review sonucu:

- Bloklayici bulgu yok.
- Read-only lookup, dependency planı ve state-load tamamlanana kadar write-capable yol calismaz.
- Normal seed eden lookup davranislari degistirilmedi.

Kalan riskler / takip isleri:

- State'in preparation ve scheduler oncesinde okunmasi, state ile execution arasindaki mevcut eszamanli manuel-save penceresini uzatir.
- Scheduler sonrasinda queued kalma riski bu sprintin disindadir.
- JSON filesystem persistence icin transaction veya mutlak dosya atomikligi eklenmedi.

---

# Sprint 81
## Pipeline Intelligence Foundation

Amac:

Pipeline history ve jobs state'lerinden client-side derived intelligence uretmek.

Plan:

- Client-side Pipeline Intelligence eklendi.
- History ve jobs verilerinden derived metrikler uretildi.
- Success Rate, Failures, Average Duration, Last Event ve Queue Health gosteriliyor.
- Intelligence paneli history bos olsa bile render ediliyor.
- API, PipelineJobManager ve contract degismedi.
- TypeScript ve smoke test basarili gecti.

---

# Sprint 77
## Pipeline Execution History Foundation

Amac:

Pipeline job terminal lifecycle event'lerini pipeline-jobs.json davranisini koruyarak ayri history storage katmanina kaydetmek.

Plan:

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

# Sprint 76
## Pipeline Observability UI Layer

Amac:

Pipeline Queue / Jobs panelinde mevcut PipelineJob metadata'sini API contract degistirmeden daha gorunur hale getirmek.

Plan:

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

# ⚠️ Bilinen Riskler

- Sprint 45 başlamadan önce assembly çıktıları örnek projede doğrulanmalı.
- Assembly gerçek render üretmemeli; yalnızca render planı hazırlamalı.
- Video/audio/animation aktif asset referansları korunmalı.
- Sprint 83 lock'u yalnizca process-localdir.
- Dosya yazimlari gercek transaction degildir.
- Ayni proje icin paralel manuel save ve pipeline execution gelecekte revision/transaction tabanli olarak sertlestirilmeli.
- Cancel uzun suren AI/asset uretimini durdurmaz; sonucu persist etmeyi engeller.

---

# 📚 Dokümantasyon

| Belge | Amaç |
|--------|------|
| README.md | Proje tanıtımı |
| PROJECT_PHILOSOPHY.md | Projenin varlik nedeni |
| VISION.md | Nihai urun vizyonu |
| ATOLYE_AI_RULES.md | AI geliştirme kuralları |
| ATOLYE_CONTEXT.md | Proje vizyonu |
| ROADMAP.md | Yakın dönem plan |
| ATOLYE_MASTER_ROADMAP.md | Uzun vadeli strateji |
| ARCHITECTURE_DECISIONS.md | Mimari kararlar |
| CHANGELOG.md | Kilometre taşları |
| AI_MEMORY.md | AI tecrübeleri |

---

# 🤖 AI Başlangıç Talimatı

Her yeni AI oturumu aşağıdaki adımları takip etmelidir.

1. Bu belgeyi oku.
2. AI Rules dosyasını oku.
3. Aktif sprinti doğrula.
4. Aktif sprinti dogrula.
5. Tamamlanan sprintleri tekrar yapma.
6. Kod yazmadan önce mevcut mimariyi incele.

---

# 🔄 Güncelleme Kuralları

Her sprint sonunda yalnızca aşağıdaki alanlar güncellenir.

- Aktif Sprint
- Son Commit
- Son Tamamlanan Sprint
- Bir Sonraki Görev
- Bilinen Riskler
- Last Updated

Bu belge mümkün olduğunca kısa tutulmalıdır.

Detaylı bilgiler ilgili dokümantasyon dosyalarında bulunmalıdır.
