import { it, expect } from 'vitest'
import { ScanGate } from './scan-gate'
it('editing barcode while lookup is pending cannot show or admit a different member', async () => {
  const g = new ScanGate()
  g.change('A')
  const t = g.begin()
  let resolve!: (x: string) => void
  const pending = new Promise<string>((r) => (resolve = r)).then((v) =>
    g.accept(t) ? v : null,
  )
  g.change('B')
  resolve('member A')
  expect(await pending).toBeNull()
  const b = g.begin()
  expect(b.code).toBe('B')
  expect(g.accept(b)).toBe(true)
})
it('new submission and logout reject earlier admission responses', () => {
  const g = new ScanGate()
  g.change('A')
  const old = g.begin(),
    current = g.begin()
  expect(g.accept(old)).toBe(false)
  expect(g.accept(current)).toBe(true)
  g.clear()
  expect(g.accept(current)).toBe(false)
})
