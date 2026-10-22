import { Money, basisPoints } from '@xzare/core'
export function counterTotal(subtotal: number, discount: number, taxBps: number) {
  if (
    discount > subtotal ||
    discount < 0 ||
    !Number.isInteger(taxBps) ||
    taxBps < 0 ||
    taxBps > 10000
  )
    throw new Error('راجع الخصم ونسبة الضريبة')
  const base = Money.subtract(Money.fromPiastres(subtotal), Money.fromPiastres(discount))
  return Money.add(base, Money.applyRate(base, basisPoints(taxBps))) as number
}
