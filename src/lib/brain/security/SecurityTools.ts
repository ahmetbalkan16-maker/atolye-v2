/**
 * Open-source tools Bekçi runs (owner 2026-11-27: "GitHub'ta bir şey varsa entegre edebilirsin") — the pins and the
 * pure decisions around them.
 *
 * Gitleaks (https://github.com/gitleaks/gitleaks, MIT licence) scans the Git HISTORY for 150+ kinds of credentials;
 * Bekçi's own patterns only see six kinds in the working tree. One static Windows binary, published with a SHA-256
 * checksums file. It is installed only by `scripts/ayas-security-tools-install.ts` into the Git-ignored
 * `bin/security-tools/gitleaks/<version>/`, after the archive's SHA-256 matched BOTH the pin below and the release's
 * checksums file, and the extracted program matched its own pin. The watcher hashes the program again before every
 * run and never executes a file whose hash differs. Its report is read for file, rule, line and commit only: secret
 * values are redacted by Gitleaks (`--redact`) and never read here.
 *
 * Considered and not integrated: osv-scanner (Apache-2.0) — Bekçi already reads the same OSV database for both locks
 * over its API, and the binary is ~60 MB on a slow shared link; trufflehog (AGPL-3.0) — verifies a found key by sending
 * it to the provider, which is the opposite of keeping it local; semgrep — needs a Python runtime.
 *
 * Pure (no I/O). Under `src/lib/brain/security/` (FORBIDDEN_AUTONOMOUS): a pin is changed only by a person.
 */

export interface PinnedTool {
  readonly tool: string;
  readonly version: string;
  readonly licence: string;
  readonly repo: string;
  /** Release asset (zip) and its SHA-256, as published in `checksumsAsset`. */
  readonly asset: string;
  readonly assetSha256: string;
  readonly checksumsAsset: string;
  /** The program inside the archive and its SHA-256 (measured once after a verified archive, then pinned here). */
  readonly exe: string;
  readonly exeSha256: string;
}

export const GITLEAKS: PinnedTool = Object.freeze({
  tool: "gitleaks",
  version: "8.30.1",
  licence: "MIT",
  repo: "gitleaks/gitleaks",
  asset: "gitleaks_8.30.1_windows_x64.zip",
  assetSha256: "d29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e",
  checksumsAsset: "gitleaks_8.30.1_checksums.txt",
  exe: "gitleaks.exe",
  // Measured 2026-11-27 from the archive above after it matched the pin and the release's checksums file.
  exeSha256: "17157e2ee8b76fc8b1d8bee607a250e34b8a8023c8bc81822d4b5ee4d78fcb7c",
});

/** Where a pinned tool lives, relative to the repo root (`bin/security-tools/` is Git-ignored, per machine). */
export function toolInstallDir(tool: PinnedTool): string {
  return ["bin", "security-tools", tool.tool, tool.version].join("/");
}

export function releaseAssetUrl(tool: PinnedTool, asset: string): string {
  return `https://github.com/${tool.repo}/releases/download/v${tool.version}/${asset}`;
}

/** `<sha256>  <file>` lines → file → lower-case hash. */
export function parseChecksums(text: string): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(\S+)\s*$/.exec(line.trim());
    if (m) out.set(m[2]!, m[1]!.toLowerCase());
  }
  return out;
}

/**
 * The installer's verdict on a downloaded archive: it must match the pin in code AND the release's checksums file.
 * Two independent statements; either one disagreeing refuses the install.
 */
export function verifyArchive(tool: PinnedTool, archiveSha256: string, checksumsText: string): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  const actual = archiveSha256.toLowerCase();
  const listed = parseChecksums(checksumsText).get(tool.asset);
  if (!listed) return { ok: false, reason: `${tool.checksumsAsset} içinde ${tool.asset} yok` };
  if (listed !== tool.assetSha256) return { ok: false, reason: `sürümün sağlama listesi koddaki sabitle uyuşmuyor (${listed.slice(0, 12)}… ≠ ${tool.assetSha256.slice(0, 12)}…)` };
  if (actual !== tool.assetSha256) return { ok: false, reason: `indirilen arşivin SHA-256'sı tutmuyor (${actual.slice(0, 12)}…)` };
  return { ok: true };
}

/** Whether the watcher may execute the installed program: present, and its hash equals the pin. */
export function toolRunDecision(tool: PinnedTool, exe: { readonly exists: boolean; readonly sha256?: string }): { readonly run: true } | { readonly run: false; readonly reason: string } {
  if (!exe.exists) return { run: false, reason: `${tool.tool} ${tool.version} kurulu değil` };
  if (!/^[0-9a-f]{64}$/.test(tool.exeSha256)) return { run: false, reason: `${tool.tool} programının SHA-256'sı kodda sabitlenmemiş` };
  if ((exe.sha256 ?? "").toLowerCase() !== tool.exeSha256) return { run: false, reason: `${tool.tool} programının SHA-256'sı tutmuyor; çalıştırılmadı` };
  return { run: true };
}

/** Paths whose test fixtures and docs carry fake keys on purpose (the same exclusions as Bekçi's own pattern scan). */
export const SECRET_EXCLUDED_PATHS: readonly RegExp[] = [/(^|\/)scripts\/smoke-[^/]*$/, /\.example$/, /\.md$/i, /^docs\//, /(^|\/)package-lock\.json$/];

export function isSecretExcludedPath(file: string): boolean {
  const p = file.replace(/\\/g, "/");
  return SECRET_EXCLUDED_PATHS.some((re) => re.test(p));
}

/**
 * Values the broad `generic-api-key` rule took for keys in this repository's history (first full scan, 2026-11-27,
 * 10 hits, all of these shapes): sha256 fingerprints of env values in production records, SCREAMING_CASE constant and
 * env-var names (also as `env.NAME`), dotted storage keys ("ayas.brain.conversation.v1") and Europeana's public demo
 * key. Applied to that one rule only; the specific rules (OpenAI, AWS, GitHub, private keys…) see everything.
 */
export const GITLEAKS_GENERIC_NOT_SECRETS: readonly RegExp[] = [/^[0-9a-f]{64}$/, /^[A-Z][A-Z0-9_]{2,}$/, /^(process\.)?env\.[A-Z][A-Z0-9_]+$/, /^[a-z][a-z0-9]*(\.[A-Za-z0-9]+)+$/, /^api2demo$/];

/** Gitleaks config: its default rules, with the same fixture/doc exclusions (written to a temp file per run). */
export function gitleaksConfigToml(): string {
  const list = (res: readonly RegExp[]) => res.map((re) => `  '''${re.source}''',`).join("\n");
  return [
    `title = "Bekci"`, ``, `[extend]`, `useDefault = true`, ``,
    `[[allowlists]]`, `description = "Bekci: test fixtures and docs carry fake keys on purpose"`, `paths = [`, list(SECRET_EXCLUDED_PATHS), `]`, ``,
    `[[allowlists]]`, `description = "Bekci: identifiers and digests the generic rule mistakes for keys"`, `targetRules = ["generic-api-key"]`, `regexes = [`, list(GITLEAKS_GENERIC_NOT_SECRETS), `]`, ``,
  ].join("\n");
}

export interface GitleaksHit {
  readonly file: string;
  readonly rule: string;
  readonly line: number | null;
  /** Short commit id; absent for a working-tree scan. */
  readonly commit?: string;
  /** Gitleaks' fingerprint (commit:file:rule:line — no secret), for `.gitleaksignore`. */
  readonly fingerprint?: string;
}

/**
 * Gitleaks' JSON report → hits. Reads ONLY File, RuleID, StartLine, Commit and Fingerprint; the Secret and Match
 * fields are never read (they are redacted anyway). Excluded paths are dropped again here, in case the config was not
 * honoured.
 */
export function parseGitleaksReport(json: unknown): readonly GitleaksHit[] {
  if (!Array.isArray(json)) throw new Error("Gitleaks raporu liste değil");
  const out: GitleaksHit[] = [];
  const seen = new Set<string>();
  for (const raw of json as Record<string, unknown>[]) {
    if (!raw || typeof raw !== "object") continue;
    const file = String(raw.File ?? "").replace(/\\/g, "/").slice(0, 300);
    const rule = String(raw.RuleID ?? "").replace(/[^\w.-]/g, "").slice(0, 80);
    if (!file || !rule || isSecretExcludedPath(file)) continue;
    const line = Number.isInteger(raw.StartLine) ? (raw.StartLine as number) : null;
    const commit = /^[0-9a-f]{7,40}$/.test(String(raw.Commit ?? "")) ? String(raw.Commit).slice(0, 10) : undefined;
    const fingerprint = typeof raw.Fingerprint === "string" && raw.Fingerprint.length < 400 ? raw.Fingerprint : undefined;
    const key = `${file}|${rule}|${line}|${commit ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ file, rule, line, ...(commit ? { commit } : {}), ...(fingerprint ? { fingerprint } : {}) });
  }
  return out;
}
