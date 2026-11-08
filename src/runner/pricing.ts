import prices from '../../config/prices.json' with { type: 'json' };

interface TokenRates {
  input: number;
  output: number;
  cache_write?: number;
  cache_read?: number;
}

interface PriceRoute {
  source: string;
  inference: string;
  short: TokenRates;
  long?: TokenRates;
  long_context_input_tokens?: number;
}

export interface TokenCounts {
  prompt?: number;
  completion?: number;
  cached?: number;
  numRequests?: number;
  completionDetails?: {
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
  };
  assertions?: TokenCounts;
}

export interface PricedUsage {
  route: string | null;
  context: 'short' | 'long_aggregate' | 'unpriced';
  prompt_tokens: number;
  completion_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  requests: number;
  usd: number | null;
}

export interface TurnPrice {
  id: string;
  category: string;
  session_id: string;
  success: boolean;
  latency_ms: number | null;
  assistant: PricedUsage;
  judge: PricedUsage;
  total_usd: number | null;
}

export interface CostSummary {
  currency: 'USD';
  estimate: true;
  billing_record: false;
  checked_on: string;
  long_context_input_tokens: number;
  notes: string;
  turns: TurnPrice[];
  tokens: {
    assistant: { prompt: number; completion: number; requests: number };
    judge: { prompt: number; completion: number; requests: number };
  };
  latency_ms: { mean: number; p50: number; p95: number; max: number } | null;
  price_usd: {
    assistant: number | null;
    judge: number | null;
    total: number | null;
    per_turn_mean: number | null;
    per_turn_p50: number | null;
    per_turn_p95: number | null;
    per_session_mean: number | null;
  };
  by_category: Array<{
    category: string;
    turns: number;
    passed: number;
    mean_latency_ms: number | null;
    total_usd: number | null;
    mean_usd: number | null;
  }>;
  forecast: {
    basis: string;
    repeat_usd: number | null;
  };
  unpriced_turns: number;
}

const routes = prices.routes as Record<string, PriceRoute>;

export function priceRouteForModel(provider: 'bedrock' | 'openai', modelId: string) {
  return provider + ':' + modelId;
}

export function judgeRoute(judgeId: string | undefined) {
  if (!judgeId) return null;
  const bedrock = judgeId.match(/^bedrock:converse:(.+)$/);
  if (bedrock?.[1]) return priceRouteForModel('bedrock', bedrock[1]);
  const openai = judgeId.match(/^openai:responses:(.+)$/);
  if (openai?.[1]) return priceRouteForModel('openai', openai[1]);
  return null;
}

function roundUsd(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function percentile(values: number[], fraction: number) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((sorted.length - 1) * fraction)),
  );
  return sorted[index] ?? 0;
}

export function priceUsage(
  usage: TokenCounts | undefined,
  routeKey: string | null,
): PricedUsage {
  const prompt = usage?.prompt ?? 0;
  const completion = usage?.completion ?? 0;
  const cacheRead =
    usage?.completionDetails?.cacheReadInputTokens ?? usage?.cached ?? 0;
  const cacheWrite = usage?.completionDetails?.cacheCreationInputTokens ?? 0;
  const requests = usage?.numRequests ?? 0;
  const empty: PricedUsage = {
    route: routeKey,
    context: 'unpriced',
    prompt_tokens: prompt,
    completion_tokens: completion,
    cache_read_tokens: cacheRead,
    cache_write_tokens: cacheWrite,
    requests,
    usd: null,
  };
  if (!routeKey || !routes[routeKey] || !usage) return empty;
  const route = routes[routeKey];
  const threshold = route.long_context_input_tokens ?? prices.long_context_input_tokens;
  const long = route.long !== undefined && prompt > threshold;
  const rates = long && route.long ? route.long : route.short;
  const writeRate = rates.cache_write ?? rates.input;
  const readRate = rates.cache_read ?? rates.input;
  const standardInput = Math.max(0, prompt - cacheRead - cacheWrite);
  const usd =
    (standardInput * rates.input +
      cacheWrite * writeRate +
      cacheRead * readRate +
      completion * rates.output) /
    1_000_000;
  return {
    ...empty,
    context: long ? 'long_aggregate' : 'short',
    usd: roundUsd(usd),
  };
}

function mean(values: number[]) {
  if (!values.length) return null;
  return roundUsd(values.reduce((sum, value) => sum + value, 0) / values.length);
}

interface CostRow {
  success?: boolean;
  latencyMs?: number;
  provider?: { id?: string; label?: string };
  vars?: { id?: string; expected_category?: string; session_id?: string };
  metadata?: { conversationId?: string; latency_ms?: number; category?: string };
  tokenUsage?: TokenCounts;
}

export function summarizeCosts(
  rows: CostRow[],
  judgeId: string | undefined,
): CostSummary {
  const judgeKey = judgeRoute(judgeId);
  const turns = rows.map((row) => {
    const assistant = priceUsage(
      row.tokenUsage,
      row.provider?.id ? priceRouteForModel('bedrock', row.provider.id) : null,
    );
    const judge = priceUsage(row.tokenUsage?.assertions, judgeKey);
    const total =
      assistant.usd === null || judge.usd === null
        ? null
        : roundUsd(assistant.usd + judge.usd);
    return {
      id: row.vars?.id ?? '',
      category: row.vars?.expected_category ?? row.metadata?.category ?? '',
      session_id: row.metadata?.conversationId ?? row.vars?.session_id ?? '',
      success: row.success === true,
      latency_ms: row.latencyMs ?? row.metadata?.latency_ms ?? null,
      assistant,
      judge,
      total_usd: total,
    };
  });
  const priced = turns.filter((turn) => turn.total_usd !== null);
  const latencies = turns.flatMap((turn) =>
    turn.latency_ms === null ? [] : [turn.latency_ms],
  );
  const sessionTotals = new Map<string, number>();
  for (const turn of priced) {
    sessionTotals.set(
      turn.session_id,
      (sessionTotals.get(turn.session_id) ?? 0) + (turn.total_usd ?? 0),
    );
  }
  const categories = [...new Set(turns.map((turn) => turn.category))].sort();
  const sum = (select: (turn: TurnPrice) => number) =>
    turns.reduce((total, turn) => total + select(turn), 0);
  const pricedValues = priced.flatMap((turn) =>
    turn.total_usd === null ? [] : [turn.total_usd],
  );
  const assistantUsd = priced.length
    ? roundUsd(priced.reduce((total, turn) => total + (turn.assistant.usd ?? 0), 0))
    : null;
  const judgeUsd = priced.length
    ? roundUsd(priced.reduce((total, turn) => total + (turn.judge.usd ?? 0), 0))
    : null;
  const totalUsd =
    assistantUsd === null || judgeUsd === null
      ? null
      : roundUsd(assistantUsd + judgeUsd);
  return {
    currency: 'USD',
    estimate: true,
    billing_record: false,
    checked_on: prices.checked_on,
    long_context_input_tokens: prices.long_context_input_tokens,
    notes: prices.notes,
    turns,
    tokens: {
      assistant: {
        prompt: sum((turn) => turn.assistant.prompt_tokens),
        completion: sum((turn) => turn.assistant.completion_tokens),
        requests: sum((turn) => turn.assistant.requests),
      },
      judge: {
        prompt: sum((turn) => turn.judge.prompt_tokens),
        completion: sum((turn) => turn.judge.completion_tokens),
        requests: sum((turn) => turn.judge.requests),
      },
    },
    latency_ms: latencies.length
      ? {
          mean: Math.round(
            latencies.reduce((total, value) => total + value, 0) / latencies.length,
          ),
          p50: percentile(latencies, 0.5),
          p95: percentile(latencies, 0.95),
          max: percentile(latencies, 1),
        }
      : null,
    price_usd: {
      assistant: assistantUsd,
      judge: judgeUsd,
      total: totalUsd,
      per_turn_mean: mean(pricedValues),
      per_turn_p50: pricedValues.length
        ? roundUsd(percentile(pricedValues, 0.5))
        : null,
      per_turn_p95: pricedValues.length
        ? roundUsd(percentile(pricedValues, 0.95))
        : null,
      per_session_mean: mean([...sessionTotals.values()]),
    },
    by_category: categories.map((category) => {
      const group = turns.filter((turn) => turn.category === category);
      const groupPrices = group.flatMap((turn) =>
        turn.total_usd === null ? [] : [turn.total_usd],
      );
      const groupLatency = group.flatMap((turn) =>
        turn.latency_ms === null ? [] : [turn.latency_ms],
      );
      return {
        category,
        turns: group.length,
        passed: group.filter((turn) => turn.success).length,
        mean_latency_ms: groupLatency.length
          ? Math.round(
              groupLatency.reduce((total, value) => total + value, 0) /
                groupLatency.length,
            )
          : null,
        total_usd:
          groupPrices.length === group.length
            ? roundUsd(groupPrices.reduce((total, value) => total + value, 0))
            : null,
        mean_usd: mean(groupPrices),
      };
    }),
    forecast: {
      basis:
        'Mean observed price per priced turn, repeated for every turn in the run. Not a request-ceiling estimate.',
      repeat_usd:
        mean(pricedValues) === null
          ? null
          : roundUsd((mean(pricedValues) ?? 0) * turns.length),
    },
    unpriced_turns: turns.length - priced.length,
  };
}

export function formatCostSummary(summary: CostSummary) {
  if (summary.price_usd.total === null)
    return 'Price estimate unavailable for this run.';
  const money = (value: number | null) =>
    value === null ? 'unknown' : '$' + value.toFixed(value >= 0.01 ? 4 : 6);
  return (
    'Price estimate ' +
    money(summary.price_usd.total) +
    ' (assistant ' +
    money(summary.price_usd.assistant) +
    ', judge ' +
    money(summary.price_usd.judge) +
    '; mean ' +
    money(summary.price_usd.per_turn_mean) +
    ' per turn). Published list rates checked ' +
    summary.checked_on +
    '. Not an invoice.'
  );
}
