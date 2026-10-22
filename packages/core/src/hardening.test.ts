import { describe, expect, it } from 'vitest'
import { Money } from './money.js'
import { Quantity } from './quantity.js'
import { parseScaled, formatScaled } from './decimal.js'
import { RoundingMode } from './rounding.js'
import { XzareError, ErrorCode } from './errors.js'
import { createLogger, MemoryLogSink, redact } from './logging.js'
import { isUlid, ulidTimestamp } from './ulid.js'
import { attempt } from './result.js'

describe('numeric input boundaries', () => {
  it.each(['0,750', '1,2', '12,34', '1 2', '1,,000', '1,234 567', '1.2,3', '(-1)'])(
    'rejects ambiguous or malformed %s',
    (input) => {
      expect(Money.parse(input).ok).toBe(false)
      expect(Quantity.parse(input).ok).toBe(false)
    },
  )
  it('allows decimal commas only through an explicit policy', () => {
    const result = Quantity.parse('0,750', { decimalSeparator: ',' })
    expect(result.ok && Quantity.toDecimalString(result.value)).toBe('0.750')
  })
  it.each([
    ['1,234.50', '1234.50'],
    ['1 234.50', '1234.50'],
    ["1'234.50", '1234.50'],
    ['١٬٢٣٤٫٥٠', '1234.50'],
  ])('retains valid grouped input %s', (input, expected) => {
    const result = Money.parse(input)
    expect(result.ok && Money.toDecimalString(result.value)).toBe(expected)
  })
  it.each([
    [RoundingMode.FLOOR, '-1.24'],
    [RoundingMode.CEIL, '-1.23'],
  ])('rounds signed values with %s', (rounding, expected) => {
    const result = Money.parse('-1.235', { roundExcessPrecision: true, rounding })
    expect(result.ok && Money.toDecimalString(result.value)).toBe(expected)
  })
  it.each([null, undefined, 42, {}, [], '9'.repeat(257)])(
    'rejects invalid runtime input without throwing',
    (input) => {
      expect(parseScaled(input as string, 2).ok).toBe(false)
      expect(Money.parse(input as string).ok).toBe(false)
      expect(Quantity.parse(input as string).ok).toBe(false)
    },
  )
  it('returns validation errors for unsafe amounts and quantities', () => {
    for (const result of [Money.parse('90071992547409.92'), Quantity.parse('9007199254740.992')]) {
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe(ErrorCode.VALIDATION)
    }
  })
  it('bounds decimal scales', () => {
    for (const scale of [-1, 1.5, 10000, Number.NaN]) {
      expect(() => parseScaled('1', scale)).toThrow(RangeError)
      expect(() => formatScaled(1, scale)).toThrow(RangeError)
    }
  })
  it('rejects unknown rounding modes even for exact divisions', () => {
    expect(() => Money.applyRate(Money.zero, 0 as never, 'invalid' as never)).toThrow(RangeError)
  })
  it('accepts E-pound tokens at numeric boundaries', () => {
    const result = Money.parse('E£12.00')
    expect(result.ok && Money.toDecimalString(result.value)).toBe('12.00')
  })
  it.each(['1EGP2', 'EGP EGP 12', '12 جنيه 34'])(
    'rejects embedded/repeated currency %s',
    (input) => {
      expect(Money.parse(input).ok).toBe(false)
    },
  )
})

describe('untrusted diagnostic and transport objects', () => {
  it('redacts errors and their causes before writing a log record', () => {
    const sink = new MemoryLogSink()
    const failure = Object.assign(new Error('password=SECRET_SENTINEL'), {
      access_token: 'SECRET_SENTINEL',
      cause: { password: 'SECRET_SENTINEL' },
    })
    createLogger(sink).error('Authorization: Bearer SECRET_SENTINEL', failure)
    expect(JSON.stringify(sink.records)).not.toContain('SECRET_SENTINEL')
    expect(JSON.stringify(sink.records)).toContain('[redacted]')
  })
  it('normalizes underscores in sensitive field names', () => {
    expect(redact({ refresh_token: 'SECRET_SENTINEL' })).toEqual({ refresh_token: '[redacted]' })
  })
  it('never invokes getters while redacting', () => {
    let calls = 0
    const input = Object.defineProperty({}, 'value', {
      enumerable: true,
      get() {
        calls++
        throw new Error('getter')
      },
    })
    expect(() => redact(input)).not.toThrow()
    expect(calls).toBe(0)
  })
  it('does not install a prototype from JSON input', () => {
    const result = redact(JSON.parse('{"__proto__":{"admin":true},"name":"safe"}')) as Record<
      string,
      unknown
    >
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
    expect(result.admin).toBeUndefined()
    expect(JSON.stringify(result)).not.toContain('"admin":true')
  })
  it('limits wide/deep records and handles bigint safely', () => {
    const result = redact({
      large: 'a'.repeat(20000),
      list: Array.from({ length: 2000 }, (_, i) => i),
      integer: 5n,
    })
    expect(() => JSON.stringify(result)).not.toThrow()
    expect(JSON.stringify(result).length).toBeLessThan(10000)
  })
  it('rejects forged and invalid serialized errors', () => {
    for (const value of [
      { __xzareError: true },
      { __xzareError: true, code: 'made-up', messageKey: 'x', message: 'x' },
      { __xzareError: true, code: 'validation', messageKey: 'x', message: 'x', params: { x: {} } },
      {
        __xzareError: true,
        code: 'validation',
        messageKey: 'x',
        message: 'x',
        params: { x: Number.NaN },
      },
      JSON.parse(
        '{"__xzareError":true,"code":"validation","messageKey":"x","message":"x","__proto__":{}}',
      ),
    ])
      expect(XzareError.isSerialised(value)).toBe(false)
  })
  it('does not trust inherited serialized error markers', () => {
    expect(
      XzareError.isSerialised(
        Object.create({ __xzareError: true, code: 'validation', messageKey: 'x', message: 'x' }),
      ),
    ).toBe(false)
  })
  it('checks objects without executing accessors', () => {
    let calls = 0
    const value = Object.defineProperty({}, '__xzareError', {
      enumerable: true,
      get() {
        calls++
        return true
      },
    })
    expect(XzareError.isSerialised(value)).toBe(false)
    expect(calls).toBe(0)
  })
  it('fromJSON rejects invalid transport payloads', () => {
    expect(() => XzareError.fromJSON({ __xzareError: true } as never)).toThrow(TypeError)
  })
  it('keeps diagnostics out of client error payloads', () => {
    const error = new XzareError(ErrorCode.UNEXPECTED, {
      messageKey: 'error.unexpected',
      message: 'INTERNAL_SENTINEL',
      details: 'INTERNAL_SENTINEL',
    })
    const client = error.toClientJSON()
    expect(JSON.stringify(client)).not.toContain('INTERNAL_SENTINEL')
    expect(XzareError.isSerialised(client)).toBe(true)
  })
  it('copies incoming error parameters instead of retaining a mutable payload', () => {
    const params = { count: 1 }
    const error = XzareError.fromJSON({
      __xzareError: true,
      code: 'validation',
      messageKey: 'error.input',
      message: 'input',
      params,
    })
    params.count = 99
    expect(error.params?.count).toBe(1)
  })
  it('redacts labelled secrets when log output is truncated inside their values', () => {
    const sink = new MemoryLogSink()
    createLogger(sink).info(`${'a'.repeat(4084)} password=SECRET_SENTINEL`)
    expect(JSON.stringify(sink.records)).not.toContain('SEC')
  })
  it.each([
    'Authorization: Basic SECRET_SENTINEL',
    '{"password":"SECRET_SENTINEL"}',
    "apiKey='SECRET_SENTINEL'",
  ])('redacts labelled free-form credentials: %s', (message) => {
    const sink = new MemoryLogSink()
    createLogger(sink).error(message, new Error(message))
    expect(JSON.stringify(sink.records)).not.toContain('SECRET_SENTINEL')
  })
  it('normalizes thrown plain objects without invoking toString', () => {
    let calls = 0
    const value = {
      toString() {
        calls++
        throw new Error('unsafe conversion')
      },
    }
    const result = attempt(() => {
      throw value
    })
    expect(result.ok).toBe(false)
    expect(calls).toBe(0)
  })
  it('normalizes null-prototype thrown objects', () => {
    const result = attempt(() => {
      throw Object.create(null)
    })
    expect(result.ok).toBe(false)
  })
  it('does not invoke message accessors during error normalization', () => {
    let calls = 0
    const error = Object.defineProperty(new Error(), 'message', {
      get() {
        calls++
        throw new Error('getter')
      },
    })
    const result = attempt(() => {
      throw error
    })
    expect(result.ok).toBe(false)
    expect(calls).toBe(0)
  })
  it('rejects accessor parameters at construction without invoking them', () => {
    let calls = 0
    const params = Object.defineProperty({}, 'count', {
      enumerable: true,
      get() {
        calls++
        return 1
      },
    })
    expect(
      () =>
        new XzareError(ErrorCode.VALIDATION, {
          messageKey: 'error.input',
          message: 'input',
          params,
        }),
    ).toThrow(TypeError)
    expect(calls).toBe(0)
  })
  it('rejects non-finite parameters at construction', () => {
    expect(
      () =>
        new XzareError(ErrorCode.VALIDATION, {
          messageKey: 'error.input',
          message: 'input',
          params: { count: NaN },
        }),
    ).toThrow(TypeError)
  })
  it('redacts sensitive parameter fields in client payloads', () => {
    const error = new XzareError(ErrorCode.VALIDATION, {
      messageKey: 'error.input',
      message: 'input',
      params: { password: 'SECRET_SENTINEL' },
    })
    expect(JSON.stringify(error.toClientJSON())).not.toContain('SECRET_SENTINEL')
  })
  it('bounds aggregate text size across a wide log object', () => {
    const value = Object.fromEntries(
      Array.from({ length: 64 }, (_, i) => [`field${i}`, 'x'.repeat(4096)]),
    )
    expect(JSON.stringify(redact(value)).length).toBeLessThan(20000)
  })
  it('retains only a configured number of diagnostic records', () => {
    const sink = new MemoryLogSink(2)
    const logger = createLogger(sink)
    logger.info('one')
    logger.info('two')
    logger.info('three')
    expect(sink.records.map((record) => record.message)).toEqual(['two', 'three'])
  })
  it('keeps redacted client strings within the validated text limit', () => {
    const error = new XzareError(ErrorCode.VALIDATION, {
      messageKey: 'error.input',
      message: 'input',
      params: { description: `${'a'.repeat(4088)} token=x` },
    })
    const payload = error.toClientJSON()
    expect(XzareError.isSerialised(payload)).toBe(true)
    expect((payload.params?.description as string).length).toBeLessThanOrEqual(4096)
  })
})

describe('identifier boundary', () => {
  it('rejects timestamps beyond 48 bits', () => {
    expect(isUlid('Z'.repeat(26))).toBe(false)
    expect(() => ulidTimestamp('Z'.repeat(26))).toThrow(RangeError)
  })
})
