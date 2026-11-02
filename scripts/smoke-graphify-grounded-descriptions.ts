import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import ts from 'typescript';
import { buildGroundedDescriptions, graphInvariant, indexTypeScript, readSource } from './graphify-grounded-descriptions.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'graphify-description-smoke-'));
try {
  const file = 'fixture.ts';
  const source = `import { EventEmitter } from 'node:events';
/** Reads the requested flag. */
export function flag(value: boolean): boolean { return value; }
class First { go(input: string) { direct(input); function inner() { nested(); } return input; } }
class Second { go() { other(); return true; } }
type Choice = 'yes' | 'no';
const [left, right] = ['a', 'b'];`;
  fs.writeFileSync(path.join(root, file), source);
  const index = indexTypeScript(ts, file, source);
  const method = index.records.find(r => r.owner === 'First' && r.name === 'go');
  assert.deepEqual(method.calls, ['direct'], "assert.deepEqual(method.calls, ['direct'])"); // nested function cannot become outer behavior
  assert.equal(method.returns.length, 1, "assert.equal(method.returns.length, 1)");
  assert.equal(index.bindings[0].module, 'node:events', "assert.equal(index.bindings[0].module, 'node:events')");
  const graph: { nodes: Array<{ id: string; label: string; source_file: string; source_location: string; description?: string; community?: number }>; links: Array<{ source: string; target: string; relation: string }> } = {
    nodes: [
      { id: 'fixture_flag', label: 'flag()', source_file: file, source_location: 'L3' },
      { id: 'fixture_first_go', label: '.go()', source_file: file, source_location: 'L4' },
      { id: 'fixture_second_go', label: '.go()', source_file: file, source_location: 'L5' },
      { id: 'fixture_choice', label: 'Choice', source_file: file, source_location: 'L6' },
      { id: 'fixture_removed', label: 'removed()', source_file: file, source_location: 'L7' },
      { id: 'fixture_eventemitter', label: 'EventEmitter', source_file: '', source_location: '' },
    ], links: [{ source: 'fixture_flag', target: 'fixture_first_go', relation: 'calls' }],
  };
  const result = buildGroundedDescriptions({ root, graph, ts });
  assert.equal(result.unresolved.length, 0, "assert.equal(result.unresolved.length, 0)");
  assert.match(result.descriptions.fixture_flag, /Reads the requested flag/);
  assert.match(result.descriptions.fixture_first_go, /First\.go.*calls direct/);
  assert.doesNotMatch(result.descriptions.fixture_first_go, /nested/);
  assert.match(result.descriptions.fixture_second_go, /Second\.go.*calls other/);
  assert.match(result.descriptions.fixture_choice, /aliases 'yes' \| 'no'/);
  assert.match(result.descriptions.fixture_removed, /no matching declaration or name occurrence/);
  assert.match(result.descriptions.fixture_eventemitter, /import from node:events/);
  assert(result.evidence.every(e => e.source_sha256?.length === 64));
  assert.throws(() => readSource(root, '../outside.ts'), /OUTSIDE_SCOPE/);
  assert.throws(() => readSource(root, '.env.local'), /OUTSIDE_SCOPE/);
  const stale = buildGroundedDescriptions({ root, ts, graph: { nodes: [{ ...graph.nodes[0], source_sha256: 'invalid' }], links: [] } });
  assert.equal(stale.unresolved[0].reason, 'COMPLEMENT_SOURCE_HASH_MISMATCH', "assert.equal(stale.unresolved[0].reason, 'COMPLEMENT_SOURCE_HASH_MISMATCH')");
  const invariant = graphInvariant(graph);
  graph.nodes[0].description = 'A description';
  graph.nodes[0].community = 8;
  assert.deepEqual(graphInvariant(graph), invariant, "assert.deepEqual(graphInvariant(graph), invariant)");
  graph.nodes[0].source_file = 'changed.ts';
  assert.notDeepEqual(graphInvariant(graph), invariant);
  console.log('PASS: 14 source grounding, method identity, nested-call exclusion, stale-symbol, import, SHA and boundary checks');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
