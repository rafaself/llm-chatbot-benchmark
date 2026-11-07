import { MockLanguageModelV3 } from 'ai/test';

// Exercise the same SDK/tool path as live runs, without credentials or API calls.
export function smokeModel() {
  return new MockLanguageModelV3({
    modelId: 'offline-fixture',

    doGenerate: async ({ prompt }) => {
      const user = prompt.findLast((message) => message.role === 'user');
      const input =
        user?.content
          .flatMap((part) => (part.type === 'text' ? [part.text] : []))
          .join(' ')
          .toLowerCase() ?? '';
      const last = prompt.at(-1);
      const result = last?.role === 'tool' ? JSON.stringify(last.content) : undefined;
      const order = input.match(/\ba[12]00\b/)?.[0].toUpperCase();
      let text = 'Hello! How can I help?';
      let call: { toolName: string; input: string } | undefined;
      if (result) {
        text = input.includes('weather')
          ? result.includes('sunny') && result.includes('18')
            ? 'It is sunny in Boston and 18 C.'
            : 'Weather was not found.'
          : `Order ${order} is ${result.includes('delivered') ? 'delivered' : 'in transit'}.`;
      } else if (input.includes('weather') && input.includes('boston')) {
        call = { toolName: 'get_weather', input: JSON.stringify({ city: 'Boston' }) };
      } else if (order) {
        call = { toolName: 'lookup_order', input: JSON.stringify({ order_id: order }) };
      } else if (input.includes('order')) {
        text = 'What is your order ID?';
      } else if (input.includes('guitar')) {
        text = 'A standard guitar usually has six strings.';
      } else if (input.includes('metronome')) {
        text = 'A metronome helps musicians keep a steady tempo.';
      }
      return {
        content: call
          ? [{ type: 'tool-call', toolCallId: 'smoke-call', ...call }]
          : [{ type: 'text', text }],
        finishReason: { unified: call ? 'tool-calls' : 'stop', raw: undefined },
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

// Fixture grades only verify Promptfoo wiring, never answer quality.
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
