# Atölye V2 — Project Storage

**One question, one answer: _"Projeler nereye kaydediliyor?"_**

Every project artifact — `manifest.json`, `research.json`, `script.json`,
`scenes.json`, `visuals.json`, `animation.json`, `audio.json`, `video.json`,
`assembly.json`, `thumbnail.json`, `seo.json`, `youtube.json`, `export.json`,
`ai-usage.json`, `pipeline-jobs.json`, `pipeline-history.json`,
`production-acceptance.json`, the `assets/**` media, the `export/bundle/**`
render, and the `production-execution/**` durable state — lives under **one
logical prefix**:

```
data/projects/<projectSlug>/...
```

That prefix is **logical, not physical**. Where it lands on disk is decided by
one place — the runtime storage abstraction.

---

## 1. The storage root

`src/lib/runtime/RuntimeStoragePaths.ts` resolves the logical prefix to a
physical directory:

| `ATOLYE_RUNTIME_ROOT` | Physical projects root | Classification |
|---|---|---|
| **unset** (default) | `<repo>/data/projects/` | `legacy-repository` |
| set, inside the repo | `<ATOLYE_RUNTIME_ROOT>/projects/` | `explicit-workspace` |
| set, outside the repo (e.g. `C:\AtolyeData`) | `<ATOLYE_RUNTIME_ROOT>/projects/` | `explicit-external` |

- The env var must be an **absolute**, trimmed, valid path (Windows drive or
  UNC). An invalid value fails closed with `RUNTIME_STORAGE_CONFIGURATION_INVALID`.
- With the var **unset**, behaviour is byte-for-byte the historical
  `process.cwd()/data/projects` — nothing changes for local development.
- The absolute host path is **never** written into a logical identity, an
  acceptance fingerprint, or a marker — those stay portable.

Related env vars: `ATOLYE_RUNTIME_AUTHORITY_ROOT` (machine-local coordination
state; never project data — defaults to an OS temp dir), `ATOLYE_WORKSPACE_ROOT`
(overrides `process.cwd()` for tests / embedding).

---

## 2. The single abstraction — use it, never hand-build a path

```
RuntimeStoragePaths.ts
  getProjectsRoot(ctx?)                  -> physical projects root
  getProjectRoot(slug, ctx?)             -> physical <root>/<slug>, slug-validated + contained
  resolveRuntimeStorageContext(input?)   -> a frozen RuntimeStorageContext for one operation
  resolveRuntimeLogicalPath(path, ctx?)        -> read  "data/projects/<slug>/x" -> physical
  resolveRuntimeLogicalPathForWrite(path, ctx?) -> write "data/projects/<slug>/x" -> physical (asserts authority)
  acquireProjectWriteAuthority(slug, ctx?)-> a write lease (process-local fail-closed lock)
  assertProjectWriteAuthority(slug, ctx?) -> throws unless a write is currently legitimate

ProjectReader   .getProjectsRoot / .getProjectFolder / .readJSON / .readJSONState / .listProjects
ProjectWriter   .ensureProjectFolder / .writeJSON / .writeJSONOnce / .writeJSONAtomically / .removeJSON
FileStorage     .exists / .saveJson / .saveJsonAtomically / .loadJson / .listDirs / .remove
                (routes any `data/projects/**` relative path through the resolver; other paths -> workspace)
AssetManager, ImageStorage, AudioStorage, VideoStorage, AnimationStorage, ThumbnailStorage
                (asset media — all resolve through FileStorage / the logical resolver)
```

**Rule:** a consumer either takes a `RuntimeStorageInput` / `RuntimeStorageContext`
and calls the abstraction, or it passes a `data/projects/<slug>/...` string to
`FileStorage` / `ProjectWriter` / `ProjectReader`. It **never** does
`path.join(process.cwd(), "data", "projects", …)` and writes there itself. The
guard `scripts/smoke-project-storage-hygiene.ts` fails the build if a new one
appears.

### Known exception (tracked)

**None.** As of sub-sprint **C.2B.5** every asset-serving route reads through its
storage service:

| Route | Storage service | Method |
|---|---|---|
| `app/api/assets/images/[slug]/[fileName]/route.ts` | `ImageStorage` | `readImage` — png / jpg / jpeg / webp / gif / svg, containment + link rejection, 64 MB ceiling |
| `app/api/assets/audio/[slug]/[fileName]/route.ts` | `AudioStorage` | `readStoredWav` + `inspectWav` |
| `app/api/assets/videos/[slug]/[fileName]/route.ts` | `VideoStorage` | `inspectStoredMp4` |
| `app/api/assets/thumbnails/[slug]/[fileName]/route.ts` | `ThumbnailStorage` | `readThumbnail` |

The guard's `ALLOWLIST` is now just `RuntimeStoragePaths.ts` + `FileStorage.ts`
(the abstraction) plus the `migration/` + `backup/` tooling.

---

## 3. Path security (already enforced by the abstraction)

`RuntimeStoragePaths` rejects, fail-closed with `RUNTIME_STORAGE_PATH_INVALID`
/ `RUNTIME_STORAGE_LINK_UNSAFE`:

- project slugs that are not `^[a-zA-Z0-9-_]+$`
- `..` / `.` path segments, embedded `/` or `\` in a segment, NUL / CR / LF
- absolute-path injection, root-escape (`path.relative` outside check on every join)
- symlink / junction / reparse points anywhere in the ancestor chain (`lstat` +
  `realpath` equality on each segment)
- a configured root equal to a filesystem root
- the same slug present in **both** the configured root and the legacy root →
  `RUNTIME_STORAGE_DUAL_ROOT_DIVERGENCE` (no auto-merge / copy / migration)

Behavioural coverage: `scripts/smoke-sprint-129-25b-runtime-root.ts`,
`smoke-sprint-129-25b-1-runtime-hardening.ts`,
`smoke-sprint-129-25c-2a-guarded-filesystem.ts`.

---

## 4. Local development

Nothing to configure. Leave `ATOLYE_RUNTIME_ROOT` unset and projects read/write
under `<repo>/data/projects/` exactly as before. Tests always pass an isolated
`ATOLYE_RUNTIME_ROOT` under an OS temp dir (`mkdtempSync(os.tmpdir())`) plus
`mock` providers — they never touch the repo tree or the network.

---

## 5. Git policy for `data/projects/`

Runtime project data is **local working data**, not source. The repo keeps only
deliberately-committed **milestone snapshots** (a finished documentary, added by
hand). Everything else is ignored:

- **Tracked** (220 files): `atilla-nin-yukselisi/`, `atilla-nin-y-kselisi/`,
  `hunlarin-dogusu/`, `hunlarin-dogusu-attila-ya-giden-yol/`,
  `osmanlinin-kurulusu/`, `fatih-…-cfe77fd8/` (full pipeline incl. media +
  `production-execution/`), one stray in `i-stanbul-un-fethi-1453/`, and the
  root `data/projects/*.json` research files.
- **Ignored** (`.gitignore`, by explicit slug — never a blanket
  `/data/projects/*/`): `unknown/`, `smoke/`, `rprobe/`, `diag-*/`,
  `identity-hardening/`, and ~10 in-progress / experimental / duplicate local
  pipeline runs. `**/.pipeline-jobs.lock/` (process mutex) is always ignored.
- Local disk today: ~590 MB / ~2 388 files / ~17 project directories.
- `production-execution/**` is **not** blanket-ignored — 130 records are tracked
  under the milestone projects and that is deliberate.
- To promote an ignored project later: `git add -f data/projects/<slug>/`.

New rule: never `git add` runtime project output into `data/projects/` casually.
A sprint ends with `git status --short` **empty** (`ATOLYE_AI_RULES.md` §Graphify
Sprint Protokolü).

---

## 6. Migration to an external root — status & runbook

### Status: **foundation done, cutover NOT done.**

| Piece | State | Sprint |
|---|---|---|
| `RuntimeStoragePaths` abstraction + `ATOLYE_RUNTIME_ROOT` contract | ✅ done | 129.25B |
| Targeted hardening (traversal / link / dual-root) | ✅ done | 129.25B.1 |
| Guarded filesystem primitive | ✅ done | 129.25C.2A |
| Verified runtime backup (`npm run runtime:backup:*`) | ✅ done | 129.25C.1 |
| Migration candidate schema + preflight + checksum verifier | ✅ done | 129.25C.2B.1 |
| Verified migration candidate creation | ✅ done | 129.25C.2B.2 |
| Operation-scoped context propagation | ✅ done | 129.25C.2B.4 |
| Storage relocation audit (`docs/PRODUCTION_STORAGE_RELOCATION_AUDIT.md`) | ✅ done | 129.25C.2B.3 |
| Asset-serving adapters (image route → `ImageStorage`) | ✅ done | **C.2B.5** |
| **The actual copy / cutover / Git-untracking** | ⛔ **NOT STARTED** | C.2B.6 → C.2B.12 |

The audit graded 28 entrypoint families: **11 READY, 7 REQUIRES ADAPTER, 1
REQUIRES MIGRATION, 5 REQUIRES POLICY DECISION, 4 BLOCKING**. Status of the 4
**P0 BLOCKING** items that must be closed _before_ any relocation:

1. ~~repository-local **image** API serving reads the old root directly~~ — **closed (C.2B.5)**: `ImageStorage.readImage` + `smoke-c2b5-image-serving-adapter` (12 scenarios)
2. startup-level **frozen production runtime authority** — **effectively closed by C.2B.4**
   (one frozen `processRuntimeStorageContext` + `processRuntimeOperationContext`;
   `runWithProductionRuntimeOperationContext` rejects a divergent nested context).
   See `docs/RUNTIME_AUTHORITY_GENERATION_BINDING.md` §1.
3. **durable execution adapters** cross-restart authority-generation binding —
   **closed (C.2B.6b)**: `enforceProductionRuntimeAuthorityGeneration` runs at
   the top of `initializeProductionProcessRuntime()` and read-only in the
   recovery bootstrap. A boot against a root whose marker names a different
   authority generation, or whose marker's resolver binding no longer matches
   (state + marker moved), fails closed before any recovery scan / worker start.
   `NODE_ENV=production` + unset `ATOLYE_RUNTIME_ROOT` also fails closed.
   `smoke-c2b6b-authority-generation-enforcement` (19 scenarios). The in-flight
   preparation→execution window was already bound (`ProductionPipelineExecutionFactory`).
4. ~~no **versioned / no-clobber authority transition** protocol~~ — **closed (C.2B.9)**:
   `RuntimeAuthorityTransition` + `RuntimeAuthorityTransitionCoordinator` — a
   strict forward state machine (quiesce → prepare → validate → publish →
   quarantine), a machine-local control plane under
   `<authorityRoot>/authority-transition-v1/`, CAS-guarded single active
   authority, append-once old-root quarantine, idempotent + crash-resumable.
   The startup / recovery enforcement refuses a quarantined root, a mid-transition
   source, a non-active marked root, and marker-less copied state.
   `smoke-c2b9-authority-transition` (21 scenarios). See
   `docs/RUNTIME_AUTHORITY_GENERATION_BINDING.md` §6.

**All four P0 BLOCKING items are now closed.** A real project migration is still
gated on a separate **migration readiness audit** + its own approved sprint —
`cutoverAuthorized` stays false and the runbook below is not yet executable.

Plus `REQUIRES POLICY DECISION` items (protected-root roles for
relocation-target / quarantine, portable-fingerprint semantics, Git-vs-byte
evidence split, `data/visuals` scope).

### Runbook (execute only once C.2B.5–C.2B.12 close — offline, operator-run)

```
0. Drain: no pipeline / production execution running; durable quiescence.
1. npm run runtime:backup:create   &&   npm run runtime:backup:verify
2. Create + preflight a verified migration candidate
     (src/lib/runtime/migration/RuntimeMigrationCandidateService)
     - DRY RUN  -> file count, byte count, per-file SHA-256
3. Choose an EXCLUSIVE, EMPTY external target (e.g. C:\AtolyeData).
4. Consume the candidate -> copy into <target>/projects/
5. VERIFY: file count == , bytes == , checksum == , read test, app test
     (npm run runtime:backup:restore-verify pattern + a real project open)
6. Set ATOLYE_RUNTIME_ROOT=<target> in .env.local   (operator edits this — not automated)
7. App test against the external root; confirm no write lands in <repo>/data/projects
8. Quarantine the old <repo>/data/projects as READ-ONLY (do not delete yet).
9. Separate Git-untracking sprint (C.2B.12): decide the untracking ORDER so no
   ignored-durable record is lost, then `git rm --cached` the relocated tree
   and extend `.gitignore`.
10. Only after all of the above verifies: remove the quarantined old tree.
```

Failed migration **never** deletes the source. Migration is **idempotent**. A
slug collision **never** auto-overwrites (`RUNTIME_STORAGE_DUAL_ROOT_DIVERGENCE`).

---

## 7. Backup

```
npm run runtime:backup:inventory        # what's there
npm run runtime:backup:create           # verified snapshot
npm run runtime:backup:verify           # checksum the snapshot
npm run runtime:backup:restore-verify   # prove it restores byte-identical
```

Backend: `scripts/runtime-backup.ts` + `src/lib/runtime/backup/**`. Runs against
whichever root `ATOLYE_RUNTIME_ROOT` resolves to.

---

## 8. See also

- `docs/PRODUCTION_STORAGE_RELOCATION_AUDIT.md` — the 28-entrypoint audit matrix
- `docs/Architecture.md`, `ARCHITECTURE_DECISIONS.md`
- `ATOLYE_AI_RULES.md` §Graphify Sprint Protokolü — the sprint hygiene gates
- `scripts/smoke-project-storage-hygiene.ts` — the regression guard for this doc
