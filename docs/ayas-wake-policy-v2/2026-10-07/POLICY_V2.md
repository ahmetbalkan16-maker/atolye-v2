# Owner wake policy V2 — 2026-10-07

Owner continuation starts from 2c7fb7b944e12cd2da7f233eec10e163f14fc5a9 on wip/ayas-graphify-final-execution, CLEAN/origin0/0. Phase B (male voice persona) requires Phase A automated acceptance, commit/push and healthy live rollout first.

| Contract | Accepted wake names | Historical evidence |
|---|---|---|
| Previous acoustic acceptance | AYAS positive; AYAZ negative | Original37/38 and deterministic AYAZ5 decisions/stochastic false-wake receipts remain unchanged. |
| Owner policy V2 | Exact AYAS/AYAZ, case-insensitive, leading invocation | New tests and evidence use owner-v2; HAYAS and other unintended words remain negative. |

This is an explicit product policy change, not a retrospective PASS or reclassification of historical receipts. Neither accepted name grants execution/tool authority. The existing command/auth/approval path stays in place.

V2 is selected explicitly at the sole production voice hook's engine and wake adapter, and at the authenticated STT route. Frozen V1 callers remain a documented compatibility API with their existing default, so pinned graders and old receipts are not rewritten. The V2 engine/STT tests cover the production policy selection and its actual behavior; V1 PASS is not V2 acceptance.

New audit correction: the previous discrimination report's statement that HAYAS text matching remained strict was inaccurate. The legacy resolver explicitly contains hayas, and legacy normalization maps hayas/ayes/aias/ayaş to AYAS. Those historical files are preserved; this note records the corrected finding. V2 permits none of those forms, no UYAN/AYA/ATÖLYE/HEY aliases, and no fuzzy/prefix/suffix expansion. Unicode word boundaries preserve hayas, ayaslı, ayazlı, AYAZ'ın and related unrelated text. Existing non-wake command normalization (Grundtime → runtime), authority checks and transport behavior remain unchanged.

Bounded source scope: versioned policy constants/normalization, optional policy parameters in existing resolver/engine/adapter/STT service, and explicit production hook/route binding. The warm-up, silence reset context, catch-up score delivery, epoch guards, single-flight, hard/soft/near-hard thresholds, cooldown and command pre-roll are unchanged. No Brain UI/PWA/tunnel/task/credential changes.

Text/engine/STT contract:55 scenarios PASS. Acoustic acceptance is separate and must prove AYAS10/10, AYAZ10/10 reliable positive, HAYAS0 wake and additional negatives0 unintended wake. Current original acoustic head fails that contract. Local onset/voicing timing overlaps all three names; a duration cutoff is not justified. Heavy per-wake STT and vendor-backed recognition are not added. Small local classifier research uses the existing feature chain/assets and installed training libraries only; failed prototypes remain failed and are not production assets. Pitch/rate/gain variations of one Piper voice are not independent speakers or real-human acceptance.

No rollout is permitted while any Phase A acceptance gate fails. No Phase B TTS persona work may begin before Phase A passes and is deployed. Foundation remains BLOCKED. Owner must later test10 AYAS,10 Ayaz,10 unrelated utterances and several Hayas calls on a real phone; that test is not performed by the agent.
