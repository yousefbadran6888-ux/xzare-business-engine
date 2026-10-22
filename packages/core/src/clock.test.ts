import { describe, expect, it } from 'vitest'
import { FixedClock, systemClock } from './clock.js'

describe('systemClock', () => {
  it('reports wall-clock time close to Date.now', () => {
    const before = Date.now()
    const reported = systemClock.now()
    expect(reported).toBeGreaterThanOrEqual(before)
    expect(reported).toBeLessThan(before + 5000)
  })

  it('reports a non-decreasing monotonic reading', () => {
    const first = systemClock.monotonic()
    const second = systemClock.monotonic()
    expect(Number.isInteger(first)).toBe(true)
    expect(second).toBeGreaterThanOrEqual(first)
  })
})

describe('FixedClock', () => {
  it('starts at the supplied instant and holds it', () => {
    const clock = new FixedClock(1_700_000_000_000)
    expect(clock.now()).toBe(1_700_000_000_000)
    expect(clock.now()).toBe(1_700_000_000_000)
  })

  it('advances wall-clock and monotonic time together', () => {
    const clock = new FixedClock(1000, 50)
    clock.advance(500)
    expect(clock.now()).toBe(1500)
    expect(clock.monotonic()).toBe(550)
  })

  it('models a user winding the system clock backwards without monotonic time moving', () => {
    // This is exactly the trial-extension attempt licensing must detect (§9).
    const clock = new FixedClock(1_700_000_000_000, 1000)
    clock.advance(60_000)
    const monotonicAfterUse = clock.monotonic()

    clock.setWallClock(1_600_000_000_000)

    expect(clock.now()).toBe(1_600_000_000_000)
    // Monotonic time is unaffected, so elapsed-time checks still see the real usage.
    expect(clock.monotonic()).toBe(monotonicAfterUse)
  })
})
