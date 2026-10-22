import { z } from 'zod'
import { day } from './accounting-validation.js'
const id = z.string().regex(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/),
  text = z.string().trim().min(1).max(160),
  short = z.string().trim().max(160),
  note = z.string().trim().max(1500),
  reason = note.min(1),
  money = z.number().int().min(0).max(1e12),
  version = z.number().int().min(0),
  command = { clientTxnId: id },
  edit = { id: id.optional(), version: version.optional() },
  minute = z.number().int().min(0).max(2880)
const range = { from: day, to: day }
export const hrSchemas = {
  'hr.state': z.object({}).strict(),
  'hr.leave.balances': z.object({ year: z.number().int().min(2000).max(2100) }).strict(),
  'hr.period': z.object(range).strict(),
  'hr.payroll.get': z.object({ id }).strict(),
  'hr.employee.save': z
    .object({
      ...edit,
      code: text,
      name: text,
      department: short,
      job: short,
      phone: z.string().trim().max(40),
      email: z.union([z.literal(''), z.string().trim().email().max(200)]),
      hired: day,
      ended: z.union([z.literal(''), day]),
      active: z.boolean(),
      note,
      ...command,
    })
    .strict(),
  'hr.salary.save': z.object({ employeeId: id, version, base: money, reason, ...command }).strict(),
  'hr.shift.save': z
    .object({
      ...edit,
      name: text,
      start: minute.max(1439),
      end: minute.max(1439),
      breakMinutes: minute.max(1439),
      graceMinutes: minute.max(120),
      active: z.boolean(),
      ...command,
    })
    .strict(),
  'hr.roster.save': z
    .object({
      employeeId: id,
      day,
      shiftId: id.nullable(),
      off: z.boolean(),
      version: version.optional(),
      reason,
      ...command,
    })
    .strict(),
  'hr.attendance.save': z
    .object({
      employeeId: id,
      day,
      status: z.enum(['present', 'absent']),
      inMinute: minute.nullable(),
      outMinute: minute.nullable(),
      breakMinutes: minute.max(1439),
      version: version.optional(),
      reason,
      ...command,
    })
    .strict(),
  'hr.leave.credit': z
    .object({
      employeeId: id,
      year: z.number().int().min(2000).max(2100),
      days: z
        .number()
        .int()
        .min(-366)
        .max(366)
        .refine((x) => x !== 0),
      reason,
      ...command,
    })
    .strict(),
  'hr.leave.request': z
    .object({ employeeId: id, ...range, kind: z.enum(['paid', 'unpaid']), reason, ...command })
    .strict(),
  'hr.leave.decide': z
    .object({
      id,
      version,
      status: z.enum(['approved', 'rejected', 'cancelled']),
      reason,
      ...command,
    })
    .strict(),
  'hr.evaluation.save': z
    .object({
      ...edit,
      employeeId: id,
      period: text,
      quality: z.number().int().min(1).max(5),
      reliability: z.number().int().min(1).max(5),
      teamwork: z.number().int().min(1).max(5),
      goals: note,
      note,
      ...command,
    })
    .strict(),
  'hr.payroll.submit': z
    .object({
      month: z.string().regex(/^(20\d{2}|2100)-(0[1-9]|1[0-2])$/),
      note,
      items: z
        .array(
          z
            .object({
              employeeId: id,
              salaryVersion: version,
              allowance: money,
              overtime: money,
              deduction: money,
              tax: money,
              insurance: money,
              note,
            })
            .strict(),
        )
        .min(1)
        .max(200)
        .refine((a) => new Set(a.map((x) => x.employeeId)).size === a.length),
      ...command,
    })
    .strict(),
  'hr.payroll.approve': z.object({ id, version, reason, ...command }).strict(),
  'hr.payroll.void': z.object({ id, version, reason, ...command }).strict(),
  'hr.payroll.pay': z
    .object({
      id,
      amount: money.min(1),
      method: z.enum(['cash', 'bank', 'card']),
      reference: reason,
      ...command,
    })
    .strict(),
}
export const hrActions = Object.keys(hrSchemas)
export type HrEmployee = {
  id: string
  code: string
  name: string
  department: string
  job: string
  phone?: string
  email?: string
  hired: string
  ended: string
  active: number
  note?: string
  version: number
}
export type HrShift = {
  id: string
  name: string
  start: number
  end: number
  breakMinutes: number
  graceMinutes: number
  active: number
  version: number
}
export type HrRoster = {
  id: string
  employeeId: string
  day: string
  shiftId: string | null
  shiftName: string
  off: number
  start: number
  end: number
  breakMinutes: number
  graceMinutes: number
  version: number
}
export type HrAttendance = {
  id: string
  employeeId: string
  day: string
  status: 'present' | 'absent'
  inMinute: number | null
  outMinute: number | null
  breakMinutes: number
  worked: number
  late: number
  overtime: number
  version: number
}
export type HrLeave = {
  id: string
  employeeId: string
  from: string
  to: string
  kind: 'paid' | 'unpaid'
  days: number
  dates: string[]
  reason: string
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  at: number
  version: number
}
export type HrEvaluation = {
  id: string
  employeeId: string
  period: string
  quality: number
  reliability: number
  teamwork: number
  goals: string
  note: string
  reviewerName: string
  at: number
  version: number
}
export type HrPayroll = {
  id: string
  number: string
  month: string
  note: string
  total: number
  paid: number
  balance: number
  creatorId: string
  creatorName: string
  at: number
  status: 'submitted' | 'approved' | 'void'
  version: number
  approverName: string
  reason: string
}
export type HrPayrollItem = {
  id: string
  employeeId: string
  employeeCode: string
  employeeName: string
  department: string
  job: string
  base: number
  allowance: number
  overtime: number
  deduction: number
  tax: number
  insurance: number
  net: number
  paid: number
  balance: number
  note: string
  source: {
    salaryVersion: number
    attendance: HrAttendance[]
    roster: HrRoster[]
    leaves: HrLeave[]
  }
}
export type HrPayrollDetail = {
  run: HrPayroll
  items: HrPayrollItem[]
  payments: {
    id: string
    itemId: string
    amount: number
    method: string
    reference: string
    at: number
  }[]
}
export type HrPeriod = { roster: HrRoster[]; attendance: HrAttendance[]; leaves: HrLeave[] }
export type HrState = HrPeriod & {
  user: import('./types.js').User
  settings: Record<string, string>
  today: string
  employees: HrEmployee[]
  salaries: { employeeId: string; base: number; version: number }[]
  shifts: HrShift[]
  leaveBalances: {
    employeeId: string
    year: number
    granted: number
    used: number
    available: number
  }[]
  evaluations: HrEvaluation[]
  payrolls: HrPayroll[]
  users: import('./types.js').User[]
  audit: import('./types.js').Audit[]
  reconciled: boolean
}
