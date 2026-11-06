/**
 * V3 smoke: the studio's own developer writing code (owner, 6 Nov 2026: "hem öğrenmesi hızlansın hem de Claude olmadan
 * yazabilecek duruma gelsin") and the proposals reaching the owner ("onaya bir şey düşmüyor ki").
 * - paraphrased proposals are counted on the earlier one by meaning (ProposalMerge), ideas are listed for the owner;
 * - the edit blocks (DevWriter): parsing, exact and tolerant matching, refusals; the writing loop with a fake model
 *   (read first, a refused edit and a failing check fed back, then a pass; protected and outside files refused; stop);
 * - the project's skills for the apprentice (DevSkills) and linked into a sandbox worktree (Developer.linkShared);
 * - a writing exam in a real git repo (DevApprentice): the commit's own scenarios as the spec, pass / fail with a
 *   lesson / not counted, readiness, and the apprentice building a job in Claude's place.
 * No network, no model (fake ones), temp folders only.
 * Run: npx tsx scripts/smoke-v3-cirak.ts
 */
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadAtolyeBrainsView } from "../src/lib/v3/council/BrainsReport";
import { addedTestCode, apprenticePolicy, examCandidates, testImports, writeExam } from "../src/lib/v3/council/DevApprentice";
import { listLessons, listWriteExams, loadDevBrainView, type WriteExam, WRITE_MIN_EXAMS, writeReadiness } from "../src/lib/v3/council/DevBrain";
import { dropWorktree, linkShared } from "../src/lib/v3/council/Developer";
import { runDevJob } from "../src/lib/v3/council/DevResearch";
import { BASE_SKILLS, listSkills, parseSkill, pickSkills, skillsText } from "../src/lib/v3/council/DevSkills";
import { applyEdit, fileView, parseWriterAnswer, readablePath, readRequest, writeChange } from "../src/lib/v3/council/DevWriter";
import { planMerges, mergeParaphrasedProposals, proposalText, SAME_MEANING } from "../src/lib/v3/council/ProposalMerge";
import { decideProposal, listProposals, needsOwner, proposeDevelopment, updateProposal } from "../src/lib/v3/council/SelfImprovement";
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

const REPO = process.cwd();
const TSX = path.join(REPO, "node_modules", "tsx", "dist", "cli.mjs");
const reply = (content: string) => ({ content, finishReason: "stop" as const, refused: false, complete: true, truncated: false });
/** A fake model answering by the prompt's kind; `writes` are the writer's answers in turn. */
function fakeModel(writes: string[], seen: string[] = []) {
  return {
    generate: async (prompt: string) => {
      seen.push(prompt);
      if (prompt.includes("search terms")) return reply('{"terimler": ["double", "Calc"]}');
      if (prompt.includes("Decide which files")) return reply('{"dosyalar": ["src/lib/v3/mix/Calc.ts"], "semboller": ["double"], "karar": "yapilmali", "plan": "Calc.ts", "test": "scripts/smoke-v3-calc.ts"}');
      if (prompt.includes("learn HOW it was done")) return reply('{"nasil": "Calc.ts\'e double eklendi."}');
      if (prompt.includes("Write ONE lesson")) return reply('{"ders": "Hesap işleri mix/Calc.ts\'te; testin çağırdığı adı birebir kullan."}');
      return reply(writes.shift() ?? "OZET: bitti");
    },
  };
}
const mockBudget = (writes: string[], seen: string[] = []) => new V3Budget({ providers: { mock: fakeModel(writes, seen) }, capUsd: 0 });
const MOCK = { provider: "mock" as const };

async function gitRepo(base: string) {
  const repo = path.join(base, "repo");
  mkdirSync(repo, { recursive: true });
  const g = async (args: string[], cwd = repo) => {
    const r = await runProcess("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd });
    assert.equal(r.code, 0, `${args.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const write = (f: string, s: string) => {
    mkdirSync(path.dirname(path.join(repo, f)), { recursive: true });
    writeFileSync(path.join(repo, f), s);
  };
  await g(["init", "-q", "-b", "main"]);
  return { repo, g, write };
}

async function main() {
  await scenario("A proposals in other words are counted on the earlier one; a want already built stays answered; ideas are listed for the owner", async () => {
    const work = mkdtempSync(path.join(os.tmpdir(), "v3-birlestir-"));
    const t = (h: number) => new Date(Date.parse("2026-11-02T12:00:00Z") + h * 3_600_000);
    await proposeDevelopment(work, { beyin: "kurgu", baslik: "Anlatılan metinle sahne animasyonlarını otomatik senkronize eden modül", neden: "a", kaynak: "ep1" }, t(0));
    await proposeDevelopment(work, { beyin: "kostum", baslik: "Karakter yüz ve saç benzerlik analiz modülü", neden: "b", kaynak: "ep1" }, t(1));
    await proposeDevelopment(work, { beyin: "kurgu", baslik: "Anlatım metni ile senkronize hareket ve animasyon öneri modülü", neden: "c", kaynak: "ep2" }, t(2));
    await proposeDevelopment(work, { beyin: "kostum", baslik: "Kostüm tasarımında benzerlik skorunu artırmak için otomatik rötuş", neden: "d", kaynak: "ep3" }, t(3));
    await proposeDevelopment(work, { beyin: "ses", baslik: "Ses miks algoritması", neden: "e", kaynak: "ep3" }, t(4));
    const ps = () => listProposals(work).then((l) => l.map((x) => x.proposal));
    const [sync, face, sync2, face2, mix] = await ps();
    // Word overlap never matched these (34 ideas at "1 production" on 6 Nov 2026): none is before the owner.
    assert.deepEqual((await ps()).filter(needsOwner).length, 0);
    // The first sync proposal was built since (closed by a development session).
    await updateProposal(work, sync!.id, (q) => ({ ...q, durum: "yapildi" }));
    // Fake meaning: the two sync wants and the two likeness wants are alike, the mix one is alone.
    const vec: Record<string, number[]> = { [sync!.id]: [1, 0, 0], [sync2!.id]: [0.95, 0.31, 0], [face!.id]: [0, 1, 0], [face2!.id]: [0.1, 0.99, 0.05], [mix!.id]: [0, 0, 1] };
    const plan = planMerges(await ps(), (p) => vec[p.id]);
    assert.deepEqual(plan.map((m) => [m.id, m.hedef]), [[sync2!.id, sync!.id], [face2!.id, face!.id]]);
    assert.ok(plan.every((m) => m.benzerlik >= SAME_MEANING));
    // A third wording closest to the second (itself counted on the first) joins the group's root through it.
    const third = { ...face2!, id: "z-third", tarih: "2026-11-05T00:00:00Z" };
    const chain = planMerges([...(await ps()), third], (p) => (p.id === "z-third" ? [0.2, 0.97, 0.1] : vec[p.id]));
    assert.equal(chain.at(-1)?.id, "z-third");
    assert.equal(chain.at(-1)?.hedef, face!.id, "counted on the root, not on the paraphrase it matched best");
    assert.ok(chain.at(-1)!.benzerlik > 0.99, "its best match was the second wording");
    assert.equal(proposalText({ baslik: "B", neden: "N" }), "B. N");
    // Through the cache and a fake embedder that knows the texts.
    const byText = new Map((await ps()).map((p) => [proposalText(p), vec[p.id]!]));
    const embedder = { name: "sahte", embed: async (texts: readonly string[]) => texts.map((s) => byText.get(s)!) };
    const r = await mergeParaphrasedProposals(work, embedder);
    assert.equal(r.birlesen, 2);
    const after = new Map((await ps()).map((p) => [p.id, p]));
    assert.deepEqual([after.get(sync2!.id)!.durum, after.get(sync2!.id)!.birlesti?.hedef], ["birlesti", sync!.id], "a want already built is answered, not reopened");
    assert.deepEqual([after.get(face!.id)!.sayi, after.get(face!.id)!.kaynaklar], [2, ["ep1", "ep3"]], "the likeness want now comes from two productions");
    assert.equal(needsOwner(after.get(face!.id)!), true, "so it reaches the owner");
    assert.equal((await mergeParaphrasedProposals(work, embedder)).birlesen, 0, "merged once");
    const view = await loadAtolyeBrainsView(work);
    assert.deepEqual(view.oneriler.map((o) => o.baslik), ["Karakter yüz ve saç benzerlik analiz modülü"]);
    assert.deepEqual(view.fikirler?.map((o) => o.baslik), ["Ses miks algoritması"], "the single idea is listed for the owner to decide now");
    // The owner may decide an idea at once.
    await decideProposal(work, mix!.id, "onaylandi");
    assert.equal((await loadAtolyeBrainsView(work)).fikirler?.length, 0);
  });

  await scenario("B the edit blocks: parsed from plain text, exact or tolerant matching, a guess refused", () => {
    const a = parseWriterAnswer(["Önce bakayım.", "OKU: src/lib/v3/mix/Mixer.ts#mixVolume", "DOSYA: `src/lib/v3/a.ts`", "<<<<<<< ARA", "export const a = 1;", "=======", "export const a = 2;", ">>>>>>> YERINE", "<<<<<<< ARA", "=======", "```ts", "// yeni", "```", ">>>>>>> YERİNE", "DOSYA: src/lib/v3/b.ts", "<<<<<<< SEARCH", "=======", "export const b = 1;", ">>>>>>> REPLACE", "OZET: a 2 oldu"].join("\n"));
    assert.deepEqual(a.oku, ["src/lib/v3/mix/Mixer.ts#mixVolume"]);
    assert.deepEqual(a.duzenlemeler, [
      { dosya: "src/lib/v3/a.ts", ara: "export const a = 1;", yerine: "export const a = 2;" },
      { dosya: "src/lib/v3/a.ts", ara: "", yerine: "// yeni" },
      { dosya: "src/lib/v3/b.ts", ara: "", yerine: "export const b = 1;" },
    ]);
    assert.equal(a.ozet, "a 2 oldu");
    const file = "export function f() {\n  return 1;\n}\n\nexport const g = 2;\n";
    assert.deepEqual(applyEdit(file, { dosya: "x.ts", ara: "  return 1;", yerine: "  return 3;" }), { ok: true, icerik: file.replace("return 1", "return 3") });
    // Indentation and trailing spaces differ in the model's copy: matched line by line.
    const tolerant = applyEdit(file, { dosya: "x.ts", ara: "export function f() {\nreturn 1;   \n}", yerine: "export function f() {\n  return 4;\n}" });
    assert.ok(tolerant.ok && tolerant.icerik.includes("return 4") && tolerant.icerik.includes("export const g = 2;"));
    // CRLF files stay CRLF.
    const crlf = applyEdit("a\r\nb\r\n", { dosya: "x.ts", ara: "b", yerine: "c" });
    assert.deepEqual(crlf, { ok: true, icerik: "a\r\nc\r\n" });
    const twice = applyEdit("x\nx\n", { dosya: "x.ts", ara: "x", yerine: "y" });
    assert.ok(!twice.ok && /birden çok yerde/.test(twice.neden));
    const missing = applyEdit(file, { dosya: "x.ts", ara: "return 99;", yerine: "" });
    assert.ok(!missing.ok && /bulunamadı/.test(missing.neden));
    assert.ok(!applyEdit(file, { dosya: "x.ts", ara: "", yerine: "new" }).ok, "an empty ARA never overwrites an existing file");
    assert.deepEqual(applyEdit(undefined, { dosya: "y.ts", ara: "", yerine: "new" }), { ok: true, icerik: "new\n" });
    // What it may read: inside the sandbox, never git internals, dependencies or secrets.
    const dir = mkdtempSync(path.join(os.tmpdir(), "v3-oku-"));
    assert.ok(readablePath(dir, "src/lib/v3/a.ts"));
    for (const bad of ["../x.ts", ".git/config", "node_modules/a/index.js", ".env.local", "src/.env"]) assert.equal(readablePath(dir, bad), undefined, bad);
    // A long file shows its declarations and the ones in focus.
    const long = Array.from({ length: 400 }, (_, i) => `export const v${i} = "${"x".repeat(60)}";`).join("\n");
    const view = fileView("src/lib/v3/long.ts", long, ["v200"]);
    assert.match(view, /uzun dosya/);
    assert.match(view, /--- src\/lib\/v3\/long\.ts#v200 \(satır 201-201\)/);
    assert.ok(!view.includes("export const v300 ="));
  });

  await scenario("C the writing loop: it reads, a refused edit and a failing check come back, then it passes; tests and outside files are refused; an order stops it", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "v3-yaz-"));
    mkdirSync(path.join(dir, "src", "lib", "v3", "mix"), { recursive: true });
    writeFileSync(path.join(dir, "src", "lib", "v3", "mix", "Calc.ts"), "/** Sums. */\nexport function add(a: number, b: number): number {\n  return a + b;\n}\n");
    writeFileSync(path.join(dir, "scripts-test.txt"), "korunan");
    const seen: string[] = [];
    const writes = [
      "OKU: src/lib/v3/mix/Calc.ts#add",
      ["DOSYA: src/lib/v3/mix/Calc.ts", "<<<<<<< ARA", "return a - b;", "=======", "return a + b + 0;", ">>>>>>> YERINE", "DOSYA: package.json", "<<<<<<< ARA", "=======", "{}", ">>>>>>> YERINE", "DOSYA: scripts-test.txt", "<<<<<<< ARA", "korunan", "=======", "bozuldu", ">>>>>>> YERINE", "DOSYA: src/lib/v3/mix/Calc.ts", "<<<<<<< ARA", "", "=======", "x", ">>>>>>> YERINE", "OZET: ilk deneme"].join("\n"),
      ["DOSYA: src/lib/v3/mix/Calc.ts", "<<<<<<< ARA", "  return a + b;", "}", "=======", "  return a + b;", "}", "", "/** Twice a number. */", "export function double(n: number): number {", "  return add(n, n);", "}", ">>>>>>> YERINE", "OZET: double eklendi"].join("\n"),
    ];
    const changed = async () => (existsSync(path.join(dir, "src", "lib", "v3", "mix", "Calc.ts")) && readFileSync(path.join(dir, "src", "lib", "v3", "mix", "Calc.ts"), "utf8").includes("double") ? ["src/lib/v3/mix/Calc.ts"] : []);
    const checks: boolean[] = [];
    const r = await writeChange(
      { gorev: "İki katını alan double fonksiyonu", testKodu: "assert.equal(double(2), 4);", korunan: ["scripts-test.txt"], dosyalar: ["src/lib/v3/mix/Calc.ts"], semboller: ["add"], benzer: [], dersler: ["Testin çağırdığı adı kullan."], rehber: "--- SKILL v3-gelistirici: rehber" },
      {
        dir, repoRoot: dir, budget: mockBudget(writes, seen), model: MOCK, changed, log: () => {},
        check: async (ch) => {
          const ok = readFileSync(path.join(dir, ch[0]!), "utf8").includes("return add(n, n)");
          checks.push(ok);
          return { ok, cikti: ok ? "geçti" : "AssertionError: 3 !== 4" };
        },
      },
    );
    assert.equal(r.gecti, true, JSON.stringify(r));
    assert.deepEqual([r.turlar, r.dosyalar, r.ozet], [3, ["src/lib/v3/mix/Calc.ts"], "double eklendi"]);
    assert.deepEqual(checks, [true], "the first edit round changed nothing, so no check ran; the second passed");
    assert.match(seen[0]!, /THE SPEC — new smoke scenarios that must pass/);
    assert.match(seen[0]!, /GUIDES — the project's skills/);
    assert.match(seen[0]!, /YOUR LESSONS FROM EARLIER WORK:\n- Testin çağırdığı adı kullan\./);
    assert.match(seen[1]!, /FILES YOU ASKED TO READ:\n=== src\/lib\/v3\/mix\/Calc\.ts#add/);
    assert.match(seen[2]!, /package\.json izin dışı/);
    assert.match(seen[2]!, /scripts-test\.txt sınavın testi; değiştirilemez/);
    assert.match(seen[2]!, /ARA metni dosyada bulunamadı/);
    assert.equal(readFileSync(path.join(dir, "scripts-test.txt"), "utf8"), "korunan");
    assert.ok(!existsSync(path.join(dir, "package.json")));
    // A job must prove itself with a smoke scenario; an order stops the writing before the next round.
    const job = await writeChange(
      { gorev: "x", testZorunlu: true, dosyalar: [], semboller: [], benzer: [], dersler: [], rehber: "" },
      { dir, repoRoot: dir, budget: mockBudget([["DOSYA: src/lib/v3/mix/Calc.ts", "<<<<<<< ARA", "/** Sums. */", "=======", "/** Adds. */", ">>>>>>> YERINE"].join("\n")]), model: MOCK, changed: async () => ["src/lib/v3/mix/Calc.ts"], check: async () => ({ ok: true, cikti: "" }), log: () => {}, maxTurns: 1 },
    );
    assert.equal(job.gecti, false);
    assert.match(job.neden!, /smoke-v3-\*\.ts senaryosu eklemedin/);
    let calls = 0;
    const stopped = await writeChange({ gorev: "x", dosyalar: [], semboller: [], benzer: [], dersler: [], rehber: "" }, { dir, repoRoot: dir, budget: mockBudget([]), model: MOCK, changed: async () => [], check: async () => ({ ok: true, cikti: "" }), log: () => {}, stop: async () => (calls++ ? "sipariş geldi" : undefined) });
    assert.deepEqual([stopped.gecti, stopped.durdu, stopped.turlar], [false, "sipariş geldi", 1]);
  });

  await scenario("D the project's skills: parsed, the base ones always, the ones the task shows; linked into a sandbox and never deleted with it", async () => {
    assert.equal(parseSkill("x", "x", "no front matter"), undefined);
    const s = parseSkill("ayas/tests", ".claude/skills/ayas/tests/SKILL.md", "---\nname: tests\ndescription: \"How to test\"\n---\n\n# Body\n");
    assert.deepEqual([s?.ad, s?.aciklama, s?.govde], ["tests", "How to test", "# Body"]);
    const base = mkdtempSync(path.join(os.tmpdir(), "v3-skill-"));
    const { repo, g, write } = await gitRepo(base);
    const skill = (id: string, desc: string) => write(`.claude/skills/${id}/SKILL.md`, `---\nname: ${id.split("/").pop()}\ndescription: ${desc}\n---\nGuide of ${id}.\n`);
    for (const id of [...BASE_SKILLS, "remotion-best-practices", "remotion-maps", "ayas/scene-direction", "remotion-render"]) skill(id, id);
    write(".gitignore", ".claude/\n/node_modules\n");
    write("src/lib/v3/a.ts", "export const a = 1;\n");
    await g(["add", "-A"]);
    await g(["add", "-f", ".claude/skills/v3-gelistirici/SKILL.md"]);
    await g(["commit", "-q", "-m", "init"]);
    const all = await listSkills(repo);
    assert.deepEqual(all.map((x) => x.id), ["ayas/scene-direction", "ayas/tests", "remotion-best-practices", "remotion-maps", "remotion-render", "v3-gelistirici"]);
    assert.deepEqual(pickSkills(all, "müzik yatağı sesi").map((x) => x.id), ["v3-gelistirici", "ayas/tests"]);
    assert.deepEqual(pickSkills(all, "Haritada rozet kenardan taşıyor", ["remotion-v3/src/scene/MapView.tsx"]).map((x) => x.id), ["v3-gelistirici", "ayas/tests", "remotion-maps", "remotion-best-practices"]);
    assert.deepEqual(pickSkills(all, "Anlatılan sahnede jest oynanır").map((x) => x.id), ["v3-gelistirici", "ayas/tests", "ayas/scene-direction"]);
    assert.match(skillsText(pickSkills(all, "x")), /--- SKILL v3-gelistirici \(\.claude\/skills\/v3-gelistirici\/SKILL\.md\): v3-gelistirici\nGuide of v3-gelistirici\./);
    // A sandbox worktree has only the tracked skill; the others are linked in, and removing it keeps the originals.
    const dir = path.join(base, "sandbox");
    await g(["worktree", "add", "--detach", dir, "HEAD"]);
    assert.ok(existsSync(path.join(dir, ".claude", "skills", "v3-gelistirici", "SKILL.md")));
    assert.ok(!existsSync(path.join(dir, ".claude", "skills", "remotion-maps")));
    await linkShared(repo, dir);
    assert.ok(lstatSync(path.join(dir, ".claude", "skills", "remotion-maps")).isSymbolicLink());
    assert.ok(lstatSync(path.join(dir, ".claude", "skills", "ayas", "tests")).isSymbolicLink());
    assert.match(readFileSync(path.join(dir, ".claude", "skills", "remotion-maps", "SKILL.md"), "utf8"), /Guide of remotion-maps/);
    assert.match(await readRequest(dir, repo, ".claude/skills/remotion-render/SKILL.md"), /Guide of remotion-render/, "skills are read from the checkout");
    await dropWorktree(repo, dir);
    assert.ok(!existsSync(dir));
    assert.ok(existsSync(path.join(repo, ".claude", "skills", "remotion-maps", "SKILL.md")), "the checkout's skills are untouched");
    assert.ok(existsSync(path.join(repo, ".claude", "skills", "ayas", "tests", "SKILL.md")));
  });

  await scenario("E a writing exam in a real repo: the commit's own scenarios are the spec; pass, fail with a lesson, not counted; readiness; the apprentice builds a job", async () => {
    const base = mkdtempSync(path.join(os.tmpdir(), "v3-yazma-sinavi-"));
    const work = path.join(base, "runtime");
    const { repo, g, write } = await gitRepo(base);
    write(".gitignore", "/node_modules\n.claude/\n");
    await g(["add", "-A"]);
    await g(["commit", "-q", "-m", "chore: init"]);
    const calc = (extra: string) => `/** Sums. */\nexport function add(a: number, b: number): number {\n  return a + b;\n}\n${extra}`;
    const smoke = (names: string, lines: string) => `import assert from "node:assert/strict";\nimport { ${names} } from "../src/lib/v3/mix/Calc";\nassert.equal(add(1, 2), 3);\n${lines}console.log("PASS");\n`;
    write("src/lib/v3/mix/Calc.ts", calc(""));
    write("scripts/smoke-v3-calc.ts", smoke("add", ""));
    await g(["add", "-A"]);
    await g(["commit", "-q", "-m", "feat(v3): toplama"]);
    const DOUBLE = "\n/** Twice a number. */\nexport function double(n: number): number {\n  return add(n, n);\n}\n";
    write("src/lib/v3/mix/Calc.ts", calc(DOUBLE));
    write("scripts/smoke-v3-calc.ts", smoke("add, double", "assert.equal(double(3), 6);\n"));
    await g(["add", "-A"]);
    await g(["commit", "-q", "-m", "feat(v3): bir sayının iki katı"]);
    const sha = await g(["rev-parse", "HEAD"]);
    // A commit whose new scenario already held before it (a comment and an assertion of what was there).
    write("src/lib/v3/mix/Calc.ts", calc(DOUBLE).replace("/** Sums. */", "/** Sums two numbers. */"));
    write("scripts/smoke-v3-calc.ts", smoke("add, double", "assert.equal(double(3), 6);\nassert.equal(add(2, 2), 4);\n"));
    await g(["add", "-A"]);
    await g(["commit", "-q", "-m", "fix(v3): toplama belgesi"]);
    const cands = await examCandidates(repo, work);
    assert.deepEqual(cands.map((c) => [c.gorev, c.kod, c.testler]), [["toplama belgesi", ["src/lib/v3/mix/Calc.ts"], ["scripts/smoke-v3-calc.ts"]], ["bir sayının iki katı", ["src/lib/v3/mix/Calc.ts"], ["scripts/smoke-v3-calc.ts"]], ["toplama", ["src/lib/v3/mix/Calc.ts"], ["scripts/smoke-v3-calc.ts"]]], "the init commit touched no V3 file");
    const doubleExam = cands.find((c) => c.sha === sha)!;
    const spec = await addedTestCode(repo, sha, ["scripts/smoke-v3-calc.ts"]);
    assert.match(spec, /\+assert\.equal\(double\(3\), 6\);/);
    assert.deepEqual(testImports(spec, "scripts/smoke-v3-calc.ts"), { dosyalar: ["src/lib/v3/mix/Calc.ts"], adlar: ["add", "double"] });
    const suites = (list: readonly string[]) => list.map((s) => [process.execPath, TSX, s]);
    const seen: string[] = [];
    const deps = (writes: string[]) => ({
      repoRoot: repo, workRoot: work, log: () => {}, worktreeRoot: path.join(base, "gelistirme"), suites,
      checks: (_dir: string, _changed: readonly string[], list: readonly string[]) => suites(list),
      research: { repoRoot: repo, workRoot: work, budget: mockBudget([], seen), model: MOCK, log: () => {} },
      writer: { budget: mockBudget(writes, seen), model: MOCK },
    });
    const right = ["DOSYA: src/lib/v3/mix/Calc.ts", "<<<<<<< ARA", "  return a + b;", "}", "=======", "  return a + b;", "}", "", "/** Twice a number. */", "export function double(n: number): number {", "  return n * 2;", "}", ">>>>>>> YERINE", "OZET: double eklendi"].join("\n");
    const passed = await writeExam(doubleExam, deps([right]));
    assert.equal(passed.sonuc, "gecti", passed.neden);
    assert.deepEqual([passed.turlar, passed.dosyalar], [1, ["src/lib/v3/mix/Calc.ts"]]);
    const writerPrompt = seen.find((p) => p.includes("THE SPEC"))!;
    assert.match(writerPrompt, /assert\.equal\(double\(3\), 6\)/, "the commit's new scenario is the spec");
    assert.ok(!writerPrompt.includes("return add(n, n)"), "never the answer");
    assert.match(readFileSync(path.join(work, "_kutuphane", "gelisim", "gelistirici", "yazma", `${sha.slice(0, 10)}.diff`), "utf8"), /\+export function double/);
    assert.ok(!existsSync(path.join(base, "gelistirme", `sinav-${sha.slice(0, 10)}`)), "the sandbox is gone");
    assert.equal(await g(["status", "--porcelain"]), "", "the checkout untouched");
    // The same commit again (as another exam record): a wrong answer fails, the real change passes → it counts, with a lesson.
    const wrong = ["DOSYA: src/lib/v3/mix/Calc.ts", "<<<<<<< ARA", "  return a + b;", "}", "=======", "  return a + b;", "}", "export function double(n: number): number {", "  return n;", "}", ">>>>>>> YERINE", "OZET: yanlış"].join("\n");
    const failed = await writeExam(doubleExam, { ...deps([wrong, wrong]), maxTurns: 2 });
    assert.equal(failed.sonuc, "kaldi", failed.neden);
    assert.match(failed.neden!, /error|Error/);
    // Its second round saw its own first edit as a diff (the first real exam re-added a function it could not see).
    assert.ok(seen.some((p) => p.includes("YOUR EDITS SO FAR — already applied") && p.includes("+export function double(n: number): number {\n+  return n;")));
    assert.match((await listLessons(work)).at(-1)!.metin, /testin çağırdığı adı birebir kullan/);
    // Scenarios that already pass before the change: not counted.
    const none = await writeExam(cands[0]!, deps([]));
    assert.deepEqual([none.sonuc, none.neden], ["gecersiz", "yeni senaryolar değişiklikten önce de geçiyor"]);
    assert.deepEqual((await examCandidates(repo, work)).map((c) => c.gorev), ["toplama"], "an exam is sat once");
    // Readiness: too few counted exams, then enough passes.
    let exams = await listWriteExams(work);
    assert.deepEqual([writeReadiness(exams).sayilan, writeReadiness(exams).gecen, writeReadiness(exams).yazabilir], [2, 1, false]);
    assert.equal(await apprenticePolicy(repo, work, {}), undefined, "not ready: Claude stays the builder");
    const pass = (i: number): WriteExam => ({ id: `p${i}`, tarih: "2026-11-06T10:00:00Z", gorev: "g", sonuc: "gecti", turlar: 1, maliyetUsd: 0, dosyalar: [], gercek: [], testler: [], model: "m" });
    exams = [...exams, ...Array.from({ length: WRITE_MIN_EXAMS }, (_, i) => pass(i))];
    assert.equal(writeReadiness(exams).yazabilir, true);
    assert.match(writeReadiness(exams).ozet, /Claude yokken onaylı işi kendisi yazabilir/);
    const view = await loadDevBrainView(work);
    assert.deepEqual([view.yazma?.sayilan, view.yazma?.son.length], [2, 3]);
    // The apprentice builds a job in Claude's place (a fake agent): the build is its, the guess is not graded on it.
    await proposeDevelopment(work, { beyin: "ses", baslik: "Üç katı", neden: "n", kaynak: "ep1", kaynakTuru: "olcum" });
    const id = (await listProposals(work)).find((x) => x.proposal.baslik === "Üç katı")!.proposal.id;
    await decideProposal(work, id, "onaylandi");
    const agent = [process.execPath, "-e", `process.stdin.resume();process.stdin.on("end",()=>{require("fs").appendFileSync("src/lib/v3/mix/Calc.ts","export const triple = (n: number) => n * 3;\\n");console.log("Çırak yazdı")})`];
    const done = await runDevJob((await listProposals(work)).find((x) => x.proposal.id === id)!.proposal, { repoRoot: repo, workRoot: work, budget: mockBudget([]), model: MOCK, log: () => {} }, { checks: [], worktreeRoot: path.join(base, "gelistirme"), cirak: { agent, when: "zorla" } });
    assert.deepEqual([done.durum, done.is?.yazan], ["hazir", "cirak"], JSON.stringify(done.is));
    assert.match(await g(["log", "-1", "--format=%B", `gelistirme/${id}`]), /Atölye çırağı \(kendi yazdı, Claude olmadan\)/);
    // Claude's usage limit with the apprentice as the fallback.
    await updateProposal(work, id, (q) => ({ ...q, durum: "onaylandi", is: { deneme: 0, baslangic: "2026-11-06T10:00:00Z" } }));
    await g(["branch", "-D", `gelistirme/${id}`]);
    const limited = [process.execPath, "-e", `process.stdin.resume();process.stdin.on("end",()=>{console.log("You've hit your session limit · resets 9:40pm (Europe/Istanbul)");process.exit(1)})`];
    const fallback = await runDevJob((await listProposals(work)).find((x) => x.proposal.id === id)!.proposal, { repoRoot: repo, workRoot: work, budget: mockBudget([]), model: MOCK, log: () => {} }, { agent: limited, checks: [], worktreeRoot: path.join(base, "gelistirme"), cirak: { agent, when: "yedek" } });
    assert.deepEqual([fallback.durum, fallback.is?.yazan], ["hazir", "cirak"], JSON.stringify(fallback.is));
  });

  console.log(`PASS (${scenarios} scenarios)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
