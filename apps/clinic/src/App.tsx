import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ulid } from '@xzare/core'
import type {
  Clinic,
  ClinicPatient,
  ClinicDoctor,
  ClinicService,
  ClinicAppointment,
  User,
} from '@xzare/engine'
import { AuthScreen, type AuthValues } from './AuthScreen'
import { LicensePanel } from '../../pos/src/LicensePanel'
import { WorkspaceClock } from '../../pos/src/WorkspaceClock'
import { call } from '../../pos/src/bridge'
import { useSessionActivity } from '../../pos/src/useSessionActivity'
import { Modal, Field, Empty, amount, decimal, today, csv, download } from './ui'
import {
  readMoney,
  stamp,
  clock,
  localInput,
  statuses,
  roles,
  methods,
  type State,
  type VisitDetail,
  type InvoiceDetail,
  type PatientHistory,
} from './model'
import { InvoiceEditor } from './InvoiceEditor'
import { PatientDetail, VisitEditor, InvoiceDetailView } from './ClinicDetail'
import { shiftDay, weekDays } from './calendar'
const pages = {
  overview: 'يوم العيادة',
  agenda: 'المواعيد',
  patients: 'ملفات المرضى',
  doctors: 'الأطباء',
  services: 'الخدمات والأسعار',
  visits: 'الزيارات الطبية',
  invoices: 'الفواتير والتحصيل',
  reports: 'التقارير',
  users: 'المستخدمون',
  audit: 'سجل التدقيق',
  settings: 'الإعدادات والترخيص',
}
type View = keyof typeof pages
type Form = {
  title: string
  body: ReactNode
  submit: (f: FormData) => Promise<void>
  button?: string
}
export function App() {
  const [configured, setConfigured] = useState<boolean | null>(null),
    [state, setState] = useState<State | null>(null),
    [view, setView] = useState<View>('overview'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [form, setForm] = useState<Form | null>(null),
    [search, setSearch] = useState(''),
    [day, setDay] = useState(today()),
    [doctorFilter, setDoctorFilter] = useState(''),
    [statusFilter, setStatusFilter] = useState('all'),
    [history, setHistory] = useState<PatientHistory | null>(null),
    [visit, setVisit] = useState<VisitDetail | null>(null),
    [invoice, setInvoice] = useState<InvoiceDetail | null>(null),
    [bill, setBill] = useState<ClinicAppointment | null>(null),
    [from, setFrom] = useState(today()),
    [to, setTo] = useState(today()),
    [report, setReport] = useState<ReturnType<Clinic['report']> | null>(null)
  const mutex = useRef(false),
    requests = useRef(new Map<string, string>()),
    generation = useRef(0),
    loadSeq = useRef(0)
  const end = () => {
    generation.current++
    setState(null)
    setHistory(null)
    setVisit(null)
    setInvoice(null)
    setBill(null)
    setForm(null)
    setReport(null)
    setView('overview')
    setSearch('')
    setError('')
    setNotice('')
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
      s = await call<State>('clinic.state')
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
    void call<ReturnType<Clinic['report']>>('clinic.report', { from, to })
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
      setError(e instanceof Error ? e.message : 'تعذر إتمام العملية')
      authError(e instanceof Error ? e.message : '')
    })
  }
  async function run(action: string, p: Record<string, unknown> = {}) {
    if (mutex.current) throw new Error('انتظر انتهاء العملية')
    const g = generation.current
    mutex.current = true
    setBusy(true)
    setError('')
    setNotice('')
    const command = action.startsWith('clinic.'),
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
        setError(/انتهت الجلسة|سجّل الدخول/.test(m) ? m : 'تم الحفظ؛ اضغط تحديث لقراءة العرض.')
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
  function saveForm(
    title: string,
    body: ReactNode,
    action: string,
    p: (f: FormData) => Record<string, unknown>,
    button?: string,
  ) {
    setError('')
    setForm({
      title,
      body,
      button,
      submit: async (f) => {
        await run(action, p(f))
        setForm(null)
        setInvoice(null)
        setVisit(null)
        setHistory(null)
      },
    })
  }
  function nav(v: View) {
    setView(v)
    setSearch('')
    setError('')
    setNotice('')
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
  async function openPatient(id: string) {
    const g = generation.current
    const h = await call<PatientHistory>('clinic.patient.get', { id })
    if (g === generation.current) {
      setHistory(h)
      setError('')
    }
  }
  async function openVisit(id: string) {
    const g = generation.current
    const v = await call<VisitDetail>('clinic.visit.get', { id })
    if (g === generation.current) {
      setHistory(null)
      setVisit(v)
      setError('')
    }
  }
  async function openInvoice(id: string) {
    const g = generation.current
    const i = await call<InvoiceDetail>('clinic.invoice.get', { id })
    if (g === generation.current) {
      setHistory(null)
      setInvoice(i)
      setError('')
    }
  }
  if (!state)
    return (
      <AuthScreen configured={configured} busy={busy} error={error} onAuthenticate={authenticate} />
    )
  const s = state,
    admin = s.user.role === 'admin',
    clinical = admin || s.user.role === 'doctor',
    reception = s.user.role !== 'doctor',
    manager = admin || s.user.role === 'manager',
    q = search.trim().toLowerCase()
  function patientForm(p?: ClinicPatient) {
    saveForm(
      p ? 'تعديل ملف المريض' : 'مريض جديد',
      <>
        <div className="a-form-row">
          <Field label="اسم المريض">
            <input name="name" required maxLength={160} defaultValue={p?.name ?? ''} />
          </Field>
          <Field label="رقم التواصل">
            <input name="phone" dir="ltr" type="tel" maxLength={40} defaultValue={p?.phone ?? ''} />
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
          <input name="active" type="checkbox" defaultChecked={p ? !!p.active : true} />
          ملف نشط
        </label>
        <small>
          يُنشأ رقم ملف وباركود تلقائيًا. المواعيد والزيارات السابقة تظل محفوظة عند تعديل بيانات
          التواصل.
        </small>
      </>,
      'clinic.patient.save',
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
  function doctorForm(d?: ClinicDoctor) {
    saveForm(
      d ? 'تعديل الطبيب' : 'طبيب جديد',
      <>
        <Field label="اسم الطبيب">
          <input name="name" required maxLength={160} defaultValue={d?.name ?? ''} />
        </Field>
        <Field label="التخصص">
          <input name="specialty" maxLength={160} defaultValue={d?.specialty ?? ''} />
        </Field>
        <Field label="حساب الطبيب">
          <select name="userId" disabled={!admin} defaultValue={d?.userId ?? ''}>
            <option value="">لم يُربط حساب بعد</option>
            {s.users
              .filter((u) => u.role === 'doctor' && u.active)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} · {u.username}
                </option>
              ))}
          </select>
        </Field>
        <small>
          مسؤول النظام ينشئ حسابًا بصلاحية «طبيب» من المستخدمين ويربطه هنا. الطبيب يرى الزيارات
          المسندة إليه فقط.
        </small>
        <label className="a-check">
          <input type="checkbox" name="active" defaultChecked={d ? !!d.active : true} />
          طبيب نشط
        </label>
      </>,
      'clinic.doctor.save',
      (f) => ({
        ...(d && { id: d.id, version: d.version }),
        name: String(f.get('name')),
        specialty: String(f.get('specialty')),
        userId: admin ? f.get('userId') || null : (d?.userId ?? null),
        active: f.has('active'),
      }),
    )
  }
  function serviceForm(x?: ClinicService) {
    saveForm(
      x ? 'تعديل الخدمة' : 'خدمة جديدة',
      <>
        <Field label="اسم الخدمة">
          <input name="name" required maxLength={160} defaultValue={x?.name ?? ''} />
        </Field>
        <Field label="السعر · ج.م">
          <input
            name="price"
            required
            dir="ltr"
            inputMode="decimal"
            defaultValue={x ? decimal(x.price) : ''}
          />
        </Field>
        <label className="a-check">
          <input name="active" type="checkbox" defaultChecked={x ? !!x.active : true} />
          خدمة نشطة
        </label>
        <small>تعديل السعر يؤثر على الفواتير الجديدة؛ الفواتير الصادرة تحتفظ بأسعارها.</small>
      </>,
      'clinic.service.save',
      (f) => ({
        ...(x && { id: x.id, version: x.version }),
        name: String(f.get('name')),
        price: readMoney(f.get('price')),
        active: f.has('active'),
      }),
    )
  }
  function appointmentForm(a?: ClinicAppointment, patientId?: string) {
    setHistory(null)
    saveForm(
      a ? 'تعديل الموعد' : 'حجز موعد',
      <>
        <Field label="المريض">
          <select name="patientId" required defaultValue={a?.patientId ?? patientId ?? ''}>
            <option value="">اختر المريض</option>
            {s.patients
              .filter((p) => p.active)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.number}
                </option>
              ))}
          </select>
        </Field>
        <Field label="الطبيب">
          <select name="doctorId" required defaultValue={a?.doctorId ?? doctorFilter}>
            <option value="">اختر الطبيب</option>
            {s.doctors
              .filter((d) => d.active)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} · {d.specialty}
                </option>
              ))}
          </select>
        </Field>
        <div className="a-form-row">
          <Field label="تاريخ ووقت الموعد">
            <input
              name="start"
              type="datetime-local"
              required
              defaultValue={
                a ? localInput(a.start) : day + 'T' + localInput(Date.now() + 15 * 60000).slice(11)
              }
            />
          </Field>
          <Field label="مدة الموعد بالدقائق">
            <input
              name="duration"
              type="number"
              min="5"
              max="480"
              step="1"
              required
              defaultValue={a?.duration ?? 30}
            />
          </Field>
        </div>
        <Field label="سبب الموعد الإداري">
          <input name="reason" maxLength={250} defaultValue={a?.reason ?? ''} />
        </Field>
        <small>
          اكتب سببًا عامًا ظاهرًا للاستقبال؛ الملاحظات الطبية تُكتب داخل الزيارة الخاصة. يُمنع تداخل
          أوقات الطبيب أو المريض.
        </small>
      </>,
      'clinic.appointment.save',
      (f) => ({
        ...(a && { id: a.id, version: a.version }),
        patientId: String(f.get('patientId')),
        doctorId: String(f.get('doctorId')),
        start: new Date(String(f.get('start'))).getTime(),
        duration: Number(f.get('duration')),
        reason: String(f.get('reason')),
      }),
    )
  }
  function changeStatus(a: ClinicAppointment, status: 'checked_in' | 'cancelled' | 'no_show') {
    saveForm(
      status === 'checked_in'
        ? 'تسجيل حضور المريض'
        : status === 'cancelled'
          ? 'إلغاء الموعد'
          : 'تسجيل عدم الحضور',
      <>
        <p>
          {a.patientName} · {a.doctorName} · {stamp(a.start)}
        </p>
        <Field label="الملاحظة">
          <input name="note" required maxLength={1000} />
        </Field>
      </>,
      'clinic.appointment.status',
      (f) => ({ id: a.id, version: a.version, status, note: String(f.get('note')) }),
      'تأكيد الحالة',
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
            <option value="cashier">الاستقبال والتحصيل: مرضى ومواعيد وفواتير</option>
            <option value="doctor">طبيب: زيارات وملاحظات المرضى المسندين إليه</option>
            <option value="manager">مدير العيادة: استقبال وأطباء وخدمات، دون ملاحظات طبية</option>
            <option value="admin">مسؤول النظام: جميع العمليات والإدارة</option>
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
  function paymentForm() {
    if (!invoice) return
    const i = invoice.invoice
    saveForm(
      'تحصيل دفعة',
      <>
        <p>
          {i.number} · {i.patient.name} · المتبقي {amount(i.balance)} ج.م
        </p>
        <Field label="المبلغ · ج.م">
          <input
            required
            name="amount"
            dir="ltr"
            inputMode="decimal"
            defaultValue={decimal(i.balance)}
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
      'clinic.invoice.pay',
      (f) => ({
        id: i.id,
        amount: readMoney(f.get('amount')),
        method: String(f.get('method')),
        reference: String(f.get('reference')),
      }),
      'حفظ سند التحصيل',
    )
  }
  function voidForm() {
    if (!invoice) return
    const i = invoice.invoice
    saveForm(
      'إلغاء الفاتورة ورد المحصّل',
      <>
        <p>
          سيُحفظ إلغاء مستقل للفاتورة {i.number} ويُسجل رد كامل المحصّل: <b>{amount(i.paid)} ج.م</b>
          .
        </p>
        <Field label="سبب الإلغاء">
          <textarea name="note" required maxLength={1000} />
        </Field>
        <Field label="طريقة رد المبلغ">
          <select name="method">
            {Object.entries(methods).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="مرجع الاسترداد أو الإلغاء">
          <input name="reference" required maxLength={1000} />
        </Field>
        <small>تأكد من تسليم المبلغ فعليًا قبل تأكيد السند. الأصل والتحصيل يظلان محفوظين.</small>
      </>,
      'clinic.invoice.void',
      (f) => ({
        id: i.id,
        note: String(f.get('note')),
        method: String(f.get('method')),
        reference: String(f.get('reference')),
      }),
      'تأكيد الإلغاء والاسترداد',
    )
  }
  async function backup() {
    const v = await call<{ download?: string; fileName?: string; cancelled?: boolean }>(
      'backup.create',
    )
    if (v.download)
      download(
        v.fileName ?? 'Xzare-Clinic.xzbak',
        new Blob([Uint8Array.from(atob(v.download), (c) => c.charCodeAt(0))]),
      )
    if (!v.cancelled) setNotice('تم إنشاء النسخة الاحتياطية')
  }
  function restore() {
    setForm({
      title: 'استعادة نسخة عيادات',
      button: 'تأكيد الاستعادة',
      body: (
        <>
          <p>
            تستبدل بيانات العيادة وتُنهي الجلسات. أنشئ نسخة احتياطية أولًا. تُقبل نسخ Xzare Clinic
            المطابقة فقط.
          </p>
          {!window.xzare && (
            <Field label="ملف النسخة">
              <input type="file" name="file" required accept=".xzbak" />
            </Field>
          )}
          <Field label="كلمة مرور المسؤول">
            <input name="password" type="password" required autoComplete="current-password" />
          </Field>
        </>
      ),
      submit: async (f) => {
        if (mutex.current) return
        mutex.current = true
        setBusy(true)
        setError('')
        try {
          let restored = false
          if (window.xzare)
            restored = !!(
              await call<{ restored?: boolean }>('backup.restore', {
                password: String(f.get('password')),
              })
            ).restored
          else {
            const r = await fetch('/api/restore', {
                method: 'POST',
                headers: {
                  'X-Xzare-Request': '1',
                  'X-Xzare-Password': encodeURIComponent(String(f.get('password'))),
                },
                credentials: 'same-origin',
                body: f.get('file') as File,
              }),
              v = await r.json()
            if (!r.ok || !v.ok) throw new Error(v.error ?? 'تعذر الاسترجاع')
            restored = !!v.value?.restored
          }
          if (restored) end()
          else setForm(null)
        } catch (e) {
          setError(e instanceof Error ? e.message : 'تعذر الاسترجاع')
        } finally {
          mutex.current = false
          setBusy(false)
        }
      },
    })
  }
  const patients = s.patients.filter((p) =>
      (p.name + ' ' + p.number + ' ' + p.phone).toLowerCase().includes(q),
    ),
    appointments = s.appointments.filter(
      (a) =>
        (!doctorFilter || a.doctorId === doctorFilter) &&
        (statusFilter === 'all' || a.status === statusFilter) &&
        (a.patientName + ' ' + a.patientNumber + ' ' + a.number + ' ' + a.doctorName)
          .toLowerCase()
          .includes(q),
    ),
    daily = appointments.filter((a) => localInput(a.start).slice(0, 10) === day),
    invoices = s.invoices.filter((i) =>
      (i.number + ' ' + i.patient.name + ' ' + i.patient.number).toLowerCase().includes(q),
    )
  const appointmentActions = (a: ClinicAppointment) => (
    <div className="clinic-actions">
      {reception && a.status === 'scheduled' && (
        <>
          <button
            disabled={busy || a.start > Date.now() + 3600000}
            onClick={() => changeStatus(a, 'checked_in')}
          >
            تسجيل الحضور
          </button>
          <button disabled={busy} onClick={() => appointmentForm(a)}>
            تعديل الموعد
          </button>
          <button
            disabled={busy || Date.now() < a.start + a.duration * 60000}
            onClick={() => changeStatus(a, 'no_show')}
          >
            لم يحضر
          </button>
          <button disabled={busy} onClick={() => changeStatus(a, 'cancelled')}>
            إلغاء
          </button>
        </>
      )}
      {clinical && a.status === 'checked_in' && (
        <button
          className="primary"
          disabled={busy}
          onClick={() =>
            invoke(async () => {
              const v = await run('clinic.visit.open', { appointmentId: a.id })
              await openVisit(v.id)
            })
          }
        >
          بدء الزيارة
        </button>
      )}
      {clinical && a.visitId && (
        <button disabled={busy} onClick={() => invoke(() => openVisit(a.visitId!))}>
          فتح الزيارة
        </button>
      )}
      {reception && !a.invoiceId && !['cancelled', 'no_show'].includes(a.status) && (
        <button disabled={busy} onClick={() => setBill(a)}>
          إصدار فاتورة
        </button>
      )}
      {reception && a.invoiceId && (
        <button disabled={busy} onClick={() => invoke(() => openInvoice(a.invoiceId!))}>
          الفاتورة
        </button>
      )}
      {reception && a.status === 'checked_in' && !a.visitId && (
        <button disabled={busy} onClick={() => changeStatus(a, 'cancelled')}>
          إلغاء
        </button>
      )}
    </div>
  )
  const invoiceTable = (rows: State['invoices']) => (
    <div className="a-scroll">
      <table>
        <thead>
          <tr>
            <th>الفاتورة / التاريخ</th>
            <th>المريض</th>
            <th>الإجمالي · ج.م</th>
            <th>المحصّل</th>
            <th>المتبقي</th>
            <th>الحالة</th>
            <th>فتح</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((i) => (
            <tr key={i.id}>
              <td>
                <b dir="ltr">{i.number}</b>
                <small>{stamp(i.at)}</small>
              </td>
              <td>
                {i.patient.name}
                <small dir="ltr">{i.patient.number}</small>
              </td>
              <td>{amount(i.total)}</td>
              <td>{amount(i.paid)}</td>
              <td>{amount(i.balance)}</td>
              <td>
                <span className="clinic-status">
                  {i.voided ? 'ملغاة' : i.balance ? 'متبقي للتحصيل' : 'مسددة'}
                </span>
              </td>
              <td>
                <button disabled={busy} onClick={() => invoke(() => openInvoice(i.id))}>
                  فتح الفاتورة
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <Empty>لم تصدر فواتير بهذه الفترة. أصدر فاتورة من الموعد.</Empty>}
    </div>
  )
  function exportReport() {
    if (!report) return
    csv('Xzare-Clinic-Report.csv', [
      [s.settings.businessName, from, to, report.timeZone, 'EGP'],
      ['صافي إيراد الفترة', decimal(report.revenue)],
      ['تحصيل الفترة', decimal(report.collected)],
      ['استرداد الفترة', decimal(report.refunded)],
      ['المتبقي الحالي لكل الفواتير', decimal(report.receivable)],
      ['النوع', 'الرقم', 'التاريخ', 'المريض/مرجع السند', 'المبلغ', 'طريقة الدفع'],
      ...report.invoices.map((i) => [
        'فاتورة',
        i.number,
        stamp(i.at),
        i.patient.name,
        decimal(i.total),
        i.voided ? 'ملغاة' : 'صادرة',
      ]),
      ...report.payments.map((p) => [
        'تحصيل',
        p.number,
        stamp(p.at),
        p.reference,
        decimal(p.amount),
        p.method,
      ]),
      ...report.refunds.map((p) => [
        'إلغاء واسترداد',
        p.number,
        stamp(p.at),
        p.reference,
        decimal(p.amount),
        p.method,
      ]),
    ])
  }
  const visible = (Object.keys(pages) as View[]).filter(
    (v) =>
      (!['users', 'audit'].includes(v) || admin) &&
      (!['doctors', 'services'].includes(v) || manager) &&
      (!['invoices', 'reports'].includes(v) || reception) &&
      (v !== 'visits' || clinical),
  )
  return (
    <div className="clinic-app">
      <aside className="clinic-sidebar">
        <div className="clinic-brand">
          <img src="./icon.svg" alt="" />
          <div>
            XZARE<small>CLINIC</small>
          </div>
        </div>
        <p className="clinic-business">
          {s.settings.businessName}
          <small>عيادات ومراكز طبية</small>
        </p>
        <nav aria-label="صفحات العيادة">
          {visible.map((v) => (
            <button
              key={v}
              aria-current={view === v ? 'page' : undefined}
              className={view === v ? 'active' : ''}
              onClick={() => nav(v)}
            >
              {pages[v]}
            </button>
          ))}
        </nav>
        <div className="clinic-session">
          <b>{s.user.name}</b>
          <small>{roles[s.user.role]}</small>
          <button
            disabled={busy}
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
      <main className="clinic-main">
        <header className="clinic-top">
          <div>
            <span className="eyebrow">XZARE CLINIC</span>
            <h1>{pages[view]}</h1>
          </div>
          <div className="toolbar">
            <WorkspaceClock english={false} />
            <button disabled={busy} onClick={() => invoke(load)}>
              تحديث
            </button>
            {reception && ['overview', 'agenda'].includes(view) && (
              <button className="primary" disabled={busy} onClick={() => appointmentForm()}>
                حجز موعد
              </button>
            )}
          </div>
        </header>
        {error && !form && !visit && !bill && (
          <p className="alert error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="clinic-notice" role="status">
            {notice}
          </p>
        )}
        {['overview', 'agenda'].includes(view) && (
          <>
            <div className="clinic-calendar" aria-label="تقويم مواعيد الأسبوع">
              <div className="clinic-calendar-head">
                <div><span>أسبوع العيادة</span><h2>{new Date(day + 'T12:00:00').toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' })}</h2></div>
                <div className="toolbar">
                  <button type="button" aria-label="الأسبوع السابق" onClick={() => setDay(shiftDay(day, -7))}>الأسبوع السابق</button>
                  <button type="button" onClick={() => setDay(today())}>اليوم</button>
                  <button type="button" aria-label="الأسبوع التالي" onClick={() => setDay(shiftDay(day, 7))}>الأسبوع التالي</button>
                </div>
              </div>
              <div className="clinic-week">
                {weekDays(day).map((date) => {
                  const count = appointments.filter((appointment) => localInput(appointment.start).slice(0, 10) === date).length
                  return <button type="button" key={date} className={date === day ? 'selected' : ''} aria-pressed={date === day} onClick={() => setDay(date)}>
                    <span>{new Date(date + 'T12:00:00').toLocaleDateString('ar-EG', { weekday: 'short' })}</span>
                    <strong>{Number(date.slice(-2)).toLocaleString('ar-EG')}</strong>
                    <small>{count ? `${count} موعد` : 'لا توجد مواعيد'}</small>
                  </button>
                })}
              </div>
            </div>
            <div className="clinic-daybar">
              <Field label="اليوم">
                <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
              </Field>
              <Field label="الطبيب">
                <select value={doctorFilter} onChange={(e) => setDoctorFilter(e.target.value)}>
                  <option value="">كل الأطباء</option>
                  {s.doctors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="الحالة">
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="all">كل الحالات</option>
                  {Object.entries(statuses).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="بحث في المواعيد">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="المريض، الملف أو رقم الموعد"
                />
              </Field>
            </div>
            {view === 'overview' && (
              <div className="clinic-kpis">
                <article>
                  <span>مواعيد اليوم</span>
                  <strong>{daily.length}</strong>
                  <small>من حجوزاتك الفعلية</small>
                </article>
                <article>
                  <span>في الانتظار</span>
                  <strong>{daily.filter((a) => a.status === 'checked_in').length}</strong>
                  <small>حضور مسجل ولم تبدأ الزيارة</small>
                </article>
                <article>
                  <span>زيارات اليوم المكتملة</span>
                  <strong>{daily.filter((a) => a.status === 'completed').length}</strong>
                  <small>زيارة معتمدة ومحفوظة</small>
                </article>
                {reception && (
                  <article>
                    <span>متبقي للتحصيل</span>
                    <strong>{amount(s.invoices.reduce((n, i) => n + i.balance, 0))}</strong>
                    <small>ج.م · كل الفواتير المفتوحة</small>
                  </article>
                )}
              </div>
            )}
            <section className="clinic-panel">
              <div className="clinic-panel-head">
                <h2>
                  جدول{' '}
                  {new Date(day + 'T12:00:00').toLocaleDateString('ar-EG', { dateStyle: 'full' })}
                </h2>
                <span>{daily.length} موعد</span>
              </div>
              {!daily.length ? (
                <Empty>
                  لا توجد مواعيد لهذا اليوم.{' '}
                  {reception ? 'أضف المريض والطبيب ثم احجز الموعد.' : 'تظهر هنا مواعيدك المسندة.'}
                </Empty>
              ) : (
                <div className="clinic-agenda">
                  {daily.map((a) => (
                    <article className={'clinic-slot ' + a.status} key={a.id}>
                      <div className="clinic-time">
                        <b>{clock(a.start)}</b>
                        <small>{a.duration} دقيقة</small>
                      </div>
                      <div className="clinic-slot-info">
                        <span className="clinic-status">{statuses[a.status]}</span>
                        <h3>{a.patientName}</h3>
                        <p>
                          {a.doctorName}
                          <span dir="ltr">
                            {a.patientNumber} · {a.number}
                          </span>
                        </p>
                        {a.reason && <small>{a.reason}</small>}
                        {appointmentActions(a)}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
        {view === 'patients' && (
          <section className="clinic-panel">
            <div className="clinic-panel-head">
              <h2>{s.patients.length} ملف مريض</h2>
              {reception && (
                <button className="primary" disabled={busy} onClick={() => patientForm()}>
                  مريض جديد
                </button>
              )}
            </div>
            <Field label="بحث أو مسح باركود ملف المريض">
              <input
                dir="auto"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && patients.length === 1)
                    invoke(() => openPatient(patients[0]!.id))
                }}
                placeholder="الاسم، رقم الملف أو الهاتف؛ Enter لفتح نتيجة واحدة"
              />
            </Field>
            <div className="a-scroll">
              <table>
                <thead>
                  <tr>
                    <th>رقم الملف</th>
                    <th>المريض</th>
                    <th>التواصل</th>
                    <th>الحالة</th>
                    <th>الإجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {patients.map((p) => (
                    <tr key={p.id}>
                      <td dir="ltr">{p.number}</td>
                      <td>{p.name}</td>
                      <td dir="ltr">{p.phone || '—'}</td>
                      <td>{p.active ? 'نشط' : 'مؤرشف'}</td>
                      <td>
                        <div className="clinic-actions">
                          <button disabled={busy} onClick={() => invoke(() => openPatient(p.id))}>
                            فتح الملف
                          </button>
                          {reception && (
                            <>
                              <button disabled={busy} onClick={() => patientForm(p)}>
                                تعديل
                              </button>
                              <button
                                disabled={busy || !p.active}
                                onClick={() => appointmentForm(undefined, p.id)}
                              >
                                حجز موعد
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!patients.length && (
                <Empty>لا توجد ملفات مطابقة. أضف المريض ببياناته الفعلية.</Empty>
              )}
            </div>
          </section>
        )}
        {view === 'doctors' && (
          <section className="clinic-panel">
            <div className="clinic-panel-head">
              <h2>الأطباء والتخصصات</h2>
              <button className="primary" disabled={busy} onClick={() => doctorForm()}>
                طبيب جديد
              </button>
            </div>
            <div className="clinic-doctor-grid">
              {s.doctors.map((d) => (
                <article className="clinic-doctor" key={d.id}>
                  <span className="clinic-doctor-symbol">+</span>
                  <h3>{d.name}</h3>
                  <p>{d.specialty || 'التخصص غير مسجل'}</p>
                  <small>
                    {d.active ? 'نشط' : 'متوقف'} ·{' '}
                    {d.userId ? 'حساب طبيب مرتبط' : 'حساب الطبيب غير مرتبط'}
                  </small>
                  <button disabled={busy} onClick={() => doctorForm(d)}>
                    تعديل الطبيب
                  </button>
                </article>
              ))}
            </div>
            {!s.doctors.length && <Empty>أضف الأطباء ثم اربط حساب كل طبيب من المستخدمين.</Empty>}
          </section>
        )}
        {view === 'services' && (
          <section className="clinic-panel">
            <div className="clinic-panel-head">
              <h2>الخدمات والأسعار الفعلية</h2>
              <button className="primary" disabled={busy} onClick={() => serviceForm()}>
                خدمة جديدة
              </button>
            </div>
            <div className="a-scroll">
              <table>
                <thead>
                  <tr>
                    <th>الخدمة</th>
                    <th>السعر · ج.م</th>
                    <th>الحالة</th>
                    <th>الإجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {s.services.map((x) => (
                    <tr key={x.id}>
                      <td>{x.name}</td>
                      <td>{amount(x.price)}</td>
                      <td>{x.active ? 'نشطة' : 'متوقفة'}</td>
                      <td>
                        <button disabled={busy} onClick={() => serviceForm(x)}>
                          تعديل الخدمة
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!s.services.length && <Empty>أضف الخدمات والأسعار قبل إصدار أول فاتورة.</Empty>}
            </div>
          </section>
        )}
        {view === 'visits' && (
          <section className="clinic-panel">
            <div className="clinic-panel-head">
              <h2>الزيارات الطبية الخاصة</h2>
              <span>قراءة الملاحظات تُسجل في التدقيق</span>
            </div>
            <p className="muted">
              ابدأ الزيارة من الموعد بعد تسجيل حضور المريض. تظهر المسودات والزيارات المعتمدة المسموح
              لك بها.
            </p>
            <div className="a-scroll">
              <table>
                <thead>
                  <tr>
                    <th>المريض / الملف</th>
                    <th>الطبيب</th>
                    <th>بداية الزيارة</th>
                    <th>الحالة</th>
                    <th>فتح</th>
                  </tr>
                </thead>
                <tbody>
                  {s.visits.map((v) => (
                    <tr key={v.id}>
                      <td>
                        {v.patientName}
                        <small dir="ltr">{v.patientNumber}</small>
                      </td>
                      <td>{v.doctorName}</td>
                      <td>{stamp(v.openedAt)}</td>
                      <td>{v.finalizedAt ? 'معتمدة' : 'مسودة'}</td>
                      <td>
                        <button disabled={busy} onClick={() => invoke(() => openVisit(v.id))}>
                          فتح الزيارة
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!s.visits.length && <Empty>لم تُفتح زيارات حتى الآن. ابدأ من جدول المواعيد.</Empty>}
            </div>
          </section>
        )}
        {view === 'invoices' && (
          <section className="clinic-panel">
            <div className="clinic-panel-head">
              <h2>الفواتير والتحصيل</h2>
              <span>{s.reconciled ? 'السجل متطابق' : 'راجع السجل المالي'}</span>
            </div>
            <Field label="بحث الفواتير">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="الفاتورة أو المريض أو الملف"
              />
            </Field>
            {invoiceTable(invoices)}
          </section>
        )}
        {view === 'reports' && (
          <>
            <section className="clinic-panel">
              <div className="clinic-panel-head">
                <h2>حركة العيادة في الفترة</h2>
                <button disabled={!report || busy} onClick={exportReport}>
                  تصدير CSV
                </button>
              </div>
              <div className="a-form-row">
                <Field label="من تاريخ">
                  <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                </Field>
                <Field label="إلى تاريخ">
                  <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                </Field>
              </div>
              {report && (
                <>
                  <small>
                    حدود اليوم بتوقيت الجهاز: {report.timeZone}. الإيراد يُخصم منه الإلغاء بتاريخ
                    الإلغاء؛ المبالغ كلها بالجنيه المصري.
                  </small>
                  <div className="clinic-kpis">
                    <article>
                      <span>صافي إيراد الفترة</span>
                      <strong>{amount(report.revenue)}</strong>
                    </article>
                    <article>
                      <span>تحصيل الفترة</span>
                      <strong>{amount(report.collected)}</strong>
                    </article>
                    <article>
                      <span>استرداد الفترة</span>
                      <strong>{amount(report.refunded)}</strong>
                    </article>
                    <article>
                      <span>المتبقي الحالي لكل الفواتير</span>
                      <strong>{amount(report.receivable)}</strong>
                    </article>
                  </div>
                  <p className={report.reconciled ? 'clinic-notice' : 'alert error'}>
                    {report.reconciled
                      ? 'الفواتير والخدمات والتحصيل والاسترداد متطابقة.'
                      : 'تحتاج بيانات السجل المالي إلى مراجعة.'}
                  </p>
                  <div className="clinic-report-statuses">
                    {report.appointments.map((a) => (
                      <span key={a.status}>
                        {statuses[a.status as keyof typeof statuses]} <b>{a.count}</b>
                      </span>
                    ))}
                  </div>
                  {invoiceTable(report.invoices)}
                  <h3>سندات التحصيل والاسترداد</h3>
                  <div className="a-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>النوع</th>
                          <th>الفاتورة</th>
                          <th>التاريخ</th>
                          <th>المرجع</th>
                          <th>المبلغ · ج.م</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.payments.map((p) => (
                          <tr key={p.id}>
                            <td>تحصيل</td>
                            <td>{p.number}</td>
                            <td>{stamp(p.at)}</td>
                            <td>{p.reference}</td>
                            <td>{amount(p.amount)}</td>
                          </tr>
                        ))}
                        {report.refunds.map((p) => (
                          <tr key={p.id}>
                            <td>إلغاء واسترداد</td>
                            <td>{p.number}</td>
                            <td>{stamp(p.at)}</td>
                            <td>{p.reference}</td>
                            <td>{amount(p.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>
          </>
        )}
        {view === 'users' && (
          <section className="clinic-panel">
            <div className="clinic-panel-head">
              <h2>حسابات وصلاحيات المستخدمين</h2>
              <button className="primary" disabled={busy} onClick={() => userForm()}>
                مستخدم جديد
              </button>
            </div>
            <p className="muted">
              الاستقبال ومدير العيادة لا يقرآن الملاحظات الطبية. اربط حساب الطبيب بملفه من شاشة
              الأطباء.
            </p>
            <div className="a-scroll">
              <table>
                <thead>
                  <tr>
                    <th>الاسم</th>
                    <th>اسم المستخدم</th>
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
                      <td>{u.active ? 'نشط' : 'متوقف'}</td>
                      <td>
                        <button disabled={busy} onClick={() => userForm(u)}>
                          تعديل المستخدم
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
        {view === 'audit' && (
          <section className="clinic-panel">
            <h2>سجل العمليات وقراءة الزيارات</h2>
            <div className="a-scroll">
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
                      <td>{a.user_name ?? 'محاولة دخول'}</td>
                      <td dir="ltr">{a.action}</td>
                      <td dir="ltr">{a.entity_id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
        {view === 'settings' && (
          <>
            <section className="clinic-panel">
              <h2>بيانات العيادة</h2>
              {admin ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    const f = new FormData(e.currentTarget)
                    invoke(() =>
                      run('settings.save', {
                        businessName: String(f.get('businessName')),
                        phone: String(f.get('phone')),
                        address: String(f.get('address')),
                        currency: 'EGP',
                        language: 'ar',
                        receiptFooter: String(f.get('receiptFooter')),
                        taxBps: 0,
                      }),
                    )
                  }}
                >
                  <div className="a-form-row">
                    <Field label="اسم العيادة">
                      <input
                        name="businessName"
                        required
                        maxLength={160}
                        defaultValue={s.settings.businessName}
                      />
                    </Field>
                    <Field label="هاتف العيادة">
                      <input
                        name="phone"
                        dir="ltr"
                        maxLength={40}
                        defaultValue={s.settings.phone}
                      />
                    </Field>
                  </div>
                  <Field label="عنوان العيادة">
                    <input name="address" maxLength={250} defaultValue={s.settings.address} />
                  </Field>
                  <Field label="ملاحظة الفاتورة">
                    <input
                      name="receiptFooter"
                      maxLength={250}
                      defaultValue={s.settings.receiptFooter}
                    />
                  </Field>
                  <button className="primary" disabled={busy}>
                    حفظ بيانات العيادة
                  </button>
                </form>
              ) : (
                <p>{s.settings.businessName}</p>
              )}
            </section>
            {admin && (
              <>
                <section className="clinic-panel">
                  <h2>النسخ الاحتياطي والاستعادة</h2>
                  <p className="muted">
                    النسخة تشمل ملفات المرضى والزيارات. احفظها في مكان خاص بمسؤول العيادة.
                  </p>
                  <div className="toolbar">
                    <button disabled={busy} onClick={() => invoke(backup)}>
                      إنشاء نسخة احتياطية
                    </button>
                    <button disabled={busy} onClick={restore}>
                      استعادة نسخة عيادات
                    </button>
                  </div>
                </section>
                <section className="clinic-panel">
                  <LicensePanel />
                </section>
              </>
            )}
            <section className="clinic-panel">
              <h2>حسابك</h2>
              <button
                disabled={busy}
                onClick={() =>
                  saveForm(
                    'تغيير كلمة المرور',
                    <>
                      <Field label="كلمة المرور الحالية">
                        <input
                          name="current"
                          required
                          type="password"
                          autoComplete="current-password"
                        />
                      </Field>
                      <Field label="كلمة المرور الجديدة">
                        <input
                          name="password"
                          required
                          type="password"
                          minLength={12}
                          maxLength={128}
                          autoComplete="new-password"
                        />
                      </Field>
                    </>,
                    'password.change',
                    (f) => ({
                      current: String(f.get('current')),
                      password: String(f.get('password')),
                    }),
                  )
                }
              >
                تغيير كلمة المرور
              </button>
              <small>بعد التغيير سجّل الدخول بكلمة المرور الجديدة.</small>
              <p className="clinic-support" dir="ltr">
                hello@xzare.com · +201501230440
              </p>
            </section>
          </>
        )}
      </main>
      {form && (
        <Modal
          title={form.title}
          busy={busy}
          error={error}
          onClose={() => setForm(null)}
          submit={form.button}
          onSubmit={(e) => {
            const f = new FormData(e.currentTarget)
            invoke(() => form.submit(f))
          }}
        >
          {form.body}
        </Modal>
      )}
      {history && !form && (
        <PatientDetail
          data={history}
          business={s.settings.businessName ?? ''}
          onClose={() => setHistory(null)}
          onAppointment={() => appointmentForm(undefined, history.patient.id)}
          onVisit={(id) => invoke(() => openVisit(id))}
          onInvoice={(id) => invoke(() => openInvoice(id))}
          canClinical={clinical}
          canReception={reception}
        />
      )}
      {visit && !form && (
        <VisitEditor
          key={visit.visit.id + ':' + visit.visit.version}
          data={visit}
          busy={busy}
          error={error}
          onClose={() => setVisit(null)}
          onSave={async (p) => {
            await run('clinic.visit.save', p)
            await openVisit(visit.visit.id)
          }}
          onFinalize={() =>
            saveForm(
              'اعتماد الزيارة',
              <p>
                سيُثبت التقييم والخطة المحفوظان للمريض {visit.patient.name}. أي تصحيح لاحق يُحفظ
                كإضافة مستقلة.
              </p>,
              'clinic.visit.finalize',
              () => ({ id: visit.visit.id, version: visit.visit.version }),
              'اعتماد الزيارة',
            )
          }
          onAddendum={() =>
            saveForm(
              'إضافة للزيارة المعتمدة',
              <>
                <Field label="سبب الإضافة">
                  <input name="reason" required maxLength={1000} />
                </Field>
                <Field label="نص الإضافة">
                  <textarea name="note" required rows={5} maxLength={6000} />
                </Field>
              </>,
              'clinic.visit.addendum',
              (f) => ({
                id: visit.visit.id,
                reason: String(f.get('reason')),
                note: String(f.get('note')),
              }),
              'حفظ الإضافة',
            )
          }
        />
      )}
      {bill && !form && (
        <InvoiceEditor
          appointment={bill}
          services={s.services}
          busy={busy}
          error={error}
          onClose={() => setBill(null)}
          onSave={async (p) => {
            const i = await run('clinic.invoice.post', p)
            setBill(null)
            await openInvoice(i.id)
          }}
        />
      )}
      {invoice && !form && (
        <InvoiceDetailView
          data={invoice}
          business={s.settings.businessName ?? ''}
          phone={s.settings.phone ?? ''}
          address={s.settings.address ?? ''}
          footer={s.settings.receiptFooter ?? ''}
          onClose={() => setInvoice(null)}
          onPay={paymentForm}
          onVoid={voidForm}
          admin={admin}
        />
      )}
    </div>
  )
}
