/**
 * Atölye Brain — Self-Healing: durable incident + learned-pattern store (Node).
 *
 * Same rules as `AyasAutonomousStore` / `BrainTaskStore`:
 *  - one JSON file per record; atomic write (temp → fsync → rename);
 *  - every stored string has already passed `redactBrainText` at build time;
 *    `save()` re-checks with `containsBrainSecret` and REJECTS a leak (never
 *    masks-and-keeps);
 *  - a corrupt / wrong-schema / wrong-shape file → loud throw, never a silent
 *    "fresh start";
 *  - deterministic listing (newest first, then id).
 *
 *   data/brain/selfheal/incidents/<id>.json
 *   data/brain/selfheal/learned/<id>.json
 *   data/brain/selfheal/signatures.json    { schemaVersion, entries: [...] }  (mute history)
 *
 * This persists. It does NOT run the loop, spawn git, run a test, or touch the
 * execution gate.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { containsBrainSecret } from "../BrainRedaction";
import {
  brainIncidentSchemaVersion,
  type BrainIncident,
} from "./BrainIncident";
import {
  brainLearnedPatternSchemaVersion,
  type BrainLearnedPattern,
} from "./BrainLearnedPattern";
import type { BrainSignatureHistoryEntry } from "./BrainSelfHealLimits";

export type BrainSelfHealStoreErrorCode =
  | "SELFHEAL_STORE_CORRUPT"
  | "SELFHEAL_STORE_SCHEMA_MISMATCH"
  | "SELFHEAL_STORE_IO"
  | "SELFHEAL_STORE_SECRET_LEAK"
  | "SELFHEAL_STORE_INVALID";

export class BrainSelfHealStoreError extends Error {
  constructor(
    readonly code: BrainSelfHealStoreErrorCode,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "BrainSelfHealStoreError";
    this.stack = undefined;
  }
}

const ID_RE = /^[A-Za-z0-9._-]{1,80}$/;

function assertNoLeak(record: unknown, where: string): void {
  const walk = (v: unknown): void => {
    if (typeof v === "string") {
      if (containsBrainSecret(v)) {
        throw new BrainSelfHealStoreError("SELFHEAL_STORE_SECRET_LEAK", `${where}: a string still matches a secret pattern after redaction — refusing to store`);
      }
    } else if (Array.isArray(v)) {
      v.forEach(walk);
    } else if (v && typeof v === "object") {
      Object.values(v).forEach(walk);
    }
  };
  walk(record);
}

export interface BrainSelfHealStoreOptions {
  readonly rootDir?: string;
}

export interface BrainSelfHealStoreHandle {
  readonly dir: string;
  saveIncident(incident: BrainIncident): BrainIncident;
  loadIncident(id: string): BrainIncident | undefined;
  listIncidents(): readonly BrainIncident[];
  saveLearnedPattern(pattern: BrainLearnedPattern): BrainLearnedPattern;
  loadLearnedPattern(id: string): BrainLearnedPattern | undefined;
  listLearnedPatterns(): readonly BrainLearnedPattern[];
  /** Mute-history: when incidents were opened per signature. */
  recordSignature(entry: BrainSignatureHistoryEntry): void;
  loadSignatureHistory(): readonly BrainSignatureHistoryEntry[];
}

export function createBrainSelfHealStore(options: BrainSelfHealStoreOptions = {}): BrainSelfHealStoreHandle {
  const rootDir = options.rootDir ? path.resolve(options.rootDir) : path.join(process.cwd(), "data", "brain");
  const dir = path.join(rootDir, "selfheal");
  const incidentsDir = path.join(dir, "incidents");
  const learnedDir = path.join(dir, "learned");
  const signaturesFile = path.join(dir, "signatures.json");

  function ensureDir(d: string): void {
    try {
      fs.mkdirSync(d, { recursive: true });
    } catch (error) {
      throw new BrainSelfHealStoreError("SELFHEAL_STORE_IO", `cannot create ${d}`, err(error));
    }
  }

  function writeAtomic(file: string, value: unknown): void {
    ensureDir(path.dirname(file));
    const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      const handle = fs.openSync(tmp, "w");
      try {
        fs.writeFileSync(handle, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
        fs.fsyncSync(handle);
      } finally {
        fs.closeSync(handle);
      }
      fs.renameSync(tmp, file);
    } catch (error) {
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        /* best effort */
      }
      throw new BrainSelfHealStoreError("SELFHEAL_STORE_IO", `atomic write failed for ${file}`, err(error));
    }
  }

  function readJson(file: string, expectedSchema: string, requiredKeys: readonly string[]): Record<string, unknown> | undefined {
    if (!fs.existsSync(file)) return undefined;
    let raw: string;
    try {
      raw = fs.readFileSync(file, "utf-8");
    } catch (error) {
      throw new BrainSelfHealStoreError("SELFHEAL_STORE_IO", `cannot read ${file}`, err(error));
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new BrainSelfHealStoreError("SELFHEAL_STORE_CORRUPT", `${path.basename(file)} is not valid JSON — refusing to touch it`, err(error));
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new BrainSelfHealStoreError("SELFHEAL_STORE_CORRUPT", `${path.basename(file)} has an unexpected shape`);
    }
    const record = parsed as Record<string, unknown>;
    if (record.schemaVersion !== expectedSchema) {
      throw new BrainSelfHealStoreError(
        "SELFHEAL_STORE_SCHEMA_MISMATCH",
        `${path.basename(file)} schemaVersion ${JSON.stringify(record.schemaVersion)} ≠ ${expectedSchema} — no automatic migration`,
      );
    }
    for (const key of requiredKeys) {
      if (!(key in record)) {
        throw new BrainSelfHealStoreError("SELFHEAL_STORE_CORRUPT", `${path.basename(file)} is missing "${key}"`);
      }
    }
    return record;
  }

  function listDir(d: string): string[] {
    try {
      return fs
        .readdirSync(d)
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.slice(0, -5));
    } catch {
      return [];
    }
  }

  function loadIncident(id: string): BrainIncident | undefined {
    if (!ID_RE.test(id)) throw new BrainSelfHealStoreError("SELFHEAL_STORE_INVALID", `bad incident id ${JSON.stringify(id)}`);
    const record = readJson(path.join(incidentsDir, `${id}.json`), brainIncidentSchemaVersion, ["id", "status", "category", "symptom"]);
    return record as unknown as BrainIncident | undefined;
  }

  function loadLearnedPattern(id: string): BrainLearnedPattern | undefined {
    if (!ID_RE.test(id)) throw new BrainSelfHealStoreError("SELFHEAL_STORE_INVALID", `bad pattern id ${JSON.stringify(id)}`);
    const record = readJson(path.join(learnedDir, `${id}.json`), brainLearnedPatternSchemaVersion, ["id", "signature", "rootCause", "successfulFix"]);
    return record as unknown as BrainLearnedPattern | undefined;
  }

  function loadSignatureHistory(): readonly BrainSignatureHistoryEntry[] {
    const record = readJson(signaturesFile, "1", ["entries"]);
    if (!record) return [];
    const entries = record.entries;
    if (!Array.isArray(entries)) throw new BrainSelfHealStoreError("SELFHEAL_STORE_CORRUPT", "signatures.json entries is not an array");
    return entries as BrainSignatureHistoryEntry[];
  }

  const byUpdatedDesc = <T extends { updatedAt: string; id: string }>(a: T, b: T): number =>
    b.updatedAt < a.updatedAt ? -1 : b.updatedAt > a.updatedAt ? 1 : a.id.localeCompare(b.id);

  return {
    dir,
    loadIncident,
    loadLearnedPattern,
    loadSignatureHistory,

    saveIncident(incident: BrainIncident): BrainIncident {
      if (!ID_RE.test(incident.id)) {
        throw new BrainSelfHealStoreError("SELFHEAL_STORE_INVALID", `bad incident id ${JSON.stringify(incident.id)}`);
      }
      if (incident.schemaVersion !== brainIncidentSchemaVersion) {
        throw new BrainSelfHealStoreError("SELFHEAL_STORE_SCHEMA_MISMATCH", `incident schemaVersion ${incident.schemaVersion} ≠ ${brainIncidentSchemaVersion}`);
      }
      assertNoLeak(incident, `incident ${incident.id}`);
      writeAtomic(path.join(incidentsDir, `${incident.id}.json`), incident);
      return incident;
    },

    listIncidents(): readonly BrainIncident[] {
      return listDir(incidentsDir)
        .map(loadIncident)
        .filter((x): x is BrainIncident => Boolean(x))
        .sort(byUpdatedDesc);
    },

    saveLearnedPattern(pattern: BrainLearnedPattern): BrainLearnedPattern {
      if (!ID_RE.test(pattern.id)) {
        throw new BrainSelfHealStoreError("SELFHEAL_STORE_INVALID", `bad pattern id ${JSON.stringify(pattern.id)}`);
      }
      if (pattern.schemaVersion !== brainLearnedPatternSchemaVersion) {
        throw new BrainSelfHealStoreError("SELFHEAL_STORE_SCHEMA_MISMATCH", `pattern schemaVersion ${pattern.schemaVersion} ≠ ${brainLearnedPatternSchemaVersion}`);
      }
      assertNoLeak(pattern, `pattern ${pattern.id}`);
      writeAtomic(path.join(learnedDir, `${pattern.id}.json`), pattern);
      return pattern;
    },

    listLearnedPatterns(): readonly BrainLearnedPattern[] {
      return listDir(learnedDir)
        .map(loadLearnedPattern)
        .filter((x): x is BrainLearnedPattern => Boolean(x))
        .sort(byUpdatedDesc);
    },

    recordSignature(entry: BrainSignatureHistoryEntry): void {
      const existing = loadSignatureHistory();
      const latest = Math.max(entry.openedAt, ...existing.map((e) => e.openedAt), Date.now());
      const cutoff = latest - 7 * 24 * 60 * 60 * 1000;
      const entries = [...existing, entry].filter((e) => e.openedAt >= cutoff).slice(-500);
      writeAtomic(signaturesFile, { schemaVersion: "1", entries });
    },
  };
}

function err(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
