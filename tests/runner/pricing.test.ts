import assert from 'node:assert/strict';
import test from 'node:test';
import registry from '../../evaluation/config/models.json' with { type: 'json' };
import prices from '../../evaluation/config/prices.json' with { type: 'json' };
import { judgeRoute, priceUsage, summarizeCosts } from '../../src/runner/pricing.ts';

test('every benchmark model has a US East Bedrock rate', () => {
  for (const model of Object.values(registry.models)) {
    const route = 'bedrock:' + model.invocation_id;
    assert.ok(route in prices.routes, route);
  }
  assert.ok('bedrock:us.openai.gpt-6.1-sol' in prices.routes);
  assert.ok('openai:gpt-6.1-sol' in prices.routes);
});

test('US cross-Region rates price short context, cache, and long aggregates', () => {
  assert.equal(
    judgeRoute('bedrock:converse:us.openai.gpt-6.1-sol'),
    'bedrock:us.openai.gpt-6.1-sol',
  );
  assert.equal(judgeRoute('openai:responses:gpt-6.1-sol'), 'openai:gpt-6.1-sol');

  const luna = priceUsage(
    { prompt: 1_000_000, completion: 2_000_000, numRequests: 1 },
    'bedrock:us.openai.gpt-6-luna',
  );
  assert.equal(luna.context, 'long_aggregate');
  assert.equal(luna.usd, 1.87);

  const cached = priceUsage(
    {
      prompt: 1000,
      completion: 50,
      completionDetails: { cacheReadInputTokens: 200, cacheCreationInputTokens: 100 },
    },
    'bedrock:us.openai.gpt-6-luna',
  );
  assert.equal(cached.context, 'short');
  assert.equal(cached.usd, 0.00012);

  const judge = priceUsage(
    { prompt: 1000, completion: 100 },
    'bedrock:us.openai.gpt-6.1-sol',
  );
  assert.equal(judge.usd, 0.0033);
  assert.equal(priceUsage({ prompt: 10, completion: 1 }, 'bedrock:missing').usd, null);
  assert.equal(
    priceUsage(
      { prompt: 1_000_000, completion: 0 },
      'bedrock:us.amazon.nova-micro-v1:0',
    ).usd,
    0.035,
  );
  assert.equal(
    priceUsage(
      { prompt: 100_001, completion: 0 },
      'bedrock:us.anthropic.claude-haiku-5-5',
    ).context,
    'long_aggregate',
  );
  assert.equal(
    priceUsage(
      { prompt: 100_001, completion: 0 },
      'bedrock:us.anthropic.claude-haiku-5-5',
    ).usd,
    0.055001,
  );
});

test('a run summary reports price per turn and a repeat forecast', () => {
  const summary = summarizeCosts(
    [
      {
        success: true,
        latencyMs: 1000,
        provider: { id: 'us.openai.gpt-6-luna' },
        vars: {
          id: 'SON-A-001-T01',
          expected_category: 'robustness',
          session_id: 'SON-A-001',
        },
        metadata: { conversationId: 'SON-A-001' },
        tokenUsage: {
          prompt: 1000,
          completion: 100,
          numRequests: 1,
          assertions: { prompt: 1000, completion: 100, numRequests: 3 },
        },
      },
      {
        success: false,
        latencyMs: 3000,
        provider: { id: 'us.openai.gpt-6-luna' },
        vars: {
          id: 'SON-A-001-T02',
          expected_category: 'robustness',
          session_id: 'SON-A-001',
        },
        metadata: { conversationId: 'SON-A-001' },
        tokenUsage: {
          prompt: 1000,
          completion: 100,
          numRequests: 1,
          assertions: { prompt: 1000, completion: 100, numRequests: 3 },
        },
      },
    ],
    'bedrock:converse:us.openai.gpt-6.1-sol',
  );
  assert.equal(summary.billing_record, false);
  assert.equal(summary.price_usd.assistant, 0.00033);
  assert.equal(summary.price_usd.judge, 0.0066);
  assert.equal(summary.price_usd.total, 0.00693);
  assert.equal(summary.price_usd.per_turn_mean, 0.003465);
  assert.equal(summary.forecast.repeat_usd, 0.00693);
  assert.equal(summary.unpriced_turns, 0);
  assert.equal(summary.by_category[0]?.passed, 1);
  assert.equal(summary.latency_ms?.p50, 1000);
  assert.match(summary.notes, /Not an invoice|not an invoice/);
});
