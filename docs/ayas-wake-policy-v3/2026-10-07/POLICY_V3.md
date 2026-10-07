# Owner wake policy V3

The owner updated the ongoing master continuation on2026-10-07: exact AYAS, AYAZ and HAYAS are all accepted wake names, case-insensitive. No new branch, reset or undo is used. Existing first-wake warm-up/catch-up/silence cache/epoch/single-flight, detector thresholds, cooldown and1440ms pre-roll stay unchanged.

| Version | Positive names | Historical negatives |
|---|---|---|
| Initial acoustic qualification | AYAS | AYAZ; original37/38 and AYAZ5 deterministic decisions remain raw FAIL. |
| Owner V2 | AYAS, AYAZ | HAYAS; V2 acoustic117 checks92PASS/25FAIL and four failed classifiers remain raw FAIL. |
| Owner V3 | AYAS, AYAZ, HAYAS | Other names, suffix/prefix forms, partials, silence/noise and ordinary repeated speech. |

V2 source and raw evidence were committed/pushed as41af9ee before binding V3. Its tests/normalizer remain reproducible under V2; the frozen original graders, fixtures, model and pin receipts are unchanged. Adding an explicit owner policy version does not convert any historical failure to PASS. V1 is retained as the existing compatibility API; all actual production engine/adapter/STT-route callers select V3 explicitly. V1 tests are not counted as V3 acoustic acceptance.

The V3 normalizer maps only whole Unicode AYAS/AYAZ/HAYAS words to the canonical AYAS spelling. The leading-invocation resolver accepts only those three families. HAYAZ, UYAN, AYA, AYASlı, HAYASlı and apostrophe/Unicode suffix forms are not aliases. Wake intent grants no execution/tool authority; existing command/auth/approval paths remain in place.

HAYAS discrimination research was stopped on the owner instruction. The partial mel extraction is preserved locally and was never fitted/deployed. Any subsequent private candidate concerns genuine suffix/ordinary false positives and AYAZ stochastic misses only; all three approved families receive the same positive label under the new contract. No new cloud service, credential, external API, training dependency or mandatory STT confirmation is added. Neither detector thresholds nor existing public model weights are changed to make this qualification pass.

Phase A rollout requires all three names to be reliable and all genuine held-out negatives to have zero unintended wake, with regressions/static checks/build/Graphify validation. Phase B original male persona remains gated on Phase A PASS, push and healthy canonical Access rollout. Owner real-phone10 AYAS/10 AYAZ/10 HAYAS/10 unrelated utterances remain NOT_RUN. Foundation stays BLOCKED.
