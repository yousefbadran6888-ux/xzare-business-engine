import { useRef, useState } from 'react'
import { captureQuoteContext } from './quote-context'
import type { CrmContact, CrmOpportunity, CrmQuoteDetail } from '@xzare/engine'
import { Modal, Field, amount, decimal, csv } from './ui'
import { readMoney, readQty, quantity, quotationTotal, quoteStatuses, stamp } from './model'
export function QuoteEditor({
  opportunity: liveOpportunity,
  contact: liveContact,
  today,
  busy,
  save,
  onClose,
}: {
  opportunity: CrmOpportunity
  contact: CrmContact
  today: string
  busy: boolean
  save: (a: string, p: Record<string, unknown>) => Promise<unknown>
  onClose: () => void
}) {
  const [reviewed] = useState(() => captureQuoteContext(liveOpportunity, liveContact)),
    { opportunity, contact } = reviewed,
    [lines, setLines] = useState([{ description: '', unit: 'وحدة', qty: '1', price: '' }]),
    [discount, setDiscount] = useState('0'),
    [tax, setTax] = useState('0'),
    [error, setError] = useState(''),
    mutex = useRef(false)
  const parsed = () => lines.map((x) => ({ ...x, qty: readQty(x.qty), price: readMoney(x.price) }))
  let preview: ReturnType<typeof quotationTotal> | null = null
  try {
    preview = quotationTotal(parsed(), readMoney(discount), readMoney(tax))
  } catch {}
  const edit = (i: number, k: keyof (typeof lines)[number], v: string) =>
    setLines((old) => old.map((x, n) => (n === i ? { ...x, [k]: v } : x)))
  return (
    <Modal
      title={'عرض سعر — ' + opportunity.title}
      busy={busy}
      error={error}
      disabled={!preview}
      submit="إصدار نسخة ثابتة"
      onClose={onClose}
      onSubmit={async (e) => {
        if (mutex.current || busy) return
        mutex.current = true
        setError('')
        try {
          const f = new FormData(e.currentTarget)
          await save('crm.quote.issue', {
            opportunityId: opportunity.id,
            opportunityVersion: opportunity.version,
            contactVersion: contact.version,
            validUntil: String(f.get('validUntil')),
            reference: String(f.get('reference')),
            note: String(f.get('note') ?? ''),
            lines: parsed(),
            discount: readMoney(discount),
            taxBps: readMoney(tax),
          })
          onClose()
        } catch (e) {
          setError(e instanceof Error ? e.message : 'تعذر إصدار العرض')
        } finally {
          mutex.current = false
        }
      }}
    >
      <p>
        {contact.name} · {contact.company || contact.code}
      </p>
      <div className="crm-callout">
        راجع البنود وبيانات العميل. بعد الإصدار تبقى هذه النسخة ثابتة؛ التعديل يحتاج عرضًا جديدًا.
      </div>
      <div className="a-form-row">
        <Field label="صالح حتى">
          <input name="validUntil" type="date" required min={today} defaultValue={today} />
        </Field>
        <Field label="مرجع العرض">
          <input name="reference" required maxLength={2000} />
        </Field>
      </div>
      <div className="crm-quote-lines">
        {lines.map((x, i) => (
          <section key={i}>
            <div className="crm-line-head">
              <strong>بند {i + 1}</strong>
              <button
                type="button"
                aria-label={'حذف بند ' + (i + 1)}
                disabled={lines.length === 1 || busy}
                onClick={() => setLines((old) => old.filter((_, n) => n !== i))}
              >
                حذف
              </button>
            </div>
            <Field label={'وصف البند ' + (i + 1)}>
              <input
                required
                maxLength={160}
                value={x.description}
                onChange={(e) => edit(i, 'description', e.target.value)}
              />
            </Field>
            <div className="crm-three">
              <Field label={'الوحدة ' + (i + 1)}>
                <input
                  required
                  maxLength={160}
                  value={x.unit}
                  onChange={(e) => edit(i, 'unit', e.target.value)}
                />
              </Field>
              <Field label={'الكمية ' + (i + 1)}>
                <input
                  type="number"
                  required
                  min="0.001"
                  step="0.001"
                  value={x.qty}
                  onChange={(e) => edit(i, 'qty', e.target.value)}
                />
              </Field>
              <Field label={'سعر الوحدة ' + (i + 1)}>
                <input
                  type="number"
                  required
                  min="0"
                  step="0.01"
                  value={x.price}
                  onChange={(e) => edit(i, 'price', e.target.value)}
                />
              </Field>
            </div>
          </section>
        ))}
      </div>
      <button
        type="button"
        disabled={busy || lines.length >= 50}
        onClick={() =>
          setLines((old) => [...old, { description: '', unit: 'وحدة', qty: '1', price: '' }])
        }
      >
        إضافة بند
      </button>
      <div className="a-form-row">
        <Field label="خصم العرض، ج.م">
          <input
            type="number"
            min="0"
            step="0.01"
            required
            value={discount}
            onChange={(e) => setDiscount(e.target.value)}
          />
        </Field>
        <Field label="ضريبة العرض، %">
          <input
            type="number"
            min="0"
            max="100"
            step="0.01"
            required
            value={tax}
            onChange={(e) => setTax(e.target.value)}
          />
        </Field>
      </div>
      <Field label="شروط وملاحظات العرض">
        <textarea name="note" maxLength={2000} />
      </Field>
      <div className="crm-total">
        <span>
          بنود {preview ? amount(preview.subtotal) : '—'} · ضريبة{' '}
          {preview ? amount(preview.tax) : '—'}
        </span>
        <strong>الإجمالي {preview ? amount(preview.total) : 'راجع القيم'} ج.م</strong>
      </div>
    </Modal>
  )
}
export function QuoteDetail({
  d,
  busy,
  onClose,
  mutate,
}: {
  d: CrmQuoteDetail
  busy: boolean
  onClose: () => void
  mutate: (a: string, p: Record<string, unknown>) => Promise<unknown>
}) {
  const [decision, setDecision] = useState<'accepted' | 'rejected' | 'withdrawn' | null>(null),
    [error, setError] = useState(''),
    mutex = useRef(false),
    q = d.quote
  return (
    <Modal title={'عرض ' + q.number} busy={busy} error={error} manual onClose={onClose}>
      <div className="crm-quote-document print-area">
        <header>
          <div>
            <span>{q.business.businessName}</span>
            <h2>عرض أسعار</h2>
            <p>
              {q.business.phone} · {q.business.address}
            </p>
          </div>
          <div>
            <strong>{q.number}</strong>
            <p>{stamp(q.at)}</p>
            <p>{q.expired ? 'انتهت الصلاحية' : quoteStatuses[q.status]}</p>
          </div>
        </header>
        <section className="crm-quote-customer">
          <h3>{q.customer.name}</h3>
          <p>
            {q.customer.company} · {q.customer.code}
          </p>
          <p dir="ltr">
            {q.customer.phone} · {q.customer.email}
          </p>
          <p>{q.customer.address}</p>
          <p>
            صالح حتى {q.validUntil} · المرجع {q.reference}
          </p>
        </section>
        <div className="crm-table-wrap">
          <table>
            <thead>
              <tr>
                <th>الوصف</th>
                <th>الوحدة</th>
                <th>الكمية</th>
                <th>سعر الوحدة</th>
                <th>القيمة</th>
              </tr>
            </thead>
            <tbody>
              {d.lines.map((x) => (
                <tr key={x.id}>
                  <td>{x.description}</td>
                  <td>{x.unit}</td>
                  <td>{quantity(x.qty)}</td>
                  <td>{amount(x.price)}</td>
                  <td>{amount(x.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="crm-total">
          <span>
            الإجمالي قبل الخصم {amount(q.subtotal)} · الخصم {amount(q.discount)} · الضريبة{' '}
            {amount(q.tax)}
          </span>
          <strong>{amount(q.total)} ج.م</strong>
        </div>
        <p className="crm-pre">{q.note}</p>
        <footer>{q.business.receiptFooter}</footer>
      </div>
      <div className="crm-toolbar no-print">
        <button onClick={() => window.print()}>طباعة العرض</button>
        <button
          onClick={() =>
            csv('CRM-quote-' + q.number + '.csv', [
              ['رقم العرض', 'العميل', 'الوصف', 'الوحدة', 'الكمية', 'سعر الوحدة', 'القيمة'],
              ...d.lines.map((x) => [
                q.number,
                q.customer.name,
                x.description,
                x.unit,
                quantity(x.qty),
                decimal(x.price),
                decimal(x.value),
              ]),
            ])
          }
        >
          تصدير CSV
        </button>
        {q.status === 'issued' && (
          <>
            <button
              className="primary"
              disabled={busy || q.expired}
              onClick={() => setDecision('accepted')}
            >
              تسجيل قبول العميل
            </button>
            <button disabled={busy} onClick={() => setDecision('rejected')}>
              تسجيل رفض
            </button>
            <button disabled={busy} onClick={() => setDecision('withdrawn')}>
              سحب العرض
            </button>
          </>
        )}
      </div>
      {q.decisionReason && (
        <div className="crm-callout">
          {q.decisionReason} · المرجع {q.decisionReference}
        </div>
      )}
      {decision && (
        <form
          className="crm-inline-form"
          onSubmit={async (e) => {
            e.preventDefault()
            if (busy || mutex.current) return
            const f = new FormData(e.currentTarget)
            mutex.current = true
            setError('')
            try {
              await mutate('crm.quote.status', {
                id: q.id,
                version: q.version,
                status: decision,
                reason: String(f.get('reason')),
                reference: String(f.get('reference')),
              })
              setDecision(null)
            } catch (e) {
              setError(e instanceof Error ? e.message : 'تعذر تسجيل القرار')
            } finally {
              mutex.current = false
            }
          }}
        >
          <h3>
            {decision === 'accepted'
              ? 'تسجيل رد العميل بالموافقة'
              : decision === 'rejected'
                ? 'تسجيل رفض العميل'
                : 'سحب نسخة العرض'}
          </h3>
          <p>يسجل ردًا تلقيته أو قرارًا اتخذته؛ لا يرسل بريدًا ولا يوقع عقدًا ولا يصدر فاتورة.</p>
          <Field label="سبب القرار أو ملخص الرد">
            <textarea name="reason" required maxLength={2000} />
          </Field>
          <Field label="مرجع الرد أو القرار">
            <input name="reference" required maxLength={2000} />
          </Field>
          <label className="a-check">
            <input type="checkbox" required />
            أؤكد تسجيل هذا الرد
          </label>
          <button type="button" disabled={busy} onClick={() => setDecision(null)}>
            رجوع
          </button>
          <button className="primary" disabled={busy}>
            حفظ القرار
          </button>
        </form>
      )}
    </Modal>
  )
}
