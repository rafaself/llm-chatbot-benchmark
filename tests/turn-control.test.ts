import assert from 'node:assert/strict';
import test from 'node:test';
import { needsAnswerRecovery } from '../src/chatbot.ts';
import {
  missingIdentifierReply,
  missingRequiredIdentifier,
  resolveTurn,
} from '../src/tools.ts';

test('identifier validation rejects blank lookups and accepts real ones', () => {
  assert.equal(missingRequiredIdentifier('lookup_order', { order_id: '' }), true);
  assert.equal(
    missingRequiredIdentifier('lookup_order', { order_id: 'SON-1044' }),
    false,
  );
  assert.equal(missingRequiredIdentifier('lookup_product', { sku: '  ' }), true);
  assert.equal(
    missingRequiredIdentifier('lookup_product', { sku: 'SON-AUD-014' }),
    false,
  );
  assert.equal(missingRequiredIdentifier('search_policy', { query: ' x' }), true);
});

test('a rejected missing identifier can finish as a clarification', () => {
  const recovered = resolveTurn({
    text: 'Please share your order ID.',
    finishReason: 'stop',
    calls: [{ name: 'lookup_order', args: { order_id: '' }, invalid: true }],
  });
  assert.equal(recovered.error, undefined);
  assert.equal(recovered.text, 'Please share your order ID.');

  const unanswered = resolveTurn({
    text: '',
    finishReason: 'tool-calls',
    calls: [{ name: 'lookup_order', args: { order_id: '' }, invalid: true }],
  });
  assert.equal(unanswered.error, undefined);
  assert.equal(unanswered.text, missingIdentifierReply);
});

test('a finished tool call without an answer stays unfinished', () => {
  const stalled = resolveTurn({
    text: '',
    finishReason: 'tool-calls',
    calls: [{ name: 'search_policy', args: { query: 'returns' }, invalid: false }],
  });
  assert.match(stalled.error ?? '', /tool-calls/);
});

test('an unfinished tool loop needs a separate answer call', () => {
  assert.equal(
    needsAnswerRecovery({ text: '', finishReason: 'tool-calls', hasEvidence: true }),
    true,
  );
  assert.equal(
    needsAnswerRecovery({
      text: 'The order is processing.',
      finishReason: 'stop',
      hasEvidence: true,
    }),
    false,
  );
  assert.equal(
    needsAnswerRecovery({ text: '', finishReason: 'stop', hasEvidence: false }),
    false,
  );
});
