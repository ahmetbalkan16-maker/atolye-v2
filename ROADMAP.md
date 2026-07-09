---
Document: ROADMAP.md
Version: 1.0.0
Status: Active
Priority: High
Owner: Atölye V2
Last Updated: 2026-07-09
---

# Atölye V2 — Development Roadmap

## Amaç

Bu belge önümüzdeki sprintlerde yapılacak teknik geliştirmeleri içerir.

Bu belge yaşayan bir dokümandır.

Sprint tamamlandıkça güncellenmelidir.

Uzun vadeli ürün vizyonu için:

ATOLYE_MASTER_ROADMAP.md

referans alınmalıdır.

---

# Mevcut Durum

Aktif Faz

Phase 2 — Production Engine

Aktif Sprint

Sprint 58

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

Planlanan

- Retry foundation scope
- Stage dependency readiness for retry
- No UI action until safe API contract is ready

---

# Sprint Öncelik Kuralları

Her sprint;

- küçük olmalı
- bağımsız tamamlanabilmeli
- TypeScript testi geçmeli
- mevcut sistemi bozmamalı

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

