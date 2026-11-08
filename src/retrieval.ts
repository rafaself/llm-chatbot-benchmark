import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const policyPath = fileURLToPath(
  new URL('../datasets/sonora_store_policy.md', import.meta.url),
);

export interface PolicyDocument {
  id: string;
  title: string;
  content: string;
  score: number;
}

// A fixed, dependency-free lexical baseline. The index is identical for every target model.
const stopWords = new Set(
  'a an and are as at be by can do does for from how i if in into is it me my of on or our the their there these this to what when where which who why will with you your have has was were would should could about after before under than that'.split(
    ' ',
  ),
);
const tokens = (value: string) =>
  (value.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (word) => !stopWords.has(word),
  );

export function splitPolicy(text: string) {
  const sections: Array<{ id: string; title: string; content: string }> = [];
  let current: { id: string; title: string; content: string } | undefined;
  for (const line of text.split(/\r?\n/)) {
    const heading = /^###\s+(\d+\.\d+)\.\s+(.+)$/.exec(line);
    if (heading?.[1] && heading[2]) {
      if (current) sections.push(current);
      current = { id: heading[1], title: heading[2], content: line + '\n' };
    } else if (current && !/^##\s/.test(line)) {
      current.content += line + '\n';
    } else if (current && /^##\s/.test(line)) {
      sections.push(current);
      current = undefined;
    }
  }
  if (current) sections.push(current);
  return sections;
}

const sections = splitPolicy(readFileSync(policyPath, 'utf8'));
const postings = sections.map((section) => {
  const terms = tokens(section.title.repeat(3) + ' ' + section.content);
  const frequencies = new Map<string, number>();
  for (const term of terms) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
  return { ...section, frequencies, length: terms.length };
});
const avgLength = postings.reduce((sum, doc) => sum + doc.length, 0) / postings.length;
const documentFrequency = new Map<string, number>();
for (const doc of postings) {
  for (const term of doc.frequencies.keys()) {
    documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
  }
}
export const policySectionIds = new Set(sections.map((s) => s.id));

export function searchPolicy(query: string, limit = 10): PolicyDocument[] {
  const terms = [...new Set(tokens(query))];
  if (terms.length === 0) return [];
  return postings
    .map((doc) => {
      let score = 0;
      for (const term of terms) {
        const tf = doc.frequencies.get(term) ?? 0;
        if (!tf) continue;
        const df = documentFrequency.get(term) ?? 0;
        const idf = Math.log(1 + (postings.length - df + 0.5) / (df + 0.5));
        score +=
          (idf * (tf * 2.2)) / (tf + 1.2 * (0.25 + (0.75 * doc.length) / avgLength));
      }
      return { id: doc.id, title: doc.title, content: doc.content.trim(), score };
    })
    .filter((doc) => doc.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit);
}
