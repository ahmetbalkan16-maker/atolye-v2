import crypto from "node:crypto";

import { classifyPatchTarget } from "../selfheal/BrainPatchSafety";
import { classifyAyasCodeChangeImpactFile } from "./AyasProposalRuntimeImpact";

/**
 * The code lane (owner decision 2026-11-09: "ayas tamamen otomatik çalışacak, benim onay uygula diye tıklama ile onay
 * alıp yapacak"). AYAS's developer — Claude Code (`claude -p`) in a git worktree of its own, or the studio's apprentice
 * — writes a change, the development queue checks it, and the owner's "ONAYLA VE UYGULA" on that exact build is the one
 * approval for its commit, push and live publish (CLAUDE.md standing exception). Pure: which files a model-written
 * change may touch, and the identity the owner's click binds to. Nothing here runs a process or writes a file.
 *
 * What a model may never change through this lane, whatever the job says (first rule that matches wins):
 *   1. anything outside the source areas (src/, app/, scripts/, docs/, the V3 content and Remotion sources);
 *   2. the lane itself and the machinery that decides, executes or publishes: AYAS's self-development and publication
 *      modules (src/lib/brain/autonomy/), the observer, executor and launcher scripts, the developer's own modules,
 *      the evidence and eval records under docs/ayas-execution/;
 *   3. every FORBIDDEN_AUTONOMOUS target of the self-healing classifier (the homepage, governance, safety, execution,
 *      policy, machine health, revenue, the golden vault and eval-pinned suites, secrets, deploy, CI, packages, the
 *      production and pipeline layers, runtime storage);
 *   4. every file the guarded publication cannot carry without a restart or a config write (only TEST_ONLY and
 *      SOURCE_ONLY are publishable).
 * REVIEW_REQUIRED areas (AYAS's chat and routes among them) stay allowed: the owner's click on the finished, tested
 * change is that review.
 */

export type AyasCodeScope = "v3" | "ayas";

/** The source areas a model-written change may touch at all. */
const AREAS: readonly RegExp[] = [/^src\//, /^app\//, /^scripts\//, /^docs\//, /^content\/v3\//, /^remotion-v3\/src\//];

const LANE_EXCLUDED: readonly { readonly test: (p: string) => boolean; readonly why: string }[] = [
  { test: (p) => p.startsWith("src/lib/brain/autonomy/"), why: "AYAS'ın öz-geliştirme ve yayın düzeneği (kod hattının kendisi dahil)" },
  { test: (p) => /^scripts\/ayas-[^/]+$/.test(p) || /^scripts\/[^/]+\.(?:ps1|vbs|cmd|bat|mjs|cjs|js)$/.test(p), why: "gözlemci, yürütücü, başlatıcı, yayın ve araç betikleri" },
  { test: (p) => /^src\/lib\/v3\/council\/(?:Developer|DevQueue|DevResearch|DevWriter|DevApprentice|DevSkills|DevBrain|SelfImprovement)\.ts$/i.test(p) || /^scripts\/v3\/(?:gelistirici|cirak-yaz|gelisim|yapim)\.ts$/i.test(p), why: "geliştirme kuyruğu, geliştirici ve sipariş izleyicisi" },
  { test: (p) => p.startsWith("docs/ayas-execution/"), why: "yürütme kanıtları ve EVAL kayıtları" },
  { test: (p) => p.startsWith("scripts/lib/") || p.startsWith("scripts/helpers/"), why: "operatör betiklerinin ortak araçları" },
];

export interface AyasCodeLaneRefusal { readonly file: string; readonly why: string }

const norm = (file: string): string => String(file ?? "").replace(/\\/g, "/").replace(/^\.\//, "").trim();

/** Why each file may not be changed through the code lane; empty when every file is allowed. */
export function ayasCodeLaneRefusals(files: readonly string[]): readonly AyasCodeLaneRefusal[] {
  const out: AyasCodeLaneRefusal[] = [];
  for (const raw of files) {
    const file = norm(raw);
    if (!file || file.includes("\0") || file.split("/").some((part) => part === "" || part === "." || part === "..") || /^[A-Za-z]:/.test(file)) {
      out.push({ file: raw, why: "geçersiz yol" });
      continue;
    }
    if (!AREAS.some((area) => area.test(file))) { out.push({ file, why: "kaynak alanlarının (src, app, scripts, docs, V3 içerik ve Remotion kaynakları) dışında" }); continue; }
    const excluded = LANE_EXCLUDED.find((rule) => rule.test(file));
    if (excluded) { out.push({ file, why: excluded.why }); continue; }
    const safety = classifyPatchTarget(file);
    if (safety.level === "FORBIDDEN_AUTONOMOUS") { out.push({ file, why: safety.why }); continue; }
    const impact = classifyAyasCodeChangeImpactFile(file);
    if (impact.impactClass !== "TEST_ONLY" && impact.impactClass !== "SOURCE_ONLY") out.push({ file, why: `yeniden başlatma ya da ayar gerektirir (${impact.rule})` });
  }
  return out;
}

/** One built change, as the owner's click binds to it: the job, its local branch and commit, the base and every file. */
export interface AyasCodeBuild {
  readonly jobId: string;
  readonly scope: AyasCodeScope;
  readonly title: string;
  readonly branch: string;
  /** The build commit (40 hex), whose only parent is `baseHead`. */
  readonly commit: string;
  readonly baseHead: string;
  /** Every changed file with the sha256 of its content after the build (null: the build deletes it). Sorted by path. */
  readonly files: readonly { readonly path: string; readonly sha256: string | null }[];
  /** The checks the build passed (command labels). */
  readonly checks: readonly string[];
  /** The smoke suites among them, run again when the change is applied on a newer HEAD. */
  readonly smokes: readonly string[];
}

const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
export const AYAS_CODE_JOB_ID = /^[\w.-]{1,120}$/;

export function isAyasCodeBuildShape(build: unknown): build is AyasCodeBuild {
  if (!build || typeof build !== "object") return false;
  const b = build as Record<string, unknown>;
  return typeof b.jobId === "string" && AYAS_CODE_JOB_ID.test(b.jobId) && (b.scope === "v3" || b.scope === "ayas")
    && typeof b.title === "string" && typeof b.branch === "string" && /^gelistirme\/[\w.-]{1,120}$/.test(b.branch)
    && typeof b.commit === "string" && HEX40.test(b.commit) && typeof b.baseHead === "string" && HEX40.test(b.baseHead)
    && Array.isArray(b.files) && b.files.length > 0 && b.files.every((f) => f && typeof f === "object" && typeof (f as { path?: unknown }).path === "string"
      && ((f as { sha256?: unknown }).sha256 === null || (typeof (f as { sha256?: unknown }).sha256 === "string" && HEX64.test((f as { sha256: string }).sha256))))
    && Array.isArray(b.checks) && b.checks.every((c) => typeof c === "string") && Array.isArray(b.smokes) && b.smokes.every((s) => typeof s === "string" && /^scripts\/smoke-[\w.-]+\.ts$/.test(s));
}

/** Stable JSON with sorted keys. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(value);
}

/** The build's identity: any change to its commit, base, files, their bytes or its checks gives another hash. */
export function ayasCodeBuildHash(build: AyasCodeBuild): string {
  const { jobId, scope, title, branch, commit, baseHead, files, checks, smokes } = build;
  return crypto.createHash("sha256").update(`ayas-code-build:v1\n${canonical({ jobId, scope, title, branch, commit, baseHead, files: [...files].sort((a, b) => a.path.localeCompare(b.path)), checks, smokes })}`, "utf8").digest("hex");
}

export const ayasCodeContentSha256 = (text: string | Buffer): string => crypto.createHash("sha256").update(text).digest("hex");

/** The commit trailer every build carries, so an interrupted apply can be recognised in the history. */
export const ayasCodeJobTrailer = (jobId: string): string => `AYAS-Code-Job: ${jobId}`;
