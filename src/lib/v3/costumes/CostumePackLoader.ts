import { promises as fs } from "node:fs";
import path from "node:path";
import type { V3Accessory, V3CastMember } from "../render/RenderPlanTypes";

/**
 * Costume packs live in `remotion-v3/public/costumes/<pack>/`: one `pack.json` plus one SVG per accessory.
 * Adding a period means adding a folder; no code change. The loader inlines only the SVG body into the
 * render plan, after refusing anything that could reach outside the document or run.
 */
export interface CostumePackManifest {
  readonly schema: 1;
  readonly id: string;
  readonly title: string;
  readonly notes?: string;
  readonly sources?: readonly string[];
  readonly items: Readonly<Record<string, { readonly slot: V3Accessory["slot"]; readonly behind?: boolean }>>;
}

const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const OUTSIDE = /<script\b|<foreignObject\b|<image\b|<use\b|<style\b|<!DOCTYPE|<!ENTITY|\bhref\s*=|url\s*\(|@import|javascript:|\bon[a-z]+\s*=/i;
const MAX_SVG_BYTES = 64 * 1024;
const SLOTS: readonly V3Accessory["slot"][] = ["head", "beard", "mustache", "hand", "back"];

export class CostumePackError extends Error {
  constructor(readonly code: string, message: string) {
    super(`${code}: ${message}`);
  }
}

export function costumesRoot(repoRoot: string): string {
  return path.join(repoRoot, "remotion-v3", "public", "costumes");
}

export async function readPackManifest(root: string, pack: string): Promise<CostumePackManifest> {
  if (!SAFE_ID.test(pack)) throw new CostumePackError("V3_COSTUME_PACK_ID", pack);
  const raw = JSON.parse(await fs.readFile(path.join(root, pack, "pack.json"), "utf8")) as CostumePackManifest;
  if (raw.schema !== 1 || raw.id !== pack || typeof raw.items !== "object") throw new CostumePackError("V3_COSTUME_PACK_MANIFEST", pack);
  for (const [id, item] of Object.entries(raw.items)) {
    if (!SAFE_ID.test(id) || !SLOTS.includes(item.slot)) throw new CostumePackError("V3_COSTUME_PACK_ITEM", `${pack}/${id}`);
  }
  return raw;
}

/** The inner markup of an accessory SVG, or a typed refusal. */
export function svgBody(svg: string, where: string): string {
  if (Buffer.byteLength(svg, "utf8") > MAX_SVG_BYTES) throw new CostumePackError("V3_COSTUME_SVG_SIZE", where);
  const m = /^\s*<svg\b[^>]*>([\s\S]*)<\/svg>\s*$/.exec(svg);
  if (!m) throw new CostumePackError("V3_COSTUME_SVG_SHAPE", where);
  const body = m[1]!.trim();
  if (OUTSIDE.test(body)) throw new CostumePackError("V3_COSTUME_SVG_UNSAFE", where);
  return body;
}

export function accessoryRefs(cast: readonly V3CastMember[]): string[] {
  const refs = new Set<string>();
  for (const member of cast) {
    const c = member.costume;
    for (const ref of [c.head, c.beard, c.mustache, c.handFront, c.handBack, c.back]) {
      if (ref) refs.add(ref.includes("/") ? ref : `${c.pack}/${ref}`);
    }
  }
  return [...refs].sort();
}

/** Loads every accessory the cast uses; an unknown pack/item stops the render plan instead of drawing a gap. */
export async function loadAccessories(root: string, cast: readonly V3CastMember[]): Promise<V3Accessory[]> {
  const manifests = new Map<string, CostumePackManifest>();
  const out: V3Accessory[] = [];
  for (const ref of accessoryRefs(cast)) {
    const [pack, id] = ref.split("/") as [string, string];
    let manifest = manifests.get(pack);
    if (!manifest) {
      manifest = await readPackManifest(root, pack);
      manifests.set(pack, manifest);
    }
    const item = manifest.items[id];
    if (!item) throw new CostumePackError("V3_COSTUME_ITEM_UNKNOWN", ref);
    const svg = await fs.readFile(path.join(root, pack, `${id}.svg`), "utf8");
    out.push({ id: ref, slot: item.slot, markup: svgBody(svg, ref), ...(item.behind ? { behind: true } : {}) });
  }
  return out;
}
