# V3 full-trajectory correction — still FAIL

Owner V3 keeps AYAS/AYAZ/HAYAS positive and HAYAZ, suffixes and ordinary speech negative. First-wake warm-up/cache/catch-up/epoch/single-flight and all detector thresholds remain unchanged. Production remains the original model; no replacement is selected.

An inherited training-selection defect was corrected prospectively:21 negative phrases were synthesized with fixed32 training and8 held-out stochastic variants each. All real-WASM score frames were retained.840 clips/34841 frames,672 training/168 held-out, zero train/held raw PCM hash overlap. This is one synthetic Piper voice with pitch/time/gain variation, not independent human speakers. Existing Tolga source-overlap limitation is unchanged.

The existing64-unit head received a fixed16-epoch training-only correction, including these complete negative trajectories and training-prefix background mining.70898 training windows/139000 balanced windows; held-out data and labels were excluded from fitting. Results:637/648 selected/raw feature trajectories PASS,11 FAIL, plus3 false-wake decisions among216590 unseen background windows. Four NEW complete negative trajectories fail (three HAYAZ, one ayak); seven old selected trajectories fail (three positive, four negative). Old positive trajectories retain only legacy-peak windows, so their selected-window misses do not by themselves prove whole-PCM misses. The genuine complete-negative failures independently reject this candidate.

CPU versus real existing onnxruntime-web WASM parity:13012 held-out score frames/648 trajectories, max absolute score error0.000003725290298461914, zero actual WakeScoreDetector decision mismatches. Numeric parity PASS does not change acoustic FAIL. This result excludes a CPU/WASM decision mismatch as the explanation for these audited failures.

Archived raw results/recipes/input hashes:qualification/full-trajectories/INDEX.json. Prior original/V2/corrected/fine/prototype-bank archives remain immutable. Full-trajectory candidate stays private, not deployed. Fresh acoustic/whole-held-PCM/Tolga/challenge replay remain required for any future production selection; they are not fabricated as completed for this rejected model.

The fixed10-epoch temporal diagnostic completed FAIL:14 trajectories and47/216590 background decisions. Subsequent already-computed-mel studies also completed FAIL at their fixed10-epoch budgets. The final200-frame candidate has actualWASM false wakes and genuine positive misses. All further same-method fitting is stopped by the latest owner order. See FINAL_BLOCKED.md and qualification/final-mel/INDEX.json for complete final receipts.

Phase A BLOCKED. Isolated Phase B male preparation now authorized and tested separately; live activation remains blocked by Wake, owner quality and license gates. No agent-initiated rollout. BrainUIV2/homepage/PWA/tunnel/task XML/frozen history protected. FoundationBLOCKED; owner phone/audio acceptanceNOT_RUN.
