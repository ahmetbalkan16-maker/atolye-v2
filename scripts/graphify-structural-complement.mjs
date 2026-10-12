// Project-owned parser complement for ten real Graphify 0.17.1 extraction gaps.
// Always writes a self-contained, `graphify build`-valid fragment and a receipt. With
// `--apply` it adds its own nodes to graph.json by id, the way `graphify update` keeps prior
// nodes; `graphify build --fragment` is not used because its label dedup folds distinct
// same-named methods and clears every community. It never edits status rules, source files,
// upstream diagnostics or settings. Run it after each `graphify update`.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Routes whose Graphify node ids collide with their siblings' (`filename_route…`), leaving them unattributed. */
export const COLLIDING_ROUTE_FILES = Object.freeze([
  'app/api/assets/images/[slug]/[fileName]/route.ts',
  'app/api/assets/thumbnails/[slug]/[fileName]/route.ts',
]);

/**
 * Every file Graphify 0.17.1 indexes but cannot extract here: all PowerShell (no installed
 * grammar), the CI workflows (no YAML extractor) and the colliding routes. Discovered from Git in
 * Graphify's `--scope all` sense (tracked plus untracked, not ignored), so a new script is
 * covered without editing this list.
 */
export function discoverComplementFiles(root) {
  const listed = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--',
    '*.ps1', '.github/workflows/*.yml', '.github/workflows/*.yaml'], { cwd: root, windowsHide: true, maxBuffer: 8_000_000 })
    .toString('utf8').split('\0').filter(Boolean).map(file => file.replace(/\\/g, '/'));
  const routes = COLLIDING_ROUTE_FILES.filter(file => fs.existsSync(path.join(root, file)));
  return Object.freeze([...new Set([...routes, ...listed])].sort());
}
const HERE = path.dirname(fileURLToPath(import.meta.url));
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const relative = (root, file) => path.relative(root, file).replace(/\\/g, '/');
const nodeId = (file, symbol) => `atolye_structural:${file}:${symbol}`;

function boundedRead(root, file) {
  if (path.isAbsolute(file) || file.split('/').includes('..')) throw new Error('COMPLEMENT_SOURCE_OUTSIDE_ROOT');
  const absolute = path.join(root, file);
  const resolved = fs.realpathSync.native(absolute);
  const rel = path.relative(root, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('COMPLEMENT_SOURCE_OUTSIDE_ROOT');
  const stat = fs.statSync(resolved);
  if (!stat.isFile() || stat.size > 2_000_000) throw new Error('COMPLEMENT_SOURCE_SIZE_OR_KIND');
  return fs.readFileSync(resolved);
}

export function extractStructuralComplement({ root, graph, graphifyModuleRoot, files }) {
  root = fs.realpathSync.native(root);
  files ??= discoverComplementFiles(root);
  const require = createRequire(path.join(root, 'package.json'));
  const ts = require('typescript');
  graphifyModuleRoot ??= process.env.GRAPHIFY_MODULE_ROOT || path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@sentropic', 'graphify');
  const graphifyRequire = createRequire(path.join(graphifyModuleRoot, 'package.json'));
  const YAML = graphifyRequire('yaml');
  const yamlVersion = graphifyRequire('yaml/package.json').version;
  const graphNodes = graph.nodes ?? [];
  const nodes = new Map(), edges = new Map(), reports = [];
  const source = new Map(files.map(file => [file, boundedRead(root, file)]));
  const moduleNode = (file) => graphNodes.find(n => n.source_file === file && n.label === path.posix.basename(file));
  const resolveFile = (value, from) => {
    const normalized = value.replace(/\\/g, '/');
    if (normalized.startsWith('@/')) return candidateFile(`src/${normalized.slice(2)}`);
    if (normalized.startsWith('./') || normalized.startsWith('../')) return candidateFile(path.posix.join(path.posix.dirname(from), normalized));
    return candidateFile(normalized) ?? candidateFile(path.posix.join(path.posix.dirname(from), normalized));
  };
  const candidateFile = (file) => {
    for (const suffix of ['', '.ts', '.tsx', '.mjs', '.ps1', '/index.ts']) {
      const name = file + suffix;
      if (path.posix.isAbsolute(name) || name.split('/').includes('..')) continue;
      if (fs.existsSync(path.join(root, name)) && fs.statSync(path.join(root, name)).isFile()) return name;
    }
    return null;
  };
  function addNode(file, symbol, label, line, parser, extra = {}) {
    const id = nodeId(file, symbol);
    // A workflow is not a Graphify code extension: `update` prunes code-typed nodes of non-code files.
    const fileType = /\.ya?ml$/.test(file) ? 'document' : 'code';
    const item = { id, label, file_type: fileType, source_file: file, source_location: `L${line}`, source_sha256: sha256(source.get(file)), extraction_parser: parser, ...extra };
    const existing = nodes.get(id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(item)) throw new Error(`COMPLEMENT_NODE_COLLISION:${id}`);
    nodes.set(id, item);
    return id;
  }
  function addEdge(file, from, to, relation, line, parser) {
    if (from === to) return; // Recursive command occurrences remain in the receipt.
    const key = `${from}\0${to}\0${relation}`;
    if (!edges.has(key)) edges.set(key, { source: from, target: to, relation, confidence: 'EXTRACTED', source_file: file, source_location: `L${line}`, source_sha256: sha256(source.get(file)), extraction_parser: parser, weight: 1 });
  }
  function targetFileNode(file) {
    const existing = moduleNode(file);
    if (existing) return existing.id;
    if (source.has(file)) return nodeId(file, 'file');
    return null; // No invented placeholder for a source absent from the graph.
  }

  for (const [file, bytes] of source) {
    if (!file.endsWith('.ts')) continue;
    const parser = `typescript/${ts.version}`;
    const tree = ts.createSourceFile(file, bytes.toString('utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const lineOf = n => tree.getLineAndCharacterOfPosition(n.getStart(tree)).line + 1;
    const errors = tree.parseDiagnostics.map(d => ({ line: tree.getLineAndCharacterOfPosition(d.start ?? 0).line + 1, code: d.code, message: ts.flattenDiagnosticMessageText(d.messageText, '\n') }));
    const report = { file, source_sha256: sha256(bytes), parser, errors, unresolvedCalls: [] };
    reports.push(report);
    if (errors.length) continue; // Fail closed: a broken source adds no coverage.
    const fileId = addNode(file, 'file', path.posix.basename(file), 1, parser);
    const imports = new Map(), functions = new Map();
    for (const statement of tree.statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        const target = resolveFile(statement.moduleSpecifier.text, file);
        const targetId = target && targetFileNode(target);
        if (targetId) addEdge(file, fileId, targetId, 'imports_from', lineOf(statement), parser);
        const bindings = statement.importClause?.namedBindings;
        if (target && bindings && ts.isNamedImports(bindings)) for (const binding of bindings.elements) imports.set(binding.name.text, { file: target, name: (binding.propertyName ?? binding.name).text });
      } else if ((ts.isFunctionDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) && statement.name) {
        const label = statement.name.text + (ts.isFunctionDeclaration(statement) ? '()' : '');
        const id = addNode(file, `${ts.isFunctionDeclaration(statement) ? 'function' : 'type'}:${statement.name.text}`, label, lineOf(statement), parser);
        addEdge(file, fileId, id, 'contains', lineOf(statement), parser);
        if (ts.isFunctionDeclaration(statement)) functions.set(statement.name.text, id);
      }
    }
    function visit(n, owner) {
      if (ts.isFunctionDeclaration(n) && n.name) owner = functions.get(n.name.text) ?? owner;
      if (ts.isCallExpression(n)) {
        let target;
        if (ts.isIdentifier(n.expression)) target = functions.get(n.expression.text);
        else if (ts.isPropertyAccessExpression(n.expression) && ts.isIdentifier(n.expression.expression)) {
          const imported = imports.get(n.expression.expression.text);
          if (imported) {
            // Graphify's parsed class contains the actual method; require that edge
            // instead of guessing a method ID from a same-named global symbol.
            const klass = graphNodes.find(x => x.source_file === imported.file && x.label === imported.name);
            const member = graphNodes.find(x => x.source_file === imported.file && x.label === `.${n.expression.name.text}()` && (graph.links ?? graph.edges ?? []).some(e => e.source === klass?.id && e.target === x.id && e.relation === 'method'));
            target = member?.id;
          }
        }
        if (target) addEdge(file, owner, target, 'calls', lineOf(n), parser);
        else report.unresolvedCalls.push({ expression: n.expression.getText(tree), line: lineOf(n) });
      }
      ts.forEachChild(n, child => visit(child, owner));
    }
    visit(tree, fileId);
  }

  const psFiles = [...source].filter(([file]) => file.endsWith('.ps1'));
  if (psFiles.length) {
    const input = JSON.stringify({ files: psFiles.map(([file, bytes]) => ({ file, text: bytes.toString('utf8').replace(/^\uFEFF/, '') })) });
    const raw = execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', path.join(HERE, 'graphify-powershell-ast.ps1')], { input, encoding: 'utf8', timeout: 30_000, windowsHide: true, maxBuffer: 8_000_000 });
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, ''));
    for (const item of parsed) {
      const file = item.file, parser = `${item.parser}/${item.version}`;
      reports.push({ file, source_sha256: sha256(source.get(file)), parser, errors: item.errors, functions: item.functions.length, staticCommands: item.commands.filter(c => c.name).length, dynamicCommands: item.commands.filter(c => !c.name).map(c => ({ line: c.line, invocation: c.invocation })) });
      if (item.errors.length) continue;
      const fileId = addNode(file, 'file', path.posix.basename(file), 1, parser);
      const functions = new Map(), byName = new Map();
      for (const f of item.functions) {
        const id = addNode(file, `function:${f.offset}`, `${f.name}()`, f.line, parser);
        functions.set(f.offset, id);
        const matches = byName.get(f.name.toLowerCase()) ?? [];
        matches.push(id); byName.set(f.name.toLowerCase(), matches);
        addEdge(file, fileId, id, 'contains', f.line, parser);
      }
      for (const c of item.commands) {
        if (!c.name) continue; // Dynamic invocation cannot safely name a callee.
        const local = byName.get(c.name.toLowerCase());
        let target = local?.length === 1 ? local[0] : null;
        if (!target) {
          const id = nodeId(file, `command:${c.name.toLowerCase()}`);
          target = nodes.has(id) ? id : addNode(file, `command:${c.name.toLowerCase()}`, c.name, c.line, parser, { node_kind: 'static_command_name', resolution: 'runtime_binding_not_asserted' });
        }
        addEdge(file, functions.get(c.ownerOffset) ?? fileId, target, 'calls', c.line, parser);
      }
      for (const literal of item.literals) {
        const target = resolveFile(literal.value, file);
        const id = target && targetFileNode(target);
        if (id) addEdge(file, fileId, id, 'references_file', literal.line, parser);
      }
    }
  }

  for (const [file, bytes] of source) {
    if (!/\.ya?ml$/.test(file)) continue;
    const parser = `yaml/${yamlVersion}`, counter = new YAML.LineCounter();
    const doc = YAML.parseDocument(bytes.toString('utf8'), { lineCounter: counter, uniqueKeys: true });
    const errors = doc.errors.map(e => ({ message: e.message, line: counter.linePos(e.pos[0]).line }));
    reports.push({ file, source_sha256: sha256(bytes), parser, errors });
    if (errors.length) continue;
    const lineOf = n => counter.linePos(n?.range?.[0] ?? 0).line;
    const fileId = addNode(file, 'file', path.posix.basename(file), 1, parser);
    const jobs = doc.get('jobs', true);
    if (!YAML.isMap(jobs)) throw new Error('COMPLEMENT_WORKFLOW_JOBS_REQUIRED');
    for (const job of jobs.items) {
      const jobName = String(job.key.value), jobId = addNode(file, `job:${jobName}`, jobName, lineOf(job.key), parser);
      addEdge(file, fileId, jobId, 'contains', lineOf(job.key), parser);
      const steps = job.value.get('steps', true);
      if (!YAML.isSeq(steps)) throw new Error('COMPLEMENT_WORKFLOW_STEPS_REQUIRED');
      steps.items.forEach((step, index) => {
        const name = step.get('name') ?? step.get('uses') ?? `run step ${index + 1}`;
        const stepId = addNode(file, `job:${jobName}:step:${index}`, String(name), lineOf(step), parser);
        addEdge(file, jobId, stepId, 'contains', lineOf(step), parser);
        const uses = step.get('uses', true);
        if (YAML.isScalar(uses)) {
          const actionId = addNode(file, `action:${uses.value}`, String(uses.value), lineOf(uses), parser, { node_kind: 'workflow_action' });
          addEdge(file, stepId, actionId, 'uses', lineOf(uses), parser);
        }
        const run = step.get('run', true);
        if (YAML.isScalar(run)) {
          // These explicit script operands are references, not a shell evaluator.
          // Quoted interpolation and runtime expansions are left unresolved.
          for (const match of String(run.value).matchAll(/(?:^|[\s])(?:npx\s+)?tsx\s+(scripts\/[A-Za-z0-9_.\/-]+\.ts)(?=\s|$)/g)) {
            const target = resolveFile(match[1], file), id = target && targetFileNode(target);
            if (id) addEdge(file, stepId, id, 'references_file', lineOf(run), parser);
          }
        }
      });
    }
  }
  const own = [...nodes.values()];
  const ids = new Set([...graphNodes.map(n => n.id), ...nodes.keys()]);
  const dangling = [...edges.values()].filter(e => !ids.has(e.source) || !ids.has(e.target));
  if (dangling.length) throw new Error('COMPLEMENT_DANGLING_EDGE');
  // `graphify build --fragment` validates a fragment on its own, so each existing node an edge
  // reaches rides along verbatim; the merge folds that identical copy into the node unchanged.
  const anchorIds = new Set([...edges.values()].flatMap(e => [e.source, e.target]).filter(id => !nodes.has(id)));
  const anchors = graphNodes.filter(n => anchorIds.has(n.id));
  if (anchors.length !== anchorIds.size) throw new Error('COMPLEMENT_ANCHOR_MISSING');
  const extraction = { nodes: [...own, ...anchors], edges: [...edges.values()], hyperedges: [], input_tokens: 0, output_tokens: 0 };
  const sourceChanges = [...source].filter(([file, bytes]) => !boundedRead(root, file).equals(bytes)).map(([file]) => file);
  if (sourceChanges.length) throw new Error('COMPLEMENT_SOURCE_CHANGED_DURING_PARSE');
  return { extraction, receipt: { schema: 'atolye-graphify-structural-complement/v1', tool_sha256: sha256(fs.readFileSync(fileURLToPath(import.meta.url))), helper_sha256: sha256(fs.readFileSync(path.join(HERE, 'graphify-powershell-ast.ps1'))), graph_built_from_commit: graph.graph?.built_from_commit ?? graph.graph?.provenance?.source_hash ?? null, scope: 'PowerShell, CI workflow and colliding-route gaps only; dynamic calls and runtime bindings are not resolved.', files: reports, covered_files: [...new Set(own.map(n => n.source_file))].sort(), nodes: own.length, anchor_nodes: anchors.length, edges: extraction.edges.length, dangling: dangling.length, complete: reports.length === files.length && reports.every(r => !r.errors.length) } };
}

const COMPLEMENT_ID_PREFIX = 'atolye_structural:';

/**
 * Replaces the previous complement in a node-link graph.json with this one: its nodes are added
 * by id (never label-merged) and every link that touched an earlier complement node is dropped.
 * Fails closed on a taken id, a dangling link or a duplicate link; writes atomically.
 */
export function applyStructuralComplement(graphPath, graphBytes, extraction) {
  const graph = JSON.parse(graphBytes);
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.links)) throw new Error('COMPLEMENT_GRAPH_SHAPE_UNSUPPORTED');
  const previous = new Set(graph.nodes.filter(n => String(n.id).startsWith(COMPLEMENT_ID_PREFIX)).map(n => n.id));
  const nodes = graph.nodes.filter(n => !previous.has(n.id));
  const ids = new Set(nodes.map(n => n.id));
  for (const node of extraction.nodes.filter(n => n.id.startsWith(COMPLEMENT_ID_PREFIX))) {
    if (ids.has(node.id)) throw new Error('COMPLEMENT_NODE_ID_TAKEN');
    nodes.push(node); ids.add(node.id);
  }
  const links = graph.links.filter(l => !previous.has(l.source) && !previous.has(l.target));
  const key = l => `${l.source}\0${l.target}\0${l.relation}`;
  const seen = new Set(links.map(key));
  for (const edge of extraction.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) throw new Error('COMPLEMENT_DANGLING_EDGE');
    if (seen.has(key(edge))) throw new Error('COMPLEMENT_DUPLICATE_EDGE');
    seen.add(key(edge));
    links.push({ ...edge, _src: edge.source, _tgt: edge.target, confidence_score: 1 });
  }
  const temporary = `${graphPath}.complement-${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ ...graph, nodes, links }, null, 2), { flag: 'wx' });
  fs.renameSync(temporary, graphPath);
  return { replacedNodes: previous.size, nodes: nodes.length, links: links.length };
}

function main() {
  const args = process.argv.slice(2), options = {};
  const apply = args.includes('--apply');
  if (apply) args.splice(args.indexOf('--apply'), 1);
  for (let i = 0; i < args.length; i += 2) {
    if (!['--root', '--graph', '--out', '--receipt', '--graphify-module-root'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('COMPLEMENT_BAD_ARGUMENTS');
    if (Object.hasOwn(options, args[i])) throw new Error('COMPLEMENT_DUPLICATE_ARGUMENT');
    options[args[i]] = args[i + 1];
  }
  if (!options['--out'] || !options['--receipt']) throw new Error('COMPLEMENT_OUT_AND_RECEIPT_REQUIRED');
  const root = path.resolve(options['--root'] ?? '.'), graphPath = path.resolve(root, options['--graph'] ?? '.graphify/graph.json');
  const out = path.resolve(options['--out']), receiptPath = path.resolve(options['--receipt']);
  if (out === receiptPath || out === graphPath || receiptPath === graphPath) throw new Error('COMPLEMENT_OUTPUT_COLLISION');
  const complementFiles = discoverComplementFiles(root);
  for (const target of [out, receiptPath]) {
    const rel = relative(root, target);
    if (complementFiles.includes(rel) || target === fileURLToPath(import.meta.url) || target === path.join(HERE, 'graphify-powershell-ast.ps1')) throw new Error('COMPLEMENT_SOURCE_OVERWRITE_REFUSED');
  }
  const graphBytes = fs.readFileSync(graphPath), graph = JSON.parse(graphBytes);
  const result = extractStructuralComplement({ root, graph, graphifyModuleRoot: options['--graphify-module-root'], files: complementFiles });
  result.receipt.base_graph_sha256 = sha256(graphBytes);
  result.receipt.extraction_sha256 = sha256(JSON.stringify(result.extraction, null, 2) + '\n');
  fs.writeFileSync(out, JSON.stringify(result.extraction, null, 2) + '\n');
  console.log(`Structural complement: ${result.receipt.covered_files.length}/${complementFiles.length} files, ${result.receipt.nodes} nodes, ${result.receipt.edges} edges, ${result.receipt.complete ? 'PASS' : 'PARTIAL'}`);
  if (!result.receipt.complete) {
    fs.writeFileSync(receiptPath, JSON.stringify(result.receipt, null, 2) + '\n');
    process.exitCode = 1;
    return; // An incomplete complement is never applied.
  }
  if (apply) {
    if (!fs.readFileSync(graphPath).equals(graphBytes)) throw new Error('COMPLEMENT_GRAPH_CHANGED_DURING_PARSE');
    result.receipt.applied = applyStructuralComplement(graphPath, graphBytes, result.extraction);
    result.receipt.applied_graph_sha256 = sha256(fs.readFileSync(graphPath));
    console.log(`Applied to ${relative(root, graphPath)}: replaced ${result.receipt.applied.replacedNodes} earlier complement nodes; ${result.receipt.applied.nodes} nodes, ${result.receipt.applied.links} links.`);
  }
  fs.writeFileSync(receiptPath, JSON.stringify(result.receipt, null, 2) + '\n');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
