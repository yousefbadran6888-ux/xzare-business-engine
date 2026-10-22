import { useState, type FormEvent } from 'react'
import type { ProductionOrder } from '@xzare/engine'
import { Modal, Field, amount, today } from './ui'
import { readQty, readMoney, qty, type State } from './model'
export function OrderEditor({
  state,
  order,
  busy,
  onClose,
  onSave,
}: {
  state: State
  order?: ProductionOrder
  busy: boolean
  onClose: () => void
  onSave: (p: Record<string, unknown>) => Promise<unknown>
}) {
  const [snapshot] = useState(() => state),
    [bomId, setBom] = useState(''),
    [quantity, setQuantity] = useState(''),
    [source, setSource] = useState(order?.warehouseId ?? snapshot.warehouses[0]?.id ?? ''),
    [destination, setDestination] = useState(
      order?.destinationId ?? snapshot.warehouses[0]?.id ?? '',
    ),
    [due, setDue] = useState(today()),
    [good, setGood] = useState(''),
    [scrap, setScrap] = useState(''),
    [error, setError] = useState('')
  const selected = snapshot.boms.find((b) => b.id === bomId)
  const needed = (() => {
    if (!selected || !quantity) return []
    try {
      const q = readQty(quantity)
      return selected.components.map((c) => {
        const numerator = BigInt(c.qty) * BigInt(q) * BigInt(10000 + c.wasteBps),
          den = BigInt(selected.yieldQty) * 10000n,
          n = Number((numerator + den - 1n) / den),
          available = snapshot.balances
            .filter(
              (b) =>
                b.variantId === c.variantId &&
                b.warehouseId === source &&
                (!b.expiry || b.expiry >= today()),
            )
            .reduce((s, b) => s + b.qty, 0)
        return { ...c, required: n, available, shortage: Math.max(0, n - available) }
      })
    } catch {
      return []
    }
  })()
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (busy) return
    setError('')
    try {
      const f = new FormData(e.currentTarget)
      if (order)
        await onSave({
          id: order.id,
          goodQty: readQty(good),
          scrapQty: readQty(scrap),
          laborCost: readMoney(f.get('labor')),
          overheadCost: readMoney(f.get('overhead')),
          batch: String(f.get('batch') ?? ''),
          ...(f.get('expiry') ? { expiry: String(f.get('expiry')) } : {}),
          serials: String(f.get('serials') ?? '')
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean),
          note: String(f.get('note')),
        })
      else
        await onSave({
          bomId,
          qty: readQty(quantity),
          warehouseId: source,
          destinationId: destination,
          dueDate: due,
          note: String(f.get('note')),
        })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر حفظ الأمر')
    }
  }
  return (
    <Modal
      busy={busy}
      error=""
      manual
      title={order ? 'إكمال إنتاج ' + order.number : 'أمر إنتاج جديد'}
      onClose={onClose}
    >
      <form onSubmit={save}>
        {error && (
          <p className="alert error" role="alert">
            {error}
          </p>
        )}
        {order ? (
          <>
            <p className="m-summary">
              {order.outputName} · كمية الأمر{' '}
              <b>
                {qty(order.qty)} {order.unit}
              </b>
            </p>
            <p className="muted">
              أدخل الناتج الفعلي. السليم + الهالك يساويان كمية الأمر. تكلفة الخامات والإنتاج تتحملها
              الكمية السليمة؛ لو الكل هالك تُسجل التكلفة كخسارة.
            </p>
            <div className="a-form-row">
              <Field label="الكمية السليمة">
                <input
                  required
                  inputMode="decimal"
                  dir="ltr"
                  value={good}
                  onChange={(e) => setGood(e.target.value)}
                />
              </Field>
              <Field label="كمية الهالك">
                <input
                  required
                  inputMode="decimal"
                  dir="ltr"
                  value={scrap}
                  onChange={(e) => setScrap(e.target.value)}
                />
              </Field>
            </div>
            <div className="a-form-row">
              <Field label="تكلفة العمالة الفعلية · ج.م">
                <input required name="labor" defaultValue="0" dir="ltr" inputMode="decimal" />
              </Field>
              <Field label="تكاليف إنتاج إضافية · ج.م">
                <input required name="overhead" defaultValue="0" dir="ltr" inputMode="decimal" />
              </Field>
            </div>
            <p className="muted">تكلفة الخامات المصروفة: {amount(order.materialCost)} ج.م</p>
            <div className="a-form-row">
              <Field label="تشغيلة المنتج">
                <input name="batch" defaultValue={order.number} maxLength={100} dir="ltr" />
              </Field>
              <Field label="صلاحية المنتج (اختياري)">
                <input name="expiry" type="date" />
              </Field>
            </div>
            <Field label="الأرقام التسلسلية (اختياري؛ رقم لكل سطر)">
              <textarea
                name="serials"
                rows={3}
                maxLength={10100}
                dir="ltr"
                placeholder="رقم فريد لكل وحدة سليمة كاملة"
              />
            </Field>
          </>
        ) : (
          <>
            <p className="muted">
              الأمر يثبت إصدار قائمة الخامات. لن يتغير المخزون إلا عند بدء التصنيع.
            </p>
            <Field label="قائمة الخامات / الإصدار">
              <select required value={bomId} onChange={(e) => setBom(e.target.value)}>
                <option value="">اختر قائمة المنتج</option>
                {snapshot.boms.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.outputName} — {b.name} · إصدار {b.revision}
                  </option>
                ))}
              </select>
            </Field>
            <div className="a-form-row">
              <Field label="كمية أمر الإنتاج">
                <input
                  required
                  inputMode="decimal"
                  dir="ltr"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </Field>
              <Field label="موعد الإكمال المطلوب">
                <input required type="date" value={due} onChange={(e) => setDue(e.target.value)} />
              </Field>
            </div>
            <div className="a-form-row">
              <Field label="مخزن الخامات">
                <select value={source} onChange={(e) => setSource(e.target.value)}>
                  {snapshot.warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="مخزن المنتج النهائي">
                <select value={destination} onChange={(e) => setDestination(e.target.value)}>
                  {snapshot.warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {!!needed.length && (
              <div className="a-sheet a-scroll m-preview">
                <table>
                  <thead>
                    <tr>
                      <th>الخامة</th>
                      <th>الاحتياج شامل السماح</th>
                      <th>المتاح الصالح</th>
                      <th>الناقص</th>
                    </tr>
                  </thead>
                  <tbody>
                    {needed.map((c) => (
                      <tr key={c.variantId}>
                        <td>{c.name}</td>
                        <td>
                          {qty(c.required)} {c.unit}
                        </td>
                        <td>{qty(c.available)}</td>
                        <td className={c.shortage ? 'i-warn' : ''}>{qty(c.shortage)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="muted">
                  معاينة الرصيد عند فتح النموذج؛ التحقق النهائي عند بدء التصنيع.
                </p>
              </div>
            )}
          </>
        )}
        <Field label={order ? 'ملاحظات إكمال الإنتاج' : 'مرجع أمر الإنتاج'}>
          <textarea name="note" required maxLength={1000} rows={2} />
        </Field>
        <footer className="a-modal-foot">
          <button type="button" onClick={onClose} disabled={busy}>
            إغلاق
          </button>
          <button className="primary" disabled={busy}>
            {order ? 'اعتماد الإنتاج والهالك' : 'حفظ الأمر المخطط'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}
