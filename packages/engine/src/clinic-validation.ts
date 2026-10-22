import { clinicToday } from './clinic-time.js'
import { z } from 'zod'
import { day } from './accounting-validation.js'
const id = z.string().regex(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/),
  text = z.string().trim().min(1).max(160),
  note = z.string().trim().min(1).max(1000),
  money = z.number().int().min(0).max(1e12),
  version = z.number().int().min(0),
  command = { clientTxnId: id },
  edit = { id: id.optional(), version: version.optional() },
  method = z.enum(['cash', 'bank', 'card'])
export const clinicSchemas = {
  'clinic.state': z.object({}).strict(),
  'clinic.patient.get': z.object({ id }).strict(),
  'clinic.appointment.get': z.object({ id }).strict(),
  'clinic.visit.get': z.object({ id }).strict(),
  'clinic.invoice.get': z.object({ id }).strict(),
  'clinic.report': z.object({ from: day, to: day }).strict(),
  'clinic.patient.save': z
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
  'clinic.doctor.save': z
    .object({
      ...edit,
      name: text,
      specialty: z.string().trim().max(160),
      userId: id.nullable(),
      active: z.boolean(),
      ...command,
    })
    .strict(),
  'clinic.service.save': z
    .object({ ...edit, name: text, price: money, active: z.boolean(), ...command })
    .strict(),
  'clinic.appointment.save': z
    .object({
      ...edit,
      patientId: id,
      doctorId: id,
      start: z.number().int().min(946684800000).max(4102444800000),
      duration: z.number().int().min(5).max(480),
      reason: z.string().trim().max(250),
      ...command,
    })
    .strict(),
  'clinic.appointment.status': z
    .object({
      id,
      version,
      status: z.enum(['checked_in', 'cancelled', 'no_show']),
      note,
      ...command,
    })
    .strict(),
  'clinic.visit.open': z.object({ appointmentId: id, ...command }).strict(),
  'clinic.visit.save': z
    .object({
      id,
      version,
      complaint: z.string().trim().max(6000),
      assessment: z.string().trim().max(6000),
      plan: z.string().trim().max(6000),
      ...command,
    })
    .strict(),
  'clinic.visit.finalize': z.object({ id, version, ...command }).strict(),
  'clinic.visit.addendum': z
    .object({ id, note: z.string().trim().min(1).max(6000), reason: note, ...command })
    .strict(),
  'clinic.invoice.post': z
    .object({
      appointmentId: id,
      lines: z
        .array(
          z.object({ serviceId: id, qty: z.number().int().min(1).max(100), price: money }).strict(),
        )
        .min(1)
        .max(50),
      discount: money,
      taxBps: z.number().int().min(0).max(10000),
      ...command,
    })
    .strict(),
  'clinic.invoice.pay': z
    .object({ id, amount: money.min(1), method, reference: note, ...command })
    .strict(),
  'clinic.invoice.void': z.object({ id, note, method, reference: note, ...command }).strict(),
}
export const clinicActions = Object.keys(clinicSchemas)
export type ClinicPatient = {
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
export type ClinicDoctor = {
  id: string
  name: string
  specialty: string
  userId: string | null
  active: number
  version: number
}
export type ClinicService = {
  id: string
  name: string
  price: number
  active: number
  version: number
}
export type ClinicStatus =
  'scheduled' | 'checked_in' | 'in_visit' | 'completed' | 'cancelled' | 'no_show'
export type ClinicAppointment = {
  id: string
  number: string
  patientId: string
  patientName: string
  patientNumber: string
  doctorId: string
  doctorName: string
  start: number
  duration: number
  reason: string
  status: ClinicStatus
  version: number
  visitId: string | null
  invoiceId: string | null
  createdAt: number
}
export type ClinicInvoice = {
  id: string
  number: string
  appointmentId: string
  patient: ClinicPatient
  doctor: ClinicDoctor
  at: number
  subtotal: number
  discount: number
  taxBps: number
  tax: number
  total: number
  paid: number
  voided: number
  balance: number
}
