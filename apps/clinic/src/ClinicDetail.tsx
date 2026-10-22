import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Modal, Field, amount } from './ui'
import {
  stamp,
  statuses,
  methods,
  type VisitDetail,
  type InvoiceDetail,
  type PatientHistory,
} from './model'
function PatientBarcode({ number }: { number: string }) {
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
    <canvas ref={canvas} aria-label={'باركود ملف ' + number} />
  )
}
export function PatientDetail({
  data,
  business,
  onClose,
  onAppointment,
  onVisit,
  onInvoice,
  canClinical,
  canReception,
}: {
  canClinical: boolean
  canReception: boolean
  data: PatientHistory
  business: string
  onClose: () => void
  onAppointment: () => void
  onVisit: (id: string) => void
  onInvoice: (id: string) => void
}) {
  const p = data.patient
  const [tab, setTab] = useState<'vitals' | 'clinical' | 'rx' | 'billing'>(canClinical ? 'clinical' : 'billing')
  const dossierTabs = [
    ...(canClinical ? [{ id: 'vitals' as const, label: 'العلامات الحيوية', caption: 'Vitals' }, { id: 'clinical' as const, label: 'الملاحظات الطبية', caption: 'Clinical notes' }, { id: 'rx' as const, label: 'العلاج والوصفات', caption: 'Rx' }] : []),
    ...(canReception ? [{ id: 'billing' as const, label: 'الفواتير', caption: 'Billing' }] : []),
  ]
  return createPortal(
    <Modal title={'ملف ' + p.name} busy={false} error="" onClose={onClose}>
      <div className="clinic-patient-card print-area">
        <span>بطاقة مريض · {business}</span>
        <h2>{p.name}</h2>
        <p dir="ltr">{p.phone || '—'}</p>
        <PatientBarcode number={p.number} />
        <small>امسح الباركود في بحث ملفات المرضى لفتح الملف.</small>
      </div>
      <div className="clinic-facts">
        <span>
          تاريخ الميلاد <b>{p.birthDate || 'غير مسجل'}</b>
        </span>
        <span>
          النوع <b>{p.sex === 'male' ? 'ذكر' : p.sex === 'female' ? 'أنثى' : 'غير مسجل'}</b>
        </span>
        <span>
          العنوان <b>{p.address || 'غير مسجل'}</b>
        </span>
      </div>
      <div className="toolbar">
        <button type="button" onClick={() => window.print()}>
          طباعة بطاقة المريض
        </button>
        {canReception && (
          <button type="button" disabled={!p.active} onClick={onAppointment}>
            حجز موعد للمريض
          </button>
        )}
      </div>
      <div className="clinic-dossier-tabs no-print" role="tablist" aria-label="أقسام ملف المريض">
        {dossierTabs.map((entry, index) => <button type="button" key={entry.id} role="tab" id={`dossier-tab-${entry.id}`} aria-controls={`dossier-panel-${entry.id}`} aria-selected={tab === entry.id} tabIndex={tab === entry.id ? 0 : -1} onClick={() => setTab(entry.id)} onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? dossierTabs.length - 1 : (index + (event.key === 'ArrowLeft' ? 1 : -1) + dossierTabs.length) % dossierTabs.length
          setTab(dossierTabs[next]!.id)
          event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus()
        }}><b>{entry.label}</b><small>{entry.caption}</small></button>)}
      </div>
      <section className="clinic-dossier-panel" role="tabpanel" id={`dossier-panel-${tab}`} aria-labelledby={`dossier-tab-${tab}`}>
      {tab === 'vitals' && canClinical && <div className="clinic-dossier-empty"><h3>القياسات الحيوية</h3><p>القياسات التي دوّنها الطبيب محفوظة ضمن ملاحظات الزيارة.</p>{data.appointments.filter((appointment) => appointment.visitId).map((appointment) => <button type="button" key={appointment.id} onClick={() => onVisit(appointment.visitId!)}>مراجعة قياسات زيارة {stamp(appointment.start)}</button>)}{!data.appointments.some((appointment) => appointment.visitId) && <p className="muted">لم تُسجّل زيارة طبية لهذا المريض بعد.</p>}</div>}
      {tab === 'rx' && canClinical && <div className="clinic-dossier-empty"><h3>خطة العلاج والوصفات</h3><p>افتح الزيارة لمراجعة خطة العلاج التي حفظها الطبيب.</p>{data.appointments.filter((appointment) => appointment.visitId).map((appointment) => <article className="clinic-dossier-visit" key={appointment.id}><div><b>{appointment.doctorName}</b><small>{stamp(appointment.start)}</small></div><button type="button" onClick={() => onVisit(appointment.visitId!)}>فتح خطة العلاج</button></article>)}{!data.appointments.some((appointment) => appointment.visitId) && <p className="muted">لم تُسجّل خطة علاج لهذا المريض بعد.</p>}</div>}
      {tab === 'billing' && canReception && <><div className="clinic-dossier-billing"><span>الفواتير المسجلة <b>{data.invoices.length}</b></span><span>متبقي للتحصيل <b>{amount(data.invoices.reduce((total, invoice) => total + invoice.balance, 0))} ج.م</b></span></div>{data.invoices.length ? <div className="a-scroll"><table><thead><tr><th>الفاتورة</th><th>التاريخ</th><th>الإجمالي</th><th>المتبقي</th><th>فتح</th></tr></thead><tbody>{data.invoices.map((invoice) => <tr key={invoice.id}><td><bdi>{invoice.number}</bdi></td><td>{stamp(invoice.at)}</td><td>{amount(invoice.total)}</td><td>{amount(invoice.balance)}</td><td><button type="button" onClick={() => onInvoice(invoice.id)}>فتح الفاتورة</button></td></tr>)}</tbody></table></div> : <p className="muted">لم تُسجّل فواتير لهذا المريض.</p>}</>}
      {tab === 'clinical' && canClinical && <>
      <h3>المواعيد والزيارات</h3>
      {!data.appointments.length ? (
        <p className="muted">لم تُسجّل مواعيد لهذا المريض.</p>
      ) : (
        <div className="a-scroll">
          <table>
            <thead>
              <tr>
                <th>الموعد</th>
                <th>الطبيب</th>
                <th>الحالة</th>
                <th>فتح</th>
              </tr>
            </thead>
            <tbody>
              {data.appointments.map((a) => (
                <tr key={a.id}>
                  <td>
                    {stamp(a.start)}
                    <small dir="ltr">{a.number}</small>
                  </td>
                  <td>{a.doctorName}</td>
                  <td>{statuses[a.status]}</td>
                  <td>
                    {canClinical && a.visitId && (
                      <button type="button" onClick={() => onVisit(a.visitId!)}>
                        الزيارة
                      </button>
                    )}
                    {canReception && a.invoiceId && (
                      <button type="button" onClick={() => onInvoice(a.invoiceId!)}>
                        الفاتورة
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </>}
      </section>
    </Modal>,
    document.body,
  )
}
export function VisitEditor({
  data,
  busy,
  error,
  onClose,
  onSave,
  onFinalize,
  onAddendum,
}: {
  data: VisitDetail
  busy: boolean
  error: string
  onClose: () => void
  onSave: (p: Record<string, unknown>) => Promise<void>
  onFinalize: () => void
  onAddendum: () => void
}) {
  const v = data.visit
  const [draft, setDraft] = useState({
      complaint: v.complaint,
      assessment: v.assessment,
      plan: v.plan,
    }),
    [discard, setDiscard] = useState(false),
    [saving, setSaving] = useState(false),
    [saveError, setSaveError] = useState('')
  const [recordTab, setRecordTab] = useState<'clinical' | 'rx'>('clinical')
  const locked = busy || saving
  const dirty = Object.entries(draft).some(([key, value]) => value !== v[key as keyof typeof draft])
  const close = () => {
    if (locked) return
    if (dirty) setDiscard(true)
    else onClose()
  }
  return (
    <Modal
      title={'زيارة ' + data.patient.name}
      busy={locked}
      error={saveError || error}
      onClose={close}
      submit="حفظ المسودة"
      onSubmit={
        v.finalizedAt
          ? undefined
          : () => {
              if (locked) return
              setSaving(true)
              setSaveError('')
              void (async () => {
                try {
                  await onSave({ id: v.id, version: v.version, ...draft })
                } catch (e) {
                  setSaveError(e instanceof Error ? e.message : 'تعذر حفظ أو تحديث الزيارة')
                } finally {
                  setSaving(false)
                }
              })()
            }
      }
    >
      <div className="clinic-record-head">
        <span dir="ltr">{data.patient.number}</span>
        <b>{data.doctor.name}</b>
        <span>{stamp(v.openedAt)}</span>
        <span className="clinic-status">{v.finalizedAt ? 'معتمدة' : 'مسودة خاصة'}</span>
      </div>
      <p className="muted">
        دوّن المعلومات الفعلية التي راجعتها. الحفظ لا يعتمد الزيارة؛ الاعتماد يثبت النص، والتصحيح
        بعده يُحفظ كإضافة.
      </p>
      <div className="clinic-dossier-tabs" aria-label="محتوى الزيارة">
        <button type="button" aria-pressed={recordTab === 'clinical'} onClick={() => setRecordTab('clinical')}>الملاحظات والتقييم</button>
        <button type="button" aria-pressed={recordTab === 'rx'} onClick={() => setRecordTab('rx')}>خطة العلاج والمتابعة</button>
      </div>
      {recordTab === 'clinical' && <>
      <Field label="الشكوى والملاحظات">
        <textarea
          name="complaint"
          rows={4}
          maxLength={6000}
          readOnly={!!v.finalizedAt}
          disabled={locked}
          value={draft.complaint}
          onChange={(e) => setDraft((old) => ({ ...old, complaint: e.target.value }))}
        />
      </Field>
      <Field label="التقييم">
        <textarea
          name="assessment"
          rows={4}
          maxLength={6000}
          readOnly={!!v.finalizedAt}
          disabled={locked}
          value={draft.assessment}
          onChange={(e) => setDraft((old) => ({ ...old, assessment: e.target.value }))}
        />
      </Field>
      </>}
      {recordTab === 'rx' && <>
      <Field label="الخطة والمتابعة">
        <textarea
          name="plan"
          rows={4}
          maxLength={6000}
          readOnly={!!v.finalizedAt}
          disabled={locked}
          value={draft.plan}
          onChange={(e) => setDraft((old) => ({ ...old, plan: e.target.value }))}
        />
      </Field>
      </>}
      <div className="toolbar">
        {v.finalizedAt ? (
          <button type="button" disabled={locked} onClick={onAddendum}>
            إضافة تصحيح أو متابعة
          </button>
        ) : (
          <button
            type="button"
            disabled={locked || dirty || !v.assessment || !v.plan}
            onClick={onFinalize}
          >
            اعتماد المسودة المحفوظة
          </button>
        )}
      </div>
      {dirty && (
        <p role="status" className="alert">
          لديك تعديلات غير محفوظة. احفظ المسودة قبل الاعتماد.
        </p>
      )}
      {discard && (
        <div className="alert" role="alert">
          <p>هل تريد إغلاق الزيارة دون حفظ التعديلات؟</p>
          <div className="toolbar">
            <button type="button" disabled={locked} onClick={() => setDiscard(false)}>
              العودة إلى الزيارة
            </button>
            <button type="button" disabled={locked} onClick={onClose}>
              إغلاق بدون حفظ
            </button>
          </div>
        </div>
      )}
      {data.addenda.length > 0 && (
        <section>
          <h3>الإضافات المحفوظة</h3>
          {data.addenda.map((x) => (
            <article className="clinic-addendum" key={x.id}>
              <small>
                {stamp(x.at)} · {x.userName}
              </small>
              <b>{x.reason}</b>
              <p>{x.note}</p>
            </article>
          ))}
        </section>
      )}
    </Modal>
  )
}
export function InvoiceDetailView({
  data,
  business,
  phone,
  address,
  footer,
  onClose,
  onPay,
  onVoid,
  admin,
}: {
  data: InvoiceDetail
  business: string
  phone: string
  address: string
  footer: string
  onClose: () => void
  onPay: () => void
  onVoid: () => void
  admin: boolean
}) {
  const i = data.invoice
  return createPortal(
    <Modal title={'فاتورة ' + i.number} busy={false} error="" onClose={onClose}>
      <section className="clinic-receipt print-area">
        <div className="clinic-receipt-head">
          <img src="./icon.svg" alt="" />
          <div>
            <h2>{business}</h2>
            <small>{address}</small>
            <small dir="ltr">{phone}</small>
          </div>
          <b dir="ltr">{i.number}</b>
        </div>
        <h3>فاتورة خدمات العيادة {i.voided ? '· ملغاة' : ''}</h3>
        <p>
          {i.patient.name} · <span dir="ltr">{i.patient.number}</span>
        </p>
        <p>
          {i.doctor.name} · {stamp(i.at)}
        </p>
        <table>
          <thead>
            <tr>
              <th>الخدمة</th>
              <th>العدد</th>
              <th>السعر</th>
              <th>الإجمالي · ج.م</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((l) => (
              <tr key={l.id}>
                <td>{l.name}</td>
                <td>{l.qty}</td>
                <td>{amount(l.price)}</td>
                <td>{amount(l.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="clinic-receipt-totals">
          <span>
            قبل الخصم والضريبة <b>{amount(i.subtotal)}</b>
          </span>
          <span>
            الخصم <b>{amount(i.discount)}</b>
          </span>
          <span>
            الضريبة <b>{amount(i.tax)}</b>
          </span>
          <span>
            الإجمالي <b>{amount(i.total)}</b>
          </span>
          <span>
            المحصّل <b>{amount(i.paid)}</b>
          </span>
          <span>
            المتبقي <b>{amount(i.balance)}</b>
          </span>
        </div>
        <h3>سندات التحصيل</h3>
        {data.payments.map((p) => (
          <p key={p.id}>
            {stamp(p.at)} · {methods[p.method as keyof typeof methods]} · {amount(p.amount)} ج.م ·{' '}
            {p.reference}
          </p>
        ))}
        {data.refund && (
          <p className="alert">
            إلغاء بتاريخ {stamp(data.refund.at)} · رد {amount(data.refund.amount)} ج.م ·{' '}
            {data.refund.note} · {data.refund.reference}
          </p>
        )}
        {footer && <p>{footer}</p>}
        <small>تُحفظ الفاتورة الأصلية وسندات التحصيل والاسترداد في سجل العيادة.</small>
      </section>
      <div className="toolbar">
        <button type="button" onClick={() => window.print()}>
          طباعة الفاتورة
        </button>
        {!i.voided && i.balance > 0 && (
          <button type="button" className="primary" onClick={onPay}>
            تحصيل دفعة
          </button>
        )}
        {admin && !i.voided && (
          <button type="button" className="danger" onClick={onVoid}>
            إلغاء ورد المحصّل
          </button>
        )}
      </div>
    </Modal>,
    document.body,
  )
}
