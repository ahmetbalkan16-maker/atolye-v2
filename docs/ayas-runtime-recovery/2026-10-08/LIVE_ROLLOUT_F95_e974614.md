# F95 live rollout at `e974614` — 2026-10-08

Owner decision 2 of the Stage 17 review: a controlled restart only after full166 shows no new unexpected regression, with a rollback plan and health checks. No change to Brain UI V2, the voice system or command wiring.

**Result: DEPLOYED. Rollback not needed.** Receipt: `LIVE_ROLLOUT_F95_e974614.json`.

## Condition

The bound full166 run at clean `e974614` (manifest v57) gave 162/166. The four FAILs are the known ones: F96, plus the three preserved raw FAILs with unchanged reasons (exactly 12 IMPROVED; golden promotion stopped only for `golden.memory.retrieval-evaluation`). No new regression.

## What changed on the server

The live build was `5b657e1` (stamped DIRTY, 06:45). Between it and `e974614`, the served code changed only in:
- the F95 fix: `AyasChatStream.ts`, `app/brain/actions.ts`, `ayasChatStreamClient.ts`, `brainCore.ts`, and the fallback-note text in `BrainConsoleView.tsx` / `BrainCoreConsole.tsx`;
- the opt-in audit modules (not on any request path).

No voice, wake or homepage-design file changed. The only uncommitted item removed since that build was an untracked `scripts/voice-evaluation` prototype that the app does not import.

## Procedure

1. **Rollback point.** The live `.next` was copied to `%LOCALAPPDATA%\AtolyeAyasAccess\rollback\next-coVrOl3qLCvfhuOlaX6Xn-5b657e1`: 1,096 files / 150,109,548 bytes, identical count and size. Its one junction is recorded in `ROLLBACK.json` so a restore can recreate it.
2. **Build proof.** `npx next build` in a TEMP clone at `e974614` (real `node_modules` copy): exit 0 in 33 s. Compared with the live build:
   - app routes 55 = 55;
   - proxy/middleware matchers identical;
   - headers/redirects/rewrites identical;
   - 25 = 25 server actions (module + export name + hosting pages).
3. **Restart.** The server is owned by the singleton AYAS Access daemon (`scripts/ayas-access-daemon.ps1`), which rebuilds in the repository and restarts when the origin is down. A manual in-repo build would race it. Only the `next start` tree under the daemon's npm wrapper was stopped (09:53:19Z); the tunnel was left running. The daemon logged origin start attempt 25 = success at 09:54:29Z: about 70 s downtime. New listener PID 32416, build ID `KmsdsLSOPkVSbJONHR1Zf`, stamp `e974614` CLEAN, lockfile unchanged.

## Live checks

| Check | Before | After |
| --- | --- | --- |
| Local `/`, `/brain`, `/studio` → 307 `/login` (gate enforced); `/login` 200 | PASS | PASS |
| Public tunnel, same routes (phone path) | PASS | PASS |
| Phone access status file | online | online (all four fields) |
| Real Ollama chat turns via the live route | — | 8/8 model replies, 0 fallbacks, 0 HTTP errors; evidence `ok / null`; model `qwen2.5-3b` PINNED/MATCH |
| F95 case ("merhaba" etc. with history present) | owner saw "Anladım." | model greeting every time |
| Wake model, ONNX runtime, audio worklet over the tunnel | — | 200, exact byte sizes |

Credential handling: the access key was read inside the check process and sent only to the local login route. It was never printed or written, and the session cookie was not recorded.

## Not verified

- Physical phone use (microphone, speaker, wake), audible voice output (browser `speechSynthesis` on the owner's device) and Windows reboot continuity: owner gates.
- Conversation quality is **not** qualified. With a history that contained a status sentence, the 3B model repeated it in 4 of 5 replies. With a neutral history it repeated the previous user line and answered a direct question with a question. F97 stays open; the model choice was not changed.
