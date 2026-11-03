// One command for the AYAS UI audit: an isolated copy of AYAS (next dev from this checkout on 127.0.0.1:3210), a
// throwaway access key, the V3 runtime's small records copied to temp, every page swept by ui-audit.mjs; then the
// server is stopped, next dev's AGENTS.md edit undone and the temp copies deleted. The live app is never touched.
//
//   node .claude/skills/ayas-ui-audit/scripts/run-audit.mjs [--routes '<json array>'] [--actions] [--probe '<json>']
//
// --actions also presses the owner's everyday buttons on the test server (12 Control Center cards, homepage views,
// chat "Gönder" through the local Ollama model, briefing "Gördüm", "Çıkış"). --probe '[{"route":…,"label":"<regex>"}]'
// clicks every control whose label matches, each on a fresh page (for details/summary toggles).
// Exit code: 0 clean, 1 problems found, 2 refused or failed to start.
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = process.cwd();
const PORT = 3210;
const base = `http://127.0.0.1:${PORT}`;
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const log = (s) => console.log(s);
const fail = (s) => {
  console.error(`DURDU: ${s}`);
  process.exit(2);
};
const git = (...a) => execFileSync("git", a, { cwd: repo, encoding: "utf8" }).trim();

// --- Refusals: only a development checkout, never one that reaches live state. ---
if (!existsSync(path.join(repo, "app")) || !existsSync(path.join(repo, "node_modules", "next"))) fail(`${repo} bir AYAS kopyası değil (app/ ya da node_modules/next yok)`);
if (path.resolve(repo, git("rev-parse", "--git-dir")) === path.resolve(repo, git("rev-parse", "--git-common-dir")))
  fail("bu ana (canonical) kopya: orada .env.local canlı çalışma köküne bakar ve data/brain gözlemcinindir — bir geliştirme worktree'sinde çalıştır");
for (const f of [".env", ".env.local", ".env.development", ".env.development.local"]) if (existsSync(path.join(repo, f))) fail(`${f} var: next dev onu okur (canlı anahtarlar ve çalışma kökü) — bu kopyada tarama yapılmaz`);
const busy = await fetch(`${base}/login`, { signal: AbortSignal.timeout(2000) }).then(() => true, () => false);
if (busy) fail(`${PORT} portunda zaten bir sunucu var; önce onu kapat`);

// --- Temp area on D (owner rule: work files stay on D). ---
const tempRoot = process.env.AUDIT_ROOT ?? "D:\\ÜRETİM\\private\\temp\\ui-audit";
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "");
const area = path.join(tempRoot, stamp);
const out = path.join(area, "out");
mkdirSync(out, { recursive: true });
const keyFile = path.join(area, "test-key.txt");
writeFileSync(keyFile, randomBytes(24).toString("hex"));

// The V3 runtime's small records (orders, brains' memory, reports), so the pages show real states without the media.
const v3Source = (() => {
  const f = path.join(repo, ".env.v3.local");
  const m = existsSync(f) ? /^ATOLYE_V3_WORK_ROOT=(.+)$/m.exec(readFileSync(f, "utf8")) : null;
  return m ? m[1].trim() : "D:\\ÜRETİM\\Atolye\\v3-runtime";
})();
const v3Copy = path.join(area, "v3-runtime");
if (existsSync(path.join(v3Source, "_kutuphane"))) {
  cpSync(path.join(v3Source, "_kutuphane"), path.join(v3Copy, "_kutuphane"), {
    recursive: true,
    filter: (src) => {
      const st = statSync(src);
      return st.isDirectory() || (st.size < 1024 * 1024 && /\.(json|jsonl|md|log|txt)$/i.test(src));
    },
  });
} else mkdirSync(v3Copy, { recursive: true });
const runtimeRoot = path.join(area, "runtime");
const authorityRoot = path.join(area, "authority");
mkdirSync(path.join(runtimeRoot, "projects"), { recursive: true });
mkdirSync(authorityRoot, { recursive: true });

// --- The isolated server. Blank (not deleted) keys: Next never fills a variable that is set, even empty, from a .env. ---
const agentsClean = (() => {
  try {
    execFileSync("git", ["diff", "--quiet", "--", "AGENTS.md"], { cwd: repo });
    return true;
  } catch {
    return false;
  }
})();
const env = {
  ...process.env,
  OPENAI_API_KEY: "",
  ANIMATION_OPENAI_ENDPOINT: "",
  ATOLYE_DURABLE_PIPELINE_EXECUTION: "",
  AYAS_AUTONOMOUS_EXECUTION_ENABLED: "",
  // Project storage and its authority leases in the temp area (a blank root is rejected as invalid, by design).
  ATOLYE_RUNTIME_ROOT: runtimeRoot,
  ATOLYE_RUNTIME_AUTHORITY_ROOT: authorityRoot,
  AYAS_ACCESS_KEY: readFileSync(keyFile, "utf8"),
  OLLAMA_HOST: "http://127.0.0.1:11434",
  OLLAMA_MODEL: "qwen2.5:3b",
  OLLAMA_MAX_RETRIES: "3",
  OLLAMA_NUM_CTX: "8192",
  ATOLYE_V3_WORK_ROOT: v3Copy,
  TEMP: "D:\\ÜRETİM\\private\\temp",
  TMP: "D:\\ÜRETİM\\private\\temp",
  NPM_CONFIG_CACHE: "D:\\ÜRETİM\\private\\npm-cache",
  NEXT_TELEMETRY_DISABLED: "1",
};
const devLog = path.join(out, "dev.log");
const { openSync } = await import("node:fs");
const logFd = openSync(devLog, "a");
const server = spawn(process.execPath, [path.join(repo, "node_modules", "next", "dist", "bin", "next"), "dev", "-H", "127.0.0.1", "-p", String(PORT)], { cwd: repo, env, stdio: ["ignore", logFd, logFd], windowsHide: true });
log(`izole sunucu: ${base} (pid ${server.pid}), günlük ${devLog}`);

let stopped = false;
function stop() {
  if (stopped) return;
  stopped = true;
  try {
    execFileSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  } catch {
    // already gone
  }
  // next dev appends its "nextjs-agent-rules" block to AGENTS.md at boot.
  if (agentsClean) {
    try {
      execFileSync("git", ["checkout", "--", "AGENTS.md"], { cwd: repo, stdio: "ignore" });
    } catch {
      // nothing to undo
    }
  }
  for (const p of [keyFile, v3Copy, runtimeRoot, authorityRoot, path.join(out, "chrome-profile")]) rmSync(p, { recursive: true, force: true });
}
process.on("exit", stop);
process.on("SIGINT", () => process.exit(130));

// A cold dev server compiles the login page first (a few minutes on this PC).
const t0 = Date.now();
let up = false;
while (Date.now() - t0 < 6 * 60_000) {
  if (server.exitCode !== null) break;
  up = await fetch(`${base}/login`, { signal: AbortSignal.timeout(30_000) }).then((r) => r.status === 200, () => false);
  if (up) break;
  await new Promise((r) => setTimeout(r, 3000));
}
if (!up) {
  console.error(`DURDU: sunucu açılmadı — ${devLog}`);
  process.exit(2);
}
log(`sunucu hazır (${Math.round((Date.now() - t0) / 1000)} sn)`);

// --- Routes: every static page under app/, every /brain panel, and one missing project (the not-found page). ---
function discoverRoutes() {
  const pages = [];
  const walk = (dir, url) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith("[") || e.name.startsWith("_") || e.name === "api") continue;
      const sub = e.name.startsWith("(") ? url : `${url}/${e.name}`;
      if (existsSync(path.join(dir, e.name, "page.tsx"))) pages.push(sub);
      walk(path.join(dir, e.name), sub);
    }
  };
  if (existsSync(path.join(repo, "app", "page.tsx"))) pages.push("/");
  walk(path.join(repo, "app"), "");
  const core = readFileSync(path.join(repo, "src", "components", "brain", "brainCore.ts"), "utf8");
  const union = /export type BrainPanelId =([^;]+);/.exec(core)?.[1] ?? "";
  const panels = [...union.matchAll(/"([a-z-]+)"/g)].map((m) => `/brain?panel=${m[1]}`);
  return [...new Set([...pages.filter((p) => p !== "/login"), ...panels, "/project/olmayan-proje"])];
}
const routes = arg("--routes") ? JSON.parse(arg("--routes")) : discoverRoutes();
log(`${routes.length} sayfa taranacak`);

const driver = path.join(here, "ui-audit.mjs");
const run = (name, routeList, extraEnv) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [driver, base, path.join(out, name), JSON.stringify(routeList)], { cwd: repo, env: { ...process.env, AUDIT_KEY_FILE: keyFile, ...extraEnv }, stdio: ["ignore", "pipe", "inherit"] });
    child.stdout.on("data", (d) => process.stdout.write(d));
    child.on("exit", (c) => resolve(c ?? 1));
  });

let problems = 0;
const lines = [`# AYAS UI denetimi — ${new Date().toLocaleString("tr-TR")}`, "", `Kopya: ${repo} (${git("rev-parse", "--short", "HEAD")}), izole sunucu ${base}, test anahtarı tek kullanımlık.`, ""];
if ((await run("tarama", routes, {})) !== 0) problems++;
const reportFile = path.join(out, "tarama", "report.json");
if (existsSync(reportFile)) {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  // A toggle the sweep could not reach (it went out of sight when another one opened) is tried again on a freshly
  // loaded page, every instance of it; it counts only if that fails too (3 Nov 2026: 11 such headers, all fine).
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const retry = [...new Map(report.flatMap((e) => e.controls.filter((c) => !c.clicked && !c.errors.length && !c.problems.length).map((c) => [`${e.route}|${c.label}`, { route: e.route, label: `^${escape(c.label)}$` }]))).values()];
  const reached = new Set();
  if (retry.length) {
    log(`${retry.length} ulaşılamayan kontrol temiz sayfada yeniden deneniyor`);
    await run("yeniden", [], { AUDIT_PROBE: JSON.stringify(retry) });
    const probeFile = path.join(out, "yeniden", "probe.json");
    const probed = existsSync(probeFile) ? JSON.parse(readFileSync(probeFile, "utf8")) : [];
    for (const r of retry) {
      const runs = probed.filter((p) => p.route === r.route && new RegExp(r.label).test(p.label));
      if (runs.length && runs.every((p) => p.clicked && !p.errors.length && !p.loadErrs.length && !p.probs.length)) reached.add(`${r.route}|${runs[0].label}`);
    }
  }
  let clicked = 0;
  lines.push("## Sayfalar", "");
  for (const e of report) {
    const bad = e.controls.filter((c) => (!c.clicked && !reached.has(`${e.route}|${c.label}`)) || c.errors.length || c.problems.length);
    clicked += e.controls.length;
    // The missing project is asked for on purpose: its 404 and "could not be found" are the not-found page working.
    const missing = e.route.startsWith("/project/olmayan");
    if (missing) {
      e.loadErrors = e.loadErrors.filter((x) => !/404/.test(`${x.kind} ${x.text}`));
      e.pageProblems = e.pageProblems.filter((x) => !/could not be found/.test(x));
    }
    const ok = (e.status === 200 || (missing && e.status === 404)) && !e.loadErrors.length && !e.pageProblems.length && !bad.length;
    if (!ok) problems++;
    lines.push(`- ${ok ? "✓" : "✗"} \`${e.route}\` HTTP ${e.status} — ${e.controls.length} kontrol tıklandı, ${e.actions.length} eylem düğmesi basılmadı`);
    for (const x of e.loadErrors) lines.push(`  - açılışta ${x.kind}: ${x.text}`);
    for (const x of e.pageProblems) lines.push(`  - sayfa: ${x}`);
    for (const c of bad) lines.push(`  - "${c.label}": ${!c.clicked ? "tıklanamadı" : ""} ${c.errors.map((x) => `${x.kind}: ${x.text}`).join(" | ")} ${c.problems.join("; ")}`.trimEnd());
  }
  lines.push("", `Toplam: ${report.length} sayfa, ${clicked} görünüm kontrolü tıklandı${reached.size ? `; ${reached.size} açılır başlık temiz sayfada yeniden denendi ve çalıştı` : ""}.`);
} else {
  problems++;
  lines.push("Tarama raporu yazılmadı — konsol çıktısına bak.");
}
if (arg("--probe")) {
  lines.push("", "## Prob", "", `Ayrıntı: ${path.join(out, "prob", "probe.json")}`);
  if ((await run("prob", [], { AUDIT_PROBE: arg("--probe") })) !== 0) problems++;
}
if (process.argv.includes("--actions")) {
  lines.push("", "## Günlük düğmeler (izole sunucuda gerçekten basıldı)", "", "Konsol çıktısındaki `kart`, `ana sayfa`, `sohbet`, `brifing`, `çıkış` satırları.");
  if ((await run("eylemler", [], { AUDIT_ACTIONS: "1" })) !== 0) problems++;
}
const devErrors = readFileSync(devLog, "utf8").split(/\r?\n/).filter((l) => /⨯|Unhandled|Error:/.test(l) && !/warn/i.test(l));
if (devErrors.length) lines.push("", "## Sunucu günlüğündeki hatalar", "", ...devErrors.slice(0, 30).map((l) => `- ${l.slice(0, 240)}`));
writeFileSync(path.join(out, "OZET.md"), `${lines.join("\n")}\n`);
stop();
log(`\nözet: ${path.join(out, "OZET.md")} — ${problems ? `${problems} sorunlu kalem` : "sorun yok"}`);
process.exit(problems ? 1 : 0);
