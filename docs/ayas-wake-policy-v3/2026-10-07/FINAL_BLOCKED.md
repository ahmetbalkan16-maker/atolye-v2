# Wake Policy V3 — BLOCKED, final bounded mel study

2026-10-08. Continued source checkpoint `c0baf914562b5d5cb52d7acaa7c51e0424d4ebc6`, same branch/worktree, origin 0/0. Provider HTTP 404 is an access error, not an AYAS code defect. No task restart, rollback or production model change occurred.

The final study is closed. No additional fits using this method are authorized by this continuation. Existing-mel context uses already computed spectral frames, without STT, a new dependency or additional waiting. Both mel variants finished their predetermined 10 epochs with four training threads. Final 200-frame context fit took 15.340 seconds. All training uses the declared training split; thresholds, votes, cooldown, pre-roll and first-wake safety remain unchanged. Genuine held-out PCM hashes do not overlap training. These synthetic evaluation sets were consulted during research and are not a new untouched final human qualification set. No held-out labels entered fitting or threshold selection.

| Final candidate qualification | Result |
| --- | --- |
| Fresh real-WASM acoustic oracle, original 122 checks retained | 120 PASS / 2 FAIL: stochastic AYAZ miss; repeated merhaba false wake |
| Full real-WASM held-out PCM: 76 original + 168 additional negative clips | 227 PASS / 17 FAIL: one HAYAS miss, sixteen false-wake clips |
| Existing Tolga synthetic source audit | 372 PASS / 12 FAIL; includes overlapping training-source WAVs, not independent speaker qualification |
| New speech challenge, frozen model, never fitted | 59 PASS / 1 FAIL: hayazı |
| CPU versus actual WASM on 172 matching trajectories / 9,142 frames | Numeric PASS, max error 0.00000298023224, zero decision mismatches |

The held-out false wakes include HAYAZ, merhaba, ayak and repeated merhaba. AYAS/AYAZ/HAYAS deterministic first sessions each pass 10/10, but this does not override stochastic misses or negative failures. The held-out runner emits its first score at 80 ms; acceptance cannot be granted by timing alone. No device/human/owner acceptance was performed.

Concrete root causes and limits:

- Earlier training had 18 verified zero-PCM feature vectors with contradictory positive/negative labels; those labels were corrected only in private training. Historical results remain unchanged.
- Earlier negative training selected windows using legacy high scores and omitted complete trajectories. Keeping all negative score frames corrected that selection defect, but its fixed 16-epoch candidate still failed independently.
- The final mel verifier only permits or suppresses a frozen first-stage score. A genuine HAYAS trajectory peaks at 0.197736, so that construction cannot recover its missing wake. The verifier also permits HAYAZ peaks 0.788456 and 0.907692. Complete new held-out negatives expose additional errors invisible in the smaller mel fit audit.
- Matching CPU/WASM decisions exclude a numerical backend discrepancy for the audited errors. Evidence shows inadequate generalization and first-stage score limitations, not an established physical impossibility of phonetic discrimination. Embedding-only historical background failures remain recorded; missing auxiliary mel prevents claiming a composite background PASS.

The preceding temporal diagnostic failed 14 trajectories and 47/216,590 background decisions. The 76-frame and final 200-frame mel fits each failed 6/172 feature trajectories. They are rejected, not production candidates. The final WASM wrapper is private serial evaluation code; production epoch/single-flight behavior was not replaced and no concurrent-wrapper safety claim is made.

Raw reports, recipes, input/model hashes and numeric parity: [final-mel INDEX](qualification/final-mel/INDEX.json). Full-trajectory correction: [result](FULL_TRAJECTORY_RESULT.md), [receipts](qualification/full-trajectories/INDEX.json). Existing original/V2/training-correction/frozen evidence is immutable. Public receipts contain synthetic measurements and recipes only; no audio, human recordings, models, feature binaries or credentials are published.

Production keeps the original `/wake/ayas.onnx`; failed models stay private. Wake V3 is **BLOCKED**. A future wake attempt needs a newly authorized strategy/corpus with independent qualification; do not resume the closed model search. Isolated male-persona preparation is separately authorized by the latest owner order, while live voice activation requires Wake PASS, quality gates and explicit owner approval.

Master stage remains Stage 17 / Foundation BLOCKED. Owner phone wake/TTS/interrupt/continuity evidence is missing. Graphify structural PARTIAL (nine inherited file omissions) and semantic PENDING are not Foundation PASS. No new Brain UI V2/homepage design is authorized. Existing UI, PWA, tunnel, tasks, active runtime and frozen master evidence remain untouched.
