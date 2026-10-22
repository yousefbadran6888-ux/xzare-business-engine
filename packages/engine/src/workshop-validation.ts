import { z } from 'zod'
import { day } from './accounting-validation.js'
const id = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/),
  money = z.number().int().min(0).max(1e12),
  qty = money.min(1),
  text = z.string().trim().min(1).max(160),
  note = z.string().trim().min(1).max(1000),
  phone = z.string().trim().max(30),
  mileage = z.number().int().min(0).max(10000000),
  command = { clientTxnId: id }
export const workshopSchemas = {
  'workshop.state': z.object({}).strict(),
  'workshop.vehicle.save': z
    .object({
      id: id.optional(),
      customer: text,
      phone,
      plate: text.transform((s) => s.normalize('NFKC').toUpperCase().replace(/\s+/g, ' ')),
      vin: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^$|^[A-HJ-NPR-Z0-9]{17}$/),
      make: z.string().trim().max(80),
      model: z.string().trim().max(80),
      year: z.number().int().min(1900).max(2100),
      mileage,
      ...command,
    })
    .strict(),
  'workshop.technician.save': z
    .object({ id: id.optional(), name: text, phone, active: z.boolean(), ...command })
    .strict(),
  'workshop.order.create': z
    .object({ vehicleId: id, warehouseId: id, mileage, complaint: note, dueDate: day, ...command })
    .strict(),
  'workshop.vehicle.history': z.object({ id }).strict(),
  'workshop.order.get': z.object({ id }).strict(),
  'workshop.estimate.create': z
    .object({
      id,
      diagnosis: note,
      parts: z.array(z.object({ variantId: id, qty, price: money }).strict()).max(50),
      services: z.array(z.object({ description: text, qty, price: money }).strict()).max(50),
      discount: money,
      taxBps: z.number().int().min(0).max(10000),
      ...command,
    })
    .strict(),
  'workshop.order.approve': z
    .object({ id, estimateId: id, technicianId: id, note, ...command })
    .strict(),
  'workshop.order.start': z.object({ id, ...command }).strict(),
  'workshop.order.ready': z
    .object({ id, mileageOut: mileage, laborCost: money, note, ...command })
    .strict(),
  'workshop.order.cancel': z.object({ id, note, ...command }).strict(),
  'workshop.order.pay': z
    .object({
      id,
      amount: money.min(1),
      method: z.enum(['cash', 'bank', 'card']),
      reference: note,
      ...command,
    })
    .strict(),
  'workshop.order.deliver': z.object({ id, note, ...command }).strict(),
  'workshop.report': z.object({ from: day, to: day }).strict(),
}
export const workshopActions = Object.keys(workshopSchemas)
export type WorkshopVehicle = {
  id: string
  customer: string
  phone: string
  plate: string
  vin: string
  make: string
  model: string
  year: number
  mileage: number
}
export type WorkshopTechnician = { id: string; name: string; phone: string; active: number }
export type WorkshopStatus =
  'received' | 'estimated' | 'approved' | 'in_progress' | 'ready' | 'delivered' | 'cancelled'
export type WorkshopOrder = {
  id: string
  number: string
  vehicleId: string
  vehicle: WorkshopVehicle
  warehouseId: string
  mileage: number
  mileageOut: number | null
  complaint: string
  dueDate: string
  status: WorkshopStatus
  estimateId: string | null
  technicianId: string | null
  technicianName: string | null
  issueId: string | null
  partsCost: number
  laborCost: number
  at: number
  readyAt: number | null
  deliveredAt: number | null
  total: number
  paid: number
}
export type WorkshopEstimate = {
  id: string
  orderId: string
  revision: number
  diagnosis: string
  subtotal: number
  discount: number
  taxBps: number
  tax: number
  total: number
  at: number
  lines: {
    id: string
    kind: 'part' | 'service'
    variantId: string | null
    description: string
    unit: string
    qty: number
    price: number
    total: number
  }[]
}
