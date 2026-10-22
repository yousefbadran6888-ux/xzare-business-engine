import { describe, expect, it } from 'vitest'
import { CostBasis } from './index.js'
import { Money } from './money.js'
import { Quantity } from './quantity.js'

describe('cost allocation preserving the original total', () => {
  it('retains the last piastre when consuming three units bought for 1.00', () => {
    let basis = CostBasis.create(Money.fromPounds(1), Quantity.fromUnits(3))
    const original = basis
    const costs: Money[] = []
    for (let i = 0; i < 3; i++) {
      const part = basis.take(Quantity.one)
      costs.push(part.cost)
      basis = part.remaining
    }
    expect(costs.map(Money.toDecimalString)).toEqual(['0.33', '0.34', '0.33'])
    expect(Money.sum(costs)).toBe(Money.fromPounds(1))
    expect(basis.remainingCost).toBe(Money.zero)
    expect(basis.remainingQuantity).toBe(Quantity.zero)
    expect(original.remainingCost).toBe(Money.fromPounds(1))
  })
  it('allocates weighted quantities and consumes their exact total', () => {
    let basis = CostBasis.create(Money.fromPiastres(101), Quantity.fromMilliUnits(1500))
    let consumed = Money.zero
    for (const milli of [1, 249, 750, 500]) {
      const part = basis.take(Quantity.fromMilliUnits(milli))
      consumed = Money.add(consumed, part.cost)
      basis = part.remaining
    }
    expect(consumed).toBe(Money.fromPiastres(101))
  })
  it('rejects invalid cost bases and over-consumption', () => {
    expect(() => CostBasis.create(Money.fromPiastres(-1), Quantity.one)).toThrow(RangeError)
    expect(() => CostBasis.create(Money.zero, Quantity.zero)).toThrow(RangeError)
    const basis = CostBasis.create(Money.fromPounds(1), Quantity.one)
    expect(() => basis.take(Quantity.fromUnits(2))).toThrow(RangeError)
    expect(() => basis.take(Quantity.zero)).toThrow(RangeError)
    expect(() => basis.take(Quantity.fromMilliUnits(-1))).toThrow(RangeError)
  })
  it('conserves cost over many fractional partial consumptions', () => {
    for (let total = 0; total <= 100; total++) {
      let basis = CostBasis.create(Money.fromPiastres(total), Quantity.fromMilliUnits(17))
      let consumed = Money.zero
      for (let i = 0; i < 17; i++) {
        const result = basis.take(Quantity.fromMilliUnits(1))
        consumed = Money.add(consumed, result.cost)
        basis = result.remaining
        expect(Money.add(consumed, basis.remainingCost)).toBe(Money.fromPiastres(total))
      }
    }
  })
  it('resumes a persisted cost basis without changing rounding distribution', () => {
    const original = CostBasis.create(Money.fromPounds(1), Quantity.fromUnits(3)).take(
      Quantity.one,
    ).remaining
    const restored = CostBasis.restore(
      original.totalCost,
      original.totalQuantity,
      original.consumedQuantity,
    )
    expect(restored.take(Quantity.one).cost).toBe(Money.fromPiastres(34))
    expect(restored.remainingCost).toBe(original.remainingCost)
  })
  it('rejects forged persisted consumption', () => {
    const restore = CostBasis.restore
    expect(() => restore(Money.zero, Quantity.one, Quantity.fromUnits(2))).toThrow(RangeError)
    expect(() => restore(Money.zero, Quantity.one, Quantity.fromMilliUnits(-1))).toThrow(RangeError)
  })
})
