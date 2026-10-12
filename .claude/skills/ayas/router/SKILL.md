---
name: router
description: Routing index for AYAS/Atölye work in this repository. Invoke first when a task touches AYAS governance, the production pipeline, storage, video/audio, the Brain frontend, tests, deployment, or AYAS conversational intelligence, and it is not already obvious which single domain applies. States authority precedence and links to each on-demand domain skill — carries no domain detail itself.
---

# AYAS Context Router

Progressive-disclosure index only. Load the specific domain skill below instead of reading broadly across the repository.

## Authority precedence — never contradict this

1. **AYAS repository authority** — `CLAUDE.md`, `AGENTS.md`, `ATOLYE_AI_RULES.md`. These are already always-loaded by Claude Code itself; this router adds nothing to them and can never override them.
2. **Execution Gate / proposal / stale-state / scope rules** — see `ayas:execution-gate`.
3. **Graphify-first** — the pre-existing, unmodified project rule (see `CLAUDE.md`'s own "graphify" section and the global `graphify` skill). Query/affected/explain before broad grep or a wide read, and before any source-changing implementation.
4. **This router and its domain skills** (`ayas:authority`, `ayas:execution-gate`, `ayas:production-pipeline`, `ayas:storage`, `ayas:video-audio`, `ayas:frontend`, `ayas:tests`, `ayas:deployment`, `ayas:conversational-intelligence`).
5. Karpathy coding-discipline skill — style/process guidance only (think before coding, simplicity, surgical changes, goal-driven execution). Never authority-relevant.
6. UI UX Pro Max — load only for genuine UI/UX/visual-design work; never for Execution Gate, proposals, scheduler, storage, backend, or authority logic.
7. Other task-specific skills.
8. Claude defaults.

If a domain skill below ever appears to weaken steps 1–2, trust `CLAUDE.md`/`AGENTS.md` and say so — do not silently follow the domain skill.

## Domains

| Task involves | Load |
|---|---|
| commit/push rules, who may authorize what, single-approval exceptions | `ayas:authority` |
| Execution Gate states, proposal/micro-batch lifecycle, staleness, approval races | `ayas:execution-gate` |
| pipeline stage dispatch, scheduling, production acceptance / durable execution | `ayas:production-pipeline` |
| runtime storage root, asset writes, project manifests, backups | `ayas:storage` |
| visuals / animation / audio / video / assembly stage code | `ayas:video-audio` |
| local character art, differentiated cast, themed backgrounds, art-style compatibility | [editorial-animation](../editorial-animation/SKILL.md) and `ayas:video-audio` |
| historical cast/culture, contextual props, scene sentence actions, audio alignment design | [scene-direction](../scene-direction/SKILL.md) and `ayas:video-audio` |
| Brain console UI, Gelişim Merkezi, `app/` routes, `src/components/` | `ayas:frontend` |
| finding, running, or writing a smoke test; regression scope for a change | `ayas:tests` |
| build/start, `BUILD_ID`, restarting the live server, deploy verification | `ayas:deployment` |
| AYAS chat, deterministic intents, external-research/goal system, voice | `ayas:conversational-intelligence` |

Load only the domain(s) a task actually touches — a pure UI task never needs `ayas:execution-gate`; an authority task never needs `ayas:video-audio`.
