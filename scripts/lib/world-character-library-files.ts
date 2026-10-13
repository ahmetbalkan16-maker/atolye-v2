import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateWorldPack, WORLD_METADATA_KINDS, type WorldPack } from '../../src/lib/character/WorldCharacterLibrary';

const fail = (code: string): never => { throw new Error(`WORLD_LIBRARY_${code}`); };
const packFolders = ['design', 'parts', 'props', 'mounts', 'environments', 'metadata'];

/** Read-only bounded audit of a trusted source checkout. Never resolves metadata-supplied roots. */
export function readWorldCharacterLibrary(root = path.resolve('libraries/world-characters')): WorldPack[] {
  const base = path.resolve(root);
  // Reject links/junctions in every ancestor, including the checkout root.
  let ancestor = base;
  while (true) {
    if (fs.lstatSync(ancestor).isSymbolicLink() || fs.realpathSync.native(ancestor) !== ancestor) fail('LINK');
    const parent = path.dirname(ancestor); if (parent === ancestor) break; ancestor = parent;
  }
  const inspect = (relative: string, kind: 'file' | 'directory', maxBytes = 65536) => {
    const target = path.resolve(base, relative);
    if (target !== base && !target.startsWith(base + path.sep)) fail('PATH');
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || fs.realpathSync.native(target) !== target || (kind === 'file' ? !stat.isFile() : !stat.isDirectory())) fail('LINK_OR_TYPE');
    if (kind === 'file' && stat.size > maxBytes) fail('FILE_SIZE');
    return target;
  };
  const entries = (relative: string) => {
    const names = fs.readdirSync(inspect(relative, 'directory')).sort();
    if (names.length > 256) fail('DIRECTORY_CAPACITY');
    return names;
  };
  const readJson = (relative: string) => JSON.parse(fs.readFileSync(inspect(relative, 'file'), 'utf8')) as unknown;
  const packs: WorldPack[] = [], ids = new Set<string>();
  let directoryCount = 0;
  function walk(relative: string, depth: number) {
    if (++directoryCount > 2048) fail('LIBRARY_CAPACITY');
    if (depth < 5) {
      for (const name of entries(relative)) {
        if (depth === 0 && ['_core', 'README.md'].includes(name)) continue;
        if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name) || name.length > 48) fail('DIRECTORY_NAME');
        walk(relative ? `${relative}/${name}` : name, depth + 1);
      }
      return;
    }
    if (packs.length >= 256) fail('PACK_CAPACITY');
    if (JSON.stringify(entries(relative)) !== JSON.stringify([...packFolders].sort())) fail('PACK_FOLDERS');
    for (const folder of packFolders) inspect(`${relative}/${folder}`, 'directory');
    const expectedMetadata = WORLD_METADATA_KINDS.map(k => `${k}.json`).sort();
    if (JSON.stringify(entries(`${relative}/metadata`)) !== JSON.stringify(expectedMetadata)) fail('METADATA_INVENTORY');
    const pack = validateWorldPack(WORLD_METADATA_KINDS.map(kind => readJson(`${relative}/metadata/${kind}.json`)), relative);
    const declared = new Map(pack.assets.flatMap(a => a.files.map(f => [f.path, f] as const)));
    for (const a of pack.assets) for (const id of [a.id, ...a.files.map(f => f.id)]) {
      if (ids.has(id)) fail('GLOBAL_DUPLICATE_ID'); ids.add(id);
    }
    for (const folder of packFolders.filter(f => f !== 'metadata')) {
      for (const name of entries(`${relative}/${folder}`)) {
        if (name === '.gitkeep') { inspect(`${relative}/${folder}/${name}`, 'file', 0); continue; }
        const logical = `${folder}/${name}`;
        if (!declared.has(logical)) fail('UNDECLARED_FILE');
      }
    }
    for (const [logical, file] of declared) {
      const bytes = fs.readFileSync(inspect(`${relative}/${logical}`, 'file', 32 * 1024 * 1024));
      if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) fail('FILE_HASH');
    }
    packs.push(pack);
  }
  walk('', 0);
  if (!packs.length) fail('EMPTY_LIBRARY');
  return packs;
}
