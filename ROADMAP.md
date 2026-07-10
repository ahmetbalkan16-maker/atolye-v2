---
Document: ROADMAP.md
Version: 1.0.0
Status: Active
Priority: High
Owner: AtÃ¶lye V2
Last Updated: 2026-07-10
---

# AtÃ¶lye V2 â€” Development Roadmap

## AmaÃ§

Bu belge Ã¶nÃ¼mÃ¼zdeki sprintlerde yapÄ±lacak teknik geliÅŸtirmeleri iÃ§erir.

Bu belge yaÅŸayan bir dokÃ¼mandÄ±r.

Sprint tamamlandÄ±kÃ§a gÃ¼ncellenmelidir.

Nihai urun vizyonu icin:

VISION.md

referans alinmalidir.

Uzun vadeli fazlar icin:

ATOLYE_MASTER_ROADMAP.md

referans alÄ±nmalÄ±dÄ±r.

---

# Mevcut Durum

Aktif Faz

Phase 2 â€” Production Engine

Aktif Sprint

Sprint 71

---

# Sprint 41

## Animation Scene-Level Regeneration

Durum

Completed

### GÃ¶revler

- Scene bazlÄ± animation regenerate
- animation.json merge
- Asset versioning koruma
- Animation active version seÃ§imi
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

- Research â†’ Export tam akÄ±ÅŸ kontrolÃ¼
- PipelineRunner uÃ§tan uca orchestrator
- Manifest/progress senkronizasyonu
- Stage bazlÄ± hata yÃ¶netimi

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

Active

- Kapsam src/components/HomeClient.tsx ve src/components/assets/AssetGallery.tsx.
- Hedef react-hooks/set-state-in-effect ve react-hooks/exhaustive-deps issue'larini gidermek.
- Mevcut UI ve async loading davranisi korunacak.
- next/image warning'i bu sprintte ele alinmayacak.

---



# Sprint Ã–ncelik KurallarÄ±

Her sprint;

- kÃ¼Ã§Ã¼k olmalÄ±
- baÄŸÄ±msÄ±z tamamlanabilmeli
- TypeScript testi geÃ§meli
- mevcut sistemi bozmamalÄ±

---

# Tamamlanma Kriteri

Bir sprint aÅŸaÄŸÄ±daki ÅŸartlar saÄŸlanÄ±nca tamamlanÄ±r.

- Kod tamamlandÄ±
- TypeScript geÃ§ti
- Rapor hazÄ±rlandÄ±
- Checkpoint gÃ¼ncellendi
- Git commit
- Git push

---

# Sonraki GÃ¼ncelleme

Sprint tamamlandÄ±ÄŸÄ±nda;

- Aktif Sprint deÄŸiÅŸtirilir.
- Tamamlanan sprint kaldÄ±rÄ±lmaz.
- Durumu "Completed" yapÄ±lÄ±r.

