import { describe, expect, it } from 'vitest'
import { workshopDropAction } from './board-move'
describe('workshop board transitions', () => {
  it('opens the required business action only for the next workflow stage', () => {
    expect(workshopDropAction('received', 'estimated', 0, 0)).toBe('estimate')
    expect(workshopDropAction('estimated', 'approved', 0, 100)).toBe('approve')
    expect(workshopDropAction('approved', 'in_progress', 0, 100)).toBe('start')
    expect(workshopDropAction('in_progress', 'ready', 0, 100)).toBe('ready')
    expect(workshopDropAction('received', 'ready', 0, 100)).toBe(null)
  })
  it('requires settled payment before delivery and rejects reverse or closed moves', () => {
    expect(workshopDropAction('ready', 'delivered', 99, 100)).toBe(null)
    expect(workshopDropAction('ready', 'delivered', 100, 100)).toBe('deliver')
    expect(workshopDropAction('ready', 'in_progress', 100, 100)).toBe(null)
    expect(workshopDropAction('cancelled', 'received', 0, 100)).toBe(null)
  })
})
