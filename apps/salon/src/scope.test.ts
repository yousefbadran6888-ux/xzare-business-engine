import { it, expect } from 'vitest'
import { ScopeGate } from './scope'
import type { SalonState } from '@xzare/engine'
const s = (bookings: string[], customers = ['C']) =>
  ({
    user: { id: 'U', role: 'stylist' },
    bookings: bookings.map((id) => ({ id })),
    customers: customers.map((id) => ({ id })),
  }) as SalonState
it('scope removal invalidates pending booking details even when client stays assigned elsewhere', () => {
  const g = new ScopeGate()
  g.update(s(['A', 'B']))
  const t = g.ticket()
  expect(g.accept(t, 'booking', 'A')).toBe(true)
  expect(g.update(s(['B']))).toBe(true)
  expect(g.accept(t, 'booking', 'A')).toBe(false)
  expect(g.current(t)).toBe(false)
})
it('logout and role identity changes invalidate report tickets', () => {
  const g = new ScopeGate()
  g.update(s(['A']))
  const t = g.ticket()
  g.clear()
  expect(g.current(t)).toBe(false)
  g.update(s(['A']))
  const fresh = g.ticket()
  const changed = {
    ...s(['A']),
    user: { id: 'Z', role: 'admin' },
  } as SalonState
  expect(g.update(changed)).toBe(true)
  expect(g.current(fresh)).toBe(false)
})
