import { z } from 'zod'
import { day } from './accounting-validation.js'
const id = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/),
  num = z.number().int().min(0).max(1e12),
  positive = num.min(1),
  text = z.string().trim().min(1).max(160),
  note = z.string().trim().min(1).max(1000)
export const manufacturingSchemas = {
  'manufacturing.state': z.object({}).strict(),
  'manufacturing.bom.create': z
    .object({
      outputVariantId: id,
      yieldQty: positive,
      name: text,
      components: z
        .array(
          z
            .object({
              variantId: id,
              qty: positive,
              wasteBps: z.number().int().min(0).max(10000).default(0),
            })
            .strict(),
        )
        .min(1)
        .max(50),
      clientTxnId: id,
    })
    .strict(),
  'manufacturing.order.create': z
    .object({
      bomId: id,
      qty: positive,
      warehouseId: id,
      destinationId: id,
      dueDate: day,
      note,
      clientTxnId: id,
    })
    .strict(),
  'manufacturing.order.get': z.object({ id }).strict(),
  'manufacturing.order.start': z.object({ id, clientTxnId: id }).strict(),
  'manufacturing.order.cancel': z.object({ id, note, clientTxnId: id }).strict(),
  'manufacturing.order.complete': z
    .object({
      id,
      goodQty: num,
      scrapQty: num,
      laborCost: num,
      overheadCost: num,
      batch: z.string().trim().max(100).default(''),
      expiry: day.optional(),
      serials: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
      note,
      clientTxnId: id,
    })
    .strict(),
  'manufacturing.mrp': z.object({ warehouseId: id.optional() }).strict(),
  'manufacturing.report': z.object({ from: day, to: day, warehouseId: id.optional() }).strict(),
}
export const manufacturingActions = Object.keys(manufacturingSchemas)
export type ManufacturingBom = {
  id: string
  outputVariantId: string
  revision: number
  name: string
  yieldQty: number
  at: number
  outputName: string
  sku: string
  unit: string
  components: {
    variantId: string
    qty: number
    wasteBps: number
    name: string
    sku: string
    unit: string
  }[]
}
export type ProductionOrder = {
  id: string
  number: string
  bomId: string
  qty: number
  warehouseId: string
  destinationId: string
  dueDate: string
  note: string
  userId: string
  at: number
  status: 'planned' | 'started' | 'completed' | 'cancelled'
  startedAt: number | null
  completedAt: number | null
  issueId: string | null
  receiptId: string | null
  materialCost: number
  goodQty: number
  scrapQty: number
  laborCost: number
  overheadCost: number
  totalCost: number
  writeoffCost: number
  outputVariantId: string
  outputName: string
  sku: string
  unit: string
  revision: number
}
export type MaterialRequirement = {
  variantId: string
  name: string
  sku: string
  unit: string
  qty: number
  availableQty: number
  shortageQty: number
}
