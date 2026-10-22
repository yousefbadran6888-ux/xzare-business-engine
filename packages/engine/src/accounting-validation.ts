import { z } from 'zod'
const id = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/),
  text = z.string().trim().min(1).max(160)
export const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(s + 'T00:00:00Z')
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s
  }, 'التاريخ غير صالح')
export const kinds = ['asset', 'liability', 'equity', 'income', 'expense'] as const
const line = z
  .object({
    accountId: id,
    debit: z.number().int().min(0).max(1e12),
    credit: z.number().int().min(0).max(1e12),
    note: z.string().trim().max(300).default(''),
  })
  .strict()
  .refine(
    (l) => (l.debit > 0 && l.credit === 0) || (l.credit > 0 && l.debit === 0),
    'استخدم مدينًا أو دائنًا فقط في السطر',
  )
export const accountingSchemas = {
  'accounting.state': z.object({}).strict(),
  'accounting.account.save': z
    .object({
      id: id.optional(),
      code: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9.-]{1,30}$/),
      name: text,
      kind: z.enum(kinds),
      parentId: id.nullable().default(null),
      active: z.boolean().default(true),
      clientTxnId: id.optional(),
    })
    .strict(),
  'accounting.period.save': z
    .object({ name: text, from: day, to: day, clientTxnId: id.optional() })
    .strict(),
  'accounting.period.close': z.object({ id, clientTxnId: id }).strict(),
  'accounting.journal.save': z
    .object({
      id: id.optional(),
      version: z.number().int().nonnegative().default(0),
      date: day,
      memo: z.string().trim().min(1).max(1000),
      lines: z.array(line).min(2).max(200),
      clientTxnId: id.optional(),
    })
    .strict(),
  'accounting.journal.get': z.object({ id }).strict(),
  'accounting.journal.post': z
    .object({ id, version: z.number().int().nonnegative(), clientTxnId: id })
    .strict(),
  'accounting.journal.void': z
    .object({ id, version: z.number().int().nonnegative(), memo: text, clientTxnId: id })
    .strict(),
  'accounting.journal.reverse': z.object({ id, date: day, memo: text, clientTxnId: id }).strict(),
  'accounting.report': z.object({ from: day, to: day }).strict(),
  'accounting.ledger': z.object({ accountId: id, from: day, to: day }).strict(),
}
export const accountingActions = Object.keys(accountingSchemas)
export type Account = {
  id: string
  code: string
  name: string
  kind: (typeof kinds)[number]
  parentId: string | null
  active: number
}
export type JournalLine = z.infer<typeof line>
export type Journal = {
  id: string
  number: string | null
  date: string
  memo: string
  status: 'draft' | 'posted' | 'void'
  version: number
  periodId: string
  userId: string
  total: number
  reverseOf: string | null
  lines: JournalLine[]
}
