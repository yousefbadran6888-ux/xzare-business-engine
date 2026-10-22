import { z } from 'zod'
import { id, text, amount, method } from './validation.js'
export const gymDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    let d = new Date(v + 'T12:00:00Z')
    return (
      Number.isFinite(d.getTime()) &&
      d.toISOString().slice(0, 10) === v &&
      v >= '2000-01-01' &&
      v <= '2100-12-31'
    )
  }, 'تاريخ غير صالح')
const memo = z.string().trim().max(2000).default(''),
  optional = z.string().trim().max(160).default(''),
  reason = z.string().trim().min(1).max(2000),
  version = z.number().int().min(0),
  tx = { clientTxnId: id },
  edit = { ...tx, id: id.optional(), version: version.optional() },
  code = z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/),
  active = z.boolean()
const start = {
  memberId: id,
  memberVersion: version,
  planId: id,
  planVersion: version,
  trainerId: id.nullable(),
  startDay: gymDay,
  discount: amount,
}
export const gymSchemas = {
  'gym.state': z.object({}).strict(),
  'gym.member.get': z.object({ id }).strict(),
  'gym.membership.get': z.object({ id }).strict(),
  'gym.session.get': z.object({ id }).strict(),
  'gym.access.get': z.object({ code }).strict(),
  'gym.report': z
    .object({ from: gymDay, to: gymDay })
    .strict()
    .refine(
      (d) =>
        d.from <= d.to &&
        (Date.parse(d.to) - Date.parse(d.from)) / 86400000 < 366,
      'اختر فترة حتى 366 يومًا',
    ),
  'gym.member.save': z
    .object({ ...edit, code, name: text, phone: optional, note: memo, active })
    .strict(),
  'gym.trainer.save': z
    .object({
      ...edit,
      code,
      name: text,
      phone: optional,
      note: memo,
      userId: id.nullable(),
      active,
    })
    .strict(),
  'gym.plan.save': z
    .object({
      ...edit,
      code,
      name: text,
      days: z.number().int().min(1).max(366),
      fee: amount,
      visits: z.number().int().min(1).max(10000).nullable(),
      freezeDays: z.number().int().min(0).max(90),
      description: memo,
      active,
    })
    .strict(),
  'gym.membership.add': z.object({ ...tx, ...start }).strict(),
  'gym.membership.renew': z
    .object({
      ...tx,
      id,
      version,
      planId: id,
      planVersion: version,
      trainerId: id.nullable(),
      startDay: gymDay,
      discount: amount,
    })
    .strict(),
  'gym.membership.freeze': z
    .object({ ...tx, id, version, from: gymDay, to: gymDay, reason })
    .strict()
    .refine((d) => d.from <= d.to, 'نهاية التجميد قبل بدايته'),
  'gym.membership.assign': z
    .object({ ...tx, id, version, trainerId: id.nullable(), reason })
    .strict(),
  'gym.membership.stop': z.object({ ...tx, id, version, reason }).strict(),
  'gym.membership.cancel': z.object({ ...tx, id, version, reason }).strict(),
  'gym.payment.post': z
    .object({
      ...tx,
      membershipId: id,
      version,
      amount: amount.refine((n) => n > 0),
      method,
      reference: optional,
    })
    .strict(),
  'gym.payment.void': z.object({ ...tx, id, reason }).strict(),
  'gym.credit.post': z
    .object({
      ...tx,
      membershipId: id,
      version,
      amount: amount.refine((n) => n > 0),
      reason,
    })
    .strict(),
  'gym.attendance.in': z
    .object({ ...tx, membershipId: id, version, memberVersion: version })
    .strict(),
  'gym.attendance.out': z.object({ ...tx, id }).strict(),
  'gym.attendance.void': z.object({ ...tx, id, reason }).strict(),
  'gym.session.save': z
    .object({
      ...tx,
      id: id.optional(),
      sessionVersion: version.optional(),
      membershipId: id,
      version,
      day: gymDay,
      startMinute: z.number().int().min(0).max(1439),
      duration: z.number().int().min(5).max(480),
      title: text,
      note: memo,
    })
    .strict()
    .refine(
      (d) => d.startMinute + d.duration <= 1440,
      'الجلسة تتجاوز نهاية اليوم',
    ),
  'gym.session.cancel': z.object({ ...tx, id, version, reason }).strict(),
  'gym.session.mark': z
    .object({
      ...tx,
      id,
      version,
      status: z.enum(['done', 'no-show']),
      note: memo,
    })
    .strict(),
}
export const gymActions = Object.keys(gymSchemas)
export interface GymMember {
  id: string
  code: string
  name: string
  phone?: string
  note?: string
  active: number
  at: number
  version: number
}
export interface GymTrainer {
  id: string
  code: string
  name: string
  phone?: string
  note?: string
  userId: string | null
  active: number
  at: number
  version: number
}
export interface GymPlan {
  id: string
  code: string
  name: string
  days: number
  fee?: number
  visits: number | null
  freezeDays: number
  description: string
  active: number
  at: number
  version: number
}
export interface GymMembership {
  id: string
  memberId: string
  memberName: string
  memberCode: string
  planId: string
  planName: string
  trainerId: string | null
  trainerName: string | null
  startDay: string
  endDay: string
  fee?: number
  discount?: number
  balance?: number
  visits: number | null
  used: number
  freezeDays: number
  frozenDays: number
  status: 'active' | 'stopped' | 'cancelled'
  previousId: string | null
  at: number
  version: number
  renewalDay: string
}
export interface GymPayment {
  id: string
  number: string
  membershipId: string
  amount: number
  method: string
  reference: string
  member: { name: string; code: string }
  plan: { name: string; code: string }
  business: Record<string, string>
  actorName: string
  at: number
  voidReason: string | null
}
export interface GymAttendance {
  id: string
  membershipId: string
  memberId: string
  memberName: string
  memberCode: string
  day: string
  at: number
  actorName: string
  outAt: number | null
  voidReason: string | null
}
export interface GymSession {
  id: string
  membershipId: string
  trainerId: string
  trainerName: string
  memberName: string
  memberCode: string
  day: string
  startMinute: number
  duration: number
  title: string
  note: string
  status: 'scheduled' | 'done' | 'no-show' | 'cancelled'
  at: number
  version: number
}
export interface GymFreeze {
  id: string
  from: string
  to: string
  days: number
  originalEnd: string
  newEnd: string
  reason: string
  actorName: string
  at: number
}
export interface GymEvent {
  id: string
  action: string
  reason: string
  actorName: string
  at: number
  snapshot: string
}
export interface GymLedger {
  id: string
  kind: string
  amount: number
  reason: string
  actorName: string
  at: number
}
export interface GymState {
  user: import('./types.js').User
  settings: Record<string, string>
  members: GymMember[]
  trainers: GymTrainer[]
  plans: GymPlan[]
  memberships: GymMembership[]
  attendance: GymAttendance[]
  sessions: GymSession[]
  payments: GymPayment[]
  users: import('./types.js').User[]
  trainerAccounts: import('./types.js').User[]
  audit: import('./types.js').AppState['audit']
}
export interface GymMembershipDetail {
  membership: GymMembership
  freezes: GymFreeze[]
  attendance: GymAttendance[]
  sessions: GymSession[]
  payments: GymPayment[]
  ledger: GymLedger[]
  events: GymEvent[]
}
export interface GymMemberDetail {
  member: GymMember
  memberships: GymMembership[]
  events: GymEvent[]
}
export interface GymSessionDetail {
  session: GymSession
  events: GymEvent[]
}
export interface GymAccess {
  member: GymMember
  membership: GymMembership | null
  allowed: boolean
  reason: string
}
export interface GymReport {
  from: string
  to: string
  finance: {
    netCollected: number
    outstanding: number
    voided: number
    charges: number
    credits: number
  } | null
  attendance: GymAttendance[]
  sessions: GymSession[]
  payments: GymPayment[]
  memberCount: number
  activeCount: number
  expiring: GymMembership[]
}
