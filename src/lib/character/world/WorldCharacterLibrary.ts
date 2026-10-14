import commonSchema from '../../../../libraries/world-characters/_core/schemas/common.schema.json';
import characterSchema from '../../../../libraries/world-characters/_core/schemas/character.schema.json';
import equipmentSchema from '../../../../libraries/world-characters/_core/schemas/equipment.schema.json';
import mountSchema from '../../../../libraries/world-characters/_core/schemas/mount.schema.json';
import environmentSchema from '../../../../libraries/world-characters/_core/schemas/environment.schema.json';

/** Offline source-library contract. No runtime registration, IO, approval or provider calls. */
export const WORLD_METADATA_KINDS = ['character', 'equipment', 'mount', 'environment'] as const;
type Kind = typeof WORLD_METADATA_KINDS[number];
type JsonObject = Record<string, unknown>;
interface Schema {
  $schema?: string; title?: string; $defs?: Record<string, Schema>; $ref?: string;
  type?: string; const?: unknown; enum?: unknown[]; anyOf?: Schema[];
  additionalProperties?: boolean; required?: string[]; properties?: Record<string, Schema>;
  items?: Schema; maxItems?: number; uniqueItems?: boolean;
  pattern?: string; minLength?: number; maxLength?: number; minimum?: number; maximum?: number;
}
export interface WorldAssetFile {
  id: string; path: string; purpose: 'reference-sheet' | 'body-part' | 'prop' | 'mount' | 'background';
  sha256: string; pivot: { x: number; y: number } | null;
}
export interface WorldAsset {
  schemaVersion: 1; kind: Kind; id: string; civilization: string; period: string; role: string;
  variant: string; version: number; status: 'placeholder' | 'draft' | 'ready'; review: 'pending' | 'owner-approved';
  provenance: { source: 'placeholder' | 'chatgpt' | 'manual'; rights: 'pending' | 'owner-cleared'; historicalReview: 'unreviewed' | 'source-scoped'; sources: string[]; notes: string };
  files: WorldAssetFile[];
}
export interface WorldCharacter extends WorldAsset {
  kind: 'character'; displayName: string; styleId: 'stylized-history-v1'; rigId: 'cutout-humanoid-v1';
  equipmentIds: string[]; mountIds: string[]; environmentIds: string[];
}
export interface WorldPack { directory: string; character: WorldCharacter; assets: WorldAsset[] }
const schemas = { character: characterSchema, equipment: equipmentSchema, mount: mountSchema, environment: environmentSchema };
const isObject = (v: unknown): v is JsonObject => v !== null && typeof v === 'object' && !Array.isArray(v);
const reserved = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
const slug = (v: string) => /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(v) && v.length <= 48 && !reserved.test(v);
const fail = (code: string): never => { throw new Error(`WORLD_LIBRARY_${code}`); };

/** Implements only the keywords used by the committed V1 schemas; unknown keywords fail closed.
 * Not a general JSON Schema engine. Refs are fixed local definitions, never paths/URLs to fetch.
 */
function checkSchema(value: unknown, schema: Schema, location = '$'): void {
  const allowed = ['$schema', 'title', '$defs', '$ref', 'type', 'const', 'enum', 'anyOf', 'additionalProperties', 'required', 'properties', 'items', 'maxItems', 'uniqueItems', 'pattern', 'minLength', 'maxLength', 'minimum', 'maximum'];
  if (Object.keys(schema).some(k => !allowed.includes(k))) fail(`SCHEMA_KEYWORD:${location}`);
  if (schema.$ref) {
    const name = /^common\.schema\.json#\/\$defs\/([a-z]+)$/.exec(schema.$ref)?.[1];
    const definition = name ? (commonSchema as unknown as Schema).$defs?.[name] : undefined;
    if (!definition) return fail('SCHEMA_REF');
    checkSchema(value, definition, location);
  }
  if (schema.anyOf && !schema.anyOf.some(branch => { try { checkSchema(value, branch, location); return true; } catch { return false; } })) fail(`SCHEMA_UNION:${location}`);
  if (Object.hasOwn(schema, 'const') && value !== schema.const) fail(`SCHEMA_CONST:${location}`);
  if (schema.enum && !schema.enum.includes(value)) fail(`SCHEMA_ENUM:${location}`);
  if (schema.type) {
    const valid = schema.type === 'object' ? isObject(value) : schema.type === 'array' ? Array.isArray(value) : schema.type === 'null' ? value === null : schema.type === 'integer' ? Number.isSafeInteger(value) : schema.type === 'number' ? typeof value === 'number' && Number.isFinite(value) : typeof value === schema.type;
    if (!valid) fail(`SCHEMA_TYPE:${location}`);
  }
  if (isObject(value)) {
    if (schema.required?.some(k => !Object.hasOwn(value, k))) fail(`SCHEMA_REQUIRED:${location}`);
    if (schema.additionalProperties === false && Object.keys(value).some(k => !Object.hasOwn(schema.properties ?? {}, k))) fail(`SCHEMA_UNKNOWN:${location}`);
    for (const [key, child] of Object.entries(schema.properties ?? {})) if (Object.hasOwn(value, key)) checkSchema(value[key], child, `${location}.${key}`);
  }
  if (Array.isArray(value)) {
    if (schema.maxItems !== undefined && value.length > schema.maxItems) fail(`SCHEMA_CAPACITY:${location}`);
    if (schema.uniqueItems && new Set(value.map(v => JSON.stringify(v))).size !== value.length) fail(`SCHEMA_DUPLICATE:${location}`);
    if (schema.items) value.forEach((v, i) => checkSchema(v, schema.items!, `${location}[${i}]`));
  }
  if (typeof value === 'string' && ((schema.pattern && !new RegExp(schema.pattern).test(value)) || (schema.minLength !== undefined && value.length < schema.minLength) || (schema.maxLength !== undefined && value.length > schema.maxLength))) fail(`SCHEMA_STRING:${location}`);
  if (typeof value === 'number' && ((schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum))) fail(`SCHEMA_RANGE:${location}`);
}

export function validateWorldMetadata(value: unknown, expectedKind: Kind): WorldAsset {
  checkSchema(value, schemas[expectedKind] as unknown as Schema);
  const a = value as WorldAsset;
  if (![a.civilization, a.period, a.role, a.variant].every(slug)) fail('NAMESPACE');
  const prefix = `${a.civilization}.${a.period}.${a.role}.`;
  if (a.id !== `${prefix}${a.variant}.v${a.version}`) fail('ID_CONTEXT');
  const folder = { 'reference-sheet': 'design', 'body-part': 'parts', prop: 'props', mount: 'mounts', background: 'environments' };
  const purposes: Record<Kind, string[]> = { character: ['reference-sheet', 'body-part'], equipment: ['prop'], mount: ['mount'], environment: ['background'] };
  const ids = new Set([a.id]), paths = new Set<string>();
  for (const file of a.files) {
    const pieces = file.id.split('.');
    if (pieces.length !== 5 || file.id !== `${prefix}${pieces[3]}.v${a.version}` || !slug(pieces[3])) fail('FILE_ID_CONTEXT');
    if (ids.has(file.id) || paths.has(file.path)) fail('DUPLICATE_ASSET');
    ids.add(file.id); paths.add(file.path);
    if (!purposes[a.kind].includes(file.purpose) || file.path.split('/')[0] !== folder[file.purpose] || reserved.test(file.path.split('/')[1].split('.')[0])) fail('FILE_SCOPE');
    if (['body-part', 'prop', 'mount'].includes(file.purpose) && (file.pivot === null || !/\.(png|webp)$/.test(file.path))) fail('RIG_PIVOT_OR_FORMAT');
  }
  if (a.status === 'placeholder' && (a.files.length !== 0 || a.review !== 'pending' || a.provenance.source !== 'placeholder')) fail('PLACEHOLDER');
  if (a.status === 'ready' && (a.review !== 'owner-approved' || a.provenance.rights !== 'owner-cleared' || a.provenance.source === 'placeholder')) fail('NOT_REVIEWED');
  return structuredClone(a);
}

export function validateWorldPack(records: readonly unknown[], directory: string): WorldPack {
  const parts = directory.split('/');
  if (parts.length !== 5 || !parts.slice(0, 4).every(slug) || !/^v[1-9][0-9]*$/.test(parts[4])) fail('PACK_PATH');
  if (records.length !== 4) fail('PACK_METADATA');
  const assets = records.map((r, i) => validateWorldMetadata(r, WORLD_METADATA_KINDS[i]));
  const character = assets[0] as WorldCharacter;
  if (directory !== `${character.civilization}/${character.period}/${character.role}/${character.variant}/v${character.version}`) fail('PACK_ID_CONTEXT');
  const ids = new Set<string>(), paths = new Set<string>();
  for (const a of assets) {
    if (a.civilization !== character.civilization || a.period !== character.period || a.role !== character.role || a.version !== character.version) fail('MIXING_DENIED');
    for (const id of [a.id, ...a.files.map(f => f.id)]) { if (ids.has(id)) fail('DUPLICATE_ASSET'); ids.add(id); }
    for (const f of a.files) { if (paths.has(f.path)) fail('DUPLICATE_PATH'); paths.add(f.path); }
    if (a.kind !== 'character' && (a as unknown as JsonObject).characterId !== character.id) fail('OWNER_REFERENCE');
  }
  for (const [index, refs] of [[1, character.equipmentIds], [2, character.mountIds], [3, character.environmentIds]] as const) {
    if (refs.length !== 1 || refs[0] !== assets[index].id) fail('ASSET_REFERENCE');
  }
  const equipment = assets[1] as unknown as { items: { slot: string; fileId: string }[] };
  if (new Set(equipment.items.map(i => i.slot)).size !== equipment.items.length || equipment.items.some(i => !assets[1].files.some(f => f.id === i.fileId))) fail('EQUIPMENT_REFERENCE');
  if (assets[1].status === 'ready' && (equipment.items.length !== assets[1].files.length || assets[1].files.some(f => !equipment.items.some(i => i.fileId === f.id)))) fail('EQUIPMENT_INVENTORY');
  for (const index of [2, 3]) {
    const a = assets[index] as unknown as JsonObject;
    if ((a.availability === 'none' && assets[index].files.length !== 0) || (a.availability === 'present' && assets[index].files.length === 0) || (a.status === 'ready' && a.availability === 'planned')) fail('AVAILABILITY');
    if (index === 2 && ((a.availability === 'none') !== (a.species === 'none'))) fail('MOUNT_SPECIES');
  }
  return { directory, character, assets };
}

/** Exact context only. No nearest-period, cultural aliases or automatic fallback.
 * Selection checks metadata; a future runtime adapter must also verify actual bytes/alpha/rig and use existing authority.
 */
export function selectWorldCharacterPack(pack: WorldPack, context: { civilization: string; period: string; role: string; characterId: string }): WorldPack {
  const checked = validateWorldPack(pack.assets, pack.directory);
  const c = checked.character;
  if (context.civilization !== c.civilization || context.period !== c.period || context.role !== c.role || context.characterId !== c.id) fail('SELECTION_CONTEXT');
  if (checked.assets.some(a => a.status !== 'ready')) fail('NOT_READY');
  if (!c.files.some(f => f.purpose === 'reference-sheet') || !c.files.some(f => f.purpose === 'body-part')) fail('DESIGN_OR_PARTS_MISSING');
  return checked;
}
