import { z } from 'zod'
import { id, text, amount, method } from './validation.js'
export const hotelDay = z
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
const version = z.number().int().nonnegative(),
  short = z.string().trim().max(160).default(''),
  memo = z.string().trim().max(2000).default(''),
  reason = z.string().trim().min(1).max(2000),
  code = z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/),
  tx = { clientTxnId: id },
  edit = { ...tx, id: id.optional(), version: version.optional() },
  decision = { ...tx, id, version, reason },
  stay = {
    arrival: hotelDay,
    departure: hotelDay,
    adults: z.number().int().min(1).max(20),
  },
  positive = amount.refine((n) => n > 0)
export const hotelSchemas = {
  'hotel.state': z.object({}).strict(),
  'hotel.reservation.get': z.object({ id }).strict(),
  'hotel.guest.get': z.object({ id }).strict(),
  'hotel.availability': z.object(stay).strict(),
  'hotel.report': z
    .object({ from: hotelDay, to: hotelDay })
    .strict()
    .refine(
      (d) =>
        d.from <= d.to &&
        (Date.parse(d.to) - Date.parse(d.from)) / 86400000 < 366,
      'اختر فترة حتى 366 يومًا',
    ),
  'hotel.guest.save': z
    .object({
      ...edit,
      code,
      name: text,
      phone: short,
      document: short,
      note: memo,
      active: z.boolean(),
    })
    .strict(),
  'hotel.room.save': z
    .object({
      ...edit,
      code,
      name: text,
      category: short,
      floor: short,
      capacity: z.number().int().min(1).max(20),
      rate: amount,
      active: z.boolean(),
    })
    .strict(),
  'hotel.room.block': z.object({ ...decision, blocked: z.boolean() }).strict(),
  'hotel.housekeeping.set': z
    .object({
      ...decision,
      cleanliness: z.enum(['ready', 'dirty', 'cleaning']),
    })
    .strict(),
  'hotel.reservation.add': z
    .object({
      ...tx,
      guestId: id,
      guestVersion: version,
      roomId: id,
      roomVersion: version,
      ...stay,
      rate: amount,
      discount: amount,
      note: memo,
    })
    .strict(),
  'hotel.reservation.change': z
    .object({
      ...decision,
      roomId: id,
      roomVersion: version,
      ...stay,
      rate: amount,
      discount: amount,
    })
    .strict(),
  'hotel.reservation.checkin': z.object({ ...tx, id, version }).strict(),
  'hotel.reservation.checkout': z.object({ ...tx, id, version }).strict(),
  'hotel.reservation.cancel': z.object(decision).strict(),
  'hotel.reservation.no-show': z.object(decision).strict(),
  'hotel.charge.add': z
    .object({ ...tx, id, version, title: text, amount: positive })
    .strict(),
  'hotel.charge.void': z.object({ ...tx, id, reason }).strict(),
  'hotel.payment.post': z
    .object({
      ...tx,
      reservationId: id,
      version,
      kind: z.enum(['receipt', 'refund']),
      amount: positive,
      method,
      reference: short,
      reason: memo,
    })
    .strict()
    .refine((d) => d.kind !== 'refund' || !!d.reason, 'اذكر سبب رد المبلغ'),
  'hotel.payment.void': z.object({ ...tx, id, reason }).strict(),
}
export const hotelActions = Object.keys(hotelSchemas)
export interface HotelRoom {
  id: string
  code: string
  name: string
  category: string
  floor: string
  capacity: number
  rate: number
  active: number
  blocked: number
  cleanliness: 'ready' | 'dirty' | 'cleaning'
  at: number
  version: number
}
export interface HotelGuest {
  id: string
  code: string
  name: string
  phone: string
  document?: string
  note: string
  active: number
  at: number
  version: number
}
export interface HotelReservation {
  id: string
  number: string
  guestId: string
  roomId: string
  guest: { code: string; name: string; phone: string }
  room: { code: string; name: string; category: string }
  business: Record<string, string>
  arrival: string
  departure: string
  adults: number
  rate: number
  discount: number
  note: string
  status: 'reserved' | 'in-house' | 'checked-out' | 'cancelled' | 'no-show'
  checkinAt: number | null
  checkoutAt: number | null
  at: number
  version: number
  nights: number
  roomTotal: number
  total: number
  collected: number
  balance: number
}
export interface HotelPayment {
  id: string
  number: string
  reservationId: string
  kind: 'receipt' | 'refund'
  amount: number
  method: string
  reference: string
  reason: string
  guest: HotelReservation['guest']
  room: HotelReservation['room']
  business: Record<string, string>
  actorName: string
  at: number
  voidReason: string | null
}
export interface HotelEvent {
  id: string
  action: string
  reason: string
  snapshot: string
  actorName: string
  at: number
}
export interface HotelLedger {
  id: string
  kind: string
  amount: number
  referenceId: string | null
  reason: string
  actorName: string
  at: number
}
export interface HotelCharge {
  id: string
  title: string
  amount: number
  actorName: string
  at: number
  voidReason: string | null
}
export interface HotelState {
  user: import('./types.js').User
  settings: Record<string, string>
  rooms: HotelRoom[]
  guests: HotelGuest[]
  reservations: HotelReservation[]
  payments: HotelPayment[]
  users: import('./types.js').User[]
  audit: import('./types.js').AppState['audit']
  housekeeping: HotelEvent[]
}
export interface HotelDetail {
  reservation: HotelReservation
  charges: HotelCharge[]
  payments: HotelPayment[]
  ledger: HotelLedger[]
  events: HotelEvent[]
}
export interface HotelGuestDetail {
  guest: HotelGuest
  reservations: HotelReservation[]
  events: HotelEvent[]
}
export interface HotelReport {
  from: string
  to: string
  roomNights: number
  charges: number
  collected: number
  outstanding: number
  reservations: HotelReservation[]
  payments: HotelPayment[]
}
