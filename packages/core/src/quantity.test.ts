import { describe, expect, it } from 'vitest'
import { MILLI_UNITS_PER_UNIT, Quantity } from './quantity.js'

describe('Quantity construction', () => {
  it('builds from whole units and raw milli-units', () => {
    expect(Quantity.toMilliUnits(Quantity.fromUnits(3))).toBe(3000)
    expect(Quantity.toMilliUnits(Quantity.fromMilliUnits(1500))).toBe(1500)
    expect(Quantity.toMilliUnits(Quantity.zero)).toBe(0)
    expect(Quantity.toMilliUnits(Quantity.one)).toBe(MILLI_UNITS_PER_UNIT)
  })

  it('rejects fractional milli-units', () => {
    expect(() => Quantity.fromMilliUnits(1.5)).toThrow(RangeError)
    expect(() => Quantity.fromUnits(1.5)).toThrow(RangeError)
  })
})

describe('Quantity.parse', () => {
  const parsed = (input: string): number => {
    const result = Quantity.parse(input)
    if (!result.ok) throw new Error(`expected ${input} to parse: ${result.error.message}`)
    return Quantity.toMilliUnits(result.value)
  }

  it('parses the weights a grocery actually keys in', () => {
    expect(parsed('1.5')).toBe(1500)
    expect(parsed('0.250')).toBe(250)
    expect(parsed('2')).toBe(2000)
    expect(parsed('12.345')).toBe(12_345)
  })

  it('accepts Arabic numerals', () => {
    expect(parsed('٢٫٥')).toBe(2500)
  })

  it('rejects precision finer than a milli-unit', () => {
    const result = Quantity.parse('1.2345')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.messageKey).toBe('error.validation.too_many_decimals')
  })

  it('reports an invalid quantity with its own message key', () => {
    const result = Quantity.parse('not-a-number')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.messageKey).toBe('error.validation.invalid_quantity')
  })
})

describe('Quantity formatting', () => {
  it('renders exact text with three places for storage and export', () => {
    expect(Quantity.toDecimalString(Quantity.fromMilliUnits(1500))).toBe('1.500')
    expect(Quantity.toDecimalString(Quantity.fromUnits(2))).toBe('2.000')
    expect(Quantity.toDecimalString(Quantity.fromMilliUnits(-250))).toBe('-0.250')
  })

  it('renders compact text for the cashier screen', () => {
    expect(Quantity.toCompactString(Quantity.fromUnits(2))).toBe('2')
    expect(Quantity.toCompactString(Quantity.fromMilliUnits(1500))).toBe('1.5')
    expect(Quantity.toCompactString(Quantity.fromMilliUnits(250))).toBe('0.25')
    expect(Quantity.toCompactString(Quantity.fromMilliUnits(1005))).toBe('1.005')
    expect(Quantity.toCompactString(Quantity.zero)).toBe('0')
  })
})

describe('Quantity arithmetic', () => {
  it('adds and subtracts exactly', () => {
    const a = Quantity.fromMilliUnits(1500)
    const b = Quantity.fromMilliUnits(750)
    expect(Quantity.toDecimalString(Quantity.add(a, b))).toBe('2.250')
    expect(Quantity.toDecimalString(Quantity.subtract(a, b))).toBe('0.750')
  })

  it('accumulates 0.1 units a thousand times to exactly 100', () => {
    let total = Quantity.zero
    for (let index = 0; index < 1000; index += 1) {
      total = Quantity.add(total, Quantity.fromMilliUnits(100))
    }
    expect(Quantity.toDecimalString(total)).toBe('100.000')
  })

  it('scales by whole factors, as a recipe batch does', () => {
    expect(Quantity.toDecimalString(Quantity.mulInteger(Quantity.fromMilliUnits(250), 4))).toBe(
      '1.000',
    )
  })

  it('sums, negates and absolutes', () => {
    expect(Quantity.toMilliUnits(Quantity.sum([]))).toBe(0)
    expect(
      Quantity.toDecimalString(Quantity.sum([Quantity.fromUnits(1), Quantity.fromMilliUnits(500)])),
    ).toBe('1.500')
    expect(Quantity.toMilliUnits(Quantity.negate(Quantity.fromUnits(1)))).toBe(-1000)
    expect(Quantity.toMilliUnits(Quantity.abs(Quantity.fromMilliUnits(-250)))).toBe(250)
  })

  it('refuses unsafe results', () => {
    const huge = Quantity.fromMilliUnits(Number.MAX_SAFE_INTEGER)
    expect(() => Quantity.add(huge, Quantity.one)).toThrow(RangeError)
  })
})

describe('Quantity predicates and comparison', () => {
  it('reports sign and wholeness', () => {
    expect(Quantity.isZero(Quantity.zero)).toBe(true)
    expect(Quantity.isPositive(Quantity.one)).toBe(true)
    expect(Quantity.isNegative(Quantity.fromMilliUnits(-1))).toBe(true)
    // Serialised goods (IMEI, serial numbers) may only move in whole units.
    expect(Quantity.isWholeUnits(Quantity.fromUnits(3))).toBe(true)
    expect(Quantity.isWholeUnits(Quantity.fromMilliUnits(1500))).toBe(false)
    expect(Quantity.isWholeUnits(Quantity.zero)).toBe(true)
  })

  it('orders and selects', () => {
    const half = Quantity.fromMilliUnits(500)
    expect(Quantity.compare(half, Quantity.one)).toBe(-1)
    expect(Quantity.compare(Quantity.one, half)).toBe(1)
    expect(Quantity.compare(Quantity.one, Quantity.fromUnits(1))).toBe(0)
    expect(Quantity.lessThan(half, Quantity.one)).toBe(true)
    expect(Quantity.lessThanOrEqual(half, half)).toBe(true)
    expect(Quantity.greaterThan(Quantity.one, half)).toBe(true)
    expect(Quantity.greaterThanOrEqual(half, half)).toBe(true)
    expect(Quantity.equals(half, Quantity.fromMilliUnits(500))).toBe(true)
    expect(Quantity.toMilliUnits(Quantity.min(half, Quantity.one))).toBe(500)
    expect(Quantity.toMilliUnits(Quantity.max(half, Quantity.one))).toBe(1000)
  })
})
