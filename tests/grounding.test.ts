import assert from 'node:assert/strict';
import test from 'node:test';
import ChatbotProvider from '../src/chatbot.ts';

test('grounding keeps this turn separate and includes earlier tool evidence', async () => {
  const provider = new ChatbotProvider({ config: { mode: 'smoke' } });
  const response = await provider.callApi(
    JSON.stringify([
      { role: 'system', content: 'You are Sonora support.' },
      { role: 'user', content: 'What is the current status of order SON-1042?' },
      { role: 'assistant', content: 'Order SON-1042 is processing.' },
      {
        role: 'user',
        content: 'Please repeat the order ID and the status you just reported.',
      },
    ]),
    {
      vars: {
        _conversation: [
          {
            metadata: {
              searches: [],
              observations: [
                {
                  tool: 'lookup_order',
                  result: { order_id: 'SON-1042', status: 'processing' },
                },
              ],
            },
          },
        ],
      },
    },
  );
  assert.equal(response.error, undefined);
  const output = response.output as {
    tool_calls: unknown[];
    grounding_payload: string;
  };
  assert.deepEqual(output.tool_calls, []);
  const grounding = JSON.parse(output.grounding_payload) as {
    operational_evidence: unknown[];
    prior_operational_evidence: Array<{ tool: string; result: { status: string } }>;
  };
  assert.deepEqual(grounding.operational_evidence, []);
  assert.equal(grounding.prior_operational_evidence[0]?.result.status, 'processing');
});
