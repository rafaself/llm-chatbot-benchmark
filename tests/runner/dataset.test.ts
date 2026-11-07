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
  assert.equal(cases.length, 47);
  assert.equal(new Set(cases.map((c) => c.vars.id)).size, cases.length);
  for (const c of cases) {
    for (const id of c.vars.relevant_sections) assert.ok(policySectionIds.has(id));
  }
  assert.equal(loadDataset(smokeDatasetPath).length, 3);
});

test('the deterministic policy index is non-empty and uses stable section IDs', () => {
  assert.ok(policySectionIds.has('7.5'));
  assert.ok(policySectionIds.has('16.6'));
  assert.ok(
    searchPolicy('free economy shipping 599 threshold').some((d) => d.id === '7.5'),
  );
  assert.deepEqual(searchPolicy(''), []);
});
