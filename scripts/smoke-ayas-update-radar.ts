import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AyasGoalResearchPanel } from "../src/components/brain/AyasGoalResearchPanel";
import type { AyasExternalResearchFinding } from "../src/lib/brain/autonomy/AyasExternalResearchStore";
import { loadAyasResearchEngineStatusView, type AyasResearchEngineStatusView } from "../src/lib/brain/autonomy/AyasResearchEngineStatusView";
import type { AyasResearchSeenItem } from "../src/lib/brain/autonomy/AyasResearchNoveltyStore";
import { buildAyasResearchHealth, buildAyasUpdateRadar, findAyasPackageUsers } from "../src/lib/brain/autonomy/AyasUpdateRadar";

/**
 * Research integration Phase 2/3b (owner plan 2026-10-15): read-only update radar, development briefs and research
 * health. Synthetic repository root and observations only: no network, model, store write or mutation.
 */
let count = 0;
const scenario = (name: string, fn: () => void): void => { fn(); count += 1; void name; };
const NOW = "2026-10-15T08:00:00.000Z";
const repo = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-update-radar-"));
const write = (file: string, content: string): void => { fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true }); fs.writeFileSync(path.join(repo, file), content); };
write("package-lock.json", JSON.stringify({ packages: { "node_modules/next": { version: "16.3.8" }, "node_modules/eslint": { version: "9.39.4" }, "node_modules/typescript": { version: "5.9.3" } } }));
write("next.config.ts", "export default {};\n");
write("src/app-shell.tsx", "import Link from \"next/link\";\nexport const shell = Link;\n");
write("scripts/smoke-shell.ts", "import { NextResponse } from \"next/server\";\nvoid NextResponse;\n");
write("src/unrelated.ts", "import nextTick from \"next-tick\";\nvoid nextTick;\n");
write("eslint.config.mjs", "export default [];\n");

const seen = (sourceId: string, versionTag: string, lastSeenAt = "2026-10-15T06:00:00.000Z"): AyasResearchSeenItem => ({
  schemaVersion: "1", itemId: `${sourceId}-${versionTag}`, sourceId, normalizedUrl: `https://example.test/${sourceId}/${encodeURIComponent(versionTag)}`,
  versionTag, contentFingerprint: "f", firstSeenAt: lastSeenAt, lastSeenAt, timesSeen: 1,
} as AyasResearchSeenItem);
const seenItems = [
  seen("nextjs", "v16.4.1"), seen("nextjs", "v16.4.0"), seen("nextjs", "v16.5.0-canary.1"), seen("nextjs", "v15.5.28"),
  seen("eslint", "v10.11.0"), seen("eslint", "v10.10.0"), seen("workers-sdk", "@cloudflare/workers-utils@0.45.0"),
  seen("nodejs", "2026-10-14, Version 100.0.0 (Current), @someone"), seen("nodejs", "2026-10-14, Version 99.1.0 'Krypton' (LTS), @someone"),
  seen("aider", "v0.90.0"),
];
const finding = (over: Partial<AyasExternalResearchFinding>): AyasExternalResearchFinding => ({
  schemaVersion: "1", findingId: `f-${Math.random()}`, recordedAt: "2026-10-15T06:30:00.000Z", provider: "Vercel", capability: "c", problemSolved: "p",
  sourceUrl: "https://github.com/vercel/next.js/releases/tag/v16.4.1", isOfficialSource: true, featureDate: null, lastCheckedAt: NOW, confidence: "high",
  licenseCostStatus: "open-source", licenseCostNotes: "", atolyeGapStatus: "missing", atolyeGapNotes: "", treatedSourceAsUntrusted: true, ...over,
} as AyasExternalResearchFinding);
const findings = [
  finding({ findingId: "grounded", evidenceQuote: "Adds faster dev server restarts" }),
  finding({ findingId: "legacy" }),
  finding({ findingId: "other-repo", evidenceQuote: "Something in another repository", sourceUrl: "https://github.com/facebook/react/releases/tag/v19.3.0" }),
];

const radar = buildAyasUpdateRadar({ repoRoot: repo, seenItems, findings });
scenario("only newer stable releases of tracked tools appear, major bumps first", () => {
  assert.deepEqual(radar.map((item) => `${item.sourceId}:${item.latestVersion}:${item.bump}`), ["eslint:10.11.0:MAJOR", "nodejs:99.1.0:MAJOR", "nextjs:16.4.1:MINOR"]);
  const next = radar.find((item) => item.sourceId === "nextjs")!;
  assert.equal(next.installedVersion, "16.3.8"); assert.equal(next.newerStableReleases, 2); assert.equal(next.target, "npm:next"); assert.equal(next.toolName, "Next.js");
  assert.equal(next.applyChannel, "DEVELOPMENT_SESSION"); assert.match(next.latestUrl, /v16\.4\.1$/);
});
scenario("Node.js follows the LTS channel and is re-pinned by the owner", () => {
  const node = radar.find((item) => item.sourceId === "nodejs")!;
  assert.equal(node.latestVersion, "99.1.0"); assert.equal(node.applyChannel, "OWNER_PINNED_RUNTIME");
  assert.ok(node.brief.validation.some((step) => /SHA-256/.test(step))); assert.match(node.brief.risk, /node\.exe SHA-256/);
});
scenario("evidence is only verified quotes from the same repository", () => {
  assert.deepEqual(radar.find((item) => item.sourceId === "nextjs")!.evidence.map((entry) => entry.findingId), ["grounded"]);
  assert.equal(radar.find((item) => item.sourceId === "eslint")!.evidence.length, 0);
});
scenario("the development brief lists real users, config files and a validation plan", () => {
  const next = radar.find((item) => item.sourceId === "nextjs")!.brief;
  assert.deepEqual(next.affectedFiles, ["next.config.ts", "scripts/smoke-shell.ts", "src/app-shell.tsx"]);
  assert.equal(next.affectedFileCount, 3);
  assert.deepEqual(next.validation, ["npx tsc --noEmit", "CI-eşdeğeri lint (git'teki dosyalar)", "npm run build", "npx tsx scripts/smoke-shell.ts"]);
  assert.match(next.summary, /16\.3\.8 → 16\.4\.1/); assert.match(next.risk, /Ara sürüm/);
  assert.match(radar.find((item) => item.sourceId === "eslint")!.brief.risk, /Ana sürüm/);
  assert.deepEqual(findAyasPackageUsers(repo, "eslint"), ["eslint.config.mjs"]);
});
scenario("research health reports degraded, quiet and healthy states with reasons", () => {
  const base = { now: NOW, radar, lastSuccessfulResearchAt: "2026-10-15T07:00:00.000Z", consecutiveFailures: 0 };
  const healthy = buildAyasResearchHealth({ ...base, findings });
  assert.equal(healthy.status, "HEALTHY"); assert.equal(healthy.findingsLast7d, 3); assert.equal(healthy.groundedFindingsLast7d, 2); assert.equal(healthy.trackedToolsWithUpdates, 3);
  assert.equal(buildAyasResearchHealth({ ...base, findings: [] }).status, "QUIET");
  const failing = buildAyasResearchHealth({ ...base, findings, consecutiveFailures: 2 });
  assert.equal(failing.status, "DEGRADED"); assert.match(failing.reasons[0]!, /2 kez/);
  assert.equal(buildAyasResearchHealth({ ...base, findings, lastSuccessfulResearchAt: "2026-10-14T20:00:00.000Z" }).status, "DEGRADED");
});
scenario("the live status view builds the radar without throwing", () => {
  const view = loadAyasResearchEngineStatusView(NOW);
  assert.equal(view.connected, true); assert.ok(Array.isArray(view.updateRadar)); assert.ok(view.researchHealth);
});
scenario("the panel renders health, radar and brief, with a consent control but no execute control", () => {
  const base = { connected: true, consecutiveFailures: 0, sources: [], digest: { sourcesRegistered: 0, sourcesChangedLast24h: 0, sourcesFailingNow: 0, findingsLast24h: 0 },
    updateRadar: radar, researchHealth: buildAyasResearchHealth({ now: NOW, findings, radar, lastSuccessfulResearchAt: NOW, consecutiveFailures: 0 }) } as AyasResearchEngineStatusView;
  const render = (status: AyasResearchEngineStatusView) => renderToStaticMarkup(createElement(AyasGoalResearchPanel, { view: { connected: true, goals: [], research: [findings[0]!] }, researchEngineStatus: status }));
  const html = render({ ...base, updateApprovals: [] });
  assert.match(html, /data-testid="ayas-research-health"/); assert.match(html, /data-testid="ayas-update-radar-nextjs"/);
  assert.match(html, /Next\.js: 16\.3\.8 → 16\.4\.1/); assert.match(html, /Geliştirme özeti/);
  assert.match(html, /Kaynaktan birebir alıntı/); assert.match(html, /Adds faster dev server restarts/);
  assert.match(html, /data-testid="ayas-update-approval-nextjs"/); assert.match(html, /Bu güncellemeyi onayla/);
  assert.doesNotMatch(html, /ONAYLA VE UYGULA|YÜRÜT/);
  // Unreadable approval store: no approval state is shown, and no button either.
  const unreadable = render(base);
  assert.match(unreadable, /Onay durumu okunamadı/); assert.doesNotMatch(unreadable, /Bu güncellemeyi onayla/);
  // An approval for exactly this item reads as approved, with a withdraw control only.
  const next = radar.find((item) => item.sourceId === "nextjs")!;
  const approved = render({ ...base, updateApprovals: [{ decisionId: "d1", sourceId: "nextjs", toolName: "Next.js", target: next.target, installedVersion: next.installedVersion,
    targetVersion: next.latestVersion, bump: next.bump, applyChannel: next.applyChannel, itemHash: next.itemHash, approvedAt: NOW, status: "WAITING", currentInstalledVersion: next.installedVersion }] });
  assert.match(approved, /Onaylandı/); assert.match(approved, /Onayı geri al/);
  assert.equal((approved.match(/Bu güncellemeyi onayla/g) ?? []).length, radar.length - 1);
});

fs.rmSync(repo, { recursive: true, force: true });
console.log(JSON.stringify({ status: "PASS", suite: "ayas-update-radar", scenarios: count, modelRuns: 0, networkCalls: 0 }));
