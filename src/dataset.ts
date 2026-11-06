import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const rowSchema = z.strictObject({
  item: z.strictObject({
    input: z.string().regex(/\S/, 'Must not be blank'),
    expected_answer: z.string().regex(/\S/, 'Must not be blank'),
    expected_tool: z.enum(['none', 'get_weather', 'lookup_order']),
    expected_category: z.enum(['factual', 'tool_call', 'no_tool', 'ambiguous']),
  }),
});
export const sampleDataset = fileURLToPath(
  new URL('../datasets/sample.jsonl', import.meta.url),
);

// Keep the existing JSONL contract; Zod handles the schema validation.
export function loadDataset(path = sampleDataset, categories: string[] = []) {
  const text = readFileSync(path, 'utf8').trimEnd();
  if (!text) throw new Error('Dataset is empty');
  const seen = new Set<string>();
  const tests = text.split('\n').map((line, index) => {
    try {
      const { item } = rowSchema.parse(JSON.parse(line));
      if (seen.has(item.input)) throw new Error('Duplicate input');
      seen.add(item.input);
      return { vars: item, metadata: { category: item.expected_category } };
    } catch (error) {
      throw new Error(
        `Dataset line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  });
  for (const category of categories) {
    if (!tests.some((test) => test.vars.expected_category === category)) {
      throw new Error(`Category not present in dataset: ${category}`);
    }
  }
  return tests.filter(
    (test) => !categories.length || categories.includes(test.vars.expected_category),
  );
}
export default function createTests() {
  return loadDataset();
}
