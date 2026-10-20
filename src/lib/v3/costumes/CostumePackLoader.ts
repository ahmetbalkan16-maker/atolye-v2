import { existsSync, promises as fs } from "node:fs";
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
  readonly items: Readonly<
    Record<
      string,
      {
        readonly slot: V3Accessory["slot"];
        readonly behind?: boolean;
        readonly grip?: boolean;
        /** Who may wear it (rank, role), told to the script writer. */
        readonly not?: string;
      }
    >
  >;
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

/**
 * Where packs are looked up: the hand-drawn packs in the repository, then the generated wardrobe library (runtime
 * storage, outside git; see PartDesigner). A pack id is resolved in the first root that has it.
 */
export type CostumeRoots = string | readonly string[];
const rootsOf = (roots: CostumeRoots): readonly string[] => (typeof roots === "string" ? [roots] : roots);

function packDir(roots: CostumeRoots, pack: string): string {
  const list = rootsOf(roots);
  return list.map((r) => path.join(r, pack)).find((d) => existsSync(path.join(d, "pack.json"))) ?? path.join(list[0]!, pack);
}

export async function readPackManifest(roots: CostumeRoots, pack: string): Promise<CostumePackManifest> {
  if (!SAFE_ID.test(pack)) throw new CostumePackError("V3_COSTUME_PACK_ID", pack);
  const raw = JSON.parse(await fs.readFile(path.join(packDir(roots, pack), "pack.json"), "utf8")) as CostumePackManifest;
  if (raw.schema !== 1 || raw.id !== pack || typeof raw.items !== "object") throw new CostumePackError("V3_COSTUME_PACK_MANIFEST", pack);
  for (const [id, item] of Object.entries(raw.items)) {
    if (!SAFE_ID.test(id) || !SLOTS.includes(item.slot)) throw new CostumePackError("V3_COSTUME_PACK_ITEM", `${pack}/${id}`);
  }
  return raw;
}

export interface PackCatalogEntry {
  readonly pack: string;
  readonly title: string;
  readonly items: Readonly<Partial<Record<V3Accessory["slot"], readonly string[]>>>;
  /** Item id → who may wear it (e.g. "only the reigning emperor"). */
  readonly notes?: Readonly<Record<string, string>>;
}

/** Every installed pack and its item ids by slot — what a script writer may dress the cast in. */
export async function packCatalog(roots: CostumeRoots): Promise<PackCatalogEntry[]> {
  const out: PackCatalogEntry[] = [];
  const seen = new Set<string>();
  for (const root of rootsOf(roots)) {
    if (!existsSync(root)) continue;
    for (const dir of (await fs.readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
      if (!SAFE_ID.test(dir) || seen.has(dir) || !existsSync(path.join(root, dir, "pack.json"))) continue;
      seen.add(dir);
      const manifest = await readPackManifest(root, dir);
      const items: Partial<Record<V3Accessory["slot"], string[]>> = {};
      const notes: Record<string, string> = {};
      for (const [id, item] of Object.entries(manifest.items)) {
        (items[item.slot] ??= []).push(id);
        if (item.not) notes[id] = item.not;
      }
      out.push({ pack: manifest.id, title: manifest.title, items, ...(Object.keys(notes).length ? { notes } : {}) });
    }
  }
  return out;
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
export async function loadAccessories(roots: CostumeRoots, cast: readonly V3CastMember[]): Promise<V3Accessory[]> {
  const manifests = new Map<string, CostumePackManifest>();
  const out: V3Accessory[] = [];
  for (const ref of accessoryRefs(cast)) {
    const [pack, id] = ref.split("/") as [string, string];
    let manifest = manifests.get(pack);
    if (!manifest) {
      manifest = await readPackManifest(roots, pack);
      manifests.set(pack, manifest);
    }
    const item = manifest.items[id];
    if (!item) throw new CostumePackError("V3_COSTUME_ITEM_UNKNOWN", ref);
    const svg = await fs.readFile(path.join(packDir(roots, pack), `${id}.svg`), "utf8");
    out.push({ id: ref, slot: item.slot, markup: svgBody(svg, ref), ...(item.behind ? { behind: true } : {}), ...(item.grip ? { grip: true } : {}) });
  }
  return out;
}
