/** New owner-homepage contract. Independent of the frozen Stage17 graders. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup, renderToPipeableStream } from "react-dom/server";
import { PassThrough } from "node:stream";
import { BrainConsoleView, type BrainConsoleViewProps } from "../src/components/brain/BrainConsoleView";
import { classifyPatchSet, classifyPatchTarget } from "../src/lib/brain/selfheal/BrainPatchSafety";
import { BRAIN_CORE_STATES, deriveBrainCoreLiveState } from "../src/components/brain/brainCore";
import { loadBrainConsoleSnapshot } from "../src/lib/brain/ui/BrainConsoleSnapshot";
import type { AyasControlCenterServerFacts } from "../src/lib/brain/ui/AyasControlCenterModel";
import type { AtolyeBrainsView } from "../src/lib/v3/council/BrainsReport";

async function main() {
  // A deliberately absent root: read-only loader, no real durable state.
  const snapshot = await loadBrainConsoleSnapshot({ rootDir: "__ayas_homepage_test_absent_root__" });
  const props: BrainConsoleViewProps = { homepage: true, snapshot, coreState: "idle", activePanel: "chat", messages: [], connectivity: "online" };
  const render = (over: Partial<BrainConsoleViewProps> = {}) => renderToStaticMarkup(createElement(BrainConsoleView, { ...props, ...over }));
  let count = 0;
  const check = (name: string, fn: () => void) => { fn(); count++; console.log(`PASS ${count}: ${name}`); };

  check("fixed six-area dock and existing navigation survive", () => {
    const html = render();
    const dock = html.match(/<nav class="ah-dock"[\s\S]*?<\/nav>/)?.[0] ?? "";
    assert.equal((dock.match(/<a /g) ?? []).length, 6);
    for (const url of ["/studio", "/brain?panel=memory", "/brain?panel=research", "/brain?panel=development", "/brain/revenue", "/brain/constitution", "/brain/voice-lab"]) assert.ok(html.includes(url), url);
    assert.ok(!html.includes("bc-cc-domains"), "full dashboard must remain off homepage");
    assert.ok(!html.includes("bc-dev__"), "development cards stay on subpage");
  });
  check("all real brain states retain accessible text and distinct state attributes", () => {
    for (const state of Object.keys(BRAIN_CORE_STATES) as (keyof typeof BRAIN_CORE_STATES)[]) {
      const html = render({ coreState: state });
      assert.ok(html.includes(`data-state="${state}"`));
      assert.ok(html.includes(`aria-label="AYAS — ${BRAIN_CORE_STATES[state].tr}"`));
      assert.equal((html.match(/data-active="true"/g) ?? []).length, ["listening", "thinking", "speaking"].includes(state) ? 1 : 0);
    }
  });
  check("unconnected sources are unknown, never green fabricated health", () => {
    const html = render({ controlCenter: { override: null } });
    assert.ok(html.includes('data-level="UNKNOWN"'));
    assert.ok(/Bağlı değil|Veri yok|Okunamadı|kaynak yok|bilinmiyor/i.test(html));
    assert.ok(!html.includes("100%"));
  });
  check("state reducer still prioritizes actual offline, tool and speech evidence", () => {
    const base = { restingState: "idle" as const, chatPending: false, refreshPending: false, toolActive: false, draftNonEmpty: false, autonomousWaiting: false, voiceState: "idle" as const };
    assert.equal(deriveBrainCoreLiveState({ ...base, connectivity: "offline", chatPending: true }), "offline");
    assert.equal(deriveBrainCoreLiveState({ ...base, connectivity: "online", chatPending: true, toolActive: true }), "tool");
    assert.equal(deriveBrainCoreLiveState({ ...base, connectivity: "online", voiceState: "speaking" }), "speaking");
  });
  check("streaming stop and error fallback remain available", () => {
    const html = render({ chatPending: true, turnTool: "read-only", onStopGenerating: () => {}, lastReplySource: "fallback", snapshot: { ...snapshot, errors: ["read failed"] } });
    assert.ok(html.includes('data-testid="bc-stop"'));
    assert.ok(html.includes('data-turn-state="tool-action"'));
    assert.ok(html.includes("deterministik özet"));
    assert.ok(html.includes('role="alert"'));
  });
  check("voice opt-in, mute, replay, interrupt and text survive", () => {
    const voice = { state: "speaking" as const, capability: { stt: true, tts: true, sttCloudBacked: true }, listening: false, muted: false, disclosureAccepted: false, pendingSpeech: "reply", onInterruptSpeech: () => {}, onToggleMute: () => {}, onAcceptDisclosure: () => {}, onReplayPendingSpeech: () => {} };
    const html = render({ voice });
    for (const testId of ["bc-input", "bc-send", "bc-voice-disclosure", "bc-voice-accept", "bc-voice-mute", "bc-voice-replay", "bc-voice-interrupt"]) assert.ok(html.includes(`data-testid="${testId}"`), testId);
    assert.ok(html.includes('aria-disabled="true"'));
  });
  check("tasks switch renders the original tasks view", () => {
    const html = render({ activePanel: "tasks" });
    assert.ok(!html.includes('data-testid="bc-chat-log"'));
    assert.ok(!html.includes('class="ah-voice-orbit"'));
    assert.ok(html.includes("Görevler"));
  });
  check("homepage policy fails closed including case/slash variants", () => {
    for (const file of ["app/page.tsx", "APP/LAYOUT.TSX", "./app/globals.css", "src\\components\\homepage\\FutureWidget.tsx", "public/ayas/brain/new.webp", "src/components/brain/AyasConsolePage.tsx", "src/components/brain/BrainCoreConsole.tsx", "src/components/brain/BrainConsoleView.tsx", "docs/AYAS_HOMEPAGE_POLICY.md", "AGENTS.md", "scripts/smoke-ayas-homepage-v2.ts"]) {
      assert.equal(classifyPatchTarget(file).level, "FORBIDDEN_AUTONOMOUS", file);
      assert.equal(classifyPatchSet(["docs/ordinary.md", file]).autoApplicable, false, file);
    }
    assert.equal(classifyPatchTarget("src/components/brain/AyasDevelopmentCenter.tsx").level, "SAFE");
    assert.equal(classifyPatchTarget("src/components/brain/BrainCore.css").level, "SAFE", "independent full-console skin stays outside homepage");
  });
  check("presentational shell has no polling, authority calls or capability enumeration", () => {
    const source = fs.readFileSync("src/components/homepage/AyasHomepage.tsx", "utf8");
    assert.ok(!/\b(fetch|setInterval|setTimeout|requestAnimationFrame|dangerouslySetInnerHTML)\s*\(/.test(source));
    assert.ok(!/from ["'][^"']*(?:execution|ApprovalDecision|ProductionExecution|MutationRegistry)/.test(source));
    assert.ok(!/capabilities\.map|BRAIN_PANELS\.map/.test(source));
    const css = fs.readFileSync("src/components/homepage/AyasHomepage.css", "utf8");
    for (const term of ["prefers-reduced-motion", ":focus-visible", "safe-area-inset", "max-width: 640px", "minmax(0, 1fr)", "font-size: 16px"]) assert.ok(css.includes(term), term);
  });
  check("Atölye brain council (owner instruction 2026-11-03): real records only, honest empty and unreadable states", () => {
    const member = (id: string, ad: string, durum: "calisiyor" | "bekliyor", is: string) => ({ id, ad, durum, is }) as AtolyeBrainsView["meclis"]["beyinler"][number];
    const meclis: AtolyeBrainsView["meclis"] = {
      uretim: '"Caesar" yapılıyor — kostüm adımı (2/9)',
      beyinler: [member("sef", "AYAS (yönetmen)", "bekliyor", "araştırma ve senaryo bitti (95 sn)"), member("kostum", "Kostüm beyni", "calisiyor", "kostüm adımında"), member("ses", "Ses beyni", "bekliyor", "henüz kaydı yok"), member("gelistirici", "Geliştirici beyni", "calisiyor", "akşam geliştirmesi")],
      akis: Array.from({ length: 7 }, (_, i) => ({ tarih: new Date(Date.UTC(2026, 10, 3, 14, 30 - i)).toISOString(), kim: i % 2 ? "kostum" : "sef", ...(i === 0 ? { rol: "Tarihçi", kime: "AYAS" } : {}), metin: `satır ${i}` })) as AtolyeBrainsView["meclis"]["akis"],
    };
    const view: AtolyeBrainsView = { connected: true, referanslar: [], hedefler: [], donguler: [], degisiklikler: [], oneriler: [], fikirSayisi: 0, kararlar: [], kuyruk: [], meclis };
    const html = render({ atolyeBrains: view });
    assert.ok(html.includes('data-testid="ayas-brain-council"'));
    assert.equal((html.match(/class="ah-council-node"/g) ?? []).length, 4);
    assert.equal((html.match(/data-durum="calisiyor"/g) ?? []).length, 2);
    assert.ok(html.includes("Çalışıyor — kostüm adımında") && html.includes("henüz kaydı yok"));
    assert.ok(html.includes("Caesar") && html.includes("kostüm adımı (2/9)"));
    assert.equal((html.match(/<time dateTime=/g) ?? []).length, 5, "the latest five words only");
    assert.ok(html.includes("Kostüm beyni") && html.includes("AYAS (yönetmen) (Tarihçi) → AYAS"));
    assert.ok(!html.includes("data-speaking"), "nobody is shown speaking before the browser knows the time");
    // The central brain, its states and the fixed navigation are where they were.
    assert.ok(html.includes('aria-label="AYAS — ') && html.includes('class="ah-state"'));
    assert.equal(((html.match(/<nav class="ah-dock"[\s\S]*?<\/nav>/)?.[0] ?? "").match(/<a /g) ?? []).length, 6);
    assert.ok(!html.includes("bc-dev__"), "development cards stay on subpage");
    // No view yet, an unreadable store, an empty one: each says so, nothing is invented.
    assert.ok(render().includes("kayıtları okunuyor"));
    assert.equal((render().match(/class="ah-council-node"/g) ?? []).length, 0);
    assert.ok(render({ atolyeBrains: { ...view, connected: false, error: "EACCES" } }).includes("Kayıtlar okunamadı: EACCES"));
    assert.ok(render({ atolyeBrains: { ...view, meclis: { beyinler: [], akis: [] } } }).includes("Henüz bir beyin konuşması kaydedilmedi"));
  });
  check("brain council is read-only and its source cannot be rewritten automatically", () => {
    const source = fs.readFileSync("src/components/homepage/AyasBrainCouncil.tsx", "utf8");
    assert.ok(!/\bfetch\s*\(|dangerouslySetInnerHTML/.test(source));
    assert.ok(!/from ["'][^"']*(?:actions|execution|Approval|ProductionExecution|MutationRegistry|DevQueue|Developer)["']/.test(source));
    assert.ok(/import type \{ AtolyeBrainsView \}/.test(source) && !/from ["']@\/lib\/v3\/council\/(?!BrainsReport)/.test(source));
    assert.ok(source.includes("REFRESH_MS = 30_000") && source.includes('document.visibilityState !== "visible"'));
    assert.equal(classifyPatchTarget("src/lib/v3/council/BrainCouncilFeed.ts").level, "FORBIDDEN_AUTONOMOUS");
    assert.equal(classifyPatchTarget("src/components/homepage/AyasBrainCouncil.tsx").level, "FORBIDDEN_AUTONOMOUS");
    assert.ok(fs.readFileSync("docs/AYAS_HOMEPAGE_POLICY.md", "utf8").includes("## Atölye brain council (2026-11-03)"));
  });
  check("original production dashboard preserved and fake timed stage labels removed", () => {
    assert.ok(fs.readFileSync("app/studio/page.tsx", "utf8").includes("<HomeClient />"));
    const source = fs.readFileSync("src/components/HomeClient.tsx", "utf8");
    assert.ok(source.includes('fetch("/api/pipeline"'));
    assert.ok(source.includes("resolvePipelineStartOutcome(data)"));
    assert.ok(!source.includes("setInterval"));
  });
  // Resolve a delayed server promise after the shell renders. This catches a
  // suspense regression without inventing a live Control Center receipt.
  let release!: (value: AyasControlCenterServerFacts | null) => void;
  const facts = new Promise<AyasControlCenterServerFacts | null>(resolve => { release = resolve; });
  const streamed = await new Promise<string>((resolve, reject) => {
    const output = new PassThrough(); let html = "";
    output.on("data", data => { html += data.toString(); });
    output.on("end", () => resolve(html));
    const stream = renderToPipeableStream(createElement(BrainConsoleView, { ...props, controlCenter: { facts } }), {
      onShellReady() { stream.pipe(output); release(null); }, onError: reject,
    });
  });
  check("delayed facts stream without blocking chat; absent result stays truthful", () => {
    assert.ok(streamed.includes('aria-busy="true"'));
    assert.ok(streamed.includes('data-testid="bc-input"'));
    assert.ok(streamed.includes('data-level="UNKNOWN"'));
  });
  console.log(JSON.stringify({ suite: "ayas-homepage-v2", status: "PASS", scenarios: count }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
