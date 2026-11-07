import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parseOptions } from '../../src/runner/cli.ts';
import { prepareConfig } from '../../src/runner/config.ts';
import { executeRun } from '../../src/runner/execute.ts';
import { createMetadata } from '../../src/runner/metadata.ts';
import {
  conversationPropagationFailures,
  readEvalRows,
} from '../../src/runner/sessions.ts';
import { contextSessionPath } from '../../src/dataset.ts';

test(
  'offline conversation propagates model answers and scores each turn',
  { timeout: 180_000 },
  () => {
    const directory = mkdtempSync(join(tmpdir(), 'benchmark-conversation-'));
    try {
      const parsed = parseOptions(
        [
          '--smoke',
          '--dataset',
          contextSessionPath,
          '--output',
          join(directory, 'run'),
        ],
        {},
      );
      const prepared = prepareConfig(parsed);
      assert.equal(prepared.tests.length, 3);
      assert.equal(prepared.plannedRequests, 18);
      assert.equal(executeRun(parsed, prepared, createMetadata(parsed, prepared)), 0);
      const output = join(directory, 'run');
      const rows = readEvalRows(
        JSON.parse(readFileSync(join(output, 'result.json'), 'utf8')),
      );
      assert.equal(rows.length, 3);
      assert.deepEqual(
        rows.map((row) => row.metadata?.turnIndex),
        [1, 2, 3],
      );
      for (const row of rows) {
        assert.equal(row.metadata?.conversationId, 'SON-CTX-001');
        assert.equal(row.success, true);
        assert.equal(row.gradingResult?.componentResults?.length, 5);
      }
      assert.deepEqual(conversationPropagationFailures(rows), []);
      assert.equal(
        JSON.parse(readFileSync(join(output, 'sessions.json'), 'utf8')).success,
        true,
      );
      const secondPrompt = rows[1]?.prompt?.raw ?? '';
      const thirdPrompt = rows[2]?.prompt?.raw ?? '';
      assert.match(secondPrompt, /Confirmed order SON-1042\./);
      assert.match(thirdPrompt, /Order SON-1042 is processing\./);
      assert.doesNotMatch(rows[0]?.prompt?.raw ?? '', /Confirmed order SON-1042\./);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
