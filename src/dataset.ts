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
const rowSchema = z.strictObject({
  item: z.strictObject({
    id: z.string().regex(/^SON-[A-Z]+-\d{3}$/),
    input: z.string().trim().min(1),
    category: z.enum([
      'policy_lookup',
      'multi_hop',
      'conditional',
      'calculation',
      'tool_call',
      'clarification',
      'multi_turn',
      'robustness',
    ]),
    difficulty: z.enum(['easy', 'medium', 'hard']),
    messages: z
      .array(
        z.strictObject({
          role: z.enum(['user', 'assistant']),
          content: z.string().min(1),
        }),
      )
      .default([]),
    expected: z.strictObject({
      answer: z.string().trim().min(1),
      required_facts: z.array(z.string().trim().min(1)).min(1),
      forbidden_claims: z.array(z.string().trim().min(1)).default([]),
      tools: z.array(toolExpectation).default([]),
    }),
    retrieval: z.strictObject({
      relevant_sections: z.array(z.string().regex(/^\d+\.\d+$/)).default([]),
    }),
    tags: z.array(z.string().trim().min(1)).default([]),
  }),
});

export const developmentDatasetPath = fileURLToPath(
  new URL('../datasets/golden/development.jsonl', import.meta.url),
);
export const smokeDatasetPath = fileURLToPath(
  new URL('../datasets/smoke.jsonl', import.meta.url),
);

export function loadDataset(path = developmentDatasetPath, categories: string[] = []) {
  const text = readFileSync(path, 'utf8').trim();
  if (!text) throw new Error('Dataset is empty');
  const seen = new Set<string>();
  const cases = text.split(/\r?\n/).map((line, index) => {
    try {
      const { item } = rowSchema.parse(JSON.parse(line));
      if (seen.has(item.id)) throw new Error('Duplicate case ID: ' + item.id);
      seen.add(item.id);
      for (const section of item.retrieval.relevant_sections) {
        if (!policySectionIds.has(section))
          throw new Error('Unknown policy section: ' + section);
      }
      // Gold labels remain in Promptfoo vars and NEVER enter the model prompt.
      return {
        vars: {
          id: item.id,
          input: item.input,
          messages: item.messages,
          expected_answer: item.expected.answer,
          required_facts: item.expected.required_facts,
          forbidden_claims: item.expected.forbidden_claims,
          expected_tools: item.expected.tools,
          relevant_sections: item.retrieval.relevant_sections,
          expected_category: item.category,
        },
        metadata: {
          category: item.category,
          difficulty: item.difficulty,
          tags: item.tags,
          case_id: item.id,
        },
      };
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
