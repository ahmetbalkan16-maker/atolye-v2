import { readWorldCharacterLibrary } from './lib/world-character-library-files';

try {
  const packs = readWorldCharacterLibrary();
  console.log(`World character library: PASS (${packs.length} packs, ${packs.reduce((n, p) => n + p.assets.length, 0)} metadata records)`);
  for (const pack of packs) console.log(`${pack.character.id}: ${pack.character.status}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'WORLD_LIBRARY_INVALID');
  process.exitCode = 1;
}
