import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { PERFORMANCE_METRICS, type PerformanceMetric, SHARE_METRICS, type VideoPerformanceRecord } from "./ChannelGoals";

/**
 * Post-publish numbers per video (owner, 5 Nov 2026): `<workRoot>/_kutuphane/kanal/performans/<videoId>-<olcumAni>-<date>.json`.
 * The channel has no Analytics API connection (owner, 3 Nov 2026: uploads and Studio by hand), so the owner's reading of
 * YouTube Studio is the source; a later API reader writes the same shape with `kaynak: "youtube-analytics-api"`.
 * Nothing is estimated: a number Studio did not show is stored as null and reported as not measured.
 */

export function performanceDir(workRoot: string): string {
  return path.join(workRoot, "_kutuphane", "kanal", "performans");
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

function fail(why: string): never {
  throw new Error(`PERFORMANCE_INPUT_INVALID: ${why}`);
}

/** A share as 0..1; "52%", "52" or 52 (above 1 and at most 100) are read as percent. Loops let a viewed share pass 1. */
function share(value: unknown, key: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  const text = typeof value === "string" ? value.trim().replace(",", ".") : value;
  const percent = typeof text === "string" && text.endsWith("%");
  const n = Number(typeof text === "string" ? text.replace(/%$/, "") : text);
  if (!Number.isFinite(n) || n < 0) fail(`${key} sayı değil: ${String(value)}`);
  const x = percent || n > (key === "ortGoruntulenenYuzde" ? 3 : 1) ? n / 100 : n;
  if (x > (key === "ortGoruntulenenYuzde" ? 3 : 1)) fail(`${key} oran olarak çok büyük: ${String(value)}`);
  return Math.round(x * 10_000) / 10_000;
}

/** A count or a duration; Studio's Turkish "1.203" (thousands) and "3,9" (decimal comma) are read as written. */
function count(value: unknown, key: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  const text = typeof value === "string" ? value.trim() : undefined;
  const n = Number(text === undefined ? value : /^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(text) ? text.replace(/\./g, "").replace(",", ".") : text.replace(",", "."));
  if (!Number.isFinite(n) || n < 0) fail(`${key} sayı değil: ${String(value)}`);
  return n;
}

/** Validates the owner's JSON (Turkish decimal commas and percent signs accepted) into a record. */
export function parsePerformanceInput(raw: unknown, now: Date = new Date()): VideoPerformanceRecord {
  const r = raw as Record<string, unknown>;
  if (!r || typeof r !== "object") fail("JSON nesnesi bekleniyor");
  const videoId = String(r.videoId ?? "").trim();
  if (!VIDEO_ID.test(videoId)) fail(`videoId 11 karakterlik YouTube kimliği olmalı (büyük/küçük harf önemli): "${videoId}"`);
  const sureSn = Number(r.sureSn);
  if (!(sureSn > 0)) fail("sureSn (videonun süresi) gerekli");
  const olcumAni = String(r.olcumAni ?? "").trim();
  if (!olcumAni) fail('olcumAni gerekli ("48s", "7g" ya da başka bir etiket)');
  const olcumTarihi = String(r.olcumTarihi ?? now.toISOString().slice(0, 10));
  if (!/^\d{4}-\d{2}-\d{2}/.test(olcumTarihi)) fail("olcumTarihi YYYY-AA-GG olmalı");
  const m = (r.metrikler ?? {}) as Record<string, unknown>;
  const unknown = Object.keys(m).filter((k) => !(PERFORMANCE_METRICS as readonly string[]).includes(k));
  if (unknown.length) fail(`bilinmeyen metrik: ${unknown.join(", ")} (bilinenler: ${PERFORMANCE_METRICS.join(", ")})`);
  const metrikler = Object.fromEntries(PERFORMANCE_METRICS.map((k) => [k, SHARE_METRICS.has(k) ? share(m[k], k) : count(m[k], k)])) as Record<PerformanceMetric, number | null>;
  const kaynak = r.kaynak === "youtube-analytics-api" ? "youtube-analytics-api" : "studio-elle";
  const ulkeler = Array.isArray(r.ulkeler)
    ? r.ulkeler.map((u: Record<string, unknown>) => {
        const ulke = String(u.ulke ?? "").trim().toUpperCase();
        if (!/^[A-Z]{2}$/.test(ulke)) fail(`ülke kodu iki harf olmalı: "${String(u.ulke)}"`);
        const pay = share(u.pay, `ulkeler.${ulke}.pay`), goruntuleme = count(u.goruntuleme, `ulkeler.${ulke}.goruntuleme`), ortIzlemeSn = count(u.ortIzlemeSn, `ulkeler.${ulke}.ortIzlemeSn`);
        return { ulke, ...(pay !== null ? { pay } : {}), ...(goruntuleme !== null ? { goruntuleme } : {}), ...(ortIzlemeSn !== null ? { ortIzlemeSn } : {}) };
      })
    : undefined;
  const trafik = r.trafik && typeof r.trafik === "object" ? Object.fromEntries(Object.entries(r.trafik as Record<string, unknown>).map(([k, v]) => [k, share(v, `trafik.${k}`)]).filter((e): e is [string, number] => e[1] !== null)) : undefined;
  return {
    schemaVersion: 1, videoId, sureSn, olcumTarihi, olcumAni, kaynak, metrikler,
    ...(typeof r.baslik === "string" && r.baslik.trim() ? { baslik: r.baslik.trim() } : {}),
    ...(typeof r.yayinZamani === "string" ? { yayinZamani: r.yayinZamani } : {}),
    ...(typeof r.siparisId === "string" ? { siparisId: r.siparisId } : {}),
    ...(Number.isInteger(r.pilotNo) ? { pilotNo: r.pilotNo as number } : {}),
    ...(typeof r.dizi === "string" ? { dizi: r.dizi } : {}),
    ...(ulkeler ? { ulkeler } : {}),
    ...(trafik && Object.keys(trafik).length ? { trafik } : {}),
    ...(typeof r.not === "string" ? { not: r.not } : {}),
  };
}

export function performanceFile(workRoot: string, record: Pick<VideoPerformanceRecord, "videoId" | "olcumAni" | "olcumTarihi">): string {
  const tag = record.olcumAni.replace(/[^A-Za-z0-9]+/g, "-").slice(0, 16) || "olcum";
  return path.join(performanceDir(workRoot), `${record.videoId}-${tag}-${record.olcumTarihi.slice(0, 10)}.json`);
}

/** Writes (or replaces the same video, moment and day's) record atomically; other records are never touched. */
export async function savePerformance(workRoot: string, record: VideoPerformanceRecord): Promise<string> {
  const file = performanceFile(workRoot, record);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(`${file}.tmp`, `${JSON.stringify(record, null, 2)}\n`);
  await fs.rename(`${file}.tmp`, file);
  return file;
}

export async function listPerformance(workRoot: string): Promise<VideoPerformanceRecord[]> {
  const dir = performanceDir(workRoot);
  if (!existsSync(dir)) return [];
  const out: VideoPerformanceRecord[] = [];
  for (const name of (await fs.readdir(dir)).filter((n) => n.endsWith(".json")).sort()) {
    try {
      out.push(JSON.parse(await fs.readFile(path.join(dir, name), "utf8")) as VideoPerformanceRecord);
    } catch {
      // A half-written file is read on the next pass.
    }
  }
  return out;
}
