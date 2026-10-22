import { it, expect } from 'vitest'
import { HotelScope, freshCaptured } from './scope'
it('revoked roles invalidate pending reports and private dialogs', () => {
  const g = new HotelScope()
  g.update({ id: 'u', role: 'admin' })
  const t = g.ticket()
  expect(g.update({ id: 'u', role: 'cashier' })).toBe(true)
  expect(g.current(t)).toBe(false)
  g.clear()
  expect(g.current(g.ticket() - 1)).toBe(false)
})
it('refresh cannot resurrect a closed document or overwrite a newer one', () => {
  const a = { id: 'a', value: 1 },
    b = { id: 'b', value: 2 },
    fresh = { id: 'a', value: 3 }
  expect(freshCaptured(null, a, fresh)).toBe(null)
  expect(freshCaptured(b, a, fresh)).toBe(b)
  expect(freshCaptured(a, a, fresh)).toBe(fresh)
  expect(freshCaptured(a, a, fresh, true)).toBe(null)
})
