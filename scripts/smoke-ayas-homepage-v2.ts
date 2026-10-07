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
