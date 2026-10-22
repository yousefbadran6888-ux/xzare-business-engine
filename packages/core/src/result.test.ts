import { describe, expect, it } from 'vitest'
import {
  andThen,
  attempt,
  collect,
  err,
  isErr,
  isOk,
  map,
  mapErr,
  ok,
  unwrap,
  unwrapOr,
  type Result,
} from './result.js'
import { ErrorCode, XzareError, validationError } from './errors.js'

describe('Result construction and inspection', () => {
  it('distinguishes success from failure', () => {
    const success = ok(42)
    const failure = err('boom')
    expect(isOk(success)).toBe(true)
    expect(isErr(success)).toBe(false)
    expect(isOk(failure)).toBe(false)
    expect(isErr(failure)).toBe(true)
    if (success.ok) expect(success.value).toBe(42)
    if (!failure.ok) expect(failure.error).toBe('boom')
  })
})

describe('unwrap', () => {
  it('returns the value on success', () => {
    expect(unwrap(ok('value'))).toBe('value')
  })

  it('throws the error on failure', () => {
    const error = validationError('error.test', 'bad input')
    expect(() => unwrap(err(error))).toThrow(error)
  })

  it('wraps a non-Error failure so a stack is still produced', () => {
    expect(() => unwrap(err('plain string'))).toThrow(XzareError)
  })

  it('falls back without throwing', () => {
    expect(unwrapOr(ok(1), 99)).toBe(1)
    expect(unwrapOr(err('x') as never, 99)).toBe(99)
  })
})

describe('Result transformation', () => {
  it('maps a success and passes a failure through untouched', () => {
    expect(unwrap(map(ok(2), (n) => n * 3))).toBe(6)
    const failure = map(err('boom'), (n: number) => n * 3)
    expect(isErr(failure)).toBe(true)
    if (!failure.ok) expect(failure.error).toBe('boom')
  })

  it('maps an error and leaves a success alone', () => {
    const mapped = mapErr(err('boom'), (e) => `wrapped: ${e}`)
    if (!mapped.ok) expect(mapped.error).toBe('wrapped: boom')
    expect(unwrap(mapErr(ok(5), () => 'unused'))).toBe(5)
  })

  it('chains fallible steps and short-circuits on the first failure', () => {
    const double = (n: number) => ok(n * 2)
    const fail = (): Result<number, string> => err('stopped')
    expect(unwrap(andThen(ok(3), double))).toBe(6)
    const chained = andThen(andThen<number, number, string>(ok(3), fail), double)
    expect(isErr(chained)).toBe(true)
    if (!chained.ok) expect(chained.error).toBe('stopped')
  })
})

describe('collect', () => {
  it('gathers every value when all succeed', () => {
    expect(unwrap(collect([ok(1), ok(2), ok(3)]))).toEqual([1, 2, 3])
  })

  it('collects an empty list to an empty array', () => {
    expect(unwrap(collect([]))).toEqual([])
  })

  it('fails fast on the first error', () => {
    const result = collect([ok(1), err('first'), err('second')])
    expect(isErr(result)).toBe(true)
    if (!result.ok) expect(result.error).toBe('first')
  })
})

describe('attempt', () => {
  it('captures a returned value', () => {
    expect(unwrap(attempt(() => 7))).toBe(7)
  })

  it('converts a thrown error into a failure value', () => {
    const result = attempt(() => {
      throw new Error('kaboom')
    })
    expect(isErr(result)).toBe(true)
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(XzareError)
      expect(result.error.code).toBe(ErrorCode.UNEXPECTED)
      expect(result.error.message).toBe('kaboom')
    }
  })

  it('preserves an XzareError thrown from inside', () => {
    const original = validationError('error.test', 'invalid')
    const result = attempt(() => {
      throw original
    })
    if (!result.ok) expect(result.error).toBe(original)
  })
})
