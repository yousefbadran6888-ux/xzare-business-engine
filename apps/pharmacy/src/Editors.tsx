import { useRef, useState } from 'react'
import type { PharmacyState, PharmacyMedicine } from '@xzare/engine'
import { call } from '../../pos/src/bridge'
import { Field, Empty, Modal, amount } from './ui'
import { counterTotal } from './pricing'
import { readMoney, methods } from './model'
type Save = (action: string, p: Record<string, unknown>) => Promise<{ id: string }>
export function Counter({
  s,
  busy,
  save,
  onSaved,
}: {
  s: PharmacyState
  busy: boolean
  save: Save
  onSaved: (id: string) => Promise<void>
}) {
  const [query, setQuery] = useState(''),
    [basket, setBasket] = useState<{ medicineId: string; qty: number }[]>([]),
    [discount, setDiscount] = useState('0'),
    [tax, setTax] = useState('0'),
    [paid, setPaid] = useState(''),
    [full, setFull] = useState(true),
    [customer, setCustomer] = useState(''),
    [method, setMethod] = useState('cash'),
    [reference, setReference] = useState(''),
    [error, setError] = useState(''),
    [saving, setSaving] = useState(false)
  const scan = useRef<HTMLInputElement>(null),
    lock = useRef(false)
  const items = basket.map((x) => ({ ...x, m: s.medicines.find((m) => m.id === x.medicineId)! })),
    subtotal = items.reduce((n, x) => n + x.m.price * x.qty, 0)
  let total = 0,
    validTotal = false
  try {
    total = counterTotal(subtotal, readMoney(discount), readMoney(tax))
    validTotal = true
  } catch {}
  const add = (m: PharmacyMedicine) => {
    if (busy || saving) return
    setError('')
    setBasket((old) => {
      const exists = old.find((x) => x.medicineId === m.id)
      if ((exists?.qty ?? 0) + 1 > m.availableQty) {
        setError('الكمية المتاحة الآمنة لا تكفي')
        return old
      }
      return exists
        ? old.map((x) => (x.medicineId === m.id ? { ...x, qty: x.qty + 1 } : x))
        : [...old, { medicineId: m.id, qty: 1 }]
    })
    setQuery('')
    scan.current?.focus()
  }
  async function lookup() {
    if (lock.current || busy || saving || !query.trim()) return
    lock.current = true
    try {
      const r = await call<{ medicine: PharmacyMedicine }>('pharmacy.barcode.lookup', {
        code: query.trim(),
      })
      add(r.medicine)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر قراءة الباركود')
    } finally {
      lock.current = false
    }
  }
  async function post() {
    if (lock.current || busy || saving) return
    lock.current = true
    setSaving(true)
    setError('')
    try {
      const r = await save('pharmacy.sale.post', {
        customer,
        note: '',
        lines: basket,
        discount: readMoney(discount),
        taxBps: readMoney(tax),
        paid: full ? total : readMoney(paid || '0'),
        method,
        reference: reference.trim() || 'تحصيل عند الصرف',
      })
      setBasket([])
      setDiscount('0')
      setPaid('')
      setCustomer('')
      setReference('')
      await onSaved(r.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تسجيل الصرف')
    } finally {
      setSaving(false)
      lock.current = false
    }
  }
  const q = query.trim().toLowerCase(),
    available = s.medicines.filter(
      (m) =>
        m.active &&
        [m.name, m.code, m.barcode, m.ingredient, m.strength].join(' ').toLowerCase().includes(q),
    )
  return (
    <div className="ph-counter">
      <section className="ph-catalog-pane">
        <div className="ph-scan">
          <label htmlFor="scan-code">امسح الباركود أو ابحث عن دواء</label>
          <div>
            <input
              id="scan-code"
              ref={scan}
              autoComplete="off"
              placeholder="اسم الدواء، المادة أو الباركود…"
              value={query}
              disabled={busy || saving}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void lookup()
                }
              }}
            />
            <button disabled={busy || saving || !query} onClick={() => void lookup()}>
              مسح ↵
            </button>
          </div>
        </div>
        <div className="ph-strip">
          <span>الصرف من الأقرب انتهاءً</span>
          <span>التشغيلات المنتهية والموقوفة مستبعدة</span>
        </div>
        {!available.length ? (
          <Empty>
            {s.medicines.length
              ? 'لا توجد أدوية مطابقة للبحث'
              : 'ابدأ بإضافة الأدوية واستلام تشغيلاتها من إدارة المخزون.'}
          </Empty>
        ) : (
          <div className="ph-medicine-list">
            {available.map((m) => (
              <div className="ph-medicine-row" key={m.id}>
                <div className="ph-pill">℞</div>
                <div>
                  <strong>{m.name}</strong>
                  <small>{[m.strength, m.form].filter(Boolean).join(' · ') || m.code}</small>
                  <small>{m.ingredient}</small>
                  {m.alternativeIds.length > 0 && (
                    <details>
                      <summary>روابط مسجلة يدويًا</summary>
                      {m.alternativeIds.map((id) => (
                        <span className="ph-link" key={id}>
                          {s.medicines.find((x) => x.id === id)?.name ?? 'غير متاح'}
                        </span>
                      ))}
                      <small>راجع الاختيار مهنيًا؛ الرابط ليس اعتماد تكافؤ دوائي.</small>
                    </details>
                  )}
                </div>
                <div className="ph-item-price">
                  <strong>
                    {amount(m.price)} <small>ج.م / {m.unit}</small>
                  </strong>
                  <span className={m.availableQty > 0 ? 'ph-stock' : 'ph-zero'}>
                    {m.availableQty} متاح
                  </span>
                </div>
                <button
                  className="ph-add"
                  disabled={busy || saving || m.availableQty < 1}
                  onClick={() => add(m)}
                  aria-label={'إضافة ' + m.name}
                >
                  +
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="ph-basket">
        <div className="ph-basket-head">
          <div>
            <small>جلسة صرف جديدة</small>
            <h2>
              سلة الصرف <span>{basket.length}</span>
            </h2>
          </div>
          <button disabled={!basket.length || busy || saving} onClick={() => setBasket([])}>
            تفريغ
          </button>
        </div>
        {!items.length ? (
          <Empty>امسح باركود الدواء أو اضغط + لإضافته</Empty>
        ) : (
          items.map((x) => (
            <div className="ph-basket-row" key={x.medicineId}>
              <strong>{x.m.name}</strong>
              <small>
                {x.m.unit} · {amount(x.m.price)} ج.م
              </small>
              <div className="ph-qty">
                <button
                  aria-label={'تقليل ' + x.m.name}
                  disabled={busy || saving}
                  onClick={() =>
                    setBasket((old) =>
                      old.flatMap((v) =>
                        v.medicineId !== x.medicineId
                          ? [v]
                          : v.qty > 1
                            ? [{ ...v, qty: v.qty - 1 }]
                            : [],
                      ),
                    )
                  }
                >
                  −
                </button>
                <input
                  type="number"
                  aria-label={'كمية ' + x.m.name}
                  min="1"
                  max={x.m.availableQty}
                  step="1"
                  disabled={busy || saving}
                  value={x.qty}
                  onChange={(e) => {
                    const n = Number(e.target.value)
                    if (Number.isInteger(n) && n > 0 && n <= x.m.availableQty)
                      setBasket((old) =>
                        old.map((v) => (v.medicineId === x.medicineId ? { ...v, qty: n } : v)),
                      )
                  }}
                />
                <button
                  aria-label={'زيادة ' + x.m.name}
                  disabled={busy || saving || x.qty >= x.m.availableQty}
                  onClick={() => add(x.m)}
                >
                  +
                </button>
                <b>{amount(x.qty * x.m.price)}</b>
              </div>
            </div>
          ))
        )}
        <div className="ph-basket-fields">
          <Field label="اسم العميل (اختياري)">
            <input
              maxLength={160}
              value={customer}
              disabled={busy || saving}
              onChange={(e) => setCustomer(e.target.value)}
            />
          </Field>
          <div className="a-form-row">
            <Field label="خصم · ج.م">
              <input
                dir="ltr"
                inputMode="decimal"
                value={discount}
                disabled={busy || saving}
                onChange={(e) => setDiscount(e.target.value)}
              />
            </Field>
            <Field label="ضريبة %">
              <input
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={tax}
                disabled={busy || saving}
                onChange={(e) => setTax(e.target.value)}
              />
            </Field>
          </div>
          <div className="ph-total">
            <span>الإجمالي · ج.م</span>
            <b>{amount(total)}</b>
          </div>
          <div className="a-form-row">
            <Field label="طريقة التحصيل">
              <select
                value={method}
                disabled={busy || saving}
                onChange={(e) => setMethod(e.target.value)}
              >
                {Object.entries(methods).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="مرجع التحصيل">
              <input
                maxLength={1000}
                placeholder="اختياري عند الصرف"
                value={reference}
                disabled={busy || saving}
                onChange={(e) => setReference(e.target.value)}
              />
            </Field>
          </div>
          <label className="a-check">
            <input
              type="checkbox"
              checked={full}
              disabled={busy || saving}
              onChange={(e) => setFull(e.target.checked)}
            />
            تحصيل كامل الإجمالي
          </label>
          {!full && (
            <Field label="المدفوع الآن · ج.م">
              <input
                dir="ltr"
                inputMode="decimal"
                value={paid}
                disabled={busy || saving}
                onChange={(e) => setPaid(e.target.value)}
              />
            </Field>
          )}
          {error && (
            <p className="alert error" role="alert">
              {error}
            </p>
          )}
          <button
            className="primary large"
            disabled={busy || saving || !basket.length || !validTotal || !s.reconciled}
            onClick={() => void post()}
          >
            {saving ? 'جارٍ تسجيل الصرف…' : 'تسجيل الصرف والفاتورة'}
          </button>
          <small>كميات صحيحة بوحدة التسجيل. رصيد الآجل يبقى في الفاتورة للتحصيل لاحقًا.</small>
        </div>
      </section>
    </div>
  )
}
export function ReceiptEditor({
  s,
  busy,
  save,
  onClose,
}: {
  s: PharmacyState
  busy: boolean
  save: Save
  onClose: () => void
}) {
  const [lines, setLines] = useState<
      { medicineId: string; batch: string; expiry: string; qty: string; cost: string }[]
    >([{ medicineId: '', batch: '', expiry: '', qty: '', cost: '' }]),
    [error, setError] = useState(''),
    [saving, setSaving] = useState(false)
  const lock = useRef(false)
  const edit = (i: number, k: string, v: string) =>
    setLines((old) => old.map((x, n) => (n === i ? { ...x, [k]: v } : x)))
  return (
    <Modal
      title="استلام أدوية بالتشغيلة"
      onClose={onClose}
      busy={busy || saving}
      error={error}
      submit="تأكيد الاستلام"
      onSubmit={async (e) => {
        if (lock.current || busy) return
        lock.current = true
        setSaving(true)
        setError('')
        const f = new FormData(e.currentTarget)
        try {
          await save('pharmacy.receipt.post', {
            supplierId: String(f.get('supplierId')),
            reference: String(f.get('reference')),
            note: String(f.get('note')),
            lines: lines.map((x) => ({ ...x, qty: Number(x.qty), cost: readMoney(x.cost) })),
          })
          onClose()
        } catch (e) {
          setError(e instanceof Error ? e.message : 'تعذر الاستلام')
        } finally {
          lock.current = false
          setSaving(false)
        }
      }}
    >
      <div className="a-form-row">
        <Field label="المورد">
          <select name="supplierId" required defaultValue="">
            <option value="" disabled>
              اختر المورد
            </option>
            {s.suppliers
              .filter((x) => x.active)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="مرجع فاتورة المورد">
          <input required name="reference" maxLength={1000} />
        </Field>
      </div>
      <p className="muted">
        كل صف يخص دواء وتشغيلة. التكلفة هي إجمالي تكلفة الكمية المستلمة، وسعر البيع من دليل الأدوية.
      </p>
      {lines.map((x, i) => (
        <div className="ph-receive-line" key={i}>
          <div className="a-form-row">
            <Field label={'الدواء ' + (i + 1)}>
              <select
                required
                value={x.medicineId}
                onChange={(e) => edit(i, 'medicineId', e.target.value)}
              >
                <option value="">اختر الدواء</option>
                {s.medicines
                  .filter((x) => x.active)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name} · {x.unit}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label={'التشغيلة ' + (i + 1)}>
              <input
                required
                maxLength={160}
                value={x.batch}
                onChange={(e) => edit(i, 'batch', e.target.value)}
              />
            </Field>
            <Field label={'الصلاحية ' + (i + 1)}>
              <input
                required
                type="date"
                min={s.today}
                value={x.expiry}
                onChange={(e) => edit(i, 'expiry', e.target.value)}
              />
            </Field>
          </div>
          <div className="a-form-row">
            <Field label={'الكمية ' + (i + 1)}>
              <input
                required
                type="number"
                min="1"
                step="1"
                max="1000000000"
                value={x.qty}
                onChange={(e) => edit(i, 'qty', e.target.value)}
              />
            </Field>
            <Field label={'تكلفة الاستلام الإجمالية ' + (i + 1) + ' · ج.م'}>
              <input
                required
                dir="ltr"
                inputMode="decimal"
                value={x.cost}
                onChange={(e) => edit(i, 'cost', e.target.value)}
              />
            </Field>
            <button
              type="button"
              disabled={lines.length === 1 || busy || saving}
              onClick={() => setLines((old) => old.filter((_, n) => n !== i))}
            >
              حذف الصف
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        disabled={busy || saving || lines.length >= 50}
        onClick={() =>
          setLines((old) => [...old, { medicineId: '', batch: '', expiry: '', qty: '', cost: '' }])
        }
      >
        + إضافة تشغيلة
      </button>
      <Field label="ملاحظة الاستلام">
        <textarea name="note" maxLength={1000} />
      </Field>
      <small>
        التاريخ يوم كامل. يُمنع الاستلام والصرف في يوم انتهاء الصلاحية نفسه. لا تغيّر الصلاحية
        لتشغيلة سبق تسجيلها.
      </small>
    </Modal>
  )
}
