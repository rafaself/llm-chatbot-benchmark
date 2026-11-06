import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig([
  {
    ignores: ['node_modules/**', 'results/**', '.promptfoo/**'],
  },
  {
    files: ['src/**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.strict],
    rules: {
      // TypeScript checks undefined names using the project's configured libs.
      'no-undef': 'off',
    },
  },
]);
