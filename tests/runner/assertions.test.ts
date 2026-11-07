import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const assertions = require('../../src/assertions.cjs') as {
  toolSelection: (output: unknown, context: unknown) => { pass: boolean };
  evidenceRecall: (
    output: unknown,
    context: unknown,
  ) => { pass: boolean; score: number };
};

test('tool assertion checks names and exact required arguments', () => {
  const vars = {
    expected_tools: [{ name: 'lookup_order', arguments: { order_id: 'SON-1044' } }],
  };
  assert.equal(
    assertions.toolSelection(
      { tool_calls: [{ name: 'lookup_order', args: { order_id: 'SON-1044' } }] },
      { vars },
    ).pass,
    true,
  );
  assert.equal(
    assertions.toolSelection(
      { tool_calls: [{ name: 'lookup_order', args: { order_id: 'SON-1045' } }] },
      { vars },
    ).pass,
    false,
  );
  assert.equal(
    assertions.toolSelection(
      { tool_calls: [{ name: 'search_policy', args: { query: 'order' } }] },
      { vars },
    ).pass,
    false,
  );
  assert.equal(
    assertions.toolSelection(
      {
        tool_calls: [
          { name: 'lookup_order', args: { order_id: 'SON-1044' } },
          { name: 'search_policy', args: { query: 'pickup hold' } },
        ],
      },
      { vars },
    ).pass,
    true,
  );
  assert.equal(
    assertions.toolSelection(
      {
        tool_calls: [
          { name: 'lookup_order', args: { order_id: 'SON-1044' } },
          { name: 'lookup_product', args: { sku: 'KEY-1' } },
        ],
      },
      { vars },
    ).pass,
    false,
  );
});

test('tool assertion does not require a route when no operational lookup is specified', () => {
  assert.equal(
    assertions.toolSelection(
      { tool_calls: [{ name: 'search_policy', args: { query: 'returns' } }] },
      { vars: { expected_tools: [] } },
    ).pass,
    true,
  );
});

test('evidence recall requires all relevant sections', () => {
  const vars = { relevant_sections: ['6.5', '7.5'] };
  assert.equal(
    assertions.evidenceRecall({ retrieved_sections: ['6.5', '7.5'] }, { vars }).pass,
    true,
  );
  const partial = assertions.evidenceRecall({ retrieved_sections: ['6.5'] }, { vars });
  assert.equal(partial.pass, false);
  assert.equal(partial.score, 0.5);
});
