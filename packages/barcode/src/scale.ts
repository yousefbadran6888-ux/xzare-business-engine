import { Money, Quantity, err, ok, validationError, type Result } from '@xzare/core'
import { Barcode, gs1CheckDigit } from './identity.js'
import { readData } from './data.js'

export interface ScaleProfile {
  readonly id: string
  readonly prefix: string
  readonly productDigits: number
  readonly valueDigits: number
  readonly kind: 'weight' | 'price'
  readonly decimals: number
}
export type ScaleReading = Readonly<{ code: string; profileId: string; productCode: string }> &
  (Readonly<{ kind: 'weight'; quantity: Quantity }> | Readonly<{ kind: 'price'; total: Money }>)
export type ScaleAmount =
  Readonly<{ kind: 'weight'; quantity: Quantity }> | Readonly<{ kind: 'price'; total: Money }>

const invalidProfile = () =>
  err(validationError('error.barcode.profile', 'Invalid or overlapping scale profiles'))
const invalidLabel = () =>
  err(validationError('error.barcode.scale', 'Invalid scale barcode or amount'))
const fields = ['id', 'prefix', 'productDigits', 'valueDigits', 'kind', 'decimals'] as const

export class ScaleBarcodeCodec {
  readonly #profiles: readonly ScaleProfile[]

  private constructor(profiles: readonly ScaleProfile[]) {
    this.#profiles = Object.freeze(profiles)
    Object.freeze(this)
  }

  static create(profiles: unknown): Result<ScaleBarcodeCodec> {
    try {
      if (!Array.isArray(profiles) || profiles.length < 1 || profiles.length > 32)
        return invalidProfile()
      const checked: ScaleProfile[] = []
      for (let i = 0; i < profiles.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(profiles, String(i))
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) return invalidProfile()
        const data = readData(descriptor.value, fields)
        if (!data) return invalidProfile()
        const { id, prefix, productDigits, valueDigits, kind, decimals } = data
        if (
          typeof id !== 'string' ||
          !/^[A-Za-z0-9_-]{1,32}$/.test(id) ||
          typeof prefix !== 'string' ||
          !/^[0-9]{1,10}$/.test(prefix) ||
          typeof productDigits !== 'number' ||
          !Number.isInteger(productDigits) ||
          productDigits < 1 ||
          productDigits > 9 ||
          typeof valueDigits !== 'number' ||
          !Number.isInteger(valueDigits) ||
          valueDigits < 1 ||
          valueDigits > 9 ||
          prefix.length + productDigits + valueDigits !== 12 ||
          (kind !== 'weight' && kind !== 'price') ||
          typeof decimals !== 'number' ||
          !Number.isInteger(decimals) ||
          (kind === 'price' ? decimals !== 2 : decimals < 0 || decimals > 3)
        )
          return invalidProfile()
        if (
          checked.some(
            (p) => p.id === id || p.prefix.startsWith(prefix) || prefix.startsWith(p.prefix),
          )
        )
          return invalidProfile()
        checked.push(Object.freeze({ id, prefix, productDigits, valueDigits, kind, decimals }))
      }
      return ok(new ScaleBarcodeCodec(checked))
    } catch {
      return invalidProfile()
    }
  }

  /** Requires an administrator-configured local RCN layout. No default country/prefix assumptions. */
  decode(input: unknown): Result<ScaleReading> {
    const barcode = Barcode.parse(input, 'EAN13')
    if (!barcode.ok) return barcode
    const code = barcode.value.value
    const profile = this.#profiles.find((p) => code.startsWith(p.prefix))
    if (!profile) return invalidLabel()
    const start = profile.prefix.length
    const productCode = code.slice(start, start + profile.productDigits)
    const raw = Number(code.slice(start + profile.productDigits, -1))
    if (raw <= 0) return invalidLabel()
    const common = { code, profileId: profile.id, productCode }
    return profile.kind === 'weight'
      ? ok(
          Object.freeze({
            ...common,
            kind: 'weight',
            quantity: Quantity.fromMilliUnits(raw * 10 ** (3 - profile.decimals)),
          }),
        )
      : ok(Object.freeze({ ...common, kind: 'price', total: Money.fromPiastres(raw) }))
  }

  encode(profileId: string, productCode: unknown, amount: ScaleAmount): Result<string> {
    const profile = this.#profiles.find((p) => p.id === profileId)
    const data = readData(amount, ['kind'], ['quantity', 'total'])
    if (
      !profile ||
      typeof productCode !== 'string' ||
      productCode.length !== profile.productDigits ||
      !/^[0-9]+$/.test(productCode) ||
      !data ||
      data.kind !== profile.kind ||
      (profile.kind === 'weight'
        ? !Object.hasOwn(data, 'quantity') || Object.hasOwn(data, 'total')
        : !Object.hasOwn(data, 'total') || Object.hasOwn(data, 'quantity'))
    )
      return invalidLabel()
    const value = data.kind === 'weight' ? data.quantity : data.total
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0)
      return invalidLabel()
    const divisor = profile.kind === 'weight' ? 10 ** (3 - profile.decimals) : 1
    if (value % divisor !== 0) return invalidLabel()
    const raw = value / divisor
    if (raw >= 10 ** profile.valueDigits) return invalidLabel()
    const payload = profile.prefix + productCode + String(raw).padStart(profile.valueDigits, '0')
    const check = gs1CheckDigit(payload)
    return check.ok ? ok(payload + check.value) : check
  }
}
