import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { load } from 'js-yaml';
import type { ProviderOptions, UnifiedConfig } from 'promptfoo';
import registry from '../../evaluation/config/models.json' with { type: 'json' };
import { loadDataset } from '../dataset.ts';
import type { RunnerOptions } from './cli.ts';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));

export interface PreparedRun {
  config: UnifiedConfig;
  tests: ReturnType<typeof loadDataset>;
  selected: string[];
  judge: ProviderOptions;
  plannedRequests: number;
}

export function prepareConfig(options: RunnerOptions): PreparedRun {
  if (options.repeat !== 1) {
    throw new Error(
      'Conversation evals require --repeat 1; Promptfoo replays repeats into the same _conversation history.',
    );
  }
  const tests = loadDataset(options.dataset, options.category);
  const selected = options.models ?? ['nova-micro'];
  if (new Set(selected).size !== selected.length)
    throw new Error('Duplicate model selection');

  const plannedRequests =
    tests.length *
    (options.live ? selected.length : 1) *
    options.repeat *
    (options.maxTurns + 1 + 3) *
    (options.retries + 1);
  if (plannedRequests > options.maxRequests)
    throw new Error(
      'Request upper bound ' +
        plannedRequests +
        ' exceeds --max-requests ' +
        options.maxRequests,
    );

  const config = load(
    readFileSync(join(ROOT, 'evaluation/promptfooconfig.yaml'), 'utf8'),
  ) as UnifiedConfig;
  const adapter = 'file://' + join(ROOT, 'src/chatbot.ts');
  config.prompts = ['file://' + join(ROOT, 'evaluation/prompts/chat.json')];
  config.tests = tests;
  config.providers = options.live
    ? selected.map((key): ProviderOptions => {
        if (!Object.hasOwn(registry.models, key))
          throw new Error('Unknown model: ' + key);
        const model = registry.models[key as keyof typeof registry.models];
        if (
          model.tool_support === 'unverified_on_converse' &&
          !options.allowUnverifiedTools
        ) {
          throw new Error(
            key +
              ': tool support is unverified; use --allow-unverified-tools for a capability probe',
          );
        }
        if (
          options.temperature !== undefined &&
          (key.startsWith('gpt-6') || key === 'haiku-5.5')
        ) {
          throw new Error(
            key + ': omit --temperature; comparable sampling settings are unavailable',
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
    : { id: 'file://' + join(ROOT, 'src/smoke.ts') };
  if (options.live) {
    config.description =
      'Live chatbot benchmark; three GPT-6.1 Sol rubric grades per answer';
    judge.config = {
      ...judge.config,
      ...(options.judgeProvider === 'bedrock'
        ? { region: options.region }
        : { maxRetries: options.retries }),
    };
  }
  if (!config.defaultTest || typeof config.defaultTest === 'string')
    throw new Error(
      'Expected inline defaultTest criteria in evaluation/promptfooconfig.yaml',
    );
  // A generated result directory is not the repository root: use absolute assertion scripts.
  const defaultAssertions = config.defaultTest.assert ?? [];
  config.defaultTest.assert = defaultAssertions.map((assertion) => {
    if (
      assertion.type !== 'javascript' ||
      typeof assertion.value !== 'string' ||
      !assertion.value.startsWith('file://../src/')
    )
      return assertion;
    return {
      ...assertion,
      value:
        'file://' +
        join(ROOT, assertion.value.slice('file://../'.length)),
    };
  });
  config.defaultTest = {
    ...config.defaultTest,
    options: {
      ...config.defaultTest.options,
      disableVarExpansion: true,
      provider: judge,
    },
  };
  config.evaluateOptions = {
    maxConcurrency: options.concurrency,
    repeat: options.repeat,
    delay: options.delayMs,
  };
  return { config, tests, selected, judge, plannedRequests };
}

export function sessionCount(tests: Array<{ metadata: { conversationId: string } }>) {
  return new Set(tests.map((test) => test.metadata.conversationId)).size;
}
