import { MockLanguageModelV3 } from 'ai/test';

// Plumbing-only fixture; never interpret its judge results as model quality.
export function smokeModel() {
  return new MockLanguageModelV3({
    modelId: 'offline-fixture',
    doGenerate: async ({ prompt }) => {
      const user = prompt.findLast((message) => message.role === 'user');
      const input = user?.content.flatMap((part) => part.type === 'text' ? [part.text] : []).join(' ').toLowerCase() ?? '';
      const last = prompt.at(-1);
      let text = 'Hello! How can I help?';
      let call: { toolName: string; input: string } | undefined;
      if (last?.role === 'tool') {
        text = 'I checked the relevant Sonora source and can share its recorded result.';
      } else if (input.includes('son-1044')) {
        call = { toolName: 'lookup_order', input: JSON.stringify({ order_id: 'SON-1044' }) };
      } else if (input.includes('free shipping')) {
        call = { toolName: 'search_policy', input: JSON.stringify({ query: 'free economy shipping threshold 599' }) };
      }
      return {
        content: call ? [{ type: 'tool-call', toolCallId: 'smoke-call', ...call }] : [{ type: 'text', text }],
        finishReason: { unified: call ? 'tool-calls' : 'stop', raw: undefined },
        usage: {
          inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: undefined, text: undefined, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });
}
export default class SmokeJudge {
  id() { return 'offline-fixture-judge'; }
  async callApi() {
    return {
      output: JSON.stringify({ pass: true, score: 1, reason: 'OFFLINE fixture judge: wiring only; no quality evidence.' }),
      metadata: { evidence: 'fixture' },
    };
  }
}
