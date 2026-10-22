import { useState, type FormEvent } from 'react'
import type { LabPatient, LabTest } from '@xzare/engine'
import { Modal, Field, amount } from './ui'
import { readMoney, localInput } from './model'
export function OrderEditor({
  patients,
  tests,
  patientId,
  busy,
  error,
  onClose,
  onCreate,
}: {
  patients: LabPatient[]
  tests: LabTest[]
  patientId: string
  busy: boolean
  error: string
  onClose: () => void
  onCreate: (p: Record<string, unknown>) => Promise<void>
}) {
  const [selected, setSelected] = useState<string[]>([]),
    [query, setQuery] = useState(''),
    [discount, setDiscount] = useState('0'),
    [tax, setTax] = useState('0'),
    [localError, setLocalError] = useState('')
  const subtotal = tests.filter((t) => selected.includes(t.id)).reduce((n, t) => n + t.price, 0)
  let total = subtotal
  try {
    const off = readMoney(discount),
      bps = readMoney(tax)
    if (off > subtotal || bps > 10000) throw Error()
    total = Number(BigInt(subtotal - off) + (BigInt(subtotal - off) * BigInt(bps) + 5000n) / 10000n)
  } catch {
    total = NaN
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    if (busy) return
    const f = new FormData(e.currentTarget)
    setLocalError('')
    try {
      if (!selected.length) throw new Error('اختر تحليلًا واحدًا على الأقل')
      await onCreate({
        patientId: String(f.get('patientId')),
        testIds: selected,
        referrer: String(f.get('referrer')),
        dueAt: new Date(String(f.get('dueAt'))).getTime(),
        discount: readMoney(discount),
        taxBps: readMoney(tax),
      })
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'تعذر إنشاء الطلب')
    }
  }
  return (
    <Modal
      title="طلب تحاليل جديد"
      busy={busy}
      error={localError || error}
      onClose={onClose}
      onSubmit={(e) => void submit(e)}
      submit="إنشاء الطلب والفاتورة"
      disabled={!selected.length || !Number.isFinite(total)}
    >
      <Field label="المريض">
        <select name="patientId" required defaultValue={patientId}>
          <option value="">اختر المريض</option>
          {patients
            .filter((p) => p.active)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.number}
              </option>
            ))}
        </select>
      </Field>
      <div className="a-form-row">
        <Field label="موعد التسليم المتوقع">
          <input
            name="dueAt"
            type="datetime-local"
            required
            defaultValue={localInput(Date.now() + 86400000)}
          />
        </Field>
        <Field label="الطبيب أو الجهة المحيلة (اختياري)">
          <input name="referrer" maxLength={160} />
        </Field>
      </div>
      <Field label="بحث في التحاليل">
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
      </Field>
      <div className="lab-test-picker">
        {tests
          .filter(
            (t) => t.active && (t.name + ' ' + t.code).toLowerCase().includes(query.toLowerCase()),
          )
          .map((t) => (
            <label key={t.id}>
              <input
                type="checkbox"
                disabled={busy}
                checked={selected.includes(t.id)}
                onChange={(e) =>
                  setSelected((xs) =>
                    e.target.checked ? [...xs, t.id] : xs.filter((x) => x !== t.id),
                  )
                }
              />
              <span>
                <b>{t.name}</b>
                <small>
                  {t.code} · {t.specimen}
                </small>
              </span>
              <strong>{amount(t.price)} ج.م</strong>
            </label>
          ))}
      </div>
      {!tests.some((t) => t.active) && <p>أضف تحاليل فعلية بأسعارها من دليل التحاليل أولًا.</p>}
      <div className="a-form-row">
        <Field label="الخصم · ج.م">
          <input
            dir="ltr"
            inputMode="decimal"
            value={discount}
            disabled={busy}
            onChange={(e) => setDiscount(e.target.value)}
          />
        </Field>
        <Field label="الضريبة %">
          <input
            dir="ltr"
            inputMode="decimal"
            value={tax}
            disabled={busy}
            onChange={(e) => setTax(e.target.value)}
          />
        </Field>
      </div>
      <div className="lab-order-total">
        <span>
          {selected.length} تحاليل · قيمة الخدمات {amount(subtotal)} ج.م
        </span>
        <b>الإجمالي: {Number.isFinite(total) ? amount(total) + ' ج.م' : 'راجع الخصم والضريبة'}</b>
      </div>
      <small>
        تُثبت أسعار التحاليل والوحدات والمراجع عند إنشاء الطلب. يولد النظام ملصق عينة مستقلًا لكل
        نوع عينة في الطلب.
      </small>
    </Modal>
  )
}
