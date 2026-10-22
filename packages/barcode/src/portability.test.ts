import { describe, expect, it } from 'vitest'
import { build } from 'vite'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

describe('barcode renderer compatibility', () => {
  it('builds and executes the public package without Node or DOM globals', async () => {
    const built = await build({
      configFile: false,
      logLevel: 'silent',
      build: {
        write: false,
        minify: false,
        lib: {
          entry: fileURLToPath(new URL('./index.ts', import.meta.url)),
          name: 'XzareBarcode',
          formats: ['iife'],
        },
      },
    })
    const result = Array.isArray(built) ? built[0] : built
    if (!result || !('output' in result)) throw new Error('No browser bundle')
    const chunk = result.output.find((item) => item.type === 'chunk')
    if (!chunk || chunk.type !== 'chunk') throw new Error('No executable chunk')
    expect(chunk.code).not.toContain('node:')
    const reading = runInNewContext(
      `${chunk.code}; (() => {
      const checked = XzareBarcode.Barcode.parse('036000291452', 'UPCA');
      const engine = XzareBarcode.ScaleBarcodeCodec.create([{ id: 'w', prefix: '21', productDigits: 5, valueDigits: 5, kind: 'weight', decimals: 3 }]);
      const code = engine.value.encode('w', '00123', { kind: 'weight', quantity: 750 });
      const decoded = engine.value.decode(code.value);
      const scanner = new XzareBarcode.KeyboardScanBuffer();
      scanner.setFocused(true);
      scanner.push({ key: 'A', at: 0 });
      return { code: checked.value.value, quantity: decoded.value.quantity, scanned: scanner.push({ key: 'Enter', at: 1 }).value };
    })()`,
      {},
    ) as { code: string; quantity: number; scanned: string }
    expect(reading).toEqual({ code: '036000291452', quantity: 750, scanned: 'A' })
  }, 15000)
})
