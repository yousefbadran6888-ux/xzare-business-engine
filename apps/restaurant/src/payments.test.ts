import { expect, it } from 'vitest'
import { paymentPreview } from './payments'
it('calculates configured tax after discount and real cash change', () => {
  expect(
    paymentPreview(
      { subtotal: 2500, taxBps: 1400 },
      { cash: '30', card: '0', transfer: '0', discount: '5' },
    ),
  ).toMatchObject({ total: 2280, tax: 280, change: 720, valid: true })
})
it('rejects non-cash overpayment and insufficient tender', () => {
  expect(
    paymentPreview(
      { subtotal: 2500, taxBps: 0 },
      { cash: '0', card: '30', transfer: '0', discount: '0' },
    ).valid,
  ).toBe(false)
  expect(
    paymentPreview(
      { subtotal: 2500, taxBps: 0 },
      { cash: '20', card: '0', transfer: '0', discount: '0' },
    ).valid,
  ).toBe(false)
})
it('rejects invalid decimal and out-of-range discount', () => {
  expect(
    paymentPreview(
      { subtotal: 2500, taxBps: 0 },
      { cash: '25', card: '0', transfer: '0', discount: '-1' },
    ).valid,
  ).toBe(false)
  expect(
    paymentPreview(
      { subtotal: 2500, taxBps: 0 },
      { cash: '25', card: '0', transfer: '0', discount: '26' },
    ).valid,
  ).toBe(false)
  expect(
    paymentPreview(
      { subtotal: 2500, taxBps: 0 },
      { cash: 'bad', card: '0', transfer: '0', discount: '0' },
    ).valid,
  ).toBe(false)
})
