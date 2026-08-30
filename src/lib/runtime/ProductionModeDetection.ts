import os from "node:os";
import path from "node:path";

/**
 * Documentary media effort — Faz 6: "is this an actual production render?"
 *
 * The real-media flags and the `$1` cost guard default to **on** for a real
 * render and **off** everywhere else. A test is anything that:
 *  - runs with `NODE_ENV === "test"`, OR
 *  - points `ATOLYE_RUNTIME_ROOT` at a throwaway directory under the OS temp dir
 *    (every smoke — `withCanonicalSmokeRuntime` and the hand-rolled ones — does
 *    this via `fs.mkdtempSync(os.tmpdir(), …)`).
 *
 * A real render has a live `OPENAI_API_KEY` and a persistent runtime root (unset
 * → in-repo `data/`, or an explicit non-temp path).
 */
export function isRealProductionEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!env.OPENAI_API_KEY?.trim()) return false;
  if (env.NODE_ENV === "test") return false;
  if (isIsolatedTestRuntimeRoot(env.ATOLYE_RUNTIME_ROOT)) return false;
  return true;
}

export function isIsolatedTestRuntimeRoot(runtimeRoot: string | undefined): boolean {
  const root = runtimeRoot?.trim();
  if (!root) return false;
  try {
    const relative = path.relative(os.tmpdir(), path.resolve(root));
    return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
  } catch {
    return false;
  }
}
