/**
 * Deterministic Stage 10 developer-intelligence evaluation. No network access,
 * no paid provider, no agent dispatch. The only writes are a disposable Git
 * fixture (bare remote + clones) under an OS TEMP directory. Without
 * src/lib/ayas/developer (the 644bc06 baseline) it scores the Stage 7
 * primitives that existed before and records every Stage 10 capability as absent.
 *
 *   npx tsx scripts/smoke-ayas-developer-intelligence.ts [--gate]
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

import { selectAyasAgenticRoute } from "../src/lib/ayas/routing/AyasAgenticRouting";
import { CANONICAL_ISOLATED_SOURCE, PURE_SOURCE, RUNTIME_ROOT_NO_TEMP_SOURCE, SAFETY_SOURCES, SCHEDULED_TASK_SOURCE } from "./fixtures/ayas-developer-intelligence-sources";
import type { AyasRepositorySnapshot, AyasSprintProgress, AyasValidationEvidence, AyasWorkLifecycle } from "../src/lib/ayas/developer/AyasRepositoryRecovery";

type TM = typeof import("../src/lib/ayas/developer/AyasDeveloperTaskModel");
type RC = typeof import("../src/lib/ayas/developer/AyasRepositoryRecovery");
type SK = typeof import("../src/lib/ayas/developer/AyasDeveloperSkillIntelligence");
type TS = typeof import("../src/lib/ayas/developer/AyasDeveloperTestIntelligence");
type RV = typeof import("../src/lib/ayas/developer/AyasDeveloperReviewIntelligence");
type HO = typeof import("../src/lib/ayas/developer/AyasDeveloperHandoff");
type CO = typeof import("../src/lib/ayas/developer/AyasRepositoryStateCollector");

const DEV_DIR = path.resolve("src/lib/ayas/developer");
async function load<T>(name: string): Promise<T | null> {
  const file = path.join(DEV_DIR, `${name}.ts`);
  return fs.existsSync(file) ? await import(pathToFileURL(file).href) as T : null;
}

// ---- fixtures (never valid for the real repository) -------------------------
const BASE = "ba5e".repeat(10); const H1 = "a1".repeat(20); const H2 = "b2".repeat(20); const H3 = "c3".repeat(20); const H9 = "e9".repeat(20);
const NOW = "fixture-state-now"; const OLD = "fixture-state-old";
const SRC = "src/lib/ayas/developer/AyasRepositoryRecovery.ts"; const TEST = "scripts/smoke-ayas-developer-intelligence.ts";
const DOC = "docs/AYAS_DEVELOPER_INTELLIGENCE.md"; const CP = "ATOLYE_CHECKPOINT.md";
const SCOPE = ["src/lib/ayas/developer/", TEST, DOC, CP, "CHANGELOG.md", "ROADMAP.md"];
const F: [string, string[]] = [H2, [SRC, TEST, DOC, CP]]; const C: [string, string[]] = [H3, [CP]];
const LOCAL = ["ayas:authority", "ayas:conversational-intelligence", "ayas:deployment", "ayas:execution-gate", "ayas:frontend", "ayas:production-pipeline", "ayas:router", "ayas:storage", "ayas:tests", "ayas:video-audio"];
const DEFERRED = ["live npm audit needs owner approval for metadata transfer", "seven Graphify PowerShell parser warnings", "semantic description/label pending marker", "Stage 10A Graphify normalization"];

type EntrySpec = [string, string];
function snap(o: { head?: string; upstreamHead?: string | null; remoteHead?: string | null; ahead?: number; behind?: number; dirty?: EntrySpec[]; commits?: [string, string[]][] } = {}): AyasRepositorySnapshot {
  const head = o.head ?? BASE;
  return {
    branch: "wip/stage10", head, upstream: "origin/wip/stage10", upstreamHead: o.upstreamHead === undefined ? head : o.upstreamHead,
    remoteHead: o.remoteHead ?? null, ahead: o.ahead ?? 0, behind: o.behind ?? 0,
    entries: (o.dirty ?? []).map(([xy, p]) => xy === "??" ? { path: p, originalPath: null, index: "?", worktree: "?", kind: "untracked" as const }
      : xy === "!!" ? { path: p, originalPath: null, index: "!", worktree: "!", kind: "ignored" as const }
        : xy === "UU" ? { path: p, originalPath: null, index: "U", worktree: "U", kind: "unmerged" as const }
          : { path: p, originalPath: null, index: xy[0]!, worktree: xy[1]!, kind: "tracked" as const }),
    commitsSinceBaseline: (o.commits ?? []).map(([hash, files]) => ({ hash, subject: "fixture", files })),
  };
}
const V = (id: string, o: { outcome?: AyasValidationEvidence["outcome"]; source?: AyasValidationEvidence["source"]; at?: string | null; rerun?: boolean; critical?: boolean } = {}): AyasValidationEvidence =>
  ({ id, required: true, outcome: o.outcome ?? "PASS", source: o.source ?? "this-session", observedAtState: o.at === undefined ? NOW : o.at, rerunThisSession: o.rerun ?? false, safetyCritical: o.critical ?? false });
const ALL_PASS = [V("typescript"), V("eslint-changed"), V("diff-check"), V("smoke-developer-intelligence")];
function prog(o: { head: string; discovery?: boolean; impl?: boolean | null; v?: AyasValidationEvidence[]; review?: [number, number, number] | null; graph?: "current" | "behind" | "uncovered" | "none" }): AyasSprintProgress {
  const graph = o.graph ?? "current";
  const review = o.review === undefined ? [2, 0, 0] : o.review;
  return {
    discoveryComplete: o.discovery ?? true, implementationComplete: o.impl ?? null, validations: o.v ?? [],
    review: review ? { passesCompleted: review[0], openBlockers: review[1], openMajors: review[2] } : null,
    graphify: graph === "none" ? null : { lastAnalyzedHead: graph === "behind" ? (o.head === H1 ? H9 : H1) : o.head, stale: false, coversWorktree: graph !== "uncovered" },
    currentState: NOW,
  };
}

// ---- flow cases -------------------------------------------------------------
type Expect = {
  kind?: string; mutating?: boolean; local?: boolean; mode?: string; gate?: string; readiness?: string; lifecycle?: Partial<AyasWorkLifecycle>;
  drift?: string[]; reusable?: string[]; recheck?: string[]; reasons?: string[]; skills?: Record<string, string>; selectedSkills?: string[];
  agent?: string; delivery?: string; includes?: string[]; excludes?: string[];
};
type FlowCase = { id: string; label: string; text: string; heldOut?: boolean; snapshot?: AyasRepositorySnapshot; progress?: AyasSprintProgress; scope?: string[]; host?: "claude" | "codex" | null; registered?: string[]; unavailableAgents?: string[]; done?: string[]; expect: Expect };
const RUNTIME_PATHS = "src/lib/runtime/RuntimeStoragePaths.ts";
const APPROVAL = "src/lib/brain/autonomy/AyasProposalApprovalService.ts";
const PANEL = "src/components/brain/AyasDevelopmentCenter.tsx";
const unpushed = () => snap({ head: H2, upstreamHead: BASE, ahead: 1, commits: [F] });
const closed = (extra: EntrySpec[] = []) => snap({ head: H3, remoteHead: H3, commits: [C, F], dirty: extra });

const flows: FlowCase[] = [
  { id: "clean-feature", label: "1 clean feature", text: "Handoff paketine paket boyutu ölçümü özelliği ekle", progress: prog({ head: BASE }),
    expect: { kind: "feature", mutating: true, mode: "CLEAN_START", gate: "IMPLEMENTATION", readiness: "NOT_READY", agent: "any-developer-agent", delivery: "MANUAL_OWNER_PASTE",
      skills: { graphify: "REQUIRED", "ayas:tests": "INSTALLED_BUT_NOT_REGISTERED", "ayas:storage": "NOT_NEEDED", "ayas:frontend": "NOT_NEEDED" }, includes: ["AYAS did not dispatch", "DO NOT RUN scripts/smoke-ayas-observer-autostart.ts"] } },
  { id: "bug-fix", label: "2 bug fix", text: "Push hazırlık kararındaki hatayı düzelt", snapshot: snap({ dirty: [[".M", SRC]] }), progress: prog({ head: BASE, impl: false }),
    expect: { kind: "bug-fix", mode: "RESUME_UNCOMMITTED", gate: "IMPLEMENTATION", skills: { graphify: "REQUIRED", "ayas:tests": "INSTALLED_BUT_NOT_REGISTERED", "code-review": "HELPFUL", "security-review": "NOT_NEEDED" } } },
  { id: "read-only-investigation", label: "3 read-only investigation", text: "Recovery modülü push hazırlığını nasıl hesaplıyor?",
    expect: { kind: "investigation", mutating: false, local: true, agent: "local-tool", delivery: "LOCAL_READ_ONLY_TOOLS", skills: { graphify: "REQUIRED", "ayas:tests": "NOT_NEEDED" }, includes: ["Read-only task"] } },
  { id: "architecture-review", label: "4 architecture review", text: "Developer intelligence katmanının mimarisini gözden geçir, bağımlılık risklerini raporla",
    expect: { kind: "architecture-review", mutating: false, local: false, agent: "any-developer-agent", delivery: "MANUAL_OWNER_PASTE", skills: { graphify: "REQUIRED", "code-review": "NOT_NEEDED" }, includes: ["analysis packet"] } },
  { id: "security-fix", label: "5 security fix", text: "Handoff metnindeki gizli anahtar sızıntısını kapat, güvenlik düzeltmesi yap",
    snapshot: snap({ dirty: [[".M", "src/lib/ayas/developer/AyasDeveloperHandoff.ts"]] }), progress: prog({ head: BASE, impl: false }),
    expect: { kind: "security-fix", mode: "RESUME_UNCOMMITTED", agent: "any-developer-agent", skills: { "security-review": "REQUIRED", "code-review": "HELPFUL", "ayas:frontend": "NOT_NEEDED" }, includes: ["injection: ", "secrets: "] } },
  { id: "dirty-continuation", label: "6 dirty worktree continuation", text: "Yarım kalan Stage 10 işini sürdür", snapshot: snap({ dirty: [[".M", SRC], ["??", TEST]] }),
    progress: prog({ head: BASE, v: ALL_PASS, review: null }), done: ["recovery engine implemented", "typescript and eslint passed"],
    expect: { kind: "recovery-continuation", mode: "RESUME_UNCOMMITTED", gate: "REVIEW", readiness: "NOT_READY", lifecycle: { implemented: true, committed: false, pushEvidence: "NONE", verified: true }, includes: ["do NOT redo", "REVIEW:"] } },
  { id: "local-commit-unpushed", label: "7 local commit not pushed", text: "Yerel commit alındı fakat yayına gitmedi; güvenle sürdür", snapshot: unpushed(), progress: prog({ head: H2, v: ALL_PASS }),
    expect: { mode: "RESUME_COMMITTED_UNPUSHED", gate: "PUSH", readiness: "READY_TO_PUSH", lifecycle: { committed: true, pushed: false }, agent: "any-developer-agent" } },
  { id: "pushed-docs-dirty", label: "8 code pushed + docs dirty", text: "Kod push edildi, kapanış dokümantasyonu yarım kaldı",
    snapshot: snap({ head: H2, remoteHead: H2, commits: [F], dirty: [[".M", CP]] }), progress: prog({ head: H2, v: ALL_PASS }),
    expect: { kind: "recovery-continuation", mode: "RESUME_CLOSURE_IN_PROGRESS", gate: "STAGE", readiness: "READY_TO_STAGE", lifecycle: { committed: true, pushed: true, pushEvidence: "REAL_REMOTE", documented: false },
      excludes: ["→ REVIEW", "→ CLOSURE →"] } },
  { id: "scope-drift-config", label: "9 unexpected file scope drift", text: "Stage 10 uygulamasını sürdür", snapshot: snap({ dirty: [[".M", SRC], [".M", "next.config.ts"]] }), progress: prog({ head: BASE, v: ALL_PASS }),
    expect: { mode: "STOP_SCOPE_DRIFT", gate: "SCOPE_REVIEW", readiness: "NOT_READY", drift: ["next.config.ts"], agent: "none", delivery: "OWNER_DECISION_REQUIRED", includes: ["SCOPE DRIFT"] } },
  { id: "untracked-expected-test", label: "10 untracked expected test", text: "Stage 10 değişikliklerini sürdür", snapshot: snap({ dirty: [[".M", SRC], ["??", TEST], ["??", DOC]] }), progress: prog({ head: BASE, v: ALL_PASS }),
    expect: { mode: "RESUME_UNCOMMITTED", gate: "STAGE", readiness: "READY_TO_STAGE", drift: [], includes: ["git add -- ", TEST] } },
  { id: "unrelated-untracked", label: "11 unrelated untracked file", text: "Stage 10 değişikliklerini sürdür", snapshot: snap({ dirty: [[".M", SRC], ["??", "notes/scratch-ideas.txt"]] }), progress: prog({ head: BASE, v: ALL_PASS }),
    expect: { mode: "STOP_SCOPE_DRIFT", drift: ["notes/scratch-ideas.txt"], agent: "none" } },
  { id: "staged-unrelated", label: "12 staged unrelated file", text: "Stage 10 değişikliklerini sürdür", snapshot: snap({ dirty: [["M.", SRC], ["M.", "src/lib/production/ProductionAcceptancePolicy.ts"]] }), progress: prog({ head: BASE, v: ALL_PASS }),
    expect: { mode: "STOP_SCOPE_DRIFT", gate: "SCOPE_REVIEW", drift: ["src/lib/production/ProductionAcceptancePolicy.ts"], reasons: ["STAGED_SCOPE_DRIFT"], includes: ["Do not stage, revert or delete"] } },
  { id: "graphify-stale", label: "17 Graphify stale", text: "Graphify grafiği güncel mi?", snapshot: snap({ dirty: [[".M", SRC]] }), progress: prog({ head: BASE, v: ALL_PASS, graph: "behind" }),
    expect: { kind: "investigation", local: true, gate: "GRAPHIFY_REFRESH", agent: "local-tool", includes: ["(behind HEAD)"] } },
  { id: "graphify-current", label: "18 Graphify current", text: "Graphify analizi HEAD ile eşleşiyor mu?", snapshot: closed(), progress: prog({ head: H3 }),
    expect: { local: true, gate: "CLOSED", readiness: "FULLY_CLOSED", lifecycle: { verified: false }, reasons: ["CLOSED_WITHOUT_ACCEPTED_VALIDATION_EVIDENCE"], includes: ["(== HEAD)"] } },
  { id: "skill-registered-codex", label: "19 relevant skill available", text: "RuntimeStoragePaths kök çözümleme hatasını düzelt", scope: [RUNTIME_PATHS],
    snapshot: snap({ dirty: [[".M", RUNTIME_PATHS]] }), progress: prog({ head: BASE, impl: false }), host: "codex", registered: ["review-agent"],
    expect: { kind: "bug-fix", skills: { "review-agent": "HELPFUL", "ayas:storage": "INSTALLED_BUT_NOT_REGISTERED", graphify: "UNAVAILABLE", "ayas:frontend": "NOT_NEEDED" },
      selectedSkills: ["ayas:storage", "ayas:tests", "review-agent"], includes: ["read .claude/skills/ayas/storage/SKILL.md directly"] } },
  { id: "skill-local-unregistered", label: "20 relevant skill unregistered but local", text: "Gelişim Merkezi panelindeki buton metnini düzelt", scope: [PANEL],
    snapshot: snap({ dirty: [[".M", PANEL]] }), progress: prog({ head: BASE, impl: false }),
    expect: { skills: { "ayas:frontend": "INSTALLED_BUT_NOT_REGISTERED", "ui-ux-pro-max": "UNAVAILABLE", "ayas:storage": "NOT_NEEDED" } } },
  { id: "irrelevant-skill-present", label: "21 irrelevant skill present", text: "RuntimeStoragePaths kök çözümleme hatasını düzelt", scope: [RUNTIME_PATHS],
    snapshot: snap({ dirty: [[".M", RUNTIME_PATHS]] }), progress: prog({ head: BASE, impl: false }), registered: ["graphify", "code-review", "security-review", "ui-ux-pro-max", "karpathy-guidelines"],
    expect: { skills: { "ui-ux-pro-max": "NOT_NEEDED", "karpathy-guidelines": "NOT_NEEDED", "security-review": "NOT_NEEDED", "ayas:storage": "INSTALLED_BUT_NOT_REGISTERED" },
      selectedSkills: ["ayas:storage", "ayas:tests", "code-review", "graphify"] } },
  { id: "agents-unavailable", label: "22 Claude/Codex unavailable", text: "Claude ve Codex limitleri doldu; Stage 10 işini sürdür", snapshot: snap({ dirty: [[".M", SRC]] }), progress: prog({ head: BASE }),
    expect: { agent: "none", delivery: "WAIT_FOR_AGENT_AVAILABILITY", gate: "VALIDATION", includes: ["FIRST OPEN GATE", "No validation evidence is recorded"] } },
  { id: "rename-from-outside", label: "rename source outside scope", text: "Stage 10 değişikliklerini sürdür", progress: prog({ head: BASE, v: ALL_PASS }),
    snapshot: { ...snap(), entries: [{ path: "src/lib/ayas/developer/Moved.ts", originalPath: "src/lib/production/ProductionAcceptancePolicy.ts", index: "R", worktree: ".", kind: "tracked" }] },
    expect: { mode: "STOP_SCOPE_DRIFT", drift: ["src/lib/production/ProductionAcceptancePolicy.ts"] } },
  { id: "behind-dirty", label: "behind remote with local changes", text: "Stage 10 işini sürdür", snapshot: snap({ behind: 1, dirty: [[".M", SRC]] }), progress: prog({ head: BASE }),
    expect: { mode: "SYNC_REQUIRED", gate: "SYNC", agent: "none", delivery: "OWNER_DECISION_REQUIRED", reasons: ["DIRTY_WHILE_BEHIND_OWNER_DECISION"], includes: ["STOP: behind the remote with local changes"], excludes: ["git pull --ff-only"] } },
  { id: "manual-handoff-named", label: "23 manual handoff required", text: "Codex bu implementasyonu bitirsin", snapshot: snap({ dirty: [[".M", SRC]] }), progress: prog({ head: BASE, impl: false }),
    expect: { kind: "feature", agent: "codex", delivery: "MANUAL_OWNER_PASTE", includes: ["AYAS did not dispatch"] } },
  { id: "owner-approval-authority", label: "25 owner approval required", text: "Onay servisinde hash bağlamasını güçlendir", scope: [APPROVAL],
    snapshot: snap({ dirty: [[".M", APPROVAL]] }), progress: prog({ head: BASE, impl: false }),
    expect: { mutating: true, skills: { "ayas:authority": "INSTALLED_BUT_NOT_REGISTERED", "ayas:execution-gate": "INSTALLED_BUT_NOT_REGISTERED" },
      includes: ["owner approval and the execution gate stay external", "approval-binding: ", "scripts/smoke-ayas-proposal-approval-service.ts"] } },
  { id: "commit-ready", label: "26 commit ready", text: "Stage 10 değişikliklerini sürdür", snapshot: snap({ dirty: [["M.", SRC], ["A.", TEST], ["A.", DOC]] }), progress: prog({ head: BASE, v: ALL_PASS }),
    expect: { gate: "COMMIT", readiness: "READY_TO_COMMIT" } },
  { id: "push-ready-closure-local", label: "27 push ready (docs commit local)", text: "Kapanış commit'i yerelde, push engellendi; sürdür",
    snapshot: snap({ head: H3, upstreamHead: H2, ahead: 1, commits: [C, F] }), progress: prog({ head: H3, v: ALL_PASS }),
    expect: { gate: "PUSH", readiness: "READY_TO_PUSH", lifecycle: { documented: true, pushed: false } } },
  { id: "closure-ready", label: "28 closure ready", text: "Stage 10 kapanışını sürdür", snapshot: snap({ head: H2, remoteHead: H2, commits: [F] }), progress: prog({ head: H2, v: ALL_PASS }),
    expect: { gate: "CLOSURE", readiness: "PUSHED_NEEDS_CLOSURE", lifecycle: { pushed: true, documented: false } } },
  { id: "claude-stopped-discovery", label: "Claude stops mid-discovery", text: "Claude oturumu keşif sırasında kesildi, Codex devralsın", progress: prog({ head: BASE, discovery: false }),
    expect: { mode: "CLEAN_START", gate: "DISCOVERY", agent: "codex" } },
  { id: "codex-stopped-before-commit", label: "Codex stops before commit", text: "Codex implementasyondan sonra durdu, işi sürdür", snapshot: snap({ dirty: [[".M", SRC], ["??", TEST]] }),
    progress: prog({ head: BASE, v: [V("typescript", { outcome: "NOT_RUN" }), V("smoke-developer-intelligence", { outcome: "NOT_RUN" })] }),
    expect: { gate: "VALIDATION", recheck: ["smoke-developer-intelligence", "typescript"] } },
  { id: "remote-moved", label: "remote updated while local clean", text: "Stage 10 işini sürdür", snapshot: snap({ head: H2, remoteHead: H9, commits: [F] }), progress: prog({ head: H2, v: ALL_PASS }),
    expect: { mode: "SYNC_REQUIRED", gate: "SYNC", agent: "any-developer-agent", reasons: ["REAL_REMOTE_MOVED_FETCH_REQUIRED"], includes: ["git pull --ff-only", "regenerate this packet"], excludes: ["→ IMPLEMENTATION", "IMPLEMENTATION →"] } },
  { id: "staged-then-edited", label: "staged file edited again (MM)", text: "Stage 10 değişikliklerini sürdür", snapshot: snap({ dirty: [["MM", SRC], ["A.", TEST], ["A.", DOC]] }), progress: prog({ head: BASE, v: ALL_PASS }),
    expect: { gate: "STAGE", readiness: "READY_TO_STAGE", reasons: ["UNSTAGED_CHANGES_AFTER_STAGE"] } },
  { id: "daemon-ignored", label: "daemon ignored files changed", text: "Stage 10 durumunu doğrula ve kapanışı sürdür", snapshot: closed([["!!", "data/brain/autonomy/daemon-state.json"]]), progress: prog({ head: H3, v: ALL_PASS }),
    expect: { mode: "CLOSED", gate: "CLOSED", readiness: "FULLY_CLOSED", agent: "none", delivery: "NO_AGENT_NEEDED", includes: ["Daemon-owned ignored changes"] } },
  { id: "diverged", label: "local ahead and behind", text: "Stage 10 işini sürdür", snapshot: snap({ head: H2, upstreamHead: H1, ahead: 1, behind: 2, commits: [F] }), progress: prog({ head: H2 }),
    expect: { mode: "DIVERGED", gate: "SYNC", agent: "none", includes: ["no rebase, reset or force push"] } },
  { id: "unmerged", label: "unmerged conflict", text: "Stage 10 işini sürdür", snapshot: snap({ dirty: [["UU", SRC]] }), expect: { mode: "STOP_UNKNOWN_STATE", readiness: "NOT_READY", agent: "none" } },
  { id: "token-after-tests", label: "token limit after tests", text: "Token limiti doldu, testlerden sonra kaldık; sürdür", snapshot: snap({ dirty: [[".M", SRC], ["??", TEST]] }),
    progress: prog({ head: BASE, v: [V("typescript", { source: "previous-agent" }), V("smoke-developer-intelligence", { source: "previous-agent" }), V("authority-regression", { source: "previous-agent", critical: true })] }),
    expect: { gate: "VALIDATION", reusable: ["smoke-developer-intelligence", "typescript"], recheck: ["authority-regression"], lifecycle: { verified: false }, includes: ["must recheck: authority-regression"] } },
  { id: "token-after-commit", label: "token limit after commit", text: "Stage 10 işini sürdür", snapshot: unpushed(), progress: prog({ head: H2, v: ALL_PASS, graph: "behind" }),
    expect: { mode: "RESUME_COMMITTED_UNPUSHED", gate: "POST_COMMIT_GRAPHIFY", readiness: "NOT_READY" } },
  { id: "stale-evidence", label: "evidence from another state", text: "Stage 10 işini sürdür", snapshot: snap({ dirty: [[".M", SRC]] }), progress: prog({ head: BASE, v: [V("typescript", { at: OLD }), V("eslint-changed")] }),
    expect: { gate: "VALIDATION", recheck: ["typescript"] } },
  { id: "timeout-evidence", label: "timeout is not pass", text: "Stage 10 işini sürdür", snapshot: snap({ dirty: [[".M", SRC]] }), progress: prog({ head: BASE, v: [V("smoke-developer-intelligence", { outcome: "TIMEOUT" }), V("typescript")] }),
    expect: { gate: "VALIDATION", recheck: ["smoke-developer-intelligence"], lifecycle: { verified: false } } },
  { id: "committed-scope-drift", label: "committed out-of-scope file", text: "Stage 10 işini sürdür", snapshot: snap({ head: H2, upstreamHead: BASE, ahead: 1, commits: [[H2, [SRC, "next.config.ts"]]] }), progress: prog({ head: H2, v: ALL_PASS }),
    expect: { mode: "STOP_SCOPE_DRIFT", drift: ["next.config.ts"], reasons: ["COMMITTED_SCOPE_DRIFT"] } },
  { id: "private-local", label: "private content, no external agent", text: "Bu değişikliği gizli tut, dışarı gönderme; recovery hatasını düzelt", snapshot: snap({ dirty: [[".M", SRC]] }), progress: prog({ head: BASE, impl: false }),
    expect: { agent: "none", delivery: "OWNER_DECISION_REQUIRED" } },
  { id: "docs-only", label: "docs-only change", text: "CHANGELOG girdisini güncelle", scope: ["CHANGELOG.md"], snapshot: snap({ dirty: [[".M", "CHANGELOG.md"]] }), progress: prog({ head: BASE }),
    expect: { kind: "documentation", gate: "STAGE", skills: { "ayas:tests": "NOT_NEEDED", graphify: "NOT_NEEDED" }, excludes: ["## TESTS"], includes: ["factual-claims"] } },
  // Held-out: reserved paraphrases and novel combinations, not used to tune production rules.
  { id: "heldout-devam", label: "held-out devam et", heldOut: true, text: "devam et", snapshot: snap({ dirty: [[".M", SRC], ["??", TEST]] }), progress: prog({ head: BASE, v: ALL_PASS }),
    expect: { kind: "recovery-continuation", gate: "DOCUMENTATION", agent: "any-developer-agent" } },
  { id: "heldout-kaldigi", label: "held-out kaldığı yerden", heldOut: true, text: "kaldığı yerden", snapshot: unpushed(), progress: prog({ head: H2, v: ALL_PASS }),
    expect: { kind: "recovery-continuation", gate: "PUSH" } },
  { id: "heldout-commit-not-pushed", label: "held-out commit oldu ama push olmadı", heldOut: true, text: "commit oldu ama push olmadı", snapshot: unpushed(), progress: prog({ head: H2, v: ALL_PASS }),
    expect: { kind: "recovery-continuation", gate: "PUSH", readiness: "READY_TO_PUSH", lifecycle: { committed: true, pushed: false } } },
  { id: "heldout-graphify", label: "held-out Graphify işlendi mi?", heldOut: true, text: "Graphify işlendi mi?", snapshot: closed(), progress: prog({ head: H3 }),
    expect: { kind: "investigation", local: true, agent: "local-tool", gate: "CLOSED" } },
  { id: "heldout-file-changed", label: "held-out bir dosya farklı değişmiş", heldOut: true, text: "bir dosya farklı değişmiş",
    snapshot: snap({ dirty: [[".M", SRC], [".M", "src/lib/production/ProductionReadinessService.ts"]] }), progress: prog({ head: BASE, v: ALL_PASS }),
    expect: { kind: "investigation", local: true, mode: "STOP_SCOPE_DRIFT", drift: ["src/lib/production/ProductionReadinessService.ts"], agent: "local-tool" } },
  { id: "heldout-permission", label: "held-out test permission", heldOut: true, text: "test permission yüzünden çalışmadı",
    expect: { kind: "investigation", local: true, agent: "local-tool" } },
  { id: "heldout-codex-claude", label: "held-out Codex token bitti, Claude devam etsin", heldOut: true, text: "Codex token bitti, Claude devam etsin",
    snapshot: snap({ dirty: [[".M", SRC]] }), progress: prog({ head: BASE, v: ALL_PASS, review: null }),
    expect: { kind: "recovery-continuation", agent: "claude", delivery: "MANUAL_OWNER_PASTE", gate: "REVIEW" } },
  { id: "heldout-claude-codex-push", label: "held-out Claude limit, Codex push check", heldOut: true, text: "Claude'un limiti doldu; Codex kaldığı yerden devralsın, önce push durumunu doğrula",
    snapshot: unpushed(), progress: prog({ head: H2, v: ALL_PASS }), expect: { agent: "codex", gate: "PUSH" } },
  { id: "heldout-security-timeout", label: "held-out security patch + timeout", heldOut: true, text: "Güvenlik yamasını yarıda bıraktık, testler zaman aşımına uğradı",
    snapshot: snap({ dirty: [[".M", SRC]] }), progress: prog({ head: BASE, v: [V("smoke-developer-intelligence", { outcome: "TIMEOUT" })] }),
    expect: { kind: "recovery-continuation", gate: "VALIDATION", recheck: ["smoke-developer-intelligence"] } },
  { id: "heldout-closure-written", label: "held-out closure written not committed", heldOut: true, text: "Kapanış belgesi yazıldı ama henüz commitlenmedi",
    snapshot: snap({ head: H2, remoteHead: H2, commits: [F], dirty: [[".M", CP]] }), progress: prog({ head: H2, v: ALL_PASS }),
    expect: { kind: "recovery-continuation", gate: "STAGE", readiness: "READY_TO_STAGE" } },
];

// Fixture test index: real classifier over synthetic sources.
const PURE_SRC = PURE_SOURCE; const CANON_SAFE = CANONICAL_ISOLATED_SOURCE;
const indexSources: [string, string[], string][] = [
  [TEST, ["src/lib/ayas/developer/AyasRepositoryRecovery", "src/lib/ayas/developer/AyasDeveloperHandoff"], PURE_SRC],
  ["scripts/smoke-ayas-observer-autostart.ts", ["src/lib/brain/autonomy/AyasObserverAutostart"], SCHEDULED_TASK_SOURCE],
  ["scripts/smoke-ayas-execution-gate.ts", ["src/lib/ayas/execution/AyasExecutionGate"], CANON_SAFE],
  ["scripts/smoke-ayas-autonomous-execution-gate.ts", ["src/lib/brain/autonomy/AyasAutonomousExecutionGate"], CANON_SAFE],
  ["scripts/smoke-ayas-proposal-approval-service.ts", [APPROVAL.replace(/\.ts$/, "")], CANON_SAFE],
  ["scripts/smoke-ayas-isolated-gate-root.ts", ["src/lib/ayas/execution/AyasExecutionGateStore"], CANON_SAFE],
  ["scripts/smoke-runtime-storage-paths.ts", [RUNTIME_PATHS.replace(/\.ts$/, "")], RUNTIME_ROOT_NO_TEMP_SOURCE],
];

type Actual = Partial<Record<keyof Expect, unknown>> & { packetText?: string; packetChars?: number };

async function main() {
  const tm = await load<TM>("AyasDeveloperTaskModel"); const rc = await load<RC>("AyasRepositoryRecovery"); const sk = await load<SK>("AyasDeveloperSkillIntelligence");
  const ts = await load<TS>("AyasDeveloperTestIntelligence"); const rv = await load<RV>("AyasDeveloperReviewIntelligence"); const ho = await load<HO>("AyasDeveloperHandoff");
  const co = await load<CO>("AyasRepositoryStateCollector");
  const final = Boolean(tm && rc && sk && ts && rv && ho && co);
  const index = final ? indexSources.map(([scriptPath, importedModules, source]) => ({ scriptPath, importedModules, safety: ts!.classifyAyasTestSafety(ts!.extractAyasTestSourceFacts(scriptPath, source)) })) : [];

  function analyze(c: FlowCase): Actual {
    const snapshot = c.snapshot ?? snap();
    const progress = c.progress ?? prog({ head: snapshot.head ?? BASE });
    const changed = [...new Set([...snapshot.entries.filter((e) => e.kind !== "ignored").map((e) => e.path), ...snapshot.commitsSinceBaseline.flatMap((x) => x.files)])];
    if (!final) {
      // Stage 7 primitives only: task class, mutation hint, registered-skill and agent selection.
      const stage7Skill: Record<string, string> = { "ayas-tests": "ayas:tests", "ayas-conversational-intelligence": "ayas:conversational-intelligence", "ayas-router": "ayas:router", graphify: "graphify" };
      const registered = (c.registered ?? ["graphify", "code-review", "security-review"]).map((id) => Object.entries(stage7Skill).find(([, v]) => v === id)?.[0] ?? id);
      const route = selectAyasAgenticRoute({ text: c.text, availableModelIds: ["ollama"], availableSkillIds: registered, availableAgentIds: [] });
      return {
        kind: route.requirement.taskClass === "coding" && route.requirement.mutation ? "feature" : "investigation",
        mutating: route.requirement.mutation,
        selectedSkills: route.selectedSkillId ? [stage7Skill[route.selectedSkillId] ?? route.selectedSkillId] : [],
        agent: route.selectedAgentId === "local-ayas" ? "local-tool" : route.selectedAgentId,
      };
    }
    const scope = c.scope ?? SCOPE;
    const task = tm!.describeAyasDeveloperTask({ text: c.text, changedPaths: changed });
    const recovery = rc!.recoverAyasRepositoryState(snapshot, { trustedBaseline: BASE, expectedScope: scope }, progress);
    const skills = sk!.selectAyasDeveloperSkills(task, { host: c.host === undefined ? "claude" : c.host, registeredSkillIds: c.registered ?? ["graphify", "code-review", "security-review"], localSkillIds: LOCAL }, recovery.firstUnfinishedGate);
    const tests = task.requiresTests ? ts!.planAyasTestStrategy({ task, changedFiles: changed, graphAffectedFiles: [], index }) : null;
    const review = task.mutating || task.kind === "code-review" || task.kind === "architecture-review" ? rv!.planAyasReview(task, changed) : null;
    const plan = tm!.planAyasDeveloperChange(task, { current: true, targetSymbols: [], candidateFiles: changed, affectedFiles: [] });
    const agent = ho!.selectAyasDeveloperAgent(task, recovery, { unavailableAgentIds: c.unavailableAgents ?? [], dispatchAdapterIds: [] });
    const packet = ho!.compileAyasTaskPacket({ mission: c.text, task, recovery, agent, skills, tests, plan, review, expectedScope: scope, graphify: progress.graphify, knownDeferred: DEFERRED, doneItems: c.done ?? [], acceptance: [] });
    return {
      kind: task.kind, mutating: task.mutating, local: task.handledLocally, mode: recovery.mode, gate: recovery.firstUnfinishedGate, readiness: recovery.readiness,
      lifecycle: recovery.lifecycle, drift: [...recovery.scopeDrift, ...recovery.committedOutOfScope].sort(), reusable: [...recovery.reusableRecordedEvidence].sort(),
      recheck: [...recovery.mustRecheckEvidence, ...recovery.failedEvidence].sort(), reasons: recovery.reasonCodes,
      skills: Object.fromEntries(skills.decisions.map((d) => [d.skillId, d.status])), selectedSkills: skills.selected.map((d) => d.skillId).sort(),
      agent: agent.target, delivery: agent.delivery, packetText: packet.text, packetChars: packet.sizeChars,
    };
  }

  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  function checkField(field: keyof Expect, actual: Actual, expected: Expect): boolean {
    const a = actual[field]; const e = expected[field];
    switch (field) {
      case "lifecycle": return Object.entries(e as object).every(([k, v]) => (a as Record<string, unknown> | undefined)?.[k] === v);
      case "skills": return Object.entries(e as object).every(([k, v]) => (a as Record<string, unknown> | undefined)?.[k] === v);
      case "drift": case "reusable": case "recheck": case "selectedSkills": return Array.isArray(a) && same([...a].sort(), [...(e as string[])].sort());
      case "reasons": return Array.isArray(a) && (e as string[]).every((r) => (a as string[]).includes(r));
      case "includes": return typeof actual.packetText === "string" && (e as string[]).every((s) => actual.packetText!.includes(s));
      case "excludes": return typeof actual.packetText === "string" && (e as string[]).every((s) => !actual.packetText!.includes(s));
      default: return a === e;
    }
  }
  const DIM: Record<keyof Expect, string> = {
    kind: "taskModel", mutating: "taskModel", local: "taskModel", mode: "recovery", gate: "recovery", readiness: "gitState", lifecycle: "gitState",
    drift: "scope", reusable: "evidenceTrust", recheck: "evidenceTrust", reasons: "recovery", skills: "skillStatus", selectedSkills: "skillSelection",
    agent: "agentChoice", delivery: "agentChoice", includes: "packet", excludes: "packet",
  };
  const dims: Record<string, [number, number]> = {};
  const misses: { id: string; fields: string[]; actual: Record<string, unknown> }[] = [];
  let flowPass = 0; let heldPass = 0; let heldTotal = 0;
  let skillTp = 0; let skillFp = 0; let skillFn = 0; let irrelevantSelected = 0;
  const packetSizes: { id: string; chars: number; readOnly: boolean }[] = [];
  for (const c of flows) {
    const actual = analyze(c);
    const failed: string[] = [];
    for (const field of Object.keys(c.expect) as (keyof Expect)[]) {
      const ok = checkField(field, actual, c.expect);
      const d = (dims[DIM[field]] ??= [0, 0]); d[1] += 1; if (ok) d[0] += 1; else failed.push(field);
    }
    if (failed.length === 0) { if (c.heldOut) heldPass++; else flowPass++; }
    else misses.push({ id: c.id, fields: failed, actual: Object.fromEntries(failed.map((f) => [f, f === "includes" || f === "excludes" ? "(packet)" : actual[f as keyof Expect]])) });
    if (c.heldOut) heldTotal++;
    if (c.expect.skills) {
      const expectedSelected = Object.entries(c.expect.skills).filter(([, s]) => s !== "NOT_NEEDED" && s !== "UNAVAILABLE").map(([id]) => id);
      const notNeeded = Object.entries(c.expect.skills).filter(([, s]) => s === "NOT_NEEDED").map(([id]) => id);
      const selected = (actual.selectedSkills as string[] | undefined) ?? [];
      for (const id of expectedSelected) if (selected.includes(id)) skillTp++; else skillFn++;
      for (const id of notNeeded) if (selected.includes(id)) { skillFp++; irrelevantSelected++; }
    }
    if (actual.packetChars !== undefined) packetSizes.push({ id: c.id, chars: actual.packetChars, readOnly: actual.mutating === false });
  }
  const mainTotal = flows.filter((c) => !c.heldOut).length;

  // ---- component suites --------------------------------------------------------
  const comp: Record<string, [number, number]> = {}; const compMiss: string[] = []; let compHeldPass = 0; let compHeldTotal = 0;
  function component(group: string, id: string, run: () => boolean, heldOut = false) {
    let ok = false;
    if (final) { try { ok = run(); } catch (error) { ok = false; compMiss.push(`${id}: ${error instanceof Error ? error.message : String(error)}`); } }
    if (heldOut) { compHeldTotal++; if (ok) compHeldPass++; return; }
    const g = (comp[group] ??= [0, 0]); g[1] += 1; if (ok) g[0] += 1; else if (final) compMiss.push(id);
  }
  const tri = (o: Partial<Parameters<TS["triageAyasFailure"]>[0]>) => ts!.triageAyasFailure({ exitCode: 1, timedOut: false, output: "", changedFiles: [SRC], ...o });
  component("triage", "13 pre-existing failing test", () => tri({ output: "AssertionError [ERR_ASSERTION]: Expected values to be strictly equal", errorKind: "assertion", baseline: "FAIL_SAME" }).failureClass === "PRE_EXISTING");
  component("triage", "14 environmental failure", () => tri({ output: "Error: spawn ffprobe ENOENT" }).failureClass === "ENVIRONMENTAL_FAILURE");
  component("triage", "15 permission (.git/worktrees)", () => tri({ output: "fatal: Unable to create 'C:/repo/.git/worktrees/x/index.lock': Permission denied" }).failureClass === "PERMISSION_FAILURE");
  component("triage", "approval rejection", () => tri({ output: "Command rejected by automatic approval review: would export package metadata" }).failureClass === "PERMISSION_FAILURE");
  component("triage", "timeout != pass", () => { const r = tri({ timedOut: true, exitCode: null }); return r.failureClass === "TIMEOUT" && r.countsAsPass === false; });
  component("triage", "product regression", () => tri({ output: "AssertionError: gate mismatch", errorKind: "assertion", baseline: "PASS" }).failureClass === "PRODUCT_REGRESSION");
  component("triage", "fixture defect (line-387 style)", () => { const r = tri({ output: "TypeError: Cannot read properties of undefined (reading 'state') at scripts/smoke-x.ts:387", errorKind: "exception", failureFrameInTest: true, baseline: "FAIL_SAME" }); return r.failureClass === "FIXTURE_DEFECT" && r.preExisting; });
  component("triage", "test defect", () => tri({ output: "AssertionError: expected 3", errorKind: "assertion", baseline: "PASS", changedFiles: [TEST] }).failureClass === "TEST_DEFECT");
  component("triage", "graphify parser warning pre-existing", () => tri({ output: "[graphify] no tree-sitter parser for scripts/setup.ps1" }).failureClass === "PRE_EXISTING");
  // Verbatim shape of the real warning observed during this sprint's Graphify refresh.
  component("triage", "real graphify powershell warning", () => tri({ output: "[graphify watch] AST extraction failed for 7 file(s): C:\\repo\\scripts\\ayas-access-daemon.ps1: tree-sitter-powershell not available" }).reasonCode === "GRAPHIFY_POWERSHELL_PARSER_WARNING");
  component("triage", "unknown needs baseline", () => tri({ output: "AssertionError: x", errorKind: "assertion" }).reasonCode === "BASELINE_COMPARISON_REQUIRED");
  component("triage", "held-out EPERM rename", () => tri({ output: "EPERM: operation not permitted, rename 'C:\\Temp\\a' -> 'C:\\Temp\\b'" }).failureClass === "PERMISSION_FAILURE", true);
  component("triage", "held-out ffmpeg not recognized", () => tri({ output: "'ffmpeg' is not recognized as an internal or external command" }).failureClass === "ENVIRONMENTAL_FAILURE", true);

  const safety = (p: string, s: string) => ts!.classifyAyasTestSafety(ts!.extractAyasTestSourceFacts(p, s));
  component("testSafety", "16 known unsafe smoke", () => safety("scripts/smoke-ayas-observer-autostart.ts", "const x = 1;").safety === "UNSAFE_KNOWN");
  component("testSafety", "pure read-only", () => safety("scripts/smoke-p.ts", PURE_SRC).safety === "SAFE_READ_ONLY");
  const S = SAFETY_SOURCES;
  component("testSafety", "canonical keeps legacy live", () => { const v = safety("scripts/smoke-c.ts", S.canonicalLegacyLive); return v.safety === "REQUIRES_TEMP_ROOT" && v.roots.legacy === "LIVE_POSSIBLE" && v.roots.runtime === "TEMP"; });
  component("testSafety", "canonical + workspace root", () => safety("scripts/smoke-c.ts", CANON_SAFE).safety === "SAFE_ISOLATED");
  component("testSafety", "24 writes without temp = unknown", () => { const v = safety("scripts/smoke-w.ts", S.writesWithoutTemp); return v.safety === "UNKNOWN" && !v.autoRunAllowed; });
  component("testSafety", "ProjectWriter without roots", () => safety("scripts/smoke-pw.ts", S.projectWriterNoRoots).safety === "REQUIRES_TEMP_ROOT");
  component("testSafety", "external network", () => safety("scripts/smoke-n.ts", S.externalNetwork).safety === "REQUIRES_OWNER_APPROVAL");
  component("testSafety", "paid provider", () => safety("scripts/smoke-k.ts", S.paidProvider).safety === "REQUIRES_OWNER_APPROVAL");
  component("testSafety", "brain store live", () => safety("scripts/smoke-b.ts", S.brainStoreLive).roots.brain === "LIVE_POSSIBLE");
  component("testSafety", "brain store temp rootDir", () => safety("scripts/smoke-b.ts", S.brainStoreTemp).safety === "SAFE_ISOLATED");
  component("testSafety", "root assigned no temp", () => safety("scripts/smoke-r.ts", S.runtimeRootNoTemp).safety === "UNKNOWN");
  component("testSafety", "scheduled task not registered", () => safety("scripts/smoke-s.ts", S.scheduledTaskUnregistered).safety === "REQUIRES_OWNER_APPROVAL");
  component("testSafety", "any brain module import", () => { const v = safety("scripts/smoke-br.ts", S.brainRootModule); return v.safety === "REQUIRES_TEMP_ROOT" && v.roots.brain === "LIVE_POSSIBLE"; });
  component("testSafety", "held-out localhost server", () => safety("scripts/smoke-l.ts", S.heldOutLocalhostServer).safety === "SAFE_ISOLATED", true);
  component("testSafety", "held-out live dispatch", () => safety("scripts/smoke-d.ts", S.heldOutLiveDispatch).safety === "REQUIRES_OWNER_APPROVAL", true);

  const task = (text: string, changed: string[] = []) => tm!.describeAyasDeveloperTask({ text, changedPaths: changed });
  component("testStrategy", "unsafe excluded, safe runnable", () => {
    const s = ts!.planAyasTestStrategy({ task: task("Observer autostart hatasını düzelt", ["src/lib/brain/autonomy/AyasObserverAutostart.ts"]), changedFiles: ["src/lib/brain/autonomy/AyasObserverAutostart.ts"], graphAffectedFiles: [], index });
    return s.excludedUnsafe.some((x) => x.scriptPath === "scripts/smoke-ayas-observer-autostart.ts") && !s.runnable.includes("scripts/smoke-ayas-observer-autostart.ts");
  });
  component("testStrategy", "authority area suites", () => {
    const s = ts!.planAyasTestStrategy({ task: task("Onay servisini güçlendir", [APPROVAL]), changedFiles: [APPROVAL], graphAffectedFiles: [], index });
    return s.runnable.includes("scripts/smoke-ayas-execution-gate.ts") && s.runnable.includes("scripts/smoke-ayas-proposal-approval-service.ts") && s.selected.find((x) => x.scriptPath.endsWith("proposal-approval-service.ts"))?.reason === "DIRECT";
  });
  component("testStrategy", "docs-only static", () => { const s = ts!.planAyasTestStrategy({ task: task("CHANGELOG güncelle", ["CHANGELOG.md"]), changedFiles: ["CHANGELOG.md"], graphAffectedFiles: [], index }); return s.selected.length === 0 && same(s.staticChecks, ["git diff --check"]); });
  component("testStrategy", "unestablished roots not runnable", () => {
    const s = ts!.planAyasTestStrategy({ task: task("Runtime yol hatasını düzelt", [RUNTIME_PATHS]), changedFiles: [RUNTIME_PATHS], graphAffectedFiles: [], index });
    return s.requiresTempRoot.includes("scripts/smoke-runtime-storage-paths.ts") && !s.runnable.includes("scripts/smoke-runtime-storage-paths.ts") && s.missingAreaSuites.length === 0;
  });
  component("testStrategy", "dependent cap low vs high risk", () => {
    const dependents = Array.from({ length: 15 }, (_, i) => ({ scriptPath: `scripts/smoke-dep-${i}.ts`, importedModules: ["src/lib/ayas/x/Affected"], safety: ts!.classifyAyasTestSafety(ts!.extractAyasTestSourceFacts(`scripts/smoke-dep-${i}.ts`, PURE_SRC)) }));
    const low = ts!.planAyasTestStrategy({ task: task("Model yönlendirmesini düzelt", ["src/lib/ayas/model/X.ts"]), changedFiles: ["src/lib/ayas/model/X.ts"], graphAffectedFiles: ["src/lib/ayas/x/Affected.ts"], index: dependents });
    const high = ts!.planAyasTestStrategy({ task: task("Storage yolunu düzelt", [RUNTIME_PATHS]), changedFiles: [RUNTIME_PATHS], graphAffectedFiles: ["src/lib/ayas/x/Affected.ts"], index: dependents });
    return low.selected.length === 12 && low.dependentCapApplied && high.selected.length === 15 && !high.dependentCapApplied;
  });
  component("testStrategy", "changed test selected", () => ts!.planAyasTestStrategy({ task: task("Evaluator testini ekle", [TEST]), changedFiles: [TEST], graphAffectedFiles: [], index }).selected.some((x) => x.scriptPath === TEST && x.reason === "CHANGED_TEST"));

  const bl = (o: Parameters<TS["decideAyasBaselineComparison"]>[0]) => ts!.decideAyasBaselineComparison(o);
  component("baselineDecision", "29 improvement claim needs baseline", () => { const d = bl({ purpose: "improvement-claim" }); return d.required && d.method === "TEMP_GIT_ARCHIVE"; });
  component("baselineDecision", "29 failing regression needs baseline", () => bl({ purpose: "failing-regression", triage: "UNKNOWN" }).required);
  component("baselineDecision", "30 environment failure unnecessary", () => !bl({ purpose: "failing-regression", triage: "ENVIRONMENTAL_FAILURE" }).required);
  component("baselineDecision", "30 all pass unnecessary", () => !bl({ purpose: "all-pass" }).required);
  component("baselineDecision", "30 docs only unnecessary", () => !bl({ purpose: "docs-only" }).required);
  component("baselineDecision", "scope drift uses read-only diff", () => bl({ purpose: "scope-drift-question" }).method === "GIT_DIFF_AGAINST_BASELINE");
  component("baselineDecision", "already recorded", () => !bl({ purpose: "improvement-claim", baselineAlreadyRecorded: true }).required);

  const dimsOf = (text: string, files: string[]) => rv!.planAyasReview(task(text, files), files).dimensions;
  component("review", "storage dims", () => { const d = dimsOf("Storage yolunu düzelt", [RUNTIME_PATHS]); return ["path-containment", "durability", "migration", "write-authority"].every((x) => d.includes(x as never)) && !d.includes("injection"); });
  component("review", "router dims", () => { const d = dimsOf("Yönlendirmeyi düzelt", ["src/lib/ayas/routing/AyasAgenticRouting.ts"]); return ["false-positive", "false-negative", "fallback"].every((x) => d.includes(x as never)); });
  component("review", "memory dims", () => { const d = dimsOf("Hafıza kaydını düzelt", ["src/lib/ayas/memory/AyasMemoryTemporal.ts"]); return ["stale-data", "temporal-correctness", "privacy"].every((x) => d.includes(x as never)); });
  component("review", "docs-only dims", () => same(dimsOf("CHANGELOG güncelle", ["CHANGELOG.md"]), ["factual-claims", "scope"]));
  component("review", "security dims", () => { const d = dimsOf("Güvenlik açığını kapat ve düzelt", ["src/lib/ayas/security/AyasBoundedRequestBody.ts"]); return ["injection", "secrets", "replay"].every((x) => d.includes(x as never)); });
  const fc = (o: Partial<Parameters<RV["classifyAyasReviewFinding"]>[0]>) => rv!.classifyAyasReviewFinding({ claimedSeverity: "MAJOR", disproven: false, reachable: true, impactEvidence: true, presentOnBaseline: false, introducedByChange: true, inTaskScope: true, ...o }).findingClass;
  component("findingClass", "speculative major -> minor", () => fc({ reachable: null }) === "MINOR");
  component("findingClass", "evidenced major", () => fc({}) === "MAJOR");
  component("findingClass", "quality blocker -> major", () => fc({ claimedSeverity: "BLOCKER", impactKind: "quality" }) === "MAJOR");
  component("findingClass", "authority blocker", () => fc({ claimedSeverity: "BLOCKER", impactKind: "authority" }) === "BLOCKER");
  component("findingClass", "false positive", () => fc({ disproven: true }) === "FALSE_POSITIVE");
  component("findingClass", "pre-existing", () => fc({ presentOnBaseline: true, introducedByChange: false }) === "PRE_EXISTING");
  component("findingClass", "out of scope", () => fc({ inTaskScope: false, introducedByChange: false }) === "OUT_OF_SCOPE");

  component("checkpoint", "only verified facts", () => {
    const r = rc!.compileAyasVerifiedCheckpoint({ branch: "wip/stage10", finalHead: H3, featureCommit: H2, closureCommit: H3, currentState: NOW,
      validations: [V("typescript"), V("authority-regression", { source: "previous-agent" })],
      graphify: { lastAnalyzedHead: H2, stale: false, duplicateIds: 0, duplicateEdges: 0, dangling: 0, selfLoops: 0 },
      integrity: [{ name: "runtime", before: "x", after: "x" }, { name: "ledger", before: "y", after: "y" }], knownLimitations: [], nextStage: "10A" });
    const text = r.lines.join("\n");
    return text.includes("Verified passing: typescript.") && !text.includes("authority-regression") && r.omitted.some((o) => o.startsWith("authority-regression")) && !text.includes("Graphify current") && text.includes("Runtime/Test Mutation: NONE.");
  });
  component("checkpoint", "changed integrity never NONE", () => !rc!.compileAyasVerifiedCheckpoint({ branch: "b", finalHead: H3, featureCommit: null, closureCommit: null, currentState: NOW, validations: [], graphify: null, integrity: [{ name: "runtime", before: "x", after: "z" }], knownLimitations: [], nextStage: null }).lines.join(" ").includes("Runtime/Test Mutation: NONE"));
  component("checkpoint", "unmeasured integrity omitted", () => rc!.compileAyasVerifiedCheckpoint({ branch: "b", finalHead: H3, featureCommit: null, closureCommit: null, currentState: NOW, validations: [], graphify: null, integrity: [{ name: "memory", before: null, after: "x" }], knownLimitations: [], nextStage: null }).omitted.some((o) => o.includes("memory")));

  component("compression", "superseded dropped, safety kept", () => {
    const r = ho!.compressAyasDeveloperContext([
      { id: "cp-old", kind: "checkpoint", text: "stage 9 closed", at: "2026-09-23T10:00:00Z" }, { id: "cp-new", kind: "checkpoint", text: "stage 10 in progress", at: "2026-09-24T10:00:00Z" },
      { id: "rule", kind: "safety-rule", text: "no git add -A", at: "2026-01-01T00:00:00Z" }, { id: "hz", kind: "hazard", text: "observer autostart unsafe", at: "2026-01-01T00:00:00Z" },
      { id: "plan-old", kind: "plan", text: "old plan", at: "2026-09-24T09:00:00Z", superseded: true }, { id: "inv", kind: "investigation", text: "closed", at: "2026-09-24T09:00:00Z", closed: true },
      { id: "ev1", kind: "validation-evidence", text: "typescript: FAIL", at: "2026-09-24T09:00:00Z" }, { id: "ev2", kind: "validation-evidence", text: "typescript: PASS", at: "2026-09-24T11:00:00Z" },
      { id: "owner", kind: "owner-decision", text: "defer npm audit", at: "2026-09-20T00:00:00Z" },
    ]);
    const kept = r.kept.map((k) => k.id).sort();
    return same(kept, ["cp-new", "ev2", "hz", "owner", "rule"]) && r.dropped.find((d) => d.id === "cp-old")?.reason === "SUPERSEDED_CHECKPOINT";
  });

  component("skillUsage", "actual-use evidence enforced", () => {
    const sel = sk!.selectAyasDeveloperSkills(task("Storage yolunu düzelt", [RUNTIME_PATHS]), { host: "codex", registeredSkillIds: ["review-agent"], localSkillIds: LOCAL });
    const rows = sk!.reportAyasSkillUsage(sel, [
      { skillId: "ayas:tests", delivery: "INVOKED", evidence: "ran smoke selection from the skill" },
      { skillId: "ayas:storage", delivery: "READ_FILE", evidence: "confirmed explicit runtime/authority roots for the change" },
      { skillId: "review-agent", delivery: "INVOKED", evidence: "" },
      { skillId: "ui-ux-pro-max", delivery: "INVOKED", evidence: "styled the panel with the design system" },
    ]);
    const v = (id: string) => rows.find((r) => r.skillId === id)?.verdict;
    return v("ayas:tests") === "CLAIM_REJECTED_NOT_REGISTERED" && v("ayas:storage") === "USED" && v("review-agent") === "CLAIM_REJECTED_NO_EVIDENCE" && v("ui-ux-pro-max") === "CLAIM_REJECTED_NOT_SELECTED";
  });

  component("plan", "graph-first when no evidence", () => { const p = tm!.planAyasDeveloperChange(task("Handoff özelliği ekle"), { current: true, targetSymbols: [], candidateFiles: [], affectedFiles: [] }); return p.needsGraphFirst && p.steps[0]!.id === "graphify-locate" && p.likelyFiles.length === 0; });
  component("plan", "relevant file precision", () => {
    const cands = Array.from({ length: 11 }, (_, i) => `src/lib/ayas/developer/F${i}.ts`);
    const p = tm!.planAyasDeveloperChange(task("Handoff özelliği ekle"), { current: false, targetSymbols: ["compileAyasTaskPacket"], candidateFiles: cands, affectedFiles: [] });
    return p.likelyFiles.length === 8 && p.likelyFiles.every((f) => cands.includes(f)) && p.steps[0]!.id === "graphify-refresh" && p.steps.some((s) => s.id === "graphify-affected") && !p.steps.some((s) => /inspect (the )?entire repo/i.test(s.detail));
  });
  component("plan", "read-only plan never mutates", () => { const p = tm!.planAyasDeveloperChange(task("Recovery modülü nasıl çalışıyor?"), { current: true, targetSymbols: ["recoverAyasRepositoryState"], candidateFiles: [SRC], affectedFiles: [] }); return !p.steps.some((s) => s.id === "implement") && p.steps.at(-1)!.id === "report"; });

  component("redaction", "secrets never reach packet", () => {
    const c = flows[0]!; const a = analyze({ ...c, text: `${c.text} sk-proj-ABCDEFGHIJKLMNOPQRSTUVWX password=hunter2secret` });
    return !a.packetText!.includes("sk-proj-ABCDEFGHIJKLMNOPQRSTUVWX") && !a.packetText!.includes("hunter2secret") && a.packetText!.includes("[REDACTED]");
  });
  component("packet", "safety constraints in smallest packet", () => {
    const smallest = [...flows].map(analyze).sort((a, b) => (a.packetChars ?? 0) - (b.packetChars ?? 0))[0]!;
    return ["No git reset, clean, stash", "DO NOT RUN scripts/smoke-ayas-observer-autostart.ts", "timeout is never PASS", "No live runtime/authority"].every((s) => smallest.packetText!.includes(s));
  });
  component("packet", "staging list never truncated", () => {
    const many = [...Array.from({ length: 25 }, (_, i) => ["??", `src/lib/ayas/developer/Part${i}.ts`] as EntrySpec), ["??", DOC] as EntrySpec];
    const a = analyze({ id: "stage-many", label: "", text: "Stage 10 değişikliklerini sürdür", snapshot: snap({ dirty: many }), progress: prog({ head: BASE, v: ALL_PASS }), expect: {} });
    return a.gate === "STAGE" && a.packetText!.includes("src/lib/ayas/developer/Part24.ts") && !/git add -- [^\n]*more\)/.test(a.packetText!);
  });
  component("parser", "porcelain v2 -z", () => {
    const raw = ["# branch.oid " + H2, "# branch.head wip/stage10", "# branch.upstream origin/wip/stage10", "# branch.ab +1 -0",
      `1 .M N... 100644 100644 100644 ${H1} ${H1} ${SRC}`, `2 R. N... 100644 100644 100644 ${H1} ${H1} R100 docs/NEW.md`, "docs/OLD.md", `? ${TEST}`, "! data/brain/x.json", ""].join("\0");
    const p = rc!.parseAyasGitStatusPorcelainV2(raw);
    return p.head === H2 && p.branch === "wip/stage10" && p.ahead === 1 && p.behind === 0 && p.entries.length === 4 && p.entries[1]!.originalPath === "docs/OLD.md" && p.entries[1]!.index === "R" && p.entries[3]!.kind === "ignored";
  });

  // ---- real Git fixture + CLI end-to-end (TEMP only) ------------------------------
  const integration: { id: string; ok: boolean; detail?: string }[] = [];
  let cliPacketChars: number | null = null;
  if (final) {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ayas-dev-intel-")));
    assert.ok(root.startsWith(fs.realpathSync(os.tmpdir())), "fixture must live under OS TEMP");
    const emptyConfig = path.join(root, "empty.gitconfig"); fs.writeFileSync(emptyConfig, "");
    const env = { ...process.env, GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid", GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" };
    const g = (cwd: string, args: string[]) => execFileSync("git", args, { cwd, env, encoding: "utf8", windowsHide: true }).trim();
    const write = (base: string, rel: string, text: string) => { fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true }); fs.writeFileSync(path.join(base, rel), text); };
    const check = (id: string, ok: boolean, detail?: string) => integration.push({ id, ok, ...(ok || !detail ? {} : { detail }) });
    try {
      const remote = path.join(root, "remote.git"); const work = path.join(root, "work"); const other = path.join(root, "other");
      g(root, ["init", "--bare", "-b", "main", remote]); g(root, ["init", "-b", "main", work]);
      write(work, ".gitignore", ".graphify/\n.claude/\ndata/brain/\n"); write(work, "src/lib/Mod.ts", "export const a = 1;\n"); write(work, "docs/NOTE.md", "# note\n");
      write(work, ".claude/skills/ayas/tests/SKILL.md", "---\nname: tests\n---\n");
      g(work, ["add", "--", ".gitignore", "src/lib/Mod.ts", "docs/NOTE.md"]); g(work, ["commit", "-m", "base"]);
      const baseline = g(work, ["rev-parse", "HEAD"]);
      g(work, ["remote", "add", "origin", remote]); g(work, ["push", "-u", "origin", "main"]);
      write(work, "src/lib/Mod.ts", "export const a = 2;\n"); write(work, "scripts/smoke-mod.ts", "export {};\n");
      g(work, ["add", "--", "src/lib/Mod.ts", "scripts/smoke-mod.ts"]); g(work, ["commit", "-m", "feature"]); g(work, ["push"]);
      write(work, "docs/NOTE.md", "# note\nclosed\n"); g(work, ["add", "--", "docs/NOTE.md"]); g(work, ["commit", "-m", "closure"]); g(work, ["push"]);
      const writeGraph = () => write(work, ".graphify/branch.json", JSON.stringify({ lastAnalyzedHead: g(work, ["rev-parse", "HEAD"]), stale: false }));
      writeGraph();
      const scope = ["src/", "scripts/", "docs/"];
      const recover = async (includeIgnored = false) => {
        const state = await co!.collectAyasRepositoryState({ cwd: work, trustedBaseline: baseline, checkRealRemote: true, includeIgnored });
        return { state, recovery: rc!.recoverAyasRepositoryState(state.snapshot, { trustedBaseline: baseline, expectedScope: scope }, { discoveryComplete: true, implementationComplete: null, validations: [], review: null, graphify: state.graphify, currentState: state.stateFingerprint }) };
      };
      let r = await recover();
      check("closed with real remote", r.recovery.mode === "CLOSED" && r.recovery.lifecycle.pushEvidence === "REAL_REMOTE" && r.recovery.closureCommit !== null, `${r.recovery.mode} ${r.recovery.lifecycle.pushEvidence}`);
      g(work, ["mv", "docs/NOTE.md", "docs/NOTE2.md"]); write(work, "data/brain/autonomy/state.json", "{}");
      r = await recover(true);
      const renamed = r.state.snapshot.entries.find((e) => e.path === "docs/NOTE2.md");
      // Git reports a wholly ignored directory, not each file inside it.
      const daemonAttributed = r.recovery.attributedIgnored.some((p) => "data/brain/autonomy/state.json".startsWith(p));
      check("rename + daemon ignored", renamed?.originalPath === "docs/NOTE.md" && daemonAttributed && r.recovery.firstUnfinishedGate === "COMMIT", `${r.recovery.firstUnfinishedGate} ${JSON.stringify(r.recovery.attributedIgnored)}`);
      const before = r.state.stateFingerprint; write(work, "docs/NOTE2.md", "# note\nedited\n");
      const after = (await recover()).state.stateFingerprint;
      check("content change moves fingerprint", before !== after);
      g(work, ["add", "--", "docs/NOTE2.md"]); g(work, ["commit", "-m", "rename"]);
      r = await recover();
      check("post-commit graphify first", r.recovery.firstUnfinishedGate === "POST_COMMIT_GRAPHIFY" && r.state.snapshot.ahead === 1, r.recovery.firstUnfinishedGate);
      writeGraph(); r = await recover();
      check("local commit ready to push", r.recovery.readiness === "READY_TO_PUSH", r.recovery.readiness);
      const unknownBase = await co!.collectAyasRepositoryState({ cwd: work, trustedBaseline: "0123abcd".repeat(5) });
      const detached = g(work, ["commit-tree", g(work, ["rev-parse", "HEAD^{tree}"]), "-m", "not an ancestor"]);
      const nonAncestor = await co!.collectAyasRepositoryState({ cwd: work, trustedBaseline: detached });
      check("unknown/non-ancestor baseline fails closed", unknownBase.fatal && nonAncestor.fatal && nonAncestor.errors.includes("BASELINE_NOT_ANCESTOR_OR_UNKNOWN"), JSON.stringify([unknownBase.errors, nonAncestor.errors]));
      g(root, ["clone", remote, other]); write(other, "src/lib/Other.ts", "export {};\n"); g(other, ["add", "--", "src/lib/Other.ts"]); g(other, ["commit", "-m", "remote work"]); g(other, ["push"]);
      r = await recover();
      check("remote moved -> sync, no force", r.recovery.mode === "SYNC_REQUIRED" && r.recovery.reasonCodes.includes("REAL_REMOTE_MOVED_FETCH_REQUIRED"), r.recovery.mode);
      const home = path.join(root, "home");
      write(home, ".codex/skills/.system/review-agent/SKILL.md", "---\nname: review-agent\n---\n"); write(home, ".claude/skills/graphify/SKILL.md", "---\nname: graphify\n---\n");
      const codexSkills = co!.discoverAyasSkillEvidence({ cwd: work, host: "codex", homeDir: home });
      const claudeSkills = co!.discoverAyasSkillEvidence({ cwd: work, host: "claude", homeDir: home });
      check("host-specific registration", codexSkills.registeredSkillIds.includes("review-agent") && !codexSkills.registeredSkillIds.includes("graphify") && claudeSkills.registeredSkillIds.includes("graphify") && codexSkills.localSkillIds.includes("ayas:tests"));
      const cli = path.resolve("scripts/ayas-developer-handoff.ts"); const tsx = path.resolve("node_modules/tsx/dist/cli.mjs");
      const cliArgs = [tsx, cli, "--task", "Yarım kalan işi sürdür", "--baseline", baseline, "--scope", "src/", "--scope", "scripts/", "--scope", "docs/", "--remote", "--host", "codex"];
      const repoState = () => [g(work, ["status", "--porcelain=v1", "--ignored"]), g(work, ["rev-parse", "HEAD"]), g(work, ["rev-parse", "@{upstream}"]), fs.statSync(path.join(work, ".git", "index")).mtimeMs].join("|");
      const beforeCli = repoState();
      const text = execFileSync(process.execPath, cliArgs, { cwd: work, env, encoding: "utf8", windowsHide: true, timeout: 60_000 });
      check("CLI packet carries hazards + manual delivery", text.includes("FIRST OPEN GATE") && text.includes("DO NOT RUN scripts/smoke-ayas-observer-autostart.ts") && text.includes("SYNC"), text.slice(0, 400));
      const json = JSON.parse(execFileSync(process.execPath, [...cliArgs, "--json"], { cwd: work, env, encoding: "utf8", windowsHide: true, timeout: 60_000 })) as { recovery: { mode: string }; packet: { sizeChars: number } };
      cliPacketChars = json.packet.sizeChars;
      check("CLI json recovery", json.recovery.mode === "SYNC_REQUIRED", json.recovery.mode);
      check("CLI left worktree, index and refs untouched", repoState() === beforeCli);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  // ---- real repository, read-only -----------------------------------------------
  let realIndex: { total: number; classes: Record<string, number>; buildMs: number } | null = null;
  if (final) {
    const started = performance.now(); const idx = co!.buildAyasTestIndex(process.cwd()); const buildMs = Math.round(performance.now() - started);
    const classes: Record<string, number> = {}; for (const e of idx) classes[e.safety.safety] = (classes[e.safety.safety] ?? 0) + 1;
    realIndex = { total: idx.length, classes, buildMs };
    const find = (p: string) => idx.find((e) => e.scriptPath === p)?.safety.safety;
    integration.push({ id: "real: observer-autostart UNSAFE_KNOWN", ok: find("scripts/smoke-ayas-observer-autostart.ts") === "UNSAFE_KNOWN" });
    integration.push({ id: "real: agentic routing SAFE_READ_ONLY", ok: find("scripts/smoke-ayas-agentic-routing.ts") === "SAFE_READ_ONLY" });
    const self = idx.find((e) => e.scriptPath === TEST)?.safety;
    integration.push({ id: "real: this evaluator auto-runnable", ok: self?.safety === "SAFE_ISOLATED" || self?.safety === "SAFE_READ_ONLY", ...(self?.autoRunAllowed ? {} : { detail: `${self?.safety} ${self?.reasonCodes.join(",")}` }) });
  }

  // ---- anti-hardcoding --------------------------------------------------------------
  const antiHardcoding: string[] = [];
  if (final) {
    const production = [...fs.readdirSync(DEV_DIR).map((f) => path.join(DEV_DIR, f)), path.resolve("scripts/ayas-developer-handoff.ts")].map((f) => fs.readFileSync(f, "utf8").toLocaleLowerCase("tr"));
    // Case IDs overlap legitimate enum vocabulary ("security-fix"); case texts, fixture hashes and held-out IDs must not appear.
    const needles = [...flows.map((c) => c.text), ...flows.filter((c) => c.heldOut).map((c) => c.id), BASE, H1, H2, H3, H9, NOW, OLD, "notes/scratch-ideas.txt", "hunter2secret"].filter((n) => n.length >= 8);
    for (const needle of needles) if (production.some((src) => src.includes(needle.toLocaleLowerCase("tr")))) antiHardcoding.push(needle);
    if (production.some((src) => /\b[0-9a-f]{40}\b/.test(src))) antiHardcoding.push("40-hex commit literal");
  }

  // ---- performance --------------------------------------------------------------------
  let msPerAnalysis: number | null = null;
  if (final) { const started = performance.now(); for (let i = 0; i < 1_000; i++) analyze(flows[i % flows.length]!); msPerAnalysis = Number(((performance.now() - started) / 1_000).toFixed(3)); }
  const sizes = packetSizes.map((p) => p.chars);
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

  const report = {
    source: final ? "stage10" : "644bc06-baseline",
    flow: { mainPass: `${flowPass}/${mainTotal}`, heldOut: `${heldPass}/${heldTotal}` },
    dimensions: Object.fromEntries(Object.entries(dims).map(([k, [p, t]]) => [k, `${p}/${t}`])),
    skill: { precision: skillTp + skillFp ? Number((skillTp / (skillTp + skillFp)).toFixed(3)) : null, recall: skillTp + skillFn ? Number((skillTp / (skillTp + skillFn)).toFixed(3)) : null, irrelevantSelected },
    components: Object.fromEntries(Object.entries(comp).map(([k, [p, t]]) => [k, `${p}/${t}`])),
    componentHeldOut: `${compHeldPass}/${compHeldTotal}`,
    integration: final ? `${integration.filter((i) => i.ok).length}/${integration.length}` : "absent",
    realTestIndex: realIndex,
    packet: { minChars: sizes.length ? Math.min(...sizes) : null, maxChars: sizes.length ? Math.max(...sizes) : null, avgChars: avg(sizes),
      readOnlyAvg: avg(packetSizes.filter((p) => p.readOnly).map((p) => p.chars)), mutatingAvg: avg(packetSizes.filter((p) => !p.readOnly).map((p) => p.chars)), cliPacketChars },
    msPerAnalysis, antiHardcoding,
    misses, componentMisses: compMiss, integrationMisses: integration.filter((i) => !i.ok),
  };
  console.log(JSON.stringify(report, null, 2));
  if (process.argv.includes("--gate")) {
    assert.equal(flowPass, mainTotal, "all main flow cases must pass");
    for (const [k, [p, t]] of Object.entries(comp)) assert.equal(p, t, `component ${k}`);
    assert.equal(integration.filter((i) => !i.ok).length, 0, "integration");
    assert.equal(antiHardcoding.length, 0, "anti-hardcoding");
    assert.equal(irrelevantSelected, 0, "irrelevant skills selected");
    console.log(`PASS (${mainTotal} flow + ${Object.values(comp).reduce((a, [, t]) => a + t, 0)} component + ${integration.length} integration)`);
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
