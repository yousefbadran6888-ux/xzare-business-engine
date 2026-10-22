import { describe, expect, it } from 'vitest'
import { formatScaled, normaliseNumerals, parseScaled } from './decimal.js'
import { RoundingMode } from './rounding.js'

describe('normaliseNumerals', () => {
  it('converts Arabic-Indic digits to ASCII', () => {
    expect(normaliseNumerals('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789')
  })

  it('converts extended Arabic-Indic (Persian) digits to ASCII', () => {
    expect(normaliseNumerals('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789')
  })

  it('maps the Arabic decimal separator and drops the Arabic thousands separator', () => {
    expect(normaliseNumerals('١٢٣٤٫٥٦')).toBe('1234.56')
    expect(normaliseNumerals('١٢٬٣٤٥')).toBe('12345')
  })

  it('leaves Latin text and ASCII digits untouched', () => {
    expect(normaliseNumerals('1234.56')).toBe('1234.56')
    expect(normaliseNumerals('abc')).toBe('abc')
  })

  it('preserves Arabic letters, which are not numerals', () => {
    expect(normaliseNumerals('جنيه')).toBe('جنيه')
  })

  it('handles mixed Arabic and ASCII digits', () => {
    expect(normaliseNumerals('12٣٤')).toBe('1234')
  })
})

describe('parseScaled', () => {
  const value = (input: string, scale: number): bigint => {
    const result = parseScaled(input, scale)
    if (!result.ok) throw new Error(`expected ${input} to parse: ${result.error.message}`)
    return result.value
  }

  it('scales by the requested number of decimal places', () => {
    expect(value('12', 0)).toBe(12n)
    expect(value('12.34', 2)).toBe(1234n)
    expect(value('12.345', 3)).toBe(12_345n)
  })

  it('treats any decimal place as excess when the scale is zero', () => {
    expect(parseScaled('1.5', 0).ok).toBe(false)
    expect(parseScaled('1.5', 0, { roundExcessPrecision: true }).ok).toBe(true)
  })

  it('pads short fractions to the full scale', () => {
    expect(value('1.5', 3)).toBe(1500n)
    expect(value('1.5', 2)).toBe(150n)
    expect(value('1.', 2)).toBe(100n)
  })

  it('rejects excess precision by default', () => {
    const result = parseScaled('1.234', 2)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.messageKey).toBe('error.validation.too_many_decimals')
  })

  it('rounds excess precision on request, honouring the rounding mode', () => {
    const halfUp = parseScaled('1.235', 2, { roundExcessPrecision: true })
    expect(halfUp.ok && halfUp.value).toBe(124n)
    const truncated = parseScaled('1.239', 2, {
      roundExcessPrecision: true,
      rounding: RoundingMode.TRUNCATE,
    })
    expect(truncated.ok && truncated.value).toBe(123n)
  })

  it('uses a caller-supplied message key for rejections', () => {
    const result = parseScaled('nonsense', 2, { messageKey: 'error.custom.key' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.messageKey).toBe('error.custom.key')
  })

  it('rejects malformed input as a value rather than throwing', () => {
    for (const input of ['', '  ', '.', 'abc', '1..2', '1.2.3', '+-1', '1 2 x']) {
      expect(parseScaled(input, 2).ok, `${JSON.stringify(input)} must be rejected`).toBe(false)
    }
  })

  it('does not round-trip through binary floating point', () => {
    // parseFloat('0.07') * 100 yields 7.000000000000001; text parsing must give exactly 7.
    expect(value('0.07', 2)).toBe(7n)
    expect(value('0.29', 2)).toBe(29n)
    expect(value('1.005', 3)).toBe(1005n)
  })

  it('stays exact for values far beyond 64-bit floating point precision', () => {
    expect(value('99999999999999999999.99', 2)).toBe(9_999_999_999_999_999_999_999n)
  })
})

describe('formatScaled', () => {
  it('renders the requested number of decimal places', () => {
    expect(formatScaled(1234, 2)).toBe('12.34')
    expect(formatScaled(1234, 3)).toBe('1.234')
    expect(formatScaled(1234, 0)).toBe('1234')
  })

  it('pads fractions and whole parts correctly', () => {
    expect(formatScaled(5, 2)).toBe('0.05')
    expect(formatScaled(50, 2)).toBe('0.50')
    expect(formatScaled(0, 2)).toBe('0.00')
  })

  it('places the sign before the digits', () => {
    expect(formatScaled(-1234, 2)).toBe('-12.34')
    expect(formatScaled(-5, 2)).toBe('-0.05')
  })

  it('accepts a bigint without losing precision', () => {
    expect(formatScaled(9_999_999_999_999_999_999_999n, 2)).toBe('99999999999999999999.99')
  })

  it('round-trips with parseScaled', () => {
    for (const input of [0n, 1n, 99n, 100n, 123_456_789n, -4567n]) {
      const text = formatScaled(input, 2)
      const parsed = parseScaled(text, 2)
      expect(parsed.ok && parsed.value).toBe(input)
    }
  })
})
