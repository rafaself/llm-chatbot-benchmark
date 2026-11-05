import assert from 'node:assert/strict';
import test from 'node:test';
import ChatbotProvider, {
  normalizeCalls,
  fixtureTool,
} from '../integrations/chatbot.ts';
import { loadApiProvider, type ProviderResponse } from 'promptfoo';

type LoadedProvider = Awaited<ReturnType<typeof loadApiProvider>>;
type ProviderContext = NonNullable<Parameters<LoadedProvider['callApi']>[1]>;

interface NativeConverseProvider extends Pick<LoadedProvider, 'callApi'> {
  buildToolConfig(context: Record<string, unknown>): Promise<unknown>;
  buildInferenceConfig(): Record<string, unknown>;
  getBedrockInstance(): Promise<unknown>;
  parseResponse(raw: unknown): Promise<ProviderResponse>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function testContext(vars: ProviderContext['vars']): ProviderContext {
  return { prompt: { raw: 'test prompt', label: 'test' }, vars };
}

test('normalize native protocols and retain duplicate/extra calls', () => {
  const bedrock = {
    toolUse: { toolUseId: '1', name: 'get_weather', input: { city: 'Boston' } },
  };
  assert.equal(normalizeCalls([bedrock]).actual_tool, 'get_weather');
  assert.equal(
    normalizeCalls([
      { type: 'tool_use', name: 'lookup_order', id: '2', input: { order_id: 'A100' } },
    ]).actual_tool,
    'lookup_order',
  );
  assert.equal(
    normalizeCalls({
      tool_calls: [
        { function: { name: 'get_weather', arguments: '{"city":"Boston"}' } },
      ],
    }).actual_tool,
    'get_weather',
  );
  assert.equal(
    normalizeCalls([
      { type: 'function_call', name: 'get_weather', arguments: '{"city":"Boston"}' },
    ]).actual_tool,
    'get_weather',
  );
  assert.equal(
    normalizeCalls([bedrock, bedrock]).actual_tool,
    'get_weather,get_weather',
  );
  assert.equal(
    normalizeCalls([bedrock, { toolUse: { name: 'unknown', input: {} } }]).actual_tool,
    'get_weather,unknown',
  );
  assert.equal(
    normalizeCalls([{ text: 'I could call get_weather.' }]).actual_tool,
    'none',
  );
  assert.equal(normalizeCalls([]).actual_tool, 'none');
  assert.notEqual(
    normalizeCalls([{ toolUse: { name: 'none', input: {} } }]).actual_tool,
    'none',
  );
});

test('malformed calls never become no-tool success', () => {
  for (const raw of [
    'not JSON',
    [{ toolUse: {} }],
    [{ type: 'function_call', name: 'x', arguments: '{' }],
    [{ toolUse: { name: 'x', input: [] } }],
  ]) {
    assert.equal(normalizeCalls(raw).actual_tool, '__malformed__');
  }
});

test('fixture tools validate arguments and never execute arbitrary names', () => {
  assert.deepEqual(fixtureTool({ name: 'lookup_order', input: { order_id: 'A100' } }), {
    order_id: 'A100',
    status: 'delivered',
  });
  assert.equal(
    fixtureTool({ name: 'get_weather', input: {} }).error,
    'invalid_arguments',
  );
  assert.equal(fixtureTool({ name: 'constructor', input: {} }).error, 'unknown_tool');
  assert.equal(
    fixtureTool({ name: 'lookup_order', input: { order_id: 'missing' } }).error,
    'order_not_found',
  );
  assert.equal(
    fixtureTool({ name: 'lookup_order', input: { order_id: 'constructor' } }).error,
    'order_not_found',
  );
});

test('paid guard applies even with a constructed provider and credentials', async () => {
  const previous = process.env.BENCHMARK_ALLOW_PAID;
  delete process.env.BENCHMARK_ALLOW_PAID;
  const provider = new ChatbotProvider({ config: { mode: 'live' } });
  const response = await provider.callApi('[]', testContext({ input: 'test' }));
  assert.match(response.error ?? '', /Paid calls require/);
  if (previous !== undefined) process.env.BENCHMARK_ALLOW_PAID = previous;
});

test('tool exchange preserves calls, sums usage, and passes results to final answer', async () => {
  const previous = process.env.BENCHMARK_ALLOW_PAID;
  process.env.BENCHMARK_ALLOW_PAID = '1'; // Only injected fakes below; no API instance is created.
  try {
    let calls = 0;
    const prompts: unknown[] = [];
    const provider = new ChatbotProvider({
      config: { mode: 'live', provider: { id: 'fake' }, max_turns: 3 },
    });
    provider.native = Promise.resolve({
      callApi: async (
        prompt: string,
        context?: ProviderContext,
      ): Promise<ProviderResponse> => {
        assert.deepEqual(context?.vars, { input: 'Check order A100' });
        assert.equal(context?.test, undefined);
        prompts.push(JSON.parse(prompt) as unknown);
        calls++;
        const content =
          calls === 1
            ? [
                {
                  toolUse: {
                    toolUseId: 'call1',
                    name: 'lookup_order',
                    input: { order_id: 'A100' },
                  },
                },
              ]
            : [{ text: 'Order A100 is delivered.' }];
        return {
          output: '',
          tokenUsage: { prompt: 10, completion: 5, total: 15, numRequests: 1 },
          cost: 0.01,
          metadata: {
            raw_response: {
              output: { message: { role: 'assistant', content } },
              stopReason: calls === 1 ? 'tool_use' : 'end_turn',
            },
          },
        };
      },
    });
    const result = await provider.callApi(
      '[{"role":"user","content":"Check order A100"}]',
      {
        prompt: { raw: 'Check order A100', label: 'test' },
        vars: { input: 'Check order A100', expected_answer: 'secret reference' },
        test: { vars: { expected_tool: 'lookup_order' } },
      },
    );
    assert.equal(calls, 2);
    const output = isRecord(result.output) ? result.output : undefined;
    assert.ok(output);
    assert.equal(output.answer, 'Order A100 is delivered.');
    assert.equal(output.actual_tool, 'lookup_order');
    const rawToolCalls = asArray(output.raw_tool_calls);
    assert.equal(rawToolCalls?.length, 1);
    assert.equal(result.tokenUsage?.total, 30);
    assert.equal(result.cost, 0.02);
    const secondPrompt = asArray(prompts[1]);
    assert.ok(secondPrompt);
    const lastPromptMessage = secondPrompt.at(-1);
    const resultMessage = isRecord(lastPromptMessage) ? lastPromptMessage : undefined;
    assert.ok(resultMessage);
    const resultBlocks = asArray(resultMessage.content);
    assert.ok(resultBlocks);
    const resultBlock = isRecord(resultBlocks[0]) ? resultBlocks[0] : undefined;
    assert.ok(resultBlock);
    const toolResult = isRecord(resultBlock.toolResult)
      ? resultBlock.toolResult
      : undefined;
    assert.ok(toolResult);
    const resultContent = asArray(toolResult.content);
    assert.ok(resultContent);
    const resultText = isRecord(resultContent[0]) ? resultContent[0].text : undefined;
    if (typeof resultText !== 'string') throw new Error('Tool result text is missing');
    assert.match(resultText, /delivered/);
    const serializedPrompts = JSON.stringify(prompts);
    assert.ok(serializedPrompts);
    assert.doesNotMatch(serializedPrompts, /secret reference/);
  } finally {
    if (previous === undefined) delete process.env.BENCHMARK_ALLOW_PAID;
    else process.env.BENCHMARK_ALLOW_PAID = previous;
  }
});

test('pinned native Converse accepts shared tools and exposes raw parsing hooks offline', async () => {
  // Promptfoo 0.125.1's Converse methods are private and checked at runtime here.
  const native = (await loadApiProvider('bedrock:converse:us.amazon.nova-micro-v1:0', {
    options: {
      config: {
        region: 'us-east-1',
        maxTokens: 64,
        temperature: 0,
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_weather',
              parameters: {
                type: 'object',
                properties: { city: { type: 'string' } },
              },
            },
          },
        ],
      },
    },
  })) as unknown as NativeConverseProvider;
  const tools = await native.buildToolConfig({});
  const toolConfig = isRecord(tools) ? asArray(tools.tools) : undefined;
  assert.ok(toolConfig);
  const tool = isRecord(toolConfig[0]) ? toolConfig[0] : undefined;
  assert.ok(tool);
  const toolSpec = isRecord(tool.toolSpec) ? tool.toolSpec : undefined;
  assert.ok(toolSpec);
  assert.equal(toolSpec.name, 'get_weather');
  assert.equal(native.buildInferenceConfig().maxTokens, 64);
  assert.equal(typeof native.getBedrockInstance, 'function');
  const parsed = await native.parseResponse({
    output: {
      message: {
        content: [
          {
            toolUse: { toolUseId: '1', name: 'get_weather', input: { city: 'Boston' } },
          },
        ],
      },
    },
    usage: { inputTokens: 10, outputTokens: 3, totalTokens: 13 },
    stopReason: 'tool_use',
  });
  assert.equal(normalizeCalls(parsed.output as unknown).actual_tool, 'get_weather');
  assert.equal(parsed.tokenUsage?.total, 13);
});
