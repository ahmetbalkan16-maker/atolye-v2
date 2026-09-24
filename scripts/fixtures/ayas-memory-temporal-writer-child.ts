/**
 * Child process for `smoke-ayas-memory-temporal.ts`: appends alternating
 * identity corrections to the memory store under the TEMP root it is given,
 * racing a sibling process, and prints one JSON line with every outcome.
 *
 *   tsx ayas-memory-temporal-writer-child.ts <tempRootDir> <workerId> <count>
 *
 * Never falls back to a default root. Relative imports only.
 */

import os from "node:os";
import path from "node:path";

import { AyasMemoryStoreError, createAyasMemoryStore } from "../../src/lib/ayas/memory/AyasMemoryStore";
import { buildBrainMemoryRecord } from "../../src/lib/brain/BrainMemoryModel";

const [rootDir, workerArg, countArg] = process.argv.slice(2);
const worker = Number(workerArg);
const count = Number(countArg);
const tempRoot = path.resolve(os.tmpdir());
if (!rootDir || !path.resolve(rootDir).startsWith(tempRoot) || !Number.isInteger(worker) || !Number.isInteger(count)) {
  console.error("usage: <tempRootDir under os.tmpdir()> <workerId> <count>");
  process.exit(2);
}

const store = createAyasMemoryStore({ rootDir });
const outcomes: { recordId: string; result: string; attempts: number }[] = [];

/** Like the real writer: a busy lock is CONFLICT, answered with an async back-off and a retry. */
async function appendWithRetry(record: Parameters<typeof store.append>[0]): Promise<{ result: string; attempts: number }> {
  for (let attempt = 1; attempt <= 50; attempt += 1) {
    try {
      return { result: store.append(record), attempts: attempt };
    } catch (error) {
      const code = error instanceof AyasMemoryStoreError ? error.code : "UNEXPECTED";
      if (code !== "AYAS_MEMORY_STORE_CONFLICT") return { result: code, attempts: attempt };
      await new Promise((resolve) => setTimeout(resolve, 2 + ((attempt * 7 + worker * 3) % 11)));
    }
  }
  return { result: "AYAS_MEMORY_STORE_CONFLICT", attempts: 50 };
}

async function main(): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const name = (index + worker) % 2 === 0 ? "ahmet" : "mehmet";
    // Distinct instants per worker, so the race is about storage, not ordering.
    const observedAt = new Date(Date.UTC(2026, 0, 1) + (index * 2 + worker) * 60_000).toISOString();
    const record = buildBrainMemoryRecord({
      kind: "user-preference",
      title: "Kullanıcı kimliği / hitap tercihi",
      body: `beni ${name} olarak hatırla (w${worker}-${index})`,
      importance: "durable",
      confidence: "reported",
      tags: ["kimlik"],
      observedAt,
      links: [],
      temporal: {
        assertion: "current",
        provenance: "explicit-correction",
        recordedAt: observedAt,
        factKey: "user.identity.name",
        factValue: name,
      },
    });
    outcomes.push({ recordId: record.recordId, ...(await appendWithRetry(record)) });
  }
  console.log(JSON.stringify({ worker, outcomes }));
}

void main();
