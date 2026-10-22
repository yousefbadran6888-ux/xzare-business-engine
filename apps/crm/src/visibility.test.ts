import { it, expect } from 'vitest'
import { hasRecord, scopeRevoked } from './visibility'
const before = {
    leads: [{ id: 'lead' }],
    contacts: [{ id: 'contact' }],
    opportunities: [{ id: 'opp' }],
  },
  after = { leads: [{ id: 'lead' }], contacts: [], opportunities: [] }
it('revokes quote/detail capability when its underlying opportunity leaves the authorized state', () => {
  expect(hasRecord(before, 'opportunity', 'opp')).toBe(true)
  expect(hasRecord(after, 'opportunity', 'opp')).toBe(false)
  expect(hasRecord(after, 'lead', 'lead')).toBe(true)
  expect(scopeRevoked(before, after)).toBe(true)
})
it('preserves edit capability on ordinary same-owner refresh even if quote list is capped or data changes', () => {
  const next = {
    leads: [{ id: 'lead' }],
    contacts: [{ id: 'contact' }],
    opportunities: [{ id: 'opp' }, { id: 'new' }],
  }
  expect(scopeRevoked(before, next)).toBe(false)
  expect(hasRecord(next, 'opportunity', 'opp')).toBe(true)
})
