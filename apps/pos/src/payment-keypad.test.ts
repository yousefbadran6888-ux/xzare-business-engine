import { describe, expect, it } from 'vitest'
import { paymentKey } from './payment-keypad'

describe('touch payment keypad', () => {
  it('replaces a focused amount and retains at most two decimal places', () => {
    let amount = paymentKey('150.00', '2', true)
    for (const key of ['5', '.', '4', '9', '8']) amount = paymentKey(amount, key)
    expect(amount).toBe('25.49')
  })
  it('handles decimal entry, backspace and clearing without negative or malformed amounts', () => {
    expect(paymentKey('0', '.')).toBe('0.')
    expect(paymentKey('0.', '.')).toBe('0.')
    expect(paymentKey('4', 'backspace')).toBe('0')
    expect(paymentKey('55', 'clear')).toBe('0')
    expect(paymentKey('10', '-')).toBe('10')
  })
})
