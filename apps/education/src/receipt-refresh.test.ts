import { it, expect } from 'vitest'
import { refreshReceipt } from './receipt-refresh'
it('open receipt reflects a manager void on refresh instead of printing stale registered data', () => {
  const old = { id: 'P', voidReason: null },
    updated = { ...old, voidReason: 'duplicate corrected' }
  expect(refreshReceipt(old as any, [updated] as any)).toEqual(updated)
})
it('missing or no longer authorized receipt closes until a fresh enrollment detail is read', () => {
  expect(refreshReceipt({ id: 'old' } as any, [])).toBeNull()
})
