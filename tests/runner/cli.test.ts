import assert from 'node:assert/strict';
import test from 'node:test';
import { parseOptions } from '../../src/runner/cli.ts';

test('CLI preserves safe defaults and model selection options', () => {
  const options = parseOptions([], {});
  assert.equal(options.live, undefined);
  assert.equal(options.judgeProvider, 'bedrock');
  assert.equal(options.maxRequests, 500);
  assert.equal(options.timeoutMs, 60_000);
  assert.equal(options.region, 'us-east-1');
  assert.ok(options.dataset.endsWith('datasets/smoke.jsonl'));

  const live = parseOptions(
    [
      '--live',
      '--allow-paid',
      '--models',
      'nova-micro',
      'nova-lite',
      '--category',
      'tool_call',
      '--repeat',
      '2',
      '--max-turns',
      '4',
    ],
    { AWS_REGION: 'eu-west-1' },
  );
  assert.deepEqual(live.models, ['nova-micro', 'nova-lite']);
  assert.deepEqual(live.category, ['tool_call']);
  assert.equal(live.region, 'eu-west-1');
  assert.equal(live.repeat, 2);
  assert.equal(live.maxTurns, 4);
});

test('CLI rejects paid runs without opt-in and invalid option combinations', () => {
  assert.throws(() => parseOptions(['--live'], {}), /--allow-paid/);
  assert.throws(() => parseOptions(['--allow-paid'], {}), /requires --live/);
  assert.throws(() => parseOptions(['--models', 'nova-micro'], {}), /with --live/);
});
