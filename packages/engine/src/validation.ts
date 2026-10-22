import { z } from 'zod'
export const text = z.string().trim().min(1).max(160)
export const id = z.string().regex(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/)
export const amount = z.number().int().min(0).max(1_000_000_000_000)
export const quantity = z.number().int().positive().max(1_000_000_000)
export const note = z.string().trim().max(500).default('')
export const method = z.enum(['cash', 'card', 'transfer'])
export const username = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_.-]{3,40}$/)
export const password = z.string().min(12).max(128)
export const product = z
  .object({
    id: id.optional(),
    name: text,
    sku: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/),
    unit: text,
    price: amount,
    category: z.string().trim().max(80).default(''),
    reorderQty: amount.default(0),
    barcode: z.string().max(64).default(''),
    format: z
      .enum(['EAN8', 'EAN13', 'UPCA', 'GTIN14', 'CODE128'])
      .default('CODE128'),
    active: z.boolean().default(true),
  })
  .strict()
export const invoice = z
  .object({
    kind: z.enum(['sale', 'purchase']),
    lines: z
      .array(
        z
          .object({ variantId: id, qty: quantity, price: amount.optional() })
          .strict(),
      )
      .min(1)
      .max(200),
    partyId: id.optional(),
    discount: amount.default(0),
    taxBps: z.number().int().min(0).max(10000).default(0),
    cash: amount.default(0),
    card: amount.default(0),
    transfer: amount.default(0),
    note,
    clientTxnId: id,
    holdId: id.optional(),
  })
  .strict()
export const schemas = {
  setup: z
    .object({ businessName: text, username, name: text, password })
    .strict(),
  login: z.object({ username, password: z.string().min(1).max(128) }).strict(),
  'product.save': product,
  'product.archive': z.object({ id }).strict(),
  'barcode.lookup': z.object({ code: z.string().min(1).max(64) }).strict(),
  'party.save': z
    .object({
      id: id.optional(),
      kind: z.enum(['customer', 'supplier']),
      name: text,
      phone: z.string().max(40).default(''),
      address: z.string().max(250).default(''),
    })
    .strict(),
  'stock.adjust': z
    .object({
      variantId: id,
      quantity: z
        .number()
        .int()
        .min(-1_000_000_000)
        .max(1_000_000_000)
        .refine((v) => v !== 0),
      unitCost: amount.default(0),
      reason: text,
      clientTxnId: id,
    })
    .strict(),
  'invoice.post': invoice,
  'invoice.get': z.object({ id }).strict(),
  'invoice.pay': z
    .object({
      invoiceId: id,
      amount: amount.refine((v) => v > 0),
      method,
      clientTxnId: id,
    })
    .strict(),
  'invoice.return': z
    .object({
      invoiceId: id,
      lines: z
        .array(z.object({ lineId: id, qty: quantity }).strict())
        .min(1)
        .max(200),
      method,
      note: text,
      clientTxnId: id,
    })
    .strict(),
  'shift.open': z.object({ opening: amount }).strict(),
  'shift.close': z.object({ actual: amount }).strict(),
  'cash.add': z
    .object({
      amount: z
        .number()
        .int()
        .min(-1_000_000_000_000)
        .max(1_000_000_000_000)
        .refine((v) => v !== 0),
      note: text,
      clientTxnId: id,
    })
    .strict(),
  'expense.add': z
    .object({
      amount: amount.refine((v) => v > 0),
      category: text,
      note,
      clientTxnId: id,
    })
    .strict(),
  'hold.save': z
    .object({
      title: text,
      cart: invoice
        .omit({ clientTxnId: true, holdId: true })
        .refine((v) => v.kind === 'sale'),
    })
    .strict(),
  'hold.remove': z.object({ id }).strict(),
  'settings.save': z
    .object({
      businessName: text,
      phone: z.string().max(40),
      address: z.string().max(250),
      currency: z.literal('EGP'),
      language: z.enum(['ar', 'en']),
      receiptFooter: z.string().max(250),
      taxBps: z.number().int().min(0).max(10000),
      scaleProfiles: z.string().max(4096).optional(),
    })
    .strict(),
  'user.save': z
    .object({
      id: id.optional(),
      username,
      name: text,
      role: z.enum([
        'admin',
        'manager',
        'cashier',
        'kitchen',
        'doctor',
        'technician',
        'hr',
        'payroll',
        'teacher',
        'trainer',
        'stylist',
      ]),
      password: password.optional(),
      active: z.boolean().default(true),
    })
    .strict(),
  'password.change': z
    .object({ current: z.string().min(1).max(128), password })
    .strict(),
}
export function validated<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input)
  if (!parsed.success)
    throw new Error('بيانات غير صالحة؛ راجع الحقول والقيم المطلوبة')
  return parsed.data
}
