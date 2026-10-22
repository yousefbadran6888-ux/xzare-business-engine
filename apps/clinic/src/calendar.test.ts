import { describe, expect, it } from 'vitest'
import { shiftDay, weekDays } from './calendar'
describe('clinic calendar dates', () => {
  it('moves across month and leap-year boundaries using local calendar days', () => {
    expect(shiftDay('2024-02-28', 1)).toBe('2024-02-29')
    expect(shiftDay('2024-02-29', 1)).toBe('2024-03-01')
    expect(shiftDay('2026-01-01', -1)).toBe('2025-12-31')
  })
  it('shows a Saturday-first seven-day week containing the selected day', () => {
    expect(weekDays('2026-10-09')).toEqual(['2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'])
  })
})
