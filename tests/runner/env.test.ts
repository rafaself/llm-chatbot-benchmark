import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadEnvFile } from '../../src/runner/env.ts';

test('dotenv file fills unset AWS variables and preserves the shell', () => {
  const directory = mkdtempSync(join(tmpdir(), 'benchmark-env-'));
  try {
    const path = join(directory, '.env');
    writeFileSync(
      path,
      [
        '# ignored',
        'AWS_ACCESS_KEY_ID=from-file',
        'AWS_SECRET_ACCESS_KEY="secret value"',
        "export AWS_REGION='us-east-1'",
        'AWS_SESSION_TOKEN=',
        'AWS_PROFILE=from-file',
        '',
      ].join('\n'),
    );
    const env: NodeJS.ProcessEnv = { AWS_PROFILE: 'from-shell' };
    loadEnvFile(path, env);
    assert.equal(env.AWS_ACCESS_KEY_ID, 'from-file');
    assert.equal(env.AWS_SECRET_ACCESS_KEY, 'secret value');
    assert.equal(env.AWS_REGION, 'us-east-1');
    assert.equal(env.AWS_SESSION_TOKEN, undefined);
    assert.equal(env.AWS_PROFILE, 'from-shell');
    loadEnvFile(join(directory, 'missing.env'), env);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
