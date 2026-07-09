---
Document: ROADMAP.md
Version: 1.0.0
Status: Active
Priority: High
Owner: AtÃ¶lye V2
Last Updated: 2026-07-09
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

Sprint 63

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

Planlanan

- Usage metadata kaynaklarinin manifest ile daha tutarli baglanmasi
- Stage timing alanlarinin uretim akisi boyunca dogrulanmasi
- existing unrelated lint issues temizligi icin ayri sprint planlama

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

