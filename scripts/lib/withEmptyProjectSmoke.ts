import fs from "node:fs/promises";
import path from "node:path";
import { withCanonicalSmokeRuntime } from "./CanonicalSmokeRuntime";

/** Missing-artifact UI fixtures still need a run-owned directory for the canonical read lock. */
export async function withEmptyProjectSmoke(slug: string, name: string, run: () => Promise<void>): Promise<void> {
  if (!/^[a-zA-Z0-9_-]+$/.test(slug)) throw new Error("EMPTY_PROJECT_SMOKE_SLUG_INVALID");
  await withCanonicalSmokeRuntime({ name, projectSlug: slug }, async runtime => {
    await fs.mkdir(path.join(runtime.runtimeRoot, "projects", slug), { recursive: true });
    await run();
  });
}
