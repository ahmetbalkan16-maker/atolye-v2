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
import { applyBuild, changedPaths, claudeAgent, develop, developerLock } from "../src/lib/v3/council/Developer";
import { DEVELOPER_RULES, developerWindow, forbiddenChanges, MAX_DEV_TRIES, nextJob, taskPacket } from "../src/lib/v3/council/DevQueue";
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
    // One developer at a time.
    const release = await developerLock(work);
    assert.ok(release);
    assert.equal(await developerLock(work), undefined);
    await release!();
    assert.ok(await developerLock(work));
  });

  console.log(`PASS (${scenarios} scenarios)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
