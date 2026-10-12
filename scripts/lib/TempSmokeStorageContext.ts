import path from "node:path";
import os from "node:os";
import { createRuntimeStorageContext } from "../../src/lib/runtime/RuntimeStoragePaths";

/** Explicit roots for old store-unit fixtures; a workspace alone grants no write authority. */
export function tempSmokeStorageContext(workspaceRoot: string) {
  const root = path.resolve(workspaceRoot), relative = path.relative(path.resolve(os.tmpdir()), root);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("TEMP_SMOKE_ROOT_NOT_OWNED");
  return createRuntimeStorageContext({ workspaceRoot: root, environment: {
    NODE_ENV: "test", ATOLYE_RUNTIME_ROOT: path.join(root, "data"), ATOLYE_RUNTIME_AUTHORITY_ROOT: path.join(root, "authority"),
  } });
}
