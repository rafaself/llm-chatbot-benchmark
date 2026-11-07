import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.ts';

const envName = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Shell values win. Empty placeholders in .env are ignored so an untouched
// example file does not replace a missing credential with an empty string.
export function loadEnvFile(path: string, env: NodeJS.ProcessEnv = process.env) {
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const body = line.startsWith('export ')
      ? line.slice('export '.length).trim()
      : line;
    const separator = body.indexOf('=');
    if (separator <= 0) continue;
    const key = body.slice(0, separator).trim();
    if (!envName.test(key)) continue;
    let value = body.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    if (!value || env[key]) continue;
    env[key] = value;
  }
}

export function loadProjectEnv(env: NodeJS.ProcessEnv = process.env) {
  loadEnvFile(join(ROOT, '.env'), env);
}
