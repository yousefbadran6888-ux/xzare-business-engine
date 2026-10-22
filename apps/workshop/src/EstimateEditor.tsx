import { useState } from 'react'
import type { WorkshopOrder } from '@xzare/engine'
import { call } from '../../pos/src/bridge'
import { Modal, Field, decimal, amount } from './ui'
import { readMoney, readQty, type State } from './model'
type Part = { variantId: string; qty: string; price: string }
type Service = { description: string; qty: string; price: string }
export function EstimateEditor({
  order,
  state,
  busy,
  error,
  onClose,
  onSave,
}: {
  order: WorkshopOrder
  state: State
  busy: boolean
  error: string
  onClose: () => void
  onSave: (p: Record<string, unknown>) => Promise<void>
}) {
  const [parts, setParts] = useState<Part[]>([]),
    [services, setServices] = useState<Service[]>([{ description: '', qty: '1', price: '0' }]),
    [scan, setScan] = useState(''),
    [local, setLocal] = useState(''),
    [diagnosis, setDiagnosis] = useState(''),
    [discount, setDiscount] = useState('0'),
    [tax, setTax] = useState('0')
  const products = state.products.filter((p) => p.active)
  function add(id: string) {
    const p = products.find((x) => x.id === id)
    if (!p) throw new Error('القطعة غير موجودة أو متوقفة')
    setParts((xs) => {
      const prior = xs.find((x) => x.variantId === id)
      return prior
        ? xs.map((x) => (x === prior ? { ...x, qty: String(readQty(x.qty) / 1000 + 1) } : x))
        : [...xs, { variantId: id, qty: '1', price: decimal(p.price) }]
    })
  }
  let subtotal: number | null = null
  try {
    subtotal = [...parts, ...services].reduce(
      (s, l) => s + Number((BigInt(readQty(l.qty)) * BigInt(readMoney(l.price)) + 500n) / 1000n),
      0,
    )
  } catch {}
  return (
    <Modal
      title={'عرض سعر جديد · ' + order.number}
      manual
      busy={busy}
      error={error || local}
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          setLocal('')
          void (async () => {
            try {
              await onSave({
                id: order.id,
                diagnosis,
                parts: parts.map((p) => ({
                  variantId: p.variantId,
                  qty: readQty(p.qty),
                  price: readMoney(p.price),
                })),
                services: services.map((s) => ({
                  description: s.description,
                  qty: readQty(s.qty),
                  price: readMoney(s.price),
                })),
                discount: readMoney(discount),
                taxBps: Math.round(Number(tax) * 100),
              })
            } catch (e) {
              setLocal(e instanceof Error ? e.message : 'راجع البيانات')
            }
          })()
        }}
      >
        <Field label="التشخيص والأعمال المطلوبة">
          <textarea
            required
            maxLength={1000}
            value={diagnosis}
            onChange={(e) => setDiagnosis(e.target.value)}
          />
        </Field>
        <h3>قطع الغيار</h3>
        <Field label="مسح باركود القطعة ثم Enter">
          <input
            dir="ltr"
            value={scan}
            disabled={busy || parts.length >= 50}
            onChange={(e) => setScan(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              setLocal('')
              void call<{ product: { id: string } }>('barcode.lookup', { code: scan })
                .then((r) => {
                  add(r.product.id)
                  setScan('')
                })
                .catch((e) => setLocal(e.message))
            }}
          />
        </Field>
        {parts.map((p, i) => (
          <div className="w-line" key={p.variantId}>
            <Field label="قطعة الغيار">
              <select
                value={p.variantId}
                onChange={(e) => {
                  const v = products.find((x) => x.id === e.target.value)!
                  setParts((xs) =>
                    xs.map((x, j) =>
                      i === j ? { ...x, variantId: v.id, price: decimal(v.price) } : x,
                    ),
                  )
                }}
              >
                {products.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} · {x.sku}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="الكمية">
              <input
                required
                dir="ltr"
                inputMode="decimal"
                value={p.qty}
                onChange={(e) =>
                  setParts((xs) => xs.map((x, j) => (i === j ? { ...x, qty: e.target.value } : x)))
                }
              />
            </Field>
            <Field label="سعر الوحدة · ج.م">
              <input
                required
                dir="ltr"
                inputMode="decimal"
                value={p.price}
                onChange={(e) =>
                  setParts((xs) =>
                    xs.map((x, j) => (i === j ? { ...x, price: e.target.value } : x)),
                  )
                }
              />
            </Field>
            <button
              type="button"
              onClick={() => setParts((xs) => xs.filter((_, j) => j !== i))}
              aria-label={'حذف القطعة ' + (i + 1)}
            >
              حذف
            </button>
          </div>
        ))}
        <button
          type="button"
          disabled={busy || !products.length || parts.length >= 50}
          onClick={() => {
            const p = products.find((x) => !parts.some((l) => l.variantId === x.id))
            if (p) add(p.id)
          }}
        >
          + قطعة غيار
        </button>
        <h3>الخدمات والمصنعية</h3>
        {services.map((s, i) => (
          <div className="w-line" key={i}>
            <Field label="وصف الخدمة">
              <input
                required
                maxLength={160}
                value={s.description}
                onChange={(e) =>
                  setServices((xs) =>
                    xs.map((x, j) => (i === j ? { ...x, description: e.target.value } : x)),
                  )
                }
              />
            </Field>
            <Field label="الكمية">
              <input
                required
                dir="ltr"
                inputMode="decimal"
                value={s.qty}
                onChange={(e) =>
                  setServices((xs) =>
                    xs.map((x, j) => (i === j ? { ...x, qty: e.target.value } : x)),
                  )
                }
              />
            </Field>
            <Field label="السعر · ج.م">
              <input
                required
                dir="ltr"
                inputMode="decimal"
                value={s.price}
                onChange={(e) =>
                  setServices((xs) =>
                    xs.map((x, j) => (i === j ? { ...x, price: e.target.value } : x)),
                  )
                }
              />
            </Field>
            <button
              type="button"
              onClick={() => setServices((xs) => xs.filter((_, j) => j !== i))}
              aria-label={'حذف الخدمة ' + (i + 1)}
            >
              حذف
            </button>
          </div>
        ))}
        <button
          type="button"
          disabled={busy || services.length >= 50}
          onClick={() => setServices((xs) => [...xs, { description: '', qty: '1', price: '0' }])}
        >
          + خدمة
        </button>
        <div className="a-form-row">
          <Field label="الخصم · ج.م">
            <input
              required
              dir="ltr"
              inputMode="decimal"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
            />
          </Field>
          <Field label="الضريبة %">
            <input
              required
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={tax}
              onChange={(e) => setTax(e.target.value)}
            />
          </Field>
        </div>
        <p className="muted">
          إجمالي البنود قبل الخصم والضريبة: {subtotal === null ? 'راجع الكميات' : amount(subtotal)}{' '}
          ج.م. هذا عرض سعر؛ صرف القطع يتم بعد الموافقة وبدء الإصلاح.
        </p>
        <footer>
          <button type="button" disabled={busy} onClick={onClose}>
            إغلاق
          </button>
          <button className="primary" disabled={busy || (!parts.length && !services.length)}>
            حفظ نسخة عرض السعر
          </button>
        </footer>
      </form>
    </Modal>
  )
}
