/**
 * AYAS Memory Temporal v2 — retrieval latency benchmark (pure, no IO).
 *
 *   npx tsx scripts/bench-ayas-memory-temporal.ts
 *
 * A deterministic 500-record corpus: an identity chain with corrections,
 * response-length preference changes and independent notes. Arms: current
 * recall, as-of point, as-of window, history. The v1-shaped corpus (no
 * temporal blocks) also runs unchanged against pre-v2 sources, which ignore
 * the temporal option — that is how the v1 baseline is measured.
 */

import { performance } from "node:perf_hooks";

import { retrieveAyasMemory } from "../src/lib/ayas/memory/AyasMemoryRetrieval";
import { buildBrainMemoryRecord } from "../src/lib/brain/BrainMemoryModel";
import type { BrainMemoryRecord } from "../src/types/brainMemory";

const NOW = "2026-09-23T12:00:00.000Z";
const BASE = Date.parse("2026-04-01T00:00:00.000Z");
const REPETITIONS = 25;
const WARMUP = 5;

function corpus(v2: boolean): BrainMemoryRecord[] {
  const names = ["ahmet", "mehmet", "veli", "deniz", "atlas"];
  const records: BrainMemoryRecord[] = [];
  for (let index = 0; index < 500; index += 1) {
    const observedAt = new Date(BASE + index * 6 * 3_600_000).toISOString();
    const kind = index % 8 === 0 ? "identity" : index % 8 === 1 ? "length" : "note";
    const body =
      kind === "identity" ? `beni ${names[(index / 8) % 5 | 0]} olarak hatırla`
        : kind === "length" ? `bundan sonra cevapları ${index % 16 === 1 ? "kısa" : "uzun ve detaylı"} tut`
          : `Mimar Sinan belgeseli ${index} numaralı sahne notu: render ffmpeg pipeline ayarı ${index % 7}`;
    const fact = kind === "identity"
      ? { factKey: "user.identity.name", factValue: names[(index / 8) % 5 | 0] }
      : kind === "length" ? { factKey: "user.preference.response-length", factValue: index % 16 === 1 ? "short" : "long" } : {};
    records.push(buildBrainMemoryRecord({
      kind: kind === "note" ? "decision" : "user-preference",
      title: kind === "identity" ? "Kullanıcı kimliği / hitap tercihi" : kind === "length" ? "Kullanıcı tercihi" : "Alınan karar",
      body,
      importance: "durable",
      confidence: "reported",
      tags: kind === "identity" ? ["kimlik"] : kind === "length" ? ["tercih"] : ["karar", "mimar-sinan"],
      observedAt,
      links: [],
      ...(v2 ? { temporal: { assertion: "current" as const, provenance: "direct-user-statement" as const, recordedAt: observedAt, ...fact } } : {}),
    }));
  }
  return records;
}

type Options = Parameters<typeof retrieveAyasMemory>[2];

function measure(records: BrainMemoryRecord[], query: string, options: Options) {
  for (let index = 0; index < WARMUP; index += 1) retrieveAyasMemory(records, query, options);
  const samples: number[] = [];
  for (let index = 0; index < REPETITIONS; index += 1) {
    const started = performance.now();
    retrieveAyasMemory(records, query, options);
    samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  return {
    meanMs: Number(mean.toFixed(3)),
    medianMs: Number(samples[Math.floor(samples.length / 2)].toFixed(3)),
    p95Ms: Number(samples[Math.ceil(samples.length * 0.95) - 1].toFixed(3)),
  };
}

const arms: Record<string, Options> = {
  current: { nowIso: NOW },
  asOfPoint: { nowIso: NOW, temporal: { mode: "as-of", at: "2026-06-01T00:00:00.000Z" } } as Options,
  asOfWindow: { nowIso: NOW, temporal: { mode: "as-of", at: "2026-05-01T00:00:00.000Z", until: "2026-06-01T00:00:00.000Z" } } as Options,
  history: { nowIso: NOW, temporal: { mode: "current", includeHistory: true } } as Options,
};

const result: Record<string, Record<string, unknown>> = {};
for (const shape of ["v1Corpus", "v2Corpus"] as const) {
  const records = corpus(shape === "v2Corpus");
  result[shape] = {};
  for (const [arm, options] of Object.entries(arms)) {
    result[shape][arm] = measure(records, "benim adım ne ve render ffmpeg ayarı neydi", options);
  }
}
console.log(JSON.stringify({ benchmark: "ayas-memory-temporal-retrieval", corpusSize: 500, repetitions: REPETITIONS, ...result }, null, 2));
