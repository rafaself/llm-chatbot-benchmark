import assert from 'node:assert/strict';
import test from 'node:test';
import {
  loadDataset,
  developmentDatasetPath,
  smokeDatasetPath,
} from '../../src/dataset.ts';
import { policySectionIds, searchPolicy } from '../../src/retrieval.ts';

test('golden dataset is valid and includes traceable policy references', () => {
  const cases = loadDataset(developmentDatasetPath);
  assert.equal(cases.length, 55);
  assert.equal(new Set(cases.map((c) => c.vars.id)).size, cases.length);
  for (const c of cases) {
    assert.ok(c.metadata.category);
    assert.ok(Array.isArray(c.metadata.capabilities));
    assert.ok(c.metadata.capabilities.length > 0);
    for (const id of c.vars.relevant_sections) assert.ok(policySectionIds.has(id));
  }
  assert.equal(loadDataset(smokeDatasetPath).length, 3);
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
