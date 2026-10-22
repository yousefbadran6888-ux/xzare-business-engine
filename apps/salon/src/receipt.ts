import type { SalonPayment, SalonPayout } from '@xzare/engine'
export type Receipt =
  | { kind: 'payment'; data: SalonPayment }
  | { kind: 'payout'; data: SalonPayout }
export function refreshReceipt(
  r: Receipt | null,
  role: string,
  payments: SalonPayment[],
  payouts: SalonPayout[],
  staffIds: string[],
): Receipt | null {
  if (!r) return null
  if (r.kind === 'payment') {
    if (role === 'stylist') return null
    const p = payments.find((x) => x.id === r.data.id)
    return p ? { kind: 'payment', data: p } : null
  }
  const p = payouts.find((x) => x.id === r.data.id)
  if (!p || (role === 'stylist' && !staffIds.includes(p.staffId))) return null
  return { kind: 'payout', data: p }
}

export function syncReceipt(
  current: Receipt | null,
  captured: Receipt | null,
  fresh: Receipt | null,
  scopeLost: boolean,
): Receipt | null {
  if (scopeLost) return null
  if (
    !current ||
    !captured ||
    current.kind !== captured.kind ||
    current.data.id !== captured.data.id
  )
    return current
  return fresh
}
