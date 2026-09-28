# Codex / Claude Task — Stage 16.7 Udemy + Atölye

Implement two separate surfaces:

A) Udemy official Instructor API v1:
- taught-course reads
- reviews/Q&A/messages reads
- local reply drafts
- no autonomous POST/PUT/DELETE

B) Atölye course-production layer:
- course plan
- lesson plan
- media/asset manifest
- rights/licensing evidence
- quality/readiness state
- owner upload handoff

Do not use private Udemy APIs.
Do not scrape/browser-automate.
Do not infer publication.
Do not infer revenue from ratings/reviews.
Tokens remain server/connector managed.
