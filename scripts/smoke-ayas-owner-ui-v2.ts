/** Independent presentation/parity gate; no frozen grader is changed. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AyasWorkspaceFrame, WORKSPACE_NAV, WORKSPACE_DOCK } from "../src/components/workspace/AyasWorkspaceFrame";
import { BrainConsoleView, type BrainConsoleViewProps } from "../src/components/brain/BrainConsoleView";
import { BRAIN_PANELS, BRAIN_CORE_STATES } from "../src/components/brain/brainCore";
import { loadBrainConsoleSnapshot } from "../src/lib/brain/ui/BrainConsoleSnapshot";
import { classifyPatchTarget, classifyPatchSet } from "../src/lib/brain/selfheal/BrainPatchSafety";
import Dashboard from "../src/components/Dashboard";
import StudioLayout from "../src/components/studio/StudioLayout";
import manifest from "../app/manifest";

async function main() {
  const snapshot = await loadBrainConsoleSnapshot({ rootDir: "__owner_ui_absent_fixture__" });
  const props: BrainConsoleViewProps = { snapshot, coreState: "idle", activePanel: "chat", messages: [], controlCenter: { override: null } };
  let count = 0;
  const check = (name: string, fn: () => void) => { fn(); count++; console.log(`PASS ${count}: ${name}`); };
  const render = (over: Partial<BrainConsoleViewProps> = {}) => renderToStaticMarkup(createElement(BrainConsoleView, { ...props, ...over }));
  const inventory = JSON.parse(fs.readFileSync("docs/ayas-execution/2026-09-27-master/07_BRAIN_UI_V2/owner-ui/inventory-before.json", "utf8"));
  for (const route of inventory.routes) check(`route ${route.route} has retained content inside V2 frame`, () => {
    assert.ok(fs.existsSync(route.file));
    const html = renderToStaticMarkup(AyasWorkspaceFrame({ pathname: route.route, children: createElement("main", null, route.functions) }));
    assert.ok(html.includes('data-design-system="brain-ui-v2"'));
    assert.ok(html.includes('aria-label="AYAS çalışma alanları"'));
    assert.ok(html.includes(route.functions.replaceAll("&", "&amp;")));
  });
  check("all fixed top/dock destinations resolve to existing routes and known panels", () => {
    for (const [, href] of [...WORKSPACE_NAV, ...WORKSPACE_DOCK]) {
      const url = new URL(href, "https://fixture.invalid");
      assert.ok(fs.existsSync(`app${url.pathname === "/" ? "" : url.pathname}/page.tsx`), href);
      const panel = url.searchParams.get("panel");
      if (panel) assert.ok(BRAIN_PANELS.some(p => p.id === panel), panel);
    }
  });
  for (const panel of BRAIN_PANELS) check(`brain ${panel.id} panel remains reachable with identical stateful body`, () => {
    const html = render({ activePanel: panel.id });
    assert.ok(html.includes(`data-panel="${panel.id}"`));
    assert.ok(html.includes(`data-testid="bc-tab-${panel.id}"`));
    assert.ok(html.includes('aria-labelledby="ayas-panel-' + panel.id + '"'));
    assert.ok(!html.includes('class="bc-root'), "legacy orb never appears in the owner console");
  });
  check("navigation keeps original callback and adds usable keyboard tabs", () => {
    let selected = "", focused = false, prevented = false;
    const tree = BrainConsoleView({ ...props, onSelectPanel: id => { selected = id; } });
    const nodes: ReactElement<Record<string, unknown>>[] = [];
    const walk = (node: unknown) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) { node.forEach(walk); return; }
      const element = node as ReactElement<Record<string, unknown>>;
      if (element.props) { nodes.push(element); walk(element.props.children); }
    };
    walk(tree);
    const tasks = nodes.find(n => n.props["data-testid"] === "bc-tab-tasks")!;
    (tasks.props.onClick as () => void)(); assert.equal(selected, "tasks");
    const tabs = nodes.find(n => n.props.role === "tablist")!;
    (tabs.props.onKeyDown as (event: unknown) => void)({ key: "ArrowRight", preventDefault: () => { prevented = true; }, currentTarget: { querySelectorAll: () => BRAIN_PANELS.map(() => ({ focus: () => { focused = true; } })) } });
    assert.equal(selected, "tasks"); assert.ok(focused && prevented);
  });
  check("real state colors and labels, error and degraded content survive", () => {
    for (const state of Object.keys(BRAIN_CORE_STATES) as BrainConsoleViewProps["coreState"][]) {
      const html = render({ coreState: state });
      assert.ok(html.includes(`data-state="${state}"`));
      assert.ok(html.includes(`data-hue="${BRAIN_CORE_STATES[state].hue}"`));
    }
    assert.ok(render({ snapshot: { ...snapshot, errors: ["bounded read failed"] } }).includes('role="alert"'));
  });
  check("chat/stop and every existing voice control remain accessible", () => {
    const html = render({ chatPending: true, onStopGenerating: () => {}, voice: { state: "speaking", capability: { stt: true, tts: true, sttCloudBacked: true }, listening: false, muted: false, disclosureAccepted: false, pendingSpeech: "reply", onInterruptSpeech: () => {}, onAcceptDisclosure: () => {}, onReplayPendingSpeech: () => {}, onToggleMute: () => {} } });
    for (const id of ["bc-input", "bc-send", "bc-stop", "bc-voice-accept", "bc-voice-replay", "bc-voice-mute", "bc-voice-interrupt"]) assert.ok(html.includes(`data-testid="${id}"`), id);
  });
  check("studio retains real project/pipeline components without fabricated status badges", () => {
    const html = renderToStaticMarkup(StudioLayout({ title: "Proje Stüdyosu", children: createElement(Dashboard) }));
    assert.ok(html.includes("Projeler yükleniyor")); assert.ok(html.includes("Proje sayıları okunuyor"));
    assert.ok(!html.includes("Sistem Hazır")); assert.ok(!html.includes("AI Documentary Studio"));
    const source = fs.readFileSync("src/components/HomeClient.tsx", "utf8");
    assert.ok(source.includes('fetch("/api/pipeline"')); assert.ok(source.includes("resolvePipelineStartOutcome(data)")); assert.ok(source.includes("router.push(outcome.to)"));
  });
  check("new shared shell cannot be changed by an automatic homepage patch", () => {
    for (const file of ["src/components/workspace/AyasWorkspaceShell.tsx", "SRC/COMPONENTS/WORKSPACE/FutureCard.tsx", "src\\components\\workspace\\AyasWorkspace.css", "scripts/smoke-ayas-owner-ui-v2.ts", "app/layout.tsx", "src/components/homepage/AyasHomepage.tsx"]) {
      assert.equal(classifyPatchTarget(file).level, "FORBIDDEN_AUTONOMOUS");
      assert.equal(classifyPatchSet(["docs/ordinary.md", file]).autoApplicable, false);
    }
  });
  check("homepage has no added shell/features and PWA retains exact launch/identity", () => {
    const source = fs.readFileSync("src/components/workspace/AyasWorkspaceShell.tsx", "utf8");
    assert.match(source, /pathname === "\/"\) return children/);
    for (const token of ["fetch(", "setInterval(", "requestAnimationFrame(", "useEffect("]) assert.ok(!source.includes(token));
    assert.equal(manifest().start_url, "/"); assert.equal(manifest().scope, "/"); assert.equal(manifest().id, "/brain");
    assert.equal(execFileSync("git", ["diff", "98c36b2", "--", "src/components/homepage/AyasHomepage.tsx", "app/manifest.ts", "public/sw.js"], { encoding: "utf8" }), "");
  });
  check("CSS has scoped responsive, safe-area, focus and reduced-motion contracts", () => {
    const css = fs.readFileSync("src/components/workspace/AyasWorkspace.css", "utf8");
    for (const token of ["safe-area-inset-bottom", "focus-visible", "prefers-reduced-motion", "min-width: 0", "overflow-wrap: anywhere", "max-width: 480px"]) assert.ok(css.includes(token));
    const frame = renderToStaticMarkup(AyasWorkspaceFrame({ pathname: "/brain", children: "fixture" }));
    assert.ok(frame.includes('href="#ayas-workspace-content"')); assert.ok(frame.includes('tabindex="-1"'));
  });
  console.log(JSON.stringify({ suite: "ayas-owner-ui-v2", status: "PASS", scenarios: count }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
