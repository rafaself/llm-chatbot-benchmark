import assert from 'node:assert/strict';
import test from 'node:test';
import {
  loadDataset,
  contextSessionPath,
  developmentDatasetPath,
  heldoutDatasetPath,
  smokeDatasetPath,
} from '../../src/dataset.ts';
import { policySectionIds, searchPolicy } from '../../src/retrieval.ts';

function sessionIds(cases: ReturnType<typeof loadDataset>) {
  return new Set(cases.map((testCase) => testCase.metadata.conversationId));
}

test('golden dataset is valid and includes traceable policy references', () => {
  const cases = loadDataset(developmentDatasetPath);
  assert.equal(sessionIds(cases).size, 55);
  assert.equal(cases.length, 58);
  assert.equal(new Set(cases.map((c) => c.vars.id)).size, cases.length);
  for (const c of cases) {
    assert.equal(c.metadata.conversationId, c.vars.session_id);
    assert.equal(c.metadata.turnIndex, c.vars.turn_index);
    assert.ok(c.metadata.category);
    assert.ok(Array.isArray(c.metadata.capabilities));
    assert.ok(c.metadata.capabilities.length > 0);
    for (const id of c.vars.relevant_sections) assert.ok(policySectionIds.has(id));
  }
  const heldout = loadDataset(heldoutDatasetPath);
  assert.equal(sessionIds(heldout).size, 9);
  assert.equal(heldout.length, 10);
  const smoke = loadDataset(smokeDatasetPath);
  assert.equal(sessionIds(smoke).size, 4);
  assert.equal(smoke.length, 6);
});

test('multi-turn sessions expand to ordered Promptfoo turns without scripted replies', () => {
  const turns = loadDataset(developmentDatasetPath).filter(
    (testCase) => testCase.metadata.conversationId === 'SON-MUL-003',
  );
  assert.deepEqual(
    turns.map((turn) => turn.vars.input),
    ['My order ID is SON-1042.', "What's its current status?"],
  );
  assert.equal(turns[1]?.vars.expected_tools[0]?.name, 'lookup_order');
  assert.equal(turns[0]?.metadata.turnCount, 2);
  const context = loadDataset(contextSessionPath);
  assert.equal(context.length, 3);
  assert.ok(context.every((turn) => turn.metadata.conversationId === 'SON-CTX-001'));
  const smokeContext = loadDataset(smokeDatasetPath).filter(
    (turn) => turn.metadata.conversationId === 'SON-CTX-001',
  );
  assert.deepEqual(
    smokeContext.map((turn) => turn.vars.input),
    context.map((turn) => turn.vars.input),
  );
});

test('category filters select primary objectives, not capabilities or tags', () => {
  const selected = loadDataset(developmentDatasetPath, ['cross_source_accuracy']);
  assert.ok(selected.length > 0);
  assert.ok(selected.every((c) => c.metadata.category === 'cross_source_accuracy'));
});

test('the deterministic policy index is non-empty and uses stable section IDs', () => {
  assert.ok(policySectionIds.has('7.5'));
  assert.ok(policySectionIds.has('16.6'));
  assert.ok(
    searchPolicy('free economy shipping 599 threshold').some((d) => d.id === '7.5'),
  );
  assert.deepEqual(searchPolicy(''), []);
});
