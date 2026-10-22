import { err, ok, validationError, type Result } from '@xzare/core'

export type BarcodeFormat = 'EAN8' | 'EAN13' | 'UPCA' | 'GTIN14' | 'CODE128'
export interface Barcode {
  readonly value: string
  readonly format: BarcodeFormat
}
const lengths = new Map<BarcodeFormat, number>([
  ['EAN8', 8],
  ['EAN13', 13],
  ['UPCA', 12],
  ['GTIN14', 14],
])
const invalid = () =>
  err(validationError('error.barcode.invalid', 'Invalid barcode syntax or check digit'))

/** Modulo-10 for GTIN-length payloads; this does not allocate or authenticate a GS1 identity. */
export function gs1CheckDigit(payload: unknown): Result<string> {
  if (
    typeof payload !== 'string' ||
    ![7, 11, 12, 13].includes(payload.length) ||
    !/^[0-9]+$/.test(payload)
  )
    return invalid()
  let sum = 0
  for (let i = payload.length - 1, weight = 3; i >= 0; i--, weight = weight === 3 ? 1 : 3) {
    sum += (payload.charCodeAt(i) - 48) * weight
  }
  return ok(String((10 - (sum % 10)) % 10))
}
export const Barcode = Object.freeze({
  /** Explicit format avoids guessing whether numeric internal codes are GTINs or local scale labels. */
  parse(input: unknown, format: unknown): Result<Barcode> {
    if (typeof input !== 'string' || input.length < 1 || input.length > 64) return invalid()
    if (format === 'CODE128') {
      // Application's internal-code subset; no control bytes, URLs, markup or implicit case changes.
      if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(input)) return invalid()
      return ok(Object.freeze({ value: input, format }))
    }
    if (typeof format !== 'string' || !lengths.has(format as BarcodeFormat)) return invalid()
    const checkedFormat = format as Exclude<BarcodeFormat, 'CODE128'>
    if (input.length !== lengths.get(checkedFormat) || !/^[0-9]+$/.test(input)) return invalid()
    const check = gs1CheckDigit(input.slice(0, -1))
    if (!check.ok || check.value !== input.at(-1)) return invalid()
    return ok(Object.freeze({ value: input, format: checkedFormat }))
  },
})
