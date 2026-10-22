import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { LabPatient, LabOrder, LabSample, User } from '@xzare/engine'
import { Modal, Field, amount } from './ui'
import { stamp, statuses, sampleStatuses, methods, flags, type Detail } from './model'
export function Barcode({ number }: { number: string }) {
  const canvas = useRef<HTMLCanvasElement>(null),
    [error, setError] = useState('')
  useEffect(() => {
    let live = true
    void import('bwip-js/browser')
      .then((m) => {
        if (live && canvas.current)
          m.default.toCanvas(canvas.current, {
            bcid: 'code128',
            text: number,
            scale: 2,
            height: 12,
            includetext: true,
            paddingwidth: 10,
            paddingheight: 3,
          })
      })
      .catch(() => {
        if (live) setError('تعذر رسم الباركود')
      })
    return () => {
      live = false
    }
  }, [number])
  return error ? (
    <p role="alert">{error}</p>
  ) : (
    <canvas ref={canvas} aria-label={'باركود ' + number} />
  )
}
export function PatientView({
  patient,
  orders,
  business,
  onClose,
  onOrder,
  onNew,
  canNew,
}: {
  patient: LabPatient
  orders: LabOrder[]
  business: string
  onClose: () => void
  onOrder: (id: string) => void
  onNew: () => void
  canNew: boolean
}) {
  return createPortal(
    <Modal title={'ملف ' + patient.name} busy={false} error="" onClose={onClose}>
      <section className="lab-label print-area">
        <small>{business} · بطاقة المريض</small>
        <h2>{patient.name}</h2>
        <p dir="ltr">{patient.phone || '—'}</p>
        <Barcode number={patient.number} />
      </section>
      <p>
        تاريخ الميلاد: {patient.birthDate || 'غير مسجل'} ·{' '}
        {patient.sex === 'male' ? 'ذكر' : patient.sex === 'female' ? 'أنثى' : 'النوع غير مسجل'}
      </p>
      <p>{patient.address || 'العنوان غير مسجل'}</p>
      <div className="toolbar">
        <button type="button" onClick={() => window.print()}>
          طباعة بطاقة المريض
        </button>
        {canNew && (
          <button type="button" disabled={!patient.active} onClick={onNew}>
            طلب تحاليل للمريض
          </button>
        )}
      </div>
      <h3>طلبات المريض</h3>
      {orders.length ? (
        <table>
          <thead>
            <tr>
              <th>الطلب</th>
              <th>التاريخ</th>
              <th>الحالة</th>
              <th>فتح</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id}>
                <td dir="ltr">{o.number}</td>
                <td>{stamp(o.at)}</td>
                <td>{statuses[o.status]}</td>
                <td>
                  <button type="button" onClick={() => onOrder(o.id)}>
                    فتح الطلب
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>لا توجد طلبات لهذا المريض.</p>
      )}
    </Modal>,
    document.body,
  )
}
export function OrderDetail({
  data,
  user,
  settings,
  busy,
  error,
  onClose,
  onAction,
  onSample,
  onReplace,
  onPay,
  onCancel,
  onReopen,
}: {
  data: Detail
  user: User
  settings: Record<string, string>
  busy: boolean
  error: string
  onClose: () => void
  onAction: (action: string, p: Record<string, unknown>) => Promise<void>
  onSample: (s: LabSample, status: 'collected' | 'received' | 'rejected') => void
  onReplace: (s: LabSample) => void
  onPay: () => void
  onCancel: () => void
  onReopen: () => void
}) {
  const o = data.order,
    technical = ['admin', 'manager', 'technician'].includes(user.role),
    finance = user.role !== 'technician',
    reviewer = ['admin', 'manager'].includes(user.role)
  const [tab, setTab] = useState<'samples' | 'results' | 'reports' | 'fees'>('samples'),
    [draft, setDraft] = useState(
      data.tests.map((t) => ({ id: t.id, value: t.value ?? '', note: t.note ?? '' })),
    ),
    [saving, setSaving] = useState(false),
    [localError, setLocalError] = useState(''),
    [discard, setDiscard] = useState(false),
    [confirm, setConfirm] = useState(false),
    [printSample, setPrintSample] = useState<LabSample | null>(null),
    [revision, setRevision] = useState(data.reports[0]?.revision ?? 0)
  useEffect(() => {
    setDraft(data.tests.map((t) => ({ id: t.id, value: t.value ?? '', note: t.note ?? '' })))
    setConfirm(false)
    setRevision(data.reports[0]?.revision ?? 0)
  }, [data.order.version])
  const locked = busy || saving,
    dirty = draft.some((d) => {
      const old = data.tests.find((t) => t.id === d.id)
      return d.value !== (old?.value ?? '') || d.note !== (old?.note ?? '')
    }),
    active = data.samples.filter((s) => !s.replacedBy),
    ready = active.length > 0 && active.every((s) => s.status === 'received'),
    report = data.reports.find((r) => r.revision === revision)
  const close = () => {
    if (locked) return
    if (dirty) setDiscard(true)
    else onClose()
  }
  const mutate = async (action: string, p: Record<string, unknown>) => {
    if (locked) return
    setSaving(true)
    setLocalError('')
    try {
      await onAction(action, p)
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'تعذر حفظ أو تحديث الطلب')
    } finally {
      setSaving(false)
    }
  }
  return createPortal(
    <Modal
      title={'طلب ' + o.number + ' · ' + o.patient.name}
      busy={locked}
      error={localError || error}
      onClose={close}
      manual
    >
      <div className="lab-record-head">
        <b dir="ltr">{o.patient.number}</b>
        <span>{stamp(o.at)}</span>
        <span className={'lab-status ' + o.status}>{statuses[o.status]}</span>
        <span>التسليم: {stamp(o.dueAt)}</span>
      </div>
      <div className="lab-tabs" role="group" aria-label="تفاصيل طلب التحاليل">
        {(
          [
            'samples',
            ...(technical ? ['results', 'reports'] : []),
            ...(finance ? ['fees'] : []),
          ] as (typeof tab)[]
        ).map((k) => (
          <button
            type="button"
            key={k}
            className={tab === k ? 'active' : ''}
            disabled={locked}
            onClick={() => {
              setTab(k)
              setPrintSample(null)
            }}
          >
            {
              {
                samples: 'العينات',
                results: 'إدخال النتائج',
                reports: 'التقارير المعتمدة',
                fees: 'الفاتورة والتحصيل',
              }[k]
            }
          </button>
        ))}
      </div>
      {tab === 'samples' && (
        <section>
          <p className="muted">
            اسحب العينة ثم سجّل استلامها في المعمل. رفض العينة يحفظ تاريخها، وإعادة السحب تصدر
            باركودًا جديدًا.
          </p>
          <div className="lab-sample-list">
            {data.samples.map((s) => (
              <article key={s.id} className={'lab-sample ' + (s.replacedBy ? 'replaced' : '')}>
                <div>
                  <b>{s.specimen}</b>
                  <code>{s.number}</code>
                  <span className={'lab-status ' + s.status}>
                    {sampleStatuses[s.status]}
                    {s.replacedBy ? ' · تم استبدالها' : ''}
                  </span>
                  {s.replacesId && (
                    <small>
                      بديلة عن {data.samples.find((x) => x.id === s.replacesId)?.number}
                    </small>
                  )}
                </div>
                <div className="toolbar">
                  <button type="button" disabled={locked} onClick={() => setPrintSample(s)}>
                    ملصق الباركود
                  </button>
                  {technical && o.status === 'testing' && !s.replacedBy && (
                    <>
                      {s.status === 'pending' && (
                        <button
                          type="button"
                          disabled={locked || dirty}
                          onClick={() => onSample(s, 'collected')}
                        >
                          تسجيل السحب
                        </button>
                      )}
                      {s.status === 'collected' && (
                        <button
                          type="button"
                          disabled={locked || dirty}
                          onClick={() => onSample(s, 'received')}
                        >
                          استلام العينة
                        </button>
                      )}
                      {['collected', 'received'].includes(s.status) && (
                        <button
                          type="button"
                          disabled={locked || dirty}
                          onClick={() => onSample(s, 'rejected')}
                        >
                          رفض العينة
                        </button>
                      )}
                      {s.status === 'rejected' && (
                        <button
                          type="button"
                          disabled={locked || dirty}
                          onClick={() => onReplace(s)}
                        >
                          إعادة السحب
                        </button>
                      )}
                    </>
                  )}
                </div>
              </article>
            ))}
          </div>
          {printSample && (
            <section className="lab-label print-area">
              <small>{settings.businessName}</small>
              <h3>{o.patient.name}</h3>
              <p>
                <code>{o.patient.number}</code> · {printSample.specimen}
              </p>
              <Barcode number={printSample.number} />
              <small>
                {o.number} · {stamp(printSample.createdAt)}
              </small>
              <button className="no-print" type="button" onClick={() => window.print()}>
                طباعة ملصق العينة
              </button>
            </section>
          )}
          {data.events.length > 0 && (
            <details>
              <summary>سجل حركة العينات</summary>
              {data.events.map((x) => (
                <p key={x.id}>
                  {stamp(x.at)} · {data.samples.find((s) => s.id === x.sampleId)?.number} ·{' '}
                  {sampleStatuses[x.status as keyof typeof sampleStatuses]} · {x.userName} —{' '}
                  {x.note}
                </p>
              ))}
            </details>
          )}
        </section>
      )}
      {tab === 'results' && technical && (
        <section>
          <p className="muted">
            أدخل القيم الفعلية التي راجعتها. لا يولّد البرنامج نتائج. الاعتماد يحتاج مستخدمًا آخر
            بصلاحية مراجع أو مسؤول.
          </p>
          {!ready && (
            <p className="alert">
              استلم جميع العينات السليمة أولًا؛ إدخال النتائج مقفل حتى الاستلام.
            </p>
          )}
          {data.tests.map((t, i) => (
            <div key={t.id} className="lab-result-row">
              <div>
                <b>{t.definition.name}</b>
                <code>
                  {t.definition.code} · {t.definition.unit || 'بدون وحدة'}
                </code>
                <small>
                  {t.definition.reference || 'لم يسجل مرجع نصي'}
                  {t.definition.min !== null || t.definition.max !== null
                    ? ' · حدود المقارنة: ' +
                      (t.definition.min ?? '—') +
                      ' إلى ' +
                      (t.definition.max ?? '—')
                    : ''}
                </small>
              </div>
              <Field label={'نتيجة ' + t.definition.name}>
                <input
                  dir={t.definition.kind === 'number' ? 'ltr' : 'auto'}
                  maxLength={2000}
                  value={draft[i]?.value ?? ''}
                  disabled={locked || !ready || o.status !== 'testing'}
                  onChange={(e) =>
                    setDraft((xs) =>
                      xs.map((x, n) => (n === i ? { ...x, value: e.target.value } : x)),
                    )
                  }
                />
              </Field>
              <Field label={'ملاحظة ' + t.definition.name}>
                <textarea
                  rows={2}
                  maxLength={1000}
                  value={draft[i]?.note ?? ''}
                  disabled={locked || !ready || o.status !== 'testing'}
                  onChange={(e) =>
                    setDraft((xs) =>
                      xs.map((x, n) => (n === i ? { ...x, note: e.target.value } : x)),
                    )
                  }
                />
              </Field>
            </div>
          ))}
          {o.status === 'testing' && (
            <div className="toolbar">
              <button
                className="primary"
                type="button"
                disabled={locked || !ready || !dirty || draft.some((x) => !x.value.trim())}
                onClick={() =>
                  void mutate('result.save', { id: o.id, version: o.version, values: draft })
                }
              >
                حفظ مسودة النتائج
              </button>
              {reviewer && (
                <button
                  type="button"
                  disabled={
                    locked ||
                    dirty ||
                    !ready ||
                    !o.draftChanged ||
                    data.tests.some((t) => !t.value || t.authorId === user.id)
                  }
                  onClick={() => setConfirm(true)}
                >
                  مراجعة واعتماد النتائج
                </button>
              )}
            </div>
          )}
          {dirty && (
            <p role="status" className="alert">
              تعديلات غير محفوظة. احفظ النتائج قبل الاعتماد أو تغيير حالة العينة.
            </p>
          )}
          {confirm && (
            <div className="alert">
              <p>
                اعتماد هذه النتائج يثبت التقرير. راجع القيم والوحدات والمراجع؛ أي تصحيح لاحق يصدر
                مراجعة جديدة.
              </p>
              <div className="toolbar">
                <button type="button" disabled={locked} onClick={() => setConfirm(false)}>
                  العودة للمراجعة
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={locked || dirty}
                  onClick={() => void mutate('result.approve', { id: o.id, version: o.version })}
                >
                  تأكيد اعتماد التقرير
                </button>
              </div>
            </div>
          )}
        </section>
      )}
      {tab === 'reports' && technical && (
        <section>
          {data.reports.length ? (
            <>
              <div className="toolbar">
                <Field label="نسخة التقرير">
                  <select value={revision} onChange={(e) => setRevision(Number(e.target.value))}>
                    {data.reports.map((r) => (
                      <option key={r.id} value={r.revision}>
                        مراجعة {r.revision} · {stamp(r.at)}
                      </option>
                    ))}
                  </select>
                </Field>
                <button type="button" onClick={() => window.print()}>
                  طباعة التقرير
                </button>
                {reviewer && o.status === 'released' && (
                  <button type="button" disabled={locked || dirty} onClick={onReopen}>
                    فتح مراجعة تصحيح
                  </button>
                )}
              </div>
              {o.status === 'testing' && (
                <p className="alert">
                  توجد مراجعة قيد العمل؛ التقرير التالي هو النسخة المعتمدة السابقة.
                </p>
              )}
              {report && (
                <section className="lab-report print-area">
                  <header>
                    <img src="./icon.svg" alt="" />
                    <div>
                      <h2>{settings.businessName}</h2>
                      <small>{settings.address}</small>
                      <small dir="ltr">{settings.phone}</small>
                    </div>
                    <div>
                      <b>تقرير نتائج التحاليل</b>
                      <code>{report.snapshot.orderNumber}</code>
                      <small>
                        مراجعة {report.revision} · {stamp(report.at)}
                      </small>
                    </div>
                  </header>
                  <div className="lab-report-patient">
                    <b>{report.snapshot.patient.name}</b>
                    <code>{report.snapshot.patient.number}</code>
                    <span>الميلاد: {report.snapshot.patient.birthDate || 'غير مسجل'}</span>
                    <span>الجهة المحيلة: {report.snapshot.referrer || 'غير مسجلة'}</span>
                  </div>
                  <table>
                    <thead>
                      <tr>
                        <th>التحليل</th>
                        <th>النتيجة</th>
                        <th>الوحدة</th>
                        <th>المجال المسجل</th>
                        <th>المقارنة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.snapshot.tests.map((t) => (
                        <tr key={t.id}>
                          <td>
                            {t.definition.name}
                            <small>
                              {t.definition.code} · {t.sampleNumber}
                            </small>
                          </td>
                          <td dir="auto">
                            <b>{t.value}</b>
                            {t.note && <small>{t.note}</small>}
                          </td>
                          <td>{t.definition.unit || '—'}</td>
                          <td>
                            {t.definition.reference || '—'}
                            {(t.definition.min !== null || t.definition.max !== null) && (
                              <small>
                                {t.definition.min ?? '—'} — {t.definition.max ?? '—'}
                              </small>
                            )}
                          </td>
                          <td>{flags[t.flag]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <footer>
                    <span>المراجع: {report.reviewerName}</span>
                    {report.reason && <span>سبب التصحيح: {report.reason}</span>}
                    <small>
                      المقارنة حسب حدود المعمل المسجلة. التقرير يعرض النتائج ولا يقدم تشخيصًا.
                    </small>
                    <small dir="ltr">hello@xzare.com · +201501230440</small>
                  </footer>
                </section>
              )}
            </>
          ) : (
            <p>لا يوجد تقرير معتمد. استلم العينات واحفظ النتائج، ثم اطلب اعتمادها من مستخدم آخر.</p>
          )}
        </section>
      )}
      {tab === 'fees' && finance && (
        <section>
          <div className="toolbar">
            {o.status !== 'cancelled' && o.balance > 0 && (
              <button type="button" className="primary" disabled={locked || dirty} onClick={onPay}>
                تحصيل دفعة
              </button>
            )}
            <button type="button" onClick={() => window.print()}>
              طباعة الفاتورة
            </button>
            {user.role === 'admin' && o.status === 'testing' && !o.revision && (
              <button type="button" disabled={locked || dirty} onClick={onCancel}>
                إلغاء الطلب ورد المحصّل
              </button>
            )}
          </div>
          <section className="lab-report print-area">
            <header>
              <div>
                <h2>{settings.businessName}</h2>
                <small>{settings.address}</small>
                <small dir="ltr">{settings.phone}</small>
              </div>
              <div>
                <b>فاتورة تحاليل</b>
                <code>{o.number}</code>
                <small>{stamp(o.at)}</small>
              </div>
            </header>
            <div className="lab-report-patient">
              <b>{o.patient.name}</b>
              <code>{o.patient.number}</code>
              <span>{statuses[o.status]}</span>
            </div>
            <table>
              <thead>
                <tr>
                  <th>التحليل</th>
                  <th>القيمة · ج.م</th>
                </tr>
              </thead>
              <tbody>
                {data.tests.map((t) => (
                  <tr key={t.id}>
                    <td>{t.definition.name}</td>
                    <td>{amount(t.price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="lab-totals">
              <span>
                المجموع <b>{amount(o.subtotal)}</b>
              </span>
              <span>
                الخصم <b>{amount(o.discount)}</b>
              </span>
              <span>
                الضريبة {(o.taxBps / 100).toFixed(2)}% <b>{amount(o.tax)}</b>
              </span>
              <span>
                الإجمالي <b>{amount(o.total)}</b>
              </span>
              <span>
                المحصّل <b>{amount(o.paid)}</b>
              </span>
              <span>
                المتبقي <b>{amount(o.balance)}</b>
              </span>
            </div>
            <h3>سندات التحصيل</h3>
            {data.payments.length ? (
              data.payments.map((p) => (
                <p key={p.id}>
                  {stamp(p.at)} · {methods[p.method as keyof typeof methods]} · {p.reference} ·{' '}
                  {amount(p.amount)} ج.م
                </p>
              ))
            ) : (
              <p>لم تسجل دفعات.</p>
            )}
            {data.refund && (
              <p>
                إلغاء: {data.refund.note} · مبلغ الاسترداد {amount(data.refund.amount)} ج.م ·{' '}
                {data.refund.reference}
              </p>
            )}
            <footer>
              {settings.receiptFooter}
              <small dir="ltr">hello@xzare.com · +201501230440</small>
            </footer>
          </section>
        </section>
      )}
      {discard && (
        <div className="alert" role="alert">
          <p>توجد نتائج غير محفوظة. تريد إغلاق الطلب دون حفظها؟</p>
          <div className="toolbar">
            <button type="button" disabled={locked} onClick={() => setDiscard(false)}>
              العودة للنتائج
            </button>
            <button type="button" disabled={locked} onClick={onClose}>
              إغلاق بدون حفظ
            </button>
          </div>
        </div>
      )}
      <footer>
        <button type="button" disabled={locked} onClick={close}>
          إغلاق
        </button>
      </footer>
    </Modal>,
    document.body,
  )
}
