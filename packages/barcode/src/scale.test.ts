import { describe, expect, it } from 'vitest'
import { Money, Quantity, unwrap } from '@xzare/core'
import { ScaleBarcodeCodec, type ScaleProfile, type ScaleAmount } from './scale.js'

const weight: ScaleProfile = {
  id: 'weight',
  prefix: '21',
  productDigits: 5,
  valueDigits: 5,
  kind: 'weight',
  decimals: 3,
}
const price: ScaleProfile = { ...weight, id: 'price', prefix: '22', kind: 'price', decimals: 2 }
const codec = () => unwrap(ScaleBarcodeCodec.create([weight, price]))

describe('scale labels', () => {
  it('rejects changing or throwing getters without executing them', () => {
    let calls = 0
    const changing = {
      quantity: 750,
      total: 1234,
      get kind() {
        calls++
        return calls === 1 ? 'weight' : 'price'
      },
    }
    const throwing = {
      kind: 'weight',
      get quantity() {
        calls++
        throw new Error('Getter executed')
      },
    }
    for (const amount of [changing, throwing]) {
      expect(codec().encode('weight', '00123', amount as unknown as ScaleAmount).ok).toBe(false)
    }
    expect(calls).toBe(0)
  })
  it('rejects malformed shapes and revoked proxies through Result', () => {
    const proxy = Proxy.revocable({}, {})
    proxy.revoke()
    for (const amount of [
      null,
      750,
      {},
      { kind: 'weight' },
      { kind: 'weight', quantity: 750, total: 1234 },
      Object.create({ kind: 'weight', quantity: 750 }),
      proxy.proxy,
    ]) {
      expect(codec().encode('weight', '00123', amount as ScaleAmount).ok).toBe(false)
    }
  })
  it('round-trips grams with leading-zero PLU, without floating-point arithmetic', () => {
    const engine = codec()
    const code = unwrap(
      engine.encode('weight', '00123', { kind: 'weight', quantity: Quantity.fromMilliUnits(750) }),
    )
    expect(code).toMatch(/^210012300750\d$/)
    expect(unwrap(engine.decode(code))).toEqual({
      code,
      profileId: 'weight',
      productCode: '00123',
      kind: 'weight',
      quantity: Quantity.fromMilliUnits(750),
    })
  })
  it('round-trips total price in minor currency units', () => {
    const engine = codec()
    const code = unwrap(
      engine.encode('price', '00123', { kind: 'price', total: Money.fromPiastres(1234) }),
    )
    expect(code).toMatch(/^220012301234\d$/)
    expect(unwrap(engine.decode(code))).toEqual({
      code,
      profileId: 'price',
      productCode: '00123',
      kind: 'price',
      total: Money.fromPiastres(1234),
    })
  })
  it('validates check digit before trusting price or weight', () => {
    const engine = codec()
    const valid = unwrap(
      engine.encode('weight', '00123', { kind: 'weight', quantity: Quantity.one }),
    )
    const invalid = valid.slice(0, -1) + ((Number(valid.at(-1)) + 1) % 10)
    expect(engine.decode(invalid).ok).toBe(false)
  })
  it.each([
    null,
    [],
    [{ ...weight, prefix: '2' }],
    [{ ...weight, decimals: 4 }],
    [{ ...price, decimals: 3 }],
    [{ ...weight, productDigits: 0 }],
    [{ ...weight, kind: 'volume' }],
    [weight, weight],
    [weight, { ...weight, id: 'other', prefix: '2', productDigits: 6 }],
  ])('rejects invalid or ambiguous configuration', (profiles) => {
    expect(ScaleBarcodeCodec.create(profiles).ok).toBe(false)
  })
  it('copies profiles and never executes a configuration getter', () => {
    const mutable = { ...weight }
    const engine = unwrap(ScaleBarcodeCodec.create([mutable]))
    mutable.prefix = '99'
    expect(
      unwrap(engine.encode('weight', '00123', { kind: 'weight', quantity: Quantity.one })),
    ).toMatch(/^21/)
    let calls = 0
    const malicious = {
      ...weight,
      get prefix() {
        calls++
        return '21'
      },
    }
    expect(ScaleBarcodeCodec.create([malicious]).ok).toBe(false)
    expect(calls).toBe(0)
  })
  it('rejects zero, negative, overflow, malformed PLUs and unknown prefixes', () => {
    const engine = codec()
    for (const amount of [0, -1, 100000, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER]) {
      expect(
        engine.encode('weight', '00123', { kind: 'weight', quantity: amount as Quantity }).ok,
      ).toBe(false)
    }
    for (const code of ['123', '00123\n', 123, '0a123'])
      expect(engine.encode('weight', code, { kind: 'weight', quantity: Quantity.one }).ok).toBe(
        false,
      )
    expect(engine.encode('unknown', '00123', { kind: 'weight', quantity: Quantity.one }).ok).toBe(
      false,
    )
    expect(
      engine.encode('weight', '00123', { kind: 'price', total: Money.fromPiastres(750) }).ok,
    ).toBe(false)
    expect(engine.decode('6291041500213').ok).toBe(false)
    expect(engine.decode(2100123007500).ok).toBe(false)
  })
  it('supports configured decimal precision without silently rounding', () => {
    const engine = unwrap(ScaleBarcodeCodec.create([{ ...weight, decimals: 2 }]))
    const code = unwrap(
      engine.encode('weight', '00123', { kind: 'weight', quantity: Quantity.fromMilliUnits(750) }),
    )
    expect(code).toMatch(/^210012300075\d$/)
    expect(unwrap(engine.decode(code))).toMatchObject({ quantity: Quantity.fromMilliUnits(750) })
    expect(
      engine.encode('weight', '00123', { kind: 'weight', quantity: Quantity.fromMilliUnits(751) })
        .ok,
    ).toBe(false)
  })
  it('rejects configuration identifiers with trailing line breaks', () => {
    expect(ScaleBarcodeCodec.create([{ ...weight, id: 'weight\n' }]).ok).toBe(false)
  })
})
