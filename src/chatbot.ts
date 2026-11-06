import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { generateText, modelMessageSchema, stepCountIs } from 'ai';
import type { ProviderResponse } from 'promptfoo';
import { z } from 'zod';
import { smokeModel } from './smoke.ts';
import { tools } from './tools.ts';

export interface ChatbotConfig {
  mode?: 'smoke' | 'live';
  model?: string;
  region?: string;
  temperature?: number;
  providerOptions?: Parameters<typeof generateText>[0]['providerOptions'];
  maxTokens?: number;
  maxTurns?: number;
  retries?: number;
  timeoutMs?: number;
}

// Thin Promptfoo adapter: AI SDK owns provider protocols and tool round trips.
export default class ChatbotProvider {
  config: ChatbotConfig;
  constructor({ config = {} }: { config?: ChatbotConfig }) {
    this.config = config;
  }
  id() {
    return this.config.model ?? 'offline-fixture';
  }

  async callApi(prompt: string): Promise<ProviderResponse> {
    const config = this.config;
    const offline = config.mode === 'smoke';
    if (!offline && process.env.BENCHMARK_ALLOW_PAID !== '1') {
      return { error: 'Paid calls require --live --allow-paid' };
    }
    try {
      if (!offline && !config.model) throw new Error('Missing model ID');
      const model = offline
        ? smokeModel()
        : createAmazonBedrock({
            region: config.region ?? 'us-east-1',
            credentialProvider: fromNodeProviderChain(),
          })(config.model ?? '');
      const conversation = z.array(modelMessageSchema).parse(JSON.parse(prompt));
      const result = await generateText({
        model,
        // Only the rendered conversation is passed; no expected answers or tools.
        system: conversation
          .filter((message) => message.role === 'system')
          .map((message) => message.content)
          .join('\n'),
        messages: conversation.filter((message) => message.role !== 'system'),
        tools,
        stopWhen: stepCountIs(config.maxTurns ?? 3),
        maxOutputTokens: config.maxTokens ?? 1024,
        maxRetries: config.retries ?? 0,
        timeout: { stepMs: config.timeoutMs ?? 60000 },
        ...(config.temperature === undefined
          ? {}
          : { temperature: config.temperature }),
        ...(config.providerOptions === undefined
          ? {}
          : { providerOptions: config.providerOptions }),
      });
      const calls = result.steps.flatMap((step) => step.toolCalls);
      const invalid =
        calls.some((call) => call.invalid) ||
        result.steps.some((step) =>
          step.content.some((part) => part.type === 'tool-error'),
        ) ||
        !result.text.trim() ||
        result.finishReason !== 'stop';
      const names =
        calls
          .map((call) => call.toolName)
          .sort()
          .join(',') || 'none';
      return {
        output: {
          answer: result.text,
          actual_tool: invalid ? '__malformed__' : names,
          tool_status: invalid ? 'malformed' : 'supported',
          raw_tool_calls: calls,
        },
        ...(!offline
          ? {
              tokenUsage: {
                ...(result.totalUsage.inputTokens === undefined
                  ? {}
                  : { prompt: result.totalUsage.inputTokens }),
                ...(result.totalUsage.outputTokens === undefined
                  ? {}
                  : { completion: result.totalUsage.outputTokens }),
                ...(result.totalUsage.totalTokens === undefined
                  ? {}
                  : { total: result.totalUsage.totalTokens }),
                numRequests: result.steps.length,
              },
            }
          : {}),
        metadata: {
          evidence: offline ? 'fixture' : 'live',
          model_id: model.modelId,
          finish_reason: result.finishReason,
          steps: result.steps.map(
            ({ text, toolCalls, toolResults, usage, finishReason, warnings }) => ({
              text,
              toolCalls,
              toolResults,
              usage,
              finishReason,
              warnings,
            }),
          ),
        },
        ...(invalid
          ? { error: `Invalid or unfinished response (${result.finishReason})` }
          : {}),
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }
}
