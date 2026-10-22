import { z } from 'zod'
import { day } from './accounting-validation.js'
import { clinicToday } from './clinic-time.js'
const id = z.string().regex(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/),
  text = z.string().trim().min(1).max(160),
  note = z.string().trim().min(1).max(1000),
  money = z.number().int().min(0).max(1e12),
  version = z.number().int().min(0),
  command = { clientTxnId: id },
  edit = { id: id.optional(), version: version.optional() },
  method = z.enum(['cash', 'bank', 'card']),
  bound = z.number().finite().min(-1e12).max(1e12).nullable()
export const laboratorySchemas = {
  'laboratory.state': z.object({}).strict(),
  'laboratory.patient.get': z.object({ id }).strict(),
  'laboratory.order.get': z.object({ id }).strict(),
  'laboratory.report': z.object({ from: day, to: day }).strict(),
  'laboratory.patient.save': z
    .object({
      ...edit,
      name: text,
      phone: z.string().trim().max(40),
      birthDate: day.nullable().refine((d) => !d || d <= clinicToday()),
      sex: z.enum(['male', 'female', 'unknown']),
      address: z.string().trim().max(250),
      active: z.boolean(),
      ...command,
    })
    .strict(),
  'laboratory.test.save': z
    .object({
      ...edit,
      code: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z0-9][A-Z0-9_.-]{0,39}$/),
      name: text,
      specimen: text,
      kind: z.enum(['number', 'text']),
      unit: z.string().trim().max(40),
      reference: z.string().trim().max(1000),
      min: bound,
      max: bound,
      price: money,
      active: z.boolean(),
      ...command,
    })
    .strict()
    .refine(
      (d) =>
        (d.min === null || d.max === null || d.min <= d.max) &&
        (d.kind === 'number' || (d.min === null && d.max === null)),
    ),
  'laboratory.order.create': z
    .object({
      patientId: id,
      testIds: z
        .array(id)
        .min(1)
        .max(50)
        .refine((xs) => new Set(xs).size === xs.length),
      referrer: z.string().trim().max(160),
      dueAt: z.number().int().min(946684800000).max(4102444800000),
      discount: money,
      taxBps: z.number().int().min(0).max(10000),
      ...command,
    })
    .strict(),
  'laboratory.sample.status': z
    .object({
      id,
      version,
      status: z.enum(['collected', 'received', 'rejected']),
      note,
      ...command,
    })
    .strict(),
  'laboratory.sample.replace': z.object({ id, version, note, ...command }).strict(),
  'laboratory.result.save': z
    .object({
      id,
      version,
      values: z
        .array(
          z
            .object({
              id,
              value: z.string().trim().min(1).max(2000),
              note: z.string().trim().max(1000),
            })
            .strict(),
        )
        .min(1)
        .max(50)
        .refine((xs) => new Set(xs.map((x) => x.id)).size === xs.length),
      ...command,
    })
    .strict(),
  'laboratory.result.approve': z.object({ id, version, ...command }).strict(),
  'laboratory.result.reopen': z.object({ id, version, reason: note, ...command }).strict(),
  'laboratory.order.pay': z
    .object({ id, amount: money.min(1), method, reference: note, ...command })
    .strict(),
  'laboratory.order.cancel': z
    .object({ id, version, note, method, reference: note, ...command })
    .strict(),
}
export const laboratoryActions = Object.keys(laboratorySchemas)
export type LabPatient = {
  id: string
  number: string
  name: string
  phone: string
  birthDate: string | null
  sex: 'male' | 'female' | 'unknown'
  address: string
  active: number
  version: number
}
export type LabTest = {
  id: string
  code: string
  name: string
  specimen: string
  kind: 'number' | 'text'
  unit: string
  reference: string
  min: number | null
  max: number | null
  price: number
  active: number
  version: number
}
export type LabOrder = {
  id: string
  number: string
  patientId: string
  patient: LabPatient
  referrer: string
  dueAt: number
  at: number
  subtotal: number
  discount: number
  taxBps: number
  tax: number
  total: number
  paid: number
  balance: number
  status: 'testing' | 'released' | 'cancelled'
  version: number
  revision: number
  amendmentReason: string
  draftChanged: number
}
export type LabSample = {
  id: string
  number: string
  orderId: string
  orderNumber: string
  patientName: string
  patientNumber: string
  specimen: string
  status: 'pending' | 'collected' | 'received' | 'rejected'
  version: number
  replacesId: string | null
  replacedBy: string | null
  createdAt: number
}
export type LabResult = {
  id: string
  definition: LabTest
  price: number
  value?: string
  note?: string
  authorId?: string | null
  authorName?: string | null
}
export type LabReportSnapshot = {
  reviewerName: string
  patient: LabPatient
  orderNumber: string
  referrer: string
  tests: (LabResult & { flag: 'low' | 'high' | 'normal' | 'unclassified'; sampleNumber: string })[]
}
export type LabReport = {
  id: string
  revision: number
  at: number
  reason: string
  reviewerName: string
  snapshot: LabReportSnapshot
}
export type LabOrderDetail = {
  order: LabOrder
  tests: LabResult[]
  samples: LabSample[]
  events: {
    id: string
    sampleId: string
    at: number
    status: string
    note: string
    userName: string
  }[]
  reports: LabReport[]
  payments: { id: string; at: number; amount: number; method: string; reference: string }[]
  refund?: { at: number; amount: number; note: string; method: string; reference: string }
}
