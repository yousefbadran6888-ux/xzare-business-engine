import { z } from 'zod'
import { id, text, amount, method } from './validation.js'
const optionalText = z.string().trim().max(160).default(''),
  memo = z.string().trim().max(2000).default(''),
  reason = z.string().trim().min(1).max(2000)
const realDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v + 'T12:00:00Z')
    return (
      Number.isFinite(d.getTime()) &&
      d.toISOString().slice(0, 10) === v &&
      v >= '1900-01-01' &&
      v <= '2100-12-31'
    )
  }, 'تاريخ غير صالح')
export const eduDay = realDay.refine(
  (v) => v >= '2000-01-01',
  'التاريخ قبل فترة العمل المدعومة',
)
const edit = {
    id: id.optional(),
    version: z.number().int().min(0).optional(),
    clientTxnId: id,
  },
  tx = { clientTxnId: id },
  version = z.number().int().min(0),
  code = z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/),
  active = z.boolean()
export const eduSchemas = {
  'edu.state': z.object({}).strict(),
  'edu.student.get': z.object({ id }).strict(),
  'edu.group.get': z.object({ id }).strict(),
  'edu.enrollment.get': z.object({ id }).strict(),
  'edu.session.get': z.object({ id }).strict(),
  'edu.exam.get': z.object({ id }).strict(),
  'edu.report': z
    .object({ from: eduDay, to: eduDay })
    .strict()
    .refine(
      (d) =>
        d.from <= d.to &&
        (Date.parse(d.to) - Date.parse(d.from)) / 86400000 < 366,
      'اختر فترة لا تتجاوز 366 يومًا',
    ),
  'edu.student.save': z
    .object({
      ...edit,
      code,
      name: text,
      phone: optionalText,
      guardian: optionalText,
      guardianPhone: optionalText,
      birthDay: realDay.nullable(),
      level: optionalText,
      note: memo,
      active,
    })
    .strict(),
  'edu.teacher.save': z
    .object({
      ...edit,
      code,
      name: text,
      phone: optionalText,
      note: memo,
      userId: id.nullable(),
      active,
    })
    .strict(),
  'edu.course.save': z
    .object({ ...edit, code, name: text, description: memo, active })
    .strict(),
  'edu.group.save': z
    .object({
      ...edit,
      code,
      name: text,
      courseId: id,
      teacherId: id,
      startDay: eduDay,
      endDay: eduDay,
      fee: amount,
      capacity: z.number().int().min(1).max(500),
      note: memo,
      active,
    })
    .strict()
    .refine((d) => d.startDay <= d.endDay, 'نهاية المجموعة قبل بدايتها'),
  'edu.enrollment.add': z
    .object({
      ...tx,
      studentId: id,
      studentVersion: version,
      groupId: id,
      groupVersion: version,
      discount: amount,
    })
    .strict(),
  'edu.enrollment.cancel': z.object({ ...tx, id, version, reason }).strict(),
  'edu.payment.post': z
    .object({
      ...tx,
      enrollmentId: id,
      enrollmentVersion: version,
      amount: amount.positive(),
      method,
      reference: reason,
    })
    .strict(),
  'edu.payment.void': z.object({ ...tx, id, reason }).strict(),
  'edu.credit.post': z
    .object({
      ...tx,
      enrollmentId: id,
      enrollmentVersion: version,
      amount: amount.positive(),
      reason,
    })
    .strict(),
  'edu.session.save': z
    .object({
      ...edit,
      groupId: id,
      day: eduDay,
      startMinute: z.number().int().min(0).max(1439),
      duration: z.number().int().min(1).max(720),
      title: text,
      note: memo,
    })
    .strict()
    .refine(
      (d) => d.startMinute + d.duration <= 1440,
      'الحصة تتجاوز نهاية اليوم',
    ),
  'edu.session.cancel': z.object({ ...tx, id, version, reason }).strict(),
  'edu.attendance.save': z
    .object({
      ...tx,
      sessionId: id,
      version,
      marks: z
        .array(
          z
            .object({
              enrollmentId: id,
              status: z.enum(['present', 'absent', 'late', 'excused']),
              note: memo,
            })
            .strict(),
        )
        .min(1)
        .max(500),
    })
    .strict(),
  'edu.exam.add': z
    .object({
      ...tx,
      groupId: id,
      day: eduDay,
      title: text,
      maxScore: z.number().int().positive().max(1000000),
      note: memo,
    })
    .strict(),
  'edu.grades.save': z
    .object({
      ...tx,
      examId: id,
      version,
      grades: z
        .array(
          z
            .object({
              enrollmentId: id,
              score: z.number().int().min(0).max(1000000).nullable(),
              note: memo,
            })
            .strict(),
        )
        .min(1)
        .max(500),
      publish: z.boolean(),
      reason,
    })
    .strict(),
}
export const eduActions = Object.keys(eduSchemas)
export interface EduStudent {
  id: string
  code: string
  name: string
  phone?: string
  guardian?: string
  guardianPhone?: string
  birthDay?: string | null
  level?: string
  note?: string
  active: number
  at: number
  version: number
}
export interface EduTeacher {
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
export interface EduCourse {
  id: string
  code: string
  name: string
  description: string
  active: number
  at: number
  version: number
}
export interface EduGroup {
  id: string
  code: string
  name: string
  courseId: string
  courseName: string
  teacherId: string
  teacherName: string
  startDay: string
  endDay: string
  fee?: number
  capacity: number
  note?: string
  active: number
  count: number
  at: number
  version: number
}
export interface EduEnrollment {
  id: string
  studentId: string
  studentName: string
  studentCode: string
  groupId: string
  groupName: string
  fee?: number
  discount?: number
  balance?: number
  status: 'active' | 'cancelled'
  at: number
  version: number
}
export interface EduSession {
  id: string
  groupId: string
  groupName: string
  teacherName: string
  day: string
  startMinute: number
  duration: number
  title: string
  note: string
  status: 'scheduled' | 'cancelled'
  count: number
  marked: number
  at: number
  version: number
}
export interface EduExam {
  id: string
  groupId: string
  groupName: string
  day: string
  title: string
  maxScore: number
  note: string
  status: 'draft' | 'published'
  count: number
  at: number
  version: number
}
export interface EduPayment {
  id: string
  number: string
  enrollmentId: string
  amount: number
  method: string
  reference: string
  student: { name: string; code: string }
  group: { name: string; code: string }
  business: Record<string, string>
  actorName: string
  at: number
  voidReason: string | null
}
export interface EduRoster {
  id: string
  enrollmentId: string
  studentId: string
  studentName: string
  studentCode: string
  status?: 'present' | 'absent' | 'late' | 'excused' | null
  score?: number | null
  note: string
  marked?: number
}
export interface EduEvent {
  id: string
  action: string
  reason: string
  actorName: string
  at: number
  snapshot: string
}
export interface EduLedger {
  id: string
  kind: string
  amount: number
  reason: string
  actorName: string
  at: number
}
export interface EduState {
  user: import('./types.js').User
  settings: Record<string, string>
  students: EduStudent[]
  teachers: EduTeacher[]
  courses: EduCourse[]
  groups: EduGroup[]
  enrollments: EduEnrollment[]
  sessions: EduSession[]
  exams: EduExam[]
  payments: EduPayment[]
  users: import('./types.js').User[]
  audit: import('./types.js').AppState['audit']
  teacherAccounts: import('./types.js').User[]
}
export interface EduSessionDetail {
  session: EduSession
  roster: EduRoster[]
  events: EduEvent[]
}
export interface EduExamDetail {
  exam: EduExam
  roster: EduRoster[]
  events: EduEvent[]
}
export interface EduEnrollmentDetail {
  enrollment: EduEnrollment
  ledger: EduLedger[]
  payments: EduPayment[]
  events: EduEvent[]
}
export interface EduReport {
  from: string
  to: string
  finance: {
    netCollected: number
    outstanding: number
    charges: number
    credits: number
    voided: number
  } | null
  attendance: EduSession[]
  exams: EduExam[]
  payments: EduPayment[]
  enrollmentCount: number
}
