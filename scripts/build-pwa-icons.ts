/**
 * Rasterise the AYAS orb SVG into the PNG icon set a PWA install needs
 * (`public/icons/`). Run: `npx tsx scripts/build-pwa-icons.ts`.
 *
 * Chrome/Android's installability check wants a PNG icon at 192 and 512 with
 * `purpose: any`; a maskable pair improves the adaptive-icon look; iOS wants an
 * opaque `apple-touch-icon` PNG. SVG-only manifests do not satisfy the prompt.
 *
 * Deterministic + offline (sharp, already a dependency). Re-run after editing
 * the source SVGs. The generated PNGs are committed so a plain checkout is
 * installable without a build step.
 */

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const PUBLIC = path.resolve(__dirname, "..", "public");
const OUT = path.join(PUBLIC, "icons");
const BG = "#04050a";

const SOURCE_ANY = path.join(PUBLIC, "ayas-icon.svg");
const SOURCE_MASKABLE = path.join(PUBLIC, "ayas-icon-maskable.svg");

async function render(src: string, size: number, out: string, opaque: boolean): Promise<void> {
  const svg = fs.readFileSync(src);
  let pipe = sharp(svg, { density: 384 }).resize(size, size, { fit: "contain", background: BG });
  if (opaque) pipe = pipe.flatten({ background: BG });
  await pipe.png({ compressionLevel: 9 }).toFile(out);
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT, { recursive: true });
  const jobs: [string, number, string, boolean][] = [
    [SOURCE_ANY, 192, "icon-192.png", true],
    [SOURCE_ANY, 512, "icon-512.png", true],
    [SOURCE_MASKABLE, 192, "icon-maskable-192.png", true],
    [SOURCE_MASKABLE, 512, "icon-maskable-512.png", true],
    [SOURCE_ANY, 180, "apple-touch-icon.png", true],
    [SOURCE_ANY, 32, "favicon-32.png", true],
    [SOURCE_ANY, 16, "favicon-16.png", true],
  ];
  for (const [src, size, name, opaque] of jobs) {
    const out = path.join(OUT, name);
    await render(src, size, out, opaque);
    const { size: bytes } = fs.statSync(out);
    console.log(`  ${name.padEnd(26)} ${size}x${size}  ${bytes} B`);
  }
  console.log(`PWA icons written to public/icons/`);
}

main().catch((error) => {
  console.error("build-pwa-icons FAILED:", error);
  process.exitCode = 1;
});
