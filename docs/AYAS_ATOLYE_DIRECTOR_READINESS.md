# AYAS / Atölye Director & Media Intelligence Readiness — Stage 12

Stage 12 adds a bounded, **advisory** director review over existing production
artifacts. It does not start production, download media, call a model, approve a
proposal, publish, or write project metadata. The owner and the existing
production acceptance/execution gates remain the only execution path.

Code:

- `src/lib/ayas/director/AyasDirectorReadiness.ts` — pure task, candidate,
  finding, recommendation and readiness model.
- `src/lib/ayas/director/AyasDirectorProjectAdapter.ts` — pure projection of
  the existing project, research, script, scenes, visuals, animation, audio and
  asset registry shapes. Missing old fields remain missing.
- `scripts/ayas-atolye-director-readiness.ts` — explicit-project, read-only
  operator CLI; reads through `RuntimeStorageContext` and `ProjectReader`.
- `scripts/smoke-ayas-atolye-director-readiness.ts` — deterministic evaluator.

Run:

```powershell
npx tsx --env-file-if-exists=.env.local scripts/ayas-atolye-director-readiness.ts --slug <project-slug> --format documentary
npx tsx --env-file-if-exists=.env.local scripts/ayas-atolye-director-readiness.ts --slug <project-slug> --format general --json
```

`tsx` does not load `.env.local` by itself. Without `ATOLYE_RUNTIME_ROOT`
the storage context is the implicit `legacy-repository` root, i.e. the
repository's pre-migration `data/projects` copy, not the live runtime. The
output therefore always begins with `STORAGE: <classification>` (JSON:
`storage.classification` / `storage.rootSelection`) and says so when the
root is not the live one. Run it from the repository root: the existing
`ProjectReader` it reuses has an `@/` alias import that resolves through the
repository `tsconfig.json`.

The format is explicit. The CLI reads only four media-tool keys from
`.env.local` (`FFMPEG_EXECUTABLE`, `FFMPEG_PATH`, `FFPROBE_EXECUTABLE`,
`FFPROBE_PATH`) and runs the configured executables with `-version`.
It never prints their paths or other environment values. Provider liveness
stays `UNKNOWN` because checking it could contact a paid or remote service.
An unknown host/provider cannot yield a PASS pre-assembly gate.

## Existing production architecture

| Area | Existing source | Stage 12 classification |
|---|---|---|
| Project/topic and manifest | `ProjectManager`, `ProjectReader`, `ProjectManifest` | COMPLETE, not director-aware |
| Research and archive candidate discovery | `src/lib/ai/steps/`, `ResearchMediaDiscovery`, Wikimedia source client | EXISTS_BUT_NOT_DIRECTOR_AWARE |
| Script and narration plan | `ScriptData`, AI script step | EXISTS_BUT_NOT_DIRECTOR_AWARE |
| Scene generation | `SceneItem` / `SceneData` | PARTIAL: no explicit purpose, beat, scene-level citation, place or period |
| Visual planning and assets | `VisualData`, `VisualAssetPipeline`, `AssetManager` | COMPLETE for current rendering; director metadata partial |
| Real media selection and rights | `SceneMediaSelection`, `VisualMediaAdmissionPolicy`, `MediaRightsPolicy` | COMPLETE production ladder; title/query matching has known semantic limits |
| Real video intake | `VideoMediaIngestion`, checksum/segment/codec checks | COMPLETE for the enabled production path |
| Motion | `AnimationMotionPlanScene`, `AnimationMotionPlanValidation` | COMPLETE for current five motion types; not director-aware |
| Audio/music | `AudioData`, `AudioMusicSelection`, rights-gated audio libraries | COMPLETE for current pipeline; no scene-level mix judgment |
| Scene video and final assembly | `FFmpegSceneVideoProvider`, `VideoAssemblyManager`, `VideoDurationCoverageGuard` | COMPLETE for current pipeline; director review was missing |
| Thumbnail, SEO, YouTube package, export | respective stage modules and provider routers | COMPLETE for current pipeline; Stage 12 does not alter them |
| Retry/resume/durable execution | `PipelineRunner`, `PipelineJobManager`, `src/lib/production/` | COMPLETE existing governed path; untouched |
| Host/provider acceptance | `ProductionReadinessService`, provider routers | COMPLETE existing execution checks; its full evaluation writes probes, so Stage 12 does not call it |
| Runtime storage | `RuntimeStoragePaths`, project/asset storage | COMPLETE explicit-context contracts; Stage 12 only reads |

Graphify at the trusted baseline identified
`SceneMediaSelection.ts → PipelineStageExecutor.ts` through importer edges.
The shortest graph path toward publishing also traversed
`PipelineStageExecutor.ts`; these are undirected graph traversal results, not
proof of an execution dependency. Source imports and the new module's
read-only behavior are reviewed directly.

## Director task and narrative intent

`DirectorTask` holds project id, topic, format, audience, objective, tone,
target duration, pacing profile, scenes, candidate metadata, host/provider
facts and optional final-assembly metadata. Each `DirectorScene` can carry
purpose, narrative beat, narration, visual objective, subject, location,
period, chronology index, transition, duration, evidence references, preferred
media classes, selected asset id, motion and reconstruction label.

Documentary beats are `HOOK → CONTEXT → SETUP → CONFLICT → PROGRESSION →
CLIMAX → RESOLUTION → AFTERMATH → CONCLUSION`; `OTHER` is allowed.
Backward beat order without an explicit transition receives a review finding,
not an automatic script rewrite. General-format tasks do not enforce
documentary beat order. Adjacent identical narration terms, backward
chronology and unexplained location jumps are reported. Old `SceneItem`
artifacts do not have a purpose or beat; the adapter leaves them unknown
instead of pretending the description is a purpose. A script chapter's
narration spans all of its scenes, so the adapter uses it as scene narration
only when the chapter has exactly one scene; otherwise scene narration stays
unknown. (Copying it onto every scene produced false repetition findings on
10–11 scenes of each multi-scene live project inspected.)

## Media needs, candidates and the real/generated policy

The task can explicitly prefer `REAL_PHOTO`, `ARCHIVAL_PHOTO`,
`REAL_VIDEO`, `ARCHIVAL_VIDEO`, `MAP`, `DOCUMENT`,
`ILLUSTRATION`, `GENERATED_IMAGE`, `ANIMATION`, `DIAGRAM`,
`TEXT_CARD`, `B_ROLL` or `TRANSITION` by scene. A recommendation
compares that preference with subject term overlap, period, location, source
quality evidence, rights and availability. The result names one candidate
and a bounded reason, or explicitly says no evidenced suitable candidate.
It does **not** bind the candidate to the production pipeline.

For documentary scenes, relevant, usable real media is preferred when
provenance and rights evidence exist. A real source with a wrong date/place,
unknown rights, missing source-quality evidence or no subject match is not
recommended. Generated media can be the honest choice for an abstract scene,
a reconstruction, or a scene lacking suitable real media. In a documentary,
a generated depiction (image, illustration, animation, map) without a
reconstruction label is a major finding. Explanatory graphics (`DIAGRAM`,
`TEXT_CARD`, `TRANSITION`) cannot pass as a depiction of the past, so they
need no reconstruction label. A generated item that claims a capture class
(`REAL_PHOTO`, `ARCHIVAL_PHOTO`, `REAL_VIDEO`, `ARCHIVAL_VIDEO`,
`DOCUMENT`, `B_ROLL`), or a real item labeled `GENERATED_IMAGE`, is a
blocking origin conflict. Real is not automatically better; synthetic
reconstruction is never treated as documentary evidence.

`DirectorMediaCandidate` carries source URL/organization, creator, license,
attribution, source-quality evidence, subject/place/period, dimensions, clip
duration and segment bounds. The project adapter maps research search hits
as **reference only**; a search result is never counted as a downloaded
production asset. Selected asset IDs are traced from stored motion-plan
`sourceImageAssetId` when present. Existing motion types map to director
motion as `static` → `STATIC_HOLD`, `zoom-in` → `SLOW_PUSH`, `zoom-out` →
`REVEAL`, `pan-left`/`pan-right` → `PAN`. The existing asset registry is
read but not changed.

## Provenance, rights and source quality

The existing `MediaRightsPolicy` reclassifies the reported license string.
The model ignores any caller-supplied cached rights classification. Real
media without a source URL or a recognized usable license is
`RIGHTS_UNKNOWN`; restricted licenses become `DO_NOT_USE`.
`OWNER_VERIFIED` requires an explicit owner verification flag, source URL
and nonempty evidence reference; the project adapter never creates one.
This is advisory evidence, not a legal determination or an approval to use
the media. Generated media is labeled `GENERATED`; it has no fabricated
archive license.

Source quality can be `PRIMARY_INSTITUTION`, `ESTABLISHED_SOURCE`,
`OWNER_SOURCE` or `UNKNOWN`. A non-unknown quality label helps ranking
only when an evidence reference is supplied. Existing project assets and
research results project to `UNKNOWN` by default. Search ranking and a
caption alone are not treated as historical truth.

## Quality dimensions and findings

The review reports separate dimensions:
`NARRATIVE_COHERENCE`, `SCENE_PURPOSE`, `MEDIA_RELEVANCE`,
`FACTUAL_ALIGNMENT`, `MEDIA_PROVENANCE`, `VISUAL_VARIETY`,
`MOTION_APPROPRIATENESS`, `AUDIO_ALIGNMENT`, `PACING`,
`CONTINUITY`, `SOURCE_QUALITY`, `RIGHTS_READINESS` and
`ASSEMBLY_READINESS`. There is no opaque global quality score.

Findings carry a closed code, dimension, severity, scene id, bounded factual
evidence and a narrow recommendation. Checks include subject/place/period
mismatch, unknown/restricted rights, missing scene-level factual source,
missing production asset, repeated use of the same asset, low resolution,
unsuitable motion or clip length, narration/visual term mismatch, missing
(`AUDIO_INCOMPLETE`) or unevidenced (`AUDIO_UNVERIFIED`) scene audio, audio
vs scene duration difference, overlong static stills, too-short
maps/documents, continuity and chronology breaks, and malformed final
assembly metadata. Like an unknown host or provider, unevidenced scene
audio cannot yield a PASS gate. Inputs are capped at 200 scenes and 1,000
candidates. Duplicate identities block review.

Text overlap is a limited, deterministic signal. It cannot prove that pixels
depict the subject or that a source statement is historically correct.
Terms and place/period values are compared after Unicode diacritic folding
with `İ`/`I`/`ı`/`i` unified, so Turkish scene text (`İstanbul kuşatması`)
matches English archive metadata (`Istanbul`). A Turkish-locale lowercase
alone would turn `Istanbul` into `ıstanbul` and report a false mismatch.
Period and location conflicts are explicit metadata comparisons; ambiguous
values remain for owner review. No media file is decoded in this review.

## Readiness and authority

Readiness states: `NOT_READY`, `MEDIA_INCOMPLETE`, `RIGHTS_BLOCKED`,
`AUDIO_INCOMPLETE`, `VISUAL_REVIEW_REQUIRED`, `ASSEMBLY_READY`
(pre-assembly checks pass), and `OWNER_REVIEW_READY` (supplied final
assembly metadata also passes). Dependency state is
separate: `CODE_READY`, `HOST_BLOCKED`, `PROVIDER_BLOCKED`,
`DATA_BLOCKED` or `UNVERIFIED`. The pre-assembly advisory gate is
`PASS`, `REVIEW_REQUIRED` or `BLOCKED`. Final assembly metadata,
when explicitly supplied, checks scene order, audio track, duration and
dimensions; otherwise its gate is `NOT_EVALUATED`.

The pre-assembly gate is an **advisory result**, not a new execution gate.
There is no Stage 12 write to manifests, job records, retry state, asset
files, or approval state. It cannot invoke `PipelineRunner`, the
production acceptance orchestrator, provider routers or YouTube publish.
Owner-approved production still goes through existing policy and execution
services. Stage 11 Brain is unchanged; it does not advertise a director
readiness value that has not been measured.

## Evaluation and safety

The final evaluator (`scripts/smoke-ayas-atolye-director-readiness.ts`,
SHA-256 `91d4f451509610745f92d8a345336a3c9d0057d32714ddc5ce860a3b28819510`)
run unchanged on a clean OS-TEMP `git archive 5da7aa2` (with a
`node_modules` junction, removed afterwards) reports 53 primary and 8
held-out cases **MISSING**, which is expected: the capability did not exist.
Current source passes 53/53 primary and 8/8 held-out, including wrong
subject, time and place; real and generated choices; rights/provenance;
repetition; motion, clip, audio, pacing, continuity; host/provider blockers;
source quality; bounded inputs; authority; and old-artifact preservation.
Two CLI integration checks use an OS-TEMP runtime, verify its files are
byte-identical after review and that the output names the
`explicit-external` storage root, and reject a traversal slug. The model
cases are pure; integration fixtures write only under OS TEMP. There is no
network, provider call, live filesystem mutation or production run. The
unsafe observer-autostart smoke was not run.

Count history: the first handoff reported 45 primary cases; the
implementation session then added two (47). The code review added six
primary regression cases (53), each of which failed on the pre-fix source:
Turkish/English `İ`/`I` matching, unevidenced audio blocking PASS,
scene-bounded chapter narration plus `zoom-out`, generated explanatory
diagrams, animation as source video, and term-less narration not counting as
repetition. The TEMP CLI case also gained the storage assertion. The
held-out eight are unchanged.

Regressions (no existing source file changed; the reused contracts were
pinned): `smoke-media-rights-policy` 8/8,
`smoke-phase6-production-real-media` 8/8, `smoke-project-folder-index`
9/9 and `smoke-runtime-implicit-root-write-safety` 30/30. TypeScript,
changed-file ESLint `--max-warnings 0` and diff checks pass.

Three existing documentary projects (6, 16 and 15 scenes) were inspected
read-only against the live runtime. All report
`VISUAL_REVIEW_REQUIRED` / `UNVERIFIED` with every scene's media
selected. Their old scene schema does not state purpose, scene-level
citations or reconstruction labels, so the review reports those gaps; the
15-scene project's real media also lacks source-quality evidence, and two of
its images are below 1280×720. The completed projects are not rewritten.
Configured ffmpeg and ffprobe both passed `-version` on the host. Provider
liveness remains unverified. The CLI does not perform the write-bearing
`ProductionReadinessService.evaluate()`.

## Limits and follow-up

- This is deterministic metadata intelligence, not image recognition,
  automatic copyright clearance or automatic historical fact checking.
- The adapter does not infer scene-level narration or timings from a
  multi-scene chapter, and it does not assert a selected file's on-disk
  bytes are valid.
- Legacy projects never yield a recommended candidate: their generated
  images carry no reconstruction label and their real media no
  source-quality evidence, so every recommendation is `OWNER_REVIEW`.
  This is the honest result for unknown evidence, not a defect.
- The `RESEARCH_REFERENCE_ONLY` rights value is declared but not produced;
  a research hit's reference-only status is carried by
  `availableForProduction: false`.
- A saved asset's `status` and `filePath` are registry evidence, not a
  substitute for the existing production acceptance checks.
- Final assembly review requires explicit metadata; the project CLI does not
  probe or decode an existing output.
- A provider configured in environment variables is not considered live
  without a separate safe probe. No paid call is made.
- Director recommendations are not automatically applied; wiring owner
  decisions into future production metadata needs a separate review that
  preserves durable resume/retry and storage authority.
- Stage 10A deferred Graphify issues and the Stage 11
  `/api/runtime/health` finding remain outside this sprint.
