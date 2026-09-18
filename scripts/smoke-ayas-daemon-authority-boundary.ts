import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Architecture-level contract test for Step 10 of the owner-approval-model
 * completion pass: the discovery/autonomous-review daemon may inspect,
 * classify, reject, defer, and recommend — it must never approve, mutate the
 * repo, commit, push, or invoke Package C execution directly. The
 * pre-existing invariant of this shape (`smoke-ayas-autonomy-approval.ts`,
 * "Stage 7B ... zero import of AyasExecutionGateStore or executeApproved")
 * is a `doesNotMatch` over each file's raw text — a real import graph is
 * stronger evidence than a substring check (a comment or string literal
 * mentioning the forbidden name could never cause a false negative here, and
 * this also proves the absence TRANSITIVELY, not just in the file's own
 * import list). This module is a small, self-contained TypeScript import-
 * graph walker — no dependency on the `graphify` CLI being installed or
 * `.graphify/` state being fresh, so this test stays hermetic and always
 * runnable, matching every other smoke test in this repo.
 *
 * Deliberately does NOT forbid `AyasAutonomyDaemon.ts` itself: it is a
 * legitimately shared discovery+execution module (`.discover()` is used by
 * the daemon; `.executeApproved()` only by the owner-authorized execution
 * services below) — the same "shared module, narrower entrypoint" shape the
 * pre-existing Stage 7B test already carves an exception for
 * (`app/brain/actions.ts` hosting the one real execution action). Forbidding
 * the module itself would produce a false failure against the correct,
 * already-reviewed architecture; forbidding the three actual mutation/
 * commit/push ORCHESTRATION services below is the real boundary.
 */

const repoRoot = path.resolve(__dirname, "..");
const SRC_ALIAS_ROOT = path.join(repoRoot, "src");
const EXTENSIONS = [".ts", ".tsx"];

/** Never-import-transitively — real mutation/commit/push orchestration, reachable only from an owner-authorized Server Action, never from discovery/review. */
const FORBIDDEN_MODULES = [
  "src/lib/brain/autonomy/AyasProposalApprovalService.ts",
  "src/lib/brain/autonomy/AyasMicroBatchApprovalService.ts",
  "src/lib/brain/autonomy/AyasProposalExecutionService.ts",
  // Durable one-click correction, Step 6/13: the resume worker is a real
  // mutation-capable authority (it publishes through AyasProposalApprovalService
  // exactly like the services above) — it must be reachable ONLY from its own
  // dedicated entrypoint (`scripts/ayas-owner-approval-resume.ts`), never
  // discovered into or triggered by the discovery/autonomous-review daemon.
  "src/lib/brain/autonomy/AyasOwnerApprovalResume.ts",
].map((p) => path.join(repoRoot, p));

const IMPORT_SPEC_PATTERN = /(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,]+from\s+)?["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)|import\(\s*["']([^"']+)["']\s*\)/g;
const GIT_MUTATION_PATTERN = /execFileSync\(\s*["']git["']\s*,\s*\[\s*["'](commit|push|add|-A)["']/;

function resolveModule(fromFile: string, specifier: string): string | undefined {
  let base: string;
  if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(fromFile), specifier);
  } else if (specifier.startsWith("@/")) {
    base = path.join(SRC_ALIAS_ROOT, specifier.slice(2));
  } else {
    return undefined; // bare/external specifier (node:*, react, next/*, etc.) — outside our internal graph
  }
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base;
  for (const ext of EXTENSIONS) {
    if (fs.existsSync(base + ext)) return base + ext;
  }
  for (const ext of EXTENSIONS) {
    const indexed = path.join(base, `index${ext}`);
    if (fs.existsSync(indexed)) return indexed;
  }
  return undefined;
}

interface ClosureResult {
  readonly visited: ReadonlySet<string>;
  readonly gitMutationSites: readonly string[];
}

/** BFS over the internal (relative + `@/`) import graph starting at `entryFile`. */
function transitiveImportClosure(entryFile: string): ClosureResult {
  const visited = new Set<string>();
  const gitMutationSites: string[] = [];
  const queue = [entryFile];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (visited.has(file)) continue;
    visited.add(file);
    const text = fs.readFileSync(file, "utf8");
    if (GIT_MUTATION_PATTERN.test(text)) gitMutationSites.push(file);
    for (const match of text.matchAll(IMPORT_SPEC_PATTERN)) {
      const specifier = match[1] ?? match[2] ?? match[3];
      if (!specifier) continue;
      const resolved = resolveModule(file, specifier);
      if (resolved && !visited.has(resolved)) queue.push(resolved);
    }
  }
  return { visited, gitMutationSites };
}

let count = 0;
function scenario(name: string, fn: () => void) { fn(); count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }

function rel(p: string): string { return path.relative(repoRoot, p).split(path.sep).join("/"); }

const DAEMON_ENTRY_POINTS = [
  path.join(repoRoot, "scripts/ayas-discovery-daemon.ts"),
  path.join(repoRoot, "src/lib/brain/autonomy/AyasAutonomousReview.ts"),
  path.join(repoRoot, "src/lib/brain/autonomy/AyasOwnerRecommendationsView.ts"),
];

function main(): void {
  for (const entry of DAEMON_ENTRY_POINTS) {
    scenario(`${rel(entry)} exists and is a real file`, () => {
      assert.ok(fs.existsSync(entry), `expected entry point to exist: ${rel(entry)}`);
    });

    const closure = transitiveImportClosure(entry);

    scenario(`${rel(entry)}'s transitive import closure is non-trivial (walker actually traverses, not a no-op)`, () => {
      assert.ok(closure.visited.size >= 3, `expected a real transitive closure for ${rel(entry)}, got ${closure.visited.size} file(s)`);
    });

    for (const forbidden of FORBIDDEN_MODULES) {
      scenario(`${rel(entry)} never transitively imports ${rel(forbidden)}`, () => {
        assert.ok(!closure.visited.has(forbidden), `${rel(entry)} must not reach mutation/commit/push authority via ${rel(forbidden)}`);
      });
    }

    scenario(`${rel(entry)}'s transitive closure contains zero direct git commit/push/add call sites`, () => {
      assert.deepEqual(closure.gitMutationSites.map(rel), [], `found direct git-mutation call site(s) reachable from ${rel(entry)}`);
    });
  }

  scenario("sanity: the walker DOES detect a forbidden edge when one genuinely exists (negative-control, proves the test isn't vacuously passing)", () => {
    // `app/brain/actions.ts` is the one file in this repo that legitimately
    // imports all three forbidden services (it hosts the owner-authorized
    // Server Actions) — if the walker failed to find them here, it would
    // mean the resolver itself is broken (e.g. silently failing to resolve
    // `@/`-aliased imports), which would make every "never imports" assertion
    // above meaningless.
    const closure = transitiveImportClosure(path.join(repoRoot, "app/brain/actions.ts"));
    for (const forbidden of FORBIDDEN_MODULES.filter((f) => !f.endsWith("AyasOwnerApprovalResume.ts"))) {
      assert.ok(closure.visited.has(forbidden), `negative control failed — walker did not find known-present edge to ${rel(forbidden)}; resolver may be broken`);
    }
  });

  scenario("sanity: the walker DOES detect a reachable AyasOwnerApprovalResume edge from its own dedicated script entrypoint (negative-control)", () => {
    // `scripts/ayas-owner-approval-resume.ts` is the ONE legitimate caller —
    // proves the resolver can find this specific edge, so its absence from
    // every daemon entry point above is real, not a silently-broken walker.
    const closure = transitiveImportClosure(path.join(repoRoot, "scripts/ayas-owner-approval-resume.ts"));
    const resumeModule = path.join(repoRoot, "src/lib/brain/autonomy/AyasOwnerApprovalResume.ts");
    assert.ok(closure.visited.has(resumeModule), "negative control failed — walker did not find the known-present edge from its own script to AyasOwnerApprovalResume.ts; resolver may be broken");
  });

  console.log(`AYAS daemon authority boundary smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-daemon-authority-boundary", scenarios: count }));
}
main();
