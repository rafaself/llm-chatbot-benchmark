import type { CostSummary } from './pricing.ts';
import type { SessionScore } from './sessions.ts';

export interface ReportInput {
  summary: CostSummary;
  sessions: SessionScore[];
  durationMs?: number | null;
  benchmarkId: string;
  benchmarkVersion: string;
  runId: string;
}

function cell(value: number | null | undefined) {
  return value === null || value === undefined ? 'unknown' : String(value);
}

function money(value: number | null) {
  return value === null ? 'unknown' : '$' + value.toFixed(6);
}

function table(headers: string[], rows: string[][]) {
  return [
    '| ' + headers.join(' | ') + ' |',
    '| ' + headers.map(() => '---').join(' | ') + ' |',
    ...rows.map((row) => '| ' + row.join(' | ') + ' |'),
  ].join('\n');
}

function outcomes(sessions: SessionScore[]) {
  const turns = sessions.flatMap((session) => session.turns);
  const passed = turns.filter((turn) => turn.success).length;
  const errors = turns.filter((turn) => !turn.success && turn.error).length;
  const failed = turns.filter((turn) => !turn.success && !turn.error).length;
  const sessionErrors = sessions.filter(
    (session) => !session.success && session.turns.some((turn) => turn.error),
  ).length;
  const sessionPassed = sessions.filter((session) => session.success).length;
  const sessionFailed = sessions.length - sessionPassed - sessionErrors;
  return {
    turns: { passed, failed, errors, total: turns.length },
    sessions: {
      passed: sessionPassed,
      failed: sessionFailed,
      errors: sessionErrors,
      total: sessions.length,
    },
  };
}

function tokenTotal(prompt: number, completion: number) {
  return prompt + completion;
}

export function durationFromPromptfooResult(parsed: unknown) {
  if (!parsed || typeof parsed !== 'object' || !('results' in parsed)) return null;
  const results = parsed.results;
  if (!results || typeof results !== 'object' || !('stats' in results)) return null;
  const stats = results.stats;
  if (!stats || typeof stats !== 'object' || !('durationMs' in stats)) return null;
  return typeof stats.durationMs === 'number' ? stats.durationMs : null;
}

export function renderBenchmarkReport(input: ReportInput) {
  const { summary, sessions } = input;
  const counts = outcomes(sessions);
  const assistantTokens = tokenTotal(
    summary.tokens.assistant.prompt,
    summary.tokens.assistant.completion,
  );
  const judgeTokens = tokenTotal(
    summary.tokens.judge.prompt,
    summary.tokens.judge.completion,
  );
  const categoryTokens = new Map<string, { assistant: number; judge: number }>();
  for (const turn of summary.turns) {
    const current = categoryTokens.get(turn.category) ?? { assistant: 0, judge: 0 };
    current.assistant += tokenTotal(
      turn.assistant.prompt_tokens,
      turn.assistant.completion_tokens,
    );
    current.judge += tokenTotal(turn.judge.prompt_tokens, turn.judge.completion_tokens);
    categoryTokens.set(turn.category, current);
  }
  const lines = [
    '# Benchmark statistics',
    '',
    'List-price estimate checked ' +
      summary.checked_on +
      '. Not an invoice. Assistant rows are the model under test. Judge rows are grading overhead.',
    '',
    'Benchmark: `' +
      input.benchmarkId +
      '` v`' +
      input.benchmarkVersion +
      '` · run `' +
      input.runId +
      '`.',
    '',
    '## Results',
    '',
    table(
      ['', 'Passed', 'Failed', 'Errors', 'Total'],
      [
        [
          'Turns',
          cell(counts.turns.passed),
          cell(counts.turns.failed),
          cell(counts.turns.errors),
          cell(counts.turns.total),
        ],
        [
          'Sessions',
          cell(counts.sessions.passed),
          cell(counts.sessions.failed),
          cell(counts.sessions.errors),
          cell(counts.sessions.total),
        ],
      ],
    ),
    '',
    '## Time',
    '',
    table(
      ['Metric', 'Value'],
      [
        ['Wall clock', input.durationMs == null ? 'unknown' : input.durationMs + ' ms'],
        [
          'Latency mean',
          summary.latency_ms === null ? 'unknown' : summary.latency_ms.mean + ' ms',
        ],
        [
          'Latency median',
          summary.latency_ms === null ? 'unknown' : summary.latency_ms.p50 + ' ms',
        ],
        [
          'Latency P95',
          summary.latency_ms === null ? 'unknown' : summary.latency_ms.p95 + ' ms',
        ],
        [
          'Latency max',
          summary.latency_ms === null ? 'unknown' : summary.latency_ms.max + ' ms',
        ],
      ],
    ),
    '',
    '## Tokens',
    '',
    table(
      ['', 'Prompt', 'Completion', 'Total', 'Requests'],
      [
        [
          'Assistant',
          cell(summary.tokens.assistant.prompt),
          cell(summary.tokens.assistant.completion),
          cell(assistantTokens),
          cell(summary.tokens.assistant.requests),
        ],
        [
          'Judge',
          cell(summary.tokens.judge.prompt),
          cell(summary.tokens.judge.completion),
          cell(judgeTokens),
          cell(summary.tokens.judge.requests),
        ],
        [
          'Total',
          cell(summary.tokens.assistant.prompt + summary.tokens.judge.prompt),
          cell(summary.tokens.assistant.completion + summary.tokens.judge.completion),
          cell(assistantTokens + judgeTokens),
          cell(summary.tokens.assistant.requests + summary.tokens.judge.requests),
        ],
      ],
    ),
    '',
    '## Estimated cost',
    '',
    table(
      ['', 'USD'],
      [
        ['Assistant', money(summary.price_usd.assistant)],
        ['Judge', money(summary.price_usd.judge)],
        ['Total', money(summary.price_usd.total)],
        ['Mean per turn', money(summary.price_usd.per_turn_mean)],
        ['Median per turn', money(summary.price_usd.per_turn_p50)],
        ['P95 per turn', money(summary.price_usd.per_turn_p95)],
        ['Mean per session', money(summary.price_usd.per_session_mean)],
        ['Repeat estimate', money(summary.forecast.repeat_usd)],
      ],
    ),
    '',
    '## Category',
    '',
    table(
      [
        'Category',
        'Passed',
        'Not passed',
        'Total',
        'Mean latency',
        'Assistant tokens',
        'Judge tokens',
        'Cost',
        'Mean cost',
      ],
      summary.by_category.map((category) => {
        const tokens = categoryTokens.get(category.category);
        const notPassed = category.turns - category.passed;
        return [
          category.category || 'unknown',
          cell(category.passed),
          notPassed < 0 ? 'unknown' : cell(notPassed),
          cell(category.turns),
          category.mean_latency_ms === null
            ? 'unknown'
            : category.mean_latency_ms + ' ms',
          tokens ? cell(tokens.assistant) : 'unknown',
          tokens ? cell(tokens.judge) : 'unknown',
          money(category.total_usd),
          money(category.mean_usd),
        ];
      }),
    ),
  ];
  if (summary.unpriced_turns > 0) {
    lines.push(
      '',
      summary.unpriced_turns +
        (summary.unpriced_turns === 1 ? ' turn has' : ' turns have') +
        ' no price because a rate or token count was missing.',
    );
  }
  return lines.join('\n') + '\n';
}

/** Render the Markdown report's tables as readable terminal box tables. */
export function renderBenchmarkConsoleReport(markdown: string) {
  const lines = markdown.trimEnd().split('\n');
  const output: string[] = [];
  for (let index = 0; index < lines.length;) {
    if (!lines[index]?.startsWith('|')) {
      output.push(lines[index] ?? '');
      index += 1;
      continue;
    }
    const rows: string[][] = [];
    while (index < lines.length && lines[index]?.startsWith('|')) {
      const line = lines[index] ?? '';
      const row = line
        .slice(1, -1)
        .split('|')
        .map((value) => value.trim());
      if (!row.every((value) => /^:?-{3,}:?$/.test(value))) rows.push(row);
      index += 1;
    }
    const headers = rows.shift() ?? [];
    if (!headers.length) continue;
    const widths = headers.map((header, column) =>
      Math.max(header.length, ...rows.map((row) => (row[column] ?? '').length)),
    );
    const formatRow = (row: string[]) =>
      '│ ' +
      widths.map((width, column) => (row[column] ?? '').padEnd(width)).join(' │ ') +
      ' │';
    const border = (left: string, middle: string, right: string, fill: string) =>
      left + widths.map((width) => fill.repeat(width + 2)).join(middle) + right;
    output.push(border('┌', '┬', '┐', '─'));
    output.push(formatRow(headers));
    output.push(border('├', '┼', '┤', '─'));
    for (const row of rows) output.push(formatRow(row));
    output.push(border('└', '┴', '┘', '─'));
  }
  return output.join('\n') + '\n';
}
