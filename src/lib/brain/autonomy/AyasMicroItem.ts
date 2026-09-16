import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * M18 — one discovered, sandbox-validated MICRO_SAFE improvement. A micro
 * item is durable evidence of "AYAS found and safely validated this," never
 * an authorization to do anything with it — it carries no reservation, no
 * gate, no execution capability of its own. It is bound to a frozen
 * `AyasPatchArtifact` (the same M17 artifact model, reused unchanged) via
 * `patchArtifactId`/`patchHash`; this module never duplicates that content.
 *
 * `semanticKey` is the stable, baseHead-independent, timestamp-independent
 * identity of the underlying opportunity (reused verbatim from the M17
 * generator's own `candidateId`, e.g. `"ayas-novel-ayas-bounded-file-write"`)
 * — this is what dedup keys off, never `microItemId` (fresh per discovery)
 * or `patchArtifactId` (fresh per freeze). Learn from the M16
 * (`createdAt`/`lastUpdatedAt`) and M17 (`patchArtifactId`) incidents: only
 * `semanticKey` may be trusted for "is this the same opportunity as before."
 */
export const ayasMicroItemSchemaVersion = "1" as const;

export type AyasMicroItemState = "DISCOVERED" | "SANDBOX_VALIDATED" | "BATCHED" | "SUPERSEDED" | "REJECTED" | "EXECUTED";

export interface AyasMicroItem {
  readonly schemaVersion: typeof ayasMicroItemSchemaVersion;
  readonly microItemId: string;
  readonly discoveryClass: string;
  readonly semanticKey: string;
  readonly baseHead: string;
  readonly patchArtifactId: string;
  readonly patchHash: string;
  readonly exactFiles: readonly string[];
  readonly validatorScripts: readonly string[];
  readonly safetyClassification: "SAFE";
  readonly graphifyEvidence: readonly string[];
  readonly reason: string;
  readonly expectedBenefit: string;
  readonly risk: string;
  readonly generatedAt: string;
  readonly validatedAt: string;
  readonly batchId?: string;
  readonly state: AyasMicroItemState;
  readonly lastUpdatedAt: string;
}

export class AyasMicroItemStoreError extends Error {
  constructor(readonly code: "AYAS_MICRO_ITEM_NOT_FOUND" | "AYAS_MICRO_ITEM_INVALID_TRANSITION" | "AYAS_MICRO_ITEM_CORRUPT" | "AYAS_MICRO_ITEM_IO", message: string) {
    super(message);
    this.name = "AyasMicroItemStoreError";
    this.stack = undefined;
  }
}

const TERMINAL_STATES: ReadonlySet<AyasMicroItemState> = new Set(["SUPERSEDED", "REJECTED", "EXECUTED"]);

/** Server-owned state machine — never accepts an arbitrary transition. Mirrors the same "throw rather than silently no-op" discipline `AyasApprovalInboxStore.markStale` already established in M16. */
const ALLOWED_TRANSITIONS: Readonly<Record<AyasMicroItemState, readonly AyasMicroItemState[]>> = {
  DISCOVERED: ["SANDBOX_VALIDATED", "REJECTED", "SUPERSEDED"],
  SANDBOX_VALIDATED: ["BATCHED", "REJECTED", "SUPERSEDED"],
  BATCHED: ["EXECUTED", "SUPERSEDED", "REJECTED"],
  SUPERSEDED: [],
  REJECTED: [],
  EXECUTED: [],
};

export interface AyasMicroItemStoreOptions { readonly rootDir?: string; }

export interface AyasMicroItemStore {
  readonly dir: string;
  create(input: Omit<AyasMicroItem, "schemaVersion" | "microItemId" | "state" | "lastUpdatedAt">): AyasMicroItem;
  load(microItemId: string): AyasMicroItem;
  list(): readonly AyasMicroItem[];
  /** Finds every item (any state) sharing `semanticKey` — the dedup lookup. */
  findBySemanticKey(semanticKey: string): readonly AyasMicroItem[];
  transition(microItemId: string, next: AyasMicroItemState, now: string, extra?: { readonly batchId?: string }): AyasMicroItem;
}

export function createAyasMicroItemStore(options: AyasMicroItemStoreOptions = {}): AyasMicroItemStore {
  const dir = path.resolve(options.rootDir ?? path.join(process.cwd(), "data", "brain", "self-improvement", "micro-items"));
  const fileFor = (id: string) => path.join(dir, `${id}.json`);

  const writeAtomic = (item: AyasMicroItem): void => {
    fs.mkdirSync(dir, { recursive: true });
    const target = fileFor(item.microItemId);
    const tmp = path.join(dir, `.${item.microItemId}.${process.pid}.${crypto.randomUUID()}.tmp`);
    try {
      const fd = fs.openSync(tmp, "w");
      try { fs.writeFileSync(fd, `${JSON.stringify(item, null, 2)}\n`, "utf8"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(tmp, target);
    } catch (error) {
      try { fs.rmSync(tmp, { force: true }); } catch { /* fail closed */ }
      throw new AyasMicroItemStoreError("AYAS_MICRO_ITEM_IO", error instanceof Error ? error.message : String(error));
    }
  };

  const loadRaw = (microItemId: string): AyasMicroItem => {
    const target = fileFor(microItemId);
    if (!fs.existsSync(target)) throw new AyasMicroItemStoreError("AYAS_MICRO_ITEM_NOT_FOUND", `micro item not found: ${microItemId}`);
    let parsed: unknown;
    try { parsed = JSON.parse(fs.readFileSync(target, "utf8")); } catch (error) { throw new AyasMicroItemStoreError("AYAS_MICRO_ITEM_CORRUPT", error instanceof Error ? error.message : String(error)); }
    if (!parsed || typeof parsed !== "object" || (parsed as { schemaVersion?: string }).schemaVersion !== ayasMicroItemSchemaVersion) {
      throw new AyasMicroItemStoreError("AYAS_MICRO_ITEM_CORRUPT", "micro item has an invalid or unsupported shape");
    }
    return parsed as AyasMicroItem;
  };

  const listRaw = (): readonly AyasMicroItem[] => {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith(".")).map((f) => loadRaw(f.replace(/\.json$/, "")));
  };

  return {
    dir,
    create(input) {
      const item: AyasMicroItem = { ...input, schemaVersion: ayasMicroItemSchemaVersion, microItemId: `ayas-micro-item-${crypto.randomUUID()}`, state: "DISCOVERED", lastUpdatedAt: input.generatedAt };
      writeAtomic(item);
      return item;
    },
    load(microItemId) { return loadRaw(microItemId); },
    list() { return listRaw(); },
    findBySemanticKey(semanticKey) { return listRaw().filter((item) => item.semanticKey === semanticKey); },
    transition(microItemId, next, now, extra) {
      const existing = loadRaw(microItemId);
      if (TERMINAL_STATES.has(existing.state) || !ALLOWED_TRANSITIONS[existing.state].includes(next)) {
        throw new AyasMicroItemStoreError("AYAS_MICRO_ITEM_INVALID_TRANSITION", `cannot transition micro item from ${existing.state} to ${next}`);
      }
      const updated: AyasMicroItem = { ...existing, state: next, lastUpdatedAt: now, ...(extra?.batchId ? { batchId: extra.batchId } : {}) };
      writeAtomic(updated);
      return updated;
    },
  };
}
