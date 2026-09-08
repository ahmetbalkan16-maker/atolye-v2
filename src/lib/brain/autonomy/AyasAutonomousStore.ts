/**
 * AYAS — autonomous-loop checkpoint store (Sprint 186, PHASE 6).
 *
 * The durable half of the continuous loop, so AYAS resumes where it left off.
 * Same rules and shape as `worker/BrainTaskStore.ts`:
 *  - atomic write (temp → fsync → rename);
 *  - corrupt / wrong-shape / wrong-schema file → loud throw, NEVER a silent
 *    "fresh start" (that would hide lost progress);
 *  - every stored string passes `redactBrainText`; a state that still matches a
 *    secret after redaction is rejected;
 *  - deterministic reads.
 *
 *   data/brain/autonomy/state.json    the single current AyasAutonomousState
 *
 * This does NOT run the loop. It only persists it. Nothing here calls a model,
 * a task, the pipeline or the GPU.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { containsBrainSecret, redactBrainText } from "../BrainRedaction";
import {
  ayasAutonomousSchemaVersion,
  type AyasAutonomousState,
} from "./AyasAutonomousLoop";

export type AyasAutonomousStoreErrorCode =
  | "AYAS_STORE_CORRUPT"
  | "AYAS_STORE_SCHEMA_MISMATCH"
  | "AYAS_STORE_IO"
  | "AYAS_STORE_SECRET_LEAK"
  | "AYAS_STORE_INVALID";

export class AyasAutonomousStoreError extends Error {
  constructor(
    readonly code: AyasAutonomousStoreErrorCode,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "AyasAutonomousStoreError";
    this.stack = undefined;
  }
}

function scrub(value: string): string {
  return redactBrainText(String(value ?? "")).text;
}

/** Redact the free-text fields of a state before it is written. */
export function sanitizeAyasStateForStorage(state: AyasAutonomousState): AyasAutonomousState {
  return {
    ...state,
    nextSingleStep: scrub(state.nextSingleStep).slice(0, 400),
    notes: state.notes.map((note) => scrub(note).slice(0, 400)),
    pendingImprovements: state.pendingImprovements.map((ref) => ({ ...ref, title: scrub(ref.title).slice(0, 200) })),
    completedImprovements: state.completedImprovements.map((ref) => ({ ...ref, title: scrub(ref.title).slice(0, 200) })),
    validationResults: state.validationResults.map((v) => ({ ...v, detail: scrub(v.detail).slice(0, 400) })),
    ...(state.observation
      ? { observation: { ...state.observation, gaps: state.observation.gaps.map((g) => scrub(g).slice(0, 400)) } }
      : {}),
  };
}

function assertNoLeak(state: AyasAutonomousState): void {
  const texts = [
    state.nextSingleStep,
    ...state.notes,
    ...state.pendingImprovements.map((r) => r.title),
    ...state.completedImprovements.map((r) => r.title),
    ...state.validationResults.map((v) => v.detail),
    ...(state.observation?.gaps ?? []),
  ];
  if (texts.some(containsBrainSecret)) {
    throw new AyasAutonomousStoreError(
      "AYAS_STORE_SECRET_LEAK",
      "autonomous state still matched a secret pattern after redaction — refusing to persist",
    );
  }
}

export interface AyasAutonomousStoreOptions {
  readonly rootDir?: string;
}

export interface AyasAutonomousStoreHandle {
  /** The persisted state, or `undefined` when there is none. THROWS on corrupt. */
  load(): AyasAutonomousState | undefined;
  /** Validate + redact + persist atomically. */
  save(state: AyasAutonomousState): AyasAutonomousState;
  /** `true` when a checkpoint file exists. */
  exists(): boolean;
  readonly stateFile: string;
}

export function createAyasAutonomousStore(
  options: AyasAutonomousStoreOptions = {},
): AyasAutonomousStoreHandle {
  const rootDir = options.rootDir
    ? path.resolve(options.rootDir)
    : path.join(process.cwd(), "data", "brain");
  const dir = path.join(rootDir, "autonomy");
  const stateFile = path.join(dir, "state.json");

  function ensureDir(): void {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (error) {
      throw new AyasAutonomousStoreError(
        "AYAS_STORE_IO",
        `cannot create ${dir}`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  function writeAtomic(value: unknown): void {
    ensureDir();
    const tmp = path.join(dir, `.state.json.${process.pid}.${crypto.randomUUID()}.tmp`);
    try {
      const handle = fs.openSync(tmp, "w");
      try {
        fs.writeFileSync(handle, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
        fs.fsyncSync(handle);
      } finally {
        fs.closeSync(handle);
      }
      fs.renameSync(tmp, stateFile);
    } catch (error) {
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        /* best effort */
      }
      throw new AyasAutonomousStoreError(
        "AYAS_STORE_IO",
        `atomic write failed for ${stateFile}`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  return {
    stateFile,

    exists(): boolean {
      try {
        return fs.existsSync(stateFile);
      } catch {
        return false;
      }
    },

    load(): AyasAutonomousState | undefined {
      if (!fs.existsSync(stateFile)) return undefined;
      let raw: string;
      try {
        raw = fs.readFileSync(stateFile, "utf-8");
      } catch (error) {
        throw new AyasAutonomousStoreError(
          "AYAS_STORE_IO",
          `cannot read ${stateFile}`,
          error instanceof Error ? error.message : String(error),
        );
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        throw new AyasAutonomousStoreError(
          "AYAS_STORE_CORRUPT",
          "autonomy/state.json is not valid JSON — refusing to touch it (manual review needed)",
          error instanceof Error ? error.message : String(error),
        );
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new AyasAutonomousStoreError("AYAS_STORE_CORRUPT", "autonomy/state.json has an unexpected shape");
      }
      const record = parsed as Record<string, unknown>;
      if (record.schemaVersion !== ayasAutonomousSchemaVersion) {
        throw new AyasAutonomousStoreError(
          "AYAS_STORE_SCHEMA_MISMATCH",
          `autonomy/state.json schemaVersion ${JSON.stringify(record.schemaVersion)} ≠ ${ayasAutonomousSchemaVersion} — no automatic migration`,
        );
      }
      for (const key of ["loopId", "phase", "pendingImprovements", "executionGate"]) {
        if (!(key in record)) {
          throw new AyasAutonomousStoreError("AYAS_STORE_CORRUPT", `autonomy/state.json is missing "${key}"`);
        }
      }
      if (record.executionGate !== "CLOSED") {
        throw new AyasAutonomousStoreError(
          "AYAS_STORE_INVALID",
          `persisted executionGate is "${String(record.executionGate)}" — must be "CLOSED"`,
        );
      }
      return record as unknown as AyasAutonomousState;
    },

    save(state: AyasAutonomousState): AyasAutonomousState {
      if (state.executionGate !== "CLOSED") {
        throw new AyasAutonomousStoreError(
          "AYAS_STORE_INVALID",
          `refusing to persist a state with executionGate "${state.executionGate}"`,
        );
      }
      const sanitized = sanitizeAyasStateForStorage(state);
      assertNoLeak(sanitized);
      writeAtomic(sanitized);
      return sanitized;
    },
  };
}
