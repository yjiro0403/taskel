import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const dirname =
  typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));
const srcDir = fileURLToPath(new URL('./src', import.meta.url));
const require = createRequire(import.meta.url);
const storybookVitestPlugin = (() => {
  try {
    return require('@storybook/addon-vitest/vitest-plugin') as {
      storybookTest: (options: { configDir: string }) => unknown;
    };
  } catch {
    return null;
  }
})();
const playwrightProvider = (() => {
  try {
    return (require('@vitest/browser-playwright') as {
      playwright: (options: Record<string, never>) => unknown;
    }).playwright;
  } catch {
    return null;
  }
})();

// More info at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon
export default defineConfig({
  resolve: {
    alias: {
      '@': srcDir,
    },
  },
  test: {
    alias: {
      '@': srcDir,
    },
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      ...(storybookVitestPlugin && playwrightProvider
        ? [
            {
              extends: true,
              plugins: [
                storybookVitestPlugin.storybookTest({ configDir: path.join(dirname, '.storybook') }),
              ],
              test: {
                name: 'storybook',
                browser: {
                  enabled: true,
                  headless: true,
                  provider: playwrightProvider({}),
                  instances: [{ browser: 'chromium' }],
                },
                setupFiles: ['.storybook/vitest.setup.ts'],
              },
            },
          ]
        : []),
    ],
  },
});
