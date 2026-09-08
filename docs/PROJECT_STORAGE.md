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
| Cross-restart authority-generation enforcement | ✅ done | **C.2B.6b** |
| Versioned authority transition (external→external) | ✅ done | **C.2B.9** |
| Genesis transition (repo→first external) + operator CLI + byte-exact + backup recovery | ✅ done | **C.2B.9b** |
| Migration readiness audit | 🟡 **NO-GO** (2026-09-08); re-run after C.2B.9b | — |
| **The actual 611 MB copy / cutover / Git-untracking** | ⛔ **NOT STARTED** — `cutoverAuthorized = false` | C.2B.12 + a migration sprint |

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

### Runbook — genesis migration (repo → first external root)

**Offline, operator-run. Not executable until a re-run of the migration
readiness audit returns GO and a migration sprint is explicitly authorized —
`cutoverAuthorized` stays false.** The C.2B.9b operator CLI drives the control
plane; it never copies project data (steps 4–5 do).

The **authority cutover is the `publish` step, not editing `.env.local`.** Every
step below is idempotent on `--transition-id` and resumes after a crash.

```
0.  PRECHECK
      npm run authority:status -- --authority-root <AR>      # must show NO active authority
      Stop the Next.js server (the CLI cannot force-stop a running runtime).
      Pick: <AR>  a persistent authority root (default os.tmpdir()/atolye-runtime-authority-v1;
                  keep the SAME value forever — it is the shared coordination plane)
            <T>   an EXCLUSIVE, EMPTY external target dir (e.g. D:\AtolyeData) — <T>/projects must not exist yet

1.  BACKUP
      npm run runtime:backup:create   &&   npm run runtime:backup:verify

2.  BEGIN GENESIS
      npm run authority:begin-genesis -- --authority-root <AR> --target <T> --transition-id <ID>

3.  QUIESCE  (worker down + durable-recovery clean)
      npm run authority:quiesce -- --authority-root <AR> --transition-id <ID> \
        --assert-worker-stopped --source-projects <repo>/data/projects
      → refuses if any project's production-execution/ scan is not "clean".

4.  MATERIALIZE TARGET — BYTE-EXACT (this is NOT the authority CLI's job)
      a. Create + preflight a verified migration candidate
           (RuntimeMigrationCandidateService, backup-derived) →
           <CR>/candidates/candidate-<64hex>/payload/projects/
         For an external source, preflight cleanliness with
           preflightRuntimeMigrationExternalSource (C1 — separates filesystem
           source cleanliness from repository Git cleanliness).
      b. Consume it into <T>/projects/ with the verified consume service (C.2B.10a):
           npm run runtime:migration:candidate:consume -- \
             --consume-id <CID> --candidate-id candidate-<64hex> \
             --candidate-directory <CR>/candidates/candidate-<64hex> \
             --relocation-target <T> --live-projects <repo>/data/projects \
             --backup-directory <BK>/backup-<n>
         → <T> must be EMPTY (only the service's own .migration-consume/ metadata).
         → per-file SHA-256 readback + no-clobber; symlink / junction / traversal → fail.
         → post-copy: runtimeAuthorityProjectsContentDigest(<T>/projects) must equal
           the candidate payload's, file/byte counts + manifest + backup + durable
           binding exact, read-only recovery scan not "recovery-required".
         → crash-safe: an incomplete <T>/projects is never treated as consumed;
           re-run with the same --consume-id resumes against the immutable candidate.
      DO NOT `cp -r` / `rsync` / `fs.rename` the candidate, and DO NOT point
      ATOLYE_RUNTIME_ROOT at the candidate payload — the consume service is the
      only sanctioned path (a single changed byte in a production-execution record
      makes the new root unbootable). DO NOT copy the
      .runtime-authority-generation.json marker (publish re-stamps it).

      candidate artifact ≠ live root · consume ≠ publish ·
      materialization ≠ authority activation · publish (step 6) = cutover / point of no return.

5.  PREPARE + VALIDATE  (freezes a per-file digest of <repo>/data/projects and
                         requires <T>/projects to be a byte-exact copy)
      npm run authority:prepare  -- --authority-root <AR> --transition-id <ID> \
        --source-projects <repo>/data/projects
      npm run authority:validate -- --authority-root <AR> --transition-id <ID> --target <T>
      → validate fails (TRANSITION_TARGET_CONTENT_MISMATCH) on ANY difference.

6.  PUBLISH AUTHORITY  (point of no return — no silent rollback after this)
      npm run authority:publish -- --authority-root <AR> --transition-id <ID> --target <T>
      → stamps <T>/projects/.runtime-authority-generation.json and CAS-writes
        <AR>/authority-transition-v1/active-authority.json.

7.  QUARANTINE OLD ROOT
      npm run authority:quarantine -- --authority-root <AR> --transition-id <ID>
      (genesis retires the repo default via the active-authority pointer — it does NOT
       write a quarantine/<binding>.json, so a backup can still be restored to the repo path.)

7b. FINALIZE OLD-ROOT QUARANTINE + ISSUE ROLLBACK TOKEN  (C.2B.11 — relocation / recovery only)
      npm run authority:finalize-quarantine -- --authority-root <AR> --transition-id <ID> --old-root <S>
      → puts every regular file under <S>/projects behind FILE_ATTRIBUTE_READONLY, verifies it
        (QUARANTINE_NOT_ENFORCED — hard stop — if it can't), records append-once enforcement
        evidence, and prints a single-use rollback token bound to this exact
        {generation, transition, old root, new root, transitionSequence, source digest}.
      Keep the token id somewhere safe. `npm run authority:rollback-status -- ... --transition-id <ID>`
      shows `rollbackAvailable`.

8.  CUT OVER + RESTART
      Set ATOLYE_RUNTIME_ROOT=<T> and ATOLYE_RUNTIME_AUTHORITY_ROOT=<AR>  (operator edits .env.local).
      The target will NOT boot while <repo>/data/projects still holds the same slugs
      (RUNTIME_STORAGE_DUAL_ROOT_DIVERGENCE — a deliberate fail-closed).
      → rename <repo>/data/projects to <repo>/data/projects.quarantined (read-only), then start.

9.  RECOVERY VERIFY
      Start the server → it boots against <T>; open a real project; confirm no write
      lands in <repo>/data/projects.quarantined. `npm run authority:status` shows the
      target as the active authority, sequence 1.

10. GIT UNTRACKING  — a SEPARATE, reviewed C.2B.12 sprint (docs/GIT_UNTRACKING_PLAN.md).
      `git rm --cached` the relocated tree in the documented order; extend `.gitignore`.
      Protected: production-execution/**, production-acceptance.json.

11. Only after everything above verifies over time: delete <repo>/data/projects.quarantined.
```

Failed transition (pre-publish) → `npm run authority:fail -- --transition-id <ID> --reason "<why>"`,
then resume the old root. Consume (step 4b) never touched the live source, so
there is nothing to roll back there — abandon the `<T>` / `<CR>` scratch.

**After publish** (C.2B.11), two paths:

- **Token rollback** — only while nothing has mutated on either root since the
  cutover (`ROLLBACK_TARGET_DIRTY` / `ROLLBACK_OLD_ROOT_CONTENT_DRIFT` otherwise):
  `npm run authority:begin-rollback -- --authority-root <AR> --workspace-root <repo> --generation <G> \`
  `  --rollback-transition-id <RID> --token-id <TOKEN> --old-root <S> --target <T>`
  → `authority:validate-rollback` → `authority:publish-rollback` (CAS authority
  back to `<S>`, lift its read-only barrier, consume the token) →
  `authority:quarantine-former-target` (read-only + quarantine `<T>`). The token
  is single-use and cannot be replayed or re-pointed.
- **Forward recovery** — the target proved bad and either root has drifted:
  restore the step-1 backup into a FRESH root and run
  `npm run authority:begin-recovery -- --target <fresh> --transition-id <ID2> --reason "<why>"`
  → quiesce → prepare → validate → publish → quarantine. Forward-only; the
  abandoned root can never be recovered *to*.

A genesis has no quarantined external old root — its "rollback" is: restore the
step-1 backup to `<repo>/data/projects`, unset `ATOLYE_RUNTIME_ROOT`. No token.

`data/brain/**` (AYAS ledger, Brain queue, autonomy state) is **not** migrated —
it stays machine-local under `<repo>/data/brain/`.

Migration is **idempotent**. A slug collision **never** auto-overwrites
(`RUNTIME_STORAGE_DUAL_ROOT_DIVERGENCE`). A failed migration **never** deletes
the source.

### `.partial` files (F5 / F12 — read-only classification, migration-safe)

The 27 `*.partial` files on disk are **EXCLUDE-SAFE**: all under
`data/projects/i-stanbul-un-fethi-1453/production-execution/{audio-compensation-cleanup,audio-compensation-recovery}/.audio-journal-staging/`
— orphan atomic-write staging from `AudioCompensationStore` journal persistence
(`<name>.json.<uuid>.partial`). They are inert (never read as authority) and
`RuntimeBackupInventory` excludes them
(`isAudioCompensationJournalStagingPartialAtProjectPath` → skip).

**F12 (Sprint 195):** the Sprint 192/193 audit reached "EXCLUDE-SAFE" by *reading*
that skip; the classifier as written only matched the legacy
`audio-compensation-cleanup/<ref>/.audio-journal-staging/` layout — it assumed a
`<ref>` workspace directory the real tree does not have, and never checked the
`audio-compensation-recovery` tree. So `collectRuntimeBackupInventory` actually
threw `RuntimeMutationError` on the real tree (the 97–108-char `.partial` names
exceed the 96-char portable file-name ceiling). Fixed: the classifier now
anchors on `production-execution/{cleanup|recovery}`, treats `<ref>` as optional,
and is verified by a smoke that *runs* the inventory against the real layout
(`scripts/smoke-f12-audio-journal-partial-classification.ts`). A real read-only
`npm run runtime:backup:inventory` now completes — 2360 files inventoried, 28
excluded (27 journal `.partial` + 1 `.pipeline-jobs.*`), zero remaining
path-policy failures.

Zero `.partial` under any tracked / milestone project; `i-stanbul-un-fethi-1453`
is a gitignored, in-progress project and not a first-wave migration target.

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
