import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { applicationGate, canonicalUrl, contentHash, type AtolyeStage, KNOWLEDGE_BRAINS, type KnowledgeBrain, type KnowledgeRecord, knowledgeDir, knowledgeId, looksLikeInjection, STAGE_BRAINS } from "./AyasSharedKnowledge";

/**
 * A link the owner gives AYAS (owner, 5 Nov 2026: "bir bağlantı verdiğimde içeriği incelesin, ilgili beyne öğretsin,
 * ortak bilgiye kaydetsin"). Same pattern as a V3 study request: the live server only writes this file — it never
 * fetches — and the V3 idle loop (scripts/v3/gelisim.ts, task `istekler`) reads the link through the safe public fetch
 * and saves what it learned to the shared knowledge store. File only; no network, no process here.
 */
export interface LinkRequest {
  readonly id: string;
  readonly url: string;
  readonly kaynak: string;
  readonly tarih: string;
  readonly istek?: string;
  durum: "bekliyor" | "tamam" | "hata";
  sonuc?: string;
  deneme?: number;
  sonDeneme?: string;
}

export const LINK_REQUEST_MAX_ATTEMPTS = 2;
export const LINK_REQUEST_RETRY_AFTER_MS = 60 * 60_000;

export function linkRequestDir(repoRoot: string): string {
  return path.join(knowledgeDir(repoRoot), "istekler");
}

/** Writes one request per link (http/https only); the same link already waiting is not queued twice. */
export async function placeLinkRequest(repoRoot: string, url: string, kaynak: string, istek?: string, now = new Date()): Promise<LinkRequest> {
  const u = new URL(url.trim());
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("LINK_REQUEST_INVALID: yalnız http(s) bağlantıları");
  const canonical = canonicalUrl(u.toString());
  const waiting = (await listLinkRequests(repoRoot)).find((x) => x.request.durum === "bekliyor" && x.request.url === canonical);
  if (waiting) return waiting.request;
  const dir = linkRequestDir(repoRoot);
  await fs.mkdir(dir, { recursive: true });
  const id = createHash("sha256").update(`${canonical} ${now.toISOString()}`).digest("hex").slice(0, 12);
  const request: LinkRequest = { id, url: canonical, kaynak, tarih: now.toISOString(), durum: "bekliyor", ...(istek ? { istek: istek.slice(0, 300) } : {}) };
  await fs.writeFile(path.join(dir, `${now.toISOString().replace(/[-:]/g, "").replace(/\..*$/, "")}-${id}.json`), `${JSON.stringify(request, null, 2)}\n`);
  return request;
}

export async function listLinkRequests(repoRoot: string): Promise<{ file: string; request: LinkRequest }[]> {
  const dir = linkRequestDir(repoRoot);
  if (!existsSync(dir)) return [];
  const out: { file: string; request: LinkRequest }[] = [];
  for (const n of (await fs.readdir(dir)).filter((x) => x.endsWith(".json")).sort()) {
    try { out.push({ file: path.join(dir, n), request: JSON.parse(await fs.readFile(path.join(dir, n), "utf8")) as LinkRequest }); } catch { /* read next pass */ }
  }
  return out;
}

export async function saveLinkRequest(file: string, request: LinkRequest): Promise<void> {
  await fs.writeFile(`${file}.tmp`, `${JSON.stringify(request, null, 2)}\n`);
  await fs.rename(`${file}.tmp`, file);
}

/** Waiting links, and a failed one once more an hour later. */
export function linkRequestsDue<T extends { readonly request: LinkRequest }>(requests: readonly T[], now: Date = new Date()): T[] {
  return requests.filter(({ request: r }) => r.durum === "bekliyor"
    || (r.durum === "hata" && (r.deneme ?? 1) < LINK_REQUEST_MAX_ATTEMPTS && now.getTime() - Date.parse(r.sonDeneme ?? r.tarih) >= LINK_REQUEST_RETRY_AFTER_MS));
}

const BRAIN_STAGES: Readonly<Partial<Record<string, readonly AtolyeStage[]>>> = {
  kurgu: ["script", "scenes"], mizah: ["script"], kalite: ["quality"], ses: ["audio", "voice"], ortam: ["visuals"], kostum: ["visuals"], arastirma: ["research"], sef: ["assembly"],
};

/**
 * A finished V3 video study (ReferenceStudy) as shared knowledge, so what the brains learned from a video is also
 * findable by AYAS and the other brains — the lessons quoted, the video's own content never kept.
 */
export function knowledgeFromStudy(study: { readonly id: string; readonly url: string; readonly baslik: string; readonly kanal: string; readonly ozet: string; readonly dersler: readonly { readonly beyin: string; readonly metin: string }[] }, now: Date = new Date()): KnowledgeRecord {
  const asamalar = [...new Set(study.dersler.flatMap((d) => BRAIN_STAGES[d.beyin] ?? []))];
  const text = [study.baslik, study.ozet, ...study.dersler.map((d) => d.metin)].join("\n");
  const base = {
    schemaVersion: 1 as const, id: knowledgeId(study.url), url: canonicalUrl(study.url), baslik: study.baslik, tur: "youtube" as const, yayinci: study.kanal,
    erisimTarihi: now.toISOString(), lisans: { kanit: "YouTube videosu — yalnız teknik öğrenildi, içeriği kullanılmaz" }, maliyet: { sinif: "BILINMIYOR" as const, kanit: [] },
    alintilar: study.dersler.map((d) => `[${d.beyin}] ${d.metin}`).slice(0, 8), ozet: study.ozet, kavramlar: asamalar,
    dogrulama: { durum: "TEK_KAYNAK" as const, kaynaklar: [canonicalUrl(study.url)], not: "V3 referans incelemesi (altyazı, kareler, tempo)" },
    asamalar, beyinler: [...new Set([...study.dersler.map((d) => d.beyin).filter((b): b is KnowledgeBrain => (KNOWLEDGE_BRAINS as readonly string[]).includes(b)), ...asamalar.flatMap((s) => STAGE_BRAINS[s])])],
    firsatlar: [], tekrarKontrol: new Date(now.getTime() + 180 * 86_400_000).toISOString(), etiketler: ["video-incelemesi", `referans ${study.id}`],
    icerikHash: contentHash(text), enjeksiyonSuphesi: looksLikeInjection(text), otomatikUygulanabilir: false as const,
  };
  return { ...base, uygulamaEngeli: applicationGate(base) };
}
