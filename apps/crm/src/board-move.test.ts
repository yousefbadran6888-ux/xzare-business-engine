import { describe, expect, it } from 'vitest'
import { canMoveOpportunity } from './board-move'
describe('opportunity drag destinations', () => {
  it('accepts open opportunity destinations and ignores invalid or unchanged stages', () => {
    expect(canMoveOpportunity('qualified', 'won', false)).toBe(true)
    expect(canMoveOpportunity('qualified', 'qualified', true)).toBe(false)
    expect(canMoveOpportunity('qualified', 'invented', true)).toBe(false)
  })
  it('permits only managers to reopen closed opportunities, into an open stage', () => {
    expect(canMoveOpportunity('won', 'negotiation', false)).toBe(false)
    expect(canMoveOpportunity('won', 'negotiation', true)).toBe(true)
    expect(canMoveOpportunity('won', 'lost', true)).toBe(false)
  })
})
