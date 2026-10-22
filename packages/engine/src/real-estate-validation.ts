import { z } from 'zod'
import { id, text, amount, method } from './validation.js'
import { hotelDay } from './hotel-validation.js'
const version = z.number().int().nonnegative(),
  short = z.string().trim().max(160).default(''),
  memo = z.string().trim().max(2000).default(''),
  reason = z.string().trim().min(1).max(2000),
  code = z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/),
  positive = amount.refine((n) => n > 0),
  day = z.union([hotelDay, z.literal('')]),
  tx = { clientTxnId: id },
  edit = { ...tx, id: id.optional(), version: version.optional(), reason: memo },
  decision = { ...tx, id, version, reason }
export const estateSchemas = {
  're.state': z.object({}).strict(),
  're.deal.get': z.object({ id }).strict(),
  're.report': z
    .object({ from: hotelDay, to: hotelDay })
    .strict()
    .refine(
      (v) => v.from <= v.to && (Date.parse(v.to) - Date.parse(v.from)) / 86400000 < 366,
      'اختر فترة حتى 366 يومًا',
    ),
  're.contact.save': z
    .object({
      ...edit,
      kind: z.enum(['owner', 'client', 'broker']),
      code,
      name: text,
      phone: short,
      document: short,
      note: memo,
      active: z.boolean(),
    })
    .strict(),
  're.unit.save': z
    .object({
      ...edit,
      code,
      name: text,
      ownerId: id,
      ownerVersion: version,
      category: z.enum(['apartment', 'villa', 'office', 'shop', 'land', 'other']),
      location: text,
      area: z.number().finite().positive().max(1e8),
      rooms: z.number().int().min(0).max(1000),
      offer: z.enum(['sale', 'lease', 'both']),
      salePrice: amount,
      rentPrice: amount,
      active: z.boolean(),
    })
    .strict(),
  're.unit.relist': z.object(decision).strict(),
  're.deal.add': z
    .object({
      ...tx,
      unitId: id,
      unitVersion: version,
      clientId: id,
      clientVersion: version,
      brokerId: id,
      brokerVersion: version,
      kind: z.enum(['sale', 'lease']),
      price: positive,
      depositLimit: amount,
      commission: amount,
      brokerShare: amount,
      leaseStart: day,
      leaseEnd: day,
      note: memo,
    })
    .strict()
    .refine((p) => p.brokerShare <= p.commission, 'حصة الوسيط تتجاوز عمولة المكتب')
    .refine(
      (p) =>
        p.kind === 'sale'
          ? p.leaseStart === '' && p.leaseEnd === '' && p.depositLimit <= p.price
          : !!p.leaseStart &&
            p.leaseEnd > p.leaseStart &&
            (Date.parse(p.leaseEnd) - Date.parse(p.leaseStart)) / 86400000 <= 3660,
      'راجع فترة الإيجار أو العربون المتفق عليه',
    ),
  're.contract.record': z
    .object({
      ...tx,
      id,
      version,
      reference: text,
      signedDay: hotelDay,
      terms: z.string().trim().min(1).max(10000),
    })
    .strict(),
  're.deal.complete': z.object(decision).strict(),
  're.deal.cancel': z.object(decision).strict(),
  're.entry.post': z
    .object({
      ...decision,
      channel: z.enum(['deposit', 'fee', 'broker']),
      kind: z.enum(['receipt', 'refund', 'handover', 'payout']),
      amount: positive,
      method,
      reference: short,
    })
    .strict()
    .refine((p) => p.kind !== 'handover' || !!p.reference, 'اذكر مرجع تسليم العربون للمالك'),
  're.entry.void': z.object({ ...decision, entryId: id }).strict(),
}
export const estateActions = Object.keys(estateSchemas)
export interface EstateContact {
  id: string
  kind: 'owner' | 'client' | 'broker'
  code: string
  name: string
  phone: string
  document?: string
  note: string
  active: number
  version: number
  at: number
}
export interface EstateUnit {
  id: string
  code: string
  name: string
  ownerId: string
  ownerName: string
  category: string
  location: string
  area: number
  rooms: number
  offer: 'sale' | 'lease' | 'both'
  salePrice: number
  rentPrice: number
  active: number
  availability: 'available' | 'sold' | 'leased'
  openDealId: string | null
  version: number
  at: number
}
export interface EstateParty {
  code: string
  name: string
  phone: string
}
export interface EstateDeal {
  id: string
  number: string
  unitId: string
  clientId: string
  brokerId: string
  unit: {
    code: string
    name: string
    category: string
    location: string
    area: number
    rooms: number
  }
  owner: EstateParty
  client: EstateParty
  broker: EstateParty
  business: Record<string, string>
  kind: 'sale' | 'lease'
  price: number
  depositLimit: number
  commission: number
  brokerShare: number
  leaseStart: string
  leaseEnd: string
  note: string
  status: 'reserved' | 'contracted' | 'completed' | 'cancelled'
  version: number
  at: number
  completedAt: number | null
  depositReceived: number
  depositHeld: number
  feeCollected: number
  brokerPaid: number
  earned: number
  brokerDue: number
}
export interface EstateContract {
  id: string
  dealId: string
  number: string
  reference: string
  signedDay: string
  terms: string
  snapshot: EstateDeal
  actorName: string
  at: number
  cancelReason: string | null
}
export interface EstateEntry {
  id: string
  number: string
  dealId: string
  channel: 'deposit' | 'fee' | 'broker'
  kind: string
  amount: number
  originalId: string | null
  method: string
  reference: string
  reason: string
  snapshot: EstateDeal
  actorName: string
  at: number
  voidReason: string | null
}
export interface EstateEvent {
  id: string
  action: string
  reason: string
  snapshot: string
  actorName: string
  at: number
}
export interface EstateState {
  user: import('./types.js').User
  settings: Record<string, string>
  contacts: EstateContact[]
  units: EstateUnit[]
  deals: EstateDeal[]
  contracts: EstateContract[]
  entries: EstateEntry[]
  users: import('./types.js').User[]
  audit: import('./types.js').AppState['audit']
}
export interface EstateDetail {
  deal: EstateDeal
  contract: EstateContract | null
  entries: EstateEntry[]
  events: EstateEvent[]
}
export interface EstateReport {
  from: string
  to: string
  earned: number
  agencyNetEarned: number
  completedValue: number
  feeCollected: number
  brokerPaid: number
  brokerDue: number
  depositHeld: number
  feeOutstanding: number
  deals: EstateDeal[]
  entries: EstateEntry[]
}
