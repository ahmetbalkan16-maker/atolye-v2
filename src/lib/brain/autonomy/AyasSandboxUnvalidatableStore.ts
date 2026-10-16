import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { redactBrainText } from "../BrainRedaction";

/**
 * M21.4/Gap 4 — deterministic suppression of a candidate that fails real
 * sandbox validation for reasons unrelated to its own generated content
 * (the live example this closes: `diagnostic-quality-gap` correctly
 * regenerating scripts/smoke-assembly-background-music-mix.ts, whose
 * sandbox re-run fails because real ffmpeg assembly behaves differently
 * inside an isolated git worktree — exit code 69 — not because the
 * generated diff itself is wrong). Without this, that exact semantic key
 * would be rediscovered, re-sandboxed, and safely-but-repeatedly rejected
 * on every tick forever — never unsafe, but permanent, pointless noise.
 *
 * This never tries to GUESS whether a failure is "environmental" — that
 * would require semantic understanding this module deliberately avoids
 * (the same discipline `AyasPatchDetectors.ts` already applies to its own
 * detect-only classes). It only tracks, per semantic key, the exact
 * content that failed. On the next tick, if regenerating from CURRENT
 * source would produce byte-identical content to what already failed, the
 * candidate is skipped without spending another real sandbox attempt on
 * it. The moment source changes (a new fingerprint), the suppression no
 * longer applies and a fresh attempt happens automatically — "source hash
 * changes" from Gap 4's own retry-condition list. A human/operator can
 * also explicitly clear a record (e.g. after fixing whatever environment
 * limitation caused it) via `clearAyasSandboxUnvalidatable`.
 *
 * Owner decision 2026-10-16: a VALIDATOR failure is not a property of the
 * content alone. On 2026-10-06 the project typecheck failed for 88
 * candidates in one day; the same content passed it ten days later, but
 * every one of them stayed suppressed because its source never changed. So
 * a record marked `retryable` (and a legacy "validator failed" record) is
 * skipped only for a backoff — 24 h, doubling per failure of the same
 * content, at most 7 days — and then tried again. Policy and freeze
 * refusals are properties of the content and stay suppressed.
 */
export const ayasSandboxUnvalidatableSchemaVersion = "1" as const;

const AYAS_SANDBOX_RETRY_BASE_MS = 24 * 60 * 60_000;
const AYAS_SANDBOX_RETRY_MAX_MS = 7 * 24 * 60 * 60_000;
/** The reason prefix `AyasNovelPatchDiscovery` writes for a failed validator run. */
const VALIDATOR_FAILURE_REASON = "sandbox validation failed: validator failed:";

export interface AyasSandboxUnvalidatableRecord {
  readonly schemaVersion: typeof ayasSandboxUnvalidatableSchemaVersion;
  readonly semanticKey: string;
  readonly generatorIdentity: string;
  readonly contentFingerprint: string;
  readonly reason: string;
  readonly requiredCapability: string;
  readonly firstFailedAt: string;
  readonly lastFailedAt: string;
  readonly attemptCount: number;
  /** Set when the failure may be the environment: the content is tried again after a backoff. */
  readonly retryable?: true;
}

export interface AyasSandboxUnvalidatableStoreOptions { readonly rootDir?: string }

export interface AyasSandboxUnvalidatableStore {
  readonly dir: string;
  record(input: { readonly semanticKey: string; readonly generatorIdentity: string; readonly contentFingerprint: string; readonly reason: string; readonly requiredCapability: string; readonly retryable?: boolean; readonly now: string }): AyasSandboxUnvalidatableRecord;
  /**
   * `true` when this exact (semanticKey, contentFingerprint) pair already failed sandbox validation before — the caller should skip spending another real sandbox attempt on it.
   * With `now`, a retryable failure is skipped only until its backoff has passed.
   */
  shouldSkip(semanticKey: string, contentFingerprint: string, now?: string): boolean;
  load(semanticKey: string): AyasSandboxUnvalidatableRecord | undefined;
  list(): readonly AyasSandboxUnvalidatableRecord[];
  /** Operator override — explicitly forces the next tick to retry this semantic key even with unchanged content (e.g. after fixing an environment limitation). */
  clear(semanticKey: string): void;
}

function fileFor(dir: string, semanticKey: string): string {
  // semanticKey is generator-controlled (never proposal/candidate text), but hash it anyway for a filesystem-safe, fixed-shape filename.
  const safe = crypto.createHash("sha256").update(semanticKey, "utf8").digest("hex");
  return path.join(dir, `${safe}.json`);
}

export function contentFingerprintOf(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

/** When a retryable record may be tried again; `undefined` means it stays suppressed. */
function retryDueAt(record: AyasSandboxUnvalidatableRecord): number | undefined {
  if (record.retryable !== true && !record.reason.startsWith(VALIDATOR_FAILURE_REASON)) return undefined;
  const failures = Math.max(1, record.attemptCount);
  return Date.parse(record.lastFailedAt) + Math.min(AYAS_SANDBOX_RETRY_BASE_MS * 2 ** Math.min(failures - 1, 16), AYAS_SANDBOX_RETRY_MAX_MS);
}

export function createAyasSandboxUnvalidatableStore(options: AyasSandboxUnvalidatableStoreOptions = {}): AyasSandboxUnvalidatableStore {
  const dir = path.resolve(options.rootDir ?? path.join(process.cwd(), "data", "brain", "self-improvement", "sandbox-unvalidatable"));

  const loadRaw = (semanticKey: string): AyasSandboxUnvalidatableRecord | undefined => {
    const file = fileFor(dir, semanticKey);
    if (!fs.existsSync(file)) return undefined;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as AyasSandboxUnvalidatableRecord;
      return parsed.schemaVersion === ayasSandboxUnvalidatableSchemaVersion ? parsed : undefined;
    } catch { return undefined; }
  };

  const writeAtomic = (record: AyasSandboxUnvalidatableRecord): void => {
    fs.mkdirSync(dir, { recursive: true });
    const target = fileFor(dir, record.semanticKey);
    const tmp = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      const fd = fs.openSync(tmp, "w");
      try { fs.writeFileSync(fd, `${JSON.stringify(record, null, 2)}\n`, "utf8"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(tmp, target);
    } catch (error) {
      try { fs.rmSync(tmp, { force: true }); } catch { /* fail closed */ }
      throw error;
    }
  };

  return {
    dir,
    record(input) {
      const existing = loadRaw(input.semanticKey);
      const record: AyasSandboxUnvalidatableRecord = {
        schemaVersion: ayasSandboxUnvalidatableSchemaVersion,
        semanticKey: input.semanticKey,
        generatorIdentity: input.generatorIdentity,
        contentFingerprint: input.contentFingerprint,
        reason: redactBrainText(input.reason).text.slice(0, 500),
        requiredCapability: redactBrainText(input.requiredCapability).text.slice(0, 200),
        firstFailedAt: existing?.contentFingerprint === input.contentFingerprint ? existing.firstFailedAt : input.now,
        lastFailedAt: input.now,
        attemptCount: existing?.contentFingerprint === input.contentFingerprint ? existing.attemptCount + 1 : 1,
        ...(input.retryable === true ? { retryable: true as const } : {}),
      };
      writeAtomic(record);
      return record;
    },
    shouldSkip(semanticKey, contentFingerprint, now) {
      const existing = loadRaw(semanticKey);
      if (existing === undefined || existing.contentFingerprint !== contentFingerprint) return false;
      if (now === undefined) return true;
      const dueAt = retryDueAt(existing);
      // An unreadable clock keeps the suppression.
      return dueAt === undefined || !(Date.parse(now) >= dueAt);
    },
    load(semanticKey) { return loadRaw(semanticKey); },
    list() {
      if (!fs.existsSync(dir)) return [];
      const out: AyasSandboxUnvalidatableRecord[] = [];
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith(".json") || f.startsWith(".")) continue;
        try {
          const parsed = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as AyasSandboxUnvalidatableRecord;
          if (parsed.schemaVersion === ayasSandboxUnvalidatableSchemaVersion) out.push(parsed);
        } catch { /* corrupt record never blocks reading the rest */ }
      }
      return out;
    },
    clear(semanticKey) {
      const file = fileFor(dir, semanticKey);
      if (fs.existsSync(file)) fs.rmSync(file, { force: true });
    },
  };
}
