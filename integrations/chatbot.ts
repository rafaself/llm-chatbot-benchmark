// The only TypeScript bridge: reuse Promptfoo providers for an extra tool-result turn.
import { loadApiProvider, type ProviderResponse } from 'promptfoo';

interface AdapterConfig {
  mode?: 'smoke' | 'smoke-judge' | 'live';
  provider?: { id: string; config?: Record<string, unknown> };
  judge?: boolean;
  tool_support?: 'documented' | 'unverified_on_converse' | 'unsupported';
  timeout_ms?: number;
  max_turns?: number;
  delay_ms?: number;
}

type LoadedProvider = Awaited<ReturnType<typeof loadApiProvider>>;
type NativeProvider = Pick<LoadedProvider, 'callApi'>;
type NativeContext = NonNullable<Parameters<NativeProvider['callApi']>[1]>;
type ToolStatus = 'supported' | 'malformed' | 'unsupported' | 'api_error';
type UnknownRecord = Record<string, unknown>;

interface ConversationMessage {
  role: 'system' | 'user' | 'assistant';
  content: unknown;
}

interface NormalizedToolCall {
  id?: string;
  name: string;
  input: UnknownRecord;
}

interface NormalizedCalls {
  calls: NormalizedToolCall[];
  actual_tool: string;
  tool_status: 'supported' | 'malformed';
}

interface SmokeToolCallBlock {
  type: 'tool_use';
  id: string;
  name: 'get_weather' | 'lookup_order';
  input: UnknownRecord;
}

interface SmokeResult {
  answer: string;
  calls: SmokeToolCallBlock[];
}

interface ConverseProviderHooks {
  // This is the pinned Promptfoo private integration boundary; its raw response
  // shape is checked at runtime before it is read or replayed.
  parseResponse(raw: unknown, ...args: unknown[]): Promise<unknown>;
  getBedrockInstance(): Promise<unknown>;
}

interface RequestHandlerClient {
  config: {
    requestHandler: {
      updateHttpClientConfig(name: string, value: unknown): void;
    };
  };
}

interface ConversePayload {
  content: unknown[];
  stopReason?: string;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

function parseConversationMessages(prompt: string): ConversationMessage[] {
  const parsed: unknown = parseJson(prompt);
  if (!isUnknownArray(parsed)) throw new Error('Prompt must be a JSON message array');

  return parsed.map((entry): ConversationMessage => {
    if (
      !isRecord(entry) ||
      !['system', 'user', 'assistant'].includes(String(entry.role)) ||
      !('content' in entry)
    ) {
      throw new Error('Prompt contains an invalid conversation message');
    }
    return {
      role: entry.role as ConversationMessage['role'],
      content: entry.content,
    };
  });
}

export function normalizeCalls(raw: unknown): NormalizedCalls {
  const calls: NormalizedToolCall[] = [];
  if (raw === null || raw === undefined) {
    return { calls, actual_tool: 'none', tool_status: 'supported' };
  }

  try {
    let payload = typeof raw === 'string' ? parseJson(raw) : raw;
    if (
      isRecord(payload) &&
      payload.tool_calls !== undefined &&
      payload.tool_calls !== null
    ) {
      payload = payload.tool_calls;
    }
    if (isRecord(payload)) {
      const output = isRecord(payload.output) ? payload.output : undefined;
      const message = output && isRecord(output.message) ? output.message : undefined;
      if (message?.content !== undefined && message.content !== null) {
        payload = message.content;
      }
    }

    const blocks = isUnknownArray(payload) ? payload : [payload];
    for (const value of blocks) {
      if (!isRecord(value)) throw new Error('Unrecognized content block');

      const nestedToolUse = isRecord(value.toolUse) ? value.toolUse : undefined;
      const nestedFunction = isRecord(value.function) ? value.function : undefined;
      const type = value.type;
      const call =
        nestedToolUse ??
        (type === 'tool_use' || type === 'function_call' || nestedFunction
          ? value
          : undefined);

      if (!call) {
        if (
          type !== undefined &&
          type !== null &&
          (typeof type !== 'string' ||
            !['text', 'thinking', 'reasoning'].includes(type))
        ) {
          throw new Error('Unrecognized content block');
        }
        continue;
      }

      const functionCall = isRecord(call.function) ? call.function : undefined;
      const name = functionCall?.name ?? call.name;
      let input = functionCall?.arguments ?? call.arguments ?? call.input;
      if (typeof input === 'string') input = parseJson(input);
      if (typeof name !== 'string' || !name.trim() || !isRecord(input)) {
        throw new Error('Invalid tool call');
      }

      const id = call.toolUseId ?? call.call_id ?? call.id;
      if (id !== undefined && typeof id !== 'string') {
        throw new Error('Invalid tool call ID');
      }
      calls.push({
        ...(typeof id === 'string' ? { id } : {}),
        name: name.trim(),
        input,
      });
    }

    // Compare all calls, including duplicates and extras, rather than only the first.
    const actual_tool = calls.some((call) => call.name === 'none')
      ? '__invalid_tool__:none'
      : calls.length
        ? calls
            .map((call) => call.name)
            .sort()
            .join(',')
        : 'none';
    return { calls, actual_tool, tool_status: 'supported' };
  } catch {
    return { calls, actual_tool: '__malformed__', tool_status: 'malformed' };
  }
}

export function fixtureTool(
  call: Pick<NormalizedToolCall, 'name' | 'input'>,
): UnknownRecord {
  if (call.name === 'get_weather') {
    const city = call.input.city;
    if (
      Object.keys(call.input).length !== 1 ||
      typeof city !== 'string' ||
      !city.trim()
    ) {
      return { error: 'invalid_arguments', required: 'city' };
    }
    return city.trim().toLowerCase() === 'boston'
      ? { city: 'Boston', temperature_c: 18, conditions: 'sunny' }
      : { error: 'city_not_found' };
  }
  if (call.name === 'lookup_order') {
    const orderId = call.input.order_id;
    if (Object.keys(call.input).length !== 1 || typeof orderId !== 'string') {
      return { error: 'invalid_arguments' };
    }
    const orders: Record<string, 'delivered' | 'in_transit'> = {
      A100: 'delivered',
      A200: 'in_transit',
    };
    const status = Object.hasOwn(orders, orderId) ? orders[orderId] : undefined;
    return status ? { order_id: orderId, status } : { error: 'order_not_found' };
  }
  return { error: 'unknown_tool' };
}

function smokeAnswer(prompt: string): SmokeResult {
  // Fixtures deliberately never read expected_answer or expected_tool.
  const messages = parseConversationMessages(prompt);
  const latest = messages.at(-1);
  const input = typeof latest?.content === 'string' ? latest.content.toLowerCase() : '';
  if (input.includes('weather') && input.includes('boston')) {
    return {
      answer: 'It is sunny in Boston and 18 C.',
      calls: [
        {
          type: 'tool_use',
          id: 'smoke-weather',
          name: 'get_weather',
          input: { city: 'Boston' },
        },
      ],
    };
  }
  const order = input.match(/\ba[12]00\b/)?.[0].toUpperCase();
  if (order) {
    return {
      answer: `Order ${order} is ${order === 'A100' ? 'delivered' : 'in transit'}.`,
      calls: [
        {
          type: 'tool_use',
          id: 'smoke-order',
          name: 'lookup_order',
          input: { order_id: order },
        },
      ],
    };
  }
  if (input.includes('order')) return { answer: 'What is your order ID?', calls: [] };
  if (input.includes('guitar')) {
    return {
      answer: 'A standard guitar usually has six strings.',
      calls: [],
    };
  }
  if (input.includes('metronome')) {
    return {
      answer: 'A metronome helps musicians keep a steady tempo.',
      calls: [],
    };
  }
  return { answer: 'Hello! How can I help?', calls: [] };
}

function hasRequestHandlerClient(value: unknown): value is RequestHandlerClient {
  if (!isRecord(value)) return false;
  const config = isRecord(value.config) ? value.config : undefined;
  const handler =
    config && isRecord(config.requestHandler) ? config.requestHandler : undefined;
  return typeof handler?.updateHttpClientConfig === 'function';
}

function getConversePayload(response: ProviderResponse): ConversePayload | undefined {
  const metadata = isRecord(response.metadata) ? response.metadata : undefined;
  const raw =
    metadata && isRecord(metadata.raw_response) ? metadata.raw_response : undefined;
  const output = raw && isRecord(raw.output) ? raw.output : undefined;
  const message = output && isRecord(output.message) ? output.message : undefined;
  if (!message || !isUnknownArray(message.content)) return undefined;
  return {
    content: message.content,
    ...(typeof raw?.stopReason === 'string' ? { stopReason: raw.stopReason } : {}),
  };
}

function isToolUseBlock(value: unknown): value is UnknownRecord {
  return isRecord(value) && isRecord(value.toolUse);
}

function sanitizeTargetContext(
  context: NativeContext | undefined,
): NativeContext | undefined {
  if (!context) return undefined;
  const safeContext = {
    ...context,
    vars: context.vars.input === undefined ? {} : { input: context.vars.input },
  };
  delete safeContext.test;
  return safeContext;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default class ChatbotProvider {
  config: AdapterConfig;
  native: Promise<NativeProvider> | undefined;

  constructor(options: { config?: AdapterConfig }) {
    this.config = options.config ?? {};
  }

  id(): string {
    return this.config.provider?.id ?? this.config.mode ?? 'chatbot';
  }

  async createNative(): Promise<NativeProvider> {
    const spec = this.config.provider;
    if (!spec) throw new Error('Live provider configuration is missing');
    const native = await loadApiProvider(spec.id, { options: spec });
    if (spec.id.startsWith('bedrock:converse:')) {
      // Promptfoo 0.125.1's private hooks are isolated behind this single assertion.
      const converse = native as unknown as NativeProvider & ConverseProviderHooks;
      if (
        typeof converse.parseResponse !== 'function' ||
        typeof converse.getBedrockInstance !== 'function'
      ) {
        throw new Error(
          'Pinned Promptfoo Converse integration changed; revalidate adapter',
        );
      }
      const parse = converse.parseResponse.bind(native);
      converse.parseResponse = async (
        raw: unknown,
        ...args: unknown[]
      ): Promise<unknown> => {
        const result = await parse(raw, ...args);
        if (!isRecord(result)) return result;
        const metadata = isRecord(result.metadata) ? result.metadata : {};
        return { ...result, metadata: { ...metadata, raw_response: raw } };
      };

      const client = await converse.getBedrockInstance();
      if (!hasRequestHandlerClient(client)) {
        throw new Error('AWS HTTP timeout configuration unavailable');
      }
      const handler = client.config.requestHandler;
      handler.updateHttpClientConfig('requestTimeout', this.config.timeout_ms ?? 60000);
      handler.updateHttpClientConfig(
        'connectionTimeout',
        this.config.timeout_ms ?? 60000,
      );
      handler.updateHttpClientConfig('throwOnRequestTimeout', true);
    }
    return native;
  }

  async callApi(prompt: string, context?: NativeContext): Promise<ProviderResponse> {
    if (this.config.mode === 'smoke-judge') {
      return {
        output: JSON.stringify({
          pass: true,
          score: 1,
          reason:
            'OFFLINE fixture judge: validates wiring only; no answer quality evidence.',
        }),
        metadata: { evidence: 'fixture' },
      };
    }
    if (this.config.mode === 'smoke') {
      const fixture = smokeAnswer(prompt);
      const normalized = normalizeCalls(fixture.calls);
      return {
        output: {
          answer: fixture.answer,
          ...normalized,
          raw_tool_calls: fixture.calls,
        },
        metadata: { evidence: 'fixture', tool_status: normalized.tool_status },
      };
    }
    if (process.env.BENCHMARK_ALLOW_PAID !== '1') {
      return { error: 'Paid calls require the runner --live --allow-paid opt-in' };
    }

    const traces: ProviderResponse[] = [];
    const allCalls: UnknownRecord[] = [];
    const messages = this.config.judge ? [] : parseConversationMessages(prompt);
    const finish = (
      answer: string,
      status: ToolStatus,
      error?: string,
    ): ProviderResponse => {
      const usage: NonNullable<ProviderResponse['tokenUsage']> = {};
      const tokenFields = ['prompt', 'completion', 'total', 'numRequests'] as const;
      for (const field of tokenFields) {
        const values = traces.map((trace) => trace.tokenUsage?.[field]);
        if (
          values.length > 0 &&
          values.every((value): value is number => typeof value === 'number')
        ) {
          usage[field] = values.reduce((sum, value) => sum + value, 0);
        }
      }
      const costs = traces.map((trace) => trace.cost);
      const hasCost =
        costs.length > 0 &&
        costs.every((cost): cost is number => typeof cost === 'number');
      const totalCost = hasCost
        ? costs.reduce((sum, cost) => sum + cost, 0)
        : undefined;
      const actual =
        status === 'supported' ? normalizeCalls(allCalls).actual_tool : `__${status}__`;
      return {
        output: this.config.judge
          ? answer
          : {
              answer,
              actual_tool: actual,
              tool_status: status,
              raw_tool_calls: allCalls,
            },
        tokenUsage: usage,
        ...(totalCost === undefined ? {} : { cost: totalCost }),
        metadata: {
          model_id: this.config.provider?.id,
          tool_status: status,
          invalid_response: status === 'malformed',
          turns: traces,
          evidence: 'live',
          cost_source: hasCost ? 'promptfoo_estimate' : 'unavailable',
          ...(this.config.judge && totalCost !== undefined
            ? { grading_cost_usd: totalCost }
            : {}),
        },
        ...(error ? { error } : {}),
      };
    };

    if (this.config.tool_support === 'unsupported') {
      return finish('', 'unsupported', 'Tool calling unsupported for this model/route');
    }

    try {
      this.native ??= this.createNative();
      const native = await this.native;
      for (
        let turn = 0;
        turn < (this.config.judge ? 1 : (this.config.max_turns ?? 3));
        turn++
      ) {
        if (this.config.delay_ms) {
          await new Promise((resolve) => setTimeout(resolve, this.config.delay_ms));
        }
        // Never pass expected answers or grading criteria into the target provider.
        const safeContext = this.config.judge
          ? context
          : sanitizeTargetContext(context);
        const response = await native.callApi(
          this.config.judge ? prompt : JSON.stringify(messages),
          safeContext,
        );
        traces.push(response);
        if (response.error) {
          const isModelError: unknown = response.metadata?.isModelError;
          return finish('', isModelError ? 'malformed' : 'api_error', response.error);
        }
        if (this.config.judge)
          return finish(String(response.output ?? ''), 'supported');

        const payload = getConversePayload(response);
        if (!payload) return finish('', 'malformed', 'Missing raw Converse message');
        allCalls.push(...payload.content.filter(isToolUseBlock));
        const normalized = normalizeCalls(payload.content);
        if (normalized.tool_status === 'malformed') {
          return finish('', 'malformed', 'Malformed tool call');
        }
        if (
          normalized.calls.some(
            (call) => typeof call.id !== 'string' || !call.id.trim(),
          )
        ) {
          return finish('', 'malformed', 'Missing tool call ID');
        }
        if (!normalized.calls.length) {
          const answer = payload.content
            .flatMap((block) => {
              const record = isRecord(block) ? block : undefined;
              return typeof record?.text === 'string' ? [record.text] : [];
            })
            .join('\n')
            .trim();
          if (
            !answer ||
            ['max_tokens', 'guardrail_intervened', 'content_filtered'].includes(
              payload.stopReason ?? '',
            )
          ) {
            return finish(
              answer,
              'malformed',
              `Empty, truncated, or blocked response: ${payload.stopReason}`,
            );
          }
          return finish(answer, 'supported');
        }
        if (
          payload.content.some((block) => {
            const record = isRecord(block) ? block : undefined;
            return Boolean(record?.reasoningContent);
          })
        ) {
          return finish(
            '',
            'unsupported',
            'Pinned Promptfoo cannot replay signed reasoning blocks in a tool exchange',
          );
        }

        // Promptfoo's parser accepts text/tool blocks; preserve their native payloads.
        const replay = payload.content.map((block) => {
          const record = isRecord(block) ? block : undefined;
          return typeof record?.text === 'string'
            ? { type: 'text', text: record.text }
            : block;
        });
        messages.push({ role: 'assistant', content: replay });
        messages.push({
          role: 'user',
          content: normalized.calls.map((call) => ({
            toolResult: {
              toolUseId: call.id,
              content: [{ text: JSON.stringify(fixtureTool(call)) }],
            },
          })),
        });
      }
      return finish(
        '',
        'malformed',
        'Tool exchange exceeded max_turns without a final answer',
      );
    } catch (error: unknown) {
      return finish('', 'api_error', errorMessage(error));
    }
  }
}
