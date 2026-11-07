import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { generateText, modelMessageSchema, stepCountIs } from 'ai';
import type { ProviderResponse } from 'promptfoo';
import { z } from 'zod';
import { smokeModel } from './smoke.ts';
import { createTools, createTrace } from './tools.ts';

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
export default class ChatbotProvider {
  config: ChatbotConfig;
  constructor({ config = {} }: { config?: ChatbotConfig }) { this.config = config; }
  id() { return this.config.model ?? 'offline-fixture'; }

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
      const trace = createTrace();
      const started = performance.now();
      const result = await generateText({
        model,
        system: conversation.filter((message) => message.role === 'system').map((message) => message.content).join('\n'),
        messages: conversation.filter((message) => message.role !== 'system'),
        tools: createTools(trace),
        stopWhen: stepCountIs(config.maxTurns ?? 3),
        maxOutputTokens: config.maxTokens ?? 1024,
        maxRetries: config.retries ?? 0,
        timeout: { stepMs: config.timeoutMs ?? 60000 },
        ...(config.temperature === undefined ? {} : { temperature: config.temperature }),
        ...(config.providerOptions === undefined ? {} : { providerOptions: config.providerOptions }),
      });
      const calls = result.steps.flatMap((step) => step.toolCalls);
      const invalid =
        calls.some((call) => call.invalid) ||
        result.steps.some((step) => step.content.some((part) => part.type === 'tool-error')) ||
        !result.text.trim() ||
        result.finishReason !== 'stop';
      const toolCalls = calls.map((call) => ({ name: call.toolName, args: call.input }));
      const documents = trace.searches.flatMap((search) => search.documents);
      const uniqueDocuments = [...new Map(documents.map((doc) => [doc.id, doc])).values()];
      const retrievedSections = uniqueDocuments.map((doc) => doc.id);
      const groundingPayload = JSON.stringify({
        answer: result.text,
        policy_evidence: uniqueDocuments.map(({ id, title, content }) => ({ id, title, content })),
        operational_evidence: trace.observations,
      });
      return {
        output: {
          answer: result.text,
          tool_calls: toolCalls,
          actual_tool: invalid ? '__malformed__' : [...new Set(calls.map((call) => call.toolName))].sort().join(',') || 'none',
          retrieved_sections: retrievedSections,
          retrieved_documents: uniqueDocuments,
          grounding_payload: groundingPayload,
        },
        ...(!offline ? {
          tokenUsage: {
            ...(result.totalUsage.inputTokens === undefined ? {} : { prompt: result.totalUsage.inputTokens }),
            ...(result.totalUsage.outputTokens === undefined ? {} : { completion: result.totalUsage.outputTokens }),
            ...(result.totalUsage.totalTokens === undefined ? {} : { total: result.totalUsage.totalTokens }),
            numRequests: result.steps.length,
          },
        } : {}),
        metadata: {
          evidence: offline ? 'fixture' : 'live',
          model_id: model.modelId,
          finish_reason: result.finishReason,
          latency_ms: Math.round(performance.now() - started),
          searches: trace.searches,
          observations: trace.observations,
          steps: result.steps.map(({ text, toolCalls, toolResults, usage, finishReason, warnings }) => ({
            text, toolCalls, toolResults, usage, finishReason, warnings,
          })),
        },
        ...(invalid ? { error: 'Invalid or unfinished response (' + result.finishReason + ')' } : {}),
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }
}
