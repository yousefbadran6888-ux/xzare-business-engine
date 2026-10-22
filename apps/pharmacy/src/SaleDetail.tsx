import { useRef, useState } from 'react'
import type { PharmacySaleDetail } from '@xzare/engine'
import { Modal, Field, amount, decimal, Empty } from './ui'
import { readMoney, methods, stamp } from './model'
export function SaleDetail({
  d,
  busy,
  manager,
  businessName,
  phone,
  address,
  receiptFooter,
  onClose,
  mutate,
}: {
  d: PharmacySaleDetail
  busy: boolean
  manager: boolean
  businessName: string
  phone: string
  address: string
  receiptFooter: string
  onClose: () => void
  mutate: (action: string, p: Record<string, unknown>) => Promise<void>
}) {
  const [mode, setMode] = useState<'view' | 'pay' | 'return'>('view'),
    [quantities, setQuantities] = useState<Record<string, string>>({}),
    [error, setError] = useState(''),
    [saving, setSaving] = useState(false)
  const lock = useRef(false),
    s = d.sale
  return (
    <Modal
      title={'فاتورة ' + s.number}
      manual
      busy={busy || saving}
      error={error}
      onClose={onClose}
    >
      <div className="ph-detail-tools">
        <button disabled={busy || saving} onClick={() => window.print()}>
          طباعة الفاتورة
        </button>
        <button
          disabled={busy || saving || s.balance <= 0}
          onClick={() => {
            setMode('pay')
            setError('')
          }}
        >
          تحصيل المتبقي
        </button>
        {manager && (
          <button
            disabled={busy || saving || d.allocations.every((x) => x.returnedQty === x.qty)}
            onClick={() => {
              setMode('return')
              setError('')
            }}
          >
            مرتجع مع عزل المخزون
          </button>
        )}
      </div>
      {mode !== 'view' && (
        <form
          className="ph-detail-action"
          onSubmit={async (e) => {
            e.preventDefault()
            if (busy || lock.current) return
            lock.current = true
            setSaving(true)
            setError('')
            const f = new FormData(e.currentTarget)
            try {
              const p =
                mode === 'pay'
                  ? {
                      id: s.id,
                      amount: readMoney(f.get('amount')),
                      method: String(f.get('method')),
                      reference: String(f.get('reference')),
                    }
                  : {
                      id: s.id,
                      allocations: Object.entries(quantities)
                        .filter(([, q]) => Number(q) > 0)
                        .map(([id, q]) => ({ id, qty: Number(q) })),
                      reason: String(f.get('reason')),
                      method: String(f.get('method')),
                      reference: String(f.get('reference')),
                    }
              await mutate('pharmacy.sale.' + (mode === 'pay' ? 'pay' : 'return'), p)
              setMode('view')
              setQuantities({})
            } catch (e) {
              setError(e instanceof Error ? e.message : 'تعذر تسجيل العملية')
            } finally {
              lock.current = false
              setSaving(false)
            }
          }}
        >
          {mode === 'pay' ? (
            <Field label="المبلغ · ج.م">
              <input
                name="amount"
                required
                defaultValue={decimal(s.balance)}
                dir="ltr"
                inputMode="decimal"
              />
            </Field>
          ) : (
            <>
              <p>
                اختر كمية من التشغيلات المصروفة فعلًا. المرتجع يدخل مخزونًا معزولًا؛ وتُخفض
                المديونية ويُرد ما يزيد من المدفوع تلقائيًا.
              </p>
              {d.allocations
                .filter((x) => x.qty > x.returnedQty)
                .map((x) => (
                  <div className="ph-return-row" key={x.id}>
                    <span>
                      {x.name}
                      <small>
                        تشغيلة {x.batch} · متبقي {x.qty - x.returnedQty} {x.unit}
                      </small>
                    </span>
                    <input
                      aria-label={'مرتجع ' + x.batch}
                      type="number"
                      min="0"
                      max={x.qty - x.returnedQty}
                      step="1"
                      value={quantities[x.id] ?? '0'}
                      onChange={(e) => setQuantities((v) => ({ ...v, [x.id]: e.target.value }))}
                    />
                  </div>
                ))}
              <Field label="سبب المرتجع">
                <textarea name="reason" required maxLength={1000} />
              </Field>
              <label className="a-check">
                <input type="checkbox" required />
                أكد استلام العبوات وعزلها عن مخزون البيع
              </label>
            </>
          )}
          <div className="a-form-row">
            <Field label={mode === 'return' ? 'طريقة رد المبلغ إن وجد' : 'طريقة التحصيل'}>
              <select name="method">
                {Object.entries(methods).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="مرجع العملية">
              <input name="reference" required maxLength={1000} />
            </Field>
          </div>
          <div className="toolbar">
            <button type="submit" className="primary" disabled={busy || saving}>
              {saving ? 'جارٍ التسجيل…' : mode === 'pay' ? 'تأكيد التحصيل' : 'تأكيد المرتجع'}
            </button>
            <button type="button" disabled={busy || saving} onClick={() => setMode('view')}>
              إلغاء
            </button>
          </div>
        </form>
      )}
      <article className="ph-receipt print-area">
        <div className="ph-receipt-head">
          <img src="./icon.svg" alt="" />
          <div>
            <h2>{businessName || 'Xzare Pharmacy'}</h2>
            {address && <small>{address}</small>}
            {phone && <small dir="ltr">{phone}</small>}
            <small>فاتورة صرف أدوية · {s.number}</small>
            <small>{stamp(s.at)}</small>
          </div>
        </div>
        {s.customer && <p>العميل: {s.customer}</p>}
        <table>
          <thead>
            <tr>
              <th>الدواء</th>
              <th>الكمية</th>
              <th>سعر الوحدة</th>
              <th>صافي القيمة</th>
            </tr>
          </thead>
          <tbody>
            {d.lines.map((x) => (
              <tr key={x.id}>
                <td>{x.name}</td>
                <td>
                  {x.qty} {x.unit}
                </td>
                <td>{amount(x.price)}</td>
                <td>{amount(x.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="ph-invoice-totals">
          <span>قبل الخصم {amount(s.subtotal)}</span>
          <span>الخصم {amount(s.discount)}</span>
          <span>الضريبة {amount(s.tax)}</span>
          <strong>الإجمالي {amount(s.total)} ج.م</strong>
          <span>قيمة المرتجعات {amount(s.credit)}</span>
          <span>صافي المحصل {amount(s.paid)}</span>
          <strong>المتبقي {amount(s.balance)} ج.م</strong>
        </div>
        <h3>التشغيلات المصروفة</h3>
        <table>
          <thead>
            <tr>
              <th>الدواء</th>
              <th>التشغيلة</th>
              <th>الصلاحية</th>
              <th>مصروف / مرتجع</th>
            </tr>
          </thead>
          <tbody>
            {d.allocations.map((x) => (
              <tr key={x.id}>
                <td>{x.name}</td>
                <td dir="ltr">{x.batch}</td>
                <td dir="ltr">{x.expiry}</td>
                <td>
                  {x.qty} / {x.returnedQty}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {receiptFooter && <p className="ph-receipt-footer">{receiptFooter}</p>}
      </article>
      <h3>سجل التحصيل والاسترداد</h3>
      {d.payments.length ? (
        <table>
          <thead>
            <tr>
              <th>الوقت</th>
              <th>الطريقة</th>
              <th>المرجع</th>
              <th>المبلغ</th>
            </tr>
          </thead>
          <tbody>
            {d.payments.map((x) => (
              <tr key={x.id}>
                <td>{stamp(x.at)}</td>
                <td>{methods[x.method as keyof typeof methods]}</td>
                <td>{x.reference}</td>
                <td>{amount(x.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Empty>لم يسجل تحصيل بعد</Empty>
      )}
      {d.returns.length > 0 && (
        <>
          <h3>سجل المرتجعات</h3>
          <table>
            <thead>
              <tr>
                <th>المستند</th>
                <th>السبب</th>
                <th>القيمة</th>
                <th>المردود نقدًا</th>
              </tr>
            </thead>
            <tbody>
              {d.returns.map((x) => (
                <tr key={x.id}>
                  <td>{x.number}</td>
                  <td>{x.note}</td>
                  <td>{amount(x.credit)}</td>
                  <td>{amount(x.refunded)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Modal>
  )
}
