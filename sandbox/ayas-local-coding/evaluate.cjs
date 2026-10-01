// Trusted evaluator-side loader. Frozen TypeScript bytes are not rewritten.
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS require hook runs frozen historical TS modules. */
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('/opt/ayas/payload/toolchain/typescript.js');
// Keep native compiler/child Node worker pools inside the unchanged 64-task cap.
process.env.GOMAXPROCS = '2';
process.env.UV_THREADPOOL_SIZE = '1';
process.env.NODE_OPTIONS = '--v8-pool-size=1';
const root = '/opt/ayas/payload/cases';
const id = process.argv[2];
if (!/^[a-z0-9-]+$/.test(id || '')) throw Error('EVALUATOR_ID_REFUSED');
const manifest = JSON.parse(fs.readFileSync('/opt/ayas/payload/CASES.json', 'utf8'));
const item = manifest.find(row => row.caseId === id);
if (!item) throw Error('UNREGISTERED_EVALUATOR');
const sealedRoot = path.join(root, id);
const caseRoot = fs.mkdtempSync('/tmp/ayas-evaluator-');
fs.cpSync(sealedRoot, caseRoot, { recursive: true, dereference: false });
// The frozen concurrency test invokes the exact tsx CLI path in child processes.
// Its native executable stays on sealed read-only image storage, not noexec tmpfs.
fs.symlinkSync('/opt/ayas/payload/toolchain/node_modules', path.join(caseRoot, 'node_modules'));
const candidateFile = '/workspace/candidate.json';
if (fs.existsSync(candidateFile)) {
  const candidate = JSON.parse(fs.readFileSync(candidateFile, 'utf8'));
  if (candidate.caseId !== id || !Array.isArray(candidate.sources)
    || candidate.sources.length !== item.exactFiles.length) throw Error('CANDIDATE_SCOPE_REFUSED');
  const seen = new Set();
  for (const source of candidate.sources) {
    if (!item.exactFiles.includes(source.path) || seen.has(source.path)
      || typeof source.content !== 'string' || Buffer.byteLength(source.content) > 256000) throw Error('CANDIDATE_SCOPE_REFUSED');
    seen.add(source.path);
    fs.chmodSync(path.join(caseRoot, source.path), 0o600); // only this disposable tmpfs copy
    fs.writeFileSync(path.join(caseRoot, source.path), source.content);
  }
}
const original = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...args) {
  if (request.startsWith('@/')) request = path.join(caseRoot, 'src', request.slice(2));
  if (parent) parent.paths = [...(parent.paths || []), '/opt/ayas/payload/toolchain/node_modules'];
  return original.call(this, request, parent, ...args);
};
require.extensions['.ts'] = function(module, file) {
  const content = fs.readFileSync(file, 'utf8');
  module._compile(ts.transpileModule(content, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX,
  }, fileName: file }).outputText, file);
};
require.extensions['.tsx'] = require.extensions['.ts'];
process.chdir(caseRoot);
require(path.join(caseRoot, item.evaluatorScript));
