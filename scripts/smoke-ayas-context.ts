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

  /* ---------------- conversational follow-through + topic continuity ---------------- */

  await scenario("follow-through — pronoun resolves to the single prior reply", () => {
    const hist = h(["user", "Cevaplar bazen mekanik."], ["brain", "Üslup yönergesini daha doğal hale getirebiliriz."]);
    const r = resolveAyasReferences("Onu biraz daha doğal yapabilir miyiz?", deriveAyasConversationState(hist), hist);
    assert.equal(r.unresolved.length, 0);
    assert.match(r.resolutions[0].referent, /Cevaplar bazen mekanik/);
  });

  await scenario("follow-through — demonstrative resolves without losing the prior topic", () => {
    const hist = h(["user", "Context penceresini konuşalım."], ["brain", "Yakın turları on iki mesaj tutuyoruz."]);
    const r = resolveAyasReferences("Bunu nasıl iyileştiririz?", deriveAyasConversationState(hist), hist);
    assert.equal(r.clarification, null);
    assert.match(r.resolutions[0].referent, /Context penceresini/);
  });

  await scenario("follow-through — second-option reference selects the real second option", () => {
    const hist = h(["user", "Konuşma tarafında prompt ve context olmak üzere iki alan var."], ["brain", "İkisini de değerlendirebiliriz."]);
    const state = deriveAyasConversationState(hist);
    assert.deepEqual(state.options, ["prompt", "context"]);
    const r = resolveAyasReferences("İkincisine bakalım.", state, hist);
    assert.equal(r.resolutions[0].referent, "context");
  });

  await scenario("follow-through — adversarial-sweep finding: 'yaklaşım' (approach) enumerates options same as 'seçenek/alan'", () => {
    // Real finding: the colon-form extractor only recognized "seçenek/alan/
    // problem/öneri" — "Üç yaklaşım var: hız, kalite ve maliyet." silently
    // failed to extract options at all, so a later "üçüncüsü" fell through to
    // an unnecessary clarification instead of correctly resolving.
    const hist = h(["user", "Üç yaklaşım var: zaman, kalite ve maliyet."]);
    const state = deriveAyasConversationState(hist);
    assert.deepEqual(state.options, ["zaman", "kalite", "maliyet"]);
    const r = resolveAyasReferences("Üçüncüsü.", state, hist);
    assert.equal(r.clarification, null);
    assert.equal(r.resolutions[0].referent, "maliyet");
  });

  await scenario("follow-through — elliptical 'neden?' continues the selected option", () => {
    const hist = h(
      ["user", "Prompt ve context olmak üzere iki seçenek var."],
      ["brain", "İkisini karşılaştırabiliriz."],
      ["user", "İkincisine bakalım."],
      ["brain", "Context daha güçlü bir devamlılık sağlar."],
    );
    const state = deriveAyasConversationState(hist);
    assert.equal(state.selectedOption, "context");
    const r = resolveAyasReferences("Neden?", state, hist);
    assert.equal(r.resolutions[0].referent, "context");
  });

  await scenario("follow-through — 'ikincisini biraz aç' keeps the option identity", () => {
    const hist = h(["brain", "Birincisi prompt iyileştirme, ikincisi context sürekliliği, üçüncüsü memory politikası."]);
    const state = deriveAyasConversationState(hist);
    const r = resolveAyasReferences("İkincisini biraz aç.", state, hist);
    assert.match(r.resolutions[0].referent, /context sürekliliği/i);
  });

  await scenario("follow-through — exclusion survives acknowledgment + 'bunun dışında'", () => {
    const hist = h(["user", "Memory tarafına bugün dokunmayalım."], ["brain", "Tamam, memory'yi kapsam dışında tutuyorum."]);
    const state = deriveAyasConversationState(hist);
    assert.equal(state.temporaryConstraints.length, 1);
    const r = resolveAyasReferences("Tamam, bunun dışında ne geliştirebiliriz?", state, hist);
    assert.match(r.resolutions[0].referent, /Memory tarafına bugün dokunmayalım/i);
  });

  await scenario("follow-through — two plausible referents require clarification", () => {
    const hist = h(["user", "İki problem var: cevaplar uzun ve bazen mekanik."], ["brain", "İki problemi de görüyorum."]);
    const r = resolveAyasReferences("Onu düzelt.", deriveAyasConversationState(hist), hist);
    assert.ok(r.unresolved.length > 0);
    assert.match(r.clarification ?? "", /cevaplar uzun.*bazen mekanik/i);
  });

  await scenario("follow-through — fresh no-history reference requires clarification", () => {
    const r = resolveAyasReferences("Onu biraz sadeleştir.", deriveAyasConversationState([]), []);
    assert.equal(r.resolutions.length, 0);
    assert.match(r.clarification ?? "", /Neyi kastettiğini/);
  });

  await scenario("topic continuity — selected option and exclusion are rendered together", () => {
    const hist = h(
      ["user", "Prompt ve context olmak üzere iki seçenek var."],
      ["user", "İkincisine bakalım."],
      ["user", "Memory'ye şimdilik girme."],
    );
    const a = assembleAyasContext({ userText: "Burada ilk problem ne?", history: hist });
    assert.equal(a.trace.selectedOption, "context");
    assert.equal(a.trace.temporaryConstraintCount, 1);
    assert.match(a.block.stateLines?.join("\n") ?? "", /context[\s\S]*Memory/i);
  });

  await scenario('long-session follow-up — "Dün konuştuğumuz şeyi devam ettir" resolves without guessing', () => {
    const hist = h(
      ["user", "Mimar Sinan videosunun girişini planlayalım."],
      ["brain", "Girişi kısa bir İstanbul panoramasıyla açmayı öneriyorum."],
    );
    const a = assembleAyasContext({ userText: "Dün konuştuğumuz şeyi devam ettir.", history: hist });
    assert.equal(a.clarification, null);
    assert.ok(a.resolvedReferents.length > 0);
    assert.match(a.block.referenceLines?.join("\n") ?? "", /Mimar Sinan|İstanbul panoraması/i);
  });

  await scenario("Turkish continuation — 'aynısını / aynı şekilde' reuses the prior method", () => {
    const hist = h(["user", "İlk sahneyi üç kısa cümleyle özetle."], ["brain", "İlk sahnenin kısa özeti hazır."]);
    for (const text of ["İkinci sahne için de aynısını yap.", "Bunu da aynı şekilde yap."]) {
      const r = resolveAyasReferences(text, deriveAyasConversationState(hist), hist);
      assert.equal(r.clarification, null);
      assert.ok(r.resolutions.length > 0);
    }
  });

  await scenario("Turkish continuation — next-step and pending-delivery shorthand bind to context", () => {
    const hist = h(["user", "Araştırmayı tamamladık."], ["brain", "Sırada senaryo taslağı var."]);
    for (const text of ["Şimdi ne yapacağız?", "simdi ne yapcaz", "Tamam, ver."]) {
      const r = resolveAyasReferences(text, deriveAyasConversationState(hist), hist);
      assert.equal(r.clarification, null);
      assert.ok(r.resolutions.length > 0);
    }
  });

  await scenario("correction — rejection asks; explicit other selects the sole alternative", () => {
    const bareHist = h(["user", "Renk paletini konuşalım."], ["brain", "Mavi paleti mi kastediyorsun?"]);
    const rejected = resolveAyasReferences("Hayır, ben onu demedim.", deriveAyasConversationState(bareHist), bareHist);
    assert.ok(rejected.clarification);
    assert.equal(rejected.resolutions.length, 0);

    const optionHist = h(
      ["brain", "İki seçenek var: kısa anlatım ve ayrıntılı anlatım."],
      ["user", "İlkini seçelim."],
      ["brain", "Kısa anlatımı seçtim."],
    );
    const alternative = resolveAyasReferences("Bunu değil, diğerini seç.", deriveAyasConversationState(optionHist), optionHist);
    assert.equal(alternative.clarification, null);
    assert.match(alternative.resolutions[0]?.referent ?? "", /ayrintili anlatim/i);
  });

  await scenario("topic return — 'öncekine dön' selects the previous distinct topic", () => {
    const hist = h(
      ["user", "Önce ses tasarımını konuşalım."], ["brain", "Ses katmanlarını değerlendirebiliriz."],
      ["user", "Şimdi thumbnail tarafını konuşalım."], ["brain", "Başlık okunabilirliğiyle başlayalım."],
    );
    const r = resolveAyasReferences("Öncekine dön.", deriveAyasConversationState(hist), hist);
    assert.equal(r.clarification, null);
    assert.match(r.resolutions[0]?.referent ?? "", /ses tasar/i);
  });

  await scenario("context authority — explicit opt-out suppresses prior-context injection", () => {
    const hist = h(["user", "Render ayarlarını konuşalım."], ["brain", "Bitrate ile başlayalım."]);
    const r = resolveAyasReferences("Önceki bağlamı kullanma; yeni konu olarak renk teorisini anlat.", deriveAyasConversationState(hist), hist);
    assert.equal(r.clarification, null);
    assert.equal(r.resolutions.length, 0);
  });

  await scenario("long-session constraint — a direct 'dokunma' instruction survives compression", () => {
    const hist = h(
      ["user", "Bu konuşmada production'a dokunma."],
      ...Array.from({ length: 20 }, (_, index) => [
        index % 2 ? "brain" : "user",
        `Bağlam turu ${index + 1} hakkında ayrıntı.`,
      ] as ["user" | "brain", string]),
    );
    const a = assembleAyasContext({ userText: "Devam et.", history: hist });
    assert.match(a.block.stateLines?.join("\n") ?? "", /production'a dokunma/i);
    assert.ok(a.trace.droppedTurns > 0);
  });

  console.log(`AYAS context smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-context", scenarios: count }));
}

run().catch((error) => {
  console.error("AYAS context smoke FAILED:", error);
  process.exitCode = 1;
});
