import { createHash } from 'node:crypto';
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Command, Option } from 'commander';
import { load, dump } from 'js-yaml';
import type { ProviderOptions, UnifiedConfig } from 'promptfoo';
import { z } from 'zod';
import registry from '../config/models.json' with { type: 'json' };
import pkg from '../package.json' with { type: 'json' };
import { loadDataset, sampleDataset } from './dataset.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const positive = (value: string) => z.coerce.number().int().positive().parse(value);
const nonnegative = (value: string) =>
  z.coerce.number().int().nonnegative().parse(value);
const program = new Command()
  .description(
    'Prepare and run Promptfoo. Offline by default; paid calls require opt-in.',
  )
  .addOption(new Option('--smoke', 'Offline SDK fixtures (default)').conflicts('live'))
  .addOption(
    new Option('--live', 'Selected Bedrock models and GPT-6.1 Sol judge').conflicts(
      'smoke',
    ),
  )
  .option('--allow-paid', 'Opt in to this paid invocation')
  .option('--prepare-only', 'Write resolved configuration without API calls')
  .option('--models <keys...>', 'Keys from config/models.json')
  .option('--category <names...>', 'Select scenario categories')
  .option('--dataset <path>', 'JSONL scenarios', sampleDataset)
  .option('--output <path>', 'New result directory')
  .option(
    '--region <region>',
    'AWS source region',
    process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1',
  )
  .addOption(
    new Option('--judge-provider <provider>', 'Native Promptfoo judge route')
      .choices(['bedrock', 'openai'])
      .default('bedrock'),
  )
  .option('--allow-unverified-tools', 'Allow an unverified model tool route')
  .option('--max-tokens <n>', 'Output token limit', positive, 1024)
  .option('--temperature <n>', 'Override supported model temperatures', (value) =>
    z.coerce.number().min(0).max(1).parse(value),
  )
  .option('--concurrency <n>', 'Concurrent Promptfoo evaluations', positive, 1)
  .option('--repeat <n>', 'Repetitions per case', positive, 1)
  .option('--retries <n>', 'SDK retries per request', nonnegative, 0)
  .option('--timeout-ms <n>', 'SDK timeout per target step', positive, 60000)
  .option('--max-turns <n>', 'Maximum AI SDK steps per answer', positive, 3)
  .option(
    '--max-requests <n>',
    'Conservative request ceiling including grading/retries',
    positive,
    200,
  )
  .option('--delay-ms <n>', 'Promptfoo delay between evaluations', nonnegative, 0);

function main() {
  program.parse();
  const options = program.opts<{
    live?: boolean;
    allowPaid?: boolean;
    prepareOnly?: boolean;
    models?: string[];
    category?: string[];
    dataset: string;
    output?: string;
    region: string;
    judgeProvider: 'bedrock' | 'openai';
    allowUnverifiedTools?: boolean;
    maxTokens: number;
    temperature?: number;
    concurrency: number;
    repeat: number;
    retries: number;
    timeoutMs: number;
    maxTurns: number;
    maxRequests: number;
    delayMs: number;
  }>();
  if (options.live && !options.prepareOnly && !options.allowPaid) {
    throw new Error('Live calls require --allow-paid; use --prepare-only to preview.');
  }
  if (options.allowPaid && !options.live)
    throw new Error('--allow-paid requires --live');
  if (!options.live && options.models) throw new Error('Select models with --live');
  const tests = loadDataset(resolve(options.dataset), options.category);
  const selected = options.models ?? ['nova-micro'];
  if (new Set(selected).size !== selected.length)
    throw new Error('Duplicate model selection');
  const planned =
    tests.length *
    (options.live ? selected.length : 1) *
    options.repeat *
    (options.maxTurns + 2) *
    (options.retries + 1);
  if (planned > options.maxRequests)
    throw new Error(
      `Request upper bound ${planned} exceeds --max-requests ${options.maxRequests}`,
    );
  const output = resolve(
    options.output ??
      join(root, 'results', new Date().toISOString().replaceAll(':', '-')),
  );
  const config = load(
    readFileSync(join(root, 'promptfooconfig.yaml'), 'utf8'),
  ) as UnifiedConfig;
  const adapter = `file://${join(root, 'src/chatbot.ts')}`;
  config.prompts = [`file://${join(root, 'prompts/chat.json')}`];
  config.tests = tests;
  config.providers = options.live
    ? selected.map((key): ProviderOptions => {
        if (!Object.hasOwn(registry.models, key))
          throw new Error(`Unknown model: ${key}`);
        const model = registry.models[key as keyof typeof registry.models];
        if (
          model.tool_support === 'unverified_on_converse' &&
          !options.allowUnverifiedTools
        ) {
          throw new Error(
            `${key}: tool support is unverified; use --allow-unverified-tools for a capability probe`,
          );
        }
        if (
          options.temperature !== undefined &&
          (key.startsWith('gpt-6') || key === 'haiku-5.5')
        ) {
          throw new Error(
            `${key}: omit --temperature; comparable sampling settings are unavailable`,
          );
        }
        return {
          id: adapter,
          label: key,
          config: {
            mode: 'live',
            model: model.invocation_id,
            region: options.region,
            ...model.parameters,
            ...(options.temperature === undefined
              ? {}
              : { temperature: options.temperature }),
            maxTokens: options.maxTokens,
            maxTurns: options.maxTurns,
            retries: options.retries,
            timeoutMs: options.timeoutMs,
          },
        };
      })
    : [
        {
          id: adapter,
          label: 'offline-fixture',
          config: { mode: 'smoke', maxTurns: options.maxTurns },
        },
      ];
  const judge: ProviderOptions = options.live
    ? structuredClone(registry.judge[options.judgeProvider])
    : { id: `file://${join(root, 'src/smoke.ts')}` };
  if (options.live) {
    config.description =
      'Live chatbot benchmark; two GPT-6.1 Sol rubric grades per answer';
    judge.config = {
      ...judge.config,
      ...(options.judgeProvider === 'bedrock'
        ? { region: options.region }
        : { maxRetries: options.retries }),
    };
  }
  if (!config.defaultTest || typeof config.defaultTest === 'string') {
    throw new Error('Expected inline defaultTest criteria in promptfooconfig.yaml');
  }
  config.defaultTest = {
    ...config.defaultTest,
    options: { ...config.defaultTest?.options, provider: judge },
  };
  config.evaluateOptions = {
    maxConcurrency: options.concurrency,
    repeat: options.repeat,
    delay: options.delayMs,
  };
  const hash = (data: string | Buffer) =>
    createHash('sha256').update(data).digest('hex');
  const sources = [
    'promptfooconfig.yaml',
    'config/models.json',
    'prompts/chat.json',
    'package.json',
    'package-lock.json',
    ...readdirSync(join(root, 'src'))
      .filter((file) => file.endsWith('.ts'))
      .map((file) => `src/${file}`),
  ];
  const git = (...args: string[]) =>
    spawnSync('git', args, { cwd: root, encoding: 'utf8' }).stdout?.trim();
  const metadata = {
    created_at: new Date().toISOString(),
    mode: options.live ? 'live' : 'smoke',
    evidence: options.prepareOnly
      ? 'unexecuted'
      : options.live
        ? 'live_attempt'
        : 'fixture',
    git_revision: git('rev-parse', 'HEAD') || null,
    git_dirty: Boolean(git('status', '--porcelain')),
    models: options.live ? selected : ['offline-fixture'],
    providers: config.providers,
    judge,
    case_count: tests.length,
    categories: [...new Set(tests.map((test) => test.vars.expected_category))].sort(),
    selected_cases_sha256: hash(JSON.stringify(tests)),
    parameters: options,
    planned_max_requests: planned,
    versions: { promptfoo: pkg.devDependencies.promptfoo, ...pkg.dependencies },
    source_hashes: {
      dataset: hash(readFileSync(resolve(options.dataset))),
      ...Object.fromEntries(
        sources.map((file) => [file, hash(readFileSync(join(root, file)))]),
      ),
    },
  };
  // Create the leaf exclusively so an existing run can never be overwritten.
  mkdirSync(resolve(output, '..'), { recursive: true });
  mkdirSync(output);
  const save = (name: string, value: unknown) =>
    writeFileSync(join(output, name), JSON.stringify(value, null, 2) + '\n');
  writeFileSync(join(output, 'config.yaml'), dump(config));
  save('metadata.json', metadata);
  console.log(
    `Prepared ${tests.length} cases; ${metadata.mode}; request upper bound ${planned}.\nResults: ${output}`,
  );
  if (options.prepareOnly) return 0;
  const log = openSync(join(output, 'run.log'), 'w');
  const result = spawnSync(
    join(root, 'node_modules/.bin/promptfoo'),
    [
      'eval',
      '-c',
      join(output, 'config.yaml'),
      '--no-cache',
      '--no-share',
      '--no-write',
      '--no-progress-bar',
      '--no-table',
      '-o',
      join(output, 'result.json'),
      join(output, 'result.html'),
    ],
    {
      cwd: root,
      stdio: ['ignore', log, log],
      env: {
        ...process.env,
        PROMPTFOO_CONFIG_DIR: join(root, '.promptfoo'),
        PROMPTFOO_DISABLE_TELEMETRY: '1',
        PROMPTFOO_DISABLE_UPDATE: '1',
        PROMPTFOO_CACHE_ENABLED: 'false',
        BENCHMARK_ALLOW_PAID: options.live ? '1' : '0',
        AWS_BEDROCK_MAX_RETRIES: String(options.retries + 1),
        REQUEST_TIMEOUT_MS: String(options.timeoutMs),
      },
    },
  );
  closeSync(log);
  save('metadata.json', {
    ...metadata,
    finished_at: new Date().toISOString(),
    process_exit_code: result.status,
    startup_error: result.error?.message,
  });
  console.log(readFileSync(join(output, 'run.log'), 'utf8'));
  if (result.error) throw result.error;
  return result.status ?? 1;
}
try {
  process.exitCode = main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
