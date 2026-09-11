/**
 * AYAS context foundation smoke suite (Phase 2 · Phase B).
 *
 * Deterministic / no fs / no model. Covers:
 *  - conversation state: active project / stage / unresolved question / entities
 *  - reference resolution: "o proje", "az önceki", "devam et", "bunu"; unresolved → warn
 *  - context compression: recent verbatim + extractive summary of older turns
 *  - assembly: prompt block + compressed recent history + trace
 */

import assert from "node:assert/strict";

import { deriveAyasConversationState } from "../src/lib/ayas/context/AyasConversationState";
import { resolveAyasReferences } from "../src/lib/ayas/context/AyasReferenceResolver";
import { compressAyasHistory } from "../src/lib/ayas/context/AyasContextCompression";
import { assembleAyasContext } from "../src/lib/ayas/context/AyasContextAssembly";
import type { AyasStudioContextView } from "../src/components/brain/brainCore";

let count = 0;
async function scenario(name: string, test: () => void | Promise<void>) {
  await test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const STUDIO: AyasStudioContextView = {
  available: true,
  runtimeAuthority: {
    runtimeRoot: "D:\\AtolyeRuntime",
    projectsRoot: "D:\\AtolyeRuntime\\projects",
    authorityRoot: "D:\\AtolyeAuthority",
    classification: "external",
    external: true,
  },
  projects: {
    total: 3,
    byStatus: [{ status: "in-progress", count: 3 }],
    sample: [
      { slug: "mimar-sinan", title: "Mimar Sinan", status: "in-progress", failedStages: ["visuals"] },
      { slug: "istanbul-fethi", title: "İstanbul'un Fethi", status: "in-progress" },
      { slug: "kanuni", title: "Kanuni Sultan Süleyman", status: "in-progress" },
    ],
  },
  notes: [],
};

function h(...turns: [string, string][]) {
  return turns.map(([role, text]) => ({ role: role as "user" | "brain", text }));
}

async function run() {
  /* ---------------- conversation state ---------------- */

  await scenario("state — tracks the active project from the turns + studio", () => {
    const s = deriveAyasConversationState(
      h(["user", "Mimar Sinan projesi ne durumda"], ["brain", "Visuals aşamasında bir hata var."]),
      { studio: STUDIO },
    );
    assert.equal(s.activeProject, "Mimar Sinan");
    assert.equal(s.activeStage, "visuals");
    assert.ok(s.recentEntities.some((e) => e.value === "Mimar Sinan" && e.kind === "project"));
  });

  await scenario("state — an AYAS question ending in '?' becomes an unresolved question; a user reply clears it", () => {
    const asked = deriveAyasConversationState(h(["user", "yeni video başlat"], ["brain", "Hangi konu hakkında olsun?"]));
    assert.equal(asked.unresolvedQuestions.length, 1);
    assert.match(asked.unresolvedQuestions[0], /Hangi konu/);

    const answered = deriveAyasConversationState(
      h(["user", "yeni video başlat"], ["brain", "Hangi konu hakkında olsun?"], ["user", "Fatih Sultan Mehmet"]),
    );
    assert.equal(answered.unresolvedQuestions.length, 0);
  });

  await scenario("state — empty / system-only history → empty state", () => {
    const s = deriveAyasConversationState([{ role: "system", text: "Ben AYAS." }]);
    assert.equal(s.turnCount, 0);
    assert.equal(s.activeProject, null);
  });

  /* ---------------- reference resolution ---------------- */

  await scenario("references — 'o proje' resolves to the active project", () => {
    const s = deriveAyasConversationState(h(["user", "Kanuni projesini aç"], ["brain", "Kanuni projesi hazır."]), { studio: STUDIO });
    const r = resolveAyasReferences("o projeyi kontrol et", s, []);
    assert.ok(r.resolutions.some((x) => x.kind === "project" && x.referent === "Kanuni Sultan Süleyman"));
    assert.equal(r.unresolved.length, 0);
    assert.ok(r.promptLines.join("\n").includes("Kanuni Sultan Süleyman"));
  });

  await scenario("references — 'az önceki proje' with no project in context → unresolved → ASK warning", () => {
    const s = deriveAyasConversationState(h(["user", "merhaba"], ["brain", "Merhaba."]));
    const r = resolveAyasReferences("az önceki projeyi göster", s, []);
    assert.ok(r.unresolved.includes("az önceki"));
    assert.match(r.promptLines.join("\n"), /çözülemedi|tahmin etme|kullanıcıya/i);
  });

  await scenario("references — 'devam et' points at the prior user request", () => {
    const hist = h(["user", "İstanbul'un Fethi videosunun scriptini yaz"], ["brain", "Script taslağı hazır."]);
    const s = deriveAyasConversationState(hist, { studio: STUDIO });
    const r = resolveAyasReferences("devam et", s, hist);
    assert.ok(r.resolutions.some((x) => x.kind === "continuation"));
    assert.match(r.resolutions[0].referent, /script/i);
  });

  await scenario("references — a message with no demonstratives → empty result (no noise in the prompt)", () => {
    const s = deriveAyasConversationState(h(["user", "kaç proje var"]));
    const r = resolveAyasReferences("runtime authority neresi", s, []);
    assert.deepEqual([...r.resolutions], []);
    assert.deepEqual([...r.promptLines], []);
  });

  /* ---------------- compression ---------------- */

  await scenario("compression — short history is kept fully verbatim, no summary", () => {
    const c = compressAyasHistory(h(["user", "a"], ["brain", "b"], ["user", "c"]));
    assert.equal(c.droppedTurns, 0);
    assert.equal(c.summary.length, 0);
    assert.equal(c.recent.length, 3);
  });

  await scenario("compression — older turns fold into an extractive summary; recent N kept verbatim", () => {
    const turns: [string, string][] = [];
    for (let i = 0; i < 20; i += 1) turns.push([i % 2 === 0 ? "user" : "brain", `tur ${i}: proje ${i % 3} hakkında soru`]);
    const c = compressAyasHistory(h(...turns), { recentTurns: 6 });
    assert.equal(c.recent.length, 6);
    assert.equal(c.droppedTurns, 14);
    assert.ok(c.summary.length >= 1);
    assert.match(c.summary.join(" "), /Daha önce konuşulan konular/);
    // the summary is extractive — it only contains text that appeared in the turns
    assert.ok(c.summary.join(" ").includes("proje"));
  });

  /* ---------------- assembly ---------------- */

  await scenario("assembly — produces prompt block + compressed recent + trace in one call", () => {
    const hist = h(
      ["user", "Mimar Sinan projesini aç"],
      ["brain", "Mimar Sinan projesi visuals aşamasında."],
      ["user", "peki devam et"],
    );
    const a = assembleAyasContext({ userText: "o projede son hata neydi", history: hist, studio: STUDIO });
    assert.ok(a.block.stateLines && a.block.stateLines.some((l) => l.includes("Mimar Sinan")));
    assert.ok(a.block.referenceLines && a.block.referenceLines.join("\n").includes("Mimar Sinan"));
    assert.equal(a.trace.activeProject, "Mimar Sinan");
    assert.equal(a.trace.resolvedReferences >= 1, true);
    assert.equal(a.recentHistory.length, hist.length);
  });

  await scenario("assembly — no studio, no references → minimal block, nothing invented", () => {
    const a = assembleAyasContext({ userText: "bugün hava nasıl", history: h(["user", "selam"], ["brain", "Merhaba."]) });
    assert.equal(a.block.referenceLines, undefined);
    assert.equal(a.trace.activeProject, null);
  });

  console.log(`AYAS context smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-context", scenarios: count }));
}

run().catch((error) => {
  console.error("AYAS context smoke FAILED:", error);
  process.exitCode = 1;
});
