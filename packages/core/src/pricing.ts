/**
 * Pricing — the bridge between `Money` and `Quantity`.
 *
 * Kept separate so neither primitive depends on the other, and so that every
 * price × quantity calculation in the suite goes through one audited function.
 */

import { Money, type BasisPoints } from './money.js'
import { MILLI_UNITS_PER_UNIT, Quantity } from './quantity.js'
import { DEFAULT_ROUNDING, divideRounded, toSafeInteger, type RoundingMode } from './rounding.js'

/**
 * Line total = unit price × quantity, rounded once to the piastre.
 *
 * Rounding happens exactly here and nowhere else in the chain, which is why a line of
 * 1.5 kg at 33.33 EGP is 50.00 EGP (49.995 → half-up) rather than drifting by sub-piastre
 * amounts accumulated across a long receipt.
 */
export function lineTotal(
  unitPrice: Money,
  quantity: Quantity,
  mode: RoundingMode = DEFAULT_ROUNDING,
): Money {
  const scaled = divideRounded(
    BigInt(Money.toPiastres(unitPrice)) * BigInt(Quantity.toMilliUnits(quantity)),
    BigInt(MILLI_UNITS_PER_UNIT),
    mode,
  )
  return Money.fromPiastres(toSafeInteger(scaled, 'pricing.lineTotal'))
}

/**
 * Unit price implied by a total and a quantity — used when a supplier invoices a lump sum
 * for a weighed delivery. This is a rounded price, not an exact inventory-cost basis.
 * Use CostBasis to retain total value and rounding remainders during stock consumption.
 */
export function unitPriceFromTotal(
  total: Money,
  quantity: Quantity,
  mode: RoundingMode = DEFAULT_ROUNDING,
): Money {
  const milliUnits = Quantity.toMilliUnits(quantity)
  if (milliUnits === 0) {
    throw new RangeError('pricing.unitPriceFromTotal: quantity must not be zero')
  }
  const scaled = divideRounded(
    BigInt(Money.toPiastres(total)) * BigInt(MILLI_UNITS_PER_UNIT),
    BigInt(milliUnits),
    mode,
  )
  return Money.fromPiastres(toSafeInteger(scaled, 'pricing.unitPriceFromTotal'))
}

/**
 * Extracts the tax already contained in a tax-inclusive price.
 *
 * Egyptian retail commonly displays shelf prices with VAT included, so the receipt has to
 * work backwards: `tax = gross × rate / (10000 + rate)`.
 */
export function taxFromInclusive(
  grossAmount: Money,
  rate: BasisPoints,
  mode: RoundingMode = DEFAULT_ROUNDING,
): Money {
  const rateValue = BigInt(rate as number)
  const denominator = 10_000n + rateValue
  if (denominator === 0n) {
    throw new RangeError('pricing.taxFromInclusive: rate must not be -100%')
  }
  const scaled = divideRounded(BigInt(Money.toPiastres(grossAmount)) * rateValue, denominator, mode)
  return Money.fromPiastres(toSafeInteger(scaled, 'pricing.taxFromInclusive'))
}

/** Net amount of a tax-inclusive price: `gross − taxFromInclusive(gross, rate)`. */
export function netFromInclusive(
  grossAmount: Money,
  rate: BasisPoints,
  mode: RoundingMode = DEFAULT_ROUNDING,
): Money {
  return Money.subtract(grossAmount, taxFromInclusive(grossAmount, rate, mode))
}
