/**
 * V3 smoke: the brains' self-improvement while idle (SelfImprovement) — when a cycle and each task are due, code
 * proposals (written once, repeats counted, decided only by the owner), a production report's wants, prompt additions
 * and settings kept only on a measured gain and never tried twice. No network, no GPU, no model.
 * Run: npx tsx scripts/smoke-v3-self-improvement.ts
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveOllamaConfig } from "../src/lib/ai/OllamaConfig";
import { OllamaProvider } from "../src/lib/ai/providers/OllamaProvider";
import { STEADY_JUDGE, steadyJudge } from "../src/lib/v3/council/BrainModels";
import {
  activeAdditions,
  CYCLE_EVERY_H,
  settingTriedWithin,
  STEADY_TRIAL_EVERY_DAYS,
  steadyVerdict,
  STUDIES_PER_CYCLE,
  STUDIES_PER_DAY,
  TASK_EVERY_H,
  TUNABLE_SETTINGS,
  additionPrompt,
  type BrainTuning,
  confirmedGain,
  type CycleRecord,
  cycleDue,
  cycleLine,
  decideProposal,
  harvestReport,
  lastDone,
  listProposals,
  MAX_ADDITIONS,
  MIN_GAIN,
  needsOwner,
  proposeDevelopment,
  readTuning,
  settleAddition,
  settleSetting,
  taskDue,
  triedBefore,
  tunedSetting,
  type DevProposal,
  updateProposal,
  wantsOf,
  writeTuning,
} from "../src/lib/v3/council/SelfImprovement";
import { applyBuild, ayasChecks, changedPaths, claudeAgent, develop, developerLock } from "../src/lib/v3/council/Developer";
import { AYAS_DEVELOPER_RULES, ayasTaskPacket, codeBuildOf, DEVELOPER_RULES, developerWindow, forbiddenChanges, MAX_DEV_TRIES, measuredFaults, nextJob, taskPacket, usageLimitUntil, waitingForLimit } from "../src/lib/v3/council/DevQueue";
import { recordCodeApply, rejectBuild, requestDevelopment } from "../src/lib/v3/council/SelfImprovement";
import { brainsReportText, loadAtolyeBrainsView } from "../src/lib/v3/council/BrainsReport";
import { ayasCodeBuildHash, ayasCodeContentSha256, ayasCodeJobTrailer } from "../src/lib/brain/autonomy/AyasCodeChangeLane";
import {
  changedSymbols,
  codeExperience,
  codeExperienceLines,
  declarationSpans,
  type DevGrade,
  EXCERPT_CHARS,
  firedInstincts,
  gradedFiles,
  gradeGuess,
  hasSentenceInstincts,
  instinctFiles,
  instinctTriggers,
  learnInstincts,
  rebuildInstincts,
  listChanges,
  listCodeExperience,
  listGrades,
  listLessons,
  loadDevBrainView,
  parseDiff,
  readiness,
  readInstincts,
  READY_WINDOW,
  researchMarkdown,
  researchNote,
  similarChanges,
  START_CONFIDENCE,
  taskWords,
  touchedDeclarations,
} from "../src/lib/v3/council/DevBrain";
import { learnFromCommits, needsResearch, researchQueue, runDevJob } from "../src/lib/v3/council/DevResearch";
import { V3Budget } from "../src/lib/v3/script/V3Budget";
import { runProcess } from "../src/lib/v3/util/Proc";

let scenarios = 0;
async function scenario(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
  scenarios++;
}

const H = 3_600_000;
const T0 = Date.parse("2026-11-02T12:00:00Z");
const at = (h: number) => new Date(T0 + h * H).toISOString();

async function main() {
  await scenario("A cycles and tasks fall due by their pauses; an owner's link makes a cycle due at once", () => {
    const cycles: CycleRecord[] = [
      { basla: at(0), bitis: at(0.5), gorevler: [{ gorev: "sinav", sonuc: "tamam", ayrinti: "", bitis: at(0.4) }, { gorev: "benzer", sonuc: "atlandi", ayrinti: "", bitis: at(0.5) }], maliyetUsd: 0 },
    ];
    assert.equal(lastDone(cycles, "sinav"), T0 + 0.4 * H);
    assert.equal(lastDone(cycles, "benzer"), undefined);
    assert.equal(taskDue(cycles, "sinav", T0 + 10 * H), false);
    assert.equal(taskDue(cycles, "sinav", T0 + 25 * H), true);
    assert.equal(taskDue(cycles, "benzer", T0 + 1 * H), true);
    assert.equal(taskDue(cycles, "istekler", T0 + 0.6 * H), true);
    assert.equal(cycleDue([], {}), true);
    assert.equal(cycleDue(cycles, { now: T0 + 2 * H }), false);
    assert.equal(cycleDue(cycles, { now: T0 + 7 * H }), true);
    assert.equal(cycleDue(cycles, { now: T0 + 2 * H, everyH: 1 }), true);
    assert.equal(cycleDue(cycles, { now: T0 + 1 * H, requestsWaiting: true }), true);
    assert.match(cycleLine({ ...cycles[0]!, durdu: "sipariş geldi" }), /kalite beyninin sınavı.*\(durdu: sipariş geldi\)/);
    assert.equal(cycleLine({ basla: at(0), bitis: at(1), gorevler: [], maliyetUsd: 0 }), "yapılacak iş yoktu");
  });

  await scenario("B proposals: written once, a repeat counted on the same want, decided only once by the owner", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "v3-gelisim-"));
    assert.equal(await proposeDevelopment(root, { beyin: "ortam", baslik: "Close maps need a river layer", neden: "rivers missing", kaynak: "a" }, new Date(T0)), "yeni");
    assert.equal(await proposeDevelopment(root, { beyin: "ortam", baslik: "close maps need river layer drawn", neden: "again", kaynak: "b" }), "tekrar");
    assert.equal(await proposeDevelopment(root, { beyin: "ses", baslik: "Close maps need a river layer", neden: "other brain", kaynak: "c" }), "yeni");
    const list = await listProposals(root);
    assert.equal(list.length, 2);
    const p = list.find((x) => x.proposal.beyin === "ortam")!.proposal;
    assert.deepEqual([p.sayi, p.kaynaklar, p.durum, p.kaynakTuru], [2, ["a", "b"], "bekliyor", "fikir"]);
    // An idea comes before the owner once a second production raised it; a measured fault at once.
    assert.equal(needsOwner(p), true);
    assert.equal(needsOwner({ durum: "bekliyor", kaynakTuru: "fikir", sayi: 1 }), false);
    assert.equal(needsOwner({ durum: "bekliyor", kaynakTuru: "olcum", sayi: 1 }), true);
    assert.equal(needsOwner({ durum: "onaylandi", kaynakTuru: "olcum", sayi: 3 }), false);
    // The same production raising it again counts nothing.
    await proposeDevelopment(root, { beyin: "ses", baslik: "Close maps need a river layer", neden: "", kaynak: "c", kaynakTuru: "olcum" });
    const ses = (await listProposals(root)).find((x) => x.proposal.beyin === "ses")!.proposal;
    assert.deepEqual([ses.sayi, ses.kaynakTuru], [1, "olcum"]);
    const d = await decideProposal(root, p.id, "onaylandi", "  bunu yapalım  ");
    assert.deepEqual([d.durum, d.karar?.not], ["onaylandi", "bunu yapalım"]);
    await assert.rejects(decideProposal(root, p.id, "reddedildi"), /V3_PROPOSAL_DECIDED/);
    await assert.rejects(decideProposal(root, "nope", "onaylandi"), /V3_PROPOSAL_NOT_FOUND/);
    // A decided want raised again is counted, never reopened.
    assert.equal(await proposeDevelopment(root, { beyin: "ortam", baslik: "Close maps need a river layer", neden: "", kaynak: "d" }), "tekrar");
    assert.equal((await listProposals(root)).find((x) => x.proposal.id === p.id)!.proposal.durum, "onaylandi");
  });

  await scenario("C a report's wants: the manager's developments and code findings, not the repair brain's own", async () => {
    const report = {
      sef: { gelistirmeler: [{ baslik: "Draw siege towers", neden: "missing", beyin: "ortam" as const }, { baslik: "No brain named", neden: "x" }, { neden: "no title" }] },
      bulgular: [
        { beyin: "ses" as const, onem: "uyari" as const, baslik: "whine in mix", ayrinti: "6 kHz", oneri: "notch it", tur: "kod" as const },
        { beyin: "onarim" as const, onem: "uyari" as const, baslik: "render failed", ayrinti: "x", tur: "kod" as const },
        { beyin: "ortam" as const, onem: "uyari" as const, baslik: "no period image", ayrinti: "x", tur: "veri" as const },
      ],
    };
    const w = wantsOf(report);
    assert.deepEqual(w.map((x) => [x.beyin, x.baslik, x.kaynakTuru]), [["ortam", "Draw siege towers", "fikir"], ["sef", "No brain named", "fikir"], ["ses", "whine in mix", "olcum"]]);
    assert.match(w[2]!.neden, /6 kHz → notch it/);
    const root = mkdtempSync(path.join(os.tmpdir(), "v3-harvest-"));
    const file = path.join(root, "yapim-raporu.json");
    writeFileSync(file, JSON.stringify(report));
    assert.deepEqual(await harvestReport(root, file, "order-1"), { yeni: 3, tekrar: 0 });
    // The same report never counts twice; a missing one is nothing.
    assert.equal(await harvestReport(root, file, "order-1"), undefined);
    assert.equal(await harvestReport(root, path.join(root, "none.json"), "x"), undefined);
    assert.equal((await listProposals(root)).length, 3);
  });

  await scenario("D prompt additions and settings: kept only on a measured gain, the oldest kept one leaves, never tried twice", async () => {
    const empty: BrainTuning = { ekler: {}, ayarlar: {}, ayarGecmisi: [] };
    const add = (metin: string) => ({ metin, tarih: at(0) });
    const lost = settleAddition(empty, "kalite", add("Look at the top edge for cut badges"), 80, 80 + MIN_GAIN - 1);
    assert.equal(lost.ekler.kalite![0]!.durum, "geri_alindi");
    assert.equal(triedBefore(lost, "kalite", "look at the top edge for cut badges"), true);
    assert.equal(triedBefore(lost, "kalite", "Count the faces in the frame"), false);
    const won = settleAddition(lost, "kalite", add("Count the faces in the frame"), 80, 90);
    assert.deepEqual(won.ekler.kalite!.map((a) => a.durum), ["geri_alindi", "kalici"]);
    assert.deepEqual([won.ekler.kalite![1]!.olcumOnce, won.ekler.kalite![1]!.olcumSonra], [80, 90]);
    let full = won;
    for (let i = 0; i < MAX_ADDITIONS; i++) full = settleAddition(full, "kalite", add(`distinct rule number ${i} about frames ${"x".repeat(i)}`), 50, 60);
    assert.equal(full.ekler.kalite!.filter((a) => a.durum === "kalici").length, MAX_ADDITIONS);
    assert.equal(full.ekler.kalite!.find((a) => a.metin === "Count the faces in the frame")!.durum, "geri_alindi");
    // The exam's noise (90 % then 73 % on the same day): one lucky run keeps nothing; both runs must beat both bases.
    assert.deepEqual(confirmedGain([73], [90]), { once: 73, sonra: 90, kalici: false });
    assert.deepEqual(confirmedGain([73, 75], [88, 90]), { once: 74, sonra: 89, kalici: true });
    assert.equal(confirmedGain([73, 90], [88, 92]).kalici, false);
    assert.equal(confirmedGain([70, 72], [76, 77]).kalici, true);
    assert.equal(confirmedGain([70, 72], [74, 75]).kalici, false);
    assert.equal(settleAddition(empty, "kalite", add("a rule kept by the confirmation only"), 74, 89, false).ekler.kalite![0]!.durum, "geri_alindi");
    const set = settleSetting(empty, "kalite", "ornekler", true, 70, 80, new Date(T0));
    assert.equal(set.ayarlar.kalite?.ornekler, true);
    const kept = settleSetting(set, "kalite", "ornekler", false, 80, 82);
    assert.equal(kept.ayarlar.kalite?.ornekler, true);
    assert.deepEqual(kept.ayarGecmisi.map((h) => h.kalici), [true, false]);
    assert.throws(() => settleSetting(empty, "kalite", "model", true, 1, 99), /V3_SETTING_NOT_TUNABLE/);
    assert.throws(() => settleSetting(empty, "kurgu", "ornekler", true, 1, 99), /V3_SETTING_NOT_TUNABLE/);
    const root = mkdtempSync(path.join(os.tmpdir(), "v3-tuning-"));
    assert.deepEqual(await readTuning(root), empty);
    await writeTuning(root, { ...won, ayarlar: set.ayarlar });
    assert.deepEqual(await activeAdditions(root, "kalite"), ["Count the faces in the frame"]);
    assert.deepEqual(await activeAdditions(root, "kurgu"), []);
    assert.equal(await tunedSetting(root, "kalite", "ornekler"), true);
    assert.equal(await tunedSetting(root, "kalite", "kenar"), undefined);
    const p = additionPrompt([{ tur: "harita", kusurlu: true, beklenen: "a cut label", cevap: "9/10, no fault named" }], ["Count the faces in the frame"], ["Look at the top edge"]);
    assert.match(p, /FAULTY \(a cut label\)/);
    assert.match(p, /do not repeat them\): "Look at the top edge"/);
    assert.match(p, /never name a person, place or episode/);
  });

  await scenario("E the steady judge: kept when its accuracy does not drop and its own runs agree; tried once a week", async () => {
    assert.deepEqual(steadyVerdict([90, 73, 81], [82, 82, 82]), { once: 81, sonra: 82, tutarli: true, kalici: true });
    assert.equal(steadyVerdict([90, 73, 81], [77, 77, 77]).kalici, false);
    // Its answers still move: the seed is not honoured.
    assert.deepEqual([steadyVerdict([70, 70, 70], [80, 90, 85]).tutarli, steadyVerdict([70, 70, 70], [80, 90, 85]).kalici], [false, false]);
    assert.equal(steadyVerdict([70, 70], [80, 80]).kalici, false);
    assert.ok(TUNABLE_SETTINGS.kalite?.includes("sabit"));
    const t = settleSetting({ ekler: {}, ayarlar: {}, ayarGecmisi: [] }, "kalite", "sabit", true, 81, 82, new Date(T0), true);
    assert.equal(t.ayarlar.kalite?.sabit, true);
    assert.equal(settingTriedWithin(t, "kalite", "sabit", STEADY_TRIAL_EVERY_DAYS, T0 + 3 * 24 * H), true);
    assert.equal(settingTriedWithin(t, "kalite", "sabit", STEADY_TRIAL_EVERY_DAYS, T0 + 8 * 24 * H), false);
    assert.equal(settingTriedWithin(t, "kalite", "ornekler", STEADY_TRIAL_EVERY_DAYS, T0), false);
    // A later trial that fails while it is on turns it off.
    assert.equal(settleSetting(t, "kalite", "sabit", false, 81, 77, new Date(T0 + 8 * 24 * H), true).ayarlar.kalite?.sabit, false);
    // The environment decides first; else the brain's choice.
    assert.equal(steadyJudge(true, {}), true);
    assert.equal(steadyJudge(undefined, {}), false);
    assert.equal(steadyJudge(true, { ATOLYE_V3_QUALITY_STEADY: "0" }), false);
    assert.equal(steadyJudge(false, { ATOLYE_V3_QUALITY_STEADY: "1" }), true);
    // The provider sends the seed and temperature 0 only when asked.
    const bodies: Record<string, unknown>[] = [];
    const fetcher = (async (_url: unknown, init?: { body?: unknown }) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ message: { content: "{}" }, done: true, done_reason: "stop" }), { status: 200 });
    }) as unknown as typeof fetch;
    const base = { ...resolveOllamaConfig(), baseUrl: "http://127.0.0.1:1", model: "x", maxRetries: 0 };
    await new OllamaProvider(fetcher, () => ({ ...base, ...STEADY_JUDGE })).generate("p");
    await new OllamaProvider(fetcher, () => base).generate("p");
    const opts = bodies.map((b) => b.options as Record<string, unknown>);
    assert.deepEqual([opts[0]!.temperature, opts[0]!.seed], [0, 42]);
    assert.equal("seed" in opts[1]!, false);
    // Four hours between cycles (owner, 2 Nov 2026); the own search runs every cycle.
    assert.equal(CYCLE_EVERY_H, 4);
    assert.equal(TASK_EVERY_H.benzer, 0);
    assert.ok(STUDIES_PER_CYCLE <= STUDIES_PER_DAY);
  });

  await scenario("F the development queue: approved first, a failed build once more after a day, only V3 files, night hours, switched off by default", async () => {
    const p = (id: string, durum: DevProposal["durum"], extra: Partial<DevProposal> = {}): DevProposal => ({ id, tarih: at(0), beyin: "kurgu", baslik: id, neden: "n", kaynaklar: ["ep1"], sayi: 2, durum, ...extra });
    const list = [p("eski-hata", "yapilamadi", { is: { deneme: 1, baslangic: at(0), bitis: at(1) } }), p("ikinci", "onaylandi", { karar: { tarih: at(3) } }), p("birinci", "onaylandi", { karar: { tarih: at(2) } }), p("bekleyen", "bekliyor")];
    assert.equal(nextJob(list, T0 + 30 * H)?.id, "birinci", "the earliest approval first");
    assert.equal(nextJob(list.filter((x) => x.durum !== "onaylandi"), T0 + 30 * H)?.id, "eski-hata", "a failed build again after a day");
    assert.equal(nextJob(list.filter((x) => x.durum !== "onaylandi"), T0 + 10 * H), undefined, "not within the day");
    assert.equal(nextJob([p("iki-kez", "yapilamadi", { is: { deneme: MAX_DEV_TRIES, baslangic: at(0), bitis: at(1) } })], T0 + 99 * H), undefined, "two tries at most");
    // The usage limit's reset time, in this PC's clock: the next such time, a minute after it.
    const evening = new Date(2026, 10, 3, 21, 13);
    const reset = (s: string, now = evening) => {
      const d = new Date(usageLimitUntil(s, now)!);
      return [d.getDate(), d.getHours(), d.getMinutes()];
    };
    assert.deepEqual(reset("You've hit your session limit · resets 9:40pm (Europe/Istanbul)"), [3, 21, 41]);
    assert.deepEqual(reset("Claude usage limit reached · resets 9:40pm", new Date(2026, 10, 3, 22, 0)), [4, 21, 41], "already past: tomorrow");
    assert.deepEqual(reset("You've hit your weekly limit · resets 12am"), [4, 0, 1]);
    assert.deepEqual(reset("session limit reached, resets at 14:05"), [4, 14, 6]);
    assert.equal(new Date(usageLimitUntil("You've hit your limit", evening)!).getTime() - evening.getTime(), 3_600_000, "no time given: an hour");
    assert.equal(usageLimitUntil("error TS2307: Cannot find module", evening), undefined, "any other failure is a real try");
    assert.equal(usageLimitUntil("rate limit exceeded on api.openai.com", evening), undefined);
    assert.deepEqual(forbiddenChanges(["src/lib/v3/mix/X.ts", "scripts\\smoke-v3-mix.ts", "scripts/v3/yapim.ts", "remotion-v3/src/Episode.tsx", "package.json", "src/lib/ayas/A.ts", "app/brain/actions.ts", ".env.v3.local", "scripts/smoke-ayas-x.ts"]), ["package.json", "src/lib/ayas/A.ts", "app/brain/actions.ts", ".env.v3.local", "scripts/smoke-ayas-x.ts"]);
    const night = new Date(2026, 10, 3, 3, 0), day = new Date(2026, 10, 3, 14, 0);
    assert.deepEqual([developerWindow({}, night).acik, developerWindow({ ATOLYE_V3_GELISTIRICI: "1" }, night).acik, developerWindow({ ATOLYE_V3_GELISTIRICI: "1" }, day).acik, developerWindow({ ATOLYE_V3_GELISTIRICI: "1", ATOLYE_V3_GELISTIRICI_SAAT: "22-6" }, new Date(2026, 10, 3, 23, 0)).acik], [false, true, false, true]);
    const packet = taskPacket(p("x", "onaylandi", { baslik: "Crowds that cheer", karar: { tarih: at(2), not: "make it loud" } }), { sorunlar: ["tsc failed"] });
    assert.ok(packet.includes("TITLE: Crowds that cheer") && packet.includes("OWNER'S NOTE: make it loud") && packet.includes("THE LAST ATTEMPT WAS THROWN AWAY BECAUSE: tsc failed") && packet.includes("already does this"));
    assert.ok(DEVELOPER_RULES.includes("Do NOT run git") && DEVELOPER_RULES.includes("Never\n  package.json"));
    assert.deepEqual(changedPaths(" M src/lib/v3/a.ts\n?? scripts/smoke-v3-b.ts\nR  docs/v3/old.md -> docs/v3/new.md\n"), ["src/lib/v3/a.ts", "scripts/smoke-v3-b.ts", "docs/v3/new.md"]);
    const agent = claudeAgent({ APPDATA: "C:\\AppData", ATOLYE_V3_CLAUDE_CLI: "" });
    assert.ok(agent[1]!.endsWith(path.join("@anthropic-ai", "claude-code", "cli-wrapper.cjs")) && agent.includes("-p") && agent.includes("acceptEdits") && agent.some((a) => a.startsWith("--allowedTools=Read,Edit,Write,Glob,Grep,Bash(npx tsc:*)")) && !agent.some((a) => /git/i.test(a) && a.startsWith("--allowedTools")));
  });

  await scenario("G the developer builds in its own worktree: a kept build is committed on its branch, a bad one thrown away, the checkout and its node_modules untouched", async () => {
    const base = mkdtempSync(path.join(os.tmpdir(), "v3-gelistirici-"));
    const repo = path.join(base, "repo");
    const work = path.join(base, "runtime");
    mkdirSync(path.join(repo, "src", "lib", "v3"), { recursive: true });
    mkdirSync(path.join(repo, "node_modules", "pkg"), { recursive: true });
    writeFileSync(path.join(repo, "node_modules", "pkg", "keep.txt"), "the checkout's own dependency");
    writeFileSync(path.join(repo, ".gitignore"), "/node_modules\n");
    writeFileSync(path.join(repo, "src", "lib", "v3", "a.ts"), "export const a = 1;\n");
    const g = async (args: string[], cwd = repo) => {
      const r = await runProcess("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd });
      assert.equal(r.code, 0, `${args.join(" ")}: ${r.stderr}`);
      return r.stdout.trim();
    };
    await g(["init", "-q", "-b", "main"]);
    await g(["add", "-A"]);
    await g(["commit", "-q", "-m", "init"]);
    const head = await g(["rev-parse", "HEAD"]);
    await proposeDevelopment(work, { beyin: "kurgu", baslik: "Change a", neden: "n", kaynak: "ep1", kaynakTuru: "olcum" });
    const id = (await listProposals(work))[0]!.proposal.id;
    await decideProposal(work, id, "onaylandi");
    // The fake agent edits a V3 file (in the worktree it runs in) and prints its summary.
    const fakeAgent = (code: string) => [process.execPath, "-e", `${code};process.stdin.resume();process.stdin.on("end",()=>console.log("değiştirdim"))`];
    const deps = (agentCode: string, checks: string[][]) => ({ repoRoot: repo, workRoot: work, worktreeRoot: path.join(base, "gelistirme"), agent: fakeAgent(agentCode), checks, log: () => {} });
    const pass = [[process.execPath, "-e", "require('fs').accessSync('node_modules/pkg/keep.txt')"]];
    const job = (await listProposals(work))[0]!.proposal;
    const done = await develop(job, deps(`require("fs").writeFileSync("src/lib/v3/a.ts","export const a = 2;\\n")`, pass));
    assert.equal(done.durum, "hazir", JSON.stringify(done.is));
    assert.deepEqual([done.is?.dal, done.is?.dosyalar, done.is?.deneme], [`gelistirme/${id}`, ["src/lib/v3/a.ts"], 1]);
    assert.match(await g(["log", "-1", "--format=%s", `gelistirme/${id}`]), /^feat\(v3\): Change a$/);
    assert.equal(await g(["rev-parse", "HEAD"]), head, "the checkout's branch did not move");
    assert.equal(readFileSync(path.join(repo, "src", "lib", "v3", "a.ts"), "utf8"), "export const a = 1;\n", "its working tree untouched");
    assert.equal(readFileSync(path.join(repo, "node_modules", "pkg", "keep.txt"), "utf8"), "the checkout's own dependency", "removing the worktree never entered the linked node_modules");
    assert.equal(existsSync(path.join(base, "gelistirme", id)), false, "the worktree is gone, the branch stays");
    // Applying the kept build fast-forwards the checkout.
    assert.deepEqual(await applyBuild(done, repo), { ok: true, neden: `ileri sarıldı (gelistirme/${id})` });
    // (git may check it out with CRLF on Windows.)
    assert.equal(readFileSync(path.join(repo, "src", "lib", "v3", "a.ts"), "utf8").replace(/\r\n/g, "\n"), "export const a = 2;\n");
    // A change outside the V3 files, or a failing check, throws the build away (branch deleted, reason kept).
    await updateProposal(work, id, (q) => ({ ...q, durum: "onaylandi" }));
    const outside = await develop((await listProposals(work))[0]!.proposal, deps(`require("fs").writeFileSync("package.json","{}")`, pass));
    assert.equal(outside.durum, "yapilamadi");
    assert.match(outside.is!.sorunlar![0]!, /izin dışı dosyalar değişti: package.json/);
    assert.equal(outside.is?.deneme, 2);
    await updateProposal(work, id, (q) => ({ ...q, durum: "onaylandi", is: { deneme: 0, baslangic: at(0) } }));
    const failing = await develop((await listProposals(work))[0]!.proposal, deps(`require("fs").writeFileSync("src/lib/v3/a.ts","broken")`, [[process.execPath, "-e", "process.exit(3)"]]));
    assert.equal(failing.durum, "yapilamadi");
    assert.match(failing.is!.sorunlar![0]!, /^kontrol geçmedi/);
    assert.equal((await runProcess("git", ["branch", "--list", `gelistirme/${id}`], { cwd: repo })).stdout.trim(), "", "a thrown-away build leaves no branch");
    assert.ok(existsSync(path.join(work, "_kutuphane", "gelisim", "isler", id, "ajan-1.log")), "the agent's transcript is kept");
    // Nothing to change: done, with the agent's reason for the owner.
    await updateProposal(work, id, (q) => ({ ...q, durum: "onaylandi", is: { deneme: 0, baslangic: at(0) } }));
    const nothing = await develop((await listProposals(work))[0]!.proposal, deps("0", pass));
    assert.deepEqual([nothing.durum, nothing.is?.ozet], ["yapildi", "Değişiklik yapılmadı — değiştirdim"]);
    // Claude's usage limit (3 Nov 2026: three approved jobs lost a try each): back in the queue until the reset, no try spent, no branch.
    await updateProposal(work, id, (q) => ({ ...q, durum: "onaylandi", is: { deneme: 1, baslangic: at(0) } }));
    const limitAgent = [process.execPath, "-e", `process.stdin.resume();process.stdin.on("end",()=>{console.log("You've hit your session limit · resets 9:40pm (Europe/Istanbul)");process.exit(1)})`];
    const limited = await develop((await listProposals(work))[0]!.proposal, { ...deps("0", pass), agent: limitAgent });
    assert.deepEqual([limited.durum, limited.is?.deneme], ["onaylandi", 1], "the try is not counted");
    assert.ok(limited.is?.bekle && Date.parse(limited.is.bekle) > Date.now() && waitingForLimit(limited));
    assert.match(limited.is!.sorunlar![0]!, /^Claude kullanım sınırı/);
    assert.equal(nextJob([limited]), undefined, "it waits for the reset");
    assert.equal(nextJob([limited], Date.parse(limited.is!.bekle!) + 1)?.id, id, "then it is first again");
    assert.equal((await runProcess("git", ["branch", "--list", `gelistirme/${id}`], { cwd: repo })).stdout.trim(), "");
    // One developer at a time.
    const release = await developerLock(work);
    assert.ok(release);
    assert.equal(await developerLock(work), undefined);
    await release!();
    assert.ok(await developerLock(work));
  });

  await scenario("H the developer brain grades itself, learns instincts (candidate → confirmed → dropped), works from 16:30 and hands Claude its note", () => {
    // Graded: the V3 code and data, not notes and not the smoke suites (the test is chosen apart).
    assert.deepEqual(gradedFiles(["src\\lib\\v3\\mix\\A.ts", "scripts/smoke-v3-mix.ts", "docs/v3/FAZ_RAPORLARI.md", "content/v3/x.json", "content/v3/notlar.md", "app/page.tsx", "src/lib/v3/mix/A.ts"]), ["content/v3/x.json", "src/lib/v3/mix/A.ts"]);
    assert.deepEqual(taskWords("Anlatılan topluluk KALABALIK görünür; İstanbul ve the crowd"), ["anlatilan", "topluluk", "kalabalik", "gorunur", "istanbul", "crowd"]);
    const g = { id: "j", kaynak: "is" as const, gorev: "t", dosyalar: ["src/lib/v3/a.ts", "src/lib/v3/b.ts"], adaylar: ["src/lib/v3/a.ts", "src/lib/v3/b.ts", "src/lib/v3/c.ts"], karar: "yapilmali" as const };
    const graded = gradeGuess(g, ["src/lib/v3/a.ts", "src/lib/v3/c.ts", "scripts/smoke-v3-a.ts"]);
    assert.deepEqual([graded.isabet, graded.kesinlik, graded.adayIsabet, graded.kararDogru], [0.5, 0.5, 1, true]);
    assert.deepEqual([gradeGuess({ ...g, dosyalar: [], karar: "var" }, []).isabet, gradeGuess({ ...g, dosyalar: [], karar: "var" }, []).kararDogru, gradeGuess(g, []).kararDogru], [1, true, false]);
    // Instincts: a new file starts as a candidate; another source on a similar task confirms it; misses lower it.
    const task = "kalabalık sahnede askerler yürür";
    // (11 Nov 2026: one instinct per word stem and file — a whole-sentence trigger never met a second task.)
    const crowdFile = "src/lib/v3/script/CrowdRules.ts";
    assert.deepEqual(instinctTriggers("Haritada harita, haritanın askerleri"), ["harit", "asker"]);
    let list = learnInstincts([], task, [crowdFile], "c1");
    assert.deepEqual([list.map((i) => i.tetik), list[0]!.guven, list[0]!.durum], [["kalab", "sahne", "asker", "yurur"], START_CONFIDENCE, "aday"]);
    assert.equal(learnInstincts(list, task, [crowdFile], "c1")[0]!.guven, START_CONFIDENCE, "the same source twice confirms nothing");
    assert.equal(firedInstincts(list, task).length, 0, "seen in one change only: a coincidence, it stays silent");
    // Two tasks that share ONE word confirm it (as sentences they share too little to have met).
    list = learnInstincts(list, "kalabalığın gölgesi uzar, müzik kısılır", [crowdFile], "c2");
    list = learnInstincts(list, "kalabalıkta bayraklar dalgalanır", [crowdFile], "c3");
    const kalab = list.find((i) => i.tetik === "kalab")!;
    assert.deepEqual([kalab.guven, kalab.durum, kalab.kanit], [0.7, "dogrulandi", ["c1", "c2", "c3"]]);
    assert.equal(firedInstincts(list, "sahnede kalabalık askerler")[0]?.dosya, crowdFile);
    assert.equal(firedInstincts(list, "top sesi yankılanır").length, 0);
    assert.deepEqual(instinctFiles(list, "kalabalık müzik eşliğinde")[0], { dosya: crowdFile, guven: 0.7, tetikler: ["kalab"] });
    // A sweep over many files teaches no word.
    assert.equal(learnInstincts(list, "kalabalık her yerde", Array.from({ length: 9 }, (_, k) => `src/lib/v3/mix/F${k}.ts`), "wide").length, list.length);
    for (const other of ["m1", "m2", "m3", "m4", "m5", "m6"]) list = learnInstincts(list, "kalabalık başka yerde", ["src/lib/v3/mix/Other.ts"], other);
    const crowd = list.find((i) => i.tetik === "kalab" && i.dosya === crowdFile)!;
    assert.deepEqual([crowd.durum, crowd.guven < 0.2], ["reddedildi", true], "an instinct that keeps missing is dropped");
    assert.equal(instinctFiles(list, "kalabalık")[0]?.dosya, "src/lib/v3/mix/Other.ts");
    // A dropped one that meets its file again starts over as a candidate.
    assert.deepEqual([learnInstincts(list, "kalabalık döner", [crowdFile], "c9").find((i) => i.tetik === "kalab" && i.dosya === crowdFile)!.durum], ["aday"]);
    // A store of old sentence triggers is recognised and rebuilt from the change memory, oldest first.
    assert.equal(hasSentenceInstincts([{ tetik: "kalabalik sahnede askerler", dosya: crowdFile, guven: 0.4, durum: "aday", kanit: ["x"], tarih: at(1) }]), true);
    assert.equal(hasSentenceInstincts(list), false);
    const rebuilt = rebuildInstincts([{ id: "r2", tarih: at(2), mesaj: "kalabalık yürür", dosyalar: [crowdFile] }, { id: "r1", tarih: at(1), mesaj: "kalabalık bekler", dosyalar: [crowdFile] }, { id: "r0", tarih: at(0), mesaj: "yalnız not", dosyalar: [] }]);
    assert.deepEqual(rebuilt.find((i) => i.tetik === "kalab")!.kanit, ["r1", "r2"]);
    // Past changes: only earlier ones, never the task's own.
    const past = [{ id: "a", tarih: at(1), mesaj: "kalabalık askerler sahnede", dosyalar: ["x"] }, { id: "b", tarih: at(5), mesaj: "kalabalık askerler sahnede yürür", dosyalar: ["y"] }];
    assert.deepEqual(similarChanges(past, "askerler kalabalık sahnede", { before: at(3) }).map((c) => c.id), ["a"]);
    assert.deepEqual(similarChanges(past, "askerler kalabalık sahnede", { exclude: "a" }).map((c) => c.id), ["b"]);
    // The report card: too few grades is a start; twenty good ones say "may be ready".
    const grade = (isabet: number, kesinlik: number): DevGrade => ({ id: "x", kaynak: "commit", tarih: at(0), gorev: "t", tahmin: [], gercek: [], isabet, kesinlik, adayIsabet: 1 });
    assert.equal(readiness([grade(1, 1)]).seviye, "baslangic");
    assert.equal(readiness(Array.from({ length: 8 }, () => grade(0.4, 0.3))).seviye, "ogreniyor");
    assert.equal(readiness(Array.from({ length: 8 }, () => grade(0.7, 0.5))).seviye, "yaklasiyor");
    assert.equal(readiness(Array.from({ length: READY_WINDOW }, () => grade(0.9, 0.7))).seviye, "hazir");
    assert.match(readiness(Array.from({ length: 8 }, () => grade(0.5, 0.25))).ozet, /^öğreniyor — son 8 işte: değişen dosyaları bulma %50 · andığı dosyalarda doğruluk %25 · arama kapsamı %100$/);
    // From 16:30 to 7 by default (owner, 3 Nov 2026); whole hours still work.
    const on = { ATOLYE_V3_GELISTIRICI: "1" };
    const clock = (h: number, m: number) => developerWindow(on, new Date(2026, 10, 3, h, m)).acik;
    assert.deepEqual([clock(16, 29), clock(16, 30), clock(23, 0), clock(6, 59), clock(7, 0), clock(12, 0)], [false, true, true, true, false, false]);
    assert.equal(developerWindow({ ...on, ATOLYE_V3_GELISTIRICI_SAAT: "1-7" }, new Date(2026, 10, 3, 3, 0)).acik, true);
    assert.equal(developerWindow({ ...on, ATOLYE_V3_GELISTIRICI_SAAT: "1-7" }, new Date(2026, 10, 3, 17, 0)).acik, false);
    // Claude gets the brain's note, marked as an apprentice's guess; without a note the packet is as before.
    const p = { id: "x", beyin: "kurgu" as const, baslik: "Crowds", neden: "n", kaynaklar: [], karar: { tarih: at(0) } };
    assert.ok(taskPacket(p, undefined, "# Geliştirici beyninin araştırması\nsrc/lib/v3/a.ts").includes("THE STUDIO'S OWN DEVELOPER BRAIN RESEARCHED THIS TODAY"));
    assert.ok(!taskPacket(p).includes("DEVELOPER BRAIN"));
    // Waterloo, 6 Nov 2026: the sound brain's general idea came from one exact fault in the production's KURUL.md; the
    // developer is given that brain's measured lines, not the discussion and not the other brains'.
    const kurul = [
      "# Yapım kurulu raporu — Waterloo",
      "## Eksikler",
      "- **Kostüm beyni** — parça tasarlanamadı (Blücher's medals): … _[veri]_",
      "## Uyarılar",
      "- **Ses beyni** — dönem efekti/ortam sesi yapılamadı (miks): efekt davul: kütüphane kaydı kaldı — vuruş yok, sürekli ses (kontrast 4.7 dB) _[veri]_",
      "- **Ses beyni** — dönem efekti/ortam sesi yapılamadı (miks): efekt davul: kütüphane kaydı kaldı — vuruş yok, sürekli ses (kontrast 4.7 dB) _[veri]_",
      "## Tartışmalar",
      "- **Ses beyni:** destekliyor: n1",
    ].join("\n");
    const sound = measuredFaults(kurul, "Ses beyni");
    assert.deepEqual(sound, ["Ses beyni — dönem efekti/ortam sesi yapılamadı (miks): efekt davul: kütüphane kaydı kaldı — vuruş yok, sürekli ses (kontrast 4.7 dB) _[veri]_"]);
    assert.deepEqual(measuredFaults(kurul, "Kostüm beyni").length, 1);
    assert.deepEqual(measuredFaults(kurul, "Kurgu beyni"), []);
    const told = taskPacket({ ...p, beyin: "ses" }, undefined, undefined, sound);
    assert.match(told, /WHAT THOSE PRODUCTIONS MEASURED FOR THIS BRAIN[^\n]*\n- Ses beyni — .*efekt davul/);
    assert.ok(!taskPacket(p, undefined, undefined, []).includes("MEASURED"), "nothing measured: the packet is as before");
  });

  await scenario("I the developer brain in a real git repo: an exam on the newest commit at its parent, research before the build, graded against Claude's change, a lesson when it missed", async () => {
    const base = mkdtempSync(path.join(os.tmpdir(), "v3-gelistirici-beyni-"));
    const repo = path.join(base, "repo");
    const work = path.join(base, "runtime");
    const g = async (args: string[], cwd = repo) => {
      const r = await runProcess("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd });
      assert.equal(r.code, 0, `${args.join(" ")}: ${r.stderr}`);
      return r.stdout.trim();
    };
    const write = (f: string, s: string) => {
      mkdirSync(path.dirname(path.join(repo, f)), { recursive: true });
      writeFileSync(path.join(repo, f), s);
    };
    write("src/lib/v3/mix/Mixer.ts", "/** Mixes the music bed under the narration. More text. */\nexport const musicVolume = 0.3;\n");
    write("src/lib/v3/script/Writer.ts", "/** Writes the narration. */\nexport const writer = 1;\n");
    write(".gitignore", "/node_modules\n");
    await g(["init", "-q", "-b", "main"]);
    await g(["add", "-A"]);
    await g(["commit", "-q", "-m", "feat(v3): ilk"]);
    write("src/lib/v3/mix/Mixer.ts", "/** Mixes the music bed under the narration. */\nexport const musicVolume = 0.25;\n");
    await g(["commit", "-q", "-am", "fix(v3): müzik sesi kısıldı"]);
    write("src/lib/v3/mix/Mixer.ts", "/** Mixes the music bed under the narration. */\nexport const musicVolume = 0.2;\nexport const crowdVolume = 0.5;\n");
    write("docs/v3/notlar.md", "not\n");
    await g(["add", "-A"]);
    await g(["commit", "-q", "-m", "feat(v3): kalabalık sesi müziğin altında"]);
    // A fake model: search words, then the guess (one real path, one made up), then a lesson.
    const prompts: string[] = [];
    let pick = ["src/lib/v3/mix/Mixer.ts", "src/lib/v3/mix/YokBoyle.ts"];
    const model = {
      generate: async (prompt: string) => {
        prompts.push(prompt);
        const content = prompt.includes("search terms")
          ? '{"terimler": ["musicVolume", "Mixer"]}'
          : prompt.includes("Write ONE lesson")
            ? '{"ders": "Ses işleri mix klasöründe; önce Mixer.ts\'e bak."}'
            : prompt.includes("learn HOW it was done")
              ? '{"nasil": "Mixer.ts\'te musicVolume kısıldı, yanına crowdVolume sabiti eklendi."}'
              : JSON.stringify({ dosyalar: pick, semboller: ["Mixer.ts#crowdVolume", "yokBoyle()"], karar: "yapilmali", plan: "Mixer.ts'te ses düzeyi değişir.", test: "scripts/smoke-v3-mix.ts" });
        return { content, finishReason: "stop" as const, refused: false, complete: true, truncated: false };
      },
    };
    const deps = { repoRoot: repo, workRoot: work, budget: new V3Budget({ providers: { mock: model }, capUsd: 0 }), model: { provider: "mock" as const }, log: () => {} };
    // First pass: the older commits are read, the newest is the exam (guessed at its parent, which lacks crowdVolume).
    const first = await learnFromCommits(deps, 1);
    assert.deepEqual([first.okunan, first.sinav], [3, 1]);
    const grades = await listGrades(work);
    assert.deepEqual([grades.length, grades[0]!.kaynak, grades[0]!.gercek, grades[0]!.isabet, grades[0]!.kesinlik], [1, "commit", ["src/lib/v3/mix/Mixer.ts"], 1, 1], "the made-up path is not counted");
    assert.ok(prompts.some((x) => x.includes("TASK (Turkish): kalabalık sesi müziğin altında")), "the exam's task is the subject without its type");
    assert.ok(prompts.some((x) => x.includes("SIMILAR PAST CHANGES") && x.includes("müzik sesi kısıldı")), "the earlier change is remembered");
    assert.ok(!prompts.some((x) => x.includes("SIMILAR PAST CHANGES") && (x.includes('"kalabalık sesi müziğin altında" →') || x.includes('"kalabalık sesi müziğin altında":'))), "never its own answer");
    // The code: every commit's declarations and added code are kept; the exam saw the parent's declarations, never the answer.
    const examPrompt = prompts.find((x) => x.includes("TASK (Turkish): kalabalık sesi müziğin altında") && x.includes("Decide which files"))!;
    assert.ok(examPrompt.includes("declares: musicVolume"), "the candidates' declarations at the parent");
    assert.ok(examPrompt.includes("src/lib/v3/mix/Mixer.ts (+2/-2): musicVolume"), "the similar change shown as code");
    assert.ok(!examPrompt.includes("crowdVolume"), "the answer's new constant is not in the exam");
    assert.deepEqual([first.kod, first.tarif], [3, 3]);
    const code = await listCodeExperience(work);
    assert.equal(code.length, 3);
    const newest = code.find((x) => x.gorev === "kalabalık sesi müziğin altında")!;
    assert.deepEqual(newest.dosyalar.map((t) => [t.dosya, t.semboller, t.eklenen, t.silinen]), [["src/lib/v3/mix/Mixer.ts", ["musicVolume", "crowdVolume"], 2, 1]], "docs are not graded files");
    assert.match(newest.dosyalar[0]!.ornek, /export const crowdVolume = 0\.5;/);
    assert.equal(newest.nasil, "Mixer.ts'te musicVolume kısıldı, yanına crowdVolume sabiti eklendi.");
    assert.equal(grades[0]!.sembolIsabet, 0.5, "named crowdVolume of musicVolume + crowdVolume; a made-up name counts nothing");
    assert.deepEqual(grades[0]!.gercekSemboller, ["musicVolume", "crowdVolume"]);
    assert.match(readiness(grades).ozet, /değişen fonksiyonları bulma %50/);
    assert.equal((await listChanges(work)).length, 3);
    assert.ok((await readInstincts(work)).some((i) => i.dosya === "src/lib/v3/mix/Mixer.ts"));
    assert.equal((await learnFromCommits(deps, 1)).okunan, 0, "a commit is read once");
    const view0 = await loadDevBrainView(work);
    assert.deepEqual([view0.kod?.toplam, view0.kod?.tarifli], [3, 3]);
    // A job: researched by day (guess recorded, note written), then Claude's build grades it.
    await proposeDevelopment(work, { beyin: "ses", baslik: "Kalabalık sesi daha yüksek", neden: "savaş sahnesinde duyulmuyor", kaynak: "ep1", kaynakTuru: "olcum" });
    const id = (await listProposals(work))[0]!.proposal.id;
    await decideProposal(work, id, "onaylandi");
    const job = (await listProposals(work))[0]!.proposal;
    assert.equal(await needsResearch(work, job), true);
    assert.deepEqual(await researchQueue([job], deps), [`"Kalabalık sesi daha yüksek": 1 dosya`]);
    assert.equal(await needsResearch(work, job), false, "researched once");
    const note = readFileSync(researchNote(work, id), "utf8");
    assert.match(note, /Mixer\.ts — Mixes the music bed under the narration\./);
    assert.match(note, /Benzer geçmiş değişikliklerin kodu/);
    assert.match(note, /nasıl: Mixer\.ts'te musicVolume kısıldı/, "Claude's packet carries how the similar change was done");
    assert.match(note, /Ekleneceğini\/değişeceğini düşündüğü bildirimler:\*\* crowdVolume, yokBoyle/);
    // The evening: Claude (a fake agent) gets the note with its task, changes a file the brain did not name.
    const seen = path.join(base, "paket.txt");
    const agent = [process.execPath, "-e", `let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{require("fs").writeFileSync(${JSON.stringify(seen)},s);require("fs").writeFileSync("src/lib/v3/script/Writer.ts","/** Writes. */\\nexport const writer = 2;\\n");console.log("Writer.ts değişti")})`];
    pick = ["src/lib/v3/mix/Mixer.ts"];
    const done = await runDevJob(job, deps, { agent, checks: [], worktreeRoot: path.join(base, "gelistirme") });
    assert.equal(done.durum, "hazir", JSON.stringify(done.is));
    assert.ok(readFileSync(seen, "utf8").includes("THE STUDIO'S OWN DEVELOPER BRAIN RESEARCHED THIS TODAY") && readFileSync(seen, "utf8").includes("Mixer.ts"));
    const jobGrade = (await listGrades(work)).at(-1)!;
    assert.deepEqual([jobGrade.kaynak, jobGrade.gercek, jobGrade.isabet, jobGrade.kararDogru], ["is", ["src/lib/v3/script/Writer.ts"], 0, true]);
    // Claude's build is read as code from its branch: Writer.ts's `writer` changed, and the lesson prompt names it.
    assert.deepEqual([jobGrade.sembolIsabet, jobGrade.gercekSemboller], [0, ["writer"]]);
    const built = (await listCodeExperience(work)).find((x) => x.id === id)!;
    assert.deepEqual(built.dosyalar.map((t) => [t.dosya, t.semboller]), [["src/lib/v3/script/Writer.ts", ["writer"]]]);
    assert.ok(built.nasil, "a recipe for Claude's build");
    assert.ok(prompts.some((x) => x.includes("Write ONE lesson") && x.includes("(declarations: writer)")));
    assert.deepEqual((await listLessons(work)).map((l) => l.metin), ["Ses işleri mix klasöründe; önce Mixer.ts'e bak."], "a miss teaches a lesson");
    const view = await loadDevBrainView(work);
    assert.equal(view.notlar.length, 2);
    assert.ok(view.akis.some((t) => t.kime === "Claude") && view.akis.some((t) => /tahminim %0 tuttu/.test(t.metin)));
  });

  await scenario("J code experience from a diff: declarations by span (doc comment, a removed function, blank lines), JSON keys, tests apart, biggest file first, excerpt capped", () => {
    const post = ['import x from "y";', "", "/** Mixes. */", "export const musicVolume = 0.2;", "", "export function duck(v: number): number {", "  return v * 0.5;", "}", "", "/** New. */", "export const crowdVolume = 0.5;"].join("\n");
    assert.deepEqual(declarationSpans(post).map((s) => [s.ad, s.bas, s.son]), [["musicVolume", 3, 5], ["duck", 6, 9], ["crowdVolume", 10, 11]], "a doc comment belongs to its declaration");
    const diff = [
      "diff --git a/src/lib/v3/mix/Mixer.ts b/src/lib/v3/mix/Mixer.ts",
      "index 1111111..2222222 100644",
      "--- a/src/lib/v3/mix/Mixer.ts",
      "+++ b/src/lib/v3/mix/Mixer.ts",
      '@@ -3,9 +3,11 @@ import x from "y";',
      " /** Mixes. */",
      "-export const musicVolume = 0.3;",
      "+export const musicVolume = 0.2;",
      " ",
      "-export function oldDuck(): void {",
      "-  return;",
      "-}",
      "-",
      " export function duck(v: number): number {",
      "   return v * 0.5;",
      " }",
      "+",
      "+/** New. */",
      "+export const crowdVolume = 0.5;",
      "diff --git a/content/v3/voices.json b/content/v3/voices.json",
      "--- a/content/v3/voices.json",
      "+++ b/content/v3/voices.json",
      "@@ -1,3 +1,4 @@",
      " {",
      '+  "khalid": { "voice": "x" },',
      '   "rawson": {}',
      " }",
      "diff --git a/scripts/smoke-v3-mix.ts b/scripts/smoke-v3-mix.ts",
      "--- a/scripts/smoke-v3-mix.ts",
      "+++ b/scripts/smoke-v3-mix.ts",
      "@@ -1 +1,2 @@",
      " a",
      "+b",
      "diff --git a/docs/v3/notlar.md b/docs/v3/notlar.md",
      "@@ -1 +1 @@",
      "-x",
      "+y",
    ].join("\n");
    const files = parseDiff(diff);
    assert.deepEqual(files.map((f) => f.dosya), ["src/lib/v3/mix/Mixer.ts", "content/v3/voices.json", "scripts/smoke-v3-mix.ts", "docs/v3/notlar.md"]);
    const mixer = files[0]!;
    assert.deepEqual([mixer.eklenenSatirlar, mixer.silinenYerler, mixer.eklenen, mixer.silinen], [[4, 10, 11], [], 4, 5], "the blank added line and the removed function's lines blame nobody");
    assert.deepEqual(touchedDeclarations(mixer, post), ["musicVolume", "crowdVolume", "oldDuck"], "duck itself was left alone");
    assert.deepEqual(touchedDeclarations(mixer), ["musicVolume", "oldDuck", "crowdVolume"], "without the post-image: the changed lines' own declarations");
    // A body line deleted inside a function is that function's change.
    const inside = parseDiff(["diff --git a/src/lib/v3/a.ts b/src/lib/v3/a.ts", "@@ -6,3 +6,2 @@ export function duck(v: number): number {", "-  v++;", "   return v * 0.5;", " }"].join("\n"))[0]!;
    assert.deepEqual(touchedDeclarations(inside, post), ["duck"]);
    const x = codeExperience({ id: "abc", tarih: "2026-11-03T20:00:00+03:00", gorev: "kalabalık sesi", diff, postImages: { "src/lib/v3/mix/Mixer.ts": post } });
    assert.deepEqual(x.dosyalar.map((t) => [t.dosya, t.semboller]), [["src/lib/v3/mix/Mixer.ts", ["musicVolume", "crowdVolume", "oldDuck"]], ["content/v3/voices.json", ["khalid"]]], "biggest first; notes and suites are not graded files");
    assert.deepEqual(x.testler, ["scripts/smoke-v3-mix.ts"]);
    assert.deepEqual(changedSymbols(x), ["musicVolume", "crowdVolume", "oldDuck", "khalid"]);
    assert.equal(x.dosyalar[0]!.ornek, ['@@ import x from "y";', "export const musicVolume = 0.2;", "/** New. */", "export const crowdVolume = 0.5;"].join("\n"));
    const lines = codeExperienceLines({ ...x, nasil: "Mixer.ts'e crowdVolume eklendi." }, { ornek: 40 });
    assert.deepEqual(lines.slice(0, 4), ["  src/lib/v3/mix/Mixer.ts (+4/-5): musicVolume, crowdVolume, oldDuck", "  content/v3/voices.json (+1/-0): khalid", "  test: scripts/smoke-v3-mix.ts", "  nasıl: Mixer.ts'e crowdVolume eklendi."]);
    assert.ok(lines.includes("  kod (src/lib/v3/mix/Mixer.ts):"));
    const long = parseDiff(["diff --git a/src/lib/v3/b.ts b/src/lib/v3/b.ts", "@@ -0,0 +1,1 @@", `+export const big = "${"x".repeat(3_000)}";`].join("\n"))[0]!;
    assert.ok(long.ornek.length <= EXCERPT_CHARS + 2 && long.ornek.endsWith("…"));
    // The symbol grade: out of at most ten, names only.
    const many = Array.from({ length: 30 }, (_, i) => `f${i}`);
    const g = gradeGuess({ id: "c", kaynak: "commit", gorev: "t", dosyalar: [], adaylar: [], karar: "yapilmali", semboller: many.slice(0, 5) }, [], new Date(), many);
    assert.equal(g.sembolIsabet, 0.5);
    assert.equal(gradeGuess({ id: "c", kaynak: "commit", gorev: "t", dosyalar: [], adaylar: [], karar: "yapilmali" }, []).sembolIsabet, undefined, "no real declarations, no symbol grade");
    // The research note shows what it expects to declare and how similar changes were done.
    const md = researchMarkdown(
      { id: "j", kaynak: "is", tarih: "t", gorev: "g", dosyalar: ["src/lib/v3/mix/Mixer.ts"], karar: "yapilmali", plan: "p", adaylar: [], model: "m", semboller: ["crowdVolume"] },
      { benzer: [], icguduler: [], ozetler: {}, kod: [{ ...x, nasil: "Mixer.ts'e crowdVolume eklendi." }] },
    );
    assert.match(md, /bildirimler:\*\* crowdVolume/);
    assert.match(md, /- "kalabalık sesi" \(abc\)\n {2}src\/lib\/v3\/mix\/Mixer\.ts \(\+4\/-5\)/);
    assert.match(md, /kod \(src\/lib\/v3\/mix\/Mixer\.ts\):\n {4}@@ import x/);
  });

  await scenario("K main-AYAS jobs (owner, 9 Nov 2026: \"ayas tamamen otomatik çalışacak, benim onay uygula diye tıklama ile onay alıp yapacak\"): the owner's request, the code lane's limits, the build identity the click binds to, the outcome back in the queue", async () => {
    const base = mkdtempSync(path.join(os.tmpdir(), "v3-ayas-is-"));
    const repo = path.join(base, "repo");
    const work = path.join(base, "runtime");
    mkdirSync(path.join(repo, "src", "lib", "ayas"), { recursive: true });
    mkdirSync(path.join(repo, "scripts"), { recursive: true });
    mkdirSync(path.join(repo, "node_modules", "pkg"), { recursive: true });
    writeFileSync(path.join(repo, "node_modules", "pkg", "keep.txt"), "dep");
    writeFileSync(path.join(repo, ".gitignore"), "/node_modules\n");
    writeFileSync(path.join(repo, "src", "lib", "ayas", "Greeting.ts"), "export const greeting = \"merhaba\";\n");
    writeFileSync(path.join(repo, "scripts", "smoke-ayas-flaky.ts"), "// an older suite this machine cannot pass\n");
    const g = async (args: string[], cwd = repo) => {
      const r = await runProcess("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.autocrlf=false", ...args], { cwd });
      assert.equal(r.code, 0, `${args.join(" ")}: ${r.stderr}`);
      return r.stdout.trim();
    };
    await g(["init", "-q", "-b", "main"]);
    await g(["add", "-A"]);
    await g(["commit", "-q", "-m", "init"]);
    const head = await g(["rev-parse", "HEAD"]);

    // The owner's own request goes straight into the queue as an approved main-AYAS job.
    await assert.rejects(requestDevelopment(work, "kısa"), /V3_REQUEST_TOO_SHORT/);
    const req = await requestDevelopment(work, "Gelişim Merkezi'nde araştırma kartlarına tarih ekle\nher kartın altında, gün ve saatle.");
    assert.deepEqual([req.durum, req.kapsam, req.kaynakTuru, req.baslik, req.beyin], ["onaylandi", "ayas", "istek", "Gelişim Merkezi'nde araştırma kartlarına tarih ekle", "sef"]);
    assert.equal(nextJob([req])?.id, req.id);
    assert.equal(nextJob([req], Date.now(), { ATOLYE_AYAS_GELISTIRME: "0" }), undefined, "main-AYAS jobs can be switched off on their own");
    for (let i = 0; i < 4; i++) await requestDevelopment(work, `İstek numarası ${i} için yeterince uzun bir metin`);
    await assert.rejects(requestDevelopment(work, "Altıncı istek kuyruk dolu olduğu için kabul edilmemeli"), /V3_REQUEST_LIMIT/);

    // The lane's limits, the rules and the agent.
    assert.deepEqual(forbiddenChanges(["src/lib/ayas/A.ts", "app/brain/actions.ts", "src/components/brain/AtolyeBrainsPanel.tsx", "src/lib/v3/maps/X.ts", "src/components/homepage/H.tsx", "package.json", "src/lib/brain/autonomy/AyasCodeChangeLane.ts", "scripts/v3/yapim.ts"], "ayas"),
      ["src/components/homepage/H.tsx", "package.json", "src/lib/brain/autonomy/AyasCodeChangeLane.ts", "scripts/v3/yapim.ts"]);
    assert.deepEqual(forbiddenChanges(["src/lib/ayas/A.ts"]), ["src/lib/ayas/A.ts"], "a V3 job still changes only the studio");
    const packet = ayasTaskPacket(req, { sorunlar: ["tsc failed"] });
    assert.ok(packet.startsWith(`AYAS GELİŞTİRME İŞİ ${req.id}`) && packet.includes("The owner asked AYAS for this") && packet.includes("THE LAST ATTEMPT WAS THROWN AWAY BECAUSE: tsc failed") && packet.includes("already does this"));
    assert.ok(AYAS_DEVELOPER_RULES.includes("ayas-gelistirici") && AYAS_DEVELOPER_RULES.includes("ONAYLA VE UYGULA") && AYAS_DEVELOPER_RULES.includes("Do NOT run git") && AYAS_DEVELOPER_RULES.includes("smoke-ayas-observer-autostart"));
    const agent = claudeAgent({ APPDATA: "C:\\AppData", ATOLYE_V3_CLAUDE_CLI: "" }, "ayas");
    assert.ok(agent.some((a) => a.startsWith("--allowedTools=") && a.includes("Bash(npx tsx scripts/smoke-:*)") && a.includes("ayas-ui-audit")) && agent.includes(AYAS_DEVELOPER_RULES));
    assert.ok(agent.some((a) => a === "--disallowedTools=Bash(npx tsx scripts/smoke-ayas-observer-autostart.ts:*)"));
    assert.ok(!claudeAgent({ APPDATA: "C:\\AppData", ATOLYE_V3_CLAUDE_CLI: "" }).some((a) => a.includes("smoke-:*")), "a V3 job's tools are unchanged");

    // The checks a main-AYAS build runs: its own suites, the closure suites, the suites naming a changed module, the V3 ones for a V3 file.
    mkdirSync(path.join(base, "checks", "scripts"), { recursive: true });
    for (const [name, text] of [["smoke-ayas-greeting.ts", "import { greeting } from \"../src/lib/ayas/Greeting\";"], ["smoke-ayas-other.ts", "// nothing"], ["smoke-ayas-action-firewall-closure.ts", ""], ["smoke-ayas-eval-yardstick-protection.ts", ""], ["smoke-v3-a.ts", ""], ["smoke-ayas-observer-autostart.ts", "Greeting"]] as const) writeFileSync(path.join(base, "checks", "scripts", name), text);
    const labels = (await ayasChecks(path.join(base, "checks"), ["src/lib/ayas/Greeting.ts"])).map((c) => c.slice(1).join(" ").replace(/\\/g, "/"));
    assert.deepEqual(labels.slice(1, -1).map((l) => l.replace(/^.*?(scripts\/smoke-[\w.-]+\.ts)$/, "$1")), ["scripts/smoke-ayas-action-firewall-closure.ts", "scripts/smoke-ayas-eval-yardstick-protection.ts", "scripts/smoke-ayas-greeting.ts"]);
    assert.ok(labels[0]!.endsWith("tsc --noEmit") && labels.at(-1)!.endsWith("lint-yerel.mjs"));
    assert.ok((await ayasChecks(path.join(base, "checks"), ["src/lib/v3/maps/X.ts"])).some((c) => c.some((a) => a.replace(/\\/g, "/").endsWith("scripts/smoke-v3-a.ts"))));

    // A build: kept with its identity; a suite failing on the base too does not count, one the build changed does.
    const fakeAgent = (code: string) => [process.execPath, "-e", `${code};process.stdin.resume();process.stdin.on("end",()=>console.log("selamlama değişti"))`];
    const deps = (agentCode: string, checks: string[][]) => ({ repoRoot: repo, workRoot: work, worktreeRoot: path.join(base, "gelistirme"), agent: fakeAgent(agentCode), checks, log: () => {} });
    const flaky = [process.execPath, "-e", "process.exit(1)", path.join("scripts", "smoke-ayas-flaky.ts")];
    const pass = [process.execPath, "-e", "require('fs').accessSync('node_modules/pkg/keep.txt')"];
    const done = await develop(req, deps(`require("fs").writeFileSync("src/lib/ayas/Greeting.ts","export const greeting = \\"selam\\";\\n")`, [pass, flaky]));
    assert.equal(done.durum, "hazir", JSON.stringify(done.is));
    assert.deepEqual([done.is?.taban, done.is?.tabandaDusen, done.is?.dosyaHash?.map((f) => f.path)], [head, ["scripts/smoke-ayas-flaky.ts"], ["src/lib/ayas/Greeting.ts"]]);
    const build = codeBuildOf(done)!;
    assert.ok(build && build.scope === "ayas" && build.commit === done.is?.commit && build.smokes.length === 0);
    assert.equal(ayasCodeBuildHash(build), done.is?.yapiHash, "the identity the owner's card shows");
    assert.equal(done.is!.dosyaHash![0]!.sha256, ayasCodeContentSha256("export const greeting = \"selam\";\n"));
    const message = await g(["log", "-1", "--format=%B", `gelistirme/${req.id}`]);
    assert.match(message, /^feat\(ayas\): Gelişim Merkezi'nde araştırma kartlarına tarih ekle/);
    assert.ok(message.includes(ayasCodeJobTrailer(req.id)) && message.includes("AYAS geliştiricisi (Claude), owner isteği"));
    assert.equal(await g(["rev-parse", "HEAD"]), head, "the checkout did not move");
    assert.equal(readFileSync(path.join(repo, "node_modules", "pkg", "keep.txt"), "utf8"), "dep");
    assert.equal(existsSync(path.join(base, "gelistirme", `${req.id}-taban`)), false, "the base worktree is gone too");
    // The homepage is never changed through the lane; a suite the build changed always counts.
    const other = (await listProposals(work)).map((x) => x.proposal).find((p) => p.kaynakTuru === "istek" && p.durum === "onaylandi")!;
    const homepage = await develop(other, deps(`require("fs").mkdirSync("src/components/homepage",{recursive:true});require("fs").writeFileSync("src/components/homepage/H.tsx","x")`, [pass]));
    assert.equal(homepage.durum, "yapilamadi");
    assert.match(homepage.is!.sorunlar![0]!, /izin dışı dosyalar değişti: src\/components\/homepage\/H\.tsx/);
    await updateProposal(work, other.id, (q) => ({ ...q, durum: "onaylandi" }));
    const own = await develop((await listProposals(work)).find((x) => x.proposal.id === other.id)!.proposal, deps(`require("fs").writeFileSync("scripts/smoke-ayas-flaky.ts","// rewritten\\n")`, [flaky]));
    assert.equal(own.durum, "yapilamadi");
    assert.match(own.is!.sorunlar![0]!, /^kontrol geçmedi/);

    // The owner's card, the click's outcome in the queue, REDDET.
    let view = await loadAtolyeBrainsView(work);
    const row = view.kuyruk.find((k) => k.id === req.id)!;
    assert.deepEqual([row.kapsam, row.kaynak, row.yapi?.buildHash, row.yapi?.dosyalar, row.yapi?.tabandaDusen], ["ayas", "SENİN İSTEĞİN", done.is?.yapiHash, ["src/lib/ayas/Greeting.ts"], ["scripts/smoke-ayas-flaky.ts"]]);
    await recordCodeApply(work, req.id, { status: "QUEUED", reasons: [] });
    view = await loadAtolyeBrainsView(work);
    assert.equal(view.kuyruk.find((k) => k.id === req.id)?.uygulama?.bekliyor, true);
    assert.equal(codeBuildOf((await listProposals(work)).find((x) => x.proposal.id === req.id)!.proposal) && ayasCodeBuildHash(codeBuildOf((await listProposals(work)).find((x) => x.proposal.id === req.id)!.proposal)!), done.is?.yapiHash, "the click's mark leaves the identity alone");
    await assert.rejects(rejectBuild(work, req.id), /V3_BUILD_APPLYING/);
    const stale = await recordCodeApply(work, req.id, { status: "STALE", reasons: ["Greeting.ts değişti"] });
    assert.deepEqual([stale.durum, stale.is?.uygulama?.durum], ["onaylandi", "bayat"], "back in the queue to be built on the new code");
    await updateProposal(work, req.id, () => done);
    const applied = await recordCodeApply(work, req.id, { status: "COMPLETED", commitSha: "c".repeat(40), reasons: [] });
    assert.deepEqual([applied.durum, applied.is?.uygulama?.durum, applied.is?.uygulama?.commit], ["yapildi", "uygulandi", "c".repeat(40)]);
    assert.equal((await recordCodeApply(work, req.id, { status: "REFUSED", reasons: ["x"] })).durum, "yapildi", "a job decided meanwhile keeps its state");
    await updateProposal(work, req.id, () => done);
    assert.equal((await rejectBuild(work, req.id)).durum, "reddedildi");
    // A build made before the lane has no identity: no button, a reason instead.
    await updateProposal(work, req.id, () => ({ ...done, is: { deneme: 1, baslangic: at(0), dal: `gelistirme/${req.id}`, dosyalar: ["src/lib/ayas/Greeting.ts"] } }));
    view = await loadAtolyeBrainsView(work);
    const old = view.kuyruk.find((k) => k.id === req.id)!;
    assert.ok(!old.yapi?.buildHash && /geliştirme oturumu uygular/.test(old.yapi?.engel ?? ""));
    assert.match(brainsReportText(view), /Geliştirme kuyruğu/);
  });

  console.log(`PASS (${scenarios} scenarios)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
