import { it, expect } from 'vitest'
import { syncReceipt } from './receipt'
import type { SalonPayout, SalonPayment } from '@xzare/engine'
const payout = {
  kind: 'payout' as const,
  data: { id: 'P', staffId: 'T', voidReason: null } as SalonPayout,
}
it('a refresh begun before opening a payout does not close the new modal', () =>
  expect(syncReceipt(payout, null, null, false)).toBe(payout))
it('late results cannot replace another receipt or resurrect a closed modal', () => {
  const other = { ...payout, data: { ...payout.data, id: 'OTHER' } }
  expect(syncReceipt(other, payout, payout, false)).toBe(other)
  expect(syncReceipt(null, payout, payout, false)).toBeNull()
  expect(syncReceipt(payout, payout, payout, true)).toBeNull()
})
it('historical payment receipt is refreshed from its invoice even outside state recent payments', () => {
  const p = {
    kind: 'payment' as const,
    data: { id: 'OLD', voidReason: null } as SalonPayment,
  }
  const corrected = { ...p, data: { ...p.data, voidReason: 'تصحيح' } }
  expect(syncReceipt(p, p, corrected, false)).toEqual(corrected)
})
