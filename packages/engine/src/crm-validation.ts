import { z } from 'zod'
import { day } from './accounting-validation.js'
const id = z.string().regex(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/),
  text = z.string().trim().min(1).max(160),
  short = z.string().trim().max(160),
  note = z.string().trim().max(2000),
  reason = note.min(1),
  money = z.number().int().min(0).max(1e12),
  version = z.number().int().min(0),
  command = { clientTxnId: id },
  edit = { id: id.optional(), version: version.optional() },
  email = z
    .string()
    .trim()
    .toLowerCase()
    .max(200)
    .refine((x) => !x || z.string().email().safeParse(x).success),
  entityType = z.enum(['lead', 'contact', 'opportunity']),
  kind = z.enum(['call', 'meeting', 'email', 'other'])
const person = {
  name: text,
  company: short,
  phone: z.string().trim().max(40),
  email,
  ownerId: id,
  note,
}
export const crmSchemas = {
  'crm.state': z.object({}).strict(),
  'crm.lead.get': z.object({ id }).strict(),
  'crm.contact.get': z.object({ id }).strict(),
  'crm.opportunity.get': z.object({ id }).strict(),
  'crm.quote.get': z.object({ id }).strict(),
  'crm.report': z.object({ from: day, to: day }).strict(),
  'crm.lead.save': z.object({ ...edit, ...person, source: short, ...command }).strict(),
  'crm.lead.status': z
    .object({
      id,
      version,
      status: z.enum(['new', 'qualified', 'disqualified']),
      reason,
      ...command,
    })
    .strict(),
  'crm.lead.convert': z
    .object({ id, version, contactId: id.nullable(), code: short, ...command })
    .strict(),
  'crm.contact.save': z
    .object({
      ...edit,
      ...person,
      code: text,
      address: z.string().trim().max(300),
      active: z.boolean(),
      ...command,
    })
    .strict(),
  'crm.opportunity.save': z
    .object({
      ...edit,
      contactId: id,
      title: text,
      value: money,
      probability: z.number().int().min(0).max(100),
      expectedClose: day,
      note,
      ...command,
    })
    .strict(),
  'crm.opportunity.stage': z
    .object({
      id,
      version,
      stage: z.enum(['new', 'qualified', 'proposal', 'negotiation', 'won', 'lost']),
      actualValue: money.nullable(),
      reason,
      ...command,
    })
    .strict(),
  'crm.task.save': z
    .object({
      ...edit,
      entityType,
      entityId: id,
      title: text,
      kind,
      dueDay: day,
      dueMinute: z.number().int().min(0).max(1439),
      note,
      ...command,
    })
    .strict(),
  'crm.task.status': z
    .object({
      id,
      version,
      status: z.enum(['open', 'done', 'cancelled']),
      outcome: reason,
      ...command,
    })
    .strict(),
  'crm.activity.add': z
    .object({
      entityType,
      entityId: id,
      kind: z.enum(['call', 'meeting', 'email', 'note']),
      text: reason,
      ...command,
    })
    .strict(),
  'crm.quote.issue': z
    .object({
      opportunityId: id,
      opportunityVersion: version,
      contactVersion: version,
      validUntil: day,
      reference: reason,
      note,
      lines: z
        .array(
          z
            .object({
              description: text,
              unit: text,
              qty: z.number().int().min(1).max(1e9),
              price: money,
            })
            .strict(),
        )
        .min(1)
        .max(50),
      discount: money,
      taxBps: z.number().int().min(0).max(10000),
      ...command,
    })
    .strict(),
  'crm.quote.status': z
    .object({
      id,
      version,
      status: z.enum(['accepted', 'rejected', 'withdrawn']),
      reason,
      reference: reason,
      ...command,
    })
    .strict(),
}
export const crmActions = Object.keys(crmSchemas)
export type CrmEntity = 'lead' | 'contact' | 'opportunity'
export type CrmLead = {
  id: string
  name: string
  company: string
  phone: string
  email: string
  source: string
  ownerId: string
  note: string
  status: 'new' | 'qualified' | 'disqualified' | 'converted'
  contactId: string | null
  at: number
  version: number
}
export type CrmContact = {
  id: string
  code: string
  name: string
  company: string
  phone: string
  email: string
  address: string
  ownerId: string
  note: string
  active: number
  at: number
  version: number
}
export type CrmOpportunity = {
  id: string
  contactId: string
  title: string
  value: number
  probability: number
  expectedClose: string
  note: string
  stage: 'new' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost'
  actualValue: number | null
  closedAt: number | null
  at: number
  version: number
  contactName: string
  company: string
  ownerId: string
  weighted: number
}
export type CrmTask = {
  id: string
  entityType: CrmEntity
  entityId: string
  title: string
  kind: 'call' | 'meeting' | 'email' | 'other'
  dueDay: string
  dueMinute: number
  note: string
  status: 'open' | 'done' | 'cancelled'
  outcome: string
  at: number
  version: number
}
export type CrmActivity = {
  id: string
  entityType: CrmEntity
  entityId: string
  action: string
  kind: string
  text: string
  snapshot: unknown
  actorName: string
  at: number
}
export type CrmQuote = {
  id: string
  number: string
  opportunityId: string
  validUntil: string
  reference: string
  note: string
  customer: CrmContact
  business: Record<string, string>
  subtotal: number
  discount: number
  taxBps: number
  tax: number
  total: number
  creatorName: string
  at: number
  status: 'issued' | 'accepted' | 'rejected' | 'withdrawn'
  expired: boolean
  version: number
  decisionReason: string
  decisionReference: string
}
export type CrmQuoteDetail = {
  quote: CrmQuote
  lines: {
    id: string
    description: string
    unit: string
    qty: number
    price: number
    value: number
  }[]
}
export type CrmRecordDetail = {
  entityType: CrmEntity
  record: CrmLead | CrmContact | CrmOpportunity
  tasks: CrmTask[]
  activities: CrmActivity[]
  quotes: CrmQuote[]
}
export type CrmState = {
  user: import('./types.js').User
  settings: Record<string, string>
  today: string
  nowMinute: number
  leads: CrmLead[]
  contacts: CrmContact[]
  opportunities: CrmOpportunity[]
  tasks: CrmTask[]
  quotes: CrmQuote[]
  assignees: { id: string; name: string; role: string; active: number }[]
  users: import('./types.js').User[]
  audit: import('./types.js').Audit[]
}
export type CrmReport = {
  opportunities: CrmOpportunity[]
  weighted: number
  wonValue: number
  activities: CrmActivity[]
  leads: CrmLead[]
  quotes: CrmQuote[]
}
