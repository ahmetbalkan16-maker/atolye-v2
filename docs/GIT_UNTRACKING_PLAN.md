# Controlled Runtime Git Untracking — Plan (C.2B.12)

**Status: PLAN / REPORT ONLY. No file is untracked by this document.**
Master Sprint §9. Real untracking happens in its own sprint, after
`docs/RUNTIME_AUTHORITY_GENERATION_BINDING.md` (C.2B.6b) and the C.2B.9–C.2B.11
relocation/quarantine work land and an external authority is verified.

## Tracked inventory under `data/projects/` (this checkout)

`git ls-files 'data/projects/**'` → **~230 files** across 12 paths.

| Path | Files | Class | Disposition |
|---|---:|---|---|
| `*.json` at `data/projects/` root (`662c4e84-…`, `dcad5e66-…`, `atillanin-yukselisi.json`, `atıllanın-yükselişi.json`, `hunlar.json`, `hunların-doğuşu.json`, `romanin-seferleri.json`) | 7 | **MILESTONE SNAPSHOT** (early research captures) | keep tracked |
| `atilla-nin-yukselisi/`, `atilla-nin-y-kselisi/`, `hunlarin-dogusu/`, `hunlarin-dogusu-attila-ya-giden-yol/` | 3–4 each | **MILESTONE SNAPSHOT** (partial — manifest/project/research, one `pipeline-jobs.json`) | keep the stage JSONs; the `pipeline-jobs.json` is **RUNTIME DATA** |
| `osmanlinin-kurulusu/` | 17 | **MILESTONE SNAPSHOT** (full stage set, no media); `pipeline-jobs.json` + `ai-usage.json` are **RUNTIME / GENERATED** | keep stage + `assets.json`; reclassify the 2 |
| `fatih-sultan-mehmet-in-i-stanbul-un-fethine-hazirlanisi-cfe77fd8-…/` | 182 | **flagship MILESTONE SNAPSHOT** | see breakdown below |
| `i-stanbul-un-fethi-1453/production-execution/superseded-duplicate-reservations/decision-…json` | 1 | **RUNTIME DATA** (stray, already noted in `.gitignore` comments) | untrack |

### `fatih-…-cfe77fd8/` (182) breakdown

| Group | Files | Class | Disposition |
|---|---:|---|---|
| stage JSONs (`research/script/scenes/visuals/animation/audio/video/assembly/thumbnail/seo/youtube/export.json`, `manifest.json`, `project.json`) | ~15 | MILESTONE SNAPSHOT | keep |
| `assets/**` manifests (`assets.json`, `assets/animations/*.json`, `atolye-animation-storage-v1`) | ~9 | GENERATED (regenerable from media + registry) | keep for the snapshot; not authoritative |
| media (`*.png` ×8, `*.mp4` ×8, `*.wav` ×7, `*.vtt`, `*.srt`) | ~25 | GENERATED (the actual rendered output — the point of the snapshot) | keep |
| `pipeline-jobs.json`, `pipeline-history.json` | 2 | RUNTIME DATA | untrack (ordinal state, not a deliverable) |
| `ai-usage.json` | 1 | GENERATED telemetry | keep or untrack (low value; decide with the operator) |
| `production-acceptance.json` | 1 | **MILESTONE MARKER** (`productionReady` gate proof) | **keep — protected** |
| `production-execution/**` (`attempts/` 48, `claims/` 22, `idempotency/` 47, `reservations/` 12) | **130** | RUNTIME DATA — durable lease/attempt/claim/idempotency ledger | **keep — protected** (ADR-016/017/018; the audit's G1/C.2B.12 concern is exactly the *order* of removing these safely) |

## Rules for the eventual untracking sprint

1. **Never assume.** Produce this exact `git ls-files` inventory again at that
   HEAD and diff it against this table before touching the index.
2. **Protected, do not untrack** without an explicit, separate decision:
   `production-execution/**`, `production-acceptance.json`, and any file the
   milestone commit `"Complete Fatih Istanbul conquest pipeline"` introduced.
   These are how a prior sprint proved `12/12 + productionReady`; losing them
   removes regression evidence.
3. **Order:** verified external authority + old-root read-only quarantine FIRST
   (C.2B.9–C.2B.11), *then* Git untracking as its own change set, *then*
   cutover. Untracking before the source is safely mirrored destroys evidence
   (audit "Git untracking sırası" decision).
4. **`git rm --cached` only** (never `rm`): files stay on disk, move to the
   external root by the operator runbook, then the index entry is dropped.
5. **One reviewed commit** listing every path removed and why, with the
   pre/post `git ls-files` counts in the body.
6. `smoke-project-storage-hygiene`'s `.gitignore` assertions and
   `scripts/lib/runtime-tracking-inventory.ts`'s admission model must be
   updated in the same commit (a `git rm --cached` + new ignore rule is exactly
   what broke three smokes in Sprint 188).

## Not in scope for that sprint

The ~590 MB / ~17 untracked project directories on local disk (mostly
`.gitignore`d slugs). Those are **USER PROJECT DATA** and move via the storage
relocation runbook (`docs/PROJECT_STORAGE.md` §6), not via Git.
