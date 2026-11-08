import { Command, Option } from 'commander';
import { z } from 'zod';
import { developmentDatasetPath, smokeDatasetPath } from '../dataset.ts';

export interface RunnerOptions {
  smoke?: boolean;
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
}

const positive = (value: string) => z.coerce.number().int().positive().parse(value);
const nonnegative = (value: string) =>
  z.coerce.number().int().nonnegative().parse(value);

function createProgram(region: string) {
  return new Command()
    .description(
      'Prepare and run Promptfoo. Offline by default; paid calls require opt-in.',
    )
    .addOption(
      new Option('--smoke', 'Offline SDK fixtures (default)').conflicts('live'),
    )
    .addOption(
      new Option('--live', 'Selected Bedrock models and GPT-6.1 Sol judge').conflicts(
        'smoke',
      ),
    )
    .option('--allow-paid', 'Opt in to this paid invocation')
    .option('--prepare-only', 'Write resolved config without API calls')
    .option('--models <keys...>', 'Keys from evaluation/config/models.json')
    .option('--category <names...>', 'Select scenario categories')
    .option('--dataset <path>', 'JSONL scenarios (live: development; offline: smoke)')
    .option('--output <path>', 'New result directory')
    .option('--region <region>', 'AWS source region', region)
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
    .option(
      '--repeat <n>',
      'Repetitions per turn; conversation history requires 1',
      positive,
      1,
    )
    .option('--retries <n>', 'SDK retries per request', nonnegative, 0)
    .option('--timeout-ms <n>', 'SDK timeout per target step', positive, 60000)
    .option('--max-turns <n>', 'Maximum AI SDK steps per answer', positive, 3)
    .option(
      '--max-requests <n>',
      'Conservative request ceiling including grading/retries',
      positive,
      500,
    )
    .option('--delay-ms <n>', 'Promptfoo delay between evaluations', nonnegative, 0);
}

export function parseOptions(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): RunnerOptions {
  const program = createProgram(
    env.AWS_REGION ?? env.AWS_DEFAULT_REGION ?? 'us-east-1',
  );
  program.parse(argv, { from: 'user' });
  const options = program.opts<RunnerOptions>();
  options.dataset ??= options.live ? developmentDatasetPath : smokeDatasetPath;
  if (options.live && !options.prepareOnly && !options.allowPaid)
    throw new Error('Live calls require --allow-paid; use --prepare-only to preview.');
  if (options.allowPaid && !options.live)
    throw new Error('--allow-paid requires --live');
  if (!options.live && options.models) throw new Error('Select models with --live');
  return options;
}
