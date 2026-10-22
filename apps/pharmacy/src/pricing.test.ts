import { expect, it } from 'vitest'
import { counterTotal } from './pricing'
it.each([
  [5000, 0, 201, 5101],
  [25000, 0, 29, 25073],
  [30000, 1001, 1400, 33059],
])('full payment matches exact basis point rounding', (subtotal, discount, taxBps, total) => {
  expect(counterTotal(subtotal, discount, taxBps)).toBe(total)
})
