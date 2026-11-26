/**
 * Atölye security brain ("Bekçi") — one watch round (owner 2026-11-26: "sistemimizi koruyacak, kendini geliştirecek").
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/ayas-security-watch.ts [--force]
 *
 * Run by the AYAS observer every tick (5 min) as an arm's-length child; it does real work only when a check is due:
 *   every 15 min  login records, passcode/gate, route protection
 *   hourly        listening ports, Windows firewall allow rules on the Public profile, live snapshot integrity
 *   on new HEAD   credential-shaped strings and tracked .env files in Git (at least daily)
 *   daily         known vulnerabilities of the shipped packages (osv.dev, names and versions only, via the existing CLI)
 *   weekly        the exam (seeded incidents must be caught, a clean machine must stay quiet)
 *
 * Local measurements only: no port scan, no LAN access, nothing sent anywhere except the daily osv.dev query the
 * existing vulnerability CLI already makes. It changes nothing on the machine; the only automatic defence (the
 * brute-force login lock) lives in the login route. Writes data/brain/security/{report,watch-state}.json and appends
 * the case library. Prints one JSON line.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { isProtectedPath, resolveAccessGate } from "../src/lib/auth/accessGate";

/**
 * The live snapshot folder the access supervisor serves (<studio>\private\AtolyeAyasAccess\published-application-v1.json).
 * Read here directly rather than through the autonomy modules, so the watcher reaches nothing owner-only.
 */
function readPublishedLiveRoot(repoRoot: string): string {
  const studio = path.resolve(repoRoot, "..", "..");
  const selector = JSON.parse(fs.readFileSync(path.join(studio, "private", "AtolyeAyasAccess", "published-application-v1.json"), "utf8")) as { schemaVersion?: number; applicationRoot?: unknown };
  if (selector.schemaVersion !== 1 || typeof selector.applicationRoot !== "string") throw new Error("published application selector is invalid");
  return path.resolve(selector.applicationRoot);
}
import {
  evaluateSecurityWatch, runSecurityExam, vetLearnedChecks, WATCHED_PORTS,
  type FirewallAllowRule, type ListeningPort, type Measured, type SecretHit, type SecurityExamResult, type SecurityFinding, type SecurityWatchFacts, type VulnerabilityCount,
} from "../src/lib/brain/security/SecurityWatchModel";
import { LEARNED_SECURITY_CHECKS } from "../src/lib/security-watch/LearnedChecks";
import { deriveSecurityNeeds, graceApproveSecurityProposals, proposeSecurityImprovements } from "../src/lib/brain/security/SecurityWatchImprovement";
import { resolveV3Paths } from "../src/lib/v3/V3Paths";
import { readLoginFacts, readSecurityCases, readSecurityWatchReport, readWatchState, recordSecurityCases, writeSecurityWatchReport, writeWatchState } from "../src/lib/brain/security/SecurityWatchStore";

const root = process.cwd();
const MIN = 60_000;
const ROUND_MS = 14 * MIN;
const HOURLY_MS = 60 * MIN;
const DAILY_MS = 24 * 60 * MIN;
const WEEKLY_MS = 7 * DAILY_MS;

/** Routes that must always need a session. */
const SENSITIVE_ROUTES = ["/", "/brain", "/brain/revenue", "/brain/constitution", "/studio", "/studio/office-preview", "/api/ayas/chat", "/api/pipeline", "/api/projects"];

/** Credential shapes; a match counts only if it also looks random (has digits), so prose like "sk-Scheduler-…" does not. */
const SECRET_PATTERNS: readonly { readonly kind: string; readonly re: string }[] = [
  { kind: "OpenAI anahtarı", re: "sk-(proj-)?[A-Za-z0-9_-]{32,}" },
  { kind: "AWS erişim anahtarı", re: "AKIA[0-9A-Z]{16}" },
  { kind: "Google API anahtarı", re: "AIza[0-9A-Za-z_-]{35}" },
  { kind: "özel anahtar (PEM)", re: "-----BEGIN [A-Z ]*PRIVATE KEY-----" },
  { kind: "GitHub token", re: "gh[pousr]_[A-Za-z0-9]{36}" },
  { kind: "Slack token", re: "xox[baprs]-[A-Za-z0-9-]{10,}" },
];
/** Test fixtures and docs carry fake keys on purpose. */
const SECRET_EXCLUDES = [":!scripts/smoke-*", ":!*.example", ":!*.md", ":!docs/**", ":!package-lock.json", ":!**/package-lock.json"];

interface WatchState {
  readonly schemaVersion: 1;
  readonly lastRoundAt?: string;
  readonly hourlyAt?: string;
  readonly secretsAt?: string;
  readonly secretsHead?: string;
  readonly vulnsAt?: string;
  readonly examAt?: string;
  readonly cache?: Partial<Pick<SecurityWatchFacts, "ports" | "firewall" | "liveIntegrity" | "secrets" | "vulnerabilities">>;
  readonly exam?: SecurityExamResult;
}

const due = (last: string | undefined, everyMs: number, nowMs: number) => !last || nowMs - Date.parse(last) >= everyMs;
const failed = <T,>(at: string, error: unknown): Measured<T> => ({ value: null, at, error: (error instanceof Error ? error.message : String(error)).split(/\r?\n/)[0]!.slice(0, 200) });

function powershellJson<T>(script: string): T[] {
  const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ${script}`], { encoding: "utf8", windowsHide: true, timeout: 60_000, maxBuffer: 4_000_000, stdio: ["ignore", "pipe", "ignore"] }).trim();
  if (!out) return [];
  const parsed = JSON.parse(out) as T | T[];
  return Array.isArray(parsed) ? parsed : [parsed];
}

function measurePorts(at: string): Measured<readonly ListeningPort[]> {
  try {
    const rows = powershellJson<{ p: number; a: string; n: string | null }>(
      "Get-NetTCPConnection -State Listen | ForEach-Object { [pscustomobject]@{ p = $_.LocalPort; a = $_.LocalAddress; n = (Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).ProcessName } } | ConvertTo-Json -Compress",
    );
    return { value: rows.map((r) => ({ port: Number(r.p), address: String(r.a), process: r.n ?? "?" })), at };
  } catch (error) { return failed(at, error); }
}

function measureFirewall(at: string): Measured<readonly FirewallAllowRule[]> {
  const watched = Object.keys(WATCHED_PORTS).map((p) => `'${p}'`).join(",");
  try {
    const rows = powershellJson<{ n: string; p: string[] | string; f: string }>(
      "$pf = @{}; Get-NetFirewallPortFilter -All -ErrorAction SilentlyContinue | ForEach-Object { $pf[$_.InstanceID] = @($_.LocalPort) }; " +
      "Get-NetFirewallRule -Enabled True -Direction Inbound -Action Allow | Where-Object { [string]$_.Profile -match 'Public|Any' } | ForEach-Object { " +
      `$ports = $pf[$_.Name]; if ($ports | Where-Object { $_ -in @(${watched}) }) { [pscustomobject]@{ n = $_.DisplayName; p = @($ports | ForEach-Object { [string]$_ }); f = [string]$_.Profile } } } | ConvertTo-Json -Compress`,
    );
    return { value: rows.map((r) => ({ name: r.n, ports: Array.isArray(r.p) ? r.p : [r.p], profiles: r.f })), at };
  } catch (error) { return failed(at, error); }
}

function measureLiveIntegrity(at: string): Measured<{ snapshot: string; modified: string[]; headMatches: boolean }> {
  try {
    const live = readPublishedLiveRoot(root);
    const snapshot = path.basename(live);
    const modified = execFileSync("git", ["-C", live, "status", "--porcelain", "--untracked-files=no"], { encoding: "utf8", windowsHide: true, timeout: 120_000 })
      .split(/\r?\n/).filter(Boolean).map((line) => line.slice(3));
    const head = execFileSync("git", ["-C", live, "rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true }).trim();
    const named = /^ayas-live-([0-9a-f]{7,40})$/.exec(snapshot)?.[1];
    return { value: { snapshot, modified, headMatches: named ? head.startsWith(named) : false }, at };
  } catch (error) { return failed(at, error); }
}

function measureSecrets(at: string): Measured<readonly SecretHit[]> {
  try {
    const hits: SecretHit[] = [];
    for (const { kind, re } of SECRET_PATTERNS) {
      let out = "";
      try {
        out = execFileSync("git", ["grep", "-I", "-o", "-E", "-e", re, "--", ".", ...SECRET_EXCLUDES], { cwd: root, encoding: "utf8", windowsHide: true, timeout: 60_000, maxBuffer: 8_000_000 });
      } catch (error) {
        // git grep exits 1 when nothing matched.
        if ((error as { status?: number }).status === 1) continue;
        throw error;
      }
      for (const line of out.split(/\r?\n/).filter(Boolean)) {
        const at2 = line.indexOf(":");
        const file = line.slice(0, at2);
        const token = line.slice(at2 + 1);
        if (kind !== "özel anahtar (PEM)" && !/\d.*\d/.test(token)) continue;
        if (!hits.some((h) => h.file === file && h.kind === kind)) hits.push({ file, kind });
      }
    }
    const envFiles = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8", windowsHide: true, maxBuffer: 16_000_000 })
      .split(/\r?\n/).filter((f) => /(^|\/)\.env(\.|$)/.test(f) && !f.endsWith(".example"));
    for (const file of envFiles) hits.push({ file, kind: "Git'te .env dosyası" });
    return { value: hits, at };
  } catch (error) { return failed(at, error); }
}

function measureVulnerabilities(at: string): Measured<VulnerabilityCount> {
  try {
    const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
    const out = execFileSync(process.execPath, [tsxCli, path.join(root, "scripts", "ayas-dependency-vulnerabilities.ts"), "--json"], { cwd: root, encoding: "utf8", windowsHide: true, timeout: 150_000, maxBuffer: 16_000_000 });
    const report = JSON.parse(out.trim().split(/\r?\n/).at(-1) ?? "{}") as { locks?: { lock: string; vulnerabilities: { id: string; severity: string; dev: boolean }[] }[] };
    const shipped = (report.locks ?? []).filter((l) => l.lock === "package-lock.json").flatMap((l) => l.vulnerabilities).filter((v) => !v.dev);
    const count = (s: string) => shipped.filter((v) => v.severity.toLowerCase() === s).length;
    return { value: { critical: count("critical"), high: count("high"), moderate: count("moderate") + count("medium"), low: count("low"), topIds: shipped.filter((v) => /critical|high/i.test(v.severity)).map((v) => v.id).slice(0, 6) }, at };
  } catch (error) { return failed(at, error); }
}

async function main(): Promise<void> {
  const now = new Date();
  const nowIso = now.toISOString();
  const nowMs = now.getTime();
  const force = process.argv.includes("--force");
  const state: WatchState = readWatchState<WatchState>(root) ?? { schemaVersion: 1 };
  if (!force && !due(state.lastRoundAt, ROUND_MS, nowMs)) {
    console.log(JSON.stringify({ status: "NOT_DUE", lastRoundAt: state.lastRoundAt }));
    return;
  }
  const cache = { ...(state.cache ?? {}) };
  const head = (() => { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true }).trim(); } catch { return ""; } })();
  const ran: string[] = ["giris"];

  const hourly = force || due(state.hourlyAt, HOURLY_MS, nowMs);
  if (hourly) {
    cache.ports = measurePorts(nowIso);
    cache.firewall = measureFirewall(nowIso);
    cache.liveIntegrity = measureLiveIntegrity(nowIso);
    ran.push("port", "guvenlik-duvari", "canli");
  }
  const secretsDue = force || due(state.secretsAt, DAILY_MS, nowMs) || state.secretsHead !== head;
  if (secretsDue) { cache.secrets = measureSecrets(nowIso); ran.push("sir"); }
  const vulnsDue = force || due(state.vulnsAt, DAILY_MS, nowMs);
  if (vulnsDue) { cache.vulnerabilities = measureVulnerabilities(nowIso); ran.push("acik"); }
  const examDue = force || due(state.examAt, WEEKLY_MS, nowMs);
  const exam = examDue ? runSecurityExam(nowIso) : state.exam;
  if (examDue) ran.push("sinav");

  let login: Measured<ReturnType<typeof readLoginFacts>>;
  try { login = { value: readLoginFacts(nowMs, root), at: nowIso }; } catch (error) { login = failed(nowIso, error); }
  const gate = resolveAccessGate(process.env);
  const keyLength = (process.env.AYAS_ACCESS_KEY ?? "").length;
  const notYet = <T,>(): Measured<T> => ({ value: null, at: nowIso, error: "henüz ölçülmedi" });
  const facts: SecurityWatchFacts = {
    login,
    accessKey: { value: { length: keyLength, enforced: gate.mode === "enforced" }, at: nowIso },
    openSensitiveRoutes: { value: SENSITIVE_ROUTES.filter((r) => !isProtectedPath(r)), at: nowIso },
    ports: cache.ports ?? notYet(),
    firewall: cache.firewall ?? notYet(),
    liveIntegrity: cache.liveIntegrity ?? notYet(),
    secrets: cache.secrets ?? notYet(),
    vulnerabilities: cache.vulnerabilities ?? notYet(),
  };
  const findings = evaluateSecurityWatch(facts, nowIso, LEARNED_SECURITY_CHECKS);
  const learned = vetLearnedChecks(LEARNED_SECURITY_CHECKS).verdicts;
  let previous: readonly SecurityFinding[] = [];
  try { previous = readSecurityWatchReport(root)?.findings ?? []; } catch { previous = []; }
  const cases = recordSecurityCases(previous, findings, nowIso, root);
  const measuredAt = Object.fromEntries(Object.entries(facts).map(([k, m]) => [k, (m as Measured<unknown>).at])) as Record<keyof SecurityWatchFacts, string>;
  const report = { schemaVersion: 1 as const, checkedAt: nowIso, findings, measuredAt, learned, ...(exam ? { exam } : {}) };
  writeSecurityWatchReport(report, root);
  // Self-improvement: measured needs → AYAS's review → Gelişim Merkezi ("AYAS ÖNERİYOR · Bekçi'den") → grace approval.
  let improvement: unknown = null;
  try {
    const workRoot = resolveV3Paths(root).workRoot;
    const needs = deriveSecurityNeeds(readSecurityCases(400, root), report, nowMs);
    const proposed = await proposeSecurityImprovements(workRoot, needs, process.env, now);
    const approved = await graceApproveSecurityProposals(workRoot, process.env, now);
    improvement = { needs: needs.length, filed: proposed.filed.length, refused: proposed.refused.length, approved: approved.length };
  } catch (error) {
    improvement = { error: (error instanceof Error ? error.message : String(error)).slice(0, 200) };
  }
  writeWatchState({
    schemaVersion: 1, lastRoundAt: nowIso,
    hourlyAt: hourly ? nowIso : state.hourlyAt,
    secretsAt: secretsDue ? nowIso : state.secretsAt, secretsHead: secretsDue ? head : state.secretsHead,
    vulnsAt: vulnsDue ? nowIso : state.vulnsAt,
    examAt: examDue ? nowIso : state.examAt,
    cache, ...(exam ? { exam } : {}),
  } satisfies WatchState, root);
  console.log(JSON.stringify({ status: "WATCHED", ran, findings: findings.length, serious: findings.filter((f) => f.severity === "kritik" || f.severity === "yuksek").length, newCases: cases.length, improvement, exam: exam ? `${exam.passed}/${exam.total}` : null }));
}

main().catch((error: unknown) => {
  console.error(`Güvenlik turu yapılamadı: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

