import { describe, expect, it } from 'vitest'
import { isUlid, ULID_LENGTH, ulid, ulidTimestamp } from './ulid.js'

describe('ulid', () => {
  it('produces a 26-character Crockford base32 identifier', () => {
    const id = ulid()
    expect(id).toHaveLength(ULID_LENGTH)
    expect(id).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/)
    // The ambiguous letters are excluded so staff can read an id aloud for support.
    expect(id).not.toMatch(/[ILOU]/)
  })

  it('never collides across a large batch', () => {
    const ids = new Set<string>()
    for (let index = 0; index < 20_000; index += 1) ids.add(ulid())
    expect(ids.size).toBe(20_000)
  })

  it('sorts lexicographically in creation order, giving good index locality', () => {
    const early = ulid(1_700_000_000_000)
    const middle = ulid(1_700_000_001_000)
    const late = ulid(1_800_000_000_000)
    const sorted = [late, early, middle].sort()
    expect(sorted).toEqual([early, middle, late])
  })

  it('shares a timestamp prefix for ids generated in the same millisecond', () => {
    const timestamp = 1_700_000_000_000
    const first = ulid(timestamp)
    const second = ulid(timestamp)
    expect(first.slice(0, 10)).toBe(second.slice(0, 10))
    expect(first).not.toBe(second) // randomness still separates them
  })

  it('round-trips the embedded timestamp', () => {
    for (const timestamp of [0, 1, 1_700_000_000_000, 281_474_976_710_655]) {
      expect(ulidTimestamp(ulid(timestamp))).toBe(timestamp)
    }
  })

  it('rejects an out-of-range timestamp', () => {
    expect(() => ulid(-1)).toThrow(RangeError)
    expect(() => ulid(281_474_976_710_656)).toThrow(RangeError)
    expect(() => ulid(1.5)).toThrow(RangeError)
  })
})

describe('isUlid', () => {
  it('accepts a generated id', () => {
    expect(isUlid(ulid())).toBe(true)
  })

  it('rejects anything that is not a well-formed ULID', () => {
    expect(isUlid('')).toBe(false)
    expect(isUlid('too-short')).toBe(false)
    expect(isUlid('0'.repeat(25))).toBe(false)
    expect(isUlid('0'.repeat(27))).toBe(false)
    // Lowercase and the excluded letters must not pass.
    expect(isUlid(ulid().toLowerCase())).toBe(false)
    expect(isUlid(`I${'0'.repeat(25)}`)).toBe(false)
    expect(isUlid(null)).toBe(false)
    expect(isUlid(12_345)).toBe(false)
    expect(isUlid(undefined)).toBe(false)
  })
})

describe('ulidTimestamp', () => {
  it('refuses a malformed identifier instead of returning a nonsense date', () => {
    expect(() => ulidTimestamp('not-a-ulid')).toThrow(RangeError)
  })
})
