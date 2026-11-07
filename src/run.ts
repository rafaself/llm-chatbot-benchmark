import { parseOptions } from './runner/cli.ts';
import { prepareConfig } from './runner/config.ts';
import { loadProjectEnv } from './runner/env.ts';
import { createMetadata } from './runner/metadata.ts';
import { executeRun } from './runner/execute.ts';

try {
  loadProjectEnv();
  const options = parseOptions();
  const prepared = prepareConfig(options);
  process.exitCode = executeRun(options, prepared, createMetadata(options, prepared));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
