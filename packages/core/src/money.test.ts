import { describe, expect, it } from 'vitest'
import { Money, basisPoints, percent, PIASTRES_PER_POUND } from './money.js'
import { RoundingMode } from './rounding.js'

describe('Money construction', () => {
  it('wraps whole piastres', () => {
    expect(Money.toPiastres(Money.fromPiastres(1234))).toBe(1234)
    expect(Money.toPiastres(Money.zero)).toBe(0)
    expect(Money.toPiastres(Money.fromPiastres(-500))).toBe(-500)
  })

  it('rejects non-integer piastres, because a fraction of a piastre cannot exist', () => {
    expect(() => Money.fromPiastres(10.5)).toThrow(RangeError)
    expect(() => Money.fromPiastres(Number.NaN)).toThrow(RangeError)
    expect(() => Money.fromPiastres(Number.POSITIVE_INFINITY)).toThrow(RangeError)
  })

  it('converts pounds without binary floating-point drift', () => {
    // 19.99 is not representable in binary floating point; naive maths yields 1998.
    expect(Money.toPiastres(Money.fromPounds(19.99))).toBe(1999)
    expect(Money.toPiastres(Money.fromPounds(0.07))).toBe(7)
    expect(Money.toPiastres(Money.fromPounds(0.29))).toBe(29)
    expect(Money.toPiastres(Money.fromPounds(1.005))).toBe(101)
    expect(Money.toPiastres(Money.fromPounds(-4.56))).toBe(-456)
  })

  it('exposes the piastre scale used throughout the suite', () => {
    expect(PIASTRES_PER_POUND).toBe(100)
  })
})

describe('Money.parse', () => {
  const parsed = (input: string): number => {
    const result = Money.parse(input)
    if (!result.ok) throw new Error(`expected ${input} to parse: ${result.error.message}`)
    return Money.toPiastres(result.value)
  }

  it('parses plain and grouped decimal text', () => {
    expect(parsed('1234.50')).toBe(123_450)
    expect(parsed('1,234.50')).toBe(123_450)
    expect(parsed('0.05')).toBe(5)
    expect(parsed('100')).toBe(10_000)
    expect(parsed('.5')).toBe(50)
    expect(parsed('-12.34')).toBe(-1234)
    expect(parsed('+12.34')).toBe(1234)
  })

  it('pads a single decimal place rather than misreading it', () => {
    expect(parsed('12.5')).toBe(1250)
  })

  it('accepts Arabic-Indic numerals and the Arabic decimal separator', () => {
    expect(parsed('١٢٣٤٫٥٠')).toBe(123_450)
    expect(parsed('٩٩')).toBe(9900)
    // Extended Arabic-Indic (Persian) digits appear in some pasted data.
    expect(parsed('۲۵٫۷۵')).toBe(2575)
  })

  it('accepts Arabic thousands separators', () => {
    expect(parsed('١٢٬٣٤٥')).toBe(1_234_500)
  })

  it('reads accounting-style parentheses as negative', () => {
    expect(parsed('(1,234.50)')).toBe(-123_450)
  })

  it('ignores Egyptian currency tokens', () => {
    expect(parsed('1234.50 ج.م')).toBe(123_450)
    expect(parsed('EGP 99.00')).toBe(9900)
    expect(parsed('99.00 جنيه')).toBe(9900)
  })

  it('rejects input with more precision than a piastre, rather than quietly rounding', () => {
    const result = Money.parse('10.005')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.messageKey).toBe('error.validation.too_many_decimals')
  })

  it('rounds excess precision only when explicitly asked, for bulk imports', () => {
    const result = Money.parse('10.005', { roundExcessPrecision: true })
    expect(result.ok).toBe(true)
    if (result.ok) expect(Money.toPiastres(result.value)).toBe(1001)
  })

  it('rejects malformed input as a value, not an exception', () => {
    for (const input of ['', '   ', 'abc', '1.2.3', '--5', '12abc', '1-2']) {
      const result = Money.parse(input)
      expect(result.ok, `expected ${JSON.stringify(input)} to be rejected`).toBe(false)
    }
  })
})

describe('Money formatting', () => {
  it('renders exact decimal text with two places', () => {
    expect(Money.toDecimalString(Money.fromPiastres(123_450))).toBe('1234.50')
    expect(Money.toDecimalString(Money.fromPiastres(5))).toBe('0.05')
    expect(Money.toDecimalString(Money.zero)).toBe('0.00')
    expect(Money.toDecimalString(Money.fromPiastres(-1234))).toBe('-12.34')
  })

  it('round-trips through text without loss', () => {
    for (const piastres of [0, 1, 99, 100, 123_456_789, -4567]) {
      const money = Money.fromPiastres(piastres)
      const result = Money.parse(Money.toDecimalString(money))
      expect(result.ok).toBe(true)
      if (result.ok) expect(Money.toPiastres(result.value)).toBe(piastres)
    }
  })
})

describe('Money arithmetic', () => {
  it('adds and subtracts exactly', () => {
    const a = Money.fromPounds(19.99)
    const b = Money.fromPounds(0.01)
    expect(Money.toDecimalString(Money.add(a, b))).toBe('20.00')
    expect(Money.toDecimalString(Money.subtract(a, b))).toBe('19.98')
  })

  it('accumulates 0.10 a thousand times to exactly 100.00', () => {
    // The canonical float failure: 0.1 summed 1000 times gives 99.9999999999986.
    let total = Money.zero
    for (let index = 0; index < 1000; index += 1) {
      total = Money.add(total, Money.fromPounds(0.1))
    }
    expect(Money.toDecimalString(total)).toBe('100.00')
  })

  it('sums an empty sequence to zero', () => {
    expect(Money.toPiastres(Money.sum([]))).toBe(0)
  })

  it('sums a sequence exactly', () => {
    const values = [12.34, 0.01, 999.99, -5.5].map(Money.fromPounds)
    expect(Money.toDecimalString(Money.sum(values))).toBe('1006.84')
  })

  it('negates and takes absolute values', () => {
    expect(Money.toPiastres(Money.negate(Money.fromPounds(5)))).toBe(-500)
    expect(Money.toPiastres(Money.abs(Money.fromPounds(-5)))).toBe(500)
    expect(Money.toPiastres(Money.abs(Money.fromPounds(5)))).toBe(500)
  })

  it('multiplies by whole counts', () => {
    expect(Money.toDecimalString(Money.mulInteger(Money.fromPounds(19.99), 3))).toBe('59.97')
    expect(Money.toPiastres(Money.mulInteger(Money.fromPounds(10), 0))).toBe(0)
    expect(Money.toDecimalString(Money.mulInteger(Money.fromPounds(10), -2))).toBe('-20.00')
  })

  it('refuses results that exceed exact integer representation', () => {
    const huge = Money.fromPiastres(Number.MAX_SAFE_INTEGER)
    expect(() => Money.add(huge, Money.fromPiastres(1))).toThrow(RangeError)
    expect(() => Money.mulInteger(huge, 2)).toThrow(RangeError)
  })
})

describe('Money comparison', () => {
  const five = Money.fromPounds(5)
  const ten = Money.fromPounds(10)

  it('orders values', () => {
    expect(Money.compare(five, ten)).toBe(-1)
    expect(Money.compare(ten, five)).toBe(1)
    expect(Money.compare(five, Money.fromPounds(5))).toBe(0)
  })

  it('answers predicate questions', () => {
    expect(Money.lessThan(five, ten)).toBe(true)
    expect(Money.lessThanOrEqual(five, five)).toBe(true)
    expect(Money.greaterThan(ten, five)).toBe(true)
    expect(Money.greaterThanOrEqual(five, five)).toBe(true)
    expect(Money.equals(five, Money.fromPounds(5))).toBe(true)
    expect(Money.isZero(Money.zero)).toBe(true)
    expect(Money.isPositive(five)).toBe(true)
    expect(Money.isNegative(Money.negate(five))).toBe(true)
  })

  it('selects minimum, maximum and clamped values', () => {
    expect(Money.toPiastres(Money.min(five, ten))).toBe(500)
    expect(Money.toPiastres(Money.max(five, ten))).toBe(1000)
    expect(Money.toPiastres(Money.clamp(Money.fromPounds(20), five, ten))).toBe(1000)
    expect(Money.toPiastres(Money.clamp(Money.fromPounds(1), five, ten))).toBe(500)
    expect(Money.toPiastres(Money.clamp(Money.fromPounds(7), five, ten))).toBe(700)
    expect(() => Money.clamp(five, ten, five)).toThrow(RangeError)
  })
})

describe('Money.applyRate — tax, discount and commission', () => {
  it('applies Egyptian 14% VAT', () => {
    expect(Money.toDecimalString(Money.applyRate(Money.fromPounds(100), percent(14)))).toBe('14.00')
    expect(Money.toDecimalString(Money.applyRate(Money.fromPounds(19.99), percent(14)))).toBe(
      '2.80',
    )
  })

  it('supports fractional percentages via basis points', () => {
    expect(Money.toDecimalString(Money.applyRate(Money.fromPounds(1000), percent(2.5)))).toBe(
      '25.00',
    )
    expect(Money.toDecimalString(Money.applyRate(Money.fromPounds(1000), basisPoints(125)))).toBe(
      '12.50',
    )
  })

  it('rounds half-up by default and honours an explicit mode', () => {
    // 7.77 × 5% = 0.3885 → 0.39 half-up, 0.38 truncated.
    const base = Money.fromPounds(7.77)
    expect(Money.toDecimalString(Money.applyRate(base, percent(5)))).toBe('0.39')
    expect(Money.toDecimalString(Money.applyRate(base, percent(5), RoundingMode.TRUNCATE))).toBe(
      '0.38',
    )
  })

  it('rejects percentages needing more than two decimal places', () => {
    expect(() => percent(1.2345)).toThrow(RangeError)
  })
})

describe('Money.allocate — proportional distribution', () => {
  it('distributes a remainder so the parts re-sum exactly', () => {
    // 10.00 across three equal shares cannot divide evenly.
    const parts = Money.allocate(Money.fromPounds(10), [1, 1, 1])
    expect(parts.map(Money.toDecimalString)).toEqual(['3.34', '3.33', '3.33'])
    expect(Money.toDecimalString(Money.sum(parts))).toBe('10.00')
  })

  it('weights proportionally, as an invoice-level discount must', () => {
    const parts = Money.allocate(Money.fromPounds(100), [70, 30])
    expect(parts.map(Money.toDecimalString)).toEqual(['70.00', '30.00'])
  })

  it('never creates or loses a piastre, across many awkward splits', () => {
    const weightSets = [
      [1, 1, 1],
      [1, 2, 3, 4],
      [7, 11, 13],
      [1, 1, 1, 1, 1, 1, 1],
      [999, 1],
      [5, 5, 5, 5, 5, 5],
    ]
    for (let piastres = 0; piastres <= 400; piastres += 1) {
      const total = Money.fromPiastres(piastres)
      for (const weights of weightSets) {
        const parts = Money.allocate(total, weights)
        expect(
          Money.toPiastres(Money.sum(parts)),
          `allocate(${piastres}, [${weights.join(',')}]) must re-sum exactly`,
        ).toBe(piastres)
      }
    }
  })

  it('preserves the total when the amount is negative, as for a refund', () => {
    const parts = Money.allocate(Money.fromPounds(-10), [1, 1, 1])
    expect(parts.map(Money.toDecimalString)).toEqual(['-3.34', '-3.33', '-3.33'])
    expect(Money.toDecimalString(Money.sum(parts))).toBe('-10.00')
  })

  it('gives leftover piastres to the largest remainder, deterministically', () => {
    // 100 piastres over weights 1:1:1 → remainders tie, so the earliest index wins.
    expect(Money.allocate(Money.fromPiastres(100), [1, 1, 1]).map(Money.toPiastres)).toEqual([
      34, 33, 33,
    ])
    // Repeated calls must be identical — audits depend on reproducibility.
    expect(Money.allocate(Money.fromPiastres(100), [1, 1, 1]).map(Money.toPiastres)).toEqual([
      34, 33, 33,
    ])
  })

  it('falls back to an even split when all weights are zero', () => {
    const parts = Money.allocate(Money.fromPounds(10), [0, 0, 0])
    expect(Money.toDecimalString(Money.sum(parts))).toBe('10.00')
    expect(parts.map(Money.toDecimalString)).toEqual(['3.34', '3.33', '3.33'])
  })

  it('allocates a zero total to all-zero parts', () => {
    expect(Money.allocate(Money.zero, [3, 5]).map(Money.toPiastres)).toEqual([0, 0])
  })

  it('rejects an empty or negative weight set', () => {
    expect(() => Money.allocate(Money.fromPounds(10), [])).toThrow(RangeError)
    expect(() => Money.allocate(Money.fromPounds(10), [1, -1])).toThrow(RangeError)
  })
})

describe('Money.split — even division for split bills', () => {
  it('splits a restaurant bill three ways with no lost piastre', () => {
    const parts = Money.split(Money.fromPounds(100), 3)
    expect(parts.map(Money.toDecimalString)).toEqual(['33.34', '33.33', '33.33'])
    expect(Money.toDecimalString(Money.sum(parts))).toBe('100.00')
  })

  it('re-sums exactly for every amount and party size', () => {
    for (let piastres = 0; piastres <= 200; piastres += 1) {
      for (let count = 1; count <= 8; count += 1) {
        const parts = Money.split(Money.fromPiastres(piastres), count)
        expect(parts).toHaveLength(count)
        expect(Money.toPiastres(Money.sum(parts))).toBe(piastres)
      }
    }
  })

  it('handles a negative total', () => {
    const parts = Money.split(Money.fromPounds(-10), 3)
    expect(Money.toDecimalString(Money.sum(parts))).toBe('-10.00')
  })

  it('rejects a non-positive party size', () => {
    expect(() => Money.split(Money.fromPounds(10), 0)).toThrow(RangeError)
    expect(() => Money.split(Money.fromPounds(10), -1)).toThrow(RangeError)
    expect(() => Money.split(Money.fromPounds(10), 1.5)).toThrow(RangeError)
  })
})
