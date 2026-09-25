import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { checkAyasBatchItemWithGraphify, AyasBatchGraphifyCheckError, type AyasBatchGraphifyCheckResult, type AyasDependencyExpectationVerdict } from "./AyasBatchGraphifyCheck";

/**
 * M19 — "Per-Item Graphify Durability Follow-up". Before this module, the
 * per-item Graphify AST check (`AyasBatchGraphifyCheck.checkAyasBatchItemWithGraphify`)
 * was structurally enforced (a throw here can veto/roll back an entire
 * batch or proposal) but its result was never durably recorded anywhere —
 * only "the commit exists" was indirect, after-the-fact proof it didn't
 * fail. This closes that evidence gap: every check, PASS or FAIL, is
 * appended here as an immutable record BEFORE the underlying error (if any)
 * propagates, so a failure still blocks publication exactly as before —
 * this module only ever adds a durable record, it never swallows or
 * softens the check's own outcome.
 *
 * Records carry only repo-relative paths and structural counts — never a
 * machine-absolute path, never file content, never a secret.
 */
export const ayasGraphifyEvidenceSchemaVersion = "1" as const;

export type AyasGraphifyEvidenceOutcome = "PASS" | "FAIL";

export interface AyasGraphifyEvidenceRecord {
  readonly schemaVersion: typeof ayasGraphifyEvidenceSchemaVersion;
  readonly evidenceId: string;
  /** The micro item / proposal this check was performed for. */
  readonly itemId: string;
  /** Repo-relative, posix path — never absolute. */
  readonly file: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly outcome: AyasGraphifyEvidenceOutcome;
  readonly expectedImportCount: number;
  readonly actualImportCount?: number;
  readonly nodeCount?: number;
  readonly edgeCount?: number;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  /** Stage 10A (additive): how a declared/actual difference was classified — STALE_EXPECTATION records a reconciled, byte-verified PASS. */
  readonly verdict?: AyasDependencyExpectationVerdict;
}

export class AyasGraphifyEvidenceStoreError extends Error {
  constructor(readonly code: "AYAS_GRAPHIFY_EVIDENCE_IO" | "AYAS_GRAPHIFY_EVIDENCE_CORRUPT", message: string) {
    super(message);
    this.name = "AyasGraphifyEvidenceStoreError";
    this.stack = undefined;
  }
}

export interface AyasGraphifyEvidenceStoreOptions { readonly rootDir?: string; }

export interface AyasGraphifyEvidenceStore {
  readonly dir: string;
  record(input: Omit<AyasGraphifyEvidenceRecord, "schemaVersion" | "evidenceId">): AyasGraphifyEvidenceRecord;
  listForItem(itemId: string): readonly AyasGraphifyEvidenceRecord[];
}

export function createAyasGraphifyEvidenceStore(options: AyasGraphifyEvidenceStoreOptions = {}): AyasGraphifyEvidenceStore {
  const dir = path.resolve(options.rootDir ?? path.join(process.cwd(), "data", "brain", "self-improvement", "graphify-evidence"));

  const listRaw = (): readonly AyasGraphifyEvidenceRecord[] => {
    if (!fs.existsSync(dir)) return [];
    const out: AyasGraphifyEvidenceRecord[] = [];
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".json") || f.startsWith(".")) continue;
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as AyasGraphifyEvidenceRecord;
        if (parsed && parsed.schemaVersion === ayasGraphifyEvidenceSchemaVersion) out.push(parsed);
      } catch { /* a corrupt evidence file never blocks reading the rest — this store is evidence, not an authority gate */ }
    }
    return out;
  };

  return {
    dir,
    record(input) {
      const record: AyasGraphifyEvidenceRecord = { ...input, schemaVersion: ayasGraphifyEvidenceSchemaVersion, evidenceId: `ayas-graphify-evidence-${crypto.randomUUID()}` };
      fs.mkdirSync(dir, { recursive: true });
      const target = path.join(dir, `${record.evidenceId}.json`);
      const tmp = path.join(dir, `.${record.evidenceId}.${process.pid}.${crypto.randomUUID()}.tmp`);
      try {
        const fd = fs.openSync(tmp, "wx");
        try { fs.writeFileSync(fd, `${JSON.stringify(record, null, 2)}\n`, "utf8"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        fs.renameSync(tmp, target);
      } catch (error) {
        try { fs.rmSync(tmp, { force: true }); } catch { /* fail closed */ }
        throw new AyasGraphifyEvidenceStoreError("AYAS_GRAPHIFY_EVIDENCE_IO", error instanceof Error ? error.message : String(error));
      }
      return record;
    },
    listForItem(itemId) {
      return listRaw().filter((r) => r.itemId === itemId);
    },
  };
}

/**
 * Wraps `checkAyasBatchItemWithGraphify` with durable evidence recording.
 * The underlying check's own throw/return behavior is never altered — a
 * FAIL is recorded and then still re-thrown, so this can never weaken "a
 * required Graphify failure blocks automatic publication." Evidence
 * recording itself is best-effort-ordered but not best-effort-correctness:
 * if the check throws, the evidence record is written before the error
 * propagates, not swallowed by a try/catch around the whole thing.
 */
export function checkAyasItemWithGraphifyEvidenced(params: {
  readonly repoRoot: string;
  readonly evidenceStore: AyasGraphifyEvidenceStore;
  readonly itemId: string;
  readonly file: string;
  readonly expectedImportCount: number;
  /** The frozen artifact's replacement content for `file`; lets a stale declaration be reconciled against byte-identical landed content. */
  readonly approvedContent?: string;
}): AyasBatchGraphifyCheckResult {
  const startedAt = new Date().toISOString();
  try {
    const result = checkAyasBatchItemWithGraphify(params.repoRoot, params.file, params.expectedImportCount, { approvedContent: params.approvedContent });
    params.evidenceStore.record({
      itemId: params.itemId,
      file: params.file,
      startedAt,
      completedAt: new Date().toISOString(),
      outcome: "PASS",
      expectedImportCount: params.expectedImportCount,
      actualImportCount: result.importEdgeCount,
      nodeCount: result.nodeCount,
      edgeCount: result.edgeCount,
      verdict: result.verdict,
    });
    return result;
  } catch (error) {
    params.evidenceStore.record({
      itemId: params.itemId,
      file: params.file,
      startedAt,
      completedAt: new Date().toISOString(),
      outcome: "FAIL",
      expectedImportCount: params.expectedImportCount,
      errorCode: error instanceof AyasBatchGraphifyCheckError ? error.code : undefined,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
