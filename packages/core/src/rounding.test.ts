import { describe, expect, it } from 'vitest'
import {
  assertSafeInteger,
  DEFAULT_ROUNDING,
  divideRounded,
  RoundingMode,
  toSafeInteger,
} from './rounding.js'

describe('divideRounded', () => {
  it('returns an exact quotient untouched', () => {
    expect(divideRounded(10n, 2n)).toBe(5n)
    expect(divideRounded(-10n, 2n)).toBe(-5n)
    expect(divideRounded(0n, 7n)).toBe(0n)
  })

  it('rounds half away from zero by default, the commercial convention', () => {
    expect(DEFAULT_ROUNDING).toBe(RoundingMode.HALF_UP)
    expect(divideRounded(5n, 2n)).toBe(3n) // 2.5 → 3
    expect(divideRounded(-5n, 2n)).toBe(-3n) // -2.5 → -3
    expect(divideRounded(7n, 2n)).toBe(4n) // 3.5 → 4
    expect(divideRounded(4n, 3n)).toBe(1n) // 1.33 → 1
    expect(divideRounded(5n, 3n)).toBe(2n) // 1.67 → 2
  })

  it('rounds half to even when asked, reducing bias in aggregates', () => {
    expect(divideRounded(5n, 2n, RoundingMode.HALF_EVEN)).toBe(2n) // 2.5 → 2
    expect(divideRounded(7n, 2n, RoundingMode.HALF_EVEN)).toBe(4n) // 3.5 → 4
    expect(divideRounded(-5n, 2n, RoundingMode.HALF_EVEN)).toBe(-2n)
    expect(divideRounded(-7n, 2n, RoundingMode.HALF_EVEN)).toBe(-4n)
    // Non-ties behave normally.
    expect(divideRounded(8n, 3n, RoundingMode.HALF_EVEN)).toBe(3n)
  })

  it('truncates toward zero', () => {
    expect(divideRounded(9n, 2n, RoundingMode.TRUNCATE)).toBe(4n)
    expect(divideRounded(-9n, 2n, RoundingMode.TRUNCATE)).toBe(-4n)
  })

  it('rounds toward positive infinity with CEIL', () => {
    expect(divideRounded(1n, 2n, RoundingMode.CEIL)).toBe(1n)
    expect(divideRounded(-1n, 2n, RoundingMode.CEIL)).toBe(0n)
    expect(divideRounded(4n, 2n, RoundingMode.CEIL)).toBe(2n)
  })

  it('rounds toward negative infinity with FLOOR', () => {
    expect(divideRounded(1n, 2n, RoundingMode.FLOOR)).toBe(0n)
    expect(divideRounded(-1n, 2n, RoundingMode.FLOOR)).toBe(-1n)
    expect(divideRounded(-4n, 2n, RoundingMode.FLOOR)).toBe(-2n)
  })

  it('treats a negative denominator as a sign on the numerator', () => {
    expect(divideRounded(10n, -4n)).toBe(-3n) // -2.5 → -3 half-up
    expect(divideRounded(-10n, -4n)).toBe(3n)
    expect(divideRounded(1n, -2n, RoundingMode.FLOOR)).toBe(-1n)
  })

  it('refuses a zero denominator, which is always a bug', () => {
    expect(() => divideRounded(1n, 0n)).toThrow(RangeError)
  })

  it('stays exact well beyond 64-bit range', () => {
    const huge = 10n ** 30n
    expect(divideRounded(huge * 3n, 3n)).toBe(huge)
    expect(divideRounded(huge + 1n, 2n)).toBe(huge / 2n + 1n)
  })
})

describe('toSafeInteger', () => {
  it('converts values inside the exact range', () => {
    expect(toSafeInteger(0n, 'test')).toBe(0)
    expect(toSafeInteger(12_345n, 'test')).toBe(12_345)
    expect(toSafeInteger(BigInt(Number.MAX_SAFE_INTEGER), 'test')).toBe(Number.MAX_SAFE_INTEGER)
    expect(toSafeInteger(BigInt(Number.MIN_SAFE_INTEGER), 'test')).toBe(Number.MIN_SAFE_INTEGER)
  })

  it('throws rather than silently losing precision', () => {
    expect(() => toSafeInteger(BigInt(Number.MAX_SAFE_INTEGER) + 1n, 'ctx')).toThrow(RangeError)
    expect(() => toSafeInteger(BigInt(Number.MIN_SAFE_INTEGER) - 1n, 'ctx')).toThrow(/ctx/)
  })
})

describe('assertSafeInteger', () => {
  it('accepts usable integers', () => {
    expect(() => assertSafeInteger(0, 'test')).not.toThrow()
    expect(() => assertSafeInteger(-42, 'test')).not.toThrow()
  })

  it('rejects non-finite, fractional and oversized values', () => {
    expect(() => assertSafeInteger(Number.NaN, 'test')).toThrow(RangeError)
    expect(() => assertSafeInteger(Number.POSITIVE_INFINITY, 'test')).toThrow(RangeError)
    expect(() => assertSafeInteger(1.5, 'test')).toThrow(RangeError)
    expect(() => assertSafeInteger(Number.MAX_SAFE_INTEGER + 2, 'test')).toThrow(RangeError)
  })

  it('names the context so the log points at the culprit', () => {
    expect(() => assertSafeInteger(1.5, 'Money.fromPiastres')).toThrow(/Money\.fromPiastres/)
  })
})
