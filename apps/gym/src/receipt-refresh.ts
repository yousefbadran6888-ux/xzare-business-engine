import type { GymPayment } from '@xzare/engine'
export function refreshReceipt(open: GymPayment, payments: GymPayment[]) {
  return payments.find((x) => x.id === open.id) ?? null
}
