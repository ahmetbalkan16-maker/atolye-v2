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
 */
export const ayasSandboxUnvalidatableSchemaVersion = "1" as const;

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
}

export interface AyasSandboxUnvalidatableStoreOptions { readonly rootDir?: string }

export interface AyasSandboxUnvalidatableStore {
  readonly dir: string;
  record(input: { readonly semanticKey: string; readonly generatorIdentity: string; readonly contentFingerprint: string; readonly reason: string; readonly requiredCapability: string; readonly now: string }): AyasSandboxUnvalidatableRecord;
  /** `true` when this exact (semanticKey, contentFingerprint) pair already failed sandbox validation before — the caller should skip spending another real sandbox attempt on it. */
  shouldSkip(semanticKey: string, contentFingerprint: string): boolean;
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
      };
      writeAtomic(record);
      return record;
    },
    shouldSkip(semanticKey, contentFingerprint) {
      const existing = loadRaw(semanticKey);
      return existing !== undefined && existing.contentFingerprint === contentFingerprint;
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
