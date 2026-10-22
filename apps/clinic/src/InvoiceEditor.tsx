import { useState } from 'react'
import type { ClinicService, ClinicAppointment } from '@xzare/engine'
import { Modal, Field, amount, decimal } from './ui'
import { readMoney } from './model'
export function InvoiceEditor({
  appointment,
  services,
  busy,
  error,
  onClose,
  onSave,
}: {
  appointment: ClinicAppointment
  services: ClinicService[]
  busy: boolean
  error: string
  onClose: () => void
  onSave: (p: Record<string, unknown>) => Promise<void>
}) {
  const [lines, setLines] = useState<
      { key: number; serviceId: string; qty: string; price: string }[]
    >([]),
    [discount, setDiscount] = useState('0'),
    [tax, setTax] = useState('0'),
    [local, setLocal] = useState('')
  const edit = (key: number, v: Partial<(typeof lines)[number]>) =>
    setLines((old) => old.map((l) => (l.key === key ? { ...l, ...v } : l)))
  let total: number | null = null
  try {
    const sub = lines.reduce(
        (n, l) => n + BigInt(Number(l.qty) || 0) * BigInt(readMoney(l.price)),
        0n,
      ),
      net = sub - BigInt(readMoney(discount)),
      bps = BigInt(readMoney(tax))
    if (net >= 0n) total = Number(net + (net * bps + 5000n) / 10000n)
  } catch {}
  return (
    <Modal
      title={'فاتورة ' + appointment.patientName}
      busy={busy}
      error={local || error}
      onClose={onClose}
      submit="إصدار الفاتورة"
      disabled={!lines.length}
      onSubmit={() => {
        setLocal('')
        void (async () => {
          try {
            await onSave({
              appointmentId: appointment.id,
              lines: lines.map((l) => ({
                serviceId: l.serviceId,
                qty: Number(l.qty),
                price: readMoney(l.price),
              })),
              discount: readMoney(discount),
              taxBps: readMoney(tax),
            })
          } catch (err) {
            setLocal(err instanceof Error ? err.message : 'تعذر إصدار الفاتورة')
          }
        })()
      }}
    >
      <p className="muted">
        {appointment.number} · {appointment.doctorName}. الفاتورة تحفظ أسماء الخدمات والأسعار وقت
        الإصدار، ولا تتضمن ملاحظات طبية.
      </p>
      {lines.map((l) => (
        <div className="clinic-bill-line" key={l.key}>
          <Field label="الخدمة">
            <select
              required
              value={l.serviceId}
              onChange={(e) => {
                const s = services.find((x) => x.id === e.target.value)
                edit(l.key, { serviceId: e.target.value, price: s ? decimal(s.price) : '0' })
              }}
            >
              <option value="">اختر الخدمة</option>
              {services
                .filter((s) => s.active)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="العدد">
            <input
              required
              type="number"
              min="1"
              max="100"
              step="1"
              value={l.qty}
              onChange={(e) => edit(l.key, { qty: e.target.value })}
            />
          </Field>
          <Field label="السعر · ج.م">
            <input
              required
              inputMode="decimal"
              dir="ltr"
              value={l.price}
              onChange={(e) => edit(l.key, { price: e.target.value })}
            />
          </Field>
          <button
            type="button"
            disabled={busy}
            onClick={() => setLines((old) => old.filter((x) => x.key !== l.key))}
            aria-label="حذف الخدمة"
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={busy || lines.length >= 50 || !services.some((s) => s.active)}
        onClick={() =>
          setLines((old) => [...old, { key: Date.now(), serviceId: '', qty: '1', price: '0' }])
        }
      >
        إضافة خدمة
      </button>
      {!services.some((s) => s.active) && (
        <p className="alert">أضف خدمة من شاشة الخدمات والأسعار أولًا.</p>
      )}
      <div className="a-form-row">
        <Field label="الخصم · ج.م">
          <input
            dir="ltr"
            inputMode="decimal"
            value={discount}
            onChange={(e) => setDiscount(e.target.value)}
          />
        </Field>
        <Field label="نسبة الضريبة %">
          <input
            dir="ltr"
            inputMode="decimal"
            value={tax}
            onChange={(e) => setTax(e.target.value)}
          />
        </Field>
      </div>
      <div className="clinic-total">
        الإجمالي <strong>{total === null ? 'راجع المبالغ' : amount(total) + ' ج.م'}</strong>
      </div>
    </Modal>
  )
}
