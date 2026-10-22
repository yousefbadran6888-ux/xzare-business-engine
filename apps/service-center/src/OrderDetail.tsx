import { useState } from 'react'
import type { ServiceCenter } from '@xzare/engine'
import { Modal, Field, amount, decimal } from './ui'
import { qty, readMoney, type State } from './model'
import { EstimateEditor } from './EstimateEditor'
export const phases = {
  received: 'استقبال',
  estimated: 'عرض سعر',
  approved: 'موافق عليه',
  in_progress: 'قيد الإصلاح',
  ready: 'تم الإصلاح',
  delivered: 'تم التسليم',
  cancelled: 'ملغى',
} as const
const methods = { cash: 'نقدي', bank: 'تحويل بنكي', card: 'بطاقة' } as const
export function OrderDetail({
  detail,
  state,
  manager,
  busy,
  onClose,
  onRun,
}: {
  detail: ReturnType<ServiceCenter['get']>
  state: State
  manager: boolean
  busy: boolean
  onClose: () => void
  onRun: (action: string, p: Record<string, unknown>) => Promise<void>
}) {
  const [action, setAction] = useState(''),
    [edit, setEdit] = useState(false),
    [error, setError] = useState('')
  const o = detail.order,
    e = detail.estimates.find((x) => x.id === o.estimateId)
  const perform = async (a: string, p: Record<string, unknown>) => {
    setError('')
    try {
      await onRun(a, p)
      setAction('')
      setEdit(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر الحفظ')
      throw e
    }
  }
  if (edit)
    return (
      <EstimateEditor
        order={o}
        state={state}
        busy={busy}
        error={error}
        onClose={() => {
          setEdit(false)
          setError('')
        }}
        onSave={(p) => perform('service-center.estimate.create', p)}
      />
    )
  return (
    <Modal title={'أمر الصيانة ' + o.number} manual busy={busy} error={error} onClose={onClose}>
      <div className="sc-job-detail">
        <div className="sc-print-title">
          <h2>
            {state.settings.businessName} · أمر الصيانة {o.number}
          </h2>
          <p>
            {state.settings.phone} · {state.settings.address}
          </p>
          <p>XZARE SERVICE CENTER · {new Date(o.at).toLocaleString('ar-EG')}</p>
        </div>
        <div className="sc-job-head">
          <div>
            <span className={'sc-status ' + o.status}>{phases[o.status]}</span>
            <h3>
              {o.device.serial} · {o.device.brand} {o.device.model}
            </h3>
            <p>
              {o.device.customer} · <b dir="ltr">{o.device.phone || 'لم يسجل هاتف'}</b>
            </p>
          </div>
          <div>
            <small>نوع الجهاز</small>
            <b>{o.device.type}</b>
            <small>موعد متوقع: {o.dueDate}</small>
          </div>
        </div>
        <section className="sc-intake">
          <p>
            <b>حالة الاستلام:</b> {o.condition}
          </p>
          <p>
            <b>الملحقات:</b> {o.accessories || 'لم تسجّل ملحقات'}
          </p>
        </section>
        {detail.parent && (
          <p className="sc-warranty">
            <b>رجوع ضمان للأمر {detail.parent.number}</b> · {o.coverageNote}
            <br /> ينتهي الضمان الأصلي:{' '}
            {detail.parent.warrantyUntil
              ? new Date(detail.parent.warrantyUntil).toLocaleDateString('ar-EG')
              : '—'}
          </p>
        )}
        <p>
          <b>شكوى العميل:</b> {o.complaint}
        </p>
        <p>
          الفني: {o.technicianName || 'لم يُسند بعد'} · مخزن القطع:{' '}
          {state.warehouses.find((w) => w.id === o.warehouseId)?.name}
        </p>
        <div className="sc-steps">
          {Object.entries(phases)
            .filter(([s]) => s !== 'cancelled')
            .map(([s, label]) => (
              <span key={s} className={o.status === s ? 'current' : ''}>
                {label}
              </span>
            ))}
        </div>
        {e ? (
          <section className="sc-estimate">
            <h3>عرض السعر الحالي · نسخة {e.revision}</h3>
            <p>{e.diagnosis}</p>
            {o.kind === 'repair' && (
              <p className="sc-warranty">
                <b>ضمان الإصلاح: {e.warrantyDays} يومًا من التسليم</b> ·{' '}
                {e.warrantyTerms || 'بدون ضمان'}
                {o.warrantyUntil && (
                  <> · حتى {new Date(o.warrantyUntil).toLocaleDateString('ar-EG')}</>
                )}
              </p>
            )}
            <table>
              <thead>
                <tr>
                  <th>القطعة / الخدمة</th>
                  <th>الكمية</th>
                  <th>سعر الوحدة</th>
                  <th>الإجمالي · ج.م</th>
                </tr>
              </thead>
              <tbody>
                {e.lines.map((l) => (
                  <tr key={l.id}>
                    <td>
                      {l.description}
                      <small>{l.kind === 'part' ? 'قطعة غيار' : 'مصنعية / خدمة'}</small>
                    </td>
                    <td>
                      {qty(l.qty)} {l.kind === 'part' ? l.unit : ''}
                    </td>
                    <td>{amount(l.price)}</td>
                    <td>{amount(l.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              قبل الخصم {amount(e.subtotal)} · خصم {amount(e.discount)} · ضريبة {amount(e.tax)} (
              {e.taxBps / 100}%)
            </p>
            <div className="sc-totals">
              <span>
                إجمالي الأمر <b>{amount(o.total)}</b>
              </span>
              <span>
                المدفوع <b>{amount(o.paid)}</b>
              </span>
              <span>
                المتبقي <b>{amount(o.total - o.paid)}</b>
              </span>
            </div>
          </section>
        ) : (
          <p className="a-empty">سجّل التشخيص وعرض السعر قبل بدء الإصلاح.</p>
        )}
        {detail.estimates.length > 1 && (
          <details>
            <summary>سجل عروض السعر · {detail.estimates.length} نسخ</summary>
            {detail.estimates.map((x) => (
              <p key={x.id}>
                نسخة {x.revision} · {x.diagnosis} · {amount(x.total)} ج.م ·{' '}
                {new Date(x.at).toLocaleString('ar-EG')}
              </p>
            ))}
          </details>
        )}
        {manager && (
          <div className="sc-job-actions">
            {['received', 'estimated'].includes(o.status) && (
              <button
                className="primary"
                disabled={busy}
                onClick={() => {
                  setError('')
                  setEdit(true)
                }}
              >
                تشخيص وعرض سعر
              </button>
            )}
            {o.status === 'estimated' && (
              <button
                className="primary"
                disabled={busy}
                onClick={() => {
                  setError('')
                  setAction('approve')
                }}
              >
                تسجيل موافقة العميل
              </button>
            )}
            {o.status === 'approved' && (
              <button
                className="primary"
                disabled={busy}
                onClick={() => {
                  setError('')
                  setAction('start')
                }}
              >
                بدء الإصلاح وصرف القطع
              </button>
            )}
            {o.status === 'in_progress' && (
              <button
                className="primary"
                disabled={busy}
                onClick={() => {
                  setError('')
                  setAction('ready')
                }}
              >
                إنجاز وفحص الإصلاح
              </button>
            )}
            {o.status === 'ready' && o.paid < o.total && (
              <button
                className="primary"
                disabled={busy}
                onClick={() => {
                  setError('')
                  setAction('pay')
                }}
              >
                تسجيل دفعة
              </button>
            )}
            {o.status === 'ready' && (
              <button
                disabled={busy || o.paid !== o.total}
                onClick={() => {
                  setError('')
                  setAction('deliver')
                }}
              >
                تسليم الجهاز
              </button>
            )}
            {o.status === 'delivered' &&
              o.kind === 'repair' &&
              o.warrantyUntil &&
              o.warrantyUntil >= Date.now() && (
                <button
                  disabled={busy}
                  onClick={() => {
                    setError('')
                    setAction('warranty')
                  }}
                >
                  قبول رجوع ضمان
                </button>
              )}
            {['received', 'estimated', 'approved'].includes(o.status) && (
              <button
                disabled={busy}
                onClick={() => {
                  setError('')
                  setAction('cancel')
                }}
              >
                إلغاء أمر الصيانة
              </button>
            )}
          </div>
        )}
        {action && (
          <form
            className="sc-action-form"
            onSubmit={(ev) => {
              ev.preventDefault()
              const f = new FormData(ev.currentTarget)
              void (async () => {
                try {
                  let p: Record<string, unknown> = { id: o.id }
                  if (action === 'warranty') {
                    await perform('service-center.warranty.create', {
                      parentId: o.id,
                      warehouseId: String(f.get('warehouseId')),
                      dueDate: String(f.get('dueDate')),
                      condition: String(f.get('condition')),
                      accessories: String(f.get('accessories')),
                      complaint: String(f.get('complaint')),
                      coverageNote: String(f.get('coverageNote')),
                    })
                    return
                  }
                  if (action === 'approve')
                    p = {
                      ...p,
                      estimateId: o.estimateId,
                      technicianId: String(f.get('technicianId')),
                      note: String(f.get('note')),
                    }
                  else if (action === 'ready')
                    p = {
                      ...p,
                      laborCost: readMoney(f.get('laborCost')),
                      note: String(f.get('note')),
                    }
                  else if (action === 'pay')
                    p = {
                      ...p,
                      amount: readMoney(f.get('amount')),
                      method: String(f.get('method')),
                      reference: String(f.get('reference')),
                    }
                  else if (action !== 'start') p = { ...p, note: String(f.get('note')) }
                  await perform('service-center.order.' + action, p)
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'راجع البيانات')
                }
              })()
            }}
          >
            <h3>
              {action === 'warranty'
                ? 'استلام رجوع ضمان'
                : action === 'start'
                  ? 'تأكيد بدء الإصلاح'
                  : action === 'ready'
                    ? 'الإنجاز والفحص'
                    : action === 'pay'
                      ? 'تحصيل دفعة'
                      : action === 'approve'
                        ? 'موافقة العميل والفني'
                        : action === 'cancel'
                          ? 'سبب الإلغاء'
                          : 'تأكيد التسليم'}
            </h3>
            {action === 'warranty' && (
              <>
                <p>
                  موافقة المدير على تغطية العطل ضمن شروط الضمان الأصلي. الإصلاح المغطى بدون تحصيل
                  جديد، وتكلفته تسجّل على المركز.
                </p>
                <Field label="العطل المرتجع">
                  <textarea name="complaint" required maxLength={1000} />
                </Field>
                <Field label="سبب قبول التغطية بالضمان">
                  <textarea name="coverageNote" required maxLength={1000} />
                </Field>
                <Field label="حالة الجهاز عند الرجوع">
                  <textarea name="condition" required maxLength={1000} />
                </Field>
                <Field label="الملحقات المستلمة">
                  <textarea name="accessories" maxLength={1000} />
                </Field>
                <div className="a-form-row">
                  <Field label="الموعد المتوقع">
                    <input
                      type="date"
                      name="dueDate"
                      required
                      defaultValue={new Date().toISOString().slice(0, 10)}
                    />
                  </Field>
                  <Field label="مخزن القطع">
                    <select name="warehouseId" defaultValue={o.warehouseId}>
                      {state.warehouses.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              </>
            )}
            {action === 'approve' && (
              <Field label="الفني المسؤول">
                <select required name="technicianId" defaultValue="">
                  <option value="" disabled>
                    اختر الفني
                  </option>
                  {state.technicians
                    .filter((t) => t.active)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                </select>
              </Field>
            )}
            {action === 'ready' && (
              <div className="a-form-row">
                <Field label="تكلفة العمل الفعلية · ج.م">
                  <input required dir="ltr" inputMode="decimal" name="laborCost" defaultValue="0" />
                </Field>
              </div>
            )}
            {action === 'warranty' ? null : action === 'pay' ? (
              <>
                <div className="a-form-row">
                  <Field label="المبلغ · ج.م">
                    <input
                      required
                      dir="ltr"
                      inputMode="decimal"
                      name="amount"
                      defaultValue={decimal(o.total - o.paid)}
                    />
                  </Field>
                  <Field label="طريقة الدفع">
                    <select name="method">
                      {Object.entries(methods).map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field label="مرجع التحصيل">
                  <input required maxLength={1000} name="reference" />
                </Field>
              </>
            ) : action === 'start' ? (
              <p>سيتم صرف القطع المعتمدة من المخزن مرة واحدة. راجع توافر القطع قبل البدء.</p>
            ) : (
              <Field
                label={
                  action === 'ready'
                    ? 'الأعمال المنفذة ونتيجة الفحص'
                    : action === 'approve'
                      ? 'مرجع موافقة العميل'
                      : action === 'cancel'
                        ? 'سبب الإلغاء'
                        : 'مرجع تسليم الجهاز'
                }
              >
                <textarea required maxLength={1000} name="note" />
              </Field>
            )}
            <div className="a-rosc-actions">
              <button className="primary" disabled={busy}>
                تأكيد وحفظ
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setAction('')
                  setError('')
                }}
              >
                رجوع
              </button>
            </div>
          </form>
        )}
        {!!detail.allocations.length && (
          <details>
            <summary>القطع المصروفة وتكلفتها الفعلية</summary>
            {detail.allocations.map((a, i) => (
              <p key={i}>
                {a.name} · {qty(a.qty)} · {a.batch || a.serial || 'بدون تتبع'} · {amount(a.cost)}{' '}
                ج.م
              </p>
            ))}
          </details>
        )}
        <section className="sc-payments">
          <h3>التحصيل</h3>
          {detail.payments.length ? (
            detail.payments.map((p) => (
              <p key={p.id}>
                {amount(p.amount)} ج.م · {methods[p.method as keyof typeof methods]} · {p.reference}{' '}
                · {new Date(p.at).toLocaleString('ar-EG')}
              </p>
            ))
          ) : (
            <p className="muted">
              {o.kind === 'warranty'
                ? 'إصلاح مغطى بالضمان؛ لا يتطلب تحصيلًا جديدًا.'
                : 'لم تُسجل دفعات. التحصيل متاح بعد إنجاز الإصلاح.'}
            </p>
          )}
        </section>
        <details>
          <summary>سجل أمر الصيانة</summary>
          {detail.events.map((ev, i) => (
            <p key={i}>
              <b>{phases[ev.status]}</b> · {ev.note}
              <small>
                {ev.userName} · {new Date(ev.at).toLocaleString('ar-EG')}
              </small>
            </p>
          ))}
        </details>
        <footer>
          <button type="button" disabled={busy} onClick={onClose}>
            إغلاق
          </button>
          <button type="button" onClick={() => window.print()}>
            طباعة أمر الصيانة
          </button>
        </footer>
      </div>
    </Modal>
  )
}
