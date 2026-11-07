import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parseOptions } from '../../src/runner/cli.ts';
import { prepareConfig } from '../../src/runner/config.ts';
import { executeRun } from '../../src/runner/execute.ts';
import { createMetadata } from '../../src/runner/metadata.ts';

const options = (...args: string[]) => parseOptions(args, {});
const temporaryDirectory = () => mkdtempSync(join(tmpdir(), 'benchmark-runner-'));

test('smoke run preserves fixture providers and output files without invoking Promptfoo', () => {
  const directory = temporaryDirectory();
  try {
    const parsed = options(
      '--smoke',
      '--prepare-only',
      '--output',
      join(directory, 'run'),
    );
    const prepared = prepareConfig(parsed);
    assert.equal(prepared.tests.length, 3);
    const smokeProviders = prepared.config.providers as unknown as Array<{
      label?: string;
      config?: { mode?: string };
    }>;
    assert.equal(smokeProviders[0]?.label, 'offline-fixture');
    assert.equal(smokeProviders[0]?.config?.mode, 'smoke');
    assert.equal(prepared.judge.id, 'file://' + join(process.cwd(), 'src/smoke.ts'));
    const defaultTest = prepared.config.defaultTest;
    assert.ok(defaultTest && typeof defaultTest !== 'string');
    assert.equal(defaultTest.assert?.length, 3);
    const metadata = createMetadata(parsed, prepared);
    assert.equal(executeRun(parsed, prepared, metadata), 0);
    const output = join(directory, 'run');
    const config = readFileSync(join(output, 'config.yaml'), 'utf8');
    assert.match(config, /offline-fixture/);
    assert.match(config, /expected_category: clarification/);
    assert.equal(
      JSON.parse(readFileSync(join(output, 'metadata.json'), 'utf8')).evidence,
      'unexecuted',
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('live config preserves model routes, capability gate, judge, and request ceiling', () => {
  const live = options(
    '--live',
    '--prepare-only',
    '--models',
    'nova-micro',
    'nova-lite',
    '--category',
    'tool_call',
  );
  const prepared = prepareConfig(live);
  assert.equal(prepared.tests.length, 3);
  const liveProviders = prepared.config.providers as unknown as Array<{
    label?: string;
    config?: { model?: string };
  }>;
  assert.deepEqual(
    liveProviders.map((provider) => provider.label),
    ['nova-micro', 'nova-lite'],
  );
  assert.deepEqual(
    liveProviders.map((provider) => provider.config?.model),
    ['us.amazon.nova-micro-v1:0', 'us.amazon.nova-lite-v1:0'],
  );
  assert.equal(prepared.judge.id, 'bedrock:converse:us.openai.gpt-6.1-sol');
  assert.equal(prepared.plannedRequests, 60);

  assert.throws(
    () => prepareConfig(options('--live', '--prepare-only', '--models', 'qwen3-32b')),
    /unverified/,
  );
  assert.throws(
    () =>
      prepareConfig(options('--live', '--prepare-only', '--models', 'unknown-model')),
    /Unknown model/,
  );
  assert.throws(
    () =>
      prepareConfig(
        options(
          '--live',
          '--prepare-only',
          '--models',
          'nova-micro',
          '--max-requests',
          '1',
        ),
      ),
    /exceeds --max-requests/,
  );
});

test('run refuses to overwrite existing output directories', () => {
  const directory = temporaryDirectory();
  try {
    const output = join(directory, 'run');
    const parsed = options('--smoke', '--prepare-only', '--output', output);
    const prepared = prepareConfig(parsed);
    executeRun(parsed, prepared, createMetadata(parsed, prepared));
    assert.throws(
      () => executeRun(parsed, prepared, createMetadata(parsed, prepared)),
      /EEXIST/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
