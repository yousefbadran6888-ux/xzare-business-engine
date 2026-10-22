import { Money } from './money.js'
import { Quantity } from './quantity.js'
import { divideRounded, toSafeInteger } from './rounding.js'

/**
 * Exact original inventory value plus cumulative consumption. A rounded unit price is
 * never the source of truth. Persist totalCost, totalQuantity and consumedQuantity together
 * with the stock movement; returns must reverse the original recorded cost.
 */
export class CostBasis {
  private constructor(
    readonly totalCost: Money,
    readonly totalQuantity: Quantity,
    readonly consumedQuantity: Quantity,
  ) {
    Money.fromPiastres(totalCost)
    Quantity.fromMilliUnits(totalQuantity)
    Quantity.fromMilliUnits(consumedQuantity)
    if (
      totalCost < 0 ||
      totalQuantity <= 0 ||
      consumedQuantity < 0 ||
      consumedQuantity > totalQuantity
    ) {
      throw new RangeError('CostBasis: invalid cost, total quantity or consumed quantity')
    }
    Object.freeze(this)
  }

  static create(totalCost: Money, totalQuantity: Quantity): CostBasis {
    return new CostBasis(totalCost, totalQuantity, Quantity.zero)
  }

  /** Rehydrate the three integer fields persisted with stock movements, validating invariants. */
  static restore(totalCost: Money, totalQuantity: Quantity, consumedQuantity: Quantity): CostBasis {
    return new CostBasis(totalCost, totalQuantity, consumedQuantity)
  }

  private cumulativeCost(consumed: Quantity): Money {
    return Money.fromPiastres(
      toSafeInteger(
        divideRounded(BigInt(this.totalCost) * BigInt(consumed), BigInt(this.totalQuantity)),
        'CostBasis.cumulativeCost',
      ),
    )
  }

  get remainingQuantity(): Quantity {
    return Quantity.subtract(this.totalQuantity, this.consumedQuantity)
  }

  get remainingCost(): Money {
    return Money.subtract(this.totalCost, this.cumulativeCost(this.consumedQuantity))
  }

  take(quantity: Quantity): Readonly<{ cost: Money; remaining: CostBasis }> {
    Quantity.fromMilliUnits(quantity)
    if (quantity <= 0 || quantity > this.remainingQuantity) {
      throw new RangeError('CostBasis.take: quantity must be positive and within remaining stock')
    }
    const consumed = Quantity.add(this.consumedQuantity, quantity)
    const cost = Money.subtract(
      this.cumulativeCost(consumed),
      this.cumulativeCost(this.consumedQuantity),
    )
    return Object.freeze({
      cost,
      remaining: new CostBasis(this.totalCost, this.totalQuantity, consumed),
    })
  }
}
