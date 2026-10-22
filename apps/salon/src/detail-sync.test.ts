import { it, expect } from 'vitest'
import { syncDetail } from './detail-sync'
const old = {
  kind: 'customer',
  id: 'C',
  data: {
    customer: { version: 0 },
    bookings: [{ startMinute: 600 }],
    invoices: [{ balance: 10000, version: 0 }],
  },
}
it('refreshes child bookings and invoices even with unchanged root version', () => {
  const fresh = {
    ...old,
    data: {
      customer: { version: 0 },
      bookings: [{ startMinute: 720 }],
      invoices: [{ balance: 0, version: 1 }],
    },
  }
  expect(syncDetail(old, old, fresh, false)).toEqual(fresh)
})
it('cannot resurrect detail after scope loss or late response after closure', () => {
  expect(syncDetail(old, old, old, true)).toBeNull()
  expect(syncDetail(null, old, old, false)).toBeNull()
})
it('does not replace another modal opened while the old request was pending', () => {
  const other = { ...old, id: 'OTHER' }
  expect(syncDetail(other, old, old, false)).toBe(other)
  expect(syncDetail(old, old, null, false)).toBeNull()
})
