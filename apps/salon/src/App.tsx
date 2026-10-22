import { useState, useEffect, useRef, type ReactNode } from 'react'
import { ulid } from '@xzare/core'
import type {
  SalonState,
  SalonBooking,
  SalonInvoice,
  SalonInvoiceDetail,
  SalonPackage,
  SalonReport,
  SalonCommissions,
  SalonPayment,
  SalonPayout,
} from '@xzare/engine'
import { call } from '../../pos/src/bridge'
import { useSessionActivity } from '../../pos/src/useSessionActivity'
import { LicensePanel } from '../../pos/src/LicensePanel'
import { WorkspaceClock } from '../../pos/src/WorkspaceClock'
import { AuthScreen, type AuthValues } from './AuthScreen'
import {
  Modal,
  Field,
  Empty,
  amount,
  decimal,
  today,
  csv,
  download,
} from './ui'
import {
  customerForm,
  serviceForm,
  staffForm,
  planForm,
  bookingForm,
  moveForm,
  saleForm,
  paymentForm,
  payoutForm,
  userForm,
  passwordForm,
  text,
  type FormSpec,
} from './Forms'
import {
  roles,
  bookingLabels,
  methods,
  ledgerLabels,
  stamp,
  clock,
  passwordValue,
  eventLabel,
} from './model'
import { ScopeGate } from './scope'
import { exclusive } from './exclusive'
import { refreshReceipt, syncReceipt, type Receipt } from './receipt'
import { syncDetail } from './detail-sync'
const pages = {
  desk: 'مكتب الحجوزات',
  customers: 'العملاء',
  catalog: 'الخدمات والموظفون',
  packages: 'باقات الجلسات',
  fees: 'الفواتير والتحصيل',
  commissions: 'العمولات',
  reports: 'التقارير',
  users: 'المستخدمون',
  audit: 'سجل التدقيق',
  settings: 'الإعدادات والترخيص',
}
type View = keyof typeof pages
type Detail = {
  kind: 'booking' | 'customer' | 'package' | 'invoice'
  id: string
  data: any
}

export function App() {
  const [s, setState] = useState<SalonState | null>(null),
    [configured, setConfigured] = useState<boolean | null>(null),
    [view, setView] = useState<View>('desk'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [form, setForm] = useState<FormSpec | null>(null),
    [detail, setDetail] = useState<Detail | null>(null),
    [receipt, setReceipt] = useState<Receipt | null>(null),
    [day, setDay] = useState(today()),
    [search, setSearch] = useState(''),
    [from, setFrom] = useState(today().slice(0, 8) + '01'),
    [to, setTo] = useState(today()),
    [report, setReport] = useState<SalonReport | null>(null),
    [commissions, setCommissions] = useState<SalonCommissions | null>(null)
  const mutex = useRef(false),
    generation = useRef(0),
    loadSeq = useRef(0),
    gate = useRef(new ScopeGate()),
    scope = useRef<SalonState | null>(null),
    requests = useRef(new Map<string, string>())
  const end = () => {
    generation.current++
    gate.current.clear()
    scope.current = null
    setState(null)
    setForm(null)
    setDetail(null)
    setReceipt(null)
    setReport(null)
    setCommissions(null)
    setView('desk')
    setSearch('')
    setError('')
    setNotice('')
    requests.current.clear()
  }
  const authError = (m: string) => {
    if (/انتهت الجلسة|سجّل الدخول/.test(m)) {
      end()
      setError(m)
    }
  }
  useSessionActivity(!!s, () => {
    end()
    setError('انتهت الجلسة؛ سجّل الدخول مرة أخرى')
  })
  const receiptRef = useRef<Receipt | null>(null)
  receiptRef.current = receipt
  const detailRef = useRef<Detail | null>(null)
  detailRef.current = detail
  async function load() {
    const seq = ++loadSeq.current,
      g = generation.current,
      capturedReceipt = receiptRef.current,
      v = await call<SalonState>('sal.state')
    let receiptPayments: SalonPayment[] = [],
      receiptPayouts: SalonPayout[] = []
    if (capturedReceipt) {
      try {
        if (capturedReceipt.kind === 'payout')
          receiptPayouts = (await call<SalonCommissions>('sal.commissions'))
            .payouts
        else if (v.user.role !== 'stylist')
          receiptPayments = (
            await call<SalonInvoiceDetail>('sal.invoice.get', {
              id: capturedReceipt.data.invoiceId,
            })
          ).payments
      } catch {
        /* A revoked or missing record closes only its captured document. */
      }
    }
    const captured = detailRef.current
    let freshDetail: Detail | null = null
    if (
      captured &&
      (v.user.role !== 'stylist' ||
        ['booking', 'customer'].includes(captured.kind))
    ) {
      try {
        const data = await call<any>('sal.' + captured.kind + '.get', {
          id: captured.id,
        })
        freshDetail = { ...captured, data }
      } catch {
        freshDetail = null
      }
    }
    if (seq !== loadSeq.current || g !== generation.current) return
    const scopeLost = gate.current.update(v)
    if (scopeLost) {
      setForm(null)
      setDetail(null)
      setReceipt(null)
      setReport(null)
      setCommissions(null)
    }
    scope.current = v
    setState(v)
    setDetail((d) => syncDetail(d, captured, freshDetail, scopeLost))
    const freshReceipt = refreshReceipt(
      capturedReceipt,
      v.user.role,
      receiptPayments,
      receiptPayouts,
      v.staff.map((x) => x.id),
    )
    setReceipt((r) => syncReceipt(r, capturedReceipt, freshReceipt, scopeLost))
  }
  useEffect(() => {
    void call<{ configured: boolean }>('auth.status')
      .then((v) => {
        setConfigured(v.configured)
        if (v.configured) void load().catch(() => {})
      })
      .catch((e) => setError(e.message))
  }, [])
  useEffect(() => {
    if (!s) return
    const t = setInterval(() => {
      if (!mutex.current)
        void load().catch((e) => {
          setError(e.message)
          authError(e.message)
        })
    }, 15000)
    return () => clearInterval(t)
  }, [s?.user.id])
  useEffect(() => {
    if (!s || view !== 'reports') return
    let live = true
    const ticket = gate.current.ticket()
    setReport(null)
    void call<SalonReport>('sal.report', { from, to })
      .then((r) => {
        if (live && gate.current.current(ticket)) setReport(r)
      })
      .catch((e) => {
        if (live) {
          setError(e.message)
          authError(e.message)
        }
      })
    return () => {
      live = false
    }
  }, [s, view, from, to])
  useEffect(() => {
    if (!s || view !== 'commissions') return
    let live = true
    const ticket = gate.current.ticket()
    setCommissions(null)
    void call<SalonCommissions>('sal.commissions')
      .then((r) => {
        if (live && gate.current.current(ticket)) {
          setCommissions(r)
          setReceipt((p) =>
            p?.kind === 'payout'
              ? r.payouts.some((x) => x.id === p.data.id)
                ? {
                    kind: 'payout',
                    data: r.payouts.find((x) => x.id === p.data.id)!,
                  }
                : null
              : p,
          )
        }
      })
      .catch((e) => {
        if (live) {
          setError(e.message)
          authError(e.message)
        }
      })
    return () => {
      live = false
    }
  }, [s, view])
  const invoke = (f: () => Promise<unknown>) => {
    void f().catch((e) => {
      const m = e instanceof Error ? e.message : 'تعذر إتمام العملية'
      setError(m)
      authError(m)
    })
  }
  async function authenticate(v: AuthValues) {
    if (mutex.current) return
    mutex.current = true
    setBusy(true)
    setError('')
    try {
      await call(
        configured ? 'login' : 'setup',
        configured ? { username: v.username, password: v.password } : v,
      )
      setConfigured(true)
      generation.current++
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر الدخول')
      throw e
    } finally {
      mutex.current = false
      setBusy(false)
    }
  }
  async function run(action: string, p: Record<string, unknown>) {
    if (mutex.current) throw Error('انتظر انتهاء العملية')
    mutex.current = true
    setBusy(true)
    setError('')
    setNotice('')
    const g = generation.current,
      key = JSON.stringify([action, p]),
      command = action.startsWith('sal.')
    try {
      if (command && !requests.current.has(key))
        requests.current.set(key, ulid())
      const r = await call<{ id: string }>(
        action,
        command ? { ...p, clientTxnId: requests.current.get(key) } : p,
      )
      if (g !== generation.current)
        throw Error('انتهت الجلسة؛ سجّل الدخول مرة أخرى')
      requests.current.delete(key)
      if (
        action === 'password.change' ||
        (action === 'user.save' && p.id === scope.current?.user.id)
      ) {
        end()
        return r
      }
      setNotice('تم حفظ العملية')
      try {
        await load()
      } catch (e) {
        authError(e instanceof Error ? e.message : '')
        setError('تم الحفظ؛ حدّث العرض لقراءة البيانات الجديدة')
      }
      return r
    } finally {
      mutex.current = false
      setBusy(false)
    }
  }
  const edit = (f: FormSpec) => {
    setDetail(null)
    setReceipt(null)
    setError('')
    setForm(f)
  }
  const ask = (
    title: string,
    action: string,
    p: Record<string, unknown>,
    body?: ReactNode,
  ) =>
    edit({
      title,
      action,
      body: (
        <>
          {body}
          <Field label="سبب القرار">
            <textarea name="reason" required maxLength={2000} />
          </Field>
          <label className="s-check">
            <input type="checkbox" required />
            راجعت القرار وأؤكد تسجيله
          </label>
        </>
      ),
      payload: (f) => ({ ...p, reason: text(f, 'reason') }),
    })
  const confirm = (
    title: string,
    action: string,
    b: SalonBooking,
    body: ReactNode,
    submit = 'حفظ',
  ) =>
    edit({
      title,
      action,
      body: (
        <>
          {body}
          <label className="s-check">
            <input type="checkbox" required />
            راجعت العميل والخدمة وأؤكد التسجيل
          </label>
        </>
      ),
      submit,
      payload: () => ({ id: b.id, version: b.version }),
    })
  async function open(kind: Detail['kind'], id: string) {
    const g = generation.current,
      ticket = gate.current.ticket(),
      d = await call<any>('sal.' + kind + '.get', { id })
    if (
      g !== generation.current ||
      !gate.current.current(ticket) ||
      !scope.current
    )
      return
    if (kind === 'booking' || kind === 'customer') {
      if (!gate.current.accept(ticket, kind, id)) return
    } else if (scope.current.user.role === 'stylist') return
    setForm(null)
    setReceipt(null)
    setDetail({ kind, id, data: d })
    setError('')
  }
  if (!s)
    return (
      <AuthScreen
        configured={configured}
        busy={busy}
        error={error}
        onAuthenticate={authenticate}
      />
    )
  const office = s.user.role !== 'stylist',
    manager = ['admin', 'manager'].includes(s.user.role),
    admin = s.user.role === 'admin',
    visiblePages = (Object.keys(pages) as View[])
      .filter(
        (v) =>
          office || ['desk', 'customers', 'commissions', 'reports'].includes(v),
      )
      .filter((v) => manager || !['catalog', 'audit'].includes(v))
      .filter((v) => admin || !['users', 'settings'].includes(v)),
    match = (...xs: unknown[]) =>
      xs.join(' ').toLowerCase().includes(search.toLowerCase()),
    filteredBookings = s.bookings.filter(
      (b) =>
        b.day === day &&
        match(b.customerName, b.customerCode, b.serviceName, b.staffName),
    ),
    staff = s.staff.filter(
      (t) => t.active || filteredBookings.some((b) => b.staffId === t.id),
    )
  const eventRows = (events: any[]) =>
    events.length ? (
      <section className="s-history">
        <h3>سجل العمليات</h3>
        {events.map((e) => (
          <article key={e.id}>
            <strong>{eventLabel(e.action)}</strong>
            <small>
              {stamp(e.at)} · {e.actorName}
            </small>
            {e.reason && <p>{e.reason}</p>}
            {e.action === 'sal.booking.move' &&
              (() => {
                try {
                  const p = JSON.parse(e.snapshot)
                  return p.before && p.after ? (
                    <p>
                      {p.before.day} {clock(p.before.startMinute)} ·{' '}
                      {p.before.staffName} ← {p.after.day}{' '}
                      {clock(p.after.startMinute)} · {p.after.staffName}
                    </p>
                  ) : null
                } catch {
                  return null
                }
              })()}
          </article>
        ))}
      </section>
    ) : null
  const bookingRows = (rows: SalonBooking[], interactive = true) =>
    rows.length ? (
      <div className="s-booking-list">
        {rows.map((b) =>
          interactive ? (
            <button
              className={'s-slot ' + b.status}
              key={b.id}
              onClick={() => invoke(() => open('booking', b.id))}
            >
              <time>
                {clock(b.startMinute)}
                <small>{clock(b.startMinute + b.duration)}</small>
              </time>
              <span>
                <strong>{b.customerName}</strong>
                <small>
                  {b.serviceName} · {b.staffName}
                </small>
                <small>{b.day}</small>
              </span>
              <b className="s-status">{bookingLabels[b.status]}</b>
            </button>
          ) : (
            <article className="s-slot" key={b.id}>
              <time>
                {clock(b.startMinute)}
                <small>{b.duration} دقيقة</small>
              </time>
              <span>
                <strong>{b.customerName}</strong>
                <small>
                  {b.serviceName} · {b.staffName}
                </small>
              </span>
              <span>
                {b.day}
                <small>{bookingLabels[b.status]}</small>
              </span>
            </article>
          ),
        )}
      </div>
    ) : (
      <Empty>لا توجد مواعيد في هذه الفترة.</Empty>
    )
  const invoiceRows = (rows: SalonInvoice[]) =>
    rows.length ? (
      <div className="s-table">
        <table>
          <thead>
            <tr>
              <th>الفاتورة</th>
              <th>العميل والخدمة</th>
              <th>الرسوم</th>
              <th>المستحق</th>
              <th>الحالة</th>
              <th>إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.id}>
                <td>
                  {i.number}
                  <small>{stamp(i.at)}</small>
                </td>
                <td>
                  {i.customer.name}
                  <small>
                    {i.item.name}
                    {i.item.covered ? ' · من الباقة' : ''}
                  </small>
                </td>
                <td>{amount(i.total)} ج.م</td>
                <td className="s-number">{amount(i.balance)} ج.م</td>
                <td>
                  {i.status === 'void'
                    ? 'ملغاة'
                    : i.balance
                      ? 'تحتاج تحصيل'
                      : 'مسددة'}
                </td>
                <td>
                  <div className="s-actions">
                    <button onClick={() => invoke(() => open('invoice', i.id))}>
                      كشف الفاتورة
                    </button>
                    {i.balance > 0 && i.status === 'posted' && (
                      <button
                        disabled={busy}
                        onClick={() => edit(paymentForm(i))}
                      >
                        تحصيل
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <Empty>لا توجد فواتير. تسجل فاتورة عند إتمام الخدمة أو بيع باقة.</Empty>
    )
  const packageRows = (rows: SalonPackage[]) =>
    rows.length ? (
      <div className="s-table">
        <table>
          <thead>
            <tr>
              <th>العميل</th>
              <th>الباقة والفترة</th>
              <th>الجلسات</th>
              <th>السداد والحالة</th>
              <th>إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td>
                  {p.customerName}
                  <small>{p.customerCode}</small>
                </td>
                <td>
                  {p.planName}
                  <small>{p.serviceName}</small>
                  <small>
                    {p.startDay} ← {p.endDay}
                  </small>
                </td>
                <td>
                  {p.used} مستخدمة · {p.reserved} محجوزة
                  <small>
                    المتاح{p.credits - p.used - p.reserved} من{p.credits}
                  </small>
                </td>
                <td>
                  {p.status === 'cancelled'
                    ? 'ملغاة'
                    : p.balance
                      ? 'المستحق ' + amount(p.balance) + ' ج.م'
                      : 'مدفوعة'}
                </td>
                <td>
                  <div className="s-actions">
                    <button onClick={() => invoke(() => open('package', p.id))}>
                      ملف الباقة
                    </button>
                    {p.status === 'active' &&
                      p.balance === 0 &&
                      p.used + p.reserved < p.credits && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            edit(
                              bookingForm(s, day, p.customerId, p.serviceId, p),
                            )
                          }
                        >
                          حجز جلسة
                        </button>
                      )}
                    {p.balance > 0 && p.status === 'active' && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          edit(
                            paymentForm(
                              s.invoices.find((i) => i.id === p.invoiceId)!,
                            ),
                          )
                        }
                      >
                        تحصيل الباقة
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <Empty>لا توجد باقات مباعة. اختر العميل من ملفه ثم سجل بيع الباقة.</Empty>
    )
  const paymentsRows = (rows: SalonPayment[]) =>
    rows.length ? (
      <div className="s-table">
        <table>
          <thead>
            <tr>
              <th>الإيصال</th>
              <th>العميل والخدمة</th>
              <th>المبلغ</th>
              <th>الحالة</th>
              <th>إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td>
                  {p.number}
                  <small>{stamp(p.at)}</small>
                </td>
                <td>
                  {p.customer.name}
                  <small>{p.item.name}</small>
                </td>
                <td>
                  {amount(p.amount)} ج.م<small>{methods[p.method]}</small>
                </td>
                <td>{p.voidReason ? 'ملغى' : 'محفوظ'}</td>
                <td>
                  <div className="s-actions">
                    <button
                      onClick={() => {
                        setDetail(null)
                        setReceipt({ kind: 'payment', data: p })
                      }}
                    >
                      عرض وطباعة
                    </button>
                    {manager && !p.voidReason && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          ask(
                            'إلغاء إيصال ' + p.number,
                            'sal.payment.void',
                            { id: p.id },
                            <p>
                              يعيد المبلغ إلى المستحق ويحفظ أصل الإيصال. لا ينفذ
                              استردادًا بنكيًا.
                            </p>,
                          )
                        }
                      >
                        إلغاء بسبب
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <Empty>لا توجد إيصالات تحصيل.</Empty>
    )
  const commissionRows = (c: SalonCommissions) =>
    c.summary.length ? (
      <>
        <div className="s-table">
          <table>
            <thead>
              <tr>
                <th>الموظف</th>
                <th>عمولات الخدمات</th>
                <th>المصروف</th>
                <th>المستحق الحالي</th>
                {manager && <th>إجراء</th>}
              </tr>
            </thead>
            <tbody>
              {c.summary.map((x) => (
                <tr key={x.staffId}>
                  <td>{x.staffName}</td>
                  <td>{amount(x.earned)} ج.م</td>
                  <td>{amount(x.paid)} ج.م</td>
                  <td className="s-number">{amount(x.due)} ج.م</td>
                  {manager && (
                    <td>
                      {x.due > 0 && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            edit(payoutForm(x.staffId, x.staffName, x.due))
                          }
                        >
                          صرف عمولة
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3>حركات العمولة</h3>
        {c.entries.length ? (
          <div className="s-table">
            <table>
              <thead>
                <tr>
                  <th>الموظف</th>
                  <th>الحركة</th>
                  <th>المبلغ</th>
                  <th>الوقت</th>
                </tr>
              </thead>
              <tbody>
                {c.entries.map((x) => (
                  <tr key={x.id}>
                    <td>{x.staffName}</td>
                    <td>
                      {ledgerLabels[x.kind]}
                      <small>{x.reason}</small>
                    </td>
                    <td>{amount(x.amount)} ج.م</td>
                    <td>{stamp(x.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>تظهر العمولة بعد إتمام الخدمة.</Empty>
        )}
        <h3>مستندات الصرف</h3>
        {c.payouts.length ? (
          <div className="s-table">
            <table>
              <thead>
                <tr>
                  <th>المستند</th>
                  <th>الموظف</th>
                  <th>المبلغ</th>
                  <th>الحالة</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {c.payouts.map((p) => (
                  <tr key={p.id}>
                    <td>{p.number}</td>
                    <td>{p.staff.name}</td>
                    <td>{amount(p.amount)} ج.م</td>
                    <td>{p.voidReason ? 'مصحح' : 'محفوظ'}</td>
                    <td>
                      <div className="s-actions">
                        <button
                          onClick={() =>
                            setReceipt({ kind: 'payout', data: p })
                          }
                        >
                          عرض المستند
                        </button>
                        {manager && !p.voidReason && (
                          <button
                            disabled={busy}
                            onClick={() =>
                              ask(
                                'تصحيح صرف ' + p.number,
                                'sal.commission.void',
                                { id: p.id },
                                <p>
                                  يعكس سجل الصرف ويعيد المستحق؛ لا ينفذ نقل
                                  أموال.
                                </p>,
                              )
                            }
                          >
                            تصحيح الصرف
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>لا يوجد صرف عمولات مسجل.</Empty>
        )}
      </>
    ) : (
      <Empty>لا توجد بيانات موظفين متاحة لهذا الحساب.</Empty>
    )
  const header = (title: string, action?: ReactNode) => (
    <div className="s-section-head">
      <h2>{title}</h2>
      {action}
    </div>
  )
  return (
    <div className="salon-shell" dir="rtl">
      <header className="s-header">
        <div className="s-brand">
          <img src="./icon.svg" alt="" />
          <span>
            XZARE <small>SALON / 0.1</small>
          </span>
        </div>
        <strong>{s.settings.businessName}</strong>
        <WorkspaceClock english={false} />
        <div className="s-user">
          <span>
            {s.user.name}
            <small>{roles[s.user.role as keyof typeof roles]}</small>
          </span>
          <button disabled={busy} onClick={() => edit(passwordForm())}>
            تغيير كلمة المرور
          </button>
          <button
            disabled={busy}
            onClick={() =>
              invoke(() =>
                exclusive(mutex, setBusy, async () => {
                  await call('logout')
                  end()
                }),
              )
            }
          >
            خروج
          </button>
        </div>
      </header>
      <nav className="s-nav" aria-label="قائمة الصالون">
        {visiblePages.map((v) => (
          <button
            key={v}
            aria-current={view === v ? 'page' : undefined}
            className={view === v ? 'active' : ''}
            onClick={() => {
              setView(v)
              setSearch('')
              setDetail(null)
              setForm(null)
              setReceipt(null)
              setError('')
            }}
          >
            {pages[v]}
          </button>
        ))}
      </nav>
      <main className="s-main">
        <div className="s-page-title">
          <div>
            <span className="s-kicker">XZARE SALON</span>
            <h1>{pages[view]}</h1>
          </div>
          <button disabled={busy} onClick={() => invoke(load)}>
            تحديث
          </button>
        </div>
        {error && (
          <p className="alert error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="alert" role="status">
            {notice}
          </p>
        )}
        {view === 'desk' && (
          <>
            <section className="s-calendar-bar">
              <div>
                <span className="s-kicker">المواعيد اليومية</span>
                <h2>يوم مرتب، عميل بعد عميل.</h2>
                <p>
                  {
                    filteredBookings.filter((b) =>
                      ['booked', 'arrived'].includes(b.status),
                    ).length
                  }{' '}
                  موعد قائم ·{' '}
                  {filteredBookings.filter((b) => b.status === 'done').length}{' '}
                  خدمة منفذة
                </p>
              </div>
              <Field label="يوم الحجوزات">
                <input
                  type="date"
                  value={day}
                  onChange={(e) => setDay(e.target.value)}
                />
              </Field>
              {office && (
                <button
                  className="primary"
                  disabled={
                    busy ||
                    !s.staff.some((t) => t.active) ||
                    !s.services.some((v) => v.active) ||
                    !s.customers.some((c) => c.active)
                  }
                  onClick={() => edit(bookingForm(s, day))}
                >
                  حجز موعد جديد
                </button>
              )}
            </section>
            <div className="s-toolbar">
              <Field label="بحث المواعيد">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="العميل أو الخدمة أو الموظف"
                />
              </Field>
              <button
                onClick={() =>
                  csv('Salon-bookings-' + day + '.csv', [
                    ['اليوم', 'الوقت', 'العميل', 'الخدمة', 'الموظف', 'الحالة'],
                    ...filteredBookings.map((b) => [
                      b.day,
                      clock(b.startMinute),
                      b.customerName,
                      b.serviceName,
                      b.staffName,
                      bookingLabels[b.status],
                    ]),
                  ])
                }
              >
                تصدير المواعيد
              </button>
            </div>
            {staff.length ? (
              <div className="s-desk">
                {staff.map((t) => (
                  <section className="s-lane" key={t.id}>
                    <header>
                      <span className="s-avatar">{t.name.slice(0, 1)}</span>
                      <div>
                        <h3>{t.name}</h3>
                        <small>
                          {
                            filteredBookings.filter((b) => b.staffId === t.id)
                              .length
                          }{' '}
                          مواعيد في اليوم
                        </small>
                      </div>
                    </header>
                    {bookingRows(
                      filteredBookings
                        .filter((b) => b.staffId === t.id)
                        .sort((a, b) => a.startMinute - b.startMinute),
                    )}
                  </section>
                ))}
              </div>
            ) : (
              <Empty>
                {office
                  ? 'أضف موظفًا وخدمة وعميلًا لبدء الحجوزات.'
                  : 'لا توجد حجوزات مسندة إليك. راجع مدير الصالون.'}
              </Empty>
            )}
            {office && !s.customers.length && (
              <button onClick={() => edit(customerForm())}>
                إضافة أول عميل
              </button>
            )}
          </>
        )}
        {view === 'customers' && (
          <>
            <div className="s-toolbar">
              <Field label="بحث العملاء">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </Field>
              {office && (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => edit(customerForm())}
                >
                  عميل جديد
                </button>
              )}
            </div>
            {s.customers.filter((c) => match(c.name, c.code, c.phone))
              .length ? (
              <div className="s-table">
                <table>
                  <thead>
                    <tr>
                      <th>العميل</th>
                      {office && <th>التواصل</th>}
                      <th>الحالة</th>
                      <th>إجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.customers
                      .filter((c) => match(c.name, c.code, c.phone))
                      .map((c) => (
                        <tr key={c.id}>
                          <td>
                            {c.name}
                            <small>{c.code}</small>
                          </td>
                          {office && <td>{c.phone || '—'}</td>}
                          <td>{c.active ? 'نشط' : 'متوقف'}</td>
                          <td>
                            <div className="s-actions">
                              <button
                                onClick={() =>
                                  invoke(() => open('customer', c.id))
                                }
                              >
                                ملف العميل
                              </button>
                              {office && (
                                <>
                                  <button
                                    disabled={busy}
                                    onClick={() => edit(customerForm(c))}
                                  >
                                    تعديل
                                  </button>
                                  {!!c.active && (
                                    <>
                                      <button
                                        disabled={
                                          busy ||
                                          !s.services.some((v) => v.active) ||
                                          !s.staff.some((t) => t.active)
                                        }
                                        onClick={() =>
                                          edit(bookingForm(s, day, c.id))
                                        }
                                      >
                                        حجز موعد
                                      </button>
                                      <button
                                        disabled={
                                          busy || !s.plans.some((p) => p.active)
                                        }
                                        onClick={() =>
                                          edit(saleForm(s, c, today()))
                                        }
                                      >
                                        بيع باقة
                                      </button>
                                    </>
                                  )}
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>
                {office
                  ? 'أضف العميل ببياناته الفعلية.'
                  : 'لا يوجد عملاء ضمن تكليفك الحالي.'}
              </Empty>
            )}
          </>
        )}
        {view === 'catalog' && manager && (
          <>
            {header(
              'الخدمات',
              <button
                className="primary"
                disabled={busy}
                onClick={() => edit(serviceForm())}
              >
                خدمة جديدة
              </button>,
            )}
            {s.services.length ? (
              <div className="s-table">
                <table>
                  <thead>
                    <tr>
                      <th>الخدمة</th>
                      <th>التصنيف</th>
                      <th>المدة</th>
                      <th>السعر</th>
                      <th>الحالة</th>
                      <th>إجراء</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.services.map((v) => (
                      <tr key={v.id}>
                        <td>
                          {v.name}
                          <small>{v.code}</small>
                        </td>
                        <td>{v.category || '—'}</td>
                        <td>{v.duration} دقيقة</td>
                        <td>{amount(v.fee ?? 0)} ج.م</td>
                        <td>{v.active ? 'متاحة' : 'متوقفة'}</td>
                        <td>
                          <button
                            disabled={busy}
                            onClick={() => edit(serviceForm(v))}
                          >
                            تعديل الخدمة
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>أضف اسم الخدمة ومدتها وسعرها.</Empty>
            )}
            {header(
              'فريق الخدمات',
              <button
                className="primary"
                disabled={busy}
                onClick={() => edit(staffForm(s))}
              >
                موظف جديد
              </button>,
            )}
            {s.staff.length ? (
              <div className="s-table">
                <table>
                  <thead>
                    <tr>
                      <th>الموظف</th>
                      <th>التواصل</th>
                      <th>العمولة</th>
                      <th>الحساب والحالة</th>
                      <th>إجراء</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.staff.map((t) => (
                      <tr key={t.id}>
                        <td>
                          {t.name}
                          <small>{t.code}</small>
                        </td>
                        <td>{t.phone || '—'}</td>
                        <td>{decimal(t.commissionBps ?? 0)}%</td>
                        <td>
                          {s.staffAccounts.find((u) => u.id === t.userId)
                            ?.username || 'غير مرتبط'}
                          <small>{t.active ? 'نشط' : 'متوقف'}</small>
                        </td>
                        <td>
                          <button
                            disabled={busy}
                            onClick={() => edit(staffForm(s, t))}
                          >
                            تعديل الموظف
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>
                أضف الموظف ونسبته، واربط حسابه إن كان سيستخدم البرنامج.
              </Empty>
            )}
          </>
        )}
        {view === 'packages' && office && (
          <>
            {header(
              'دليل الباقات',
              manager && (
                <button
                  className="primary"
                  disabled={busy || !s.services.some((v) => v.active)}
                  onClick={() => edit(planForm(s))}
                >
                  باقة جلسات جديدة
                </button>
              ),
            )}
            {s.plans.length ? (
              <div className="s-plan-strip">
                {s.plans.map((p) => (
                  <article key={p.id}>
                    <span>{p.code}</span>
                    <h3>{p.name}</h3>
                    <p>{p.serviceName}</p>
                    <strong>
                      {p.credits} جلسات · {p.days} يومًا
                    </strong>
                    <p>
                      {amount(p.fee)} ج.م · {p.active ? 'متاحة' : 'متوقفة'}
                    </p>
                    {manager && (
                      <button
                        disabled={busy}
                        onClick={() => edit(planForm(s, p))}
                      >
                        تعديل الباقة
                      </button>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <Empty>
                أضف باقة جلسات من خدمة مسجلة، ثم بعها من ملف العميل.
              </Empty>
            )}
            {header(
              'الباقات المباعة',
              <button
                onClick={() =>
                  csv('Salon-packages.csv', [
                    [
                      'العميل',
                      'الباقة',
                      'البداية',
                      'النهاية',
                      'عدد الجلسات',
                      'المستخدمة',
                      'المحجوزة',
                      'المستحق',
                    ],
                    ...s.packages.map((p) => [
                      p.customerName,
                      p.planName,
                      p.startDay,
                      p.endDay,
                      p.credits,
                      p.used,
                      p.reserved,
                      decimal(p.balance),
                    ]),
                  ])
                }
              >
                تصدير الباقات
              </button>,
            )}
            {packageRows(s.packages)}
          </>
        )}
        {view === 'fees' && office && (
          <>
            {header('الفواتير المسجلة')}
            <p className="muted">
              فاتورة الخدمة تنشأ بعد إتمامها؛ الخدمة من باقة مسددة لا تضيف
              رسومًا ثانية.
            </p>
            {invoiceRows(s.invoices)}
            {header(
              'إيصالات التحصيل',
              <button
                onClick={() =>
                  csv('Salon-receipts.csv', [
                    ['الإيصال', 'العميل', 'المبلغ', 'الحالة'],
                    ...s.payments.map((p) => [
                      p.number,
                      p.customer.name,
                      decimal(p.amount),
                      p.voidReason ? 'ملغى' : 'محفوظ',
                    ]),
                  ])
                }
              >
                تصدير الإيصالات
              </button>,
            )}
            {paymentsRows(s.payments)}
          </>
        )}
        {view === 'commissions' && (
          <>
            <p className="muted">
              تحسب العمولة من الخدمة المنفذة بعد الخصم، أو من القيمة المخصصة
              لجلسة الباقة. الصرف سجل مبالغ تم تسليمها بالفعل.
            </p>
            {commissions ? (
              commissionRows(commissions)
            ) : (
              <Empty>جارٍ قراءة العمولات…</Empty>
            )}
          </>
        )}
        {view === 'reports' && (
          <>
            <div className="s-toolbar">
              <Field label="من تاريخ">
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </Field>
              <Field label="حتى تاريخ">
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </Field>
              {report && (
                <>
                  <button onClick={() => window.print()}>طباعة التقرير</button>
                  <button
                    onClick={() =>
                      csv('Salon-report.csv', [
                        [
                          'اليوم',
                          'الوقت',
                          'العميل',
                          'الخدمة',
                          'الموظف',
                          'الحالة',
                        ],
                        ...report.bookings.map((b) => [
                          b.day,
                          clock(b.startMinute),
                          b.customerName,
                          b.serviceName,
                          b.staffName,
                          bookingLabels[b.status],
                        ]),
                      ])
                    }
                  >
                    تصدير التقرير
                  </button>
                </>
              )}
            </div>
            {report ? (
              <section className="s-report">
                <h2>{s.settings.businessName} — تقرير Salon</h2>
                <p>
                  {report.from} ← {report.to}
                </p>
                {report.finance && (
                  <>
                    <div className="s-stats">
                      <div>
                        <strong>{amount(report.finance.charges)}</strong>
                        <span>صافي الرسوم في الفترة، ج.م</span>
                      </div>
                      <div>
                        <strong>{amount(report.finance.netCollected)}</strong>
                        <span>صافي التحصيل في الفترة، ج.م</span>
                      </div>
                      <div>
                        <strong>{amount(report.finance.outstanding)}</strong>
                        <span>المستحق الحالي، ج.م</span>
                      </div>
                      <div>
                        <strong>{amount(report.finance.voided)}</strong>
                        <span>إيصالات ألغيت في الفترة، ج.م</span>
                      </div>
                    </div>
                    <p className="muted">
                      التواريخ حسب المنطقة الزمنية المحلية للجهاز. المديونية
                      وملخص العمولة يمثلان الوضع الحالي، والحركات والمواعيد
                      للفترة المختارة.
                    </p>
                  </>
                )}
                <h3>الخدمات والمواعيد</h3>
                {bookingRows(report.bookings, false)}
                <h3>العمولات</h3>
                {commissionRows(report.commissions)}
              </section>
            ) : (
              <Empty>اختر فترة صحيحة حتى366 يومًا.</Empty>
            )}
          </>
        )}
        {view === 'users' && admin && (
          <>
            {header(
              'حسابات الصالون',
              <button
                className="primary"
                disabled={busy}
                onClick={() => edit(userForm())}
              >
                حساب جديد
              </button>,
            )}
            <div className="s-table">
              <table>
                <thead>
                  <tr>
                    <th>الاسم</th>
                    <th>الحساب</th>
                    <th>الصلاحية</th>
                    <th>الحالة</th>
                    <th>إجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {s.users.map((u) => (
                    <tr key={u.id}>
                      <td>{u.name}</td>
                      <td>{u.username}</td>
                      <td>{roles[u.role as keyof typeof roles]}</td>
                      <td>{u.active ? 'نشط' : 'متوقف'}</td>
                      <td>
                        <button
                          disabled={busy}
                          onClick={() => edit(userForm(u))}
                        >
                          تعديل الحساب
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {view === 'audit' && manager && (
          <div className="s-table">
            <table>
              <thead>
                <tr>
                  <th>العملية</th>
                  <th>المستخدم</th>
                  <th>المرجع</th>
                  <th>الوقت</th>
                </tr>
              </thead>
              <tbody>
                {s.audit.map((a) => (
                  <tr key={a.id}>
                    <td>{eventLabel(a.action)}</td>
                    <td>{a.user_name ?? '—'}</td>
                    <td>{a.entity_id}</td>
                    <td>{stamp(a.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {view === 'settings' && admin && (
          <div className="s-settings">
            <section>
              <h2>بيانات الصالون والطباعة</h2>
              <p>تظهر بيانات الصالون وقت العملية في المستندات المحفوظة.</p>
              <button
                disabled={busy}
                onClick={() =>
                  edit({
                    title: 'بيانات الصالون',
                    action: 'settings.save',
                    body: (
                      <>
                        <Field label="اسم الصالون">
                          <input
                            name="businessName"
                            defaultValue={s.settings.businessName}
                            required
                            maxLength={160}
                          />
                        </Field>
                        <Field label="رقم التواصل">
                          <input
                            name="phone"
                            defaultValue={s.settings.phone}
                            maxLength={160}
                          />
                        </Field>
                        <Field label="العنوان">
                          <input
                            name="address"
                            defaultValue={s.settings.address}
                            maxLength={160}
                          />
                        </Field>
                        <Field label="تذييل الإيصال">
                          <input
                            name="receiptFooter"
                            defaultValue={s.settings.receiptFooter}
                            maxLength={160}
                          />
                        </Field>
                      </>
                    ),
                    payload: (f) => ({
                      businessName: text(f, 'businessName'),
                      phone: text(f, 'phone'),
                      address: text(f, 'address'),
                      receiptFooter: text(f, 'receiptFooter'),
                      currency: 'EGP',
                      language: 'ar',
                      taxBps: 0,
                    }),
                  })
                }
              >
                تعديل بيانات الصالون
              </button>
            </section>
            <section>
              <h2>النسخ الاحتياطية</h2>
              <p>
                استعادة نسخة هذا المنتج بكلمة مرور المسؤول، مع إنهاء الجلسات
                وحفظ نسخة قبل الاستعادة. قاعدة البيانات والنسخ الاحتياطية غير
                مشفرة.
              </p>
              <div className="s-actions">
                <button
                  disabled={busy}
                  onClick={() =>
                    invoke(() =>
                      exclusive(mutex, setBusy, async () => {
                        const r = await call<{
                          download?: string
                          fileName?: string
                          cancelled?: boolean
                        }>('backup.create')
                        if (r.download && r.fileName) {
                          download(
                            r.fileName,
                            new Blob([
                              Uint8Array.from(atob(r.download), (c) =>
                                c.charCodeAt(0),
                              ),
                            ]),
                          )
                          setNotice('تم تجهيز النسخة الاحتياطية')
                        } else if (!r.cancelled)
                          setNotice('تم حفظ النسخة الاحتياطية')
                      }),
                    )
                  }
                >
                  حفظ نسخة احتياطية
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    edit({
                      title: 'استعادة نسخة Salon',
                      action: 'backup.restore',
                      body: (
                        <>
                          <p>
                            الاستعادة تستبدل البيانات الحالية وتحتفظ بنسخة منها.
                            راجع الملف قبل التأكيد.
                          </p>
                          {!window.xzare && (
                            <Field label="ملف النسخة الاحتياطية">
                              <input
                                name="file"
                                type="file"
                                accept=".xzbak"
                                required
                              />
                            </Field>
                          )}
                          <Field label="كلمة مرور المسؤول">
                            <input
                              name="password"
                              type="password"
                              required
                              maxLength={128}
                              autoComplete="current-password"
                            />
                          </Field>
                          <label className="s-check">
                            <input type="checkbox" required />
                            راجعت النسخة وأوافق على استعادة البيانات
                          </label>
                        </>
                      ),
                      payload: (f) => ({
                        password: passwordValue(f, 'password'),
                        file: f.get('file'),
                      }),
                    })
                  }
                >
                  استعادة نسخة
                </button>
              </div>
            </section>
            <section>
              <h2>الترخيص المرتبط بالجهاز</h2>
              <LicensePanel />
            </section>
            <section>
              <h2>الدعم</h2>
              <p dir="ltr">
                hello@xzare.com
                <br />
                +201501230440
              </p>
              <p>
                العملة الحالية: الجنيه المصري (EGP). للدعم الفني وتجديد الترخيص،
                تواصل مع Xzare.
              </p>
            </section>
          </div>
        )}
        <footer className="s-footer">
          <span>XZARE SOFTWARE SOLUTIONS · SALON / 0.1</span>
          <span dir="ltr">hello@xzare.com · +201501230440</span>
        </footer>
      </main>
      {form && (
        <Modal
          title={form.title}
          busy={busy}
          error={error}
          submit={form.submit}
          onClose={() => setForm(null)}
          onSubmit={async (e) => {
            if (mutex.current) return
            const current = form,
              f = new FormData(e.currentTarget)
            try {
              const p = current.payload(f)
              if (current.action === 'backup.restore')
                await exclusive(mutex, setBusy, async () => {
                  if (window.xzare) {
                    const r = await call<{
                      restored?: boolean
                      cancelled?: boolean
                    }>('backup.restore', { password: p.password })
                    if (r.restored) end()
                    else if (r.cancelled) setForm(null)
                  } else {
                    if (
                      !(p.file instanceof File) ||
                      !p.file.size ||
                      p.file.size > 128 * 1024 * 1024
                    )
                      throw Error('اختر نسخة صحيحة حتى128 ميجابايت')
                    const r = await fetch('/api/restore', {
                        method: 'POST',
                        headers: {
                          'X-Xzare-Request': '1',
                          'X-Xzare-Password': encodeURIComponent(
                            String(p.password),
                          ),
                        },
                        credentials: 'same-origin',
                        body: p.file,
                      }),
                      v = await r.json()
                    if (!r.ok || !v.ok) throw Error(v.error ?? 'تعذر الاستعادة')
                    end()
                  }
                })
              else {
                await run(current.action, p)
                setForm(null)
              }
            } catch (e) {
              const m = e instanceof Error ? e.message : 'تعذر الحفظ'
              setError(m)
              authError(m)
            }
          }}
        >
          {form.body}
        </Modal>
      )}
      {detail && (
        <Modal
          title={
            detail.kind === 'booking'
              ? 'موعد — ' + detail.data.booking.customerName
              : detail.kind === 'customer'
                ? 'ملف — ' + detail.data.customer.name
                : detail.kind === 'package'
                  ? 'باقة — ' + detail.data.package.customerName
                  : 'فاتورة ' + detail.data.invoice.number
          }
          busy={busy}
          error={error}
          manual
          onClose={() => setDetail(null)}
        >
          {detail.kind === 'booking' &&
            (() => {
              const d = detail.data,
                b: SalonBooking = d.booking
              return (
                <>
                  <div className="s-review">
                    <strong>{b.customerName}</strong>
                    <span>
                      {b.serviceName} · {b.staffName}
                    </span>
                    <span>
                      {b.day} · {clock(b.startMinute)} ←{' '}
                      {clock(b.startMinute + b.duration)}
                    </span>
                    <b className="s-status">{bookingLabels[b.status]}</b>
                  </div>
                  {office && (
                    <p>
                      {b.packageId
                        ? 'الخدمة من باقة مسجلة'
                        : 'السعر بعد الخصم ' +
                          amount((b.fee ?? 0) - (b.discount ?? 0)) +
                          ' ج.م'}
                      {b.note && (
                        <>
                          <br />
                          {b.note}
                        </>
                      )}
                    </p>
                  )}
                  <div className="s-actions">
                    {office && b.status === 'booked' && (
                      <>
                        <button
                          disabled={busy}
                          onClick={() =>
                            confirm(
                              'تسجيل وصول العميل',
                              'sal.booking.arrive',
                              b,
                              <p>تأكيد وصول العميل اليوم لهذا الموعد.</p>,
                              'تسجيل الحضور',
                            )
                          }
                        >
                          وصل العميل
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => edit(moveForm(s, b))}
                        >
                          نقل الموعد
                        </button>
                        <button
                          disabled={busy}
                          onClick={() =>
                            ask(
                              'لم يحضر العميل',
                              'sal.booking.no-show',
                              { id: b.id, version: b.version },
                              <p>
                                متاح بعد نهاية وقت الموعد؛ يحرر الجلسة المحجوزة
                                من الباقة.
                              </p>,
                            )
                          }
                        >
                          لم يحضر
                        </button>
                      </>
                    )}
                    {office && ['booked', 'arrived'].includes(b.status) && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          ask('إلغاء الموعد', 'sal.booking.cancel', {
                            id: b.id,
                            version: b.version,
                          })
                        }
                      >
                        إلغاء الموعد
                      </button>
                    )}
                    {(manager || !office) && b.status === 'arrived' && (
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() =>
                          confirm(
                            'إتمام الخدمة',
                            'sal.booking.complete',
                            b,
                            <p>
                              يسجل الخدمة المنفذة وفاتورتها والعمولة مرة واحدة.
                              لا يتم قبل بداية الموعد.
                            </p>,
                            'تسجيل إتمام الخدمة',
                          )
                        }
                      >
                        تمت الخدمة
                      </button>
                    )}
                    {manager && b.status === 'done' && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          ask(
                            'تصحيح نتيجة الخدمة',
                            'sal.booking.void',
                            { id: b.id, version: b.version },
                            <p>
                              يصحح الرسوم والعمولة ويرجع جلسة الباقة. صحح
                              التحصيل أو صرف العمولة أولًا إذا كان قائمًا.
                            </p>,
                          )
                        }
                      >
                        تصحيح النتيجة
                      </button>
                    )}
                  </div>
                  {d.completion && (
                    <section className="s-note">
                      <h3>الخدمة المنفذة</h3>
                      <p>
                        العمولة {amount(d.completion.commission)} ج.م · نسبة
                        {decimal(d.completion.rateBps)}%
                      </p>
                      {office && (
                        <p>أساس العمولة {amount(d.completion.basis)} ج.م</p>
                      )}
                      {d.completion.voidReason && (
                        <p>نتيجة مصححة — {d.completion.voidReason}</p>
                      )}
                    </section>
                  )}
                  {d.invoice && invoiceRows([d.invoice])}
                  {eventRows(d.events)}
                </>
              )
            })()}
          {detail.kind === 'customer' && (
            <>
              <p>
                {detail.data.customer.code}
                {office &&
                  ' · ' + (detail.data.customer.phone || 'بدون رقم تواصل')}
              </p>
              {office && detail.data.customer.note && (
                <p>{detail.data.customer.note}</p>
              )}
              {office && !!detail.data.customer.active && (
                <div className="s-actions">
                  <button
                    disabled={busy}
                    onClick={() => edit(bookingForm(s, day, detail.id))}
                  >
                    حجز موعد
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      edit(saleForm(s, detail.data.customer, today()))
                    }
                  >
                    بيع باقة
                  </button>
                </div>
              )}
              <h3>مواعيد العميل</h3>
              {bookingRows(detail.data.bookings)}
              {office && (
                <>
                  <h3>باقات العميل</h3>
                  {packageRows(detail.data.packages)}
                  <h3>فواتير العميل</h3>
                  {invoiceRows(detail.data.invoices)}
                </>
              )}
              {eventRows(detail.data.events)}
            </>
          )}
          {detail.kind === 'package' && (
            <>
              <div className="s-review">
                <strong>{detail.data.package.planName}</strong>
                <span>{detail.data.package.serviceName}</span>
                <span>
                  {detail.data.package.startDay} ← {detail.data.package.endDay}
                </span>
                <span>
                  {detail.data.package.used} مستخدمة +{' '}
                  {detail.data.package.reserved} محجوزة من
                  {detail.data.package.credits}
                </span>
              </div>
              {manager && detail.data.package.status === 'active' && (
                <button
                  disabled={busy}
                  onClick={() =>
                    ask(
                      'إلغاء الباقة',
                      'sal.package.cancel',
                      { id: detail.id, version: detail.data.package.version },
                      <p>متاح دون تحصيل قائم أو جلسات مستخدمة أو محجوزة.</p>,
                    )
                  }
                >
                  إلغاء الباقة
                </button>
              )}
              {invoiceRows([detail.data.invoice])}
              <h3>الجلسات المرتبطة</h3>
              {bookingRows(detail.data.bookings)}
              <h3>الجلسات المستخدمة</h3>
              {detail.data.uses.length ? (
                <div className="s-table">
                  <table>
                    <thead>
                      <tr>
                        <th>الجلسة</th>
                        <th>القيمة المخصصة</th>
                        <th>الحالة</th>
                        <th>الوقت</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.data.uses.map((u: any) => (
                        <tr key={u.id}>
                          <td>{u.creditIndex + 1}</td>
                          <td>{amount(u.basis)} ج.م</td>
                          <td>
                            {u.voidReason
                              ? 'مصَححة — ' + u.voidReason
                              : 'مستخدمة'}
                          </td>
                          <td>{stamp(u.at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty>لم تستخدم جلسات من الباقة بعد.</Empty>
              )}
              {eventRows(detail.data.events)}
            </>
          )}
          {detail.kind === 'invoice' && (
            <>
              {invoiceRows([detail.data.invoice])}
              <h3>الإيصالات</h3>
              {paymentsRows(detail.data.payments)}
              <h3>كشف الرسوم</h3>
              <div className="s-table">
                <table>
                  <thead>
                    <tr>
                      <th>الحركة</th>
                      <th>المبلغ</th>
                      <th>السبب</th>
                      <th>الوقت</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.data.ledger.map((l: any) => (
                      <tr key={l.id}>
                        <td>{ledgerLabels[l.kind]}</td>
                        <td>{amount(l.amount)} ج.م</td>
                        <td>{l.reason}</td>
                        <td>{stamp(l.at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {eventRows(detail.data.events)}
            </>
          )}
        </Modal>
      )}
      {receipt && (
        <Modal
          title={
            receipt.kind === 'payment'
              ? 'إيصال ' + receipt.data.number
              : 'صرف ' + receipt.data.number
          }
          busy={busy}
          error={error}
          manual
          onClose={() => setReceipt(null)}
        >
          <article className="s-receipt print-area">
            <img src="./icon.svg" alt="" />
            <h2>{receipt.data.business.businessName}</h2>
            <h3>{receipt.data.number}</h3>
            {receipt.data.voidReason && (
              <strong className="s-void">
                مستند مصحح أو ملغى — {receipt.data.voidReason}
              </strong>
            )}
            {receipt.kind === 'payment' ? (
              <>
                <p>
                  {receipt.data.customer.name} · {receipt.data.customer.code}
                </p>
                <p>{receipt.data.item.name}</p>
              </>
            ) : (
              <p>{receipt.data.staff.name} · صرف عمولة</p>
            )}
            <strong className="s-receipt-total">
              {amount(receipt.data.amount)} ج.م
            </strong>
            <p>
              {methods[receipt.data.method]} · {receipt.data.reference}
            </p>
            <p>
              {stamp(receipt.data.at)} · {receipt.data.actorName}
            </p>
            <p>
              {receipt.data.business.phone}
              <br />
              {receipt.data.business.address}
            </p>
            <p>{receipt.data.business.receiptFooter}</p>
          </article>
          <button onClick={() => window.print()}>طباعة المستند</button>
        </Modal>
      )}
    </div>
  )
}
