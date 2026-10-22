/**
 * Money — integer piastres (1 EGP = 100 piastres).
 *
 * Floating-point money is banned across the suite (ARCHITECTURE.md §19, D3). `Money` is a
 * branded integer, so a raw `number` cannot be passed where money is expected without going
 * through a checked constructor. Intermediate arithmetic widens to BigInt and is checked on
 * the way back, so a total can never silently lose precision.
 */

import {
  formatScaled,
  MAX_DECIMAL_INPUT_LENGTH,
  parseScaled,
  type ParseScaledOptions,
} from './decimal.js'
import { validationError, type XzareError } from './errors.js'
import { err, ok, type Result } from './result.js'
import {
  assertSafeInteger,
  DEFAULT_ROUNDING,
  divideRounded,
  toSafeInteger,
  type RoundingMode,
} from './rounding.js'

declare const MoneyBrand: unique symbol

/** An amount in whole piastres. Construct via `Money.*`, never by casting. */
export type Money = number & { readonly [MoneyBrand]: 'Money' }

/** Basis points: 1% = 100 bp, 14% VAT = 1400 bp. Keeps tax rates exact. */
declare const BasisPointsBrand: unique symbol
export type BasisPoints = number & { readonly [BasisPointsBrand]: 'BasisPoints' }

export const PIASTRES_PER_POUND = 100
export const MONEY_SCALE = 2
export const BASIS_POINTS_SCALE = 10_000

const MONEY_CONTEXT = 'Money'

function brand(piastres: number): Money {
  return piastres as Money
}

function fromBigInt(value: bigint, context: string): Money {
  return brand(toSafeInteger(value, context))
}

/** Creates `BasisPoints` from an integer, e.g. `basisPoints(1400)` for 14%. */
export function basisPoints(value: number): BasisPoints {
  assertSafeInteger(value, 'BasisPoints')
  return value as BasisPoints
}

/** Creates `BasisPoints` from a percentage, e.g. `percent(14)` → 1400 bp. Max 2 decimals. */
export function percent(value: number): BasisPoints {
  const scaled = Math.round(value * 100)
  if (Math.abs(value * 100 - scaled) > 1e-9) {
    throw new RangeError(`percent: ${String(value)} needs more than 2 decimal places of precision`)
  }
  return basisPoints(scaled)
}

export const Money = {
  /** Zero. */
  zero: brand(0),

  /** Wraps a raw piastre integer. Throws on non-integer or unsafe input. */
  fromPiastres(piastres: number): Money {
    assertSafeInteger(piastres, `${MONEY_CONTEXT}.fromPiastres`)
    return brand(piastres)
  },

  /**
   * Converts pounds to money. Accepts a float for developer convenience but routes through
   * text to avoid binary rounding artefacts (`19.99` must never become 1998 piastres).
   */
  fromPounds(pounds: number): Money {
    if (!Number.isFinite(pounds)) {
      throw new RangeError(`${MONEY_CONTEXT}.fromPounds: value must be finite`)
    }
    if (Math.abs(pounds) >= 1e15) {
      throw new RangeError(`${MONEY_CONTEXT}.fromPounds: ${String(pounds)} is too large`)
    }
    const parsed = parseScaled(pounds.toFixed(10), MONEY_SCALE, { roundExcessPrecision: true })
    if (!parsed.ok) throw parsed.error
    return fromBigInt(parsed.value, `${MONEY_CONTEXT}.fromPounds`)
  },

  /**
   * Parses user or imported text ("1,234.50", "١٢٣٤٫٥٠", "(99.00)", "1234.50 ج.م").
   * Returns a `Result` because invalid input is an expected condition, not a bug.
   */
  parse(input: unknown, options: ParseScaledOptions = {}): Result<Money, XzareError> {
    const stripped = stripCurrencyTokens(input)
    const parsed = parseScaled(stripped, MONEY_SCALE, {
      messageKey: 'error.validation.invalid_amount',
      ...options,
    })
    if (!parsed.ok) return parsed
    if (
      parsed.value > BigInt(Number.MAX_SAFE_INTEGER) ||
      parsed.value < BigInt(Number.MIN_SAFE_INTEGER)
    ) {
      return err(
        validationError(
          'error.validation.invalid_amount',
          'Money.parse: amount outside safe range',
        ),
      )
    }
    return ok(fromBigInt(parsed.value, `${MONEY_CONTEXT}.parse`))
  },

  toPiastres(value: Money): number {
    return value as number
  },

  /** Lossy: for display and export only. Never feed the result back into arithmetic. */
  toPoundsNumber(value: Money): number {
    return (value as number) / PIASTRES_PER_POUND
  },

  /** Exact ASCII decimal text, always 2 places: `-1234.50`. Use for CSV and storage. */
  toDecimalString(value: Money): string {
    return formatScaled(value as number, MONEY_SCALE)
  },

  isZero: (value: Money): boolean => (value as number) === 0,
  isPositive: (value: Money): boolean => (value as number) > 0,
  isNegative: (value: Money): boolean => (value as number) < 0,

  add(a: Money, b: Money): Money {
    return fromBigInt(BigInt(a as number) + BigInt(b as number), `${MONEY_CONTEXT}.add`)
  },

  subtract(a: Money, b: Money): Money {
    return fromBigInt(BigInt(a as number) - BigInt(b as number), `${MONEY_CONTEXT}.subtract`)
  },

  negate(value: Money): Money {
    return brand(-(value as number))
  },

  abs(value: Money): Money {
    return brand(Math.abs(value as number))
  },

  /** Multiplies by a whole count. For fractional quantities use `mulQuantity`. */
  mulInteger(value: Money, factor: number): Money {
    assertSafeInteger(factor, `${MONEY_CONTEXT}.mulInteger`)
    return fromBigInt(BigInt(value as number) * BigInt(factor), `${MONEY_CONTEXT}.mulInteger`)
  },

  sum(values: Iterable<Money>): Money {
    let total = 0n
    for (const value of values) total += BigInt(value as number)
    return fromBigInt(total, `${MONEY_CONTEXT}.sum`)
  },

  /**
   * Applies a basis-point rate: tax, discount percentage, commission.
   * `applyRate(Money.fromPounds(100), percent(14))` → 14.00 EGP.
   */
  applyRate(value: Money, rate: BasisPoints, mode: RoundingMode = DEFAULT_ROUNDING): Money {
    const scaled = divideRounded(
      BigInt(value as number) * BigInt(rate as number),
      BigInt(BASIS_POINTS_SCALE),
      mode,
    )
    return fromBigInt(scaled, `${MONEY_CONTEXT}.applyRate`)
  },

  /**
   * Distributes `total` across `weights` using the largest-remainder method.
   *
   * The parts always re-sum to exactly `total` — no piastre is created or lost. This is what
   * makes split bills, multi-payment allocation and proportional invoice-level discounts
   * reconcile. Leftover piastres go to the largest remainders first, ties by lowest index,
   * so the outcome is deterministic and reproducible in an audit.
   */
  allocate(total: Money, weights: readonly number[]): Money[] {
    if (weights.length === 0) {
      throw new RangeError(`${MONEY_CONTEXT}.allocate: at least one weight is required`)
    }

    let totalWeight = 0n
    for (const weight of weights) {
      assertSafeInteger(weight, `${MONEY_CONTEXT}.allocate weight`)
      if (weight < 0) {
        throw new RangeError(`${MONEY_CONTEXT}.allocate: weights must not be negative`)
      }
      totalWeight += BigInt(weight)
    }

    // All weights zero carries no proportional information; fall back to an even split.
    if (totalWeight === 0n) return Money.split(total, weights.length)

    const totalBig = BigInt(total as number)
    const negative = totalBig < 0n
    const absolute = negative ? -totalBig : totalBig

    const parts: bigint[] = new Array<bigint>(weights.length).fill(0n)
    const remainders: { index: number; remainder: bigint }[] = []
    let distributed = 0n

    for (let index = 0; index < weights.length; index += 1) {
      const weight = BigInt(weights[index] as number)
      const numerator = absolute * weight
      const share = numerator / totalWeight
      parts[index] = share
      distributed += share
      remainders.push({ index, remainder: numerator % totalWeight })
    }

    remainders.sort((a, b) =>
      a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
    )

    let leftover = absolute - distributed
    for (let position = 0; leftover > 0n; position += 1, leftover -= 1n) {
      const target = remainders[position % remainders.length] as { index: number }
      parts[target.index] = (parts[target.index] as bigint) + 1n
    }

    return parts.map((part) => fromBigInt(negative ? -part : part, `${MONEY_CONTEXT}.allocate`))
  },

  /** Splits `total` into `count` parts as evenly as possible, re-summing exactly. */
  split(total: Money, count: number): Money[] {
    assertSafeInteger(count, `${MONEY_CONTEXT}.split count`)
    if (count <= 0) {
      throw new RangeError(`${MONEY_CONTEXT}.split: count must be at least 1`)
    }

    const totalBig = BigInt(total as number)
    const negative = totalBig < 0n
    const absolute = negative ? -totalBig : totalBig
    const countBig = BigInt(count)
    const base = absolute / countBig
    let leftover = absolute % countBig

    const parts: Money[] = []
    for (let index = 0; index < count; index += 1) {
      let part = base
      if (leftover > 0n) {
        part += 1n
        leftover -= 1n
      }
      parts.push(fromBigInt(negative ? -part : part, `${MONEY_CONTEXT}.split`))
    }
    return parts
  },

  compare(a: Money, b: Money): -1 | 0 | 1 {
    const left = a as number
    const right = b as number
    return left < right ? -1 : left > right ? 1 : 0
  },

  equals: (a: Money, b: Money): boolean => (a as number) === (b as number),
  lessThan: (a: Money, b: Money): boolean => (a as number) < (b as number),
  lessThanOrEqual: (a: Money, b: Money): boolean => (a as number) <= (b as number),
  greaterThan: (a: Money, b: Money): boolean => (a as number) > (b as number),
  greaterThanOrEqual: (a: Money, b: Money): boolean => (a as number) >= (b as number),

  min: (a: Money, b: Money): Money => ((a as number) <= (b as number) ? a : b),
  max: (a: Money, b: Money): Money => ((a as number) >= (b as number) ? a : b),

  clamp(value: Money, low: Money, high: Money): Money {
    if ((low as number) > (high as number)) {
      throw new RangeError(`${MONEY_CONTEXT}.clamp: low bound exceeds high bound`)
    }
    return (value as number) < (low as number)
      ? low
      : (value as number) > (high as number)
        ? high
        : value
  },
} as const

const CURRENCY_PREFIX = /^(?:ج\.م\.?|جنيه|جم|EGP|L\.E\.?|LE|E£|£)\s*/i
const CURRENCY_SUFFIX = /\s*(?:ج\.م\.?|جنيه|جم|EGP|L\.E\.?|LE|E£|£)$/i

function stripCurrencyTokens(input: unknown): unknown {
  if (typeof input !== 'string' || input.length > MAX_DECIMAL_INPUT_LENGTH) return input
  const text = input.trim()
  // Strip a single boundary token only; repeated or embedded tokens remain invalid.
  return CURRENCY_PREFIX.test(text)
    ? text.replace(CURRENCY_PREFIX, '')
    : text.replace(CURRENCY_SUFFIX, '')
}
