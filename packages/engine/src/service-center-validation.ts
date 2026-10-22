import { z } from 'zod'
import { day } from './accounting-validation.js'
const id = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/),
  money = z.number().int().min(0).max(1e12),
  qty = money.min(1),
  text = z.string().trim().min(1).max(160),
  note = z.string().trim().min(1).max(1000),
  phone = z.string().trim().max(30),
  command = { clientTxnId: id }
export const serviceCenterSchemas = {
  'service-center.state': z.object({}).strict(),
  'service-center.device.save': z
    .object({
      id: id.optional(),
      customer: text,
      phone,
      serial: z
        .string()
        .trim()
        .min(1)
        .max(160)
        .transform((s) => s.normalize('NFKC').toUpperCase().replace(/\s+/g, ' ')),
      type: text,
      brand: z.string().trim().max(80),
      model: z.string().trim().max(80),
      ...command,
    })
    .strict(),
  'service-center.technician.save': z
    .object({ id: id.optional(), name: text, phone, active: z.boolean(), ...command })
    .strict(),
  'service-center.order.create': z
    .object({
      deviceId: id,
      warehouseId: id,
      condition: note,
      accessories: z.string().trim().max(1000),
      complaint: note,
      dueDate: day,
      ...command,
    })
    .strict(),
  'service-center.warranty.create': z
    .object({
      parentId: id,
      warehouseId: id,
      condition: note,
      accessories: z.string().trim().max(1000),
      complaint: note,
      dueDate: day,
      coverageNote: note,
      ...command,
    })
    .strict(),
  'service-center.device.history': z.object({ id }).strict(),
  'service-center.order.get': z.object({ id }).strict(),
  'service-center.estimate.create': z
    .object({
      id,
      diagnosis: note,
      warrantyDays: z.number().int().min(0).max(365),
      warrantyTerms: z.string().trim().max(1000),
      parts: z.array(z.object({ variantId: id, qty, price: money }).strict()).max(50),
      services: z.array(z.object({ description: text, qty, price: money }).strict()).max(50),
      discount: money,
      taxBps: z.number().int().min(0).max(10000),
      ...command,
    })
    .strict(),
  'service-center.order.approve': z
    .object({ id, estimateId: id, technicianId: id, note, ...command })
    .strict(),
  'service-center.order.start': z.object({ id, ...command }).strict(),
  'service-center.order.ready': z.object({ id, laborCost: money, note, ...command }).strict(),
  'service-center.order.cancel': z.object({ id, note, ...command }).strict(),
  'service-center.order.pay': z
    .object({
      id,
      amount: money.min(1),
      method: z.enum(['cash', 'bank', 'card']),
      reference: note,
      ...command,
    })
    .strict(),
  'service-center.order.deliver': z.object({ id, note, ...command }).strict(),
  'service-center.report': z.object({ from: day, to: day }).strict(),
}
export const serviceCenterActions = Object.keys(serviceCenterSchemas)
export type ServiceCenterDevice = {
  id: string
  customer: string
  phone: string
  serial: string
  type: string
  brand: string
  model: string
}
export type ServiceCenterTechnician = { id: string; name: string; phone: string; active: number }
export type ServiceCenterStatus =
  'received' | 'estimated' | 'approved' | 'in_progress' | 'ready' | 'delivered' | 'cancelled'
export type ServiceCenterOrder = {
  id: string
  number: string
  deviceId: string
  device: ServiceCenterDevice
  warehouseId: string
  condition: string
  accessories: string
  kind: 'repair' | 'warranty'
  parentId: string | null
  parentNumber: string | null
  coverageNote: string
  warrantyDays: number
  warrantyTerms: string
  warrantyUntil: number | null
  complaint: string
  dueDate: string
  status: ServiceCenterStatus
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
export type ServiceCenterEstimate = {
  id: string
  orderId: string
  revision: number
  diagnosis: string
  subtotal: number
  discount: number
  taxBps: number
  tax: number
  warrantyDays: number
  warrantyTerms: string
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
