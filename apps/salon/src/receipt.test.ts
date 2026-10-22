import { it, expect } from 'vitest'
import { refreshReceipt } from './receipt'
import type { SalonPayment, SalonPayout } from '@xzare/engine'
const payout = { id: 'P', staffId: 'T', voidReason: null } as SalonPayout
const payment = { id: 'R', voidReason: null } as SalonPayment
it('refreshes corrected payout documents independent of the current page', () => {
  const r = refreshReceipt(
    { kind: 'payout', data: payout },
    'admin',
    [],
    [{ ...payout, voidReason: 'تصحيح' }],
    [],
  )
  expect(r?.data.voidReason).toBe('تصحيح')
})
it('removes payout documents when the stylist loses the staff assignment', () => {
  expect(
    refreshReceipt(
      { kind: 'payout', data: payout },
      'stylist',
      [],
      [payout],
      ['OTHER'],
    ),
  ).toBeNull()
})
it('removes payment records after financial scope is lost and missing records', () => {
  expect(
    refreshReceipt(
      { kind: 'payment', data: payment },
      'stylist',
      [payment],
      [],
      [],
    ),
  ).toBeNull()
  expect(
    refreshReceipt({ kind: 'payment', data: payment }, 'admin', [], [], []),
  ).toBeNull()
})
