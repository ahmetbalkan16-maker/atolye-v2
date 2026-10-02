import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  admitCostReservation, PRODUCTION_COST_LEDGER_SCHEMA_VERSION, summarizeCostLedger,
  type CostLedgerEvent, type CostLedgerSummary, type CostReservationRefusal,
} from "./ProductionCostReservationLedger";

/**
 * Stage 15K — where the cost reservation ledger is kept.
 *
 * One file per event, named by its position: `000001.json`, `000002.json`. An event takes a position only if no
 * file has it, so two writers that both read the same ledger cannot both add the next event: the second one fails,
 * reads again and decides again on what is now there. That is what keeps two concurrent projects from reserving the
 * same allowance. An event file is never rewritten or deleted.
 *
 * The directory is given by the caller. Nothing in the pipeline points this store at a live location yet.
 */
const FILE = /^(\d{6})\.json$/;
/** A writer's private file while it writes an event. Readers skip it. */
const IN_FLIGHT = ".tmp-";
const MAX_EVENTS = 100_000;
const APPEND_ATTEMPTS = 8;

export interface CostLedgerRead { readonly events: readonly unknown[]; readonly summary: CostLedgerSummary; readonly storeProblems: readonly string[] }

/** Reads the ledger. A gap in the numbering, a file that is not JSON or a file that is not an event file is a problem: the ledger is then not trusted. */
export function readCostLedger(dir: string): CostLedgerRead {
  const storeProblems: string[] = [];
  let names: string[];
  try { names = fs.readdirSync(dir); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") names = []; else return { events: [], summary: { ...summarizeCostLedger([]), problems: ["STORE_UNREADABLE"] }, storeProblems: ["STORE_UNREADABLE"] };
  }
  const files = names.filter((name) => FILE.test(name)).sort();
  for (const name of names) if (!FILE.test(name) && !name.startsWith(IN_FLIGHT)) storeProblems.push(`UNEXPECTED_FILE:${name.slice(0, 40)}`);
  const events: unknown[] = [];
  for (const [index, name] of files.entries()) {
    if (Number(FILE.exec(name)![1]) !== index + 1) { storeProblems.push(`SEQUENCE_GAP:${name}`); break; }
    try {
      const record = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as { schemaVersion?: unknown; seq?: unknown; event?: unknown };
      if (record.schemaVersion !== PRODUCTION_COST_LEDGER_SCHEMA_VERSION || record.seq !== index + 1) { storeProblems.push(`RECORD_INVALID:${name}`); break; }
      events.push(record.event);
    } catch { storeProblems.push(`RECORD_UNREADABLE:${name}`); break; }
  }
  if (files.length > MAX_EVENTS) storeProblems.push("TOO_MANY_EVENTS");
  const summary = summarizeCostLedger(events);
  return { events, summary: storeProblems.length ? { ...summary, problems: [...summary.problems, ...storeProblems] } : summary, storeProblems };
}

export type CostLedgerAppendResult = { readonly ok: true; readonly seq: number; readonly summary: CostLedgerSummary } | { readonly ok: false; readonly reason: CostReservationRefusal | "EVENT_REFUSED" | "CONTENDED" | "STORE_WRITE_FAILED" };

/**
 * Adds one event that `decide` chooses from the ledger as it stands. When another writer adds an event first, the
 * ledger is read again and `decide` is asked again, a bounded number of times.
 */
function append(dir: string, decide: (summary: CostLedgerSummary) => { readonly event: CostLedgerEvent } | { readonly refusal: CostReservationRefusal | "EVENT_REFUSED" }): CostLedgerAppendResult {
  for (let attempt = 0; attempt < APPEND_ATTEMPTS; attempt++) {
    const current = readCostLedger(dir);
    if (current.summary.problems.length > 0) return { ok: false, reason: "LEDGER_UNTRUSTED" };
    const decision = decide(current.summary);
    if ("refusal" in decision) return { ok: false, reason: decision.refusal };
    const next = summarizeCostLedger([...current.events, decision.event]);
    if (next.problems.length > 0) return { ok: false, reason: "EVENT_REFUSED" };
    const seq = current.events.length + 1;
    // The event is written whole to a private file first and then linked into place. A link fails if the name exists,
    // so a reader never sees a half-written event and only one writer gets a position.
    const temp = path.join(dir, `${IN_FLIGHT}${process.pid}-${crypto.randomBytes(6).toString("hex")}`);
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(temp, `${JSON.stringify({ schemaVersion: PRODUCTION_COST_LEDGER_SCHEMA_VERSION, seq, event: decision.event }, null, 2)}\n`, { flag: "wx" });
      fs.linkSync(temp, path.join(dir, `${String(seq).padStart(6, "0")}.json`));
      return { ok: true, seq, summary: next };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") return { ok: false, reason: "STORE_WRITE_FAILED" };
    } finally {
      try { fs.rmSync(temp, { force: true }); } catch { /* a leftover private file is ignored by the reader */ }
    }
  }
  return { ok: false, reason: "CONTENDED" };
}

/** Reserves an approved cap for a project, or says why not. The allowance is the owner's declared one. */
export function reserveProjectCost(dir: string, request: { readonly reservationId: string; readonly projectId: string; readonly capUsd: number; readonly at: string }, allowanceUsd: number | null): CostLedgerAppendResult {
  return append(dir, (summary) => {
    const admitted = admitCostReservation(summary, request, allowanceUsd);
    return admitted.ok ? { event: { type: "RESERVE", reservationId: request.reservationId, projectId: request.projectId, capUsd: request.capUsd, at: request.at } } : { refusal: admitted.reason };
  });
}

/** Settles a reservation with what the project actually cost; the unused part of its cap is released. */
export function settleProjectCost(dir: string, request: { readonly reservationId: string; readonly actualUsd: number; readonly at: string }): CostLedgerAppendResult {
  return append(dir, (summary) => (summary.active.some((item) => item.reservationId === request.reservationId) ? { event: { type: "SETTLE", reservationId: request.reservationId, actualUsd: request.actualUsd, at: request.at } } : { refusal: "EVENT_REFUSED" }));
}

/** Releases a reservation whose project did not run. */
export function releaseProjectCost(dir: string, request: { readonly reservationId: string; readonly at: string }): CostLedgerAppendResult {
  return append(dir, (summary) => (summary.active.some((item) => item.reservationId === request.reservationId) ? { event: { type: "RELEASE", reservationId: request.reservationId, at: request.at } } : { refusal: "EVENT_REFUSED" }));
}
