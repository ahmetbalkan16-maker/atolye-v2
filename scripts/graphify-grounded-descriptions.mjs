// Local, bounded source evidence -> official Graphify assistant answer ingestion.
// No provider, embedding, model download, source execution or graph mutation here.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const flat = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const short = (value, max = 180) => flat(value).slice(0, max);
const unique = values => [...new Set(values)];
const HERE = path.dirname(fileURLToPath(import.meta.url));

export function readSource(root, file) {
  if (!file || path.isAbsolute(file) || file.replace(/\\/g, '/').split('/').includes('..') || /^(?:\.env|.*\/\.env)(?:\.|$)/.test(file)) throw new Error('DESCRIPTION_SOURCE_OUTSIDE_SCOPE');
  const resolved = fs.realpathSync.native(path.join(root, file));
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('DESCRIPTION_SOURCE_OUTSIDE_SCOPE');
  const stat = fs.statSync(resolved);
  if (!stat.isFile() || stat.size > 2_000_000) throw new Error('DESCRIPTION_SOURCE_SIZE_OR_KIND');
  return fs.readFileSync(resolved, 'utf8');
}

/** Extract declaration identity and actual AST facts; never infer purpose from a name. */
export function indexTypeScript(ts, file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const records = [], imports = [], bindings = [], top = [];
  const nameOf = n => n.name?.getText(source)?.replace(/^['"]|['"]$/g, '');
  const classOwner = n => {
    let parent = n.parent;
    while (parent && !ts.isSourceFile(parent)) {
      if (ts.isClassDeclaration(parent) || ts.isClassExpression(parent) || ts.isInterfaceDeclaration(parent)) return nameOf(parent);
      parent = parent.parent;
    }
    return '';
  };
  const visit = n => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier) imports.push(n.moduleSpecifier.text);
    if (ts.isImportDeclaration(n) && n.importClause) {
      const named = n.importClause.namedBindings;
      const names = [n.importClause.name?.text, ...(named && ts.isNamedImports(named) ? named.elements.map(e => e.name.text) : named && ts.isNamespaceImport(named) ? [named.name.text] : [])].filter(Boolean);
      for (const name of names) bindings.push({ name, module: n.moduleSpecifier.text, line: source.getLineAndCharacterOfPosition(n.getStart(source)).line + 1 });
    }
    let kind, name = nameOf(n), callable = false;
    if (ts.isFunctionDeclaration(n)) { kind = 'function'; callable = true; }
    else if (ts.isMethodDeclaration(n) || ts.isMethodSignature(n)) { kind = 'method'; callable = true; }
    else if (ts.isConstructorDeclaration(n)) { kind = 'constructor'; name = 'constructor'; callable = true; }
    else if (ts.isGetAccessorDeclaration(n)) { kind = 'getter'; callable = true; }
    else if (ts.isSetAccessorDeclaration(n)) { kind = 'setter'; callable = true; }
    else if (ts.isClassDeclaration(n) || ts.isClassExpression(n)) kind = 'class';
    else if (ts.isInterfaceDeclaration(n)) kind = 'interface';
    else if (ts.isTypeAliasDeclaration(n)) kind = 'type alias';
    else if (ts.isEnumDeclaration(n)) kind = 'enum';
    else if (ts.isVariableDeclaration(n)) {
      kind = n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer)) ? 'function variable' : 'variable';
      callable = kind === 'function variable';
    }
    if (kind && name) {
      const bodyNode = kind === 'function variable' ? n.initializer : n;
      const calls = [], returns = [];
      const scan = child => {
        if (child !== bodyNode && (ts.isFunctionDeclaration(child) || ts.isFunctionExpression(child) || ts.isArrowFunction(child) || ts.isMethodDeclaration(child))) return;
        if (ts.isCallExpression(child) && /^(?:[A-Za-z_$][\w$]*\.)*[A-Za-z_$][\w$]*$/.test(child.expression.getText(source))) calls.push(child.expression.getText(source));
        if (ts.isReturnStatement(child)) returns.push(child.expression ? short(child.expression.getText(source), 110) : 'void');
        ts.forEachChild(child, scan);
      };
      if (callable) scan(bodyNode);
      const owner = classOwner(n);
      const line = source.getLineAndCharacterOfPosition(n.getStart(source)).line + 1;
      const docs = n.jsDoc?.map(d => typeof d.comment === 'string' ? d.comment : '').filter(Boolean).join(' ');
      const fields = n.members?.map(m => nameOf(m)).filter(Boolean) ?? [];
      const parameters = bodyNode.parameters?.map(p => short(p.getText(source), 65)) ?? [];
      const signature = `${owner ? `${owner}.` : ''}${name}${callable ? `(${parameters.join(', ')})` : ''}${bodyNode.type ? `: ${short(bodyNode.type.getText(source), 110)}` : ''}`;
      const details = [];
      if (docs) details.push(`its source comment says ${JSON.stringify(short(docs, 210))}`);
      if (fields.length) details.push(`declares ${fields.length} members including ${fields.slice(0, 5).join(', ')}`);
      if (ts.isTypeAliasDeclaration(n)) details.push(`aliases ${short(n.type.getText(source), 160)}`);
      if (unique(calls).length) details.push(`calls ${unique(calls).slice(0, 4).join(', ')}`);
      if (returns.length && !docs) details.push(`has ${returns.length} explicit return${returns.length === 1 ? '' : 's'}${returns.length === 1 ? ` (${returns[0]})` : ''}`);
      const declaration = { name, owner, kind, line, signature, details, calls: unique(calls), returns, start: n.getStart(source), end: n.getEnd() };
      records.push(declaration);
      if (n.parent === source || (ts.isVariableDeclaration(n) && n.parent?.parent?.parent === source)) top.push(name);
    }
    ts.forEachChild(n, visit);
  };
  visit(source);
  return { records, imports: unique(imports), bindings, top: unique(top), sha256: hash(text), lines: text.split(/\r?\n/) };
}

export function describeDeclaration(file, record) {
  return `${record.signature} is a ${record.kind} declared at ${file}:L${record.line}${record.details.length ? `; ${record.details.slice(0, 2).join('; ')}` : ''}.`;
}

export function graphInvariant(graph) {
  const nodes = graph.nodes.map(node => Object.fromEntries(Object.entries(node).filter(([key]) => !['description', 'community', 'community_name'].includes(key))));
  const links = graph.links ?? graph.edges ?? [];
  return { nodes: nodes.length, edges: links.length, nodesSha256: hash(JSON.stringify(nodes)), edgesSha256: hash(JSON.stringify(links)), hyperedgesSha256: hash(JSON.stringify(graph.hyperedges ?? [])), builtFrom: graph.graph?.built_from_commit, complements: nodes.filter(n => n.id.startsWith('atolye_structural:')).length };
}

export function buildGroundedDescriptions({ root, graph, ts, gitCommits = new Map(), gitBranches = new Map(), powershell = [], yaml = null }) {
  /** @type {Record<string, string>} */
  const descriptions = {};
  const evidence = [], unresolved = [], indexes = new Map(), sources = new Map();
  const ps = new Map(powershell.map(p => [p.file, p]));
  for (const file of unique(graph.nodes.map(n => n.source_file).filter(f => f && f !== 'git'))) {
    try {
      const text = readSource(root, file);
      sources.set(file, { text, lines: text.split(/\r?\n/), sha256: hash(text) });
      if (/\.[cm]?[jt]sx?$/.test(file)) indexes.set(file, indexTypeScript(ts, file, text));
    } catch (error) { sources.set(file, { error: error.message }); }
  }
  const allRecords = [...indexes].flatMap(([file, index]) => index.records.map(record => ({ file, record })));
  for (const node of graph.nodes) {
    let file = node.source_file, description, mode, record;
    let source = sources.get(file);
    const labelName = node.label?.replace(/\(\)$/, '').replace(/^\./, '') ?? '';
    const expectedLine = Number(node.source_location?.match(/^L(\d+)/)?.[1] ?? 0);
    if (node.source_sha256 && source?.sha256 !== node.source_sha256) {
      unresolved.push({ id: node.id, source_file: file, label: node.label, reason: 'COMPLEMENT_SOURCE_HASH_MISMATCH' });
      continue;
    }
    if (file === 'git' && node.node_type === 'Commit' && gitCommits.has(node.sha)) {
      const subject = gitCommits.get(node.sha);
      description = `Git commit ${node.sha.slice(0, 12)} records ${JSON.stringify(subject)}.`;
      mode = 'git-verified-commit';
    } else if (file === 'git' && node.node_type === 'Branch') {
      const ref = gitBranches.get(node.branch_name);
      description = ref ? `Local Git branch ${node.branch_name} points to commit ${ref.slice(0, 12)}.` : `Historical graph branch ${node.branch_name} has no matching current local Git branch.`;
      mode = ref ? 'git-verified-branch' : 'git-absent-branch';
    } else if (indexes.has(file)) {
      const index = indexes.get(file);
      if (node.label === path.posix.basename(file)) {
        description = `${file} is a source module${index.top.length ? ` declaring ${index.top.slice(0, 6).join(', ')}` : ''}${index.imports.length ? ` and importing or re-exporting ${index.imports.slice(0, 4).join(', ')}` : ''}.`;
        mode = 'typescript-module';
      } else {
        const candidates = index.records.filter(r => labelName === r.name || labelName === `${r.owner}.${r.name}`);
        candidates.sort((a, b) => Math.abs(a.line - expectedLine) - Math.abs(b.line - expectedLine));
        record = candidates[0];
        if (record) { description = describeDeclaration(file, record); mode = 'typescript-declaration'; }
        else if (!source.text.includes(labelName.split('.').pop()) && labelName) {
          description = `Retained graph symbol ${node.label} has no matching declaration or name occurrence in the current ${file} source.`;
          mode = 'retained-symbol-absent';
        }
      }
    } else if (file?.endsWith('.ps1') && ps.has(file) && source?.sha256 === node.source_sha256) {
      const parsed = ps.get(file);
      if (node.label === path.posix.basename(file)) {
        description = `${file} is a PowerShell script declaring ${parsed.functions.length} functions and containing static command calls including ${unique(parsed.commands.map(c => c.name).filter(Boolean)).slice(0, 6).join(', ')}.`;
        mode = 'powershell-module';
      } else if (node.node_kind === 'static_command_name') {
        const commands = parsed.commands.filter(c => c.name?.toLowerCase() === labelName.toLowerCase());
        if (commands.length) { description = `${labelName} is a static command name invoked ${commands.length} time${commands.length === 1 ? '' : 's'} in ${file}, first at L${commands[0].line}; runtime command binding is not asserted.`; mode = 'powershell-command'; }
      } else {
        const fn = parsed.functions.find(f => f.name === labelName);
        const calls = fn && unique(parsed.commands.filter(c => c.ownerOffset === fn.offset).map(c => c.name).filter(Boolean));
        if (fn) { description = `${labelName} is a PowerShell function declared at ${file}:L${fn.line}${calls.length ? ` that contains calls to ${calls.slice(0, 5).join(', ')}` : ''}.`; mode = 'powershell-function'; }
      }
    } else if (file?.endsWith('.yml') && source?.sha256 === node.source_sha256 && yaml) {
      const workflow = yaml.parse(source.text);
      const suffix = node.id.slice(`atolye_structural:${file}:`.length);
      if (suffix === 'file') { description = `${file} defines GitHub Actions workflow ${JSON.stringify(workflow.name)} with jobs ${Object.keys(workflow.jobs ?? {}).join(', ')}.`; mode = 'yaml-workflow'; }
      else if (suffix.startsWith('action:') && source.text.includes(labelName)) { description = `${labelName} is an action reference used by the GitHub Actions workflow in ${file}.`; mode = 'yaml-action'; }
      else {
        const match = suffix.match(/^job:([^:]+)(?::step:(\d+))?$/);
        const job = match && workflow.jobs?.[match[1]];
        if (job && match[2] === undefined) { description = `Workflow job ${match[1]} in ${file} runs on ${JSON.stringify(job['runs-on'])} and declares ${job.steps?.length ?? 0} steps.`; mode = 'yaml-job'; }
        else if (job) {
          const step = job.steps?.[Number(match[2])];
          if (step) { description = `Workflow step ${Number(match[2]) + 1} in job ${match[1]} of ${file}${step.uses ? ` uses ${step.uses}` : ` runs ${JSON.stringify(short(step.run, 210))}`}.`; mode = 'yaml-step'; }
        }
      }
    } else if (file?.endsWith('.py') && source?.text) {
      if (node.label === path.posix.basename(file)) { description = `${file} defines Python functions ${[...source.text.matchAll(/^def ([\w]+)\(/gm)].map(m => m[1]).join(', ')}.`; mode = 'python-source-module'; }
      else if (node.file_type === 'rationale') {
        const quote = source.lines.slice(expectedLine - 1, expectedLine + 2).join(' ').match(/"""([\s\S]*?)"""/)?.[1];
        if (quote) { description = `Source docstring at ${file}:L${expectedLine} states ${JSON.stringify(flat(quote))}.`; mode = 'python-docstring'; }
      } else {
        const declarationLine = source.lines.findIndex(line => line.startsWith(`def ${labelName}(`));
        if (declarationLine >= 0) {
          const following = source.lines.slice(declarationLine + 1, declarationLine + 4).join(' ');
          const doc = following.match(/"""([\s\S]*?)"""/)?.[1];
          description = `${labelName} is declared by ${short(source.lines[declarationLine]).replace(/:$/, '')} at ${file}:L${declarationLine + 1}${doc ? `; its docstring states ${JSON.stringify(flat(doc))}` : ''}.`;
          mode = 'python-source-declaration';
        }
      }
    }
    // Missing source attribution: resolve a real declaration, without rewriting graph metadata.
    if (!description && !file) {
      const candidate = allRecords.find(item => item.record.name === labelName && node.id.includes(path.posix.basename(item.file, path.posix.extname(item.file)).toLowerCase().replace(/[^a-z0-9]/g, '_')))
        ?? allRecords.find(item => item.record.name === labelName);
      if (candidate) { file = candidate.file; record = candidate.record; source = sources.get(file); description = `Unattributed graph reference ${node.label} matches ${describeDeclaration(file, record).replace(/\.$/, '')}.`; mode = 'unattributed-source-match'; }
      else {
        const binding = [...indexes].flatMap(([sourceFile, index]) => index.bindings.map(item => ({ ...item, file: sourceFile }))).find(item => item.name === labelName);
        if (binding) { file = binding.file; source = sources.get(file); description = `Unattributed graph reference ${node.label} matches an import from ${binding.module} at ${file}:L${binding.line}.`; mode = 'unattributed-import-match'; }
      }
    }
    if (!description && source?.text) {
      // A real source name occurrence is evidence of a reference, not of a declaration or behavior.
      const needle = labelName.split('.').pop();
      const line = source.lines.findIndex(value => needle && value.includes(needle));
      if (line >= 0) { description = `${node.label} is referenced in ${file}:L${line + 1} by ${JSON.stringify(short(source.lines[line], 200))}; a matching declaration was not resolved.`; mode = 'source-reference-only'; }
    }
    if (description) {
      descriptions[node.id] = description;
      evidence.push({ id: node.id, mode, source_file: file, source_sha256: source?.sha256 ?? null, source_line: record?.line ?? expectedLine, ...(record ? { declaration_kind: record.kind, signature: record.signature, direct_calls: record.calls, explicit_return_count: record.returns.length } : {}), description_sha256: hash(description) });
    } else unresolved.push({ id: node.id, source_file: file, label: node.label, reason: source?.error ?? 'NO_VERIFIED_SOURCE_EVIDENCE' });
  }
  return { descriptions, evidence, unresolved };
}

function runCli(root, cli, args) {
  const result = spawnSync(process.execPath, ['--max-old-space-size=768', cli, ...args], { cwd: root, windowsHide: true, timeout: 120_000, maxBuffer: 4_000_000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`DESCRIPTION_OFFICIAL_CLI_FAILED_${result.status}: ${short(result.stderr, 300)}`);
  return `${result.stdout}\n${result.stderr}`;
}

export function main(args = process.argv.slice(2)) {
  const started = Date.now();
  const root = fs.realpathSync.native(path.resolve(HERE, '..'));
  const require = createRequire(path.join(root, 'package.json'));
  const ts = require('typescript');
  const install = path.join(process.env.APPDATA ?? '', 'npm/node_modules/@sentropic/graphify');
  const graphifyRequire = createRequire(path.join(install, 'package.json'));
  const yaml = graphifyRequire('yaml');
  const cli = path.join(install, 'dist/cli.js');
  const state = path.join(root, '.graphify');
  const runtime = JSON.parse(fs.readFileSync(path.join(state, '.graphify_runtime.json'), 'utf8'));
  if (runtime.runtime !== 'typescript') throw new Error('DESCRIPTION_TYPESCRIPT_RUNTIME_REQUIRED');
  const graphPath = path.join(state, 'graph.json');
  const graphText = fs.readFileSync(graphPath, 'utf8');
  const graph = JSON.parse(graphText);
  const before = graphInvariant(graph);
  const git = gitArgs => execFileSync('git', gitArgs, { cwd: root, windowsHide: true, maxBuffer: 12_000_000 }).toString('utf8');
  const gitCommits = new Map(git(['log', '--all', '--format=%H%x09%s']).trim().split('\n').map(line => { const tab = line.indexOf('\t'); return [line.slice(0, tab), line.slice(tab + 1).replace(/\r$/, '')]; }));
  const gitBranches = new Map(git(['for-each-ref', '--format=%(refname:short)%09%(objectname)', 'refs/heads/']).trim().split('\n').map(line => line.trim().split('\t')));
  const psFiles = unique(graph.nodes.map(n => n.source_file).filter(f => f?.endsWith('.ps1')));
  const powershell = psFiles.length ? JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(HERE, 'graphify-powershell-ast.ps1')], { cwd: root, windowsHide: true, input: JSON.stringify({ files: psFiles.map(file => ({ file, text: readSource(root, file) })) }), timeout: 30_000, maxBuffer: 12_000_000 }).toString('utf8').replace(/^\uFEFF/, '')) : [];
  const result = buildGroundedDescriptions({ root, graph, ts, gitCommits, gitBranches, powershell, yaml });
  const outputArg = args.indexOf('--out');
  const out = path.resolve(root, outputArg >= 0 ? args[outputArg + 1] : '.graphify/grounded-descriptions');
  const outRelative = path.relative(state, out);
  if (outRelative.startsWith('..') || path.isAbsolute(outRelative)) throw new Error('DESCRIPTION_OUTPUT_MUST_BE_IN_GRAPHIFY');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'evidence.json'), JSON.stringify(result.evidence, null, 2));
  fs.writeFileSync(path.join(out, 'unresolved.json'), JSON.stringify(result.unresolved, null, 2));
  fs.writeFileSync(path.join(out, 'answers.json'), JSON.stringify(result.descriptions, null, 2));
  const receipt = { version: 1, generated_at: new Date().toISOString(), source_head: git(['rev-parse', 'HEAD']).trim(), mode: 'local-source-grounded-assistant-answers', api_calls: 0, graph_before_sha256: hash(graphText), before, grounded: Object.keys(result.descriptions).length, unresolved: result.unresolved.length, evidence_modes: result.evidence.reduce((counts, item) => ({ ...counts, [item.mode]: (counts[item.mode] ?? 0) + 1 }), {}), applied: false };
  if (args.includes('--apply')) {
    if (result.unresolved.length) throw new Error(`DESCRIPTION_UNRESOLVED_${result.unresolved.length}: inspect ${path.join(out, 'unresolved.json')}`);
    if (hash(fs.readFileSync(graphPath, 'utf8')) !== hash(graphText)) throw new Error('DESCRIPTION_GRAPH_CHANGED_DURING_AUDIT');
    const checkedSources = new Set();
    for (const item of result.evidence) {
      if (item.source_sha256 && !checkedSources.has(item.source_file)) {
        if (hash(readSource(root, item.source_file)) !== item.source_sha256) throw new Error('DESCRIPTION_SOURCE_CHANGED_DURING_AUDIT');
        checkedSources.add(item.source_file);
      }
    }
    const instructionDir = path.join(state, 'description-instructions');
    if (fs.existsSync(instructionDir) && fs.readdirSync(instructionDir).length) {
      const archive = path.join(out, `instructions-before-${Date.now()}`);
      fs.renameSync(instructionDir, archive);
      receipt.archived_instruction_files = fs.readdirSync(archive).length;
      receipt.archive = path.relative(root, archive).replace(/\\/g, '/');
    }
    fs.writeFileSync(path.join(out, 'graph-before.json'), graphText);
    fs.writeFileSync(path.join(out, 'emit.log'), runCli(root, cli, ['describe', '.', '--description-mode', 'assistant', '--description-lang', 'en']));
    const prompts = fs.readdirSync(instructionDir).filter(name => /^batch-\d+\.md$/.test(name));
    let answered = 0;
    for (const prompt of prompts) {
      const text = fs.readFileSync(path.join(instructionDir, prompt), 'utf8');
      const ids = [...text.matchAll(/^- "([^"]+)":/gm)].map(match => match[1]);
      const answers = Object.fromEntries(ids.filter(id => result.descriptions[id]).map(id => [id, result.descriptions[id]]));
      answered += Object.keys(answers).length;
      fs.writeFileSync(path.join(instructionDir, prompt.replace(/\.md$/, '.json')), JSON.stringify(answers, null, 2));
    }
    receipt.official_batches_answered = prompts.length;
    receipt.official_nodes_answered = answered;
    // Preserve prompts and answers because official ingestion consumes them.
    fs.cpSync(instructionDir, path.join(out, 'answered-instructions'), { recursive: true });
    fs.writeFileSync(path.join(out, 'ingest.log'), runCli(root, cli, ['describe', '.', '--description-mode', 'assistant', '--description-lang', 'en']));
    const afterText = fs.readFileSync(graphPath, 'utf8');
    const afterGraph = JSON.parse(afterText);
    receipt.after = graphInvariant(afterGraph);
    receipt.graph_after_sha256 = hash(afterText);
    receipt.described_after = afterGraph.nodes.filter(n => typeof n.description === 'string' && n.description.trim()).length;
    receipt.applied = true;
    receipt.invariants_preserved = JSON.stringify(before) === JSON.stringify(receipt.after);
    if (!receipt.invariants_preserved || receipt.described_after !== before.nodes) {
      fs.writeFileSync(path.join(out, 'receipt.json'), JSON.stringify(receipt, null, 2));
      throw new Error('DESCRIPTION_POST_INGEST_INVARIANT_OR_COVERAGE_FAILURE');
    }
  }
  receipt.elapsed_ms = Date.now() - started;
  receipt.requested_parent_heap_limit_mb = Number(process.execArgv.find(value => value.startsWith('--max-old-space-size='))?.split('=')[1]) || null;
  receipt.official_cli_heap_limit_mb = 768;
  receipt.node_heap_used_mb = Math.ceil(process.memoryUsage().heapUsed / 1024 / 1024);
  fs.writeFileSync(path.join(out, 'receipt.json'), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ ...receipt, archive: receipt.archive, output: path.relative(root, out).replace(/\\/g, '/') }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
