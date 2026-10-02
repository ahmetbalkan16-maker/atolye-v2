/**
 * Stage 15J — draws one character scene, for the operator.
 *
 *   npx tsx scripts/ayas-character-scene.ts --request <file.json> [--out <dir>] [--png]
 *
 *   --request <file.json>   { sceneId, format, language, blocking, cameraBeat, claimIds }. See
 *                           src/lib/character/CharacterSceneManifest.ts for the shape.
 *   --out <dir>             write scene-<id>.svg and scene-<id>.manifest.json into <dir>. Existing files are not
 *                           overwritten. Without it nothing is written and the manifest is printed.
 *   --png                   with --out: also write scene-<id>.png, made with the image library already installed.
 *
 * Local only: no provider, no model, no network. The scene is a labelled reenactment and evidence of nothing; the
 * manifest says so. Nothing here hands the image to the production pipeline.
 */
import fs from "node:fs";
import path from "node:path";

import { buildCharacterScene, findCharacterSceneRequestProblems, type CharacterSceneRequest } from "../src/lib/character/CharacterSceneManifest";
import { rasterizeCharacterSceneSvg } from "../src/lib/character/CharacterSceneRasterizer";

const VALUE_FLAGS = new Set(["--request", "--out"]);
const SWITCHES = new Set(["--png"]);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const values = new Map<string, string>();
  const switches = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (VALUE_FLAGS.has(arg) && args[i + 1] !== undefined && !args[i + 1]!.startsWith("--") && !values.has(arg)) values.set(arg, args[++i]!);
    else if (SWITCHES.has(arg)) switches.add(arg);
    else throw new Error("CHARACTER_SCENE_ARGUMENTS_INVALID");
  }
  const requestFile = values.get("--request");
  const outDir = values.get("--out");
  if (!requestFile || (switches.has("--png") && !outDir)) throw new Error("CHARACTER_SCENE_ARGUMENTS_INVALID");
  let raw: unknown;
  try { raw = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), requestFile), "utf8")); } catch { throw new Error("CHARACTER_SCENE_REQUEST_UNREADABLE"); }
  const problems = findCharacterSceneRequestProblems(raw);
  if (problems.length) throw new Error(`CHARACTER_SCENE_REQUEST_INVALID: ${problems.join(", ")}`);
  const scene = buildCharacterScene(raw as CharacterSceneRequest);

  const written: string[] = [];
  if (outDir) {
    const target = path.resolve(process.cwd(), outDir);
    fs.mkdirSync(target, { recursive: true });
    // New files only: a scene already written is not replaced in place.
    const writeNew = (name: string, data: string | Buffer) => { fs.writeFileSync(path.join(target, name), data, { flag: "wx" }); written.push(name); };
    const base = `scene-${scene.manifest.sceneId}`;
    let png: Buffer | null = null;
    if (switches.has("--png")) {
      const raster = await rasterizeCharacterSceneSvg(scene.svg);
      if (!raster.ok) throw new Error(`CHARACTER_SCENE_${raster.reason}`);
      png = raster.png;
    }
    writeNew(`${base}.svg`, scene.svg);
    writeNew(`${base}.manifest.json`, `${JSON.stringify(scene.manifest, null, 2)}\n`);
    if (png) writeNew(`${base}.png`, png);
  }
  console.log(JSON.stringify({ sceneId: scene.manifest.sceneId, classification: scene.manifest.classification, motionType: scene.manifest.motionType, counts: scene.manifest.counts, svgSha256: scene.manifest.svgSha256, svgBytes: scene.manifest.svgBytes, written }, null, 2));
}

main().catch((error: unknown) => { console.error(JSON.stringify({ status: "FAILED", message: error instanceof Error ? error.message : String(error) })); process.exitCode = 1; });
