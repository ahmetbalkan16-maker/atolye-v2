# Codex / Claude Task — Stage 16.5 Upwork Official MCP Adapter

Prefer Upwork's official MCP server.
Re-check current Upwork MCP/API docs before implementation.

Initial scope:
- tool discovery/schema mapping
- owner-triggered read operations
- normalized job/invitation/proposal/contract facts
- local proposal drafts

Do NOT:
- auto-submit proposals
- consume/buy Connects
- boost proposals
- send messages
- accept offers/contracts
- perform financial actions
- schedule Upwork MCP activity
- persist raw MCP output

Until the owner obtains/records Upwork support confirmation for AYAS's custom workflow,
keep scheduled activity, automated filtering/scoring actions and durable raw MCP storage blocked.

No scraping/browser fallback.
