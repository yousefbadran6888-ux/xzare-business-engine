/**
 * Integer rounding for fixed-point arithmetic.
 *
 * All scaling (unit price × quantity, tax rates, commissions) runs through `divideRounded`,
 * so the suite has exactly one place where a rounding decision is made. Intermediate
 * arithmetic uses BigInt: a 1,000,000 EGP invoice line at 3-decimal quantity already
 * exceeds Number.MAX_SAFE_INTEGER when multiplied out.
 */

export const RoundingMode = {
  /** Ties away from zero — the standard commercial convention, and the suite default. */
  HALF_UP: 'half_up',
  /** Ties to the nearest even value — reduces bias when aggregating many roundings. */
  HALF_EVEN: 'half_even',
  /** Toward zero. */
  TRUNCATE: 'truncate',
  /** Toward +∞. */
  CEIL: 'ceil',
  /** Toward −∞. */
  FLOOR: 'floor',
} as const

export type RoundingMode = (typeof RoundingMode)[keyof typeof RoundingMode]

export const DEFAULT_ROUNDING: RoundingMode = RoundingMode.HALF_UP

/**
 * Divides `numerator` by `denominator`, returning an integer rounded per `mode`.
 * `denominator` must be non-zero; a zero denominator is a programming error, not a
 * business failure, so it throws.
 */
export function divideRounded(
  numerator: bigint,
  denominator: bigint,
  mode: RoundingMode = DEFAULT_ROUNDING,
): bigint {
  if (!Object.values(RoundingMode).includes(mode)) {
    throw new RangeError('divideRounded: unsupported rounding mode')
  }
  if (denominator === 0n) {
    throw new RangeError('divideRounded: denominator must not be zero')
  }

  // Normalise so the denominator is always positive; the sign rides with the numerator.
  let n = numerator
  let d = denominator
  if (d < 0n) {
    n = -n
    d = -d
  }

  // BigInt division truncates toward zero, so `remainder` keeps the numerator's sign.
  const quotient = n / d
  const remainder = n % d
  if (remainder === 0n) return quotient

  const negative = remainder < 0n
  const twiceAbsRemainder = (negative ? -remainder : remainder) * 2n

  switch (mode) {
    case RoundingMode.TRUNCATE:
      return quotient

    case RoundingMode.CEIL:
      return negative ? quotient : quotient + 1n

    case RoundingMode.FLOOR:
      return negative ? quotient - 1n : quotient

    case RoundingMode.HALF_UP: {
      if (twiceAbsRemainder < d) return quotient
      return negative ? quotient - 1n : quotient + 1n
    }

    case RoundingMode.HALF_EVEN: {
      if (twiceAbsRemainder < d) return quotient
      if (twiceAbsRemainder > d) return negative ? quotient - 1n : quotient + 1n
      // Exact tie: move only if the quotient is odd.
      if (quotient % 2n === 0n) return quotient
      return negative ? quotient - 1n : quotient + 1n
    }
  }
}

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER)
const MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER)

/**
 * Converts a BigInt back to a `number`, refusing values that would silently lose
 * precision. Hitting this means a genuinely absurd amount (> ~90 trillion EGP) or a bug;
 * either way it must surface loudly rather than corrupt a total.
 */
export function toSafeInteger(value: bigint, context: string): number {
  if (value > MAX_SAFE || value < MIN_SAFE) {
    throw new RangeError(
      `${context}: result ${value.toString()} exceeds the safe integer range and cannot be represented exactly`,
    )
  }
  return Number(value)
}

/** Asserts that a `number` is a usable integer for fixed-point storage. */
export function assertSafeInteger(value: number, context: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${context}: value must be finite, received ${String(value)}`)
  }
  if (!Number.isInteger(value)) {
    throw new RangeError(`${context}: value must be an integer, received ${String(value)}`)
  }
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${context}: value ${String(value)} is outside the safe integer range`)
  }
}
