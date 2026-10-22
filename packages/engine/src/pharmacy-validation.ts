import { z } from 'zod'
import { day } from './accounting-validation.js'
const id = z.string().regex(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/),
  text = z.string().trim().min(1).max(160),
  short = z.string().trim().max(160),
  note = z.string().trim().max(1000),
  reason = note.min(1),
  money = z.number().int().min(0).max(1e12),
  qty = z.number().int().min(1).max(1e9),
  version = z.number().int().min(0),
  command = { clientTxnId: id },
  edit = { id: id.optional(), version: version.optional() },
  method = z.enum(['cash', 'bank', 'card'])
export const pharmacySchemas = {
  'pharmacy.state': z.object({}).strict(),
  'pharmacy.barcode.lookup': z.object({ code: z.string().trim().min(1).max(80) }).strict(),
  'pharmacy.sale.get': z.object({ id }).strict(),
  'pharmacy.document.get': z.object({ id }).strict(),
  'pharmacy.report': z.object({ from: day, to: day }).strict(),
  'pharmacy.medicine.save': z
    .object({
      ...edit,
      code: text,
      name: text,
      ingredient: short,
      strength: short,
      form: short,
      unit: text,
      manufacturer: short,
      price: money,
      reorderQty: z.number().int().min(0).max(1e9),
      barcode: z.string().trim().max(80),
      format: z.enum(['CODE128', 'EAN13', 'EAN8', 'UPCA']),
      active: z.boolean(),
      alternativeIds: z
        .array(id)
        .max(30)
        .refine((v) => new Set(v).size === v.length),
      ...command,
    })
    .strict(),
  'pharmacy.supplier.save': z
    .object({
      ...edit,
      name: text,
      phone: z.string().trim().max(40),
      address: z.string().trim().max(250),
      active: z.boolean(),
      ...command,
    })
    .strict(),
  'pharmacy.receipt.post': z
    .object({
      supplierId: id,
      reference: reason,
      note,
      lines: z
        .array(z.object({ medicineId: id, batch: text, expiry: day, qty, cost: money }).strict())
        .min(1)
        .max(50),
      ...command,
    })
    .strict(),
  'pharmacy.lot.status': z
    .object({
      id,
      version,
      status: z.enum(['available', 'quarantine', 'recalled']),
      reason,
      ...command,
    })
    .strict(),
  'pharmacy.lot.dispose': z
    .object({
      id,
      bucket: z.enum(['available', 'quarantine']),
      qty,
      expectedQty: z.number().int().min(0).max(1e9),
      expectedCost: money,
      reason,
      ...command,
    })
    .strict(),
  'pharmacy.sale.post': z
    .object({
      customer: short,
      note,
      lines: z
        .array(z.object({ medicineId: id, qty }).strict())
        .min(1)
        .max(50),
      discount: money,
      taxBps: z.number().int().min(0).max(10000),
      paid: money,
      method,
      reference: reason,
      ...command,
    })
    .strict(),
  'pharmacy.sale.pay': z
    .object({ id, amount: money.min(1), method, reference: reason, ...command })
    .strict(),
  'pharmacy.sale.return': z
    .object({
      id,
      allocations: z
        .array(z.object({ id, qty }).strict())
        .min(1)
        .max(100)
        .refine((v) => new Set(v.map((x) => x.id)).size === v.length),
      reason,
      method,
      reference: reason,
      ...command,
    })
    .strict(),
}
export const pharmacyActions = Object.keys(pharmacySchemas)
export type PharmacyMedicine = {
  id: string
  code: string
  name: string
  ingredient: string
  strength: string
  form: string
  unit: string
  manufacturer: string
  price: number
  reorderQty: number
  barcode: string
  format: string
  active: number
  version: number
  alternativeIds: string[]
  availableQty: number
}
export type PharmacySupplier = {
  id: string
  name: string
  phone: string
  address: string
  active: number
  version: number
}
export type PharmacyLot = {
  id: string
  medicineId: string
  name: string
  unit: string
  batch: string
  expiry: string
  status: 'available' | 'quarantine' | 'recalled'
  version: number
  qty: number
  cost: number
  quarantineQty: number
  quarantineCost: number
}
export type PharmacySale = {
  id: string
  number: string
  customer: string
  note: string
  at: number
  subtotal: number
  discount: number
  taxBps: number
  tax: number
  total: number
  credit: number
  paid: number
  balance: number
}
export type PharmacyAllocation = {
  id: string
  lineId: string
  lotId: string
  batch: string
  expiry: string
  name: string
  unit: string
  qty: number
  cost: number
  value: number
  returnedQty: number
}
export type PharmacyDocument = {
  id: string
  number: string
  kind: string
  note: string
  reference: string
  at: number
  supplier: PharmacySupplier | null
}
export type PharmacySaleDetail = {
  sale: PharmacySale
  lines: {
    id: string
    medicineId: string
    name: string
    unit: string
    qty: number
    price: number
    value: number
  }[]
  allocations: PharmacyAllocation[]
  payments: { id: string; amount: number; at: number; method: string; reference: string }[]
  returns: {
    id: string
    number: string
    credit: number
    refunded: number
    note: string
    at: number
  }[]
}
export type PharmacyState = {
  user: import('./types.js').User
  settings: Record<string, string>
  medicines: PharmacyMedicine[]
  suppliers: PharmacySupplier[]
  lots: PharmacyLot[]
  sales: PharmacySale[]
  documents: PharmacyDocument[]
  users: import('./types.js').User[]
  audit: import('./types.js').Audit[]
  reconciled: boolean
  today: string
}
