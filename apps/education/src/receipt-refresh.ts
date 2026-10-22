import type { EduPayment } from '@xzare/engine'
export function refreshReceipt(open: EduPayment, payments: EduPayment[]) {
  return payments.find((x) => x.id === open.id) ?? null
}
