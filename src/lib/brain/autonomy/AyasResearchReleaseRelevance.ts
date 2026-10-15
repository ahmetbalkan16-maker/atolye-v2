import fs from "node:fs";
import path from "node:path";

/**
 * Research integration Phase 1 (owner plan 2026-10-15): which registered research sources track a tool this repository
 * actually ships, and whether a release entry is a newer, stable version of it. Decided deterministically from the
 * release title and the installed version (package-lock.json, or the running Node.js), before any model call, so a
 * canary, a sibling package of a monorepo or an older backport line is never analyzed as an improvement.
 * Sources not listed here are landscape sources: their entries are not version-gated.
 */
export interface AyasTrackedRelease {
  /** What is installed: an npm package from package-lock.json, or the Node.js runtime running AYAS. */
  readonly installed: { readonly kind: "npm"; readonly packageName: string } | { readonly kind: "node" };
  /** Captures the version of THIS package from a release title; any other title belongs to a sibling package or tool. */
  readonly titlePattern: RegExp;
}

const SEMVER = String.raw`(\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.]+)?)`;
const VERSION_ONLY = new RegExp(String.raw`^v?${SEMVER}(?:\s|$)`);

export const AYAS_TRACKED_RELEASE_SOURCES: Readonly<Record<string, AyasTrackedRelease>> = Object.freeze({
  nextjs: Object.freeze({ installed: Object.freeze({ kind: "npm", packageName: "next" }), titlePattern: VERSION_ONLY }),
  react: Object.freeze({ installed: Object.freeze({ kind: "npm", packageName: "react" }), titlePattern: VERSION_ONLY }),
  typescript: Object.freeze({ installed: Object.freeze({ kind: "npm", packageName: "typescript" }),
    titlePattern: new RegExp(String.raw`^TypeScript ${SEMVER}((?:\s+(?:Beta|RC|Dev)\b.*)?)$`, "i") }),
  eslint: Object.freeze({ installed: Object.freeze({ kind: "npm", packageName: "eslint" }), titlePattern: VERSION_ONLY }),
  tailwindcss: Object.freeze({ installed: Object.freeze({ kind: "npm", packageName: "tailwindcss" }), titlePattern: VERSION_ONLY }),
  "transformers-js": Object.freeze({ installed: Object.freeze({ kind: "npm", packageName: "@huggingface/transformers" }), titlePattern: VERSION_ONLY }),
  "workers-sdk": Object.freeze({ installed: Object.freeze({ kind: "npm", packageName: "wrangler" }), titlePattern: new RegExp(String.raw`^wrangler@${SEMVER}$`) }),
  nodejs: Object.freeze({ installed: Object.freeze({ kind: "node" }), titlePattern: new RegExp(String.raw`\bVersion ${SEMVER}\b`) }),
});

export type AyasReleaseRelevance =
  | { readonly status: "UNTRACKED" }
  | { readonly status: "OTHER_PACKAGE" }
  | { readonly status: "INSTALLED_UNKNOWN" }
  | { readonly status: "PRERELEASE"; readonly installedVersion: string; readonly releaseVersion: string }
  | { readonly status: "NOT_NEWER"; readonly installedVersion: string; readonly releaseVersion: string }
  | { readonly status: "NEWER"; readonly installedVersion: string; readonly releaseVersion: string };

const PRERELEASE_WORDS = /\b(?:alpha|beta|rc|canary|nightly|preview|next|dev|insiders|experimental)\b/i;

function numbers(version: string): readonly number[] {
  return version.split("-")[0]!.split(".").map((part) => Number(part));
}

/** Numeric major.minor.patch comparison; a missing component counts as 0. */
export function compareAyasReleaseVersions(a: string, b: string): number {
  const x = numbers(a); const y = numbers(b);
  for (let i = 0; i < 3; i += 1) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}

/** The installed version, or null when it cannot be read (fail open to analysis, never to a fabricated version). */
export function resolveAyasInstalledVersion(tracked: AyasTrackedRelease, repoRoot: string): string | null {
  if (tracked.installed.kind === "node") return process.versions.node;
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(repoRoot, "package-lock.json"), "utf8")) as { packages?: Record<string, { version?: unknown }> };
    const version = lock.packages?.[`node_modules/${tracked.installed.packageName}`]?.version;
    return typeof version === "string" && /^\d+\.\d+\.\d+/.test(version) ? version : null;
  } catch { return null; }
}

export function assessAyasReleaseRelevance(sourceId: string, title: string, repoRoot: string): AyasReleaseRelevance {
  const tracked = AYAS_TRACKED_RELEASE_SOURCES[sourceId];
  if (!tracked) return { status: "UNTRACKED" };
  const match = tracked.titlePattern.exec(String(title ?? "").trim());
  if (!match) return { status: "OTHER_PACKAGE" };
  const installedVersion = resolveAyasInstalledVersion(tracked, repoRoot);
  if (!installedVersion) return { status: "INSTALLED_UNKNOWN" };
  const releaseVersion = match[1]!;
  if (releaseVersion.includes("-") || PRERELEASE_WORDS.test(match[2] ?? "")) return { status: "PRERELEASE", installedVersion, releaseVersion };
  return compareAyasReleaseVersions(releaseVersion, installedVersion) > 0
    ? { status: "NEWER", installedVersion, releaseVersion }
    : { status: "NOT_NEWER", installedVersion, releaseVersion };
}
