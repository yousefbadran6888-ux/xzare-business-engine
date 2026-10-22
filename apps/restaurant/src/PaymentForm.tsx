import { useState } from 'react'
import type { RestaurantOrder } from '@xzare/engine'
import { Money, basisPoints } from '@xzare/core'
import { paymentPreview, type PaymentValues } from './payments'
import { fmt, decimal } from './ui'
export function PaymentForm({
  order,
  allowDiscount,
}: {
  order: RestaurantOrder
  allowDiscount: boolean
}) {
  const initial =
    order.subtotal +
    (Money.applyRate(Money.fromPiastres(order.subtotal), basisPoints(order.taxBps)) as number)
  const [method, setMethod] = useState<'cash' | 'card' | 'transfer' | 'mixed'>('cash'),
    [edited, setEdited] = useState(false),
    [values, setValues] = useState<PaymentValues>({
      cash: decimal(initial),
      card: '0',
      transfer: '0',
      discount: '0',
    })
  const preview = paymentPreview(order, values)
  const choose = (next: typeof method) => {
    setMethod(next)
    setEdited(false)
    setValues((old) => ({
      ...old,
      cash: next === 'cash' ? decimal(preview.total) : '0',
      card: next === 'card' ? decimal(preview.total) : '0',
      transfer: next === 'transfer' ? decimal(preview.total) : '0',
    }))
  }
  const change = (key: keyof PaymentValues, value: string) => {
    if (key !== 'discount') setEdited(true)
    setValues((old) => {
      const next = { ...old, [key]: value }
      if (key === 'discount' && !edited && method !== 'mixed') {
        const discount = Money.parse(value)
        if (discount.ok && discount.value >= 0 && discount.value <= order.subtotal) {
          const total =
            order.subtotal -
            discount.value +
            (Money.applyRate(
              Money.fromPiastres(order.subtotal - discount.value),
              basisPoints(order.taxBps),
            ) as number)
          next[method] = decimal(total)
        }
      }
      return next
    })
  }
  return (
    <>
      <div className="r-pay-total">
        <span>المبلغ المطلوب</span>
        <strong aria-live="polite">{fmt(preview.total)}</strong>
        <small>
          التوصيل {fmt(order.deliveryFee)} · الضريبة {fmt(preview.tax)}
        </small>
      </div>
      <div className="r-payment-methods" aria-label="طريقة الدفع">
        {(['cash', 'card', 'transfer', 'mixed'] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={method === value}
            className={method === value ? 'active' : ''}
            onClick={() => choose(value)}
          >
            {{ cash: 'نقدي', card: 'بطاقة', transfer: 'تحويل', mixed: 'دفع مقسّم' }[value]}
          </button>
        ))}
      </div>
      {(['cash', 'card', 'transfer'] as const).map((key) =>
        method === key || method === 'mixed' ? (
          <label className="field" key={key}>
            <span>{{ cash: 'نقدي مستلم', card: 'بطاقة', transfer: 'تحويل' }[key]} (ج.م)</span>
            <input
              name={key}
              value={values[key]}
              onChange={(e) => change(key, e.target.value)}
              inputMode="decimal"
              required
              autoComplete="off"
            />
          </label>
        ) : (
          <input key={key} type="hidden" name={key} value={values[key]} />
        ),
      )}
      {allowDiscount ? (
        <details className="r-discount">
          <summary>إضافة خصم</summary>
          <label className="field">
            <span>خصم قبل الضريبة (ج.م)</span>
            <input
              name="discount"
              value={values.discount}
              onChange={(e) => change('discount', e.target.value)}
              inputMode="decimal"
              required
              autoComplete="off"
            />
          </label>
        </details>
      ) : (
        <input name="discount" type="hidden" value="0" />
      )}
      <div className="r-payment-change" role="status">
        <span>الباقي للعميل</span>
        <strong>{fmt(preview.change)}</strong>
      </div>
      {preview.error && (
        <p className="muted" role="status">
          {preview.error}
        </p>
      )}
      <p className="muted">
        التحصيل يسجل الدفع الذي استلمته فعليًا. الحساب النهائي يتحقق منه البرنامج قبل الحفظ.
      </p>
    </>
  )
}
