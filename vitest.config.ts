import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@agent-spend-kit/sdk': path.resolve(rootDir, 'packages/sdk/src/index.ts'),
      '@agent-spend-kit/server': path.resolve(rootDir, 'packages/server/src/index.ts')
    }
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 15000
  }
});
