/**
 * Clock abstraction.
 *
 * Time is injected rather than read from `Date.now()` directly, for two reasons:
 * shift-closing, trial expiry and report boundaries become deterministically testable, and
 * licence validation needs a monotonic reference that is independent of the wall clock a
 * user can set backwards (ARCHITECTURE.md §9).
 */

/** Unix milliseconds, UTC. The suite's single timestamp representation. */
export type Timestamp = number

export interface Clock {
  /** Current wall-clock time in Unix milliseconds (UTC). */
  now(): Timestamp
  /**
   * Monotonic milliseconds since process start. Unaffected by clock changes, so it is the
   * only safe basis for measuring elapsed time.
   */
  monotonic(): number
}

export const systemClock: Clock = {
  now: () => Date.now(),
  monotonic: () => Math.round(performance.now()),
}

/** A controllable clock for tests. */
export class FixedClock implements Clock {
  private current: Timestamp
  private monotonicValue: number

  constructor(initial: Timestamp = 0, monotonic = 0) {
    this.current = initial
    this.monotonicValue = monotonic
  }

  now(): Timestamp {
    return this.current
  }

  monotonic(): number {
    return this.monotonicValue
  }

  /** Advances both wall-clock and monotonic time. */
  advance(milliseconds: number): void {
    this.current += milliseconds
    this.monotonicValue += milliseconds
  }

  /**
   * Sets wall-clock time without advancing monotonic time — simulates a user moving the
   * system clock, including the backwards move used to extend a trial.
   */
  setWallClock(timestamp: Timestamp): void {
    this.current = timestamp
  }
}
