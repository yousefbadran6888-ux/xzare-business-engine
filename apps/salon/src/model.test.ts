import { it, expect } from 'vitest'
import { addDay } from './model'
it('cleared or partially entered membership start date does not crash preview rendering', () => {
  expect(addDay('', 29)).toBe('')
  expect(addDay('2026-10-', 29)).toBe('')
  expect(addDay('2026-02-30', 29)).toBe('')
})
it('valid membership last day is inclusive and leap calendar arithmetic is exact', () => {
  expect(addDay('2024-02-01', 28)).toBe('2024-02-29')
  expect(addDay('2026-10-08', 29)).toBe('2026-11-06')
})
