import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url))

/**
 * Tests resolve workspace packages straight from TypeScript source, so `pnpm test`
 * never depends on a prior `pnpm build`.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@xzare/core': pkg('core'),
      '@xzare/db': pkg('db'),
      '@xzare/barcode': pkg('barcode'),
      '@xzare/engine': pkg('engine'),
    },
  },
  test: {
    globals: false,
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
    environment: 'node',
    clearMocks: true,
  },
})
