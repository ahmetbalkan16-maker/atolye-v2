// Windows compatibility for Graphify 0.17.1. The installed package stays intact.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';

export function patchWindowsGraphPath(source) {
  const before = 'if (!resolved.startsWith(resolvedBase + "/") && resolved !== resolvedBase) {';
  if (source.split(before).length !== 2 || !source.includes('relative as pathRelative') || !source.includes('function validateGraphPath(filePath, base)')) {
    throw new Error('GRAPHIFY_COMPAT_SOURCE_UNRECOGNIZED');
  }
  const after = 'const graphRelative = pathRelative(resolvedBase, resolved);\n  if (graphRelative === ".." || graphRelative.startsWith("../") || graphRelative.startsWith("..\\\\") || isAbsolute(graphRelative)) {';
  return source.replace(before, after);
}

function realDirectory(directory) {
  const item = fs.lstatSync(directory);
  if (!item.isDirectory() || item.isSymbolicLink()) throw new Error('GRAPHIFY_COMPAT_DIRECTORY_REQUIRED');
}

function createFileOnce(file, bytes) {
  try { fs.writeFileSync(file, bytes, { flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const item = fs.lstatSync(file);
  if (!item.isFile() || item.isSymbolicLink() || !fs.readFileSync(file).equals(Buffer.from(bytes))) throw new Error('GRAPHIFY_COMPAT_CACHE_CHANGED');
}

async function main() {
  if (process.argv.length !== 2) throw new Error('GRAPHIFY_LOCAL_MCP_TAKES_NO_ARGUMENTS');
  const root = fs.realpathSync.native(process.cwd());
  const state = path.join(root, '.graphify');
  realDirectory(state);
  const graph = path.join(state, 'graph.json');
  if (!fs.lstatSync(graph).isFile() || fs.lstatSync(graph).isSymbolicLink()) throw new Error('GRAPHIFY_LOCAL_GRAPH_REQUIRED');
  const pkg = process.env.GRAPHIFY_MODULE_ROOT
    ? path.resolve(process.env.GRAPHIFY_MODULE_ROOT)
    : path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@sentropic', 'graphify');
  if (!process.env.GRAPHIFY_MODULE_ROOT && !process.env.APPDATA) throw new Error('GRAPHIFY_MODULE_ROOT_REQUIRED');
  realDirectory(pkg);
  const metadataBytes = fs.readFileSync(path.join(pkg, 'package.json'));
  const metadata = JSON.parse(metadataBytes);
  if (metadata.name !== '@sentropic/graphify' || metadata.version !== '0.17.1') throw new Error('GRAPHIFY_COMPAT_REQUIRES_VERSION_0_17_1');
  const source = fs.readFileSync(path.join(pkg, 'dist', 'index.js'), 'utf8');
  const patched = patchWindowsGraphPath(source);
  const key = crypto.createHash('sha256').update(pkg).update('\0').update(patched).digest('hex');
  const parent = path.join(state, 'mcp-compat');
  fs.mkdirSync(parent, { recursive: true });
  realDirectory(parent);
  const cache = path.join(parent, key);
  fs.mkdirSync(cache, { recursive: true });
  realDirectory(cache);
  const dist = path.join(cache, 'dist');
  fs.mkdirSync(dist, { recursive: true });
  realDirectory(dist);
  createFileOnce(path.join(cache, 'package.json'), metadataBytes);
  createFileOnce(path.join(dist, 'index.mjs'), patched);
  const modules = path.join(cache, 'node_modules');
  const expectedModules = fs.realpathSync.native(path.join(pkg, 'node_modules'));
  if (!fs.existsSync(modules)) fs.symlinkSync(expectedModules, modules, 'junction');
  if (!fs.lstatSync(modules).isSymbolicLink() || fs.realpathSync.native(modules) !== expectedModules) throw new Error('GRAPHIFY_COMPAT_DEPENDENCY_LINK_CHANGED');
  const runtime = await import(pathToFileURL(path.join(dist, 'index.mjs')).href);
  await runtime.serve(graph); // Default ontology write mode remains disabled.
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
