import assert from 'node:assert/strict';
import test from 'node:test';
import {
  conversationPropagationFailures,
  scoreSessions,
  type SessionTurnResult,
} from '../src/runner/sessions.ts';

function turn(
  conversationId: string,
  turnIndex: number,
  turnCount: number,
  success: boolean,
  answer = 'Confirmed order SON-1042.',
): SessionTurnResult {
  return {
    success,
    metadata: { conversationId, turnIndex, turnCount },
    response: { conversationOutput: answer, output: { answer } },
    prompt: {
      raw:
        turnIndex === 1
          ? '{"role":"user","content":"My order ID is SON-1042."}'
          : '{"role":"assistant","content":' + JSON.stringify(answer) + '}',
    },
    gradingResult: { componentResults: [{}, {}, {}, {}, {}] },
  };
}

test('session success requires every independent turn to pass', () => {
  const passing = scoreSessions([
    turn('SON-CTX-001', 1, 3, true, 'Confirmed order SON-1042.'),
    turn('SON-CTX-001', 2, 3, true, 'Order SON-1042 is processing.'),
    turn('SON-CTX-001', 3, 3, true, 'Held for 7 consecutive days.'),
    turn('SON-POL-001', 1, 1, true, 'Monday through Friday.'),
  ]);
  assert.equal(passing[0]?.success, true);
  assert.equal(passing[0]?.turns.length, 3);
  assert.equal(passing[1]?.success, true);

  const failedTurn = scoreSessions([
    turn('SON-CTX-001', 1, 3, true),
    turn('SON-CTX-001', 2, 3, false),
    turn('SON-CTX-001', 3, 3, true),
  ]);
  assert.equal(failedTurn[0]?.success, false);
  assert.equal(failedTurn[0]?.turns[1]?.success, false);

  const missing = scoreSessions([
    turn('SON-CTX-001', 1, 3, true),
    turn('SON-CTX-001', 3, 3, true),
  ]);
  assert.equal(missing[0]?.success, false);
  assert.match(missing[0]?.reason ?? '', /missing a graded turn/);
});

test('later turns must contain the previous model answer', () => {
  const rows = [
    turn('SON-CTX-001', 1, 2, true, 'Confirmed order SON-1042.'),
    turn('SON-CTX-001', 2, 2, true, 'Order SON-1042 is processing.'),
  ];
  rows[1] = {
    ...rows[1],
    prompt: { raw: '{"role":"assistant","content":"Confirmed order SON-1042."}' },
  };
  assert.deepEqual(conversationPropagationFailures(rows), []);
  rows[1] = {
    ...rows[1],
    prompt: { raw: '{"role":"user","content":"What is its current status?"}' },
  };
  assert.equal(conversationPropagationFailures(rows).length, 1);
});
