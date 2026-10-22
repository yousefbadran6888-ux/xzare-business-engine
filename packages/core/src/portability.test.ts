import { describe, expect, it } from 'vitest'
import { build } from 'vite'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { webcrypto } from 'node:crypto'

describe('isolated renderer compatibility', () => {
  it('builds and runs the public core entry point with no Node globals', async () => {
    const result = await build({
      configFile: false,
      logLevel: 'silent',
      build: {
        write: false,
        minify: false,
        lib: {
          entry: fileURLToPath(new URL('./index.ts', import.meta.url)),
          name: 'XzareCore',
          formats: ['iife'],
        },
      },
    })
    const output = Array.isArray(result) ? result[0] : result
    if (output === undefined || !('output' in output)) throw new Error('No bundle')
    const chunk = output.output.find((item) => item.type === 'chunk')
    if (!chunk || chunk.type !== 'chunk') throw new Error('No executable chunk')
    expect(chunk.code).not.toContain('node:')
    const resultFromBrowser = runInNewContext(
      `${chunk.code}; ({ money: XzareCore.Money.fromPounds(1.23), id: XzareCore.ulid(1000) })`,
      {
        crypto: webcrypto,
      },
    ) as { money: number; id: string }
    expect(resultFromBrowser.money).toBe(123)
    expect(resultFromBrowser.id).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/)
  }, 15000)
})
