import { Money, basisPoints } from '@xzare/core'
export type PaymentValues = Record<'cash' | 'card' | 'transfer' | 'discount', string>
export function paymentPreview(order: { subtotal: number; taxBps: number }, values: PaymentValues) {
  const parsed = ['cash', 'card', 'transfer', 'discount'].map((key) =>
    Money.parse(values[key as keyof PaymentValues]),
  )
  const invalid = {
    total: order.subtotal,
    tax: 0,
    change: 0,
    valid: false,
    error: 'راجع المبالغ؛ استخدم أرقامًا موجبة وبحد أقصى منزلتين عشريتين.',
  }
  if (parsed.some((v) => !v.ok || v.value < 0 || v.value > 1000000000000)) return invalid
  const [cash, card, transfer, discount] = parsed.map((v) => (v.ok ? Number(v.value) : 0)) as [
    number,
    number,
    number,
    number,
  ]
  if (discount > order.subtotal) return { ...invalid, error: 'الخصم أكبر من قيمة الطلب.' }
  const tax = Money.applyRate(
      Money.fromPiastres(order.subtotal - discount),
      basisPoints(order.taxBps),
    ) as number,
    total = order.subtotal - discount + tax,
    tender = cash + card + transfer
  if (card + transfer > total)
    return { total, tax, change: 0, valid: false, error: 'البطاقة والتحويل لا يتجاوزان الإجمالي.' }
  if (tender < total)
    return {
      total,
      tax,
      change: 0,
      valid: false,
      error: 'باقي للتحصيل: ' + Money.toDecimalString(Money.fromPiastres(total - tender)) + ' ج.م',
    }
  return { total, tax, change: tender - total, valid: true, error: '' }
}
