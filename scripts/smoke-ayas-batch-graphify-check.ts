import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { checkAyasBatchItemWithGraphify, AyasBatchGraphifyCheckError } from "../src/lib/brain/autonomy/AyasBatchGraphifyCheck";

let count = 0;
function scenario(name: string, fn: () => void) { fn(); count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }
function git(cwd: string, ...args: string[]) { return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim(); }

/** A minimal isolated repo with one two-import file and one three-import file, node_modules linked so real Graphify AST extraction runs. */
function makeFixture(): { readonly repoRoot: string } {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-graphify-check-"));
  git(repoRoot, "init", "-q"); git(repoRoot, "config", "user.email", "f@example.com"); git(repoRoot, "config", "user.name", "f");
  fs.mkdirSync(path.join(repoRoot, "src"), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "src", "Widget.ts"), 'export class Widget {\n  value = 1;\n}\n', "utf8");
  fs.writeFileSync(
    path.join(repoRoot, "scripts", "two-imports.ts"),
    'import assert from "node:assert/strict";\nimport { Widget } from "../src/Widget";\nassert.ok(new Widget());\n',
    "utf8",
  );
  fs.writeFileSync(
    path.join(repoRoot, "scripts", "three-imports.ts"),
    'import assert from "node:assert/strict";\nimport path from "node:path";\nimport { Widget } from "../src/Widget";\nassert.ok(path.sep && new Widget());\n',
    "utf8",
  );
  fs.writeFileSync(path.join(repoRoot, ".gitignore"), "node_modules/\n.graphify/\nscripts/.graphify/\n");
  git(repoRoot, "add", "-A"); git(repoRoot, "commit", "-q", "-m", "initial");
  fs.mkdirSync(path.join(repoRoot, "node_modules"), { recursive: true });
  fs.symlinkSync(path.join(process.cwd(), "node_modules", "tsx"), path.join(repoRoot, "node_modules", "tsx"), process.platform === "win32" ? "junction" : "dir");
  fs.symlinkSync(path.join(process.cwd(), "node_modules", "typescript"), path.join(repoRoot, "node_modules", "typescript"), process.platform === "win32" ? "junction" : "dir");
  fs.symlinkSync(path.join(process.cwd(), "node_modules", "@types"), path.join(repoRoot, "node_modules", "@types"), process.platform === "win32" ? "junction" : "dir");
  return { repoRoot };
}

function main(): void {
  const { repoRoot } = makeFixture();

  scenario("checkAyasBatchItemWithGraphify PASSES when the real import count matches the expected count", () => {
    const result = checkAyasBatchItemWithGraphify(repoRoot, "scripts/two-imports.ts", 2);
    assert.equal(result.importEdgeCount, 2);
    assert.equal(result.filePath, "scripts/two-imports.ts");
  });

  scenario("checkAyasBatchItemWithGraphify THROWS AYAS_GRAPHIFY_UNEXPECTED_DEPENDENCY when the real import count exceeds the expected count", () => {
    assert.throws(
      () => checkAyasBatchItemWithGraphify(repoRoot, "scripts/three-imports.ts", 2),
      (e: unknown) => e instanceof AyasBatchGraphifyCheckError && e.code === "AYAS_GRAPHIFY_UNEXPECTED_DEPENDENCY",
    );
  });

  scenario("checkAyasBatchItemWithGraphify THROWS AYAS_GRAPHIFY_UNEXPECTED_DEPENDENCY when the real import count is LOWER than expected (a deviation in either direction is unexpected)", () => {
    assert.throws(
      () => checkAyasBatchItemWithGraphify(repoRoot, "scripts/two-imports.ts", 5),
      (e: unknown) => e instanceof AyasBatchGraphifyCheckError && e.code === "AYAS_GRAPHIFY_UNEXPECTED_DEPENDENCY",
    );
  });

  scenario("checkAyasBatchItemWithGraphify THROWS AYAS_GRAPHIFY_UNAVAILABLE when the global graphify module path is wrong — a missing tool is a genuine reported failure, never silently skipped", () => {
    const prior = process.env.AYAS_GRAPHIFY_GLOBAL_MODULES;
    process.env.AYAS_GRAPHIFY_GLOBAL_MODULES = path.join(os.tmpdir(), "definitely-does-not-exist-node-modules");
    try {
      assert.throws(
        () => checkAyasBatchItemWithGraphify(repoRoot, "scripts/two-imports.ts", 2),
        (e: unknown) => e instanceof AyasBatchGraphifyCheckError && e.code === "AYAS_GRAPHIFY_UNAVAILABLE",
      );
    } finally {
      if (prior === undefined) delete process.env.AYAS_GRAPHIFY_GLOBAL_MODULES; else process.env.AYAS_GRAPHIFY_GLOBAL_MODULES = prior;
    }
  });

  scenario("checking a non-existent file surfaces as AYAS_GRAPHIFY_EXTRACT_FAILED, never a silent pass", () => {
    assert.throws(
      () => checkAyasBatchItemWithGraphify(repoRoot, "scripts/does-not-exist.ts", 2),
      (e: unknown) => e instanceof AyasBatchGraphifyCheckError,
    );
  });

  console.log(`AYAS batch Graphify check smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-batch-graphify-check", scenarios: count }));
}
main();
