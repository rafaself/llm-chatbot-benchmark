export interface SessionTurnResult {
  success?: boolean;
  error?: string | null;
  prompt?: { raw?: string };
  response?: {
    error?: string;
    conversationOutput?: unknown;
    output?: unknown;
  };
  metadata?: {
    conversationId?: string;
    turnIndex?: number;
    turnCount?: number;
  };
  gradingResult?: { componentResults?: unknown[] };
}

export interface SessionScore {
  conversationId: string;
  turnCount: number;
  success: boolean;
  reason: string;
  turns: Array<{ turnIndex: number; success: boolean; error?: string | undefined }>;
}

function turnError(turn: SessionTurnResult) {
  return turn.error || turn.response?.error || undefined;
}

export function assistantText(turn: SessionTurnResult) {
  const output = turn.response?.conversationOutput;
  if (typeof output === 'string' && output.trim()) return output;
  const answer = turn.response?.output;
  if (answer && typeof answer === 'object' && 'answer' in answer) {
    const value = answer.answer;
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
}

export function scoreSessions(rows: SessionTurnResult[]): SessionScore[] {
  const groups = new Map<string, SessionTurnResult[]>();
  for (const row of rows) {
    const conversationId = row.metadata?.conversationId;
    if (!conversationId)
      throw new Error('Graded turn is missing metadata.conversationId');
    const turns = groups.get(conversationId) ?? [];
    turns.push(row);
    groups.set(conversationId, turns);
  }
  return [...groups.entries()].map(([conversationId, turns]) => {
    const declared = [
      ...new Set(
        turns.flatMap((turn) => {
          const count = turn.metadata?.turnCount;
          return typeof count === 'number' ? [count] : [];
        }),
      ),
    ];
    const turnCount = declared.length === 1 ? declared[0] : undefined;
    const sorted = [...turns].sort(
      (left, right) =>
        (left.metadata?.turnIndex ?? 0) - (right.metadata?.turnIndex ?? 0),
    );
    const indexes = sorted.map((turn) => turn.metadata?.turnIndex);
    const expectedIndexes = turnCount
      ? Array.from({ length: turnCount }, (_, index) => index + 1)
      : [];
    const complete =
      turnCount !== undefined &&
      indexes.length === turnCount &&
      indexes.every((index, position) => index === expectedIndexes[position]);
    const graded = sorted.map((turn) => ({
      turnIndex: turn.metadata?.turnIndex ?? 0,
      success: turn.success === true && !turnError(turn),
      ...(turnError(turn) ? { error: turnError(turn) } : {}),
    }));
    const success = complete && graded.every((turn) => turn.success);
    const reason = !complete
      ? 'Session is missing a graded turn or has duplicate turn indexes.'
      : success
        ? 'Every turn passed independently.'
        : 'One or more turns failed.';
    return {
      conversationId,
      turnCount: turnCount ?? sorted.length,
      success: Boolean(success),
      reason,
      turns: graded,
    };
  });
}

export function conversationPropagationFailures(rows: SessionTurnResult[]) {
  const failures: string[] = [];
  const groups = new Map<string, SessionTurnResult[]>();
  for (const row of rows) {
    const conversationId = row.metadata?.conversationId;
    if (!conversationId) continue;
    const turns = groups.get(conversationId) ?? [];
    turns.push(row);
    groups.set(conversationId, turns);
  }
  for (const [conversationId, turns] of groups) {
    const sorted = [...turns].sort(
      (left, right) =>
        (left.metadata?.turnIndex ?? 0) - (right.metadata?.turnIndex ?? 0),
    );
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = assistantText(sorted[index - 1] ?? {});
      const escaped = previous ? JSON.stringify(previous).slice(1, -1) : '';
      const prompt = sorted[index]?.prompt?.raw ?? '';
      if (!previous || !prompt.includes(escaped)) {
        failures.push(
          conversationId +
            ' turn ' +
            String(sorted[index]?.metadata?.turnIndex) +
            ' does not contain the previous model answer',
        );
      }
    }
  }
  return failures;
}

export function readEvalRows(parsed: unknown): SessionTurnResult[] {
  if (!parsed || typeof parsed !== 'object' || !('results' in parsed)) {
    throw new Error('Promptfoo result is missing results');
  }
  const results = parsed.results;
  if (!results || typeof results !== 'object' || !('results' in results)) {
    throw new Error('Promptfoo result is missing results.results');
  }
  if (!Array.isArray(results.results))
    throw new Error('Promptfoo results are not a list');
  return results.results as SessionTurnResult[];
}
