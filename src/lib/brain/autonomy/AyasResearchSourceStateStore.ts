import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * AYAS CONTINUOUS EXTERNAL INTELLIGENCE sprint, Part E — durable per-source
 * check state for the LIGHT scan's cheap "did anything change" pass. One
 * file per `sourceId` (this codebase's established convention for a
 * durable, independently-corruptible-without-taking-down-the-rest record —
 * see `AyasGraphifyEvidenceStore.ts`, `AyasMicroItem.ts`), atomic write
 * (temp file + fsync + rename), never partially written.
 */
export const ayasResearchSourceStateSchemaVersion = "1" as const;

export type AyasResearchSourceCheckStatus = "OK" | "UNCHANGED" | "ERROR";

export interface AyasResearchSourceCheckState {
  readonly schemaVersion: typeof ayasResearchSourceStateSchemaVersion;
  readonly sourceId: string;
  readonly lastCheckedAt: string;
  readonly lastChangedAt?: string;
  readonly etag?: string;
  readonly lastModified?: string;
  readonly contentHash?: string;
  readonly status: AyasResearchSourceCheckStatus;
  readonly lastError?: string;
  readonly consecutiveFailures: number;
  /**
   * AYAS EXTERNAL RESEARCH INTELLIGENCE sprint — durable health metadata.
   * All OPTIONAL on purpose: a state file written before these fields
   * existed stays readable under the same `schemaVersion`, so adding
   * health visibility never invalidates live production state. A record
   * missing them simply reports less detail, never an error.
   */
  /** Which class of failure this was (`AyasFetchFailureClass`), so a reader can tell "the network blipped" from "this endpoint is gone" without re-parsing an error string. */
  readonly lastFailureClass?: string;
  /** The last time this source was fetched successfully — what distinguishes "failing but recently fine" from "has not worked in days". */
  readonly lastSuccessAt?: string;
  /** Whether the last successful read was a bounded PREFIX rather than the full body. Not a failure: a normal, expected condition for a very large official feed. */
  readonly lastReadTruncated?: boolean;
  /** Advisory wait the endpoint itself asked for, when it was rate limited. */
  readonly retryAfterMs?: number;
}

export interface AyasResearchSourceStateStoreOptions { readonly rootDir?: string }

export interface AyasResearchSourceStateStore {
  readonly dir: string;
  read(sourceId: string): AyasResearchSourceCheckState | undefined;
  list(): readonly AyasResearchSourceCheckState[];
  write(state: Omit<AyasResearchSourceCheckState, "schemaVersion">): AyasResearchSourceCheckState;
}

const SAFE_ID = /^[a-zA-Z0-9._-]{1,120}$/;

export function createAyasResearchSourceStateStore(options: AyasResearchSourceStateStoreOptions = {}): AyasResearchSourceStateStore {
  const dir = path.resolve(options.rootDir ?? path.join(process.cwd(), "data", "brain", "self-improvement", "research-sources"));
  const fileFor = (sourceId: string): string => {
    if (!SAFE_ID.test(sourceId)) throw new Error(`AYAS_RESEARCH_SOURCE_STATE_INVALID_ID: ${sourceId}`);
    return path.join(dir, `${sourceId}.json`);
  };

  return {
    dir,
    read(sourceId) {
      try {
        const raw = JSON.parse(fs.readFileSync(fileFor(sourceId), "utf8")) as AyasResearchSourceCheckState;
        return raw?.schemaVersion === ayasResearchSourceStateSchemaVersion ? raw : undefined;
      } catch {
        return undefined; // no prior state file, or corrupt — treated as "never checked", never crashes the scan
      }
    },
    list() {
      if (!fs.existsSync(dir)) return [];
      const out: AyasResearchSourceCheckState[] = [];
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith(".json") || f.startsWith(".")) continue;
        try {
          const parsed = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as AyasResearchSourceCheckState;
          if (parsed?.schemaVersion === ayasResearchSourceStateSchemaVersion) out.push(parsed);
        } catch { /* a corrupt record never blocks reading the rest */ }
      }
      return out;
    },
    write(state) {
      const full: AyasResearchSourceCheckState = { schemaVersion: ayasResearchSourceStateSchemaVersion, ...state };
      fs.mkdirSync(dir, { recursive: true });
      const target = fileFor(state.sourceId);
      const tmp = path.join(dir, `.${state.sourceId}.${process.pid}.${crypto.randomUUID()}.tmp`);
      try {
        const fd = fs.openSync(tmp, "wx");
        try { fs.writeFileSync(fd, `${JSON.stringify(full, null, 2)}\n`, "utf8"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        fs.renameSync(tmp, target);
      } catch (error) {
        try { fs.rmSync(tmp, { force: true }); } catch { /* fail closed */ }
        throw error;
      }
      return full;
    },
  };
}

export function ayasContentHash(body: string): string {
  return crypto.createHash("sha256").update(body, "utf8").digest("hex");
}
