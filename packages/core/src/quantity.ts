/**
 * Quantity — integer milli-units (3 decimal places).
 *
 * Three decimals cover what Egyptian shops actually weigh and measure: grams within a
 * kilogram, millilitres within a litre, and metres of fabric. Like `Money`, it is a branded
 * integer so it cannot be mixed up with a raw count.
 */

import { formatScaled, parseScaled, type ParseScaledOptions } from './decimal.js'
import { validationError, type XzareError } from './errors.js'
import { err, ok, type Result } from './result.js'
import { assertSafeInteger, toSafeInteger } from './rounding.js'

declare const QuantityBrand: unique symbol

export type Quantity = number & { readonly [QuantityBrand]: 'Quantity' }

export const MILLI_UNITS_PER_UNIT = 1000
export const QUANTITY_SCALE = 3

const QUANTITY_CONTEXT = 'Quantity'

function brand(milliUnits: number): Quantity {
  return milliUnits as Quantity
}

function fromBigInt(value: bigint, context: string): Quantity {
  return brand(toSafeInteger(value, context))
}

export const Quantity = {
  zero: brand(0),
  one: brand(MILLI_UNITS_PER_UNIT),

  fromMilliUnits(milliUnits: number): Quantity {
    assertSafeInteger(milliUnits, `${QUANTITY_CONTEXT}.fromMilliUnits`)
    return brand(milliUnits)
  },

  /** Whole units: `Quantity.fromUnits(3)` → 3.000. */
  fromUnits(units: number): Quantity {
    assertSafeInteger(units, `${QUANTITY_CONTEXT}.fromUnits`)
    return fromBigInt(BigInt(units) * BigInt(MILLI_UNITS_PER_UNIT), `${QUANTITY_CONTEXT}.fromUnits`)
  },

  /** Parses `"1.5"`, `"٢٫٧٥"`; `"0,750"` requires decimalSeparator: ','. */
  parse(input: unknown, options: ParseScaledOptions = {}): Result<Quantity, XzareError> {
    const parsed = parseScaled(input, QUANTITY_SCALE, {
      messageKey: 'error.validation.invalid_quantity',
      ...options,
    })
    if (!parsed.ok) return parsed
    if (
      parsed.value > BigInt(Number.MAX_SAFE_INTEGER) ||
      parsed.value < BigInt(Number.MIN_SAFE_INTEGER)
    ) {
      return err(
        validationError(
          'error.validation.invalid_quantity',
          'Quantity.parse: quantity outside safe range',
        ),
      )
    }
    return ok(fromBigInt(parsed.value, `${QUANTITY_CONTEXT}.parse`))
  },

  toMilliUnits(value: Quantity): number {
    return value as number
  },

  /** Lossy: display and export only. */
  toUnitsNumber(value: Quantity): number {
    return (value as number) / MILLI_UNITS_PER_UNIT
  },

  /** Exact ASCII decimal text with 3 places: `1.500`. */
  toDecimalString(value: Quantity): string {
    return formatScaled(value as number, QUANTITY_SCALE)
  },

  /**
   * Trims trailing zeros for display, so a cashier sees `2` and `1.5` rather than
   * `2.000` and `1.500`.
   */
  toCompactString(value: Quantity): string {
    const text = formatScaled(value as number, QUANTITY_SCALE)
    if (!text.includes('.')) return text
    return text.replace(/\.?0+$/, '')
  },

  isZero: (value: Quantity): boolean => (value as number) === 0,
  isPositive: (value: Quantity): boolean => (value as number) > 0,
  isNegative: (value: Quantity): boolean => (value as number) < 0,
  /** True when the quantity is a whole number of units — used for serialised goods. */
  isWholeUnits: (value: Quantity): boolean => (value as number) % MILLI_UNITS_PER_UNIT === 0,

  add(a: Quantity, b: Quantity): Quantity {
    return fromBigInt(BigInt(a as number) + BigInt(b as number), `${QUANTITY_CONTEXT}.add`)
  },

  subtract(a: Quantity, b: Quantity): Quantity {
    return fromBigInt(BigInt(a as number) - BigInt(b as number), `${QUANTITY_CONTEXT}.subtract`)
  },

  negate(value: Quantity): Quantity {
    return brand(-(value as number))
  },

  abs(value: Quantity): Quantity {
    return brand(Math.abs(value as number))
  },

  /** Scales by a whole factor, e.g. a recipe batch multiplier. */
  mulInteger(value: Quantity, factor: number): Quantity {
    assertSafeInteger(factor, `${QUANTITY_CONTEXT}.mulInteger`)
    return fromBigInt(BigInt(value as number) * BigInt(factor), `${QUANTITY_CONTEXT}.mulInteger`)
  },

  sum(values: Iterable<Quantity>): Quantity {
    let total = 0n
    for (const value of values) total += BigInt(value as number)
    return fromBigInt(total, `${QUANTITY_CONTEXT}.sum`)
  },

  compare(a: Quantity, b: Quantity): -1 | 0 | 1 {
    const left = a as number
    const right = b as number
    return left < right ? -1 : left > right ? 1 : 0
  },

  equals: (a: Quantity, b: Quantity): boolean => (a as number) === (b as number),
  lessThan: (a: Quantity, b: Quantity): boolean => (a as number) < (b as number),
  lessThanOrEqual: (a: Quantity, b: Quantity): boolean => (a as number) <= (b as number),
  greaterThan: (a: Quantity, b: Quantity): boolean => (a as number) > (b as number),
  greaterThanOrEqual: (a: Quantity, b: Quantity): boolean => (a as number) >= (b as number),

  min: (a: Quantity, b: Quantity): Quantity => ((a as number) <= (b as number) ? a : b),
  max: (a: Quantity, b: Quantity): Quantity => ((a as number) >= (b as number) ? a : b),
} as const
