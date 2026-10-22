import { z } from 'zod'
import { id, text, amount, method } from './validation.js'
export const salonDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v + 'T12:00:00Z')
    return (
      Number.isFinite(d.getTime()) &&
      d.toISOString().slice(0, 10) === v &&
      v >= '2000-01-01' &&
      v <= '2100-12-31'
    )
  }, 'تاريخ غير صالح')
const code = z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/),
  memo = z.string().trim().max(2000).default(''),
  short = z.string().trim().max(160).default(''),
  reason = z.string().trim().min(1).max(2000),
  version = z.number().int().min(0),
  tx = { clientTxnId: id },
  edit = { ...tx, id: id.optional(), version: version.optional() },
  decision = { ...tx, id, version, reason },
  slot = { day: salonDay, startMinute: z.number().int().min(0).max(1439) },
  active = z.boolean(),
  positive = amount.refine((n) => n > 0)
export const salonSchemas = {
  'sal.state': z.object({}).strict(),
  'sal.commissions': z.object({}).strict(),
  'sal.customer.get': z.object({ id }).strict(),
  'sal.booking.get': z.object({ id }).strict(),
  'sal.package.get': z.object({ id }).strict(),
  'sal.invoice.get': z.object({ id }).strict(),
  'sal.report': z
    .object({ from: salonDay, to: salonDay })
    .strict()
    .refine(
      (d) =>
        d.from <= d.to &&
        (Date.parse(d.to) - Date.parse(d.from)) / 86400000 < 366,
      'اختر فترة حتى366 يومًا',
    ),
  'sal.customer.save': z
    .object({ ...edit, code, name: text, phone: short, note: memo, active })
    .strict(),
  'sal.service.save': z
    .object({
      ...edit,
      code,
      name: text,
      category: short,
      duration: z.number().int().min(5).max(480),
      fee: amount,
      active,
    })
    .strict(),
  'sal.staff.save': z
    .object({
      ...edit,
      code,
      name: text,
      phone: short,
      note: memo,
      userId: id.nullable(),
      commissionBps: z.number().int().min(0).max(10000),
      active,
    })
    .strict(),
  'sal.plan.save': z
    .object({
      ...edit,
      code,
      name: text,
      serviceId: id,
      credits: z.number().int().min(1).max(1000),
      days: z.number().int().min(1).max(366),
      fee: amount,
      description: memo,
      active,
    })
    .strict(),
  'sal.booking.add': z
    .object({
      ...tx,
      customerId: id,
      customerVersion: version,
      serviceId: id,
      serviceVersion: version,
      staffId: id,
      staffVersion: version,
      ...slot,
      discount: amount,
      packageId: id.nullable(),
      packageVersion: version.nullable(),
      note: memo,
    })
    .strict(),
  'sal.booking.move': z
    .object({ ...decision, ...slot, staffId: id, staffVersion: version })
    .strict(),
  'sal.booking.arrive': z.object({ ...tx, id, version }).strict(),
  'sal.booking.complete': z.object({ ...tx, id, version }).strict(),
  'sal.booking.cancel': z.object(decision).strict(),
  'sal.booking.no-show': z.object(decision).strict(),
  'sal.booking.void': z.object(decision).strict(),
  'sal.package.sell': z
    .object({
      ...tx,
      customerId: id,
      customerVersion: version,
      planId: id,
      planVersion: version,
      startDay: salonDay,
      discount: amount,
    })
    .strict(),
  'sal.package.cancel': z.object(decision).strict(),
  'sal.payment.post': z
    .object({
      ...tx,
      invoiceId: id,
      version,
      amount: positive,
      method,
      reference: short,
    })
    .strict(),
  'sal.payment.void': z.object({ ...tx, id, reason }).strict(),
  'sal.commission.pay': z
    .object({ ...tx, staffId: id, amount: positive, method, reference: short })
    .strict(),
  'sal.commission.void': z.object({ ...tx, id, reason }).strict(),
}
export const salonActions = Object.keys(salonSchemas)
export interface SalonCustomer {
  id: string
  code: string
  name: string
  phone?: string
  note?: string
  active: number
  at: number
  version: number
}
export interface SalonService {
  id: string
  code: string
  name: string
  category: string
  duration: number
  fee?: number
  active: number
  at: number
  version: number
}
export interface SalonStaff {
  id: string
  code: string
  name: string
  phone?: string
  note?: string
  userId: string | null
  commissionBps?: number
  active: number
  at: number
  version: number
}
export interface SalonPlan {
  id: string
  code: string
  name: string
  serviceId: string
  serviceName: string
  credits: number
  days: number
  fee: number
  description: string
  active: number
  at: number
  version: number
}
export interface SalonBooking {
  id: string
  customerId: string
  customerName: string
  customerCode: string
  serviceId: string
  serviceName: string
  staffId: string
  staffName: string
  day: string
  startMinute: number
  duration: number
  fee?: number
  discount?: number
  rateBps?: number
  packageId: string | null
  note: string
  status: 'booked' | 'arrived' | 'done' | 'cancelled' | 'no-show' | 'void'
  at: number
  version: number
}
export interface SalonInvoice {
  id: string
  kind: 'service' | 'package'
  sourceId: string
  number: string
  customerId: string
  customer: { name: string; code: string }
  item: Record<string, any>
  business: Record<string, string>
  total: number
  balance: number
  status: 'posted' | 'void'
  at: number
  version: number
}
export interface SalonPackage {
  id: string
  customerId: string
  customerName: string
  customerCode: string
  planId: string
  planName: string
  serviceId: string
  serviceName: string
  startDay: string
  endDay: string
  credits: number
  used: number
  reserved: number
  net: number
  balance: number
  invoiceId: string
  status: 'active' | 'cancelled'
  at: number
  version: number
}
export interface SalonPayment {
  id: string
  number: string
  invoiceId: string
  amount: number
  method: string
  reference: string
  customer: { name: string; code: string }
  item: Record<string, any>
  business: Record<string, string>
  actorName: string
  at: number
  voidReason: string | null
}
export interface SalonEvent {
  id: string
  action: string
  reason: string
  snapshot: string
  actorName: string
  at: number
}
export interface SalonLedger {
  id: string
  kind: string
  amount: number
  reason: string
  actorName: string
  at: number
}
export interface SalonCompletion {
  id: string
  invoiceId: string
  staffId: string
  basis: number
  rateBps: number
  commission: number
  packageIndex: number | null
  actorName: string
  at: number
  voidReason: string | null
}
export interface SalonPayout {
  id: string
  number: string
  staffId: string
  staff: { name: string; code: string }
  business: Record<string, string>
  amount: number
  method: string
  reference: string
  actorName: string
  at: number
  voidReason: string | null
}
export interface SalonCommissions {
  summary: {
    staffId: string
    staffName: string
    earned: number
    paid: number
    due: number
  }[]
  entries: (SalonLedger & {
    staffId: string
    staffName: string
    referenceId: string
  })[]
  payouts: SalonPayout[]
}
export interface SalonState {
  user: import('./types.js').User
  settings: Record<string, string>
  customers: SalonCustomer[]
  services: SalonService[]
  staff: SalonStaff[]
  plans: SalonPlan[]
  bookings: SalonBooking[]
  packages: SalonPackage[]
  invoices: SalonInvoice[]
  payments: SalonPayment[]
  users: import('./types.js').User[]
  staffAccounts: import('./types.js').User[]
  audit: import('./types.js').AppState['audit']
}
export interface SalonBookingDetail {
  booking: SalonBooking
  invoice: SalonInvoice | null
  completion: SalonCompletion | null
  events: SalonEvent[]
}
export interface SalonCustomerDetail {
  customer: SalonCustomer
  bookings: SalonBooking[]
  packages: SalonPackage[]
  invoices: SalonInvoice[]
  events: SalonEvent[]
}
export interface SalonPackageDetail {
  package: SalonPackage
  bookings: SalonBooking[]
  uses: {
    id: string
    bookingId: string
    creditIndex: number
    basis: number
    at: number
    voidReason: string | null
  }[]
  invoice: SalonInvoice
  events: SalonEvent[]
}
export interface SalonInvoiceDetail {
  invoice: SalonInvoice
  payments: SalonPayment[]
  ledger: SalonLedger[]
  events: SalonEvent[]
}
export interface SalonReport {
  from: string
  to: string
  bookings: SalonBooking[]
  invoices: SalonInvoice[]
  payments: SalonPayment[]
  commissions: SalonCommissions
  finance: {
    charges: number
    netCollected: number
    voided: number
    outstanding: number
  } | null
}
