import { useRef, useState } from 'react'
import { call } from '../../pos/src/bridge'
import type { Product } from '@xzare/engine'
import { Modal, Field, amount } from './ui'
import { kinds, qty, readQty, readMoney, type State } from './model'
type Row = {
  variantId: string
  quantity: string
  cost: string
  batch: string
  serial: string
  expiry: string
}
const blank = (variantId = ''): Row => ({
  variantId,
  quantity: '1',
  cost: '',
  batch: '',
  serial: '',
  expiry: '',
})
export function DocumentEditor({
  kind,
  state,
  busy,
  error,
  onClose,
  onSave,
}: {
  kind: keyof typeof kinds
  state: State
  busy: boolean
  error: string
  onClose: () => void
  onSave: (p: Record<string, unknown>) => Promise<unknown>
}) {
  const [snapshot] = useState(state),
    [warehouseId, setWarehouse] = useState(state.warehouses[0]?.id ?? ''),
    [destinationId, setDestination] = useState(state.warehouses[1]?.id ?? ''),
    [note, setNote] = useState(''),
    [rows, setRows] = useState<Row[]>([{ ...blank(), quantity: kind === 'count' ? '' : '1' }]),
    [code, setCode] = useState(''),
    [localError, setError] = useState(''),
    [scanning, setScanning] = useState(false)
  const scanBusy = useRef(false)
  const patch = (i: number, p: Partial<Row>) =>
    setRows((xs) => xs.map((x, j) => (i === j ? { ...x, ...p } : x)))
  const balance = (r: Row) =>
    snapshot.balances.find(
      (b) =>
        b.variantId === r.variantId &&
        b.warehouseId === warehouseId &&
        b.batch === r.batch.trim() &&
        b.serial === r.serial.trim(),
    )
  async function scan() {
    if (scanBusy.current || busy || rows.length >= 100 || !code.trim()) return
    scanBusy.current = true
    setScanning(true)
    setError('')
    try {
      const v = await call<{ product: Product; quantity: number }>('barcode.lookup', {
        code: code.trim(),
      })
      setRows((xs) => {
        const empty = xs.findIndex((x) => !x.variantId)
        if (empty >= 0)
          return xs.map((x, i) =>
            i === empty
              ? { ...blank(v.product.id), quantity: kind === 'count' ? '' : qty(v.quantity) }
              : x,
          )
        return [
          ...xs,
          { ...blank(v.product.id), quantity: kind === 'count' ? '' : qty(v.quantity) },
        ]
      })
      setCode('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر قراءة الكود')
    } finally {
      setScanning(false)
      scanBusy.current = false
    }
  }
  async function submit() {
    setError('')
    try {
      const lines = rows.map((r) => {
        if (!r.variantId) throw new Error('اختر صنفًا لكل سطر')
        const q = readQty(r.quantity),
          b = balance(r)
        return {
          variantId: r.variantId,
          qty: q,
          batch: r.batch.trim(),
          serial: r.serial.trim(),
          ...(kind === 'receipt' && r.expiry ? { expiry: r.expiry } : {}),
          ...(kind === 'receipt' || (kind === 'count' && q > (b?.qty ?? 0))
            ? { cost: readMoney(r.cost) }
            : {}),
          ...(kind === 'count' ? { expectedQty: b?.qty ?? 0, expectedCost: b?.cost ?? 0 } : {}),
        }
      })
      await onSave({
        kind,
        warehouseId,
        ...(kind === 'transfer' ? { destinationId } : {}),
        note,
        lines,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'راجع البيانات')
    }
  }
  return (
    <Modal
      title={'مستند ' + kinds[kind]}
      busy={busy || scanning}
      error={localError || error}
      onClose={onClose}
      submit={'اعتماد ' + kinds[kind]}
      onSubmit={() => {
        void submit()
      }}
    >
      <p className="muted">
        {kind === 'count'
          ? 'اكتب الكمية التي عدّيتها فعليًا. يُحسب فرق الجرد تلقائيًا، ويُرفض الاعتماد إذا تغيّر الرصيد.'
          : 'المستند المعتمد يحدّث أرصدة المخازن ويظل محفوظًا بسجل الحركة.'}
      </p>
      <div className="a-form-row">
        <Field label={kind === 'transfer' ? 'من مخزن' : 'المخزن'}>
          <select value={warehouseId} onChange={(e) => setWarehouse(e.target.value)}>
            {snapshot.warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </Field>
        {kind === 'transfer' && (
          <Field label="إلى مخزن">
            <select value={destinationId} onChange={(e) => setDestination(e.target.value)}>
              <option value="">اختر الوجهة</option>
              {snapshot.warehouses
                .filter((w) => w.id !== warehouseId)
                .map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
            </select>
          </Field>
        )}
      </div>
      <div className="i-scanner">
        <Field label="إضافة صنف بالباركود">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void scan()
              }
            }}
            dir="ltr"
            autoComplete="off"
            placeholder="امسح الكود ثم Enter"
          />
        </Field>
        <button
          type="button"
          disabled={scanning || busy}
          onClick={() => {
            void scan()
          }}
        >
          اختيار بالباركود
        </button>
      </div>
      {rows.map((r, i) => {
        const b = balance(r),
          p = snapshot.products.find((p) => p.id === r.variantId)
        return (
          <div className="i-line" key={i}>
            <div className="i-line-heading">
              <b>صنف {i + 1}</b>
              {rows.length > 1 && (
                <button
                  type="button"
                  onClick={() => setRows((xs) => xs.filter((_, j) => j !== i))}
                  disabled={busy}
                >
                  حذف السطر
                </button>
              )}
            </div>
            <Field label="الصنف">
              <select
                required
                value={r.variantId}
                onChange={(e) =>
                  patch(i, { variantId: e.target.value, batch: '', serial: '', expiry: '' })
                }
              >
                <option value="">اختر الصنف</option>
                {snapshot.products
                  .filter((p) => p.active)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.sku} — {p.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label={kind === 'count' ? 'الكمية الفعلية' : 'الكمية'}>
              <input
                value={r.quantity}
                onChange={(e) => patch(i, { quantity: e.target.value })}
                inputMode="decimal"
                required
                dir="ltr"
              />
            </Field>
            <Field label="الوحدة">
              <input readOnly value={p?.unit ?? '—'} />
            </Field>
            {kind === 'receipt' ? (
              <>
                <Field label="رقم التشغيلة (اختياري)">
                  <input
                    maxLength={100}
                    value={r.batch}
                    onChange={(e) => patch(i, { batch: e.target.value })}
                    dir="ltr"
                  />
                </Field>
                <Field label="رقم تسلسلي لوحدة واحدة">
                  <input
                    maxLength={100}
                    value={r.serial}
                    onChange={(e) => patch(i, { serial: e.target.value })}
                    dir="ltr"
                  />
                </Field>
                <Field label="انتهاء الصلاحية">
                  <input
                    type="date"
                    value={r.expiry}
                    onChange={(e) => patch(i, { expiry: e.target.value })}
                  />
                </Field>
              </>
            ) : (
              <Field label="التشغيلة / الرقم التسلسلي">
                <select
                  value={JSON.stringify([r.batch, r.serial])}
                  onChange={(e) => {
                    const [batch, serial] = JSON.parse(e.target.value)

                    patch(i, {
                      batch,
                      serial,
                      ...(kind === 'count' ? { quantity: '' } : {}),
                    })
                  }}
                >
                  <option value='["",""]'>بدون تشغيلة أو رقم تسلسلي</option>
                  {snapshot.balances
                    .filter(
                      (b) =>
                        b.variantId === r.variantId &&
                        b.warehouseId === warehouseId &&
                        (b.batch || b.serial),
                    )
                    .map((b) => (
                      <option key={b.lotId} value={JSON.stringify([b.batch, b.serial])}>
                        {b.batch || 'بدون تشغيلة'} / {b.serial || 'غير مسلسل'} · {qty(b.qty)}{' '}
                        {b.expiry ? '· ' + b.expiry : ''}
                      </option>
                    ))}
                </select>
              </Field>
            )}
            {(kind === 'receipt' || kind === 'count') && (
              <Field
                label={
                  kind === 'receipt' ? 'التكلفة الإجمالية · ج.م' : 'تكلفة كمية الزيادة فقط · ج.م'
                }
              >
                <input
                  value={r.cost}
                  onChange={(e) => patch(i, { cost: e.target.value })}
                  inputMode="decimal"
                  required={kind === 'receipt'}
                  dir="ltr"
                  placeholder={
                    kind === 'count' ? 'تُترك فارغة عند العجز' : 'تكلفة كل الكمية في السطر'
                  }
                />
              </Field>
            )}
            <span className="i-stock">
              الرصيد عند فتح المستند:{' '}
              <b>
                {qty(b?.qty ?? 0)} {p?.unit}
              </b>{' '}
              · القيمة: {amount(b?.cost ?? 0)} ج.م{r.serial && ' · الرقم التسلسلي يخص وحدة واحدة'}
            </span>
          </div>
        )
      })}
      <button
        type="button"
        onClick={() =>
          setRows((xs) => [...xs, { ...blank(), quantity: kind === 'count' ? '' : '1' }])
        }
        disabled={busy || rows.length >= 100}
      >
        + إضافة صنف
      </button>
      <Field label="مرجع العملية / سبب الحركة">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          required
          maxLength={1000}
          placeholder={kind === 'count' ? 'سبب فرق الجرد' : 'اسم المورد أو المستلم أو رقم المستند'}
        />
      </Field>
    </Modal>
  )
}
