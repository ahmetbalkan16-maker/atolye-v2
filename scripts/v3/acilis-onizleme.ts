/**
 * Still frames of a finished production's render plan, to look at an overlay change without producing again
 * (owner, 26 Nov 2026: the Short's opening question was added after Stalingrad; prove it on that very plan).
 *
 *   npx tsx scripts/v3/acilis-onizleme.ts --klasor <bolumler/...> [--kare 1,2.5] [--cikti <klasör>]
 *
 * Reads <klasor>/plan.json (its `plan`) and renders each second as a PNG with the work folder's `public` assets.
 */
import { existsSync, mkdirSync, promises as fs } from "node:fs";
import path from "node:path";
import { renderWithRemotion } from "../../src/lib/v3/render/RemotionRunner";
import { resolveV3Paths } from "../../src/lib/v3/V3Paths";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const dir = arg("--klasor");
  if (!dir || !existsSync(path.join(dir, "plan.json"))) throw new Error("--klasor <üretim klasörü> içinde plan.json yok");
  const seconds = (arg("--kare") ?? "1").split(",").map(Number).filter((n) => Number.isFinite(n) && n >= 0);
  const out = arg("--cikti") ?? path.join(dir, "onizleme-acilis");
  mkdirSync(out, { recursive: true });
  const raw = JSON.parse(await fs.readFile(path.join(dir, "plan.json"), "utf8")) as { plan?: { fps: number; durationInFrames: number } };
  const plan = raw.plan ?? (raw as unknown as { fps: number; durationInFrames: number });
  const planFile = path.join(out, "plan.json");
  await fs.writeFile(planFile, JSON.stringify({ plan }));
  const paths = resolveV3Paths();
  for (const s of seconds) {
    const png = path.join(out, `kare-${s}.png`);
    const frame = Math.min(plan.durationInFrames - 1, Math.round(s * plan.fps));
    await renderWithRemotion(paths, { planFile, publicDir: path.join(dir, "public"), out: png, kind: "still", frame });
    console.log(`kare ${s} sn → ${png}`);
  }
}

main().catch((error) => {
  console.error(`acilis-onizleme: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
