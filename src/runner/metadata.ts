import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import pkg from '../../package.json' with { type: 'json' };
import benchmark from '../../evaluation/benchmark.json' with { type: 'json' };
import type { RunnerOptions } from './cli.ts';
import { ROOT, sessionCount, type PreparedRun } from './config.ts';

export function createMetadata(options: RunnerOptions, prepared: PreparedRun) {
  const hash = (data: string | Buffer) =>
    createHash('sha256').update(data).digest('hex');
  const sourceFiles = (directory: string): string[] =>
    readdirSync(join(ROOT, directory)).flatMap((name) => {
      const path = join(directory, name);
      return statSync(join(ROOT, path)).isDirectory()
        ? sourceFiles(path)
        : name.endsWith('.ts')
          ? [path]
          : [];
    });
  const sources = [
    'evaluation/promptfooconfig.yaml',
    'evaluation/benchmark.json',
    'src/assertions.cjs',
    'evaluation/config/models.json',
    'evaluation/config/prices.json',
    'evaluation/prompts/chat.json',
    'package.json',
    'package-lock.json',
    ...sourceFiles('src'),
  ];
  const git = (...args: string[]) =>
    spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' }).stdout?.trim();
  return {
    created_at: new Date().toISOString(),
    mode: options.live ? 'live' : 'smoke',
    evidence: options.prepareOnly
      ? 'unexecuted'
      : options.live
        ? 'live_attempt'
        : 'fixture',
    git_revision: git('rev-parse', 'HEAD') || null,
    git_dirty: Boolean(git('status', '--porcelain')),
    benchmark_id: benchmark.id,
    benchmark_version: benchmark.version,
    models: options.live ? prepared.selected : ['offline-fixture'],
    providers: prepared.config.providers,
    judge: prepared.judge,
    case_count: prepared.tests.length,
    session_count: sessionCount(prepared.tests),
    categories: [
      ...new Set(prepared.tests.map((test) => test.vars.expected_category)),
    ].sort(),
    selected_cases_sha256: hash(JSON.stringify(prepared.tests)),
    parameters: options,
    planned_max_requests: prepared.plannedRequests,
    versions: { promptfoo: pkg.devDependencies.promptfoo, ...pkg.dependencies },
    source_hashes: {
      dataset: hash(readFileSync(resolve(options.dataset))),
      policy: hash(
        readFileSync(join(ROOT, 'evaluation/datasets/sonora_store_policy.md')),
      ),
      operational_database: hash(
        readFileSync(
          join(ROOT, 'evaluation/datasets/sonora_store_database.sqlite'),
        ),
      ),
      ...Object.fromEntries(
        sources.map((file) => [file, hash(readFileSync(join(ROOT, file)))]),
      ),
    },
  };
}
