# AYAS / AYAZ discrimination continuation — WIP, production gate FAIL

2026-10-07. Start HEAD 67113e5765d3e911c2f29288b221f3bc8936d225, branch wip/ayas-graphify-final-execution, pull current/origin0/0/CLEAN. Continued the committed first-wake candidate; no reset, rollback or restart. Provider HTTP404 remains an external access error. Earlier first-wake evidence and original38-test suite are unchanged. Foundation BLOCKED.

**No safe bounded second-stage verifier qualified. No production code, model, threshold or live deployment changed.** This session adds a strict qualification script and evidence, not a completed AYAZ fix. Negative failures remain ordinary FAIL/exit1; none is skipped, relabelled expected-fail, or weakened.

| Acceptance gate | Measured result |
|---|---|
| Deterministic independent first AYAS |10/10 fresh ONNX sessions, same deterministic PCM; first score80ms |
| Original first-wake suite |37/38; raw failure remains ayaz |
| Held-out deterministic ayaz |FAIL: peak0.9958978891372681;5 detector decisions |
| Stochastic AYAS |10/10 wake clips |
| Stochastic AYAZ |FAIL:7/10 false wake clips |
| Additional negatives |21/23 zero-wake; hayas and ayaz ayaz ayaz FAIL |
| Existing regression suites |17 PASS;398 scenarios plus12/12 mutation controls caught |
| TypeScript / lint |exit0 / exit0;0 errors,13 inherited warnings |
| Production build |PASS; isolated TEMP webpack build, installed Next16.2.10 |
| Live rollout |NOT_RUN_NEGATIVE_GATE_FAIL |

These are synthetic tests using one existing Turkish Piper dfki model, never real-human/phone acceptance. Independent sessions are not independent speakers. Stochastic audio uses fresh default-noise synthesis for each utterance; the generated PCM hash and complete score vectors are retained, not deterministic replay seeds. Raw qualification:75 checks,65 PASS/10 FAIL. Detector decisions count frame-level fires, not separate user-visible activations; the adapter still guards repeat wakes while capturing.

Root cause refinement: Piper debug emits ajˈas for AYAS/ayas and ajˈaz for AYAZ/ayaz; phoneme IDs end31 versus38 and both raw durations0.6269387755s. The fixture is not a same-phoneme labelling collision. With the EXACT same PCM, the candidate and naturally warmed2000ms baseline have matching peaks/decisions for all21 paired clips (deterministic AYAZ plus20 stochastic utterances). The inherited wake classifier conflates distinct near-match inputs. First-wake warm-up/catch-up is not the cause.

Graphify-first explain, tree and review-analysis covered runner, detector, adapter, browser fallback and STT/raw normalization before adding the new test. Follow-up explain covered text activation and multi-model preparation through ensureAudio; the existing8-scenario multi-model regression also passed. Bridge/blast-radius receipts accompany this report; graph hints do not replace tests.

| Discrimination method | Evidence and decision |
|---|---|
| Existing normalized STT confirmation |Literal ayaz becomes AYAS in normaliseAyasTranscript(). Real local Whisper raw output was Ayas. / Ayaz., but both current service outputs were AYAS. Therefore normalized STT is unsuitable as independent wake evidence. |
| Raw local Whisper |Four bounded diagnostic calls, thermal guard preserved, both existing prompt and no prompt. Raw text separated these two synthetic clips; this is promising research evidence, not broad qualification. Processing1.549–2.850s, plus whole-word capture/end wait. It needs the host server/model and lacks a current browser offline verifier contract. Gating every AYAS would add latency; changing general command normalization would change unrelated behavior. No production contract edited. |
| Token confidence |AYAZ min/mean0.810/0.882 exceeds AYAS0.556/0.788 in these calls. Confidence alone does not identify the name. Removing the prompt had no effect on these two raw outputs; prompt causality is not established here. |
| Browser speech recognition |Existing browser path is a fallback, with vendor-backed availability/offline limitations; it is not an existing guaranteed local second verifier. Making it mandatory violates offline/mobile constraints. No new cloud path added. |
| Temporal score / onset / duration |Stochastic AYAS hard frames3–7 and first decision1280–1360ms overlap AYAZ1–7 and1280–1440ms. AYAZ peak0.9996537566 exceeds some valid AYAS peaks, including0.9859715700. High/long/early scores cannot safely select a bypass here. Duration-based voting would reject valid AYAS or still admit AYAZ on this set. |
| Existing multi-model |Alias runner is an OR wake trigger, not phonetic verification; no distinct local AYAS-versus-AYAZ verifier asset exists in public/wake. Requiring the unrelated UYAN alias would change accepted wake vocabulary. |
| Ambiguous-zone confirmation |No independently validated acoustic zone distinguishes all normal AYAS from AYAZ. Excluding high scores from verification admits high-scoring AYAZ; verifying everything delays normal AYAS. No arbitrary score-shape/voicing boundary fitted to this single synthetic voice. |
| New verifier / training |One voice cannot qualify a general /s/ versus /z/ boundary. No single-clip threshold tune, new model/service/dependency, credential, or unqualified training experiment was introduced. Diverse independent voice evidence and a local compatible verifier remain the next prerequisite. |

Additional negatives cover common Turkish phrases, near matches yavaş/hayat/beyaz/yaz/ayak/ayran/hayas, partial syllables a/ya/ay/as, repeated non-wake speech, silence, deterministic white noise at amplitudes0.01/0.1/0.5. The exact23 cases and their unfiltered failures are in qualification.json. Hayas is not an added text alias: acoustic hayas false-wakes while text wake matching stays strict. No positive/negative fixture changed in the original suite.

Preserved behavior: hard0.70, soft0.60/3votes/7frame, near-hard0.67+2votes>=0.63, cooldown350ms, command pre-roll1440ms, bounded real-model silence warm-up25chunks/2000ms equivalent without wall sleep, every intermediate catch-up score, epoch/single-flight protection. No safer bounded activation change is justified by this evidence, so the original candidate stays WIP.

Regression logs cover runner17, adapter54, multi-model8, voice79, mobile36, chat client11/chat31, conversation8/lifecycle16, home11/owner36/core43, STT17/security7, PWA16/8; mutation12/12. Existing STT smoke's optional integration explicitly skipped without environment config in that test process; four separate configured local diagnostic calls above did run. Frozen graders are unchanged. No full166 or physical-human PASS claim. Installed Next16.2.10 versus lock16.3.8 dependency alignment stays OPEN; production build warnings about createRequire tracing/middleware remain inherited. Build ran in C:/Users/Metod/AppData/Local/Temp/ayas-ayaz-gate-build-skF1zM; canonical .next untouched. git diff --check PASS. v57 pins323/323 references/214files match.

Read-only live verification: single origin19960/wrapper16892, tunnel30200, expected counts1/1; local/public access gate healthy. Both scheduled tasks Running; XML hashes and tunnel-config hash equal prior immutable evidence; build ID W69b9LVZicew-R1jk70Ql unchanged. No recovery cycle, restart or deploy. Existing other worktrees were only inventoried and preserved, including unrelated sandbox changes. Brain UI V2/homepage/PWA/tunnel/tasks/frozen evidence/model weights/package files are unchanged against67113e5.

Changed tracked scope: scripts/smoke-ayas-ayaz-discrimination.ts (new qualification functions measure/decodeWav/noise/check); this evidence folder; checkpoint/changelog/roadmap continuation notes. No production symbol changed. Graphify final update is run after WIP session commit; exact commit HEAD, graph built/analyzed HEAD, stale=false,0/0/CLEAN and integrity counts are written to ignored .graphify/2026-10-07/AYAS_AYAZ_FINAL_HEAD.json. PARTIAL9 / semantic PENDING remain inherited, not falsely closed.

Reproduce strict gates with node node_modules/tsx/dist/cli.mjs scripts/smoke-ayas-first-wake-reliability.ts and scripts/smoke-ayas-ayaz-discrimination.ts; both currently exit1. Do not loosen AYAZ or optimize until random synthesis happens to pass. stt-probe.source.txt/phonemes.source.txt preserve diagnostic source (restore under .graphify/ayas-ayaz-gate for relative imports); STT uses existing local env without printing secrets, exact configured CLI, TEMP-only files and thermal guard, no config edits. Full raw transcripts/phoneme receipts are retained.

Next checkpoint: qualify an independent local phonetic verifier/model with diverse voices and held-out negatives before changing activation; preserve10/10 first-wake and strict AYAZ assertion. Then rerun original and new suites plus current regressions. Only all automated acceptance gates PASS permits canonical Access rollout. After rollout owner must perform10 independent normal AYAS calls,10 unrelated utterances and several natural Ayaz calls on a real phone. Owner phone acceptance remains NOT_RUN; no claim or request to count synthetic speech as human proof.

Build/lint log and phoneme-source review copies have trailing whitespace/final blank lines trimmed for Git diff validation. Exact original bytes are preserved in their .raw.gz files; RAW_LOGS.json records SHA256. Qualification JSON, transcript JSON and earlier immutable first-wake evidence are unchanged.
