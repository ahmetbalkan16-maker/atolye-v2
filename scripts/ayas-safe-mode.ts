/**
 * Stage 15R operator CLI for the global SAFE_READ_ONLY mode.
 *
 *   npx tsx scripts/ayas-safe-mode.ts            # status (read-only)
 *   npx tsx scripts/ayas-safe-mode.ts enter      # turn the mode on
 *
 * Entering only tightens: chat, status and read-only work stay available; source writes, production
 * stages, publishing, spend, self-evolution experiments and heavy scheduled work stop. There is no
 * exit here on purpose. Leaving the mode is the owner's action on /brain/safe-mode, with the owner
 * session and the current health checks.
 */
import { ayasSafeModeRefusal, readAyasSafeMode, resolveAyasSafeModeRoot } from "../src/lib/ayas/safety/AyasSafeModeReader";
import { enterAyasSafeMode } from "../src/lib/ayas/safety/AyasSafeModeStore";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "status" && args[0] !== "enter")) throw new Error("ARGUMENT_INVALID");
  const repoRoot = process.cwd();
  const before = readAyasSafeMode(repoRoot);
  // No session is passed: an entry made here is recorded as a local operator's, never as the owner session's.
  const state = args[0] === "enter" ? await enterAyasSafeMode({ repoRoot }) : before;
  console.log(JSON.stringify({
    schemaVersion: "1", command: args[0] ?? "status", authority: "NONE", store: resolveAyasSafeModeRoot(repoRoot),
    state, holds: ayasSafeModeRefusal(state) ?? null, changed: before.state !== state.state,
    exit: "OWNER_SESSION_ONLY: /brain/safe-mode",
  }, null, 2));
}
main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
