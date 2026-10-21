// Full smoke scan: every scripts/smoke-*.ts, first in parallel, then each failure again on its own; failures are sorted
// into frozen evidence (expected), environment (this checkout or machine lacks what the suite needs) and real ones.
//
//   node scripts/tum-smokelar.mjs [--paralel 4] [--cikti <file.json>] [--yalniz <regex>]  (--yalniz: only matching suites)
//
// Run it in a V3/dev worktree, not the live canonical repo. TEMP: D:\ÜRETİM\private\temp (the runtime-storage suites
// refuse the ASCII junction D:\URETIM, which is their link-escape guard working); the STT/wake/Piper suites want the
// ASCII junction (see AGENTS.md) and pass there. The 21 Oct 2026 scan: 625 suites, 586 PASS in parallel, all but one of
// the rest environment or frozen; the one real regression (V3's budget importing the Stage 15K cost governor) was fixed.
import { spawn } from "node:child_process";
import { readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const repo = process.cwd();
const parallel = Math.max(1, Number(arg("--paralel", "4")));
const out = arg("--cikti", path.join(repo, "output", "tum-smokelar.json"));

/** Not run: a helper another suite spawns, and a probe that registers a real Windows scheduled task. */
const NOT_STANDALONE = new Set(["smoke-sprint-129-36-race-worker.ts", "smoke-ayas-observer-autostart.ts"]);
/** Frozen evidence kept byte-identical with its raw FAIL; each has a passing successor. */
const FROZEN_FAIL = new Map([
  ["smoke-ayas-retrieval-evaluation.ts", "successor smoke-ayas-retrieval-evaluation-v3.ts (CF49 exact12)"],
  ["smoke-ayas-owner-approval-resume.ts", "successor smoke-ayas-owner-approval-resume-v2.ts (K3 policy, 2026-10-08)"],
]);
/** What a checkout or machine may lack: per-machine assets, live project data, real FFmpeg, a build, a harness. */
const ENVIRONMENT = [
  [/public[\\/]wake[\\/].*\.onnx/, "wake model assets not staged (scripts/setup-wake-assets.ts)"],
  [/data[\\/]projects[\\/]/, "live project data exists only in the canonical repo"],
  [/Runtime storage link policy rejected the path/, "TEMP is a junction (link-escape guard refuses it)"],
  [/FFMPEG_PATH|real FFmpeg|Video provider configuration is invalid/, "real FFmpeg / video provider env not set"],
  [/Run next build first/, "needs a Next build of this checkout"],
  [/AYAS_STAGE9_REQUIRES_TEMP_ARCHIVE/, "needs the Stage 9 temp-archive harness"],
  [/OWNED_TEMP_PROJECT_REQUIRED/, "the forbidden live project is absent here (data/projects)"],
];

function run(file, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn("npx.cmd", ["tsx", path.join("scripts", file)], { cwd: repo, env: process.env, shell: true, windowsHide: true });
    let text = "";
    const keep = (d) => {
      text += d.toString("utf8");
      if (text.length > 30000) text = text.slice(-30000);
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const timer = setTimeout(() => {
      spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { shell: true, windowsHide: true });
      resolve({ file, status: "TIMEOUT", tail: text.slice(-2500) });
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ file, status: code === 0 ? "PASS" : "FAIL", ...(code === 0 ? {} : { tail: text.slice(-2500) }) });
    });
  });
}

const only = arg("--yalniz", undefined);
const files = readdirSync(path.join(repo, "scripts")).filter((f) => /^smoke-.*\.ts$/.test(f) && !NOT_STANDALONE.has(f) && (!only || new RegExp(only).test(f))).sort();
const first = [];
let next = 0;
await Promise.all(
  Array.from({ length: parallel }, async () => {
    while (next < files.length) first.push(await run(files[next++], 300_000));
  }),
);
// Each failure once more on its own: a suite that passes alone only collided with another (ports, locks, load).
const final = [];
for (const r of first) {
  if (r.status === "PASS") final.push({ ...r, kind: "PASS" });
  else {
    const again = await run(r.file, 360_000);
    const why = ENVIRONMENT.find(([re]) => re.test(again.tail ?? ""));
    final.push(
      again.status === "PASS"
        ? { ...again, kind: "PASS_ALONE" }
        : FROZEN_FAIL.has(r.file)
          ? { ...again, kind: "FROZEN", note: FROZEN_FAIL.get(r.file) }
          : why
            ? { ...again, kind: "ENVIRONMENT", note: why[1] }
            : { ...again, kind: "REAL" },
    );
  }
}
writeFileSync(out, JSON.stringify(final, null, 1));
const count = (k) => final.filter((r) => r.kind === k).length;
console.log(`tum smokelar (${final.length}, ${NOT_STANDALONE.size} yardimci/OS denemesi haric): PASS ${count("PASS")}, yalniz kosunca PASS ${count("PASS_ALONE")}, dondurulmus ${count("FROZEN")}, ortam ${count("ENVIRONMENT")}, GERCEK ${count("REAL")} → ${out}`);
for (const r of final.filter((x) => x.kind === "REAL")) console.log(`GERCEK ${r.status} ${r.file}`);
process.exit(count("REAL") ? 1 : 0);
