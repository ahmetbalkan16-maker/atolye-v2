// Local Graphify reminder for Claude. No writes, network calls, or tool denial.
import fs from 'node:fs';
import path from 'node:path';

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  let event;
  try { event = JSON.parse(input || '{}'); } catch { return; }
  const cwd = typeof event.cwd === 'string' ? event.cwd : process.cwd();
  if (!fs.existsSync(path.join(cwd, '.graphify', 'graph.json'))) return;
  const mode = process.argv.at(-1);
  if (mode !== 'read' && mode !== 'search') return;
  const additionalContext = mode === 'search'
    ? 'Graphify is available for this project. Before broad code discovery, use graphify query "<question>" to locate the relevant code and relationships. Focused source searches and debugging remain available.'
    : 'Graphify is available for this project. Use graphify query "<question>" for code relationships and focused file reads to verify the actual source. The graph has declared partial coverage; check uncovered files directly.';
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext } }));
});
