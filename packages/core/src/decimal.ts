/**
 * Decimal text → scaled integer parsing, shared by `Money` (scale 2) and `Quantity` (scale 3).
 *
 * Parsing deliberately avoids `parseFloat`: converting "0.07" through a binary float and
 * back is exactly the class of error that produces one-piastre discrepancies in a day's
 * takings. Digits are handled as text and assembled into an integer.
 *
 * Egyptian keyboards and pasted data routinely contain Arabic-Indic numerals and Arabic
 * separators, so those are accepted as first-class input rather than rejected.
 */

import { validationError, type XzareError } from './errors.js'
import { err, ok, type Result } from './result.js'
import { DEFAULT_ROUNDING, divideRounded, type RoundingMode } from './rounding.js'

const ARABIC_INDIC_ZERO = 0x0660
const ARABIC_INDIC_NINE = 0x0669
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0
const EXTENDED_ARABIC_INDIC_NINE = 0x06f9
const ARABIC_DECIMAL_SEPARATOR = 0x066b
const ARABIC_THOUSANDS_SEPARATOR = 0x066c
const ASCII_ZERO = 48

/**
 * Converts Arabic-Indic (٠-٩) and extended Arabic-Indic/Persian (۰-۹) digits to ASCII,
 * the Arabic decimal separator (٫) to '.', and drops the Arabic thousands separator (٬).
 */
export function normaliseNumerals(input: string): string {
  let out = ''
  for (const char of input) {
    const cp = char.codePointAt(0)
    if (cp === undefined) continue

    if (cp >= ARABIC_INDIC_ZERO && cp <= ARABIC_INDIC_NINE) {
      out += String.fromCharCode(cp - ARABIC_INDIC_ZERO + ASCII_ZERO)
    } else if (cp >= EXTENDED_ARABIC_INDIC_ZERO && cp <= EXTENDED_ARABIC_INDIC_NINE) {
      out += String.fromCharCode(cp - EXTENDED_ARABIC_INDIC_ZERO + ASCII_ZERO)
    } else if (cp === ARABIC_DECIMAL_SEPARATOR) {
      out += '.'
    } else if (cp === ARABIC_THOUSANDS_SEPARATOR) {
      // grouping only — carries no value
    } else {
      out += char
    }
  }
  return out
}

const BIDI_FORMATTING = /[⁦⁧⁨⁩‎‏]/g
export const MAX_DECIMAL_INPUT_LENGTH = 256
const MAX_SCALE = 18

const DECIMAL_PATTERN = /^([+-]?)(\d*)(?:\.(\d*))?$/

export interface ParseScaledOptions {
  /** ASCII decimal separator. Default '.', never guessed from ambiguous input. */
  readonly decimalSeparator?: '.' | ','
  /**
   * When the input has more decimal places than `scale` allows:
   * `false` (default) rejects it so a cashier is told rather than silently charged a
   * rounded amount; `true` rounds, which suits bulk imports.
   */
  readonly roundExcessPrecision?: boolean
  readonly rounding?: RoundingMode
  /** i18n key used for the rejection message. */
  readonly messageKey?: string
}

/**
 * Parses decimal text into an integer scaled by `10 ** scale`.
 * Accepts a leading sign, accounting-style parentheses for negatives, Arabic numerals,
 * and grouping separators.
 */
export function parseScaled(
  input: unknown,
  scale: number,
  options: ParseScaledOptions = {},
): Result<bigint, XzareError> {
  assertScale(scale)
  const messageKey = options.messageKey ?? 'error.validation.invalid_number'
  const reject = (reason: string, key = messageKey) =>
    err(
      validationError(key, `parseScaled: ${reason}`, {
        params: { scale },
      }),
    )

  if (typeof input !== 'string') return reject('input must be a string')
  if (input.length > MAX_DECIMAL_INPUT_LENGTH) return reject('input is too long')
  const decimalSeparator = options.decimalSeparator ?? '.'
  if (decimalSeparator !== '.' && decimalSeparator !== ',')
    return reject('invalid decimal separator')

  // Preserve Arabic grouping long enough to validate it instead of silently deleting it.
  let text = normaliseNumerals(input.replace(/٬/g, "'")).replace(BIDI_FORMATTING, '').trim()
  if (text.length === 0) return reject('input is empty')

  // Accounting notation: (1,234.50) means −1234.50
  let parenthesisedNegative = false
  if (text.startsWith('(') && text.endsWith(')')) {
    parenthesisedNegative = true
    text = text.slice(1, -1).trim()
    if (/^[+-]/.test(text)) return reject('parentheses cannot be combined with a sign')
  }

  if (decimalSeparator === ',') {
    if (text.includes('.') && text.includes(',')) return reject('mixed decimal separators')
    text = text.replace(',', '.')
  }
  const signPrefix = /^[+-]/.test(text) ? text[0] : ''
  const unsigned = signPrefix ? text.slice(1) : text
  const [groupedWhole = '', fraction] = unsigned.split('.')
  const grouping = /[, '  ]/.exec(groupedWhole)?.[0]
  let wholeText = groupedWhole
  if (grouping !== undefined) {
    const groups = groupedWhole.split(grouping)
    if (
      !/^[1-9]\d{0,2}$/.test(groups[0] ?? '') ||
      groups.slice(1).some((group) => !/^\d{3}$/.test(group))
    ) {
      return reject('invalid thousands grouping')
    }
    wholeText = groups.join('')
  }
  text = `${signPrefix ?? ''}${wholeText}${fraction === undefined ? '' : `.${fraction}`}`
  if (unsigned.split('.').length > 2) return reject('multiple decimal separators')
  if (text.length === 0) return reject('input contains no digits')

  const match = DECIMAL_PATTERN.exec(text)
  if (match === null) return reject('input is not a well-formed decimal number')

  const [, sign = '', wholePart = '', fractionPart] = match
  if (wholePart.length === 0 && (fractionPart === undefined || fractionPart.length === 0)) {
    return reject('input contains no digits')
  }

  const negative = parenthesisedNegative !== (sign === '-')
  const whole = wholePart.length === 0 ? 0n : BigInt(wholePart)
  const factor = 10n ** BigInt(scale)

  let scaled: bigint
  if (fractionPart === undefined || fractionPart.length === 0) {
    scaled = whole * factor
  } else if (fractionPart.length <= scale) {
    const padded = fractionPart.padEnd(scale, '0')
    scaled = whole * factor + BigInt(padded)
  } else {
    if (options.roundExcessPrecision !== true) {
      return reject(
        `input has ${fractionPart.length} decimal places but at most ${scale} are allowed`,
        'error.validation.too_many_decimals',
      )
    }
    const exact = whole * 10n ** BigInt(fractionPart.length) + BigInt(fractionPart)
    scaled = divideRounded(
      negative ? -exact : exact,
      10n ** BigInt(fractionPart.length - scale),
      options.rounding ?? DEFAULT_ROUNDING,
    )
    return ok(scaled)
  }

  return ok(negative ? -scaled : scaled)
}

/** Renders a scaled integer as plain decimal text with exactly `scale` decimal places. */
export function formatScaled(value: number | bigint, scale: number): string {
  assertScale(scale)
  if (typeof value === 'number' && !Number.isSafeInteger(value)) {
    throw new RangeError('formatScaled: value must be a safe integer')
  }
  const asBigInt = typeof value === 'bigint' ? value : BigInt(value)
  const negative = asBigInt < 0n
  const absolute = negative ? -asBigInt : asBigInt
  const factor = 10n ** BigInt(scale)
  const whole = absolute / factor
  const fraction = absolute % factor
  const sign = negative ? '-' : ''
  if (scale === 0) return `${sign}${whole.toString()}`
  return `${sign}${whole.toString()}.${fraction.toString().padStart(scale, '0')}`
}

function assertScale(scale: number): void {
  if (!Number.isInteger(scale) || scale < 0 || scale > MAX_SCALE) {
    throw new RangeError(`decimal scale must be an integer between 0 and ${MAX_SCALE}`)
  }
}
