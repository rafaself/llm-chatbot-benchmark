import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { dump } from 'js-yaml';
import type { RunnerOptions } from './cli.ts';
import { ROOT, sessionCount, type PreparedRun } from './config.ts';
import { summarizeCosts } from './pricing.ts';
import {
  durationFromPromptfooResult,
  renderBenchmarkConsoleReport,
  renderBenchmarkReport,
} from './report.ts';
import { readEvalRows, scoreSessions } from './sessions.ts';

export function executeRun<
  T extends {
    benchmark_id: string;
    benchmark_version: string;
    mode: string;
  },
>(options: RunnerOptions, prepared: PreparedRun, metadata: T) {
  const output = resolve(
    options.output ??
      join(
        ROOT,
        'evaluation',
        'results',
        new Date().toISOString().replaceAll(':', '-'),
      ),
  );
  const runId = basename(output);
  const runMetadata = { ...metadata, run_id: runId };
  mkdirSync(resolve(output, '..'), { recursive: true });
  mkdirSync(output); // Exclusive create: never overwrite an existing run.
  const save = (name: string, value: unknown) =>
    writeFileSync(join(output, name), JSON.stringify(value, null, 2) + '\n');
  writeFileSync(join(output, 'config.yaml'), dump(prepared.config));
  save('metadata.json', runMetadata);
  const sessionsPrepared = sessionCount(prepared.tests);
  console.log(
    'Prepared ' +
      prepared.tests.length +
      (prepared.tests.length === 1 ? ' turn in ' : ' turns in ') +
      sessionsPrepared +
      (sessionsPrepared === 1 ? ' session; ' : ' sessions; ') +
      metadata.mode +
      '; request upper bound ' +
      prepared.plannedRequests +
      '.\nResults: ' +
      output,
  );
  if (options.prepareOnly) return 0;

  const log = openSync(join(output, 'run.log'), 'w');
  const result = spawnSync(
    join(ROOT, 'node_modules/.bin/promptfoo'),
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
      cwd: ROOT,
      stdio: ['ignore', log, log],
      env: {
        ...process.env,
        PROMPTFOO_CONFIG_DIR: join(ROOT, '.promptfoo'),
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
  const resultPath = join(output, 'result.json');
  const parsed = existsSync(resultPath)
    ? (JSON.parse(readFileSync(resultPath, 'utf8')) as unknown)
    : undefined;
  const rows = parsed ? readEvalRows(parsed) : [];
  const sessions = rows.length ? scoreSessions(rows, { byModel: true }) : [];
  const summary = parsed ? summarizeCosts(rows, prepared.judge.id) : undefined;
  const durationMs = parsed ? durationFromPromptfooResult(parsed) : null;
  if (summary) {
    save('stats.json', {
      ...summary,
      benchmark_id: runMetadata.benchmark_id,
      benchmark_version: runMetadata.benchmark_version,
      run_id: runId,
      wall_clock_ms: durationMs,
    });
  }
  if (sessions.length) {
    save('sessions.json', {
      success: sessions.every((session) => session.success),
      sessions,
    });
  }
  const sessionFailed = sessions.some((session) => !session.success);
  const processExitCode = result.status ?? 1;
  save('metadata.json', {
    ...runMetadata,
    finished_at: new Date().toISOString(),
    process_exit_code: processExitCode,
    startup_error: result.error?.message,
    ...(sessions.length
      ? {
          session_success: sessions.every((session) => session.success),
          sessions,
        }
      : {}),
  });
  console.log(readFileSync(join(output, 'run.log'), 'utf8'));
  if (summary) {
    const report = renderBenchmarkReport({
      summary,
      sessions,
      modelNames: options.live ? prepared.selected : ['offline-fixture'],
      expectedSessions: sessionsPrepared,
      durationMs,
      benchmarkId: String(runMetadata.benchmark_id),
      benchmarkVersion: String(runMetadata.benchmark_version),
      runId,
    });
    writeFileSync(join(output, 'stats.md'), report);
    console.log(renderBenchmarkConsoleReport(report));
  }
  if (result.error) throw result.error;
  if (processExitCode !== 0) return processExitCode;
  return sessionFailed ? 1 : 0;
}
