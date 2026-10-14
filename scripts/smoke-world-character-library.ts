import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateWorldPack, selectWorldCharacterPack, type WorldAssetFile, type WorldPack } from '../src/lib/character/WorldCharacterLibrary';
import { readWorldCharacterLibrary } from './lib/world-character-library-files';
import policy from '../libraries/world-characters/_core/mixing-policy.json';

let count = 0;
const test = (name: string, run: () => void) => { run(); count++; console.log(`PASS ${name}`); };
const packs = readWorldCharacterLibrary();
const pack = packs.find(p => p.character.civilization === 'ottoman')!;
const context = { civilization: 'ottoman', period: 'early-modern', role: 'janissary', characterId: pack.character.id };
const rejectMutation = (edit: (p: WorldPack) => void, code: RegExp = /WORLD_LIBRARY_/) => {
  const changed = structuredClone(pack); edit(changed);
  assert.throws(() => validateWorldPack(changed.assets, changed.directory), code);
};
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const file = (variant: string, purpose: WorldAssetFile['purpose'], filename: string, bytes: Buffer): WorldAssetFile => ({
  id: `ottoman.early-modern.janissary.${variant}.v1`, purpose, path: filename, sha256: hash(bytes), pivot: purpose === 'reference-sheet' ? null : { x: 0.5, y: 0.5 },
});
const sheet = Buffer.from('hash fixture only; not a production image'), part = Buffer.from('cutout hash fixture');
function readyFixture(): WorldPack {
  const p = structuredClone(pack);
  for (const a of p.assets) { a.status = 'ready'; a.review = 'owner-approved'; a.provenance.source = 'manual'; a.provenance.rights = 'owner-cleared'; }
  p.assets[0].files = [file('design-front', 'reference-sheet', 'design/front.png', sheet), file('part-torso', 'body-part', 'parts/torso.png', part)];
  Object.assign(p.assets[3], { availability: 'none' });
  return validateWorldPack(p.assets, p.directory);
}

test('exact four requested namespaces; all structural placeholders', () => {
  assert.deepEqual(packs.filter(p => p.character.variant === 'default').map(p => p.character.civilization).sort(), ['byzantium', 'egypt', 'ottoman', 'persia']);
  assert(packs.filter(p => p.character.variant === 'default').every(p => p.assets.length === 4 && p.assets.every(a => a.status === 'placeholder' && a.files.length === 0)));
});
test('policy has no implicit fallback or cultural sharing', () => {
  assert.equal(policy.mode, 'deny-by-default');
  for (const key of ['crossCivilization', 'crossPeriod', 'implicitFallback', 'sharedCulturalAssets'] as const) assert.equal(policy[key], false);
  assert.deepEqual(policy.requireExact, ['civilization', 'period', 'role', 'version']);
  assert.deepEqual(policy.sharedCore, ['style', 'rig', 'schema']);
});
test('placeholder is never selectable', () => assert.throws(() => selectWorldCharacterPack(pack, context), /NOT_READY/));
test('metadata-ready exact context can be selected; caller cannot mutate returned pack', () => {
  const ready = readyFixture(), selected = selectWorldCharacterPack(ready, context);
  selected.assets[0].files.length = 0; assert.equal(ready.assets[0].files.length, 2);
});
for (const [field, value] of [['civilization', 'persia'], ['period', 'late-modern'], ['role', 'archer'], ['characterId', 'ottoman.early-modern.janissary.default.v2']] as const) {
  test(`selection rejects wrong ${field}`, () => assert.throws(() => selectWorldCharacterPack(readyFixture(), { ...context, [field]: value }), /SELECTION_CONTEXT/));
}
test('cross-civilization companion rejected even with self-consistent ID', () => rejectMutation(p => { p.assets[1].civilization = 'persia'; p.assets[1].id = p.assets[1].id.replace('ottoman.', 'persia.'); }, /MIXING_DENIED/));
test('cross-period companion rejected', () => rejectMutation(p => { p.assets[2].period = 'medieval'; p.assets[2].id = p.assets[2].id.replace('.early-modern.', '.medieval.'); }, /MIXING_DENIED/));
test('cross-role companion rejected', () => rejectMutation(p => { p.assets[1].role = 'archer'; p.assets[1].id = p.assets[1].id.replace('.janissary.', '.archer.'); }, /MIXING_DENIED/));
test('cross-version companion rejected', () => rejectMutation(p => { p.assets[1].version = 2; p.assets[1].id = p.assets[1].id.replace('.v1', '.v2'); }, /MIXING_DENIED/));
test('directory and ID must agree', () => assert.throws(() => validateWorldPack(pack.assets, pack.directory.replace('ottoman/', 'persia/')), /PACK_ID_CONTEXT/));
test('ID cannot claim another namespace', () => rejectMutation(p => { p.assets[0].id = 'persia.achaemenid.immortal.default.v1'; }, /ID_CONTEXT/));
test('duplicate global identity within pack rejected', () => rejectMutation(p => { p.assets[1].variant = 'default'; p.assets[1].id = p.assets[0].id; }, /DUPLICATE_ASSET/));
test('wrong owner reference rejected', () => rejectMutation(p => Object.assign(p.assets[2], { characterId: packs[0].character.id }), /OWNER_REFERENCE/));
test('dangling reference rejected', () => rejectMutation(p => { p.character.equipmentIds = ['ottoman.early-modern.janissary.unknown.v1']; }, /ASSET_REFERENCE/));
test('unknown field rejected', () => rejectMutation(p => Object.assign(p.assets[1], { allowMixing: true }), /SCHEMA_UNKNOWN/));
test('schema version rejected', () => rejectMutation(p => Object.assign(p.assets[0], { schemaVersion: 2 }), /SCHEMA_CONST/));
test('missing metadata rejected', () => assert.throws(() => validateWorldPack(pack.assets.slice(0, 3), pack.directory), /PACK_METADATA/));
test('wrong metadata kind rejected', () => rejectMutation(p => Object.assign(p.assets[0], { kind: 'environment' }), /SCHEMA_CONST/));
test('reserved Windows namespace rejected', () => rejectMutation(p => { p.assets[0].civilization = 'con'; p.assets[0].id = p.assets[0].id.replace('ottoman.', 'con.'); }, /NAMESPACE/));
for (const bad of ['../persia/image.png', 'design/../front.png', 'C:/outside.png', 'design\\front.png', 'https://example.com/front.png']) {
  test(`unsafe path rejected: ${bad}`, () => {
    const p = readyFixture(); p.assets[0].files[0].path = bad;
    assert.throws(() => validateWorldPack(p.assets, p.directory), /SCHEMA_STRING/);
  });
}
test('file identity cannot cross culture', () => { const p = readyFixture(); p.assets[0].files[0].id = 'persia.achaemenid.immortal.front.v1'; assert.throws(() => validateWorldPack(p.assets, p.directory), /FILE_ID_CONTEXT/); });
test('file purpose must match category/folder', () => { const p = readyFixture(); p.assets[0].files[0].path = 'props/front.png'; assert.throws(() => validateWorldPack(p.assets, p.directory), /FILE_SCOPE/); });
test('cutout pivot required', () => { const p = readyFixture(); p.assets[0].files[1].pivot = null; assert.throws(() => validateWorldPack(p.assets, p.directory), /RIG_PIVOT/); });
test('cutout JPEG rejected', () => { const p = readyFixture(); p.assets[0].files[1].path = 'parts/torso.jpg'; assert.throws(() => validateWorldPack(p.assets, p.directory), /RIG_PIVOT_OR_FORMAT/); });
test('ready without review rejected', () => { const p = readyFixture(); p.assets[0].review = 'pending'; assert.throws(() => validateWorldPack(p.assets, p.directory), /NOT_REVIEWED/); });
test('ready without rights rejected', () => { const p = readyFixture(); p.assets[0].provenance.rights = 'pending'; assert.throws(() => validateWorldPack(p.assets, p.directory), /NOT_REVIEWED/); });
test('ready planned environment rejected', () => { const p = readyFixture(); Object.assign(p.assets[3], { availability: 'planned' }); assert.throws(() => validateWorldPack(p.assets, p.directory), /AVAILABILITY/); });
test('ready needs reference sheet and cutout', () => { const p = readyFixture(); p.assets[0].files.pop(); assert.throws(() => selectWorldCharacterPack(p, context), /DESIGN_OR_PARTS_MISSING/); });
test('mount none cannot claim horse', () => rejectMutation(p => Object.assign(p.assets[2], { species: 'horse' }), /MOUNT_SPECIES/));
test('equipment slot cannot reference missing file', () => rejectMutation(p => Object.assign(p.assets[1], { items: [{ slot: 'hand-right', fileId: 'ottoman.early-modern.janissary.missing.v1' }] }), /EQUIPMENT_REFERENCE/));

const tempParent = fs.realpathSync.native(os.tmpdir());
const temp = fs.mkdtempSync(path.join(tempParent, 'atolye-world-library-'));
const root = path.join(temp, 'library');
try {
  fs.cpSync(path.resolve('libraries/world-characters'), root, { recursive: true });
  const recordPath = path.join(root, pack.directory, 'metadata', 'character.json');
  const original = fs.readFileSync(recordPath);
  test('filesystem audit is read-only', () => { assert.equal(readWorldCharacterLibrary(root).length, packs.length); assert.deepEqual(fs.readFileSync(recordPath), original); });
  const ready = readyFixture();
  for (const a of ready.assets) fs.writeFileSync(path.join(root, ready.directory, 'metadata', `${a.kind}.json`), JSON.stringify(a));
  const sheetPath = path.join(root, ready.directory, 'design', 'front.png');
  const partPath = path.join(root, ready.directory, 'parts', 'torso.png');
  fs.writeFileSync(sheetPath, sheet); fs.writeFileSync(partPath, part);
  test('declared bytes verified by hash (fixture is not an image decoder test)', () => assert.equal(readWorldCharacterLibrary(root).length, packs.length));
  test('tampered file rejected', () => { fs.writeFileSync(sheetPath, 'tamper'); assert.throws(() => readWorldCharacterLibrary(root), /FILE_HASH/); fs.writeFileSync(sheetPath, sheet); });
  test('missing file rejected', () => { fs.unlinkSync(partPath); assert.throws(() => readWorldCharacterLibrary(root), /ENOENT/); fs.writeFileSync(partPath, part); });
  test('unregistered cultural file rejected', () => { const extra = path.join(root, ready.directory, 'props', 'foreign.png'); fs.writeFileSync(extra, 'foreign'); assert.throws(() => readWorldCharacterLibrary(root), /UNDECLARED_FILE/); fs.unlinkSync(extra); });
  test('missing standard folder rejected', () => { const dir = path.join(root, ready.directory, 'mounts'); fs.renameSync(dir, `${dir}-temp`); assert.throws(() => readWorldCharacterLibrary(root), /PACK_FOLDERS/); fs.renameSync(`${dir}-temp`, dir); });
  test('metadata byte bound enforced', () => { fs.writeFileSync(recordPath, ' '.repeat(65537)); assert.throws(() => readWorldCharacterLibrary(root), /FILE_SIZE/); fs.writeFileSync(recordPath, JSON.stringify(ready.character)); });
  test('junction pack escape rejected', () => {
    const dir = path.join(root, 'persia', 'achaemenid', 'immortal', 'default', 'v1');
    const held = path.join(temp, 'held-pack'); fs.renameSync(dir, held);
    fs.symlinkSync(held, dir, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => readWorldCharacterLibrary(root), /LINK_OR_TYPE/);
    fs.unlinkSync(dir); fs.renameSync(held, dir);
  });
} finally {
  const resolved = fs.realpathSync.native(temp);
  if (path.dirname(resolved) !== tempParent || !path.basename(resolved).startsWith('atolye-world-library-')) throw new Error('WORLD_LIBRARY_FIXTURE_CLEANUP_PATH');
  fs.rmSync(resolved, { recursive: true, force: true });
}
console.log(`World character library smoke: ${count}/${count} PASS`);
