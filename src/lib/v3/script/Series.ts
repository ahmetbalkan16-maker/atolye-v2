import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import type { Episode } from "../episode/EpisodeTypes";

/**
 * Series (owner, 23 Oct 2026, after DFT Tarih's "Fatih 01…06"): a story told over several episodes. Each finished script
 * is recorded in the series' file (`<workRoot>/_kutuphane/diziler/<slug>.json`), so the next episode's writer knows what
 * was already told and the cover shows "<series> 06".
 */
export interface SeriesEpisode {
  readonly no: number;
  readonly konu: string;
  readonly baslik: string;
  /** What the episode told: its chapters (or scenes) in order, for the next episode's writer. */
  readonly ozet: string;
  readonly cikti?: string;
}

export interface SeriesRecord {
  readonly ad: string;
  readonly bolumler: readonly SeriesEpisode[];
}

/** What the writer is told about the series it writes an episode of. */
export interface SeriesBrief {
  readonly ad: string;
  readonly no: number;
  readonly onceki: readonly Pick<SeriesEpisode, "no" | "baslik" | "ozet">[];
}

function seriesSlug(text: string): string {
  const map: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u" };
  return text.toLocaleLowerCase("tr-TR").replace(/[çğıöşüâîû]/g, (c) => map[c] ?? c).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "dizi";
}

export function seriesFile(workRoot: string, ad: string): string {
  return path.join(workRoot, "_kutuphane", "diziler", `${seriesSlug(ad)}.json`);
}

export async function loadSeries(workRoot: string, ad: string): Promise<SeriesRecord> {
  const file = seriesFile(workRoot, ad);
  return existsSync(file) ? (JSON.parse(await fs.readFile(file, "utf8")) as SeriesRecord) : { ad, bolumler: [] };
}

/** The writer's brief for episode `no`: the series' earlier episodes, in order (a remake of an episode replaces it). */
export function seriesBrief(record: SeriesRecord, no: number): SeriesBrief {
  return { ad: record.ad, no, onceki: [...record.bolumler].filter((b) => b.no < no).sort((a, b) => a.no - b.no).map(({ no: n, baslik, ozet }) => ({ no: n, baslik, ozet })) };
}

/** An episode's summary for the series: its chapter cards in order, else its places, at most ~500 characters. */
export function episodeSummary(episode: Pick<Episode, "konu" | "sahneler">): string {
  const chapters = episode.sahneler.flatMap((s) => (s.yazi_karti ?? []).filter((k) => k.stil === "bolum").map((k) => k.metin));
  const parts = chapters.length ? chapters : [...new Set(episode.sahneler.map((s) => s.mekan))];
  return `${episode.konu}: ${parts.join(" → ")}`.slice(0, 500);
}

/** Records (or replaces) an episode in its series' file. Append-only in spirit: other episodes are never touched. */
export async function recordEpisode(workRoot: string, ad: string, entry: SeriesEpisode): Promise<void> {
  const record = await loadSeries(workRoot, ad);
  const bolumler = [...record.bolumler.filter((b) => b.no !== entry.no), entry].sort((a, b) => a.no - b.no);
  const file = seriesFile(workRoot, ad);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify({ ad: record.ad, bolumler }, null, 2)}\n`);
  await fs.rename(tmp, file);
}

/** The series' cover line: "Fatih 06". */
export function seriesLabel(dizi: { readonly ad: string; readonly no: number }): string {
  return `${dizi.ad} ${String(dizi.no).padStart(2, "0")}`;
}

/** The writer's series block. */
export function seriesText(dizi: SeriesBrief | undefined): string {
  if (!dizi) return "";
  const before = dizi.onceki.length ? `\nALREADY TOLD in the earlier episodes (do not retell them; refer back in a line at most):\n${dizi.onceki.map((b) => `- Episode ${b.no} "${b.baslik}": ${b.ozet}`).join("\n")}` : "\nThis is the series' first episode: introduce its world and people.";
  return `

SERIES — this is episode ${dizi.no} of the series "${dizi.ad}". Open with a 2–3 line recap of where the story stands, tell
this episode's own turn of the story, and end on a cliffhanger that leads to episode ${dizi.no + 1}.${before}`;
}
