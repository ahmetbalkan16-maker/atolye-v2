/**
 * AYAS conversational-intelligence master regression.
 *
 * Behavioral contracts only: referent choice, context authority, memory
 * selection, clarification policy, prompt restraint, and SSE finalization.
 * No assertion depends on a model's exact final wording.
 */

import assert from "node:assert/strict";

import type { BrainConsoleSnapshot } from "../src/lib/brain/ui/BrainConsoleSnapshot";
import { buildBrainMemoryRecord } from "../src/lib/brain/BrainMemoryModel";
import { buildAyasChatPrompt } from "../src/components/brain/brainCore";
import { runAyasChatStream } from "../src/components/brain/ayasChatStreamClient";
import { ayasChatStreamEventToSse, type AyasChatStreamEvent } from "../src/lib/ayas/AyasChatStream";
import { assembleAyasContext } from "../src/lib/ayas/context/AyasContextAssembly";
import { compressAyasHistory } from "../src/lib/ayas/context/AyasContextCompression";
import { deriveAyasConversationState } from "../src/lib/ayas/context/AyasConversationState";
import { retrieveAyasMemory } from "../src/lib/ayas/memory/AyasMemoryRetrieval";

type Turn = { readonly role: "user" | "brain"; readonly text: string };

const NOW = "2026-09-22T12:00:00.000Z";
let passed = 0;
const failures: { name: string; category: string; message: string }[] = [];

async function scenario(category: string, name: string, test: () => void | Promise<void>): Promise<void> {
  try {
    await test();
    passed += 1;
    if (process.env.SMOKE_TRACE === "1") console.log(`PASS [${category}] ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push({ name, category, message });
    console.error(`FAIL [${category}] ${name}: ${message}`);
  }
}

function turns(...values: [Turn["role"], string][]): Turn[] {
  return values.map(([role, text]) => ({ role, text }));
}

function context(userText: string, history: readonly Turn[] = []) {
  return assembleAyasContext({ userText, history });
}

function record(body: string, tags: string[] = ["tercih"], observedAt = NOW) {
  return buildBrainMemoryRecord({
    kind: "user-preference",
    title: "Kullanıcı bilgisi",
    body,
    importance: "durable",
    confidence: "reported",
    tags,
    observedAt,
    links: [],
  });
}

function snapshot(): BrainConsoleSnapshot {
  return {
    generatedAt: NOW,
    executionGate: "CLOSED",
    connected: { tasks: false, cycles: false, experience: false },
    errors: [],
    tasks: {
      total: 0,
      byStatus: { queued: 0, running: 0, "blocked-on-dependency": 0, "blocked-on-approval": 0, succeeded: 0, failed: 0, cancelled: 0, "skipped-unsafe": 0 },
      pendingApproval: 0,
      skippedUnsafe: 0,
      items: [],
    },
    cyclesRecorded: 0,
    experience: { total: 0 },
    safety: { decision: "proceed-with-constraints", snapshotSource: "unavailable", reasons: [], hardwareProfileId: "gtx-1650-4gb" },
  };
}

function prompt(userText: string, history: readonly Turn[] = []): string {
  const assembled = context(userText, history);
  return buildAyasChatPrompt({
    userText,
    snapshot: snapshot(),
    history: assembled.recentHistory,
    conversation: assembled.block,
    complexity: "SIMPLE",
    format: "text",
  });
}

function sseFetch(events: readonly AyasChatStreamEvent[]): typeof fetch {
  return (async () => {
    const bytes = new TextEncoder().encode(events.map(ayasChatStreamEventToSse).join(""));
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }) as unknown as typeof fetch;
}

async function run(): Promise<void> {
  await scenario("INTENT", "clear direct request does not trigger clarification", () => {
    assert.equal(context("Mimar Sinan için üç başlık öner.").clarification, null);
  });

  await scenario("CLARIFICATION", "unbound demonstrative genuinely needs clarification", () => {
    assert.ok(context("Bunu yap.").clarification);
  });

  await scenario("REFERENT", "ambiguous-looking demonstrative is resolved by one prior task", () => {
    const c = context("Bunu yap.", turns(["user", "Giriş paragrafını daha kısa yaz."], ["brain", "İki farklı kısaltma yolu önerebilirim."]));
    assert.equal(c.clarification, null);
    assert.match(c.resolvedReferents.join(" "), /Giriş paragrafını/i);
  });

  await scenario("REFERENT", "aynısını reuses the prior format instead of resetting context", () => {
    const c = context("İkinci sahne için de aynısını yap.", turns(["user", "İlk sahneyi üç kısa cümleyle özetle."], ["brain", "İlk sahnenin kısa özeti hazır."]));
    assert.equal(c.clarification, null);
    assert.match(c.resolvedReferents.join(" "), /İlk sahnenin kısa özeti hazır/i);
  });

  await scenario("CORRECTION", "bare rejection does not silently keep the rejected referent", () => {
    const c = context("Hayır, ben onu demedim.", turns(["user", "Renk paletini konuşalım."], ["brain", "Mavi paleti mi kastediyorsun?"]));
    assert.ok(c.clarification);
    assert.equal(c.resolvedReferents.length, 0);
  });

  await scenario("CONTEXT", "a clear subject change does not drag the old topic into the turn", () => {
    const c = context("Akşam ne yesem?", turns(["user", "Render ayarlarını konuşalım."], ["brain", "Bitrate ile başlayabiliriz."]));
    assert.equal(c.clarification, null);
    assert.equal(c.resolvedReferents.length, 0);
  });

  await scenario("CONTEXT", "öncekine dön selects the previous distinct topic", () => {
    const history = turns(
      ["user", "Önce ses tasarımını konuşalım."], ["brain", "Ses katmanlarını değerlendirebiliriz."],
      ["user", "Şimdi thumbnail tarafını konuşalım."], ["brain", "Başlık okunabilirliğiyle başlayalım."],
    );
    const c = context("Öncekine dön.", history);
    assert.equal(c.clarification, null);
    assert.match(c.resolvedReferents.join(" "), /ses tasar/i);
  });

  await scenario("MEMORY", "current explicit preference overrides older memory", () => {
    const result = retrieveAyasMemory([record("cevapları kısa tut")], "Bu sefer uzun ve ayrıntılı anlat.", { nowIso: NOW });
    assert.equal(result.selected.length, 0);
    assert.equal(result.quarantined[0]?.quarantineReason, "current-request-overrides-memory");
  });

  await scenario("MEMORY", "stale memory cannot present itself as current", () => {
    const result = retrieveAyasMemory([record("aktif proje eski-belgesel", ["proje"], "2025-01-01T00:00:00.000Z")], "aktif projem ne", { nowIso: NOW });
    assert.equal(result.selected.length, 0);
    assert.equal(result.quarantined[0]?.quarantineReason, "stale-fact");
  });

  await scenario("MEMORY", "relevant identity memory is selected", () => {
    const result = retrieveAyasMemory([record("beni Ahmet olarak hatırla", ["kimlik"])], "ismim ne", { nowIso: NOW });
    assert.equal(result.selected.length, 1);
  });

  await scenario("MEMORY", "irrelevant memorable fact stays out", () => {
    const result = retrieveAyasMemory([record("cevapları kısa tut")], "Ankara'nın başkenti olduğu hangi yıl ilan edildi", { nowIso: NOW });
    assert.equal(result.selected.length, 0);
  });

  await scenario("TURKISH", "typo-heavy next-step question continues the active topic", () => {
    const c = context("simdi ne yapcaz", turns(["user", "Ses temizliğini bitirdik."], ["brain", "Sırada miks kontrolü var."]));
    assert.equal(c.clarification, null);
    assert.ok(c.trace.resolvedReferences > 0);
  });

  await scenario("TURKISH", "colloquial tamam ver continues the pending deliverable", () => {
    const c = context("tamam ver", turns(["user", "Kısa özet hazırlar mısın?"], ["brain", "Üç cümlelik özet uygun olur mu?"]));
    assert.equal(c.clarification, null);
    assert.ok(c.trace.resolvedReferences > 0);
  });

  await scenario("TURKISH", "omitted-subject pronoun follows the only concrete request", () => {
    const c = context("Buna bir de kapanış ekle.", turns(["user", "Giriş metnini sadeleştir."], ["brain", "Giriş metnini sadeleştirdim."]));
    assert.equal(c.clarification, null);
    assert.match(c.resolvedReferents.join(" "), /Giriş metnini/i);
  });

  await scenario("INTENT", "multi-part request is preserved as one current turn", () => {
    const text = "Metni kısalt, iki başlık öner ve belirsiz kalan noktayı söyle.";
    const built = prompt(text);
    assert.match(built, /Metni kısalt, iki başlık öner ve belirsiz kalan noktayı söyle/);
    assert.doesNotMatch(built, /neyi kastettiğini sor/i);
  });

  await scenario("INTENT", "direct action wording remains explicit and is not mistaken for a question", () => {
    assert.equal(context("Bu taslağı iki paragrafa indir.").clarification, null);
  });

  await scenario("INTENT", "explanation-only request does not acquire execution intent", () => {
    const built = prompt("Sadece nedenini açıkla, hiçbir şey uygulama.");
    assert.match(built, /Sadece nedenini açıkla, hiçbir şey uygulama/);
    assert.match(built, /Yürütme yetkin YOK/);
  });

  await scenario("RESTRAINT", "unknown facts are governed by an explicit non-fabrication contract", () => {
    const built = prompt("Bu bilinmeyen özel sistemin seri numarası ne?");
    assert.match(built, /Bilmediğin[^\n]+uydurma/i);
  });

  await scenario("CORRECTION", "assistant mistake followed by rejection requires a new binding", () => {
    const c = context("Hayır, onu demedim; diğerini kastettim.", turns(["user", "Prompt ve context olmak üzere iki seçenek var."], ["brain", "Prompt seçeneğini uygulayalım."]));
    assert.equal(c.clarification, null);
    assert.match(c.resolvedReferents.join(" "), /context/i);
  });

  await scenario("REFERENT", "devam et follows the most recent assistant turn", () => {
    const c = context("Devam et.", turns(["user", "Miks adımlarını anlat."], ["brain", "Önce gürültü temizliği yapılır."]));
    assert.equal(c.clarification, null);
    assert.match(c.resolvedReferents.join(" "), /gürültü temizliği/i);
  });

  await scenario("CONTEXT", "long context retains a relevant earlier fact extractively", () => {
    const history = turns(
      ["user", "Ana kısıt: anlatım iki dakika olacak."], ["brain", "Not ettim."],
      ["user", "Başlığı konuşalım."], ["brain", "Üç başlık var."],
      ["user", "Görselleri konuşalım."], ["brain", "Arşiv görselleri uygun."],
      ["user", "Müziği konuşalım."], ["brain", "Düşük tempolu olabilir."],
    );
    const compressed = compressAyasHistory(history, { recentTurns: 4 });
    assert.match(compressed.summary.join(" "), /iki dakika/i);
  });

  await scenario("CONTEXT", "recent explicit topic outranks a distant topic", () => {
    const state = deriveAyasConversationState(turns(
      ["user", "Önce ses tasarımını konuşalım."], ["brain", "Tamam."],
      ["user", "Şimdi thumbnail tarafını konuşalım."], ["brain", "Tamam."],
    ));
    assert.match(state.activeTopic ?? "", /thumbnail/i);
  });

  await scenario("STREAM", "terminal answer is consistent with streamed deltas", async () => {
    const deltas: string[] = [];
    const result = await runAyasChatStream({
      text: "özetle", history: [], seq: 1, onDelta: (delta) => deltas.push(delta),
      fetcher: sseFetch([
        { type: "delta", text: "Kısa " },
        { type: "delta", text: "özet." },
        { type: "done", text: "Kısa özet.", source: "llm", corrected: false },
      ]),
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.text, deltas.join(""));
  });

  await scenario("STREAM", "first terminal is final and late deltas/duplicate terminal are ignored", async () => {
    const deltas: string[] = [];
    const result = await runAyasChatStream({
      text: "özetle", history: [], seq: 2, onDelta: (delta) => deltas.push(delta),
      fetcher: sseFetch([
        { type: "delta", text: "Doğru cevap." },
        { type: "done", text: "Doğru cevap.", source: "llm", corrected: false },
        { type: "delta", text: "ESKİ" },
        { type: "done", text: "ESKİ", source: "fallback", corrected: true, reason: "late" },
      ]),
    });
    assert.deepEqual(deltas, ["Doğru cevap."]);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.text, "Doğru cevap.");
  });

  await scenario("IDENTITY", "identity reference continuity uses relevant memory only", () => {
    const result = retrieveAyasMemory(
      [record("beni Eylül olarak hatırla", ["kimlik"]), record("yanıtları kısa tut", ["tercih"])],
      "Benim adım ne?",
      { nowIso: NOW },
    );
    assert.equal(result.selected.length, 1);
    assert.match(result.selected[0]?.record.body ?? "", /Eylül/i);
  });

  await scenario("REFERENT", "şimdi ne yapacağız asks for the next step in the active task", () => {
    const c = context("Şimdi ne yapacağız?", turns(["user", "Araştırmayı tamamladık."], ["brain", "Sırada senaryo taslağı var."]));
    assert.equal(c.clarification, null);
    assert.ok(c.trace.resolvedReferences > 0);
  });

  await scenario("REFERENT", "tamam ver binds to the pending assistant question", () => {
    const c = context("Tamam, ver.", turns(["user", "Bana bir özet çıkar."], ["brain", "Kısa sürümü şimdi paylaşayım mı?"]));
    assert.equal(c.clarification, null);
    assert.ok(c.trace.resolvedReferences > 0);
  });

  await scenario("REFERENT", "aynı şekilde yap preserves the prior method", () => {
    const c = context("Bunu da aynı şekilde yap.", turns(["user", "İlk bölümü sade Türkçeyle yaz."], ["brain", "İlk bölümü sadeleştirdim."]));
    assert.equal(c.clarification, null);
    assert.ok(c.trace.resolvedReferences > 0);
  });

  await scenario("CLARIFICATION", "complete request does not provoke a redundant question", () => {
    assert.equal(context("Metni 120 kelimeye indir ve resmi bir ton kullan.").clarification, null);
  });

  await scenario("REFERENT", "bunu değil diğerini selects the only alternative", () => {
    const c = context("Bunu değil, diğerini seç.", turns(["brain", "İki seçenek var: kısa anlatım ve ayrıntılı anlatım."], ["user", "İlkini seçelim."], ["brain", "Kısa anlatımı seçtim."]));
    assert.equal(c.clarification, null);
    assert.match(c.resolvedReferents.join(" "), /ayrintili anlatim/i);
  });

  await scenario("CONTEXT", "explicit prior-context opt-out prevents old referent injection", () => {
    const c = context("Önceki bağlamı kullanma; yeni konu olarak renk teorisini anlat.", turns(["user", "Render ayarlarını konuşalım."], ["brain", "Bitrate ile başlayalım."]));
    assert.equal(c.clarification, null);
    assert.equal(c.resolvedReferents.length, 0);
  });

  await scenario("REFERENT", "az önce söylediğim şeyi kullan resolves to the user's prior instruction", () => {
    const c = context("Az önce söylediğim şeyi kullan.", turns(["user", "Başlıkta soru cümlesi kullan."], ["brain", "Anladım."]));
    assert.equal(c.clarification, null);
    assert.match(c.resolvedReferents.join(" "), /Başlıkta soru cümlesi/i);
  });

  await scenario("TEMPORAL", "deferred topic remains bound without pretending to execute it", () => {
    const c = context("Buna sonra bakarız.", turns(["user", "Thumbnail rengini konuşalım."], ["brain", "Mavi ve turuncu seçenekleri var."]));
    assert.equal(c.clarification, null);
    assert.ok(c.trace.resolvedReferences > 0);
  });

  await scenario("TEMPORAL", "first finish this binds the immediate task", () => {
    const c = context("İlk önce bunu bitirelim.", turns(["user", "Senaryo girişini kısalt."], ["brain", "İki cümleye indirebilirim."]));
    assert.equal(c.clarification, null);
    assert.ok(c.trace.resolvedReferences > 0);
  });

  await scenario("MEMORY", "cross-computer continuation without available memory does not fabricate", () => {
    const c = context("Öbür bilgisayardaki kaldığımız yerden devam et.");
    assert.ok(c.clarification);
    assert.equal(c.resolvedReferents.length, 0);
  });

  await scenario("CLARIFICATION", "one pronoun with two live options asks rather than guessing", () => {
    const c = context("Onu yap.", turns(["brain", "İki seçenek var: kısa kurgu ve uzun kurgu."]));
    assert.ok(c.clarification);
  });

  await scenario("PROMPT", "answer-quality contract prioritizes directness and current context", () => {
    const built = prompt("Bunu bir cümlede açıkla.", turns(["user", "RRF sıralamasını konuşalım."], ["brain", "RRF birleştirilmiş sıralamadır."]));
    assert.match(built, /Güncel konuşma ile kalıcı hafıza çatışırsa güncel konuşma önceliklidir/i);
    assert.match(built, /Basit soruya kısa ve net cevap ver/i);
  });

  console.log(JSON.stringify({
    suite: "ayas-conversation-quality-master",
    status: failures.length ? "FAIL" : "PASS",
    scenarios: passed + failures.length,
    passed,
    failed: failures.length,
    failures: failures.map(({ category, name }) => ({ category, name })),
  }));

  if (failures.length) process.exitCode = 1;
}

void run();
