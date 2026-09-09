/**
 * AYAS studio context smoke suite (Sprint 208).
 *
 * Deterministic / $0 / no network / no model. Covers:
 *  - `loadAyasStudioContext()` against a temp runtime root (env-scoped): shape,
 *    project count, status breakdown, sample, the "no project.json" note, and
 *    the fail-soft `available:false` path;
 *  - `buildAyasChatPrompt` injects the studio block (runtime authority path +
 *    project count) and the "don't invent" instruction;
 *  - `ayasReplyClaimsExecution` catches a reply that claims it opened the gate /
 *    ran a pipeline, and `resolveAyasReply` drops such a reply to the honest
 *    deterministic fallback;
 *  - a well-behaved reply and a no-studio prompt are unchanged (back-compat).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildAyasChatPrompt,
  resolveAyasReply,
  ayasReplyClaimsExecution,
  type AyasStudioContextView,
} from "../src/components/brain/brainCore";
import type { BrainConsoleSnapshot } from "../src/lib/brain/ui/BrainConsoleSnapshot";
import {
  loadAyasStudioContext,
  AYAS_STUDIO_SAMPLE_LIMIT,
} from "../src/lib/ayas/AyasStudioContext";

let count = 0;
async function scenario(name: string, test: () => void | Promise<void>) {
  await test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

function snap(over: Partial<BrainConsoleSnapshot> = {}): BrainConsoleSnapshot {
  return {
    generatedAt: "2026-09-09T03:00:00.000Z",
    executionGate: "CLOSED",
    connected: { tasks: false, cycles: false, experience: false },
    errors: [],
    tasks: {
      total: 0,
      byStatus: {
        queued: 0, running: 0, "blocked-on-dependency": 0, "blocked-on-approval": 0,
        succeeded: 0, failed: 0, cancelled: 0, "skipped-unsafe": 0,
      },
      pendingApproval: 0, skippedUnsafe: 0, items: [],
    },
    cyclesRecorded: 0,
    experience: { total: 0 },
    safety: {
      decision: "proceed-with-constraints", snapshotSource: "unavailable",
      reasons: ["resource snapshot unavailable"], hardwareProfileId: "gtx-1650-4gb",
    },
    ...over,
  };
}

const studioView = (over: Partial<AyasStudioContextView> = {}): AyasStudioContextView => ({
  available: true,
  runtimeAuthority: {
    runtimeRoot: "D:\\AtolyeRuntime",
    projectsRoot: "D:\\AtolyeRuntime\\projects",
    authorityRoot: "D:\\AtolyeAuthority",
    classification: "explicit-external",
    external: true,
  },
  projects: {
    total: 3,
    byStatus: [{ status: "visuals", count: 2 }, { status: "script", count: 1 }],
    sample: [
      { slug: "a", title: "Proje A", status: "visuals" },
      { slug: "b", title: "Proje B", status: "script" },
    ],
  },
  notes: [],
  ...over,
});

function writeProject(root: string, dir: string, record: Record<string, unknown> | null) {
  const folder = path.join(root, "projects", dir);
  fs.mkdirSync(folder, { recursive: true });
  if (record) fs.writeFileSync(path.join(folder, "project.json"), JSON.stringify(record));
}

async function run() {
  /* ---------------- loadAyasStudioContext (env-scoped temp root) ------------- */

  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-studio-"));
  const runtimeRoot = path.join(sandbox, "runtime");
  const authorityRoot = path.join(sandbox, "authority");
  fs.mkdirSync(path.join(runtimeRoot, "projects"), { recursive: true });
  fs.mkdirSync(authorityRoot, { recursive: true });

  const prevRuntime = process.env.ATOLYE_RUNTIME_ROOT;
  const prevAuthority = process.env.ATOLYE_RUNTIME_AUTHORITY_ROOT;
  process.env.ATOLYE_RUNTIME_ROOT = runtimeRoot;
  process.env.ATOLYE_RUNTIME_AUTHORITY_ROOT = authorityRoot;

  try {
    writeProject(runtimeRoot, "alpha", { slug: "alpha", id: "id-a", title: "Alpha", status: "visuals", updatedAt: "2026-09-03T00:00:00.000Z" });
    writeProject(runtimeRoot, "beta", { slug: "beta", id: "id-b", title: "Beta", status: "visuals", updatedAt: "2026-09-05T00:00:00.000Z" });
    writeProject(runtimeRoot, "gamma", { slug: "gamma", id: "id-c", title: "Gamma", status: "script", updatedAt: "2026-09-01T00:00:00.000Z" });
    writeProject(runtimeRoot, "orphan-no-json", null);

    await scenario("loadAyasStudioContext — resolves the env runtime authority", async () => {
      const ctx = await loadAyasStudioContext();
      assert.equal(ctx.available, true);
      assert.equal(path.resolve(ctx.runtimeAuthority.runtimeRoot), path.resolve(runtimeRoot));
      assert.equal(path.resolve(ctx.runtimeAuthority.projectsRoot), path.resolve(runtimeRoot, "projects"));
      assert.equal(path.resolve(ctx.runtimeAuthority.authorityRoot), path.resolve(authorityRoot));
      assert.equal(ctx.runtimeAuthority.classification, "explicit-external");
      assert.equal(ctx.runtimeAuthority.external, true);
    });

    await scenario("loadAyasStudioContext — real project count + status breakdown", async () => {
      const ctx = await loadAyasStudioContext();
      assert.equal(ctx.projects.total, 3);
      assert.deepEqual(ctx.projects.byStatus, [
        { status: "visuals", count: 2 },
        { status: "script", count: 1 },
      ]);
    });

    await scenario("loadAyasStudioContext — sample is newest-updated first, capped", async () => {
      const ctx = await loadAyasStudioContext();
      assert.ok(ctx.projects.sample.length <= AYAS_STUDIO_SAMPLE_LIMIT);
      assert.deepEqual(ctx.projects.sample.map((p) => p.slug), ["beta", "alpha", "gamma"]);
    });

    await scenario("loadAyasStudioContext — notes the folder with no project.json", async () => {
      const ctx = await loadAyasStudioContext();
      assert.ok(ctx.notes.some((n) => /project\.json yok/.test(n)), ctx.notes.join(" | "));
    });
  } finally {
    if (prevRuntime === undefined) delete process.env.ATOLYE_RUNTIME_ROOT;
    else process.env.ATOLYE_RUNTIME_ROOT = prevRuntime;
    if (prevAuthority === undefined) delete process.env.ATOLYE_RUNTIME_AUTHORITY_ROOT;
    else process.env.ATOLYE_RUNTIME_AUTHORITY_ROOT = prevAuthority;
    fs.rmSync(sandbox, { recursive: true, force: true });
  }

  await scenario("loadAyasStudioContext — fail-soft when the projects root is missing", async () => {
    const prev = process.env.ATOLYE_RUNTIME_ROOT;
    process.env.ATOLYE_RUNTIME_ROOT = path.join(os.tmpdir(), "ayas-studio-does-not-exist-" + Date.now());
    try {
      const ctx = await loadAyasStudioContext();
      // context resolves fine; the projects dir just doesn't exist → 0 projects, still "available"
      assert.equal(ctx.projects.total, 0);
      assert.equal(ctx.available, true);
    } finally {
      if (prev === undefined) delete process.env.ATOLYE_RUNTIME_ROOT;
      else process.env.ATOLYE_RUNTIME_ROOT = prev;
    }
  });

  /* ---------------- prompt injection ---------------------------------------- */

  await scenario("buildAyasChatPrompt — injects the runtime authority path + project count", () => {
    const prompt = buildAyasChatPrompt({
      userText: "kaç proje var?",
      snapshot: snap(),
      history: [],
      studio: studioView(),
    });
    assert.match(prompt, /Atölye stüdyo bağlamı/);
    assert.match(prompt, /aktif runtime authority.*D:\\AtolyeRuntime/);
    assert.match(prompt, /toplam proje sayısı: 3/);
    assert.match(prompt, /2 visuals, 1 script/);
    assert.match(prompt, /uydurma/);
  });

  await scenario("buildAyasChatPrompt — no studio arg → block absent (back-compat)", () => {
    const prompt = buildAyasChatPrompt({ userText: "x", snapshot: snap(), history: [] });
    assert.ok(!prompt.includes("Atölye stüdyo bağlamı"));
  });

  await scenario("buildAyasChatPrompt — unavailable studio → 'don't guess' instruction", () => {
    const prompt = buildAyasChatPrompt({
      userText: "x", snapshot: snap(), history: [],
      studio: { ...studioView(), available: false },
    });
    assert.match(prompt, /çözülemedi/);
    assert.match(prompt, /tahmin etme/);
  });

  /* ---------------- reply execution-claim guard ---------------------------- */

  await scenario("ayasReplyClaimsExecution — catches gate / pipeline / push / apply claims + offers", () => {
    for (const bad of [
      "Şimdi yürütme kapısını açıyorum ve görevleri kontrol ediyorum.",
      "Yürütme kapısını açtım.",
      "Yürütme kapısını açıp çalıştırabiliriz.",
      "Yürütme kapısını açalım.",
      "Pipeline'ı başlattım, birazdan biter.",
      "Videoyu çalıştırdım.",
      "git push yaptım.",
      "Değişikliği uyguladım.",
    ]) {
      assert.equal(ayasReplyClaimsExecution(bad), true, bad);
    }
  });

  await scenario("ayasReplyClaimsExecution — leaves honest / refusing replies alone", () => {
    for (const ok of [
      "Bunu ben yapamam — yürütme kapısı kapalı. Bu ayrı bir onay adımı gerektirir.",
      "Aktif runtime authority D:\\AtolyeRuntime. Şu anda 3 proje var.",
      "Yürütme yetkim yok; sadece planlayabilirim.",
      "Yürütme kapısını açamam, bu benim yetkimde değil.",
      "Yürütme kapısı açık değil; bir şey çalıştıramam.",
      "Yürütme kapısını açamazsın demiştin, doğru.",
    ]) {
      assert.equal(ayasReplyClaimsExecution(ok), false, ok);
    }
  });

  await scenario("resolveAyasReply — a false execution claim falls back to the deterministic reply", async () => {
    const out = await resolveAyasReply({
      text: "runtime authority neresi?",
      snapshot: snap(),
      history: [],
      seq: 1,
      studio: studioView(),
      generate: async () => "Yürütme kapısını açıyorum ve kontrol ediyorum.",
    });
    assert.equal(out.source, "fallback");
    assert.match(out.message.text, /KAPALI/);
  });

  await scenario("resolveAyasReply — a fact-based reply is kept (source llm)", async () => {
    const out = await resolveAyasReply({
      text: "runtime authority neresi?",
      snapshot: snap(),
      history: [],
      seq: 1,
      studio: studioView(),
      generate: async () => "Aktif runtime authority D:\\AtolyeRuntime, proje kökü D:\\AtolyeRuntime\\projects. Şu an 3 proje var.",
    });
    assert.equal(out.source, "llm");
    assert.match(out.message.text, /D:\\AtolyeRuntime/);
  });

  console.log(`AYAS studio context smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-studio-context", scenarios: count }));
}

run().catch((error) => {
  console.error("AYAS studio context smoke FAILED:", error);
  process.exitCode = 1;
});
