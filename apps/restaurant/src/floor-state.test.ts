import { describe, expect, it } from 'vitest'
import { floorState } from './floor-state'
describe('restaurant floor states', () => {
  const now = new Date('2026-10-09T12:00:00').getTime()
  it('keeps active orders occupied and marks actual paid orders from today as billed and available', () => {
    const paid = [{ tableId: 't1', status: 'completed', updatedAt: now - 1000, invoice: {} }]
    expect(floorState('t1', 'o2', paid, now)).toBe('occupied')
    expect(floorState('t1', null, paid, now)).toBe('billed')
  })
  it('does not label yesterday, refunds or unbilled records as billed', () => {
    expect(floorState('t1', null, [{ tableId: 't1', status: 'completed', updatedAt: now - 86400000, invoice: {} }], now)).toBe('free')
    expect(floorState('t1', null, [{ tableId: 't1', status: 'refunded', updatedAt: now, invoice: {} }], now)).toBe('free')
    expect(floorState('t1', null, [], now)).toBe('free')
  })
})
