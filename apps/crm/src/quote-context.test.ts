import { it, expect } from 'vitest'
import { captureQuoteContext } from './quote-context'
it('retains reviewed entity versions and request payload across background polling and uncertain retry', () => {
  const opportunity: any = { id: 'opp', version: 0, title: 'QA reviewed offer' },
    contact: any = { id: 'contact', version: 0, name: 'QA customer' }
  const reviewed = captureQuoteContext(opportunity, contact),
    first = JSON.stringify({
      opportunityId: reviewed.opportunity.id,
      opportunityVersion: reviewed.opportunity.version,
      contactVersion: reviewed.contact.version,
    })
  opportunity.version = 1
  contact.version = 2
  contact.name = 'QA background edited'
  const retry = JSON.stringify({
    opportunityId: reviewed.opportunity.id,
    opportunityVersion: reviewed.opportunity.version,
    contactVersion: reviewed.contact.version,
  })
  expect(retry).toBe(first)
  expect(reviewed.contact.name).toBe('QA customer')
})
