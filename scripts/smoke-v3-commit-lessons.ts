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
import { commitLessons, learnAyasCode, learnCommitLessons, learnRefs, MAX_LESSON_CHARS } from "../src/lib/v3/council/CommitLessons";
import { ayasGradedFiles, ayasPastChanges, isAyasSmoke, listAyasCodeExperience, listChanges, listCodeExperience, listLessons } from "../src/lib/v3/council/DevBrain";
import { learnFromCommits } from "../src/lib/v3/council/DevResearch";
import { allLessons } from "../src/lib/v3/council/ExperienceMemory";
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

  console.log(`V3 commit lessons smoke: PASS (${scenarios} scenarios)`);
}

run().catch((e) => {
  console.error("V3 commit lessons smoke FAILED:", e);
  process.exit(1);
});
