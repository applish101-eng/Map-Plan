import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'packages/*/src/**/*.test.ts', 'apps/web/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
  resolve: {
    alias: {
      '@nepal-flood-gis/schemas': resolve(__dirname, 'packages/schemas/src/index.ts'),
      '@nepal-flood-gis/core': resolve(__dirname, 'packages/core/src/index.ts'),
      '@': resolve(__dirname, 'apps/web'),
      // pnpm's strict node_modules means zod is only visible from the package
      // that declares it. Tests run from the repo root, so the resolution is
      // pointed explicitly rather than hoisting a duplicate dependency.
      // pnpm links workspace dependencies rather than hoisting them, so a test
      // running from the repo root cannot resolve zod by bare name. Pointing
      // the alias at the real installed location avoids adding a duplicate
      // zod to the root just for tests.
      zod: resolve(__dirname, 'node_modules/.pnpm/zod@3.25.76/node_modules/zod'),
    },
  },
})