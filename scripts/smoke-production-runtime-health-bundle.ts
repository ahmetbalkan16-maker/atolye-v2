import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// Run only after `next build`. This checks Next's actual separated bundles in
// one isolated process, where instrumentation must initialize the status read by the route.
const root = path.resolve(process.cwd());
const instrumentation = path.join(root, ".next", "server", "instrumentation.js");
const route = path.join(root, ".next", "server", "app", "api", "runtime", "health", "route.js");
assert.ok(fs.existsSync(instrumentation) && fs.existsSync(route), "Run next build first");

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-health-bundle-"));
try {
  const script = `
    (async () => {
      const assert = require("node:assert/strict");
      const hook = require(${JSON.stringify(instrumentation)});
      await hook.register();
      const bundledRoute = require(${JSON.stringify(route)});
      const response = bundledRoute.routeModule.userland.GET();
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.status, "healthy");
      assert.equal(body.runtime?.lifecycleState, "ready");
      assert.equal(body.runtime?.initialized, true);
      assert.equal(body.runtime?.workerReady, true);
      console.log("Production runtime health bundle: PASS");
    })().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  `;
  const child = spawnSync(process.execPath, ["-e", script], {
    cwd: root,
    encoding: "utf8",
    timeout: 30_000,
    env: {
      SystemRoot: process.env.SystemRoot,
      PATH: process.env.PATH,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      NODE_ENV: "production",
      NEXT_RUNTIME: "nodejs",
      ATOLYE_RUNTIME_ROOT: temporaryRoot,
      ATOLYE_RUNTIME_AUTHORITY_ROOT: path.join(temporaryRoot, "authority"),
    },
  });
  assert.equal(child.status, 0, `${child.stderr}\n${child.stdout}`);
  assert.match(child.stdout, /Production runtime health bundle: PASS/);
  console.log(child.stdout.trim());
} finally {
  assert.ok(path.relative(os.tmpdir(), temporaryRoot).startsWith("ayas-health-bundle-"));
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
