# V2 WIP archive; superseded by owner V3

Starting source: 2c7fb7b944e12cd2da7f233eec10e163f14fc5a9. No reset, new branch, runtime deployment or protected-system change.

V2 exact text/engine/STT contract passed55 scenarios. Production hook and STT route selected V2 at this checkpoint; original V1 compatibility APIs and frozen graders remain unchanged. Existing first-wake warm-up/catch-up/epoch/single-flight/cache and thresholds remain unchanged.

Original acoustic head under V2:117 checks,92 PASS/25 FAIL. Deterministic independent AYAS10/10 and AYAZ10/10; deterministic HAYAS10/10 false-wake clips. Stochastic AYAS10/10, AYAZ8/10, HAYAS10/10 false-wake clips. Additional HAYAS/repeated HAYAS/ayaslı fail. These are synthetic results, not real-phone acceptance. Same-PCM baseline comparisons preserve the finding that the confusion is inherited by the original acoustic head, not introduced by first-wake warm-up.

Four embedding-only local classifier prototypes failed held-out clips and the independent precomputed negative-embedding corpus. All are rejected; none is copied to public assets or selected by production. Onset/voicing ranges overlap; no heuristic cutoff or threshold change is justified. Existing local Whisper distinguishes AYAS/AYAZ/HAYAS on these three clips but takes1.65–1.92s; mandatory per-wake STT is rejected for latency.

Mel-context research was collecting synthetic features when the owner explicitly approved HAYAS in V3. Only the exact private extraction process and its children were stopped;312 partial PCM clips and155595776 feature bytes remain local, with no training run, model acceptance or deployment. No further HAYAS discrimination research is needed. The original four FAIL receipts remain byte-for-byte, including any Windows text-label decoding artifacts; numeric labels/features/results are not rewritten.

Regression evidence:17 existing suites398 scenarios PASS plus12/12 mutation controls. Original first-wake37/38 FAIL is preserved separately. TypeScript0, lint0 errors/13 inherited warnings; isolated installed Next16.2.10 webpack build PASS without touching canonical .next. Lock16.3.8 mismatch remains OPEN. Frozen v57 pins323/323 references across214 unique files match. Brain UI V2, homepage, PWA, tasks, tunnel, Foundation and historical evidence remain unchanged.

[Evidence index](evidence/INDEX.json) binds compressed raw JSON/JSONL by original-byte SHA256. Decompressing the .gz artifacts yields the original raw FAIL/validation receipts. Model hashes identify rejected private artifacts; no qualified model is claimed.

Phase A under V2 was NOT_READY; Phase B NOT_STARTED. The next source change is versioned owner V3 accepting only AYAS/AYAZ/HAYAS, followed by real remaining negative and stochastic reliability gates. No V2 failure is retrospectively changed to PASS. Foundation remains BLOCKED; no owner phone test was performed.
