import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { withCanonicalSmokeRuntime } from "./lib/CanonicalSmokeRuntime";

const script = process.argv[2];
if (!script || path.basename(script) !== script || !/^smoke-[a-z0-9-]+\.ts$/.test(script)) {
  throw new TypeError("Canonical smoke child script is invalid.");
}

async function main(): Promise<void> {
  const name = `external-${createHash("sha256").update(script).digest("hex").slice(0, 16)}`;
  await withCanonicalSmokeRuntime({ name,
    configureProductionExecution: false, enterOperationContext: false,
    environment: {
      THUMBNAIL_SMOKE_SCENARIO:
        process.env.ATOLYE_EXTERNAL_THUMBNAIL_SMOKE_SCENARIO,
    } }, async (runtime) => {
  let resolveTerminal!: () => void;
  const terminal = new Promise<void>((resolve) => { resolveTerminal = resolve; });
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array, ...args: unknown[]) => {
    const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    const result = originalWrite(chunk, ...(args as [never]));
    if (text.includes("ATOLYE_SMOKE_RESULT ")) resolveTerminal();
    return result;
  }) as typeof process.stdout.write;
  await import(pathToFileURL(path.join(process.cwd(), "scripts", script)).href);
  await withTimeout(terminal, 300_000);
  await waitForNestedFoundationFinalization(runtime.tempRoot);
  });
}

async function withTimeout(operation: Promise<void>, timeoutMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Canonical smoke child terminal result timed out.")), timeoutMs);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

async function waitForNestedFoundationFinalization(tempRoot: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (true) {
    const nested = (await import("node:fs/promises")).readdir(tempRoot)
      .then((names) => names.some((name) => name.startsWith("atolye-smoke-")))
      .catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? false : Promise.reject(error));
    if (!(await nested)) return;
    if (Date.now() >= deadline) throw new Error("Nested canonical smoke finalization timed out.");
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
}

void main();
