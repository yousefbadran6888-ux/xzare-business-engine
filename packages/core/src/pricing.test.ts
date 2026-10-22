import { describe, expect, it } from 'vitest'
import { Money, percent } from './money.js'
import { Quantity } from './quantity.js'
import { lineTotal, netFromInclusive, taxFromInclusive, unitPriceFromTotal } from './pricing.js'
import { RoundingMode } from './rounding.js'

describe('lineTotal', () => {
  it('multiplies a whole quantity exactly', () => {
    expect(Money.toDecimalString(lineTotal(Money.fromPounds(19.99), Quantity.fromUnits(3)))).toBe(
      '59.97',
    )
  })

  it('handles weighed goods', () => {
    // 1.5 kg of tomatoes at 12.50 EGP/kg
    expect(
      Money.toDecimalString(lineTotal(Money.fromPounds(12.5), Quantity.fromMilliUnits(1500))),
    ).toBe('18.75')
    // 250 g of saffron at 40.00 EGP/kg
    expect(
      Money.toDecimalString(lineTotal(Money.fromPounds(40), Quantity.fromMilliUnits(250))),
    ).toBe('10.00')
  })

  it('rounds the sub-piastre result exactly once', () => {
    // 1.5 × 33.33 = 49.995 → 50.00 half-up
    expect(
      Money.toDecimalString(lineTotal(Money.fromPounds(33.33), Quantity.fromMilliUnits(1500))),
    ).toBe('50.00')
    expect(
      Money.toDecimalString(
        lineTotal(Money.fromPounds(33.33), Quantity.fromMilliUnits(1500), RoundingMode.FLOOR),
      ),
    ).toBe('49.99')
  })

  it('is zero for a zero quantity or a free item', () => {
    expect(Money.toPiastres(lineTotal(Money.fromPounds(19.99), Quantity.zero))).toBe(0)
    expect(Money.toPiastres(lineTotal(Money.zero, Quantity.fromUnits(5)))).toBe(0)
  })

  it('handles a negative quantity, as a return line does', () => {
    expect(Money.toDecimalString(lineTotal(Money.fromPounds(19.99), Quantity.fromUnits(-2)))).toBe(
      '-39.98',
    )
  })

  it('stays exact for a large wholesale line', () => {
    expect(
      Money.toDecimalString(lineTotal(Money.fromPounds(1234.56), Quantity.fromUnits(10_000))),
    ).toBe('12345600.00')
  })
})

describe('unitPriceFromTotal', () => {
  it('derives a unit price from a lump-sum delivery', () => {
    expect(
      Money.toDecimalString(unitPriceFromTotal(Money.fromPounds(100), Quantity.fromUnits(8))),
    ).toBe('12.50')
    expect(
      Money.toDecimalString(
        unitPriceFromTotal(Money.fromPounds(18.75), Quantity.fromMilliUnits(1500)),
      ),
    ).toBe('12.50')
  })

  it('rounds when the division is not exact', () => {
    // 100.00 / 3 = 33.333… → 33.33
    expect(
      Money.toDecimalString(unitPriceFromTotal(Money.fromPounds(100), Quantity.fromUnits(3))),
    ).toBe('33.33')
  })

  it('refuses a zero quantity instead of producing infinity', () => {
    expect(() => unitPriceFromTotal(Money.fromPounds(100), Quantity.zero)).toThrow(RangeError)
  })

  it('round-trips with lineTotal for exact cases', () => {
    const quantity = Quantity.fromUnits(4)
    const total = Money.fromPounds(50)
    const unit = unitPriceFromTotal(total, quantity)
    expect(Money.toPiastres(lineTotal(unit, quantity))).toBe(Money.toPiastres(total))
  })
})

describe('tax-inclusive pricing', () => {
  it('extracts 14% VAT from a shelf price that already includes it', () => {
    // 114.00 inclusive at 14% → 14.00 tax, 100.00 net
    const gross = Money.fromPounds(114)
    expect(Money.toDecimalString(taxFromInclusive(gross, percent(14)))).toBe('14.00')
    expect(Money.toDecimalString(netFromInclusive(gross, percent(14)))).toBe('100.00')
  })

  it('keeps net plus tax equal to gross for every amount', () => {
    const rate = percent(14)
    for (let piastres = 0; piastres <= 2000; piastres += 1) {
      const gross = Money.fromPiastres(piastres)
      const tax = taxFromInclusive(gross, rate)
      const net = netFromInclusive(gross, rate)
      expect(
        Money.toPiastres(Money.add(net, tax)),
        `net + tax must equal gross at ${piastres} piastres`,
      ).toBe(piastres)
    }
  })

  it('returns zero tax at a zero rate', () => {
    expect(Money.toPiastres(taxFromInclusive(Money.fromPounds(100), percent(0)))).toBe(0)
    expect(Money.toDecimalString(netFromInclusive(Money.fromPounds(100), percent(0)))).toBe(
      '100.00',
    )
  })

  it('handles a typical inclusive retail price', () => {
    // 19.99 inclusive at 14%: tax = 1999 × 1400 / 11400 = 245.49… → 2.45
    const gross = Money.fromPounds(19.99)
    expect(Money.toDecimalString(taxFromInclusive(gross, percent(14)))).toBe('2.45')
    expect(Money.toDecimalString(netFromInclusive(gross, percent(14)))).toBe('17.54')
  })
})
