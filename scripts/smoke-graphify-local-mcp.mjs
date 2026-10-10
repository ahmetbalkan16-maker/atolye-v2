// Exercise the installed Graphify path guard on Windows and POSIX, without starting a server.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { patchWindowsGraphPath } from './graphify-local-mcp.mjs';
const pkg = process.env.GRAPHIFY_MODULE_ROOT || path.join(process.env.APPDATA, 'npm/node_modules/@sentropic/graphify');
const source = fs.readFileSync(path.join(pkg, 'dist/index.js'), 'utf8');
const begin = source.indexOf('function validateGraphPath(filePath, base)');
const end = source.indexOf('function sanitizeLabel', begin);
assert.ok(begin >= 0 && end > begin);
const guard = source.slice(begin, end) + '\n// relative as pathRelative\n';
const patched = patchWindowsGraphPath(guard);
let count = 0;
for (const [style, paths, base] of [
  ['windows', path.win32, 'D:\\Atölye\\.graphify'],
  ['posix', path.posix, '/new-pc/Atölye/.graphify'],
]) {
  const context = vm.createContext({ pathResolve: paths.resolve, pathRelative: paths.relative, isAbsolute: paths.isAbsolute, existsSync3: () => true, DEFAULT_GRAPHIFY_STATE_DIR: '.graphify' });
  vm.runInContext(patched, context);
  for (const name of ['graph.json', 'nested/graph.json']) {
    const file = paths.join(base, name);
    assert.equal(context.validateGraphPath(file, base), paths.resolve(file));
    count++;
  }
  for (const file of [paths.dirname(base), paths.join(base, '..', 'outside.json'), base + '-sibling' + paths.sep + 'graph.json', paths.join(base, 'nested', '..', '..', 'outside.json'), style === 'windows' ? 'E:\\graph.json' : '/other/graph.json']) {
    assert.throws(() => context.validateGraphPath(file, base), /escapes the allowed directory/);
    count++;
  }
  // Missing graph files must still be refused independently of containment.
  vm.runInContext('existsSync3 = value => value === ' + JSON.stringify(base), context);
  assert.throws(() => context.validateGraphPath(paths.join(base, 'absent.json'), base), /Graph file not found/);
  count++;
}
assert.throws(() => patchWindowsGraphPath('unrecognized source'), /SOURCE_UNRECOGNIZED/); count++;
assert.throws(() => patchWindowsGraphPath(guard + guard), /SOURCE_UNRECOGNIZED/); count++;
console.log(JSON.stringify({ status: 'PASS', suite: 'graphify-local-mcp-path-guard', scenarios: count, serverStarted: false }));
