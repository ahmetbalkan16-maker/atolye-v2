import { existsSync, promises as fs, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { GARMENTS } from "../episode/EpisodeTypes";
import { validateEpisode } from "../episode/EpisodeValidator";
import { periodEndYear } from "../episode/Period";
import { GARMENT_NOTES, SHOES } from "../script/ScriptPrompts";
import type { V3Budget, V3ModelChoice } from "../script/V3Budget";
import type { AtlasEra, AtlasRole, AtlasSide, PeriodAtlas } from "./PeriodAtlas";

/**
 * The period archivist (owner, 6 Nov 2026: "yardımcı beyinler onu sürekli oraya depolasın"): an order for an era the
 * atlas does not have gets that era written once, before the script — each side and rank with its costume, checked by
 * the episode validator — and kept in runtime storage for every later episode. One short text call; the parts it
 * names are drawn for free by PartFamilies where a family knows them.
 */

export function archiveDir(workRoot: string): string {
  return path.join(workRoot, "_kutuphane", "donem-atlasi");
}

/** Eras the archivist wrote (runtime storage), oldest first; unreadable files are skipped. */
export function readArchivedEras(workRoot: string): AtlasEra[] {
  const dir = archiveDir(workRoot);
  if (!existsSync(dir)) return [];
  const out: AtlasEra[] = [];
  for (const n of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
    try {
      out.push(JSON.parse(readFileSync(path.join(dir, n), "utf8")) as AtlasEra);
    } catch {
      // Skipped.
    }
  }
  return out;
}

/** The curated atlas with the archivist's eras after it (a curated era wins where both cover a year). */
export function withArchive(atlas: PeriodAtlas, workRoot: string): PeriodAtlas {
  return { ...atlas, donemler: [...atlas.donemler, ...readArchivedEras(workRoot)] };
}

/** A minimal valid episode around one costume, so the validator checks only the costume. */
function costumeEpisode(kostum: unknown): unknown {
  return {
    id: "atlas",
    baslik: "Atlas",
    konu: "Atlas",
    donem: "1800",
    hedef_sure_sn: 30,
    ton: "mizahi",
    kaynaklar: [{ id: "k", kunye: "atlas" }],
    oyuncu_kadrosu: [
      { id: "anlatici", ad: "Narrator", rol: "narrator", kostum_paketi: "", renk: "#333333", ses_id: "en-anlatici", konusma_tarzi: "dry", gorunur: false },
      { id: "x", ad: "X", rol: "soldier", kostum_paketi: "gardirop", renk: "#b3263a", ses_id: "en-genc-lider", konusma_tarzi: "bold", gorunur: true, kostum },
    ],
    sahneler: [],
  };
}

/** Why a costume cannot be used (empty when it can): the validator's costume errors only. */
export function costumeProblems(kostum: unknown): string[] {
  return validateEpisode(costumeEpisode(kostum)).errors.filter((e) => e.path.includes("kostum")).map((e) => `${e.path.replace(/^.*kostum/, "kostum")}: ${e.message}`);
}

/** The archivist's question: the curated Napoleonic era (two sides) is the example of the shape. */
export function eraPrompt(donem: string, konu: string, example: AtlasEra | undefined): string {
  const sample = example ? { ...example, taraflar: example.taraflar.slice(0, 2) } : undefined;
  return `You are the period archivist of an animated history studio (flat cartoon puppets, OverSimplified style).
Write the period dress for the era of this episode: ${konu} (${donem}).

List the sides that appear (armies, nations, peoples; 2–5) and for each 1–3 ranks or roles (officer, soldier, ruler,
commoner…) with the costume they wore in that era, as the history books and period paintings show it.
- "giysi": one of ${GARMENTS.map((g) => `${g} (${GARMENT_NOTES[g]})`).join(", ")}.
- "renkler": {"ana": coat or main garment, "ikincil": trousers or second colour, "ic": shirt, "sus": trim/facings} as
  #RRGGBB, the real colours as flat cartoon tones.
- "ayakkabi": one of ${SHOES.join(", ")}.
- Headwear "bas", and "biyik"/"sakal" only where most men of that side wore them: "yeni:<English description>" with the
  plain name of the thing and its colour ("yeni:black bicorne with gold trim", "yeni:black shako with red plume",
  "yeni:white turban", "yeni:steel helmet", "yeni:thick black moustache"). Optional "gogus" (sash, medals, epaulettes)
  and "pelerin" (#RRGGBB cloak).
- "yillar": the era's first and last year (BC negative); it must include the episode's year.
- "not": one or two sentences on facial hair and anything a viewer would notice wrong.
${sample ? `\nTHE SHAPE (an era from the atlas):\n${JSON.stringify(sample)}\n` : ""}
Return ONLY one JSON object: {"id": "<short-ascii-id>", "ad": "<English era name>", "yillar": [first, last], "not": "…", "taraflar": [{"ad": "…", "roller": [{"rol": "…", "kostum": {…}}]}]}`;
}

/** The archivist's answer, its invalid roles dropped; undefined era when nothing usable is left. */
export function readEraAnswer(text: string, donem: string): { era?: AtlasEra; problems: string[] } {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  let raw: Partial<AtlasEra> & { taraflar?: unknown };
  try {
    raw = JSON.parse(text.slice(start, end + 1)) as typeof raw;
  } catch {
    return { problems: ["okunamayan yanıt"] };
  }
  const problems: string[] = [];
  const year = periodEndYear(donem);
  const yillar = Array.isArray(raw.yillar) && raw.yillar.length === 2 && raw.yillar.every((y) => typeof y === "number") ? ([raw.yillar[0], raw.yillar[1]] as [number, number]) : undefined;
  if (!yillar || year === undefined || year < yillar[0] || year > yillar[1]) return { problems: [`yıllar dönemi kapsamıyor (${JSON.stringify(raw.yillar)}, ${donem})`] };
  const sides: AtlasSide[] = [];
  for (const s of Array.isArray(raw.taraflar) ? (raw.taraflar as Partial<AtlasSide>[]) : []) {
    if (typeof s?.ad !== "string" || !Array.isArray(s.roller)) continue;
    const roles: AtlasRole[] = [];
    for (const r of s.roller as Partial<AtlasRole>[]) {
      const why = costumeProblems(r?.kostum);
      if (typeof r?.rol !== "string" || why.length) {
        problems.push(`${s.ad} / ${String(r?.rol)}: ${why.join("; ") || "rol yok"}`);
        continue;
      }
      roles.push({ rol: r.rol.slice(0, 60), kostum: r.kostum! });
    }
    if (roles.length) sides.push({ ad: s.ad.slice(0, 60), roller: roles });
  }
  if (!sides.length) return { problems: problems.length ? problems : ["taraf yok"] };
  const id = (typeof raw.id === "string" && /^[a-z0-9-]{2,40}$/.test(raw.id) ? raw.id : `donem-${yillar[0]}-${yillar[1]}`).replace(/^-/, "m");
  return { era: { id, ad: typeof raw.ad === "string" ? raw.ad.slice(0, 80) : id, yillar, ...(typeof raw.not === "string" ? { not: raw.not.slice(0, 400) } : {}), taraflar: sides }, problems };
}

/**
 * The era for an order's period: the atlas's when it has one, else the archivist writes it (one call, `maxTokens` 1800)
 * and keeps it (atomic, never overwriting). Undefined when it could not — the script is written without it, as before.
 */
export async function ensureEra(input: {
  readonly atlas: PeriodAtlas;
  readonly donem: string;
  readonly konu: string;
  readonly workRoot: string;
  readonly budget: Pick<V3Budget, "generate">;
  readonly model: V3ModelChoice;
  readonly log: (s: string) => void;
}): Promise<AtlasEra | undefined> {
  const year = periodEndYear(input.donem);
  if (year === undefined) return undefined;
  const known = input.atlas.donemler.find((e) => year >= e.yillar[0] && year <= e.yillar[1]);
  if (known) return known;
  const out = await input.budget.generate("donem-arsivci", input.model, eraPrompt(input.donem, input.konu, input.atlas.donemler.find((e) => e.id === "napolyon")), { maxTokens: 1_800 }).catch((e: Error) => (input.log(`  dönem atlası: arşivci çalışmadı (${e.message.slice(0, 120)})`), undefined));
  if (!out) return undefined;
  const { era, problems } = readEraAnswer(out.result.content, input.donem);
  if (!era) {
    input.log(`  dönem atlası: ${input.donem} için yazılamadı — ${problems.slice(0, 3).join(" | ")}`);
    return undefined;
  }
  const dir = archiveDir(input.workRoot);
  await fs.mkdir(dir, { recursive: true });
  let file = path.join(dir, `${era.id}.json`);
  for (let n = 2; existsSync(file); n++) file = path.join(dir, `${era.id}--v${n}.json`);
  await fs.writeFile(`${file}.tmp`, `${JSON.stringify({ ...era, kaynak: "arsivci", olusturuldu: new Date().toISOString() }, null, 2)}\n`);
  await fs.rename(`${file}.tmp`, file);
  input.log(`  dönem atlası: "${era.ad}" (${era.yillar.join("–")}) arşivci yazdı — ${era.taraflar.length} taraf, ${era.taraflar.reduce((n, s) => n + s.roller.length, 0)} rol${problems.length ? `; ${problems.length} geçersiz rol atıldı` : ""}`);
  return era;
}
