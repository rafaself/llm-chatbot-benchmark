import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { policySectionIds } from './retrieval.ts';

const toolExpectation = z.strictObject({
  name: z.enum(['search_policy', 'lookup_order', 'lookup_product']),
  arguments: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .optional(),
});
const turnSchema = z.strictObject({
  id: z.string().regex(/^SON-[A-Z]+-\d{3}-T\d{2}$/),
  input: z.string().trim().min(1),
  expected: z.strictObject({
    answer: z.string().trim().min(1),
    required_facts: z.array(z.string().trim().min(1)).min(1),
    forbidden_claims: z.array(z.string().trim().min(1)).default([]),
    tools: z.array(toolExpectation).default([]),
  }),
  retrieval: z.strictObject({
    relevant_sections: z.array(z.string().regex(/^\d+\.\d+$/)).default([]),
  }),
});
const rowSchema = z.strictObject({
  item: z.strictObject({
    id: z.string().regex(/^SON-[A-Z]+-\d{3}$/),
    category: z.enum([
      'policy_accuracy',
      'cross_source_accuracy',
      'calculation_accuracy',
      'operational_accuracy',
      'clarification_quality',
      'conversation_context',
      'robustness',
    ]),
    capabilities: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)).min(1),
    difficulty: z.enum(['easy', 'medium', 'hard']),
    turns: z.array(turnSchema).min(1),
    tags: z.array(z.string().trim().min(1)).default([]),
  }),
});

export const developmentDatasetPath = fileURLToPath(
  new URL('../datasets/golden/development.jsonl', import.meta.url),
);
export const heldoutDatasetPath = fileURLToPath(
  new URL('../datasets/golden/heldout.jsonl', import.meta.url),
);
export const smokeDatasetPath = fileURLToPath(
  new URL('../datasets/smoke.jsonl', import.meta.url),
);
export const contextSessionPath = fileURLToPath(
  new URL('../datasets/context-session.jsonl', import.meta.url),
);

export interface EvalTurn {
  vars: {
    id: string;
    session_id: string;
    turn_index: number;
    turn_count: number;
    input: string;
    expected_answer: string;
    required_facts: string[];
    forbidden_claims: string[];
    expected_tools: Array<{
      name: string;
      arguments?: Record<string, string | number | boolean> | undefined;
    }>;
    relevant_sections: string[];
    expected_category: string;
  };
  metadata: {
    conversationId: string;
    turnIndex: number;
    turnCount: number;
    category: string;
    capabilities: string[];
    difficulty: string;
    tags: string[];
    case_id: string;
    session_id: string;
  };
}

export function loadDataset(path = developmentDatasetPath, categories: string[] = []) {
  const text = readFileSync(path, 'utf8').trim();
  if (!text) throw new Error('Dataset is empty');
  const seenSessions = new Set<string>();
  const seenTurns = new Set<string>();
  const cases: EvalTurn[] = text.split(/\r?\n/).flatMap((line, index) => {
    try {
      const { item } = rowSchema.parse(JSON.parse(line));
      if (seenSessions.has(item.id))
        throw new Error('Duplicate session ID: ' + item.id);
      seenSessions.add(item.id);
      const turnIds = item.turns.map((turn) => turn.id);
      if (new Set(turnIds).size !== turnIds.length)
        throw new Error('Duplicate turn ID in session: ' + item.id);
      return item.turns.map((turn, turnIndex) => {
        if (seenTurns.has(turn.id)) throw new Error('Duplicate turn ID: ' + turn.id);
        if (turn.id !== item.id + '-T' + String(turnIndex + 1).padStart(2, '0')) {
          throw new Error('Turn ID must be sequential for its session: ' + turn.id);
        }
        seenTurns.add(turn.id);
        for (const section of turn.retrieval.relevant_sections) {
          if (!policySectionIds.has(section))
            throw new Error('Unknown policy section: ' + section);
        }
        // Gold labels remain in Promptfoo vars and NEVER enter the model prompt.
        return {
          vars: {
            id: turn.id,
            session_id: item.id,
            turn_index: turnIndex + 1,
            turn_count: item.turns.length,
            input: turn.input,
            expected_answer: turn.expected.answer,
            required_facts: turn.expected.required_facts,
            forbidden_claims: turn.expected.forbidden_claims,
            expected_tools: turn.expected.tools,
            relevant_sections: turn.retrieval.relevant_sections,
            expected_category: item.category,
          },
          metadata: {
            conversationId: item.id,
            turnIndex: turnIndex + 1,
            turnCount: item.turns.length,
            category: item.category,
            capabilities: item.capabilities,
            difficulty: item.difficulty,
            tags: item.tags,
            case_id: turn.id,
            session_id: item.id,
          },
        };
      });
    } catch (error) {
      throw new Error(
        'Dataset line ' +
          (index + 1) +
          ': ' +
          (error instanceof Error ? error.message : String(error)),
        { cause: error },
      );
    }
  });
  for (const category of categories) {
    if (!cases.some((c) => c.vars.expected_category === category)) {
      throw new Error('Category not present in dataset: ' + category);
    }
  }
  return cases.filter(
    (c) => !categories.length || categories.includes(c.vars.expected_category),
  );
}

export default function createTests() {
  return loadDataset();
}
