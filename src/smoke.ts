import { MockLanguageModelV3 } from 'ai/test';

// Plumbing-only fixture; never interpret its judge results as model quality.
function messageText(message: { content?: unknown } | undefined) {
  const content = message?.content;
  if (typeof content === 'string') return content.toLowerCase();
  if (!Array.isArray(content)) return '';
  return content
    .flatMap((part) => {
      if (!part || typeof part !== 'object') return [];
      const record = part as { type?: string; text?: string };
      return record.type === 'text' && record.text ? [record.text] : [];
    })
    .join(' ')
    .toLowerCase();
}

export function smokeModel() {
  return new MockLanguageModelV3({
    modelId: 'offline-fixture',
    doGenerate: async ({ prompt }) => {
      const user = prompt.findLast((message) => message.role === 'user');
      const input = messageText(user);
      const history = prompt
        .filter((message) => message.role === 'user' || message.role === 'assistant')
        .map((message) => messageText(message))
        .join('\n');
      const last = prompt.at(-1);
      let text = 'Hello! How can I help?';
      let call: { toolName: string; input: string } | undefined;
      if (last?.role === 'tool') {
        if (history.includes('ready for pickup notice')) {
          text =
            'Order SON-1042 is processing. Sonora holds a paid order for 7 consecutive days after the Ready for pickup notice, and the amount paid is not automatically forfeited.';
        } else if (history.includes('son-1042')) {
          text = 'Order SON-1042 is processing.';
        } else {
          text =
            'I checked the relevant Sonora source and can share its recorded result.';
        }
      } else if (input.includes('son-1044')) {
        call = {
          toolName: 'lookup_order',
          input: JSON.stringify({ order_id: 'SON-1044' }),
        };
      } else if (input.includes('free shipping')) {
        call = {
          toolName: 'search_policy',
          input: JSON.stringify({ query: 'free economy shipping threshold 599' }),
        };
      } else if (
        input.includes('ready for pickup notice') &&
        history.includes('processing')
      ) {
        call = {
          toolName: 'search_policy',
          input: JSON.stringify({
            query: 'Ready for pickup notice 7 consecutive days',
          }),
        };
      } else if (input.includes('repeat the order') && history.includes('processing')) {
        text = 'Order SON-1042 is processing.';
      } else if (input.includes('son-1042')) {
        call = {
          toolName: 'lookup_order',
          input: JSON.stringify({ order_id: 'SON-1042' }),
        };
      }
      return {
        content: call
          ? [{ type: 'tool-call' as const, toolCallId: 'smoke-call', ...call }]
          : [{ type: 'text' as const, text }],
        finishReason: {
          unified: call ? ('tool-calls' as const) : ('stop' as const),
          raw: undefined,
        },
        usage: {
          inputTokens: {
            total: undefined,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: { total: undefined, text: undefined, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });
}
export default class SmokeJudge {
  id() {
    return 'offline-fixture-judge';
  }
  async callApi() {
    return {
      output: JSON.stringify({
        pass: true,
        score: 1,
        reason: 'OFFLINE fixture judge: wiring only; no quality evidence.',
      }),
      metadata: { evidence: 'fixture' },
    };
  }
}
