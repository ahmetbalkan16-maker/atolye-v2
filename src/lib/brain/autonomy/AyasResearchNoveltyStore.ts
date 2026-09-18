import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { AyasResearchDisposition } from "./AyasResearchDisposition";

/**
 * AYAS EXTERNAL RESEARCH INTELLIGENCE sprint — durable novelty memory.
 *
 * The DEEP scan previously decided "have I seen this?" by scanning every
 * recorded finding for a matching `sourceUrl`. That answers the question
 * only for items that became findings: an entry judged not-noteworthy left
 * no trace at all, so the very next scan re-fetched it, re-prompted the
 * model about it, and re-reached the same conclusion — paying the full
 * analysis cost again, forever, for every uninteresting release note in
 * every watched feed.
 *
 * This store remembers the ITEM, independently of whether it became a
 * finding: its identity, what it looked like, when it was first and last
 * seen, and what AYAS concluded. That makes repeat work cheap to skip and
 * makes "has this materially changed?" answerable.
 *
 * Materially changed is defined narrowly and structurally: a different
 * version/release identifier, or a different content fingerprint, for the
 * same normalized URL. A feed re-ordering entries, re-rendering identical
 * HTML, or changing tracking parameters in a link is NOT a change and must
 * not reopen evaluation — which is exactly why the URL is normalized and
 * the fingerprint is taken over the meaningful text rather than raw bytes.
 *
 * Storage follows this codebase's established durable-record convention
 * exactly (one JSON file per record, atomic temp+fsync+rename write, a
 * corrupt record never blocks reading the rest) — see
 * `AyasResearchSourceStateStore.ts` and `AyasGraphifyEvidenceStore.ts`.
 */
export const ayasResearchNoveltySchemaVersion = "1" as const;

export interface AyasResearchSeenItem {
  readonly schemaVersion: typeof ayasResearchNoveltySchemaVersion;
  /** Deterministic id derived from the normalized URL — stable across runs and machines. */
  readonly itemId: string;
  readonly sourceId: string;
  /** The item URL with volatile parts stripped — the identity key. */
  readonly normalizedUrl: string;
  /** The release/version identifier when the item states one (e.g. "v1.2.3"), else `null`. Never guessed. */
  readonly versionTag: string | null;
  /** Fingerprint of the item's meaningful text — what detects a real edit when the version tag alone does not move. */
  readonly contentFingerprint: string;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  /** How many scans have observed this exact item. Useful evidence when judging whether a feed is churning. */
  readonly timesSeen: number;
  /** What AYAS concluded last time, so a re-seen item can be skipped without re-deciding. */
  readonly lastDisposition?: AyasResearchDisposition;
  /** The finding this item produced, when it produced one. */
  readonly lastFindingId?: string;
  /** True when the model judged the item not worth recording — the case the old sourceUrl-only dedup could never remember. */
  readonly lastJudgedNotNoteworthy?: boolean;
}

export interface AyasResearchNoveltyVerdict {
  /** `true` when this item has never been seen, or has materially changed since it was. */
  readonly isNovel: boolean;
  /** Why — a stable code, not prose. */
  readonly reasonCode: "NEVER_SEEN" | "NEW_VERSION" | "CONTENT_CHANGED" | "UNCHANGED";
  readonly prior?: AyasResearchSeenItem;
}

export interface AyasResearchNoveltyObservation {
  readonly sourceId: string;
  readonly url: string;
  readonly versionTag?: string | null;
  /** The meaningful text of the item (title + summary). Fingerprinted, never stored verbatim. */
  readonly contentText: string;
}

export interface AyasResearchNoveltyStoreOptions { readonly rootDir?: string }

export interface AyasResearchNoveltyStore {
  readonly dir: string;
  /** Pure read: does this observation represent something new? Never writes. */
  assess(observation: AyasResearchNoveltyObservation): AyasResearchNoveltyVerdict;
  /** Records that this item was seen and what was concluded about it. */
  remember(observation: AyasResearchNoveltyObservation, outcome?: { readonly disposition?: AyasResearchDisposition; readonly findingId?: string; readonly judgedNotNoteworthy?: boolean }): AyasResearchSeenItem;
  list(): readonly AyasResearchSeenItem[];
}

/**
 * Strips the parts of a URL that change without the underlying item
 * changing: the fragment, and the tracking/campaign query parameters feeds
 * routinely append. Everything else is preserved — two genuinely different
 * releases must never collapse onto one identity.
 */
export function normalizeAyasResearchUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.hash = "";
    const volatile = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "ref", "ref_src", "s", "fbclid", "gclid"];
    for (const key of volatile) url.searchParams.delete(key);
    url.searchParams.sort();
    // A trailing slash is not a different resource.
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) url.pathname = url.pathname.replace(/\/+$/, "");
    url.hostname = url.hostname.toLowerCase();
    return url.toString();
  } catch {
    return String(rawUrl ?? "").trim();
  }
}

/** Fingerprints the item's meaningful text, insensitive to whitespace-only churn (a feed re-rendering the same note must not look like an edit). */
export function ayasResearchContentFingerprint(contentText: string): string {
  const normalized = String(contentText ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  return crypto.createHash("sha256").update(normalized, "utf8").digest("hex");
}

function itemIdFor(normalizedUrl: string): string {
  return crypto.createHash("sha256").update(normalizedUrl, "utf8").digest("hex").slice(0, 40);
}

export function createAyasResearchNoveltyStore(options: AyasResearchNoveltyStoreOptions = {}): AyasResearchNoveltyStore {
  const dir = path.resolve(options.rootDir ?? path.join(process.cwd(), "data", "brain", "self-improvement", "research-novelty"));

  const fileFor = (itemId: string): string => path.join(dir, `${itemId}.json`);

  const readItem = (itemId: string): AyasResearchSeenItem | undefined => {
    try {
      const parsed = JSON.parse(fs.readFileSync(fileFor(itemId), "utf8")) as AyasResearchSeenItem;
      return parsed?.schemaVersion === ayasResearchNoveltySchemaVersion ? parsed : undefined;
    } catch {
      return undefined; // never seen, or corrupt — both mean "no usable memory of this item", never a crash
    }
  };

  const writeItem = (item: AyasResearchSeenItem): void => {
    fs.mkdirSync(dir, { recursive: true });
    const target = fileFor(item.itemId);
    const tmp = path.join(dir, `.${item.itemId}.${process.pid}.${crypto.randomUUID()}.tmp`);
    try {
      const fd = fs.openSync(tmp, "wx");
      try { fs.writeFileSync(fd, `${JSON.stringify(item, null, 2)}\n`, "utf8"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(tmp, target);
    } catch (error) {
      try { fs.rmSync(tmp, { force: true }); } catch { /* fail closed */ }
      throw error;
    }
  };

  const assess = (observation: AyasResearchNoveltyObservation): AyasResearchNoveltyVerdict => {
    const normalizedUrl = normalizeAyasResearchUrl(observation.url);
    const prior = readItem(itemIdFor(normalizedUrl));
    if (!prior) return { isNovel: true, reasonCode: "NEVER_SEEN" };

    const versionTag = observation.versionTag ?? null;
    // A version tag that actually moved is the clearest possible signal
    // that this is a different release, and it outranks the fingerprint.
    if (versionTag !== null && prior.versionTag !== null && versionTag !== prior.versionTag) {
      return { isNovel: true, reasonCode: "NEW_VERSION", prior };
    }
    if (ayasResearchContentFingerprint(observation.contentText) !== prior.contentFingerprint) {
      return { isNovel: true, reasonCode: "CONTENT_CHANGED", prior };
    }
    return { isNovel: false, reasonCode: "UNCHANGED", prior };
  };

  return {
    dir,
    assess,
    remember(observation, outcome = {}) {
      const normalizedUrl = normalizeAyasResearchUrl(observation.url);
      const itemId = itemIdFor(normalizedUrl);
      const prior = readItem(itemId);
      const now = new Date().toISOString();
      const item: AyasResearchSeenItem = {
        schemaVersion: ayasResearchNoveltySchemaVersion,
        itemId,
        sourceId: observation.sourceId,
        normalizedUrl,
        versionTag: observation.versionTag ?? null,
        contentFingerprint: ayasResearchContentFingerprint(observation.contentText),
        firstSeenAt: prior?.firstSeenAt ?? now,
        lastSeenAt: now,
        timesSeen: (prior?.timesSeen ?? 0) + 1,
        ...(outcome.disposition ? { lastDisposition: outcome.disposition } : prior?.lastDisposition ? { lastDisposition: prior.lastDisposition } : {}),
        ...(outcome.findingId ? { lastFindingId: outcome.findingId } : prior?.lastFindingId ? { lastFindingId: prior.lastFindingId } : {}),
        ...(outcome.judgedNotNoteworthy === undefined ? (prior?.lastJudgedNotNoteworthy === undefined ? {} : { lastJudgedNotNoteworthy: prior.lastJudgedNotNoteworthy }) : { lastJudgedNotNoteworthy: outcome.judgedNotNoteworthy }),
      };
      writeItem(item);
      return item;
    },
    list() {
      if (!fs.existsSync(dir)) return [];
      const out: AyasResearchSeenItem[] = [];
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith(".json") || f.startsWith(".")) continue;
        try {
          const parsed = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as AyasResearchSeenItem;
          if (parsed?.schemaVersion === ayasResearchNoveltySchemaVersion) out.push(parsed);
        } catch { /* a corrupt record never blocks reading the rest */ }
      }
      return out;
    },
  };
}
