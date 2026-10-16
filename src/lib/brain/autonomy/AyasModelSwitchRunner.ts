import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { AYAS_MODEL_ENV, resolveAyasChatModelProfile } from "../../ayas/AyasModelProfile";
import type { AyasChatModelBenchmarkResult } from "../../ayas/model/AyasChatModelBenchmark";
import { ayasModelSwitchHash, compareAyasChatModels, createAyasModelWatchStore, currentAyasModelResult, type AyasModelWatchStore } from "./AyasModelWatch";
import type { AyasModelOperationStore, AyasModelSwitchDecisionRecord, AyasModelSwitchRecord } from "./AyasModelOperationStore";
import { runAyasCommand, type AyasChildEnv, type AyasCommandRunner } from "./AyasUpdateTrialRunner";

/**
 * Carries out one owner "Bu modele geç" (AyasModelOperationStore):
 *
 * 1. The decision must still bind: the current model is the one it replaces, both measurements are unchanged
 *    (ayasModelSwitchHash) and the candidate is still better. Otherwise REFUSED, nothing changed.
 * 2. Both `.env.local` files (the published live copy's, which the live app reads at start and the next publication
 *    copies, and the canonical tree's, which the observer and the benchmark read) must name the model being replaced.
 *    `AYAS_OLLAMA_MODEL` is set to the new tag in both; every other line is kept byte for byte.
 * 3. The live application restarts through scripts/ayas-publish-live.ps1 -Restart: the same stop, supervisor start
 *    and health wait as a publication, refused while the live app runs a child job (then DEFERRED: the files are put
 *    back and a later run tries again, bounded).
 * 4. A few frozen benchmark cases the candidate passed run through the AYAS chat path on the new model.
 *
 * When the restart or the check fails, both files get their exact previous bytes back (kept in memory only; the files
 * hold secrets and are never copied) and the live app restarts again: ROLLED_BACK. If that restart fails too:
 * RECOVERY_REQUIRED. Nothing is committed; the switch is runtime configuration. Effectful (files, PowerShell):
 * reached only from scripts/ayas-update-executor.ts.
 */
export interface AyasModelSwitchDeps {
  readonly repoRoot: string;
  readonly store: AyasModelOperationStore;
  readonly watchStore?: AyasModelWatchStore;
  /** The model AYAS chat uses now in the canonical tree. */
  readonly incumbentModel: string;
  /** The published live root; production reads private\AtolyeAyasAccess\published-application-v1.json. */
  readonly liveRoot?: string;
  /** Test seam; production runs scripts/ayas-publish-live.ps1 -Restart. */
  readonly restartLive?: () => Promise<AyasLiveRestartOutcome>;
  /** Runs these frozen cases on the model through the AYAS chat path (the executor binds env). */
  readonly probe: (model: string, caseIds: readonly string[]) => Promise<AyasChatModelBenchmarkResult>;
  readonly now?: () => string;
  readonly run?: AyasCommandRunner;
  readonly env?: AyasChildEnv;
}

export interface AyasLiveRestartOutcome { readonly status: "RESTARTED" | "BUSY" | "FAILED"; readonly summary: string }

const MODEL_LINE = new RegExp(`^\\s*${AYAS_MODEL_ENV}\\s*=`);
const PROBE_CATEGORIES = ["KNOWLEDGE", "ARITHMETIC", "HONESTY"] as const;

/** KEY=VALUE lines as Next's env loading reads them for these plain values; comments and blank lines skipped. */
function parseEnv(text: string): NodeJS.ProcessEnv {
  const env: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2]!.trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, "");
    env[match[1]!] = value;
  }
  return env as NodeJS.ProcessEnv;
}

export const effectiveAyasChatModel = (envText: string): string => resolveAyasChatModelProfile(parseEnv(envText)).model;

/** The same text with exactly one `AYAS_OLLAMA_MODEL=<tag>` line (replacing the first, dropping repeats, or appended). */
export function setAyasChatModelLine(text: string, tag: string): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let replaced = false;
  for (const line of lines) {
    if (MODEL_LINE.test(line)) { if (!replaced) { out.push(`${AYAS_MODEL_ENV}=${tag}`); replaced = true; } continue; }
    out.push(line);
  }
  if (!replaced) {
    if (out.length && out[out.length - 1] === "") out.splice(out.length - 1, 0, `${AYAS_MODEL_ENV}=${tag}`);
    else out.push(`${AYAS_MODEL_ENV}=${tag}`);
  }
  return out.join(eol);
}

function writeAtomic(file: string, content: string): void {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  const fd = fs.openSync(tmp, "w");
  try { fs.writeFileSync(fd, content, "utf8"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}

/** The live root the access supervisor serves: inside <studio>\Atolye, never the canonical tree itself. */
export function readAyasPublishedLiveRoot(repoRoot: string): string {
  const studio = path.resolve(repoRoot, "..", "..");
  const selector = JSON.parse(fs.readFileSync(path.join(studio, "private", "AtolyeAyasAccess", "published-application-v1.json"), "utf8")) as { schemaVersion?: number; applicationRoot?: unknown };
  if (selector.schemaVersion !== 1 || typeof selector.applicationRoot !== "string") throw new Error("published application selector is invalid");
  const live = path.resolve(selector.applicationRoot);
  const bundle = path.join(studio, "Atolye") + path.sep;
  if (!live.toLowerCase().startsWith(bundle.toLowerCase()) || live.toLowerCase() === path.resolve(repoRoot).toLowerCase()) throw new Error("published application root is outside the bundle");
  return live;
}

function childEnv(base: AyasChildEnv): AyasChildEnv {
  const env: Record<string, string | undefined> = { ...base };
  for (const key of Object.keys(env)) if (/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|^OPENAI|^ANTHROPIC|^ELEVENLABS|^YOUTUBE/i.test(key)) delete env[key];
  return env;
}

/** scripts/ayas-publish-live.ps1 -Restart, read through its own outcome lines. */
export function createAyasLiveRestarter(repoRoot: string, run: AyasCommandRunner = runAyasCommand, env: AyasChildEnv = childEnv(process.env)): () => Promise<AyasLiveRestartOutcome> {
  return async () => {
    const script = path.join(repoRoot, "scripts", "ayas-publish-live.ps1");
    const result = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-Restart"], { cwd: repoRoot, timeoutMs: 10 * 60_000, env });
    const lines = result.output.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^\[(TAMAM|SORUN|YAPILDI|BILGI)\]/.test(line));
    const summary = lines.slice(-4).join(" | ").slice(0, 600) || (result.timedOut ? "yeniden başlatma süre sınırını aştı" : "yeniden başlatma çıktısı okunamadı");
    if (result.code === 0 && lines.some((line) => /^\[TAMAM\] Yeniden baslatildi:/.test(line))) return { status: "RESTARTED", summary };
    if (lines.some((line) => /^\[SORUN\] Canli uygulamada calisan bir is var/.test(line))) return { status: "BUSY", summary };
    return { status: "FAILED", summary };
  };
}

/** The first case per probe category that the candidate passed when it was measured. */
export function ayasModelSwitchProbeCases(candidate: AyasChatModelBenchmarkResult): readonly string[] {
  return PROBE_CATEGORIES.map((category) => candidate.cases.find((entry) => entry.category === category && entry.pass)?.id).filter((id): id is string => Boolean(id));
}

export async function runAyasModelSwitch(decision: AyasModelSwitchDecisionRecord, previous: AyasModelSwitchRecord | undefined, deps: AyasModelSwitchDeps): Promise<AyasModelSwitchRecord> {
  const now = deps.now ?? (() => new Date().toISOString());
  let record: AyasModelSwitchRecord = previous
    ? { ...previous, status: "RUNNING", attempts: previous.attempts + 1, steps: [] }
    : { schemaVersion: 1, switchId: `ayas-model-switch-${crypto.randomUUID()}`, decisionId: decision.decisionId, tag: decision.tag, fromModel: decision.fromModel, status: "RUNNING", attempts: 1, startedAt: now(), steps: [] };
  const steps: { name: string; ok: boolean; summary: string }[] = [];
  const save = (patch: Partial<AyasModelSwitchRecord> = {}): AyasModelSwitchRecord => { record = { ...record, ...patch, steps: [...steps] }; deps.store.upsertSwitch(record); return record; };
  const step = (name: string, ok: boolean, summary: string) => { steps.push({ name, ok, summary: summary.slice(0, 400) }); save(); };
  const finish = (status: AyasModelSwitchRecord["status"], reasons: readonly string[]) => save({ status, finishedAt: now(), reasons });
  save();

  // 1. The click still binds.
  const watch = (deps.watchStore ?? createAyasModelWatchStore()).read();
  const candidate = currentAyasModelResult(watch, decision.tag);
  const incumbent = currentAyasModelResult(watch, decision.fromModel);
  if (deps.incumbentModel !== decision.fromModel) { step("BAĞLAMA", false, `AYAS'ın modeli bu karardan sonra ${deps.incumbentModel} oldu`); return finish("REFUSED", ["karar verildiğinden beri model değişti; hiçbir şey değiştirilmedi"]); }
  if (!candidate || !incumbent || compareAyasChatModels(incumbent, candidate).verdict !== "BETTER" || ayasModelSwitchHash({ candidate, incumbentModel: decision.fromModel, incumbent }) !== decision.switchHash) {
    step("BAĞLAMA", false, "ölçümler karar verildiğinden beri değişti");
    return finish("REFUSED", ["ölçümler değişti; kartı yenileyip yeniden karar ver. Hiçbir şey değiştirilmedi."]);
  }
  const probeCases = ayasModelSwitchProbeCases(candidate);
  if (!probeCases.length) { step("BAĞLAMA", false, "sohbet testi için soru yok"); return finish("REFUSED", ["adayın geçtiği test sorusu yok; hiçbir şey değiştirilmedi"]); }
  step("BAĞLAMA", true, `${decision.fromModel} → ${decision.tag}; ölçümler kararla aynı`);

  // 2. Both env files name the model being replaced.
  let files: string[];
  try { files = [...new Set([path.join(deps.liveRoot ?? readAyasPublishedLiveRoot(deps.repoRoot), ".env.local"), path.join(deps.repoRoot, ".env.local")])]; }
  catch (error) { step("AYAR", false, error instanceof Error ? error.message : String(error)); return finish("REFUSED", ["canlı kopya bulunamadı; hiçbir şey değiştirilmedi"]); }
  const before = new Map<string, string>();
  for (const file of files) {
    let text: string;
    try { text = fs.readFileSync(file, "utf8"); } catch { step("AYAR", false, `${file} okunamadı`); return finish("REFUSED", ["ayar dosyası okunamadı; hiçbir şey değiştirilmedi"]); }
    if (effectiveAyasChatModel(text) !== decision.fromModel) { step("AYAR", false, `${file} ${decision.fromModel} modelini göstermiyor`); return finish("REFUSED", ["ayar dosyaları beklenen modeli göstermiyor; hiçbir şey değiştirilmedi"]); }
    before.set(file, text);
  }
  const restore = (): string | undefined => {
    const failed: string[] = [];
    for (const [file, text] of before) { try { writeAtomic(file, text); } catch { failed.push(file); } }
    return failed.length ? `geri yazılamadı: ${failed.join(", ")}` : undefined;
  };
  try {
    for (const [file, text] of before) writeAtomic(file, setAyasChatModelLine(text, decision.tag));
  } catch (error) {
    const restoreProblem = restore();
    step("AYAR", false, error instanceof Error ? error.message : String(error));
    return finish(restoreProblem ? "RECOVERY_REQUIRED" : "FAILED", [restoreProblem ?? "ayar yazılamadı; dosyalar eski hâline döndü"]);
  }
  step("AYAR", true, `${AYAS_MODEL_ENV}=${decision.tag} (${files.length} dosya)`);

  const restartLive = deps.restartLive ?? createAyasLiveRestarter(deps.repoRoot, deps.run ?? runAyasCommand, deps.env ?? childEnv(process.env));
  const rollBack = async (reason: string): Promise<AyasModelSwitchRecord> => {
    const restoreProblem = restore();
    if (restoreProblem) { step("GERİ DÖNÜŞ", false, restoreProblem); return finish("RECOVERY_REQUIRED", [reason, restoreProblem]); }
    const again = await restartLive();
    step("GERİ DÖNÜŞ", again.status === "RESTARTED", `${decision.fromModel} ayarı geri yazıldı; ${again.summary}`);
    return again.status === "RESTARTED"
      ? finish("ROLLED_BACK", [reason, `${decision.fromModel} ile yeniden çalışıyor`])
      : finish("RECOVERY_REQUIRED", [reason, "eski modelle yeniden başlatma da sağlıklı olmadı; elle incelenmeli"]);
  };

  // 3. Restart the live application with the new setting.
  const restart = await restartLive();
  step("YENİDEN BAŞLATMA", restart.status === "RESTARTED", restart.summary);
  if (restart.status === "BUSY") {
    const restoreProblem = restore();
    if (restoreProblem) return finish("RECOVERY_REQUIRED", ["canlı uygulama meşguldü", restoreProblem]);
    return finish("DEFERRED", ["canlı uygulamada çalışan bir iş vardı; hiçbir şey değişmedi, AYAS sonra yeniden deneyecek"]);
  }
  if (restart.status !== "RESTARTED") return rollBack("yeni modelle canlı uygulama sağlık denetiminden geçmedi");

  // 4. The new model answers through the AYAS chat path.
  let probe: AyasChatModelBenchmarkResult | undefined;
  try { probe = await deps.probe(decision.tag, probeCases); } catch (error) { probe = undefined; step("SOHBET TESTİ", false, error instanceof Error ? error.message : String(error)); }
  if (!probe) return rollBack("kısa sohbet testi çalışmadı");
  const failedCases = probe.cases.filter((entry) => !entry.pass);
  step("SOHBET TESTİ", !failedCases.length, `${probe.total} sorudan ${probe.passed} geçti${failedCases.length ? `: ${failedCases.map((entry) => `${entry.id} (${entry.reason ?? ""})`).join("; ")}` : ""}`);
  if (failedCases.length) return rollBack("kısa sohbet testi geçmedi");
  return finish("SWITCHED", [`AYAS artık ${decision.tag} kullanıyor`]);
}

/**
 * A switch left RUNNING by a dead executor. Both files still naming the replaced model prove nothing took effect
 * (ABANDONED, tried again, bounded); anything else waits for a human (RECOVERY_REQUIRED).
 */
export function reconcileAyasModelSwitchOrphan(record: AyasModelSwitchRecord, deps: Pick<AyasModelSwitchDeps, "repoRoot" | "store" | "liveRoot" | "now">): AyasModelSwitchRecord {
  const now = deps.now ?? (() => new Date().toISOString());
  let untouched = false;
  try {
    const files = [...new Set([path.join(deps.liveRoot ?? readAyasPublishedLiveRoot(deps.repoRoot), ".env.local"), path.join(deps.repoRoot, ".env.local")])];
    untouched = files.every((file) => effectiveAyasChatModel(fs.readFileSync(file, "utf8")) === record.fromModel);
  } catch { untouched = false; }
  const next: AyasModelSwitchRecord = untouched
    ? { ...record, status: "ABANDONED", finishedAt: now(), reasons: ["geçiş yarıda kesildi; ayar değişmemişti, AYAS yeniden deneyecek"] }
    : { ...record, status: "RECOVERY_REQUIRED", finishedAt: now(), reasons: ["geçiş yarıda kesildi; ayar dosyaları ve canlı uygulama elle doğrulanmalı"] };
  deps.store.upsertSwitch(next);
  return next;
}
