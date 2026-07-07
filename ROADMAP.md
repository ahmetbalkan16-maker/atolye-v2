# Atölye V2 Roadmap

## Current Status

### Sprint 30 — Project Manifest Layer

Status: In Progress

#### Completed

- Sprint 30 Aşama 1
  - ProjectManifest types expanded.
  - Manifest creation and normalization added.
  - New projects now create manifest.json.
  - Old boolean manifests are normalized.

- Sprint 30 Aşama 2
  - ProjectManager save functions are connected to manifest status tracking.
  - Completed stages are marked automatically:
    - research
    - script
    - scenes
    - visuals
    - audio
    - thumbnail
    - seo
    - assembly

- Sprint 30 Aşama 3
  - Manifest is now the central project progress source.
  - Shared progress helper functions were added.
  - Project progress can be read without duplicating manifest logic.

- Sprint 30 Aşama 4
  - Dashboard project list can receive manifest-based progress data.
  - Progress UI is presentational and does not calculate business logic.
  - Project progress is prepared server-side through the progress utility.

#### Next

- Sprint 30 stabilization
  - Replace remaining file-presence progress reads in project detail pages with manifest progress data.
  - Resolve existing lint issues in unrelated UI files.
  - Review dashboard/project detail UX before closing Sprint 30.

---

## Master Vision

Atölye V2 is a personal AI documentary and content production studio.

Long-term goals:

- Multi AI provider architecture
- AI Director
- Historical Documentary Engine
- Dynamic map and timeline storytelling
- Mobile access
- Security layer
- YouTube workflow integration
- Personal production memory
- Future local/custom AI layer