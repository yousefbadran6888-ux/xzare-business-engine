import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ulid } from '@xzare/core'
import type { LabPatient, LabTest, LabSample, LabOrder, User, Laboratory } from '@xzare/engine'
import { AuthScreen, type AuthValues } from './AuthScreen'
import { LicensePanel } from '../../pos/src/LicensePanel'
import { WorkspaceClock } from '../../pos/src/WorkspaceClock'
import { call } from '../../pos/src/bridge'
import { useSessionActivity } from '../../pos/src/useSessionActivity'
import { Modal, Field, Empty, amount, decimal, today, csv, download } from './ui'
import {
  readMoney,
  stamp,
  roles,
  statuses,
  sampleStatuses,
  methods,
  type State,
  type Detail,
} from './model'
import { OrderEditor } from './OrderEditor'
import { OrderDetail, PatientView } from './LabDetail'
const pages = {
  overview: 'لوحة المعمل',
  orders: 'طلبات التحاليل',
  samples: 'العينات والباركود',
  patients: 'ملفات المرضى',
  catalog: 'دليل التحاليل',
  results: 'النتائج والاعتماد',
  reports: 'تقارير التحصيل',
  users: 'المستخدمون',
  audit: 'سجل التدقيق',
  settings: 'الإعدادات والترخيص',
}
type View = keyof typeof pages
type Form = {
  title: string
  body: ReactNode
  action: string
  payload: (f: FormData) => Record<string, unknown>
  submit?: string
}
export function App() {
  const [configured, setConfigured] = useState<boolean | null>(null),
    [state, setState] = useState<State | null>(null),
    [view, setView] = useState<View>('overview'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [search, setSearch] = useState(''),
    [form, setForm] = useState<Form | null>(null),
    [formSaving, setFormSaving] = useState(false),
    [detail, setDetail] = useState<Detail | null>(null),
    [history, setHistory] = useState<{ patient: LabPatient; orders: LabOrder[] } | null>(null),
    [newOrder, setNewOrder] = useState<string | null>(null),
    [sampleFilter, setSampleFilter] = useState<LabSample['status']>('pending'),
    [from, setFrom] = useState(today()),
    [to, setTo] = useState(today()),
    [report, setReport] = useState<ReturnType<Laboratory['report']> | null>(null)
  const mutex = useRef(false),
    requests = useRef(new Map<string, string>()),
    generation = useRef(0),
    loadSeq = useRef(0)
  const end = () => {
    generation.current++
    setState(null)
    setDetail(null)
    setHistory(null)
    setNewOrder(null)
    setForm(null)
    setReport(null)
    setView('overview')
    setError('')
    setNotice('')
    setSearch('')
    requests.current.clear()
  }
  useSessionActivity(!!state, end)
  const authError = (m: string) => {
    if (/انتهت الجلسة|سجّل الدخول/.test(m)) {
      end()
      setError(m)
    }
  }
  async function load() {
    const g = generation.current,
      n = ++loadSeq.current,
      s = await call<State>('laboratory.state')
    if (g === generation.current && n === loadSeq.current) setState(s)
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
    if (!state) return
    const timer = setInterval(() => {
      if (!mutex.current)
        void load().catch((e) => {
          setError(e.message)
          authError(e.message)
        })
    }, 15000)
    return () => clearInterval(timer)
  }, [state?.user.id])
  useEffect(() => {
    if (!state || view !== 'reports') return
    let live = true
    setReport(null)
    void call<ReturnType<Laboratory['report']>>('laboratory.report', { from, to })
      .then((r) => {
        if (live) setReport(r)
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
  }, [state, view, from, to])
  const invoke = (f: () => Promise<unknown>) => {
    void f().catch((e) => {
      const m = e instanceof Error ? e.message : 'تعذر إتمام العملية'
      setError(m)
      authError(m)
    })
  }
  async function run(action: string, p: Record<string, unknown> = {}) {
    if (mutex.current) throw new Error('انتظر انتهاء العملية')
    const g = generation.current
    mutex.current = true
    setBusy(true)
    setError('')
    setNotice('')
    const command = action.startsWith('laboratory.'),
      key = JSON.stringify([action, p])
    try {
      if (command && !requests.current.has(key)) requests.current.set(key, ulid())
      const r = await call<{ id: string }>(
        action,
        command ? { ...p, clientTxnId: requests.current.get(key) } : p,
      )
      if (g !== generation.current) throw new Error('انتهت الجلسة؛ سجّل الدخول مرة أخرى')
      requests.current.delete(key)
      setNotice('تم حفظ العملية')
      try {
        await load()
      } catch (e) {
        const m = e instanceof Error ? e.message : 'تعذر تحديث العرض'
        authError(m)
        setError('تم الحفظ؛ حدّث العرض لقراءة البيانات.')
      }
      return r
    } catch (e) {
      const m = e instanceof Error ? e.message : 'تعذر إتمام العملية'
      setError(m)
      authError(m)
      throw e
    } finally {
      mutex.current = false
      setBusy(false)
    }
  }
  async function openOrder(id: string) {
    const g = generation.current,
      d = await call<Detail>('laboratory.order.get', { id })
    if (g === generation.current) {
      setHistory(null)
      setDetail(d)
      setError('')
    }
  }
  async function openPatient(id: string) {
    const g = generation.current,
      h = await call<{ patient: LabPatient; orders: LabOrder[] }>('laboratory.patient.get', { id })
    if (g === generation.current) {
      setHistory(h)
      setDetail(null)
      setError('')
    }
  }
  async function authenticate(v: AuthValues) {
    setBusy(true)
    setError('')
    try {
      await call(
        configured ? 'login' : 'setup',
        configured ? { username: v.username, password: v.password } : v,
      )
      setConfigured(true)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تسجيل الدخول')
      throw e
    } finally {
      setBusy(false)
    }
  }
  const saveForm = (
    title: string,
    body: ReactNode,
    action: string,
    payload: Form['payload'],
    submit?: string,
  ) => {
    setError('')
    setForm({ title, body, action, payload, submit })
  }
  const nav = (v: View) => {
    setView(v)
    setSearch('')
    setError('')
    setNotice('')
  }
  if (!state)
    return (
      <AuthScreen configured={configured} busy={busy} error={error} onAuthenticate={authenticate} />
    )
  const s = state,
    admin = s.user.role === 'admin',
    technical = ['admin', 'manager', 'technician'].includes(s.user.role),
    manager = ['admin', 'manager'].includes(s.user.role),
    finance = s.user.role !== 'technician',
    q = search.trim().toLowerCase(),
    locked = busy || formSaving
  const matches = (...xs: unknown[]) => xs.join(' ').toLowerCase().includes(q)
  function patientForm(p?: LabPatient) {
    saveForm(
      p ? 'تعديل ملف المريض' : 'مريض جديد',
      <>
        <div className="a-form-row">
          <Field label="اسم المريض">
            <input name="name" required maxLength={160} defaultValue={p?.name ?? ''} />
          </Field>
          <Field label="رقم التواصل">
            <input name="phone" type="tel" dir="ltr" maxLength={40} defaultValue={p?.phone ?? ''} />
          </Field>
        </div>
        <div className="a-form-row">
          <Field label="تاريخ الميلاد (اختياري)">
            <input name="birthDate" type="date" max={today()} defaultValue={p?.birthDate ?? ''} />
          </Field>
          <Field label="النوع">
            <select name="sex" defaultValue={p?.sex ?? 'unknown'}>
              <option value="unknown">غير مسجل</option>
              <option value="male">ذكر</option>
              <option value="female">أنثى</option>
            </select>
          </Field>
        </div>
        <Field label="العنوان">
          <input name="address" maxLength={250} defaultValue={p?.address ?? ''} />
        </Field>
        <label className="a-check">
          <input type="checkbox" name="active" defaultChecked={p ? !!p.active : true} />
          ملف نشط
        </label>
        <small>يولد رقم ملف وباركود ثابتان. الطلبات تحتفظ ببيانات المريض عند إنشائها.</small>
      </>,
      'laboratory.patient.save',
      (f) => ({
        ...(p && { id: p.id, version: p.version }),
        name: String(f.get('name')),
        phone: String(f.get('phone')),
        birthDate: f.get('birthDate') || null,
        sex: String(f.get('sex')),
        address: String(f.get('address')),
        active: f.has('active'),
      }),
    )
  }
  function testForm(t?: LabTest) {
    saveForm(
      t ? 'تعديل التحليل' : 'تحليل جديد',
      <>
        <div className="a-form-row">
          <Field label="اسم التحليل">
            <input name="name" required maxLength={160} defaultValue={t?.name ?? ''} />
          </Field>
          <Field label="كود التحليل">
            <input
              name="code"
              required
              dir="ltr"
              pattern="[A-Za-z0-9][A-Za-z0-9_.-]{0,39}"
              maxLength={40}
              defaultValue={t?.code ?? ''}
            />
          </Field>
        </div>
        <div className="a-form-row">
          <Field label="نوع العينة">
            <input name="specimen" required maxLength={160} defaultValue={t?.specimen ?? ''} />
          </Field>
          <Field label="نوع النتيجة">
            <select name="kind" defaultValue={t?.kind ?? 'number'}>
              <option value="number">رقمية (تقبل &lt; و &gt;)</option>
              <option value="text">نصية</option>
            </select>
          </Field>
        </div>
        <div className="a-form-row">
          <Field label="الوحدة">
            <input name="unit" maxLength={40} defaultValue={t?.unit ?? ''} />
          </Field>
          <Field label="السعر · ج.م">
            <input
              name="price"
              required
              dir="ltr"
              inputMode="decimal"
              defaultValue={t ? decimal(t.price) : ''}
            />
          </Field>
        </div>
        <Field label="المجال المرجعي النصي">
          <textarea name="reference" rows={2} maxLength={1000} defaultValue={t?.reference ?? ''} />
        </Field>
        <div className="a-form-row">
          <Field label="الحد الأدنى للمقارنة (اختياري)">
            <input name="min" type="number" step="any" defaultValue={t?.min ?? ''} />
          </Field>
          <Field label="الحد الأعلى للمقارنة (اختياري)">
            <input name="max" type="number" step="any" defaultValue={t?.max ?? ''} />
          </Field>
        </div>
        <small>
          أدخل المراجع المعتمدة في معملك. الحدود للنتائج الرقمية؛ اتركها فارغة للنتائج النصية.
          استخدم اسم نوع عينة موحّدًا للتحاليل التي تشترك في العينة.
        </small>
        <label className="a-check">
          <input name="active" type="checkbox" defaultChecked={t ? !!t.active : true} />
          تحليل نشط
        </label>
      </>,
      'laboratory.test.save',
      (f) => ({
        ...(t && { id: t.id, version: t.version }),
        name: String(f.get('name')),
        code: String(f.get('code')),
        specimen: String(f.get('specimen')),
        kind: String(f.get('kind')),
        unit: String(f.get('unit')),
        reference: String(f.get('reference')),
        min: f.get('min') ? Number(f.get('min')) : null,
        max: f.get('max') ? Number(f.get('max')) : null,
        price: readMoney(f.get('price')),
        active: f.has('active'),
      }),
    )
  }
  function userForm(u?: User) {
    saveForm(
      u ? 'تعديل المستخدم' : 'مستخدم جديد',
      <>
        <Field label="الاسم">
          <input name="name" required maxLength={160} defaultValue={u?.name ?? ''} />
        </Field>
        <Field label="اسم المستخدم">
          <input
            name="username"
            dir="ltr"
            required
            pattern="[A-Za-z0-9_.\-]{3,40}"
            defaultValue={u?.username ?? ''}
          />
        </Field>
        <Field label="الصلاحية">
          <select name="role" defaultValue={u?.role ?? 'cashier'}>
            <option value="cashier">الاستقبال والتحصيل: المرضى والطلبات دون النتائج</option>
            <option value="technician">فني المعمل: العينات وإدخال النتائج دون التحصيل</option>
            <option value="manager">مراجع النتائج ومدير المعمل: الدليل والاعتماد</option>
            <option value="admin">مسؤول النظام: الإدارة الكاملة</option>
          </select>
        </Field>
        <Field label={u ? 'كلمة مرور جديدة (اختياري)' : 'كلمة المرور'}>
          <input
            name="password"
            type="password"
            required={!u}
            minLength={12}
            maxLength={128}
            autoComplete="new-password"
          />
        </Field>
        <label className="a-check">
          <input name="active" type="checkbox" defaultChecked={u ? !!u.active : true} />
          مستخدم نشط
        </label>
        <small>
          الاعتماد يحتاج مستخدمًا مختلفًا عن مُدخل النتائج، حتى لو كان المُدخل مسؤول النظام.
        </small>
      </>,
      'user.save',
      (f) => ({
        ...(u && { id: u.id }),
        name: String(f.get('name')),
        username: String(f.get('username')),
        role: String(f.get('role')),
        active: f.has('active'),
        ...(f.get('password') && { password: String(f.get('password')) }),
      }),
    )
  }
  function sampleForm(x: LabSample, status: 'collected' | 'received' | 'rejected') {
    saveForm(
      { collected: 'تسجيل سحب العينة', received: 'استلام العينة', rejected: 'رفض العينة' }[status],
      <>
        <p>
          {x.patientName} · {x.specimen} · <code>{x.number}</code>
        </p>
        <Field label="ملاحظة الحركة">
          <input name="note" required maxLength={1000} />
        </Field>
        {status === 'rejected' && (
          <p>سيحفظ الرفض وتُمسح مسودة نتائج هذه العينة. إعادة السحب تصدر ملصقًا جديدًا.</p>
        )}
      </>,
      'laboratory.sample.status',
      (f) => ({ id: x.id, version: x.version, status, note: String(f.get('note')) }),
      'تأكيد الحركة',
    )
  }
  function payForm() {
    if (!detail) return
    const o = detail.order
    saveForm(
      'تحصيل دفعة',
      <>
        <p>
          {o.number} · المتبقي {amount(o.balance)} ج.م
        </p>
        <Field label="المبلغ · ج.م">
          <input
            name="amount"
            required
            dir="ltr"
            inputMode="decimal"
            defaultValue={decimal(o.balance)}
          />
        </Field>
        <Field label="طريقة التحصيل">
          <select name="method">
            {Object.entries(methods).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="مرجع أو بيان السند">
          <input name="reference" required maxLength={1000} />
        </Field>
      </>,
      'laboratory.order.pay',
      (f) => ({
        id: o.id,
        amount: readMoney(f.get('amount')),
        method: String(f.get('method')),
        reference: String(f.get('reference')),
      }),
    )
  }
  function cancelForm() {
    if (!detail) return
    const o = detail.order
    saveForm(
      'إلغاء الطلب ورد المحصّل',
      <>
        <p>
          {o.number} · سيرد {amount(o.paid)} ج.م ويُقفل الطلب.
        </p>
        <Field label="سبب الإلغاء">
          <input name="note" required maxLength={1000} />
        </Field>
        <Field label="طريقة الاسترداد">
          <select name="method">
            {Object.entries(methods).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="مرجع الاسترداد">
          <input name="reference" required maxLength={1000} />
        </Field>
      </>,
      'laboratory.order.cancel',
      (f) => ({
        id: o.id,
        version: o.version,
        note: String(f.get('note')),
        method: String(f.get('method')),
        reference: String(f.get('reference')),
      }),
      'تأكيد الإلغاء والاسترداد',
    )
  }
  const filteredOrders = s.orders.filter((o) =>
    matches(o.number, o.patient.number, o.patient.name, o.patient.phone),
  )
  const activeSamples = s.samples.filter(
    (x) => !x.replacedBy && s.orders.find((o) => o.id === x.orderId)?.status === 'testing',
  )
  const searchBox = (label: string) => (
    <Field label={label}>
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const found = s.samples.find((x) => x.number.toLowerCase() === q)
            if (found) invoke(() => openOrder(found.orderId))
          }
        }}
      />
    </Field>
  )
  const orderTable = (orders: LabOrder[]) => (
    <div className="a-scroll">
      <table>
        <thead>
          <tr>
            <th>الطلب / المريض</th>
            <th>التسليم المتوقع</th>
            <th>الحالة</th>
            {finance && <th>المتبقي · ج.م</th>}
            <th>فتح</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td>
                <b>{o.patient.name}</b>
                <small dir="ltr">
                  {o.number} · {o.patient.number}
                </small>
              </td>
              <td>{stamp(o.dueAt)}</td>
              <td>
                <span className={'lab-status ' + o.status}>
                  {statuses[o.status]}
                  {o.revision ? ' · مراجعة ' + o.revision : ''}
                </span>
              </td>
              {finance && <td>{amount(o.balance)}</td>}
              <td>
                <button type="button" onClick={() => invoke(() => openOrder(o.id))}>
                  فتح الطلب
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!orders.length && <Empty>لا توجد طلبات في هذا العرض.</Empty>}
    </div>
  )
  return (
    <div className="lab-app">
      <aside className="lab-sidebar">
        <div className="lab-brand">
          <img src="./icon.svg" alt="" />
          <div>
            XZARE<small>LABORATORY</small>
          </div>
        </div>
        <p>
          {s.settings.businessName}
          <small>معامل التحاليل</small>
        </p>
        <nav aria-label="صفحات المعمل">
          {Object.entries(pages)
            .filter(
              ([k]) =>
                (!['users', 'audit'].includes(k) || admin) &&
                (k !== 'catalog' || manager) &&
                (k !== 'results' || technical) &&
                (k !== 'reports' || finance) &&
                (k !== 'orders' || finance),
            )
            .map(([k, label]) => (
              <button key={k} className={view === k ? 'active' : ''} onClick={() => nav(k as View)}>
                {label}
              </button>
            ))}
        </nav>
        <div className="lab-session">
          <b>{s.user.name}</b>
          <small>{roles[s.user.role]}</small>
          <button
            onClick={() =>
              invoke(async () => {
                await call('logout')
                end()
              })
            }
          >
            تسجيل الخروج
          </button>
        </div>
      </aside>
      <main className="lab-workspace">
        <header className="lab-top">
          <div>
            <span className="eyebrow">XZARE LABORATORY</span>
            <h1>{pages[view]}</h1>
          </div>
          <WorkspaceClock english={false} />
          <button disabled={locked} onClick={() => invoke(load)}>
            تحديث
          </button>
        </header>
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
        {view === 'overview' && (
          <>
            <section className="lab-intro">
              <div>
                <span>مسار العينات</span>
                <h2>من الملصق إلى التقرير.</h2>
                <p>تابع العينات المفتوحة، ثم راجع النتائج المحفوظة قبل اعتمادها.</p>
              </div>
              {finance && (
                <button
                  className="primary"
                  disabled={!s.patients.some((p) => p.active) || !s.tests.some((t) => t.active)}
                  onClick={() => setNewOrder('')}
                >
                  طلب تحاليل جديد
                </button>
              )}
            </section>
            <div className="lab-pipeline">
              {Object.entries(sampleStatuses).map(([k, v]) => (
                <button
                  key={k}
                  onClick={() => {
                    setSampleFilter(k as LabSample['status'])
                    nav('samples')
                  }}
                >
                  <span>{v}</span>
                  <strong>{activeSamples.filter((x) => x.status === k).length}</strong>
                  <small>عينة</small>
                </button>
              ))}
            </div>
            <section className="lab-section">
              <div className="lab-section-head">
                <h2>الطلبات التي تنتظر التقرير</h2>
                <span>{s.orders.filter((o) => o.status === 'testing').length} طلب</span>
              </div>
              {orderTable(s.orders.filter((o) => o.status === 'testing').slice(0, 40))}
            </section>
            {!s.tests.length && manager && (
              <div className="lab-start">
                <h3>ابدأ بدليل التحاليل الفعلي</h3>
                <p>
                  أضف أسماء التحاليل، أنواع العينات، الأسعار والوحدات والمراجع المعتمدة في معملك.
                </p>
                <button
                  onClick={() => {
                    nav('catalog')
                    testForm()
                  }}
                >
                  إضافة أول تحليل
                </button>
              </div>
            )}
            {!s.patients.length && finance && (
              <div className="lab-start">
                <h3>سجّل أول مريض</h3>
                <button
                  onClick={() => {
                    nav('patients')
                    patientForm()
                  }}
                >
                  مريض جديد
                </button>
              </div>
            )}
          </>
        )}
        {view === 'orders' && (
          <section className="lab-section">
            <div className="toolbar">
              {searchBox('بحث باسم المريض أو رقم الطلب أو الملف')}
              <button
                className="primary"
                disabled={!s.patients.some((p) => p.active) || !s.tests.some((t) => t.active)}
                onClick={() => setNewOrder('')}
              >
                طلب تحاليل جديد
              </button>
            </div>
            {orderTable(filteredOrders)}
          </section>
        )}
        {view === 'samples' && (
          <section className="lab-section">
            <div className="toolbar">
              {searchBox('بحث أو مسح باركود العينة')}
              <Field label="حالة العينة">
                <select
                  value={sampleFilter}
                  onChange={(e) => setSampleFilter(e.target.value as LabSample['status'])}
                >
                  {Object.entries(sampleStatuses).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <p className="muted">
              امسح الملصق واضغط Enter لفتح الطلب. العينات المستبدلة محفوظة داخل سجل الطلب.
            </p>
            <div className="lab-sample-list">
              {activeSamples
                .filter(
                  (x) =>
                    x.status === sampleFilter &&
                    matches(x.number, x.orderNumber, x.patientName, x.patientNumber, x.specimen),
                )
                .map((x) => (
                  <article className="lab-sample" key={x.id}>
                    <div>
                      <b>{x.patientName}</b>
                      <code>{x.number}</code>
                      <small>
                        {x.specimen} · {x.orderNumber}
                      </small>
                    </div>
                    <span className={'lab-status ' + x.status}>{sampleStatuses[x.status]}</span>
                    <button onClick={() => invoke(() => openOrder(x.orderId))}>فتح العينة</button>
                  </article>
                ))}
            </div>
            {!activeSamples.some(
              (x) =>
                x.status === sampleFilter &&
                matches(x.number, x.orderNumber, x.patientName, x.patientNumber, x.specimen),
            ) && (
              <Empty>لا توجد عينات بهذه الحالة. تظهر هنا العينات الخاصة بالطلبات المفتوحة.</Empty>
            )}
          </section>
        )}
        {view === 'patients' && (
          <section className="lab-section">
            <div className="toolbar">
              {searchBox('بحث باسم المريض أو الهاتف أو باركود الملف')}
              {finance && (
                <button className="primary" onClick={() => patientForm()}>
                  مريض جديد
                </button>
              )}
            </div>
            <div className="a-scroll">
              <table>
                <thead>
                  <tr>
                    <th>المريض</th>
                    <th>رقم الملف</th>
                    <th>التواصل</th>
                    <th>الحالة</th>
                    <th>الإجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {s.patients
                    .filter((p) => matches(p.name, p.number, p.phone))
                    .map((p) => (
                      <tr key={p.id}>
                        <td>
                          <b>{p.name}</b>
                          <small>{p.birthDate || 'الميلاد غير مسجل'}</small>
                        </td>
                        <td dir="ltr">{p.number}</td>
                        <td dir="ltr">{p.phone || '—'}</td>
                        <td>{p.active ? 'نشط' : 'مؤرشف'}</td>
                        <td>
                          <div className="toolbar">
                            <button onClick={() => invoke(() => openPatient(p.id))}>
                              فتح الملف
                            </button>
                            {finance && <button onClick={() => patientForm(p)}>تعديل</button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {!s.patients.length && (
              <Empty>لا توجد ملفات مرضى. أضف بيانات المريض الفعلية عند الاستقبال.</Empty>
            )}
          </section>
        )}
        {view === 'catalog' && manager && (
          <section className="lab-section">
            <div className="toolbar">
              {searchBox('بحث في أسماء أو أكواد التحاليل')}
              <button className="primary" onClick={() => testForm()}>
                تحليل جديد
              </button>
            </div>
            <div className="a-scroll">
              <table>
                <thead>
                  <tr>
                    <th>التحليل</th>
                    <th>العينة / الوحدة</th>
                    <th>المجال المرجعي</th>
                    <th>السعر · ج.م</th>
                    <th>الحالة</th>
                    <th>تعديل</th>
                  </tr>
                </thead>
                <tbody>
                  {s.tests
                    .filter((t) => matches(t.code, t.name, t.specimen))
                    .map((t) => (
                      <tr key={t.id}>
                        <td>
                          <b>{t.name}</b>
                          <code>{t.code}</code>
                        </td>
                        <td>
                          {t.specimen}
                          <small>
                            {t.unit || 'بدون وحدة'} · {t.kind === 'number' ? 'رقمية' : 'نصية'}
                          </small>
                        </td>
                        <td>{t.reference || 'غير مسجل'}</td>
                        <td>{amount(t.price)}</td>
                        <td>{t.active ? 'نشط' : 'موقوف'}</td>
                        <td>
                          <button onClick={() => testForm(t)}>تعديل التحليل</button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {!s.tests.length && (
              <Empty>
                الدليل فارغ. أضف التحاليل الحقيقية التي يقدمها معملك؛ لن تُنشأ أسماء أو مراجع
                تلقائيًا.
              </Empty>
            )}
          </section>
        )}
        {view === 'results' && technical && (
          <section className="lab-section">
            <div className="toolbar">{searchBox('بحث في الطلبات والنتائج')}</div>
            <p>الحفظ يجهز المسودة. الاعتماد يحتاج حساب مراجع مختلفًا عن حساب مُدخل النتائج.</p>
            <div className="lab-result-inbox">
              {filteredOrders
                .filter((o) => o.status !== 'cancelled')
                .map((o) => {
                  const samples = s.samples.filter((x) => x.orderId === o.id && !x.replacedBy),
                    ready = samples.length > 0 && samples.every((x) => x.status === 'received')
                  return (
                    <article key={o.id}>
                      <div>
                        <b>{o.patient.name}</b>
                        <code>{o.number}</code>
                        <small>
                          {o.revision
                            ? 'تقرير معتمد · مراجعة ' + o.revision
                            : 'لا يوجد تقرير معتمد'}
                        </small>
                      </div>
                      <span className={'lab-status ' + o.status}>
                        {o.status === 'released'
                          ? 'معتمد'
                          : !ready
                            ? 'بانتظار العينة'
                            : o.draftChanged
                              ? 'مسودة جاهزة للمراجعة'
                              : 'بانتظار إدخال النتائج'}
                      </span>
                      <button onClick={() => invoke(() => openOrder(o.id))}>فتح النتائج</button>
                    </article>
                  )
                })}
            </div>
            {!filteredOrders.length && <Empty>تظهر هنا الطلبات بعد إنشائها من الاستقبال.</Empty>}
          </section>
        )}
        {view === 'reports' && finance && (
          <section className="lab-section">
            <div className="toolbar">
              <Field label="من تاريخ">
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </Field>
              <Field label="إلى تاريخ">
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </Field>
              <button
                disabled={!report}
                onClick={() => {
                  if (report)
                    csv('Xzare-Laboratory-Report.csv', [
                      [s.settings.businessName, from, to, report.timeZone, 'EGP'],
                      ['الإيراد', decimal(report.revenue)],
                      ['التحصيل', decimal(report.collected)],
                      ['الاسترداد', decimal(report.refunded)],
                      ['المتبقي الحالي', decimal(report.receivable)],
                      ['النوع', 'الرقم', 'التاريخ', 'المريض أو المرجع', 'المبلغ'],
                      ...report.orders.map((o) => [
                        'طلب',
                        o.number,
                        stamp(o.at),
                        o.patient.name,
                        decimal(o.total),
                      ]),
                      ...report.payments.map((p) => [
                        'تحصيل',
                        p.number,
                        stamp(p.at),
                        p.reference,
                        decimal(p.amount),
                      ]),
                      ...report.refunds.map((p) => [
                        'استرداد',
                        p.number,
                        stamp(p.at),
                        p.reference,
                        decimal(p.amount),
                      ]),
                    ])
                }}
              >
                تصدير CSV
              </button>
            </div>
            {report && (
              <>
                <p className="muted">
                  حدود اليوم بتوقيت الجهاز: {report.timeZone}. المتبقي يشمل جميع الطلبات، والمبالغ
                  بالجنيه المصري.
                </p>
                <div className="lab-metrics">
                  {[
                    ['صافي إيراد الفترة', report.revenue],
                    ['تحصيل الفترة', report.collected],
                    ['استرداد الفترة', report.refunded],
                    ['المتبقي الحالي', report.receivable],
                  ].map(([k, v]) => (
                    <article key={k}>
                      <span>{k}</span>
                      <b>{amount(Number(v))}</b>
                    </article>
                  ))}
                </div>
                <p>
                  {report.reconciled
                    ? 'الفواتير وسندات التحصيل والاسترداد متطابقة.'
                    : 'يوجد اختلاف؛ راجع مسؤول النظام.'}
                </p>
                {orderTable(report.orders)}
                <h3>سندات التحصيل والاسترداد</h3>
                <table>
                  <thead>
                    <tr>
                      <th>النوع</th>
                      <th>الطلب</th>
                      <th>التاريخ</th>
                      <th>المرجع</th>
                      <th>المبلغ · ج.م</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ...report.payments.map((p) => ({ ...p, kind: 'تحصيل' })),
                      ...report.refunds.map((p) => ({ ...p, kind: 'استرداد' })),
                    ].map((p) => (
                      <tr key={p.kind + p.id}>
                        <td>{p.kind}</td>
                        <td dir="ltr">{p.number}</td>
                        <td>{stamp(p.at)}</td>
                        <td>{p.reference}</td>
                        <td>{amount(p.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </section>
        )}
        {view === 'users' && admin && (
          <section className="lab-section">
            <div className="toolbar">
              <h2>حسابات المعمل</h2>
              <button className="primary" onClick={() => userForm()}>
                مستخدم جديد
              </button>
            </div>
            <table>
              <thead>
                <tr>
                  <th>الاسم</th>
                  <th>الحساب</th>
                  <th>الصلاحية</th>
                  <th>الحالة</th>
                  <th>تعديل</th>
                </tr>
              </thead>
              <tbody>
                {s.users.map((u) => (
                  <tr key={u.id}>
                    <td>{u.name}</td>
                    <td dir="ltr">{u.username}</td>
                    <td>{roles[u.role]}</td>
                    <td>{u.active ? 'نشط' : 'موقوف'}</td>
                    <td>
                      <button onClick={() => userForm(u)}>تعديل المستخدم</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
        {view === 'audit' && admin && (
          <section className="lab-section">
            <h2>آخر 300 عملية موثقة</h2>
            <table>
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>المستخدم</th>
                  <th>العملية</th>
                  <th>مرجع السجل</th>
                </tr>
              </thead>
              <tbody>
                {s.audit.map((a) => (
                  <tr key={a.id}>
                    <td>{stamp(a.at)}</td>
                    <td>{a.user_name || '—'}</td>
                    <td dir="ltr">{a.action}</td>
                    <td>
                      <code>{a.entity_id}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
        {view === 'settings' && (
          <section className="lab-section">
            {admin && (
              <>
                <h2>بيانات المعمل</h2>
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    const f = new FormData(e.currentTarget)
                    invoke(() =>
                      run('settings.save', {
                        businessName: String(f.get('businessName')),
                        phone: String(f.get('phone')),
                        address: String(f.get('address')),
                        receiptFooter: String(f.get('receiptFooter')),
                        taxBps: Number(s.settings.taxBps || 0),
                        language: 'ar',
                        currency: 'EGP',
                      }),
                    )
                  }}
                >
                  <fieldset disabled={locked}>
                    <Field label="اسم المعمل">
                      <input
                        name="businessName"
                        required
                        maxLength={160}
                        defaultValue={s.settings.businessName}
                      />
                    </Field>
                    <Field label="هاتف المعمل">
                      <input
                        name="phone"
                        dir="ltr"
                        maxLength={40}
                        defaultValue={s.settings.phone}
                      />
                    </Field>
                    <Field label="عنوان المعمل">
                      <input name="address" maxLength={250} defaultValue={s.settings.address} />
                    </Field>
                    <Field label="ملاحظة الفاتورة">
                      <textarea
                        name="receiptFooter"
                        maxLength={250}
                        defaultValue={s.settings.receiptFooter}
                      />
                    </Field>
                    <button className="primary">حفظ بيانات المعمل</button>
                  </fieldset>
                </form>
                <h2>النسخ الاحتياطي والاستعادة</h2>
                <p>النسخة تشمل نتائج المرضى. احفظها في مكان خاص؛ الملف غير مشفر.</p>
                <div className="toolbar">
                  <button
                    disabled={locked}
                    onClick={() =>
                      invoke(async () => {
                        setBusy(true)
                        try {
                          const r = await call<{
                            download?: string
                            fileName?: string
                            cancelled?: boolean
                          }>('backup.create')
                          if (r.download)
                            download(
                              r.fileName ?? 'Xzare-Laboratory-' + today() + '.xzbak',
                              new Blob([Uint8Array.from(atob(r.download), (c) => c.charCodeAt(0))]),
                            )
                          if (!r.cancelled) setNotice('تم إنشاء النسخة الاحتياطية')
                        } finally {
                          setBusy(false)
                        }
                      })
                    }
                  >
                    إنشاء نسخة احتياطية
                  </button>
                  <button
                    disabled={locked}
                    onClick={() =>
                      saveForm(
                        'استعادة نسخة المعمل',
                        <>
                          <p>
                            الاستعادة تستبدل البيانات الحالية وتُنهي الجلسات. استخدم نسخة تخص هذا
                            المنتج فقط.
                          </p>
                          <Field label="كلمة مرور المسؤول">
                            <input
                              name="password"
                              type="password"
                              required
                              autoComplete="current-password"
                            />
                          </Field>
                          {!window.xzare && (
                            <Field label="ملف النسخة الاحتياطية">
                              <input type="file" name="file" accept=".xzbak" required />
                            </Field>
                          )}
                        </>,
                        'backup.restore',
                        () => ({}),
                        'استعادة النسخة',
                      )
                    }
                  >
                    استعادة نسخة معمل
                  </button>
                </div>
                <LicensePanel />
              </>
            )}
            <h2>حسابك</h2>
            <button
              onClick={() =>
                saveForm(
                  'تغيير كلمة المرور',
                  <>
                    <Field label="كلمة المرور الحالية">
                      <input
                        name="currentPassword"
                        type="password"
                        required
                        autoComplete="current-password"
                      />
                    </Field>
                    <Field label="كلمة المرور الجديدة">
                      <input
                        name="newPassword"
                        type="password"
                        required
                        minLength={12}
                        maxLength={128}
                        autoComplete="new-password"
                      />
                    </Field>
                  </>,
                  'password.change',
                  (f) => ({
                    current: String(f.get('currentPassword')),
                    password: String(f.get('newPassword')),
                  }),
                )
              }
            >
              تغيير كلمة المرور
            </button>
            <p>بعد التغيير سجّل الدخول بالكلمة الجديدة.</p>
            <small dir="ltr">hello@xzare.com · +201501230440</small>
          </section>
        )}
      </main>
      {form ? (
        <Modal
          title={form.title}
          busy={locked}
          error={error}
          submit={form.submit}
          onClose={() => {
            if (!locked) {
              setForm(null)
              setError('')
            }
          }}
          onSubmit={(e) => {
            if (locked) return
            const f = new FormData(e.currentTarget)
            invoke(async () => {
              setFormSaving(true)
              try {
                if (form.action === 'backup.restore') {
                  let restored = false
                  if (window.xzare)
                    restored = !!(
                      await call<{ restored?: boolean }>('backup.restore', {
                        password: String(f.get('password')),
                      })
                    ).restored
                  else {
                    const file = f.get('file') as File
                    if (!file?.size || file.size > 128 * 1024 * 1024)
                      throw new Error('اختر نسخة صحيحة بحجم لا يزيد عن 128 ميجابايت')
                    const r = await fetch('/api/restore', {
                      method: 'POST',
                      headers: {
                        'X-Xzare-Request': '1',
                        'X-Xzare-Password': encodeURIComponent(String(f.get('password'))),
                      },
                      credentials: 'same-origin',
                      body: file,
                    })
                    const v = await r.json()
                    if (!r.ok || !v.ok) throw new Error(v.error ?? 'تعذر الاسترجاع')
                    restored = !!v.value?.restored
                  }
                  if (restored) end()
                  else setForm(null)
                } else {
                  await run(form.action, form.payload(f))
                  if (form.action === 'password.change') {
                    end()
                    setNotice('تم تغيير كلمة المرور')
                  } else if (detail) await openOrder(detail.order.id)
                  else if (history) await openPatient(history.patient.id)
                  setForm(null)
                }
              } finally {
                setFormSaving(false)
              }
            })
          }}
        >
          <fieldset disabled={locked}>{form.body}</fieldset>
        </Modal>
      ) : newOrder !== null ? (
        <OrderEditor
          patients={s.patients}
          tests={s.tests}
          patientId={newOrder}
          busy={busy}
          error={error}
          onClose={() => {
            if (!busy) setNewOrder(null)
          }}
          onCreate={async (p) => {
            const r = await run('laboratory.order.create', p)
            setNewOrder(null)
            await openOrder(r.id)
          }}
        />
      ) : detail ? (
        <OrderDetail
          key={detail.order.id}
          data={detail}
          user={s.user}
          settings={s.settings}
          busy={busy}
          error={error}
          onClose={() => {
            setDetail(null)
            setError('')
          }}
          onAction={async (a, p) => {
            await run('laboratory.' + a, p)
            await openOrder(detail.order.id)
          }}
          onSample={sampleForm}
          onReplace={(x) =>
            saveForm(
              'إعادة سحب العينة',
              <>
                <p>
                  {x.number} · {x.specimen}. العينة البديلة ستأخذ باركودًا جديدًا.
                </p>
                <Field label="سبب إعادة السحب">
                  <input name="note" required maxLength={1000} />
                </Field>
              </>,
              'laboratory.sample.replace',
              (f) => ({ id: x.id, version: x.version, note: String(f.get('note')) }),
            )
          }
          onPay={payForm}
          onCancel={cancelForm}
          onReopen={() =>
            saveForm(
              'فتح مراجعة تصحيح',
              <>
                <p>
                  التقرير السابق يظل محفوظًا. عدّل النتائج واحفظها ثم اطلب اعتمادها من مستخدم آخر.
                </p>
                <Field label="سبب التصحيح">
                  <input name="reason" required maxLength={1000} />
                </Field>
              </>,
              'laboratory.result.reopen',
              (f) => ({
                id: detail.order.id,
                version: detail.order.version,
                reason: String(f.get('reason')),
              }),
            )
          }
        />
      ) : history ? (
        <PatientView
          patient={history.patient}
          orders={history.orders}
          business={s.settings.businessName ?? ''}
          canNew={finance}
          onClose={() => setHistory(null)}
          onOrder={(id) => invoke(() => openOrder(id))}
          onNew={() => {
            setNewOrder(history.patient.id)
            setHistory(null)
          }}
        />
      ) : null}
    </div>
  )
}
