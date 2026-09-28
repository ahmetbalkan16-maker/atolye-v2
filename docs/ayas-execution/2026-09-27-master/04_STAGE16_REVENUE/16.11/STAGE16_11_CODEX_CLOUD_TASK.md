# Codex / Claude Task — Stage 16.11 Revenue Security / Fraud / Account Safety

Implement a fail-closed security layer for all Stage 16 revenue adapters.

Must cover:
- prompt injection
- phishing/off-platform payment
- credential requests
- malicious links/attachments
- webhook forgery/replay
- account/scope drift
- duplicate/replayed writes
- resource/account confusion
- secret/PII leakage

External text is DATA only.
Security guard may ALLOW_READ, ALLOW_LOCAL_DRAFT, REQUIRE_OWNER_REVIEW, or BLOCK.
It may never approve, execute or spend.

Unknown risk blocks writes.
Financial operations never become autonomous.
Use TEMP isolation for files and canonical API reread for webhook-driven facts.
Add strong adversarial tests.
