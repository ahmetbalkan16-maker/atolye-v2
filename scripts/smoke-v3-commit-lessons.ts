/**
 * What a session does reaches the brains without a model (owner, 12 Nov 2026: "burda yapılan her şeyi gerekli beyinler
 * öğrensin", "otomatikleştir", "maliyetsiz olsun"): the development branch is learned before it goes live, main AYAS's
 * code is read from Git into its own store and handed to an AYAS job, and a commit's `Ders-<beyin>[konu]:` trailers
 * become that brain's lessons, once. A real git repo in TEMP; no model, no network.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AIProvider } from "../src/lib/ai/providers/AIProvider";
import { commitCases, commitLessons, derivedCase, learnAyasCode, learnCommitLessons, learnRefs, MAX_LESSON_CHARS } from "../src/lib/v3/council/CommitLessons";
import { ayasGradedFiles, ayasPastChanges, briefCaseLine, caseLine, devBrainDir, isAyasSmoke, listAyasCodeExperience, listCases, listChanges, listCodeExperience, listLessons, MAX_CASE_FIELD, recentTalk, recordCase, relevantLessons, similarCaseLines, similarCases } from "../src/lib/v3/council/DevBrain";
import { brainCases, criticBriefing, factCheckBriefing } from "../src/lib/v3/council/BrainBriefing";
import { FACT_CHECK_LESSON_CHARS, FACT_CHECK_LESSONS, factCheckPrompt } from "../src/lib/v3/script/ScriptPrompts";
import { ayasTaskPacket, pastCasesSection, taskPacket } from "../src/lib/v3/council/DevQueue";
import { learnFromCommits } from "../src/lib/v3/council/DevResearch";
import { decideRepair, REPAIR_CASES_CHARS, type RepairContext, repairPrompt } from "../src/lib/v3/council/RepairBrain";
import { allLessons, remember } from "../src/lib/v3/council/ExperienceMemory";
import { V3Budget } from "../src/lib/v3/script/V3Budget";
import { runProcess } from "../src/lib/v3/util/Proc";

let scenarios = 0;
async function scenario(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    scenarios++;
  } catch (e) {
    console.error(`FAIL: ${name}`);
    throw e;
  }
}

async function run() {
  await scenario("A trailers: brain, konu and text are read; unknown or unread brains are ignored; text is cut", () => {
    const msg = [
      "feat(v3): gemiler suya",
      "",
      "Gövde metni.",
      "Ders-kurgu[naval map ships]: Place every ship on open water in the basin where it really lay.",
      "Ders-kalite: A torpedo wake must end where the ship is drawn.",
      "Ders-ses[music]: never read by code",
      "Ders-sef: neither",
      "Ders-yok: unknown brain",
      `Ders-gelistirici: ${"x".repeat(400)}`,
      "  Ders-kostum[Admiral uniform 1940]:   Royal Navy officers wear dark blue with gold rings.  ",
      "Co-Authored-By: someone",
    ].join("\n");
    const l = commitLessons(msg);
    assert.deepEqual(
      l.map((x) => [x.beyin, x.konu]),
      [
        ["kurgu", "naval map ships"],
        ["kalite", "A torpedo wake must end where the ship is drawn."],
        ["gelistirici", "x".repeat(120)],
        ["kostum", "Admiral uniform 1940"],
      ],
    );
    assert.equal(l[2]!.metin.length, MAX_LESSON_CHARS);
    assert.equal(l[3]!.metin, "Royal Navy officers wear dark blue with gold rings.");
  });

  await scenario("B AYAS files and suites: AYAS code only (no notes, no V3), every non-V3 smoke is its test", () => {
    assert.deepEqual(ayasGradedFiles(["app\\api\\auth\\logout\\route.ts", "src/lib/v3/x.ts", "src/lib/ayas/a.ts", "docs/x.md", "src/components/brain/B.tsx", "src/lib/brain/README.md"]), ["app/api/auth/logout/route.ts", "src/components/brain/B.tsx", "src/lib/ayas/a.ts"]);
    assert.equal(isAyasSmoke("scripts/smoke-ayas-login-hardening.ts"), true);
    assert.equal(isAyasSmoke("scripts/smoke-v3-motion.ts"), false);
  });

  const base = mkdtempSync(path.join(os.tmpdir(), "v3-commit-dersleri-"));
  const repo = path.join(base, "repo");
  const work = path.join(base, "runtime");
  mkdirSync(repo, { recursive: true });
  const g = async (args: string[]) => {
    const r = await runProcess("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo });
    assert.equal(r.code, 0, `${args.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const write = (f: string, s: string) => {
    mkdirSync(path.dirname(path.join(repo, f)), { recursive: true });
    writeFileSync(path.join(repo, f), s);
  };
  write("src/lib/v3/maps/MapBuilder.ts", "/** Builds the map. */\nexport const ships = 1;\n");
  write("src/lib/ayas/Login.ts", "/** Signs the owner in. */\nexport const login = 1;\n");
  await g(["init", "-q", "-b", "main"]);
  await g(["add", "-A"]);
  await g(["commit", "-q", "-m", "feat: ilk"]);
  // The development branch moves on; HEAD (main, the live checkout) stays behind.
  await g(["checkout", "-q", "-b", "feature/cop-adam-v3"]);
  write("src/lib/v3/maps/MapBuilder.ts", "/** Builds the map. */\nexport const ships = 1;\nexport function atDrawnShip() {\n  return ships;\n}\n");
  write("scripts/smoke-v3-maps.ts", "// proves atDrawnShip\n");
  await g(["add", "-A"]);
  await g(["commit", "-q", "-m", "feat(v3): uçak rotası çizilen gemiye", "-m", "Ders-kurgu[naval map ships planes]: A plane route ends on the ship it attacks, where the ship is drawn.\nDers-gelistirici: Snap a point to a drawn ship with atDrawnShip in MapBuilder; prove it in smoke-v3-maps."]);
  write("src/lib/ayas/Login.ts", "/** Signs the owner in. */\nexport const login = 1;\nexport function logoutRedirect() {\n  return \"/login\";\n}\n");
  write("scripts/smoke-ayas-login-hardening.ts", "// proves logoutRedirect\n");
  await g(["add", "-A"]);
  await g(["commit", "-q", "-m", "fix(ayas): çıkış yönlendirmesi göreli", "-m", "Ders-kalite[map speech text]: Speech text over a map must sit on a dark plate."]);
  await g(["checkout", "-q", "main"]);

  await scenario("C learnRefs: HEAD plus the development branch when it exists; a missing or unsafe name is skipped", async () => {
    assert.deepEqual(await learnRefs(repo, {}), ["HEAD", "feature/cop-adam-v3"]);
    assert.deepEqual(await learnRefs(repo, { ATOLYE_V3_OGREN_DALLARI: "yok-boyle, --all ,feature/cop-adam-v3" }), ["HEAD", "feature/cop-adam-v3"]);
    assert.deepEqual(await learnRefs(repo, { ATOLYE_V3_OGREN_DALLARI: "" }), ["HEAD"]);
  });

  const refs = await learnRefs(repo, {});

  await scenario("D the developer brain learns a branch commit before it is on HEAD (HEAD alone does not see it)", async () => {
    const noModel = { generate: async () => { throw new Error("no model in this scenario"); } };
    const deps = { repoRoot: repo, workRoot: work, budget: new V3Budget({ providers: { mock: noModel }, capUsd: 0 }), model: { provider: "mock" as const }, log: () => {} };
    const headOnly = await learnFromCommits({ ...deps, workRoot: path.join(base, "head-only") }, 0, 0);
    assert.equal(headOnly.okunan, 1, "HEAD has only the first commit");
    const r = await learnFromCommits({ ...deps, refs }, 0, 0);
    assert.equal(r.okunan, 2, "the first commit and the branch's V3 commit");
    assert.ok((await listChanges(work)).some((c) => c.mesaj === "uçak rotası çizilen gemiye"));
    const code = (await listCodeExperience(work)).find((x) => x.gorev === "uçak rotası çizilen gemiye")!;
    assert.deepEqual(code.dosyalar.map((t) => [t.dosya, t.semboller]), [["src/lib/v3/maps/MapBuilder.ts", ["atDrawnShip"]]]);
    assert.deepEqual(code.testler, ["scripts/smoke-v3-maps.ts"]);
    assert.ok(!(await listChanges(work)).some((c) => c.mesaj.includes("çıkış")), "an AYAS commit never joins the V3 memory");
  });

  await scenario("E lesson trailers reach their brains once; a near-duplicate is not written again", async () => {
    const first = await learnCommitLessons({ repoRoot: repo, workRoot: work, refs });
    assert.deepEqual([first.commit, first.ders], [2, 3]);
    const kurgu = await allLessons(work, "kurgu");
    assert.deepEqual(kurgu.map((l) => [l.tur, l.konu, l.metin]), [["ders", "naval map ships planes", "A plane route ends on the ship it attacks, where the ship is drawn."]]);
    assert.match(kurgu[0]!.bolum, /^commit [0-9a-f]{10}$/);
    assert.equal((await allLessons(work, "kalite"))[0]!.konu, "map speech text");
    assert.deepEqual((await listLessons(work)).map((l) => l.metin), ["Snap a point to a drawn ship with atDrawnShip in MapBuilder; prove it in smoke-v3-maps."]);
    assert.deepEqual([(await learnCommitLessons({ repoRoot: repo, workRoot: work, refs })).ders], [0], "a commit is taught once");
    // A later commit repeating a lesson almost word for word adds nothing.
    await g(["checkout", "-q", "feature/cop-adam-v3"]);
    await g(["commit", "-q", "--allow-empty", "-m", "docs: tekrar", "-m", "Ders-kurgu[naval]: A plane route ends on the ship it attacks, where the ship is drawn!"]);
    await g(["checkout", "-q", "main"]);
    const again = await learnCommitLessons({ repoRoot: repo, workRoot: work, refs });
    assert.deepEqual([again.commit, again.ders, (await allLessons(work, "kurgu")).length], [1, 0, 1]);
  });

  await scenario("F main AYAS's code is read from Git into its own store and handed to a similar AYAS job", async () => {
    const r = await learnAyasCode({ repoRoot: repo, workRoot: work, refs });
    assert.deepEqual([r.kod], [2]);
    const ayas = await listAyasCodeExperience(work);
    const fix = ayas.find((x) => x.gorev === "çıkış yönlendirmesi göreli")!;
    assert.deepEqual(fix.dosyalar.map((t) => [t.dosya, t.semboller]), [["src/lib/ayas/Login.ts", ["logoutRedirect"]]]);
    assert.deepEqual(fix.testler, ["scripts/smoke-ayas-login-hardening.ts"]);
    assert.equal((await learnAyasCode({ repoRoot: repo, workRoot: work, refs })).kod, 0, "read once");
    const packet = await ayasPastChanges(work, "telefonda çıkış yönlendirmesi localhost'a gidiyor");
    assert.match(packet, /SIMILAR PAST AYAS CHANGES/);
    assert.match(packet, /src\/lib\/ayas\/Login\.ts \(\+3\/-0\): logoutRedirect/);
    assert.equal(await ayasPastChanges(work, "harita renkleri"), "", "nothing unrelated");
  });

  await scenario("G Vaka blocks: fields fill the latest case, wrapped lines continue, unknown brains drop, a fix without one is derived", () => {
    const msg = [
      "fix(v3): kuşatmada saldıran surun dışında",
      "",
      "Gövde: MapBuilder kuşatma nizamı.",
      "Vaka[siege map attacker inside walls]: In the Baghdad 1638 episode, scene 7, the attacking blocks stood inside the city walls.",
      "Vaka-neden: placeTokens put both sides at the battle centre and ignored who held the walls.",
      "Vaka-cozum: MapBuilder.siegeLayout puts the attacker outside the wall ring",
      "  in rows (guns, infantry, cavalry on the flanks); the defender on the wall.",
      "Vaka-kanit: smoke-v3-motion scenario V; stills of scene 7 before and after.",
      "Vaka-yakala: On a siege map no attacker block centre may lie inside the wall polygon before the breach.",
      "Vaka-beyin: kurgu, kalite, ses",
      "Ders-kurgu[siege]: The attacker of a siege stands outside the walls until the breach.",
      "",
      "Vaka: A speech badge covered a flag label.",
      `Vaka-cozum: ${"y".repeat(700)}`,
      "Vaka-bilinmeyen: ignored",
      "Co-Authored-By: someone",
    ].join("\n");
    const cases = commitCases(msg);
    assert.equal(cases.length, 2);
    assert.deepEqual([cases[0]!.konu, cases[0]!.beyinler], ["siege map attacker inside walls", ["kurgu", "kalite"]]);
    assert.equal(cases[0]!.cozum, "MapBuilder.siegeLayout puts the attacker outside the wall ring in rows (guns, infantry, cavalry on the flanks); the defender on the wall.");
    assert.match(cases[0]!.kanit!, /^smoke-v3-motion/);
    assert.deepEqual([cases[1]!.konu, cases[1]!.beyinler, cases[1]!.cozum!.length], ["A speech badge covered a flag label.", ["gelistirici"], MAX_CASE_FIELD]);
    assert.ok(!("neden" in cases[1]!), "an empty field is left out");
    assert.deepEqual(commitCases("feat: x\n\nVaka-neden: a field without an opened case"), []);
    const derived = derivedCase("fix(ayas): çıkış yönlendirmesi göreli\n\nTelefonda localhost'a gidiyordu; artık göreli.\nDers-kalite[x]: y\nCo-Authored-By: z");
    assert.deepEqual(derived, { konu: "ayas: çıkış yönlendirmesi göreli", belirti: "çıkış yönlendirmesi göreli", cozum: "Telefonda localhost'a gidiyordu; artık göreli.", beyinler: ["kalite"] });
    assert.equal(derivedCase("feat(v3): yeni"), undefined, "only a fix is derived");
  });

  let vakaSha = "";
  await scenario("H cases are recorded once with the commit's files; a commit taught before cases existed still gets its cases; a fix without a block is derived", async () => {
    // E already ran the new learner: the fix(ayas) commit left a derived case with its files and its Ders- brain.
    const derived = (await listCases(work)).filter((c) => c.kaynak === "turetilmis");
    assert.deepEqual(derived.map((c) => [c.belirti, c.dosyalar, c.beyinler]), [["çıkış yönlendirmesi göreli", ["scripts/smoke-ayas-login-hardening.ts", "src/lib/ayas/Login.ts"], ["kalite"]]]);
    await g(["checkout", "-q", "feature/cop-adam-v3"]);
    write("src/lib/v3/maps/MapBuilder.ts", "/** Builds the map. */\nexport const ships = 1;\nexport function siegeLayout() {\n  return 2;\n}\n");
    await g(["add", "-A"]);
    await g(["commit", "-q", "-m", "fix(v3): kuşatmada saldıran surun dışında", "-m", [
      "Vaka[siege map attacker inside walls]: In the Baghdad 1638 episode, scene 7, the attacking blocks stood inside the city walls.",
      "Vaka-neden: placeTokens put both sides at the battle centre and ignored who held the walls.",
      "Vaka-cozum: MapBuilder.siegeLayout puts the attacker outside the wall ring; the defender on the wall.",
      "Vaka-kanit: smoke-v3-motion scenario V.",
      "Vaka-yakala: On a siege map no attacker block centre may lie inside the wall polygon before the breach.",
      "Vaka-beyin: kurgu, kalite",
      "Ders-kurgu[siege walls]: The attacker of a siege stands outside the walls until the breach.",
    ].join("\n")]);
    vakaSha = await g(["rev-parse", "HEAD"]);
    await g(["checkout", "-q", "main"]);
    // As if an earlier learner (before Vaka blocks existed) had taught this commit's lessons already.
    writeFileSync(path.join(devBrainDir(work), "aktarilan-dersler.jsonl"), `${JSON.stringify({ id: vakaSha, tarih: "x", dersler: 1 })}\n`, { flag: "a" });
    const r = await learnCommitLessons({ repoRoot: repo, workRoot: work, refs });
    assert.deepEqual([r.ders, r.vaka], [0, 1], "lessons not taught twice, the case recorded");
    assert.match(r.ozet, /vaka kitaplığına 1 vaka yazıldı/);
    const c = (await listCases(work)).find((x) => x.commit === vakaSha)!;
    assert.deepEqual([c.id, c.kaynak, c.dosyalar, c.beyinler], [`${vakaSha}#1`, "commit", ["src/lib/v3/maps/MapBuilder.ts"], ["kurgu", "kalite"]]);
    assert.deepEqual([(await learnCommitLessons({ repoRoot: repo, workRoot: work, refs })).vaka, (await listCases(work)).length], [0, 2], "recorded once; a feat or docs commit leaves none");
  });

  await scenario("I similar cases: the closest first, a newer one wins a tie, a brain filter, nothing for an unrelated problem", async () => {
    const hand = await recordCase(work, { id: "el-1", tarih: "2026-11-13T10:00:00Z", kaynak: "el", konu: "narrator voice clipped", belirti: "The narrator's last word was clipped in the Cannae Short, scene 4.", neden: "The mix cut the line at its timeline end, before the voice's tail.", cozum: "Mixer keeps 0.3 s of tail.", beyinler: ["ses"], bolum: "cannae-short" });
    const top = await similarCases(work, "On the close siege map the attacker blocks stand inside the city walls", 3);
    assert.equal(top[0]!.commit, vakaSha);
    assert.ok(!top.some((x) => x.id === hand.id), "the voice case shares nothing with a siege map");
    assert.equal((await similarCases(work, "the narrator voice was clipped at the end of the line", 3))[0]!.id, "el-1");
    await recordCase(work, { ...hand, id: "el-2", tarih: "2026-11-13T11:00:00Z" });
    assert.deepEqual((await similarCases(work, "the narrator voice was clipped at the end of the line", 2)).map((x) => x.id), ["el-2", "el-1"], "a newer case wins a tie");
    assert.deepEqual(await similarCases(work, "the narrator voice was clipped at the end of the line", 3, { beyin: "mizah" }), []);
    assert.deepEqual(await similarCases(work, "harita renkleri", 3), []);
    assert.deepEqual(await similarCases(path.join(base, "bos"), "anything at all here", 3), [], "no library: no case");
    const line = caseLine(top[0]!);
    assert.match(line, /seen: In the Baghdad 1638 episode.*cause: placeTokens.*fix: MapBuilder\.siegeLayout.*files: src\/lib\/v3\/maps\/MapBuilder\.ts.*proven: smoke-v3-motion.*catch: On a siege map/);
    assert.ok(caseLine({ ...hand, belirti: "z".repeat(2_000) }, 300).length <= 300);
    assert.match(caseLine(hand), /\(video cannae-short\)/);
  });

  await scenario("J a development job's packet and the repair brain's prompt carry the nearest cases, bounded; without any they are as before", async () => {
    const lines = await similarCaseLines(work, "Kuşatma haritasında saldıran ordu surların içinde duruyor (siege walls attacker)");
    assert.ok(lines.length >= 1);
    const p = { id: "o1", beyin: "kurgu" as const, baslik: "Kuşatma nizamı", neden: "saldıran surun içinde", kaynaklar: ["bagdat-1638"], kaynakTuru: "olcum" as const };
    const packet = taskPacket(p, undefined, undefined, ["Kurgu beyni: saldıran sur içinde"], lines);
    assert.match(packet, /SIMILAR PAST CASES[^\n]*\n- \[siege map attacker inside walls\]/);
    assert.ok(packet.indexOf("SIMILAR PAST CASES") < packet.indexOf("First find out"), "before the instructions");
    assert.equal(taskPacket(p, undefined, undefined, ["Kurgu beyni: saldıran sur içinde"], []), taskPacket(p, undefined, undefined, ["Kurgu beyni: saldıran sur içinde"]), "no case: as before");
    assert.match(ayasTaskPacket({ ...p, kaynakTuru: "istek" }, undefined, undefined, lines), /SIMILAR PAST CASES/);
    const many = pastCasesSection(Array.from({ length: 8 }, (_, i) => `- case ${i} ${"w".repeat(1_500)}`));
    assert.ok(many.length < 3_200 && !many.includes("case 3"), "at most 3 cases, 3 000 characters");
    const ctx: RepairContext = { step: "harita", error: "V3_SIEGE_LAYOUT attacker block inside the walls polygon", attempt: 1, optional: false, env: {} };
    assert.ok(!repairPrompt(ctx).includes("SIMILAR PAST CASES"));
    assert.equal(repairPrompt({ ...ctx, vakalar: [] }), repairPrompt(ctx));
    const vakalar = await similarCaseLines(work, `${ctx.step} ${ctx.error}`, 3, 500);
    assert.equal(vakalar[0]!.length <= 500 && vakalar[0]!.includes("siege"), true);
    let asked = "";
    const model = { generate: async (prompt: string) => ((asked = prompt), { content: '{"tur": "dur", "neden": "kod düzeltmesi gerek"}', finishReason: "stop", refused: false, complete: true, truncated: false }) } as unknown as AIProvider;
    const action = await decideRepair({ ...ctx, vakalar }, model);
    assert.deepEqual([action.tur, action.kaynak], ["dur", "model"]);
    assert.match(asked, /SIMILAR PAST CASES[^\n]*\n- \[siege map attacker inside walls\][^\n]*fix: MapBuilder\.siegeLayout/);
    assert.ok(repairPrompt({ ...ctx, vakalar: Array.from({ length: 5 }, () => "x".repeat(900)) }).length <= repairPrompt(ctx).length + REPAIR_CASES_CHARS + 200);
  });

  await scenario("K Turkish case keys and brain names are read; an unknown key or brain is warned about, never glued onto the field above", async () => {
    const warned: string[] = [];
    const cases = commitCases(
      [
        "fix(v3): x",
        "Vaka[sayı kayboldu]: The retouch dropped a sourced number.",
        "Vaka-neden: the director's rewrite had no source check.",
        "Vaka-çözüm: RetouchGuard keeps sourced numbers.",
        "Vaka-kanıt: smoke-v3-director-council scenario R.",
        "Vaka-beyinler: araştırma, kurgu, sesçi",
        "Vaka-bölüm: bagdat-1638",
        "Vaka-sonuç: unknown key",
        "Vaka-yakala: a sourced number missing after a retouch.",
      ].join("\n"),
      (w) => warned.push(w),
    );
    assert.equal(cases.length, 1);
    const c = cases[0]!;
    assert.deepEqual([c.belirti, c.cozum, c.kanit, c.bolum, c.beyinler, c.yakala], ["The retouch dropped a sourced number.", "RetouchGuard keeps sourced numbers.", "smoke-v3-director-council scenario R.", "bagdat-1638", ["arastirma", "kurgu"], "a sourced number missing after a retouch."]);
    assert.equal(warned.length, 2, warned.join(" | "));
    assert.match(warned[0]!, /bilinmeyen beyin sesçi/);
    assert.match(warned[1]!, /^Vaka-sonuç: bilinmeyen alan/);
    // Warned once through the learner, into the developer brain's talk.
    await g(["checkout", "-q", "feature/cop-adam-v3"]);
    await g(["commit", "-q", "--allow-empty", "-m", "fix(v3): türkçe vaka", "-m", "Vaka[türkçe anahtar]: a case with Turkish keys.\nVaka-çözüm: read them.\nVaka-nedenler: typo"]);
    await g(["checkout", "-q", "main"]);
    const logged: string[] = [];
    await learnCommitLessons({ repoRoot: repo, workRoot: work, refs, log: (s) => logged.push(s) });
    assert.ok(logged.some((s) => /Vaka-nedenler: bilinmeyen alan/.test(s)), logged.join(" | "));
    assert.ok((await recentTalk(work, 5)).some((t) => /Vaka-nedenler/.test(t.metin)));
    assert.equal((await listCases(work)).find((x) => x.konu === "türkçe anahtar")!.cozum, "read them.");
  });

  await scenario("L content brains get short, relevant cases of their own brain; critics get newest lessons besides topical ones; dev lessons by relevance", async () => {
    const root = path.join(base, "beyinler");
    const at = (n: number) => `2026-11-13T1${n}:00:00Z`;
    await recordCase(root, { id: "el-a", tarih: at(0), kaynak: "el", konu: "retouch removes sourced numbers (Baghdad)", belirti: "Siege of Baghdad Short, retouch round 1: the director replaced the sourced 108,589 men with a vague 'many'.", neden: "The retouch guard did not know which numbers were sourced.", cozum: "RetouchGuard.sourcedNumbers", yakala: "Compare the sourced numbers before and after a retouch; one missing is a fault.", beyinler: ["arastirma", "kurgu", "mizah"], dosyalar: ["src/x.ts"] });
    await recordCase(root, { id: "el-b", tarih: at(1), kaynak: "el", konu: "portrait beard lost", belirti: "Siege of Baghdad Short: Murad IV drawn clean-shaven although every portrait shows a beard.", neden: "The note's clean-shaven beat the portrait.", yakala: "A portrait with a beard must keep the beard.", beyinler: ["kostum", "kalite"] });
    await recordCase(root, { id: "el-c", tarih: at(2), kaynak: "el", konu: "narrator clipped", belirti: "Cannae Short: the narrator's last word was clipped.", beyinler: ["ses"] });
    const lines = await similarCaseLines(root, "1638 Siege of Baghdad", 3, 400, { beyin: "arastirma", brief: true });
    assert.equal(lines.length, 1);
    assert.match(lines[0]!, /^past case \[retouch removes sourced numbers \(Baghdad\)\] seen: .*\| cause: .*\| catch: Compare/);
    assert.ok(!lines[0]!.includes("RetouchGuard.sourcedNumbers") && !lines[0]!.includes("src/x.ts"), "no fix, no files for a content brain");
    assert.ok(briefCaseLine({ ...(await listCases(root))[0]!, belirti: "z".repeat(2_000) }, 400).length <= 400);
    assert.equal((await similarCaseLines(root, "1638 Siege of Baghdad", 3)).length, 2, "without a brain every close case (ses's Cannae case is not close)");
    assert.deepEqual(await brainCases(root, ["kostum"], ["Murad IV 1638", undefined, "Siege of Baghdad 1638"]), [briefCaseLine((await listCases(root))[1]!)], "the topic query finds it; a one-word match does not");
    assert.equal((await brainCases(root, ["kurgu", "mizah"], ["Siege of Baghdad"])).length, 1, "a case of two asked brains comes once");
    assert.deepEqual(await brainCases(root, ["ses"], ["Siege of Baghdad"]), []);
    // Critics: rules, the topical lessons, the newest whatever their topic, then their own cases.
    await remember(root, { bolum: "owner", beyin: "kurgu", tur: "kural", konu: "abone", metin: "End with the subscribe invitation." });
    await remember(root, { bolum: "commit 1", beyin: "kurgu", tur: "ders", konu: "siege walls", metin: "The attacker of a siege stands outside the walls until the breach." });
    await remember(root, { bolum: "x", beyin: "kurgu", tur: "ders", konu: "rotus", metin: "Keep the jokes in a retouch." });
    await remember(root, { bolum: "x", beyin: "kurgu", tur: "onlem", konu: "Short süre", metin: "Short süre: write shorter lines." });
    await remember(root, { bolum: "x", beyin: "kurgu", tur: "ilac", konu: "s | e", metin: "a remedy" });
    const critic = await criticBriefing(root, "kurgu", "1638 Siege of Baghdad walls", "harita: saldıran sur içinde");
    assert.deepEqual(critic.slice(0, 4), ["End with the subscribe invitation.", "The attacker of a siege stands outside the walls until the breach.", "Short süre: write shorter lines.", "Keep the jokes in a retouch."]);
    assert.ok(critic.length === 5 && critic[4]!.startsWith("past case [retouch removes sourced numbers"), critic.join(" | "));
    assert.ok(!critic.includes("a remedy"));
    // The history editor: research lessons from productions and commits (never a studied video's), and research cases.
    await remember(root, { bolum: "referans abc", beyin: "arastirma", tur: "ders", konu: "pace", metin: "Open with a question." });
    await remember(root, { bolum: "commit 2", beyin: "arastirma", tur: "ders", konu: "bilgi kutusu", metin: "Battle strengths are often only in the infobox." });
    const editor = await factCheckBriefing(root, ["Bağdat Kuşatması 1638", "Siege of Baghdad (1638)"]);
    assert.deepEqual(editor.map((l) => l.slice(0, 30)), ["Battle strengths are often onl", "past case [retouch removes sou"]);
    const prompt = factCheckPrompt("{}", "en", undefined, undefined, editor);
    assert.match(prompt, /YOUR LESSONS AND PAST CASES[^\n]*\n- Battle strengths[^\n]*\n- past case \[retouch removes sourced numbers[\s\S]*EPISODE:\n\{\}$/);
    assert.equal(factCheckPrompt("{}", "en", undefined, undefined, []), factCheckPrompt("{}", "en"), "without lessons the prompt is as before");
    assert.ok(factCheckPrompt("{}", "en", undefined, undefined, Array.from({ length: 20 }, () => "w".repeat(2_000))).length < factCheckPrompt("{}", "en").length + FACT_CHECK_LESSONS * (FACT_CHECK_LESSON_CHARS + 3) + 200);
    // The developer brain's written lessons: the relevant ones, the newest on a tie.
    const dev = [{ tarih: "1", id: "a", metin: "Snap ships to water in MapBuilder." }, { tarih: "2", id: "b", metin: "Mixer keeps the narrator's tail." }, { tarih: "3", id: "c", metin: "Render workers halve on a crash." }];
    assert.deepEqual(relevantLessons(dev, "the narrator voice tail was clipped by the mixer", 2).map((l) => l.id), ["b", "c"]);
    assert.deepEqual(relevantLessons(dev, "unrelated", 2).map((l) => l.id), ["c", "b"]);
  });

  console.log(`V3 commit lessons smoke: PASS (${scenarios} scenarios)`);
}

run().catch((e) => {
  console.error("V3 commit lessons smoke FAILED:", e);
  process.exit(1);
});
