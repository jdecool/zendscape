import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default defineConfig(
  // Type-aware rules need TypeScript sources; this config file is plain JS.
  { ignores: ['dist', 'eslint.config.js', 'test-results', 'playwright-report'] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true },
    },
  },
);
