import { z } from 'zod'
import { day } from './accounting-validation.js'
const id = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/),
  text = z.string().trim().min(1).max(160),
  num = z.number().int().min(0).max(1e12)
export const inventorySchemas = {
  'inventory.state': z.object({}).strict(),
  'inventory.warehouse.save': z.object({ id: id.optional(), name: text, clientTxnId: id }).strict(),
  'inventory.document.get': z.object({ id }).strict(),
  'inventory.report': z
    .object({ warehouseId: id.optional(), variantId: id.optional(), from: day, to: day })
    .strict(),
  'inventory.document.post': z
    .object({
      kind: z.enum(['receipt', 'issue', 'transfer', 'count']),
      warehouseId: id,
      destinationId: id.optional(),
      note: z.string().trim().min(1).max(1000),
      clientTxnId: id,
      lines: z
        .array(
          z
            .object({
              variantId: id,
              qty: num,
              batch: z.string().trim().max(100).default(''),
              serial: z.string().trim().max(100).default(''),
              expiry: day.optional(),
              cost: num.optional(),
              expectedQty: num.optional(),
              expectedCost: num.optional(),
            })
            .strict(),
        )
        .min(1)
        .max(100),
    })
    .strict(),
}
export const inventoryActions = Object.keys(inventorySchemas)
export type InventoryLine = z.infer<
  (typeof inventorySchemas)['inventory.document.post']
>['lines'][number]
export type InventoryDocument = {
  id: string
  number: string
  kind: 'receipt' | 'issue' | 'transfer' | 'count'
  warehouseId: string
  destinationId: string | null
  note: string
  userId: string
  at: number
}
export type InventoryBalance = {
  lotId: string
  variantId: string
  warehouseId: string
  batch: string
  serial: string
  expiry: string | null
  qty: number
  cost: number
  name: string
  sku: string
  unit: string
}
