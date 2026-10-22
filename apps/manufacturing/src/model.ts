import { Money, Quantity } from '@xzare/core'
import type { Manufacturing } from '@xzare/engine'
export type State = ReturnType<Manufacturing['state']>
export const kinds = { receipt: 'استلام', issue: 'صرف', transfer: 'تحويل', count: 'جرد' } as const
export const qty = (n: number) => Quantity.toCompactString(Quantity.fromMilliUnits(n))
export function readQty(s: unknown) {
  const r = Quantity.parse(s)
  if (!r.ok || r.value < 0) throw new Error('أدخل كمية صحيحة حتى ثلاث خانات عشرية')
  return r.value as number
}
export function readMoney(s: unknown) {
  const r = Money.parse(s)
  if (!r.ok || r.value < 0) throw new Error('أدخل مبلغًا صحيحًا حتى خانتين عشريتين')
  return r.value as number
}
