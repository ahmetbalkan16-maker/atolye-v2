/**
 * A tiny cross-component signal: "is a Phone-LLM model actively
 * downloading / being written to cache / loading into the runtime right
 * now?" (iOS Phone-LLM offline fix, spec §7/§16).
 *
 * `PwaRegister.tsx` defers its service-worker-update reload while this is
 * true (`window.location.reload()` is a real, code-provable self-reload
 * path — see its own header comment), so a large (hundreds of MB)
 * in-progress model download/cache-write is never cut off by an unrelated
 * SW update. This is the ONLY thing PwaRegister reads from Phone-LLM code;
 * nothing else changes about SW update behavior for any other route.
 *
 * A plain module-level flag (not React state, not persisted) is enough —
 * `PwaRegister` only reads it once, synchronously, right before it would
 * otherwise call `location.reload()`. It naturally resets on every fresh
 * module load (page load/relaunch), so there is no stale-flag risk.
 */

let active = false;

export function setAyasPhoneLlmDownloadActive(value: boolean): void {
  active = value;
}

export function isAyasPhoneLlmDownloadActive(): boolean {
  return active;
}
