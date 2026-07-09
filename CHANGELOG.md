---
Document: CHANGELOG.md
Version: 1.0.0
Status: Active
Priority: Medium
Owner: AtÃ¶lye V2
Last Updated: 2026-07-09
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
