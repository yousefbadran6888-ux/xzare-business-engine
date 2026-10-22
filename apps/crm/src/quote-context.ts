import type { CrmOpportunity, CrmContact } from '@xzare/engine'
export const captureQuoteContext = (opportunity: CrmOpportunity, contact: CrmContact) =>
  Object.freeze({
    opportunity: Object.freeze({ ...opportunity }),
    contact: Object.freeze({ ...contact }),
  })
