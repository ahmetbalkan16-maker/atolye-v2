/**
 * V3 il sınırları ve deniz adları: Natural Earth 1:10m eyalet/il sınırlarını ve 1:50m deniz adlarını (kamu malı) bir kez
 * indirip haritaların kullandığı dosyalara çevirir (`<maps>/admin1-q.json`, deniz dosyası olduğu gibi). Tarihî devletler bu
 * illerden kurulur; sınırları atlasın düz çizgileri yerine gerçek il sınırlarını (nehirler, dağ sırtları) izler (owner,
 * 21 Ekim 2026: "sınırları düz değil daha gerçekçi"). Dünyanın her yeri için.
 *
 *   npx tsx scripts/v3/il-sinirlari-hazirla.ts
 *
 * Koordinatlar ADMIN_QUANT_DEG'lik ızgaraya oturtulur ve art arda aynı noktalar düşer: iki komşu ilin ortak sınırı iki
 * tarafta da aynı noktalardan geçer, böylece bir devletin iç il sınırları birbirini götürür (MapBuilder.dissolve).
 */
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { ADMIN_FILE, ADMIN_QUANT_DEG, ADMIN_SOURCE_URL } from "../../src/lib/v3/maps/AdminUnits";
import { SEAS_FILE } from "../../src/lib/v3/maps/MapBuilder";
import { loadV3Settings, resolveV3Paths } from "../../src/lib/v3/V3Paths";

interface Feature {
  readonly properties: Record<string, unknown>;
  readonly geometry: { readonly type: string; readonly coordinates: unknown } | null;
}

async function main() {
  loadV3Settings();
  const paths = resolveV3Paths();
  const raw = path.join(paths.mapsDir, "raw", "ne_10m_admin_1_states_provinces.geojson");
  if (!existsSync(raw)) {
    console.log(`indiriliyor: ${ADMIN_SOURCE_URL}`);
    const res = await fetch(ADMIN_SOURCE_URL);
    if (!res.ok) throw new Error(`V3_ADMIN_DOWNLOAD_${res.status}`);
    await fs.mkdir(path.dirname(raw), { recursive: true });
    await fs.writeFile(raw, Buffer.from(await res.arrayBuffer()));
  }
  const json = JSON.parse(await fs.readFile(raw, "utf8")) as { features: Feature[] };
  const q = (v: number) => Math.round(v / ADMIN_QUANT_DEG);
  let points = 0;
  const units = json.features.flatMap((f) => {
    const g = f.geometry;
    if (!g) return [];
    const polys = (g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? (g.coordinates as unknown[]) : []) as number[][][][];
    const rings = polys.flatMap((poly) => {
      const out: number[] = [];
      for (const [lon, lat] of poly[0] ?? []) {
        const x = q(lon!);
        const y = q(lat!);
        if (out.length && out[out.length - 2] === x && out[out.length - 1] === y) continue;
        out.push(x, y);
      }
      // A closed ring repeats its first point at the end; drop it, and rings that collapsed on the grid.
      if (out.length >= 4 && out[0] === out[out.length - 2] && out[1] === out[out.length - 1]) out.splice(-2);
      return out.length >= 6 ? [out] : [];
    });
    points += rings.reduce((n, r) => n + r.length / 2, 0);
    return rings.length ? [{ n: String(f.properties.name ?? f.properties.name_en ?? ""), a: String(f.properties.adm0_a3 ?? ""), r: rings }] : [];
  });
  // The atlas-like sea names (Natural Earth 1:50m marine polygons, with Turkish names), read as they are.
  const seas = path.join(paths.mapsDir, SEAS_FILE);
  if (!existsSync(seas)) {
    const res = await fetch(ADMIN_SOURCE_URL.replace("ne_10m_admin_1_states_provinces.geojson", SEAS_FILE));
    if (!res.ok) throw new Error(`V3_SEAS_DOWNLOAD_${res.status}`);
    await fs.writeFile(seas, Buffer.from(await res.arrayBuffer()));
    console.log(`deniz adları: ${seas}`);
  }
  const out = path.join(paths.mapsDir, ADMIN_FILE);
  await fs.writeFile(out, JSON.stringify({ kaynak: ADMIN_SOURCE_URL, lisans: "public domain (Natural Earth)", izgara: ADMIN_QUANT_DEG, birimler: units }));
  console.log(`${units.length} il/eyalet, ${points} nokta → ${out} (${((await fs.stat(out)).size / 1e6).toFixed(1)} MB)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
