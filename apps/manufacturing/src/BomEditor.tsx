import { useState, type FormEvent } from 'react'
import type { ManufacturingBom } from '@xzare/engine'
import { call } from '../../pos/src/bridge'
import { Field, Modal } from './ui'
import { qty, readQty, readMoney, type State } from './model'
type Row = { variantId: string; quantity: string; waste: string }
export function BomEditor({
  state,
  initial,
  busy,
  onClose,
  onSave,
}: {
  state: State
  initial?: ManufacturingBom
  busy: boolean
  onClose: () => void
  onSave: (p: Record<string, unknown>) => Promise<unknown>
}) {
  const [snapshot] = useState(() => state),
    [output, setOutput] = useState(initial?.outputVariantId ?? ''),
    [name, setName] = useState(initial?.name ?? ''),
    [yieldQty, setYield] = useState(initial ? qty(initial.yieldQty) : ''),
    [rows, setRows] = useState<Row[]>(
      () =>
        initial?.components.map((c) => ({
          variantId: c.variantId,
          quantity: qty(c.qty),
          waste: String(c.wasteBps / 100),
        })) ?? [{ variantId: '', quantity: '', waste: '0' }],
    ),
    [scan, setScan] = useState(''),
    [error, setError] = useState(''),
    [scanning, setScanning] = useState(false)
  const patch = (i: number, p: Partial<Row>) =>
    setRows((rs) => rs.map((r, n) => (n === i ? { ...r, ...p } : r)))
  async function lookup() {
    if (scanning || busy) return
    setScanning(true)
    setError('')
    try {
      const r = await call<{ product: { id: string }; quantity: number }>('barcode.lookup', {
        code: scan,
      })
      if (r.product.id === output) throw new Error('المنتج النهائي لا يُضاف ضمن خاماته')
      setRows((rs) => {
        const empty = rs.findIndex((x) => !x.variantId)
        if (empty >= 0)
          return rs.map((x, i) =>
            i === empty ? { variantId: r.product.id, quantity: qty(r.quantity), waste: '0' } : x,
          )
        return [...rs, { variantId: r.product.id, quantity: qty(r.quantity), waste: '0' }]
      })
      setScan('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر قراءة الباركود')
    } finally {
      setScanning(false)
    }
  }
  async function save(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setError('')
    try {
      await onSave({
        outputVariantId: output,
        name,
        yieldQty: readQty(yieldQty),
        components: rows.map((r) => ({
          variantId: r.variantId,
          qty: readQty(r.quantity),
          wasteBps: readMoney(r.waste),
        })),
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر حفظ القائمة')
    }
  }
  return (
    <Modal
      busy={busy}
      error=""
      manual
      title={initial ? 'إصدار جديد لقائمة الخامات' : 'قائمة خامات جديدة'}
      onClose={onClose}
    >
      <form onSubmit={save}>
        <p className="muted">
          حدد كمية الإنتاج الأساسية وخاماتها. يُحتفظ بكل إصدار مع أوامر الإنتاج التي استخدمته.
        </p>
        {error && (
          <p className="alert error" role="alert">
            {error}
          </p>
        )}
        <div className="a-form-row">
          <Field label="المنتج النهائي">
            <select required value={output} onChange={(e) => setOutput(e.target.value)}>
              <option value="">اختر المنتج</option>
              {snapshot.products
                .filter((p) => p.active)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.sku} — {p.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="كمية الإنتاج الأساسية">
            <input
              required
              inputMode="decimal"
              dir="ltr"
              value={yieldQty}
              onChange={(e) => setYield(e.target.value)}
            />
          </Field>
        </div>
        <Field label="اسم قائمة الخامات">
          <input required maxLength={160} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="m-scan">
          <Field label="إضافة خامة بالباركود">
            <input
              value={scan}
              onChange={(e) => setScan(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void lookup()
                }
              }}
              dir="ltr"
              placeholder="امسح كود الخامة"
            />
          </Field>
          <button
            type="button"
            disabled={busy || scanning || rows.length >= 50}
            onClick={() => void lookup()}
          >
            إضافة بالباركود
          </button>
        </div>
        <div className="m-bom-lines">
          {rows.map((r, i) => (
            <div className="m-bom-line" key={i}>
              <Field label={'الخامة ' + (i + 1)}>
                <select
                  required
                  value={r.variantId}
                  onChange={(e) => patch(i, { variantId: e.target.value })}
                >
                  <option value="">اختر الخامة</option>
                  {snapshot.products
                    .filter((p) => p.active && p.id !== output)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.sku} — {p.name} · {p.unit}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label={'كمية الخامة ' + (i + 1)}>
                <input
                  required
                  inputMode="decimal"
                  dir="ltr"
                  value={r.quantity}
                  onChange={(e) => patch(i, { quantity: e.target.value })}
                />
              </Field>
              <Field label={'الهالك المسموح % ' + (i + 1)}>
                <input
                  required
                  inputMode="decimal"
                  dir="ltr"
                  value={r.waste}
                  onChange={(e) => patch(i, { waste: e.target.value })}
                />
              </Field>
              <button
                type="button"
                aria-label={'حذف الخامة ' + (i + 1)}
                disabled={rows.length === 1 || busy}
                onClick={() => setRows((rs) => rs.filter((_, n) => n !== i))}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          disabled={busy || rows.length >= 50}
          onClick={() => setRows((rs) => [...rs, { variantId: '', quantity: '', waste: '0' }])}
        >
          + إضافة خامة
        </button>
        <footer className="a-modal-foot">
          <button type="button" onClick={onClose} disabled={busy}>
            إغلاق
          </button>
          <button className="primary" disabled={busy || scanning}>
            حفظ إصدار القائمة
          </button>
        </footer>
      </form>
    </Modal>
  )
}
