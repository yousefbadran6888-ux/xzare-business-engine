import { useState, useEffect, useRef, type ReactNode } from 'react'
import { ulid } from '@xzare/core'
import type {
  EduState,
  EduGroup,
  EduStudent,
  EduEnrollment,
  EduPayment,
  EduSessionDetail,
  EduExamDetail,
  EduEnrollmentDetail,
  EduReport,
  User,
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
  studentForm,
  teacherForm,
  courseForm,
  groupForm,
  enrollmentForm,
  academicForm,
  text,
  type EduForm,
} from './Forms'
import { roles, methods, ledgerLabels, stamp, clock } from './model'
import { Attendance, Grades, History } from './Academic'
import { ScopeGate, visible } from './scope'
import { refreshReceipt } from './receipt-refresh'
import { exclusive } from './exclusive'
const pages = {
  today: 'جدول اليوم',
  students: 'الطلاب',
  groups: 'المجموعات',
  masters: 'الدورات والمدرسون',
  fees: 'الرسوم والإيصالات',
  exams: 'الاختبارات',
  reports: 'التقارير',
  users: 'المستخدمون',
  audit: 'سجل التدقيق',
  settings: 'الإعدادات والترخيص',
}
type View = keyof typeof pages
type Detail =
  | { kind: 'session'; id: string; groupId: string; data: EduSessionDetail }
  | { kind: 'exam'; id: string; groupId: string; data: EduExamDetail }
  | {
      kind: 'enrollment'
      id: string
      groupId: string
      data: EduEnrollmentDetail
    }
  | {
      kind: 'student'
      id: string
      groupId?: never
      data: {
        student: EduStudent
        enrollments: EduEnrollment[]
        events: EduSessionDetail['events']
      }
    }
  | {
      kind: 'group'
      id: string
      groupId: string
      data: {
        group: EduGroup
        enrollments: EduEnrollment[]
        events: EduSessionDetail['events']
      }
    }
export function App() {
  const [configured, setConfigured] = useState<boolean | null>(null),
    [s, setState] = useState<EduState | null>(null),
    [view, setView] = useState<View>('today'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [query, setQuery] = useState(''),
    [form, setForm] = useState<EduForm | null>(null),
    [detail, setDetail] = useState<Detail | null>(null),
    [receipt, setReceipt] = useState<EduPayment | null>(null),
    [day, setDay] = useState(today()),
    [from, setFrom] = useState(today().slice(0, 7) + '-01'),
    [to, setTo] = useState(today()),
    [report, setReport] = useState<EduReport | null>(null)
  const gate = useRef(new ScopeGate()),
    mutex = useRef(false),
    generation = useRef(0),
    loadSeq = useRef(0),
    scope = useRef<EduState | null>(null),
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
    setView('today')
    setQuery('')
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
  useSessionActivity(!!s, end)
  const detailVisible = (v: EduState, d: Detail) =>
    d.kind === 'student'
      ? visible(v, 'student', d.id)
      : visible(v, 'group', d.groupId)
  async function load() {
    const g = generation.current,
      n = ++loadSeq.current,
      v = await call<EduState>('edu.state')
    if (g !== generation.current || n !== loadSeq.current) return
    if (gate.current.update(v)) {
      setForm(null)
      setReceipt(null)
      setDetail(null)
      setReport(null)
    }
    scope.current = v
    setState(v)
    setDetail((d) => (d && detailVisible(v, d) ? d : null))
    setReceipt((p) => {
      if (!p || v.user.role === 'teacher') return null
      const e = v.enrollments.find((x) => x.id === p.enrollmentId)
      return e ? refreshReceipt(p, v.payments) : null
    })
  }
  useEffect(() => {
    void call<{ configured: boolean }>('auth.status')
      .then((x) => {
        setConfigured(x.configured)
        if (x.configured) void load().catch(() => {})
      })
      .catch((e) => setError(e.message))
  }, [])
  useEffect(() => {
    if (!s) return
    const timer = setInterval(() => {
      if (!mutex.current)
        void load().catch((e) => {
          setError(e.message)
          authError(e.message)
        })
    }, 15000)
    return () => clearInterval(timer)
  }, [s?.user.id])
  useEffect(() => {
    if (!s || view !== 'reports') return
    let live = true
    const ticket = gate.current.ticket()
    setReport(null)
    void call<EduReport>('edu.report', { from, to })
      .then((x) => {
        if (live && gate.current.current(ticket)) setReport(x)
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
  const invoke = (f: () => Promise<unknown>) => {
    void f().catch((e) => {
      const m = e instanceof Error ? e.message : 'تعذر إتمام العملية'
      setError(m)
      authError(m)
    })
  }
  async function run(action: string, p: Record<string, unknown> = {}) {
    if (mutex.current) throw new Error('انتظر انتهاء العملية')
    mutex.current = true
    setBusy(true)
    setError('')
    setNotice('')
    const g = generation.current,
      key = JSON.stringify([action, p]),
      command = action.startsWith('edu.')
    try {
      if (command && !requests.current.has(key))
        requests.current.set(key, ulid())
      const r = await call<{ id: string }>(
        action,
        command ? { ...p, clientTxnId: requests.current.get(key) } : p,
      )
      if (g !== generation.current)
        throw new Error('انتهت الجلسة؛ سجّل الدخول مرة أخرى')
      requests.current.delete(key)
      setNotice('تم حفظ العملية')
      try {
        await load()
      } catch (e) {
        authError(e instanceof Error ? e.message : '')
        setError('تم الحفظ؛ حدّث العرض لقراءة البيانات الجديدة')
      }
      return r
    } catch (e) {
      const m = e instanceof Error ? e.message : 'تعذر الحفظ'
      setError(m)
      authError(m)
      throw e
    } finally {
      mutex.current = false
      setBusy(false)
    }
  }
  const edit = (f: EduForm) => {
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
          <label className="a-check">
            <input type="checkbox" required />
            راجعت القرار وأؤكد تسجيله
          </label>
        </>
      ),
      payload: (f) => ({ ...p, reason: text(f, 'reason') }),
    })
  async function open(kind: Detail['kind'], id: string) {
    const g = generation.current,
      ticket = gate.current.ticket(),
      d = await call<any>('edu.' + kind + '.get', { id })
    if (g !== generation.current || !scope.current) return
    const groupId =
      kind === 'group'
        ? id
        : kind === 'student'
          ? undefined
          : d[
              kind === 'session'
                ? 'session'
                : kind === 'exam'
                  ? 'exam'
                  : 'enrollment'
            ].groupId
    const v = { kind, id, groupId, data: d } as Detail
    if (
      !detailVisible(scope.current, v) ||
      !gate.current.accept(
        ticket,
        kind === 'student' ? 'student' : 'group',
        kind === 'student' ? id : groupId!,
      )
    )
      return
    if (kind === 'enrollment' && scope.current.user.role === 'teacher') return
    setForm(null)
    setReceipt(null)
    setDetail(v)
    setError('')
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
  const passwordForm = () =>
    edit({
      title: 'تغيير كلمة المرور',
      action: 'password.change',
      body: (
        <>
          <Field label="كلمة المرور الحالية">
            <input
              name="current"
              type="password"
              autoComplete="current-password"
              required
            />
          </Field>
          <Field label="كلمة المرور الجديدة">
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
            />
          </Field>
          <Field label="تأكيد الكلمة الجديدة">
            <input
              name="confirm"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
            />
          </Field>
        </>
      ),
      payload: (f) => {
        if (text(f, 'password') !== text(f, 'confirm'))
          throw new Error('كلمتا المرور غير متطابقتين')
        return { current: text(f, 'current'), password: text(f, 'password') }
      },
    })
  if (!s)
    return (
      <AuthScreen
        configured={configured}
        busy={busy}
        error={error}
        onAuthenticate={authenticate}
      />
    )
  const admin = s.user.role === 'admin',
    manager = ['admin', 'manager'].includes(s.user.role),
    office = s.user.role !== 'teacher',
    academic = manager || s.user.role === 'teacher',
    nav = (Object.entries(pages) as [View, string][]).filter(
      ([k]) =>
        !(['fees'].includes(k) && !office) &&
        !(['masters'].includes(k) && !manager) &&
        !(['users', 'audit', 'settings'].includes(k) && !admin),
    ),
    matches = (v: string) =>
      v.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  const feeForm = (x: EduEnrollment) =>
    edit({
      title: 'تحصيل رسوم — ' + x.studentName,
      action: 'edu.payment.post',
      body: (
        <>
          <p>{x.groupName}</p>
          <strong>المستحق {amount(x.balance ?? 0)} ج.م</strong>
          <div className="edu-two">
            <Field label="المبلغ المستلم، ج.م">
              <input
                name="amount"
                type="number"
                min="0.01"
                max={(x.balance ?? 0) / 100}
                step="0.01"
                required
              />
            </Field>
            <Field label="طريقة الدفع">
              <select name="method">
                {Object.entries(methods).map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="مرجع أو وصف التحصيل">
            <input name="reference" required maxLength={2000} />
          </Field>
          <p>يسجل مبلغًا استلمته بالفعل؛ لا ينفذ تحويلًا أو خصمًا من بطاقة.</p>
          <label className="a-check">
            <input type="checkbox" required />
            أؤكد استلام المبلغ ومراجعته
          </label>
        </>
      ),
      submit: 'حفظ إيصال التحصيل',
      payload: (f) => ({
        enrollmentId: x.id,
        enrollmentVersion: x.version,
        amount: readMoneyLocal(text(f, 'amount')),
        method: text(f, 'method'),
        reference: text(f, 'reference'),
      }),
    })
  const userForm = (u?: User) =>
    edit({
      title: u ? 'تعديل مستخدم' : 'مستخدم جديد',
      action: 'user.save',
      body: (
        <>
          <div className="edu-two">
            <Field label="اسم المستخدم">
              <input
                name="username"
                defaultValue={u?.username ?? ''}
                required
                pattern="[A-Za-z0-9_.-]{3,40}"
                disabled={!!u}
              />
            </Field>
            <Field label="الاسم">
              <input
                name="name"
                defaultValue={u?.name ?? ''}
                required
                maxLength={160}
              />
            </Field>
            <Field label="الدور">
              <select name="role" defaultValue={u?.role ?? 'cashier'}>
                {Object.entries(roles).map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={u ? 'كلمة مرور جديدة، اختياري' : 'كلمة المرور'}>
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required={!u}
              />
            </Field>
          </div>
          <label className="a-check">
            <input
              name="active"
              type="checkbox"
              defaultChecked={u ? !!u.active : true}
            />
            الحساب نشط
          </label>
        </>
      ),
      payload: (f) => ({
        ...(u && { id: u.id }),
        username: u?.username ?? text(f, 'username'),
        name: text(f, 'name'),
        role: text(f, 'role'),
        active: f.has('active'),
        ...(text(f, 'password') ? { password: text(f, 'password') } : {}),
      }),
    })
  const enrollmentRows = (rows: EduEnrollment[]) =>
    rows.length ? (
      <div className="edu-table">
        <table>
          <thead>
            <tr>
              <th>الطالب</th>
              <th>المجموعة</th>
              <th>الحالة</th>
              {office && <th>المستحق</th>}
              <th>الإجراءات</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.id}>
                <td>
                  {x.studentName}
                  <small>{x.studentCode}</small>
                </td>
                <td>{x.groupName}</td>
                <td>{x.status === 'active' ? 'نشط' : 'ملغى'}</td>
                {office && (
                  <td className="edu-number">{amount(x.balance ?? 0)} ج.م</td>
                )}
                <td className="edu-cell-actions">
                  {office && (
                    <button
                      onClick={() => invoke(() => open('enrollment', x.id))}
                    >
                      ملف الرسوم
                    </button>
                  )}
                  {office && x.status === 'active' && (x.balance ?? 0) > 0 && (
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => feeForm(x)}
                    >
                      تحصيل
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <Empty>لا يوجد طلاب مسجلون في هذه القائمة.</Empty>
    )
  return (
    <div className="edu-shell">
      <header className="edu-top">
        <div className="edu-brand">
          <img src="./icon.svg" alt="" />
          <strong>
            XZARE<small>EDUCATION</small>
          </strong>
        </div>
        <div className="edu-center">
          <strong>{s.settings.businessName}</strong>
          <span>
            {s.user.name} · {roles[s.user.role]}
          </span>
        </div>
        <WorkspaceClock english={false} />
        <button
          disabled={busy}
          onClick={() =>
            invoke(async () => {
              await call('logout')
              end()
            })
          }
        >
          خروج
        </button>
      </header>
      <nav className="edu-nav" aria-label="مساحات المركز">
        {nav.map(([k, v]) => (
          <button
            key={k}
            aria-current={view === k ? 'page' : undefined}
            onClick={() => {
              setView(k)
              setQuery('')
              setDetail(null)
              setReceipt(null)
            }}
          >
            {v}
          </button>
        ))}
      </nav>
      <main className="edu-main">
        <div className="edu-page-head">
          <div>
            <span className="eyebrow">XZARE / LEARNING CENTER</span>
            <h1>{pages[view]}</h1>
          </div>
          <div className="edu-toolbar">
            <button disabled={busy} onClick={() => invoke(load)}>
              تحديث
            </button>
            <button disabled={busy} onClick={passwordForm}>
              كلمة المرور
            </button>
          </div>
        </div>
        {error && (
          <p className="alert error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="alert success" role="status">
            {notice}
          </p>
        )}
        {view === 'today' && (
          <>
            <section className="edu-day-intro">
              <div>
                <span>كل حصة لها كشف. كل طالب له متابعة.</span>
                <h2>ابدأ بيوم المركز.</h2>
                <p>افتح الحصة وسجل الحضور من قائمة الطلاب الفعلية.</p>
              </div>
              <div className="edu-day-actions">
                <Field label="يوم الجدول">
                  <input
                    type="date"
                    value={day}
                    onChange={(e) => setDay(e.target.value)}
                  />
                </Field>
                {academic && (
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => edit(academicForm(s, 'session'))}
                  >
                    حصة جديدة
                  </button>
                )}
              </div>
            </section>
            <div className="edu-summary">
              <span>
                <strong>
                  {
                    s.sessions.filter(
                      (x) => x.day === day && x.status === 'scheduled',
                    ).length
                  }
                </strong>{' '}
                حصة في الجدول
              </span>
              <span>
                <strong>{s.students.filter((x) => x.active).length}</strong>{' '}
                طالب نشط ضمن صلاحيتك
              </span>
              <span>
                <strong>{s.groups.filter((x) => x.active).length}</strong>{' '}
                مجموعة نشطة
              </span>
            </div>
            <section className="edu-schedule">
              {s.sessions.filter((x) => x.day === day).length ? (
                s.sessions
                  .filter((x) => x.day === day)
                  .map((l) => (
                    <article
                      key={l.id}
                      className={l.status === 'cancelled' ? 'cancelled' : ''}
                    >
                      <div className="edu-time">
                        <strong>{clock(l.startMinute)}</strong>
                        <small>{l.duration} دقيقة</small>
                      </div>
                      <div className="edu-class">
                        <h3>{l.title}</h3>
                        <p>
                          {l.groupName} · {l.teacherName}
                        </p>
                        <span>
                          {l.status === 'cancelled'
                            ? 'ملغاة'
                            : l.marked + ' / ' + l.count + ' حضور مسجل'}
                        </span>
                      </div>
                      <button
                        disabled={busy}
                        onClick={() => invoke(() => open('session', l.id))}
                      >
                        {l.status === 'cancelled'
                          ? 'عرض الكشف'
                          : 'فتح كشف الحضور'}
                      </button>
                      {manager &&
                        l.status === 'scheduled' &&
                        l.marked === 0 && (
                          <button
                            disabled={busy}
                            onClick={() =>
                              ask(
                                'إلغاء الحصة',
                                'edu.session.cancel',
                                { id: l.id, version: l.version },
                                <p>
                                  {l.title} · {l.day}
                                </p>,
                              )
                            }
                          >
                            إلغاء الحصة
                          </button>
                        )}
                    </article>
                  ))
              ) : (
                <Empty>
                  لا توجد حصص في هذا اليوم. أضف الطلاب والدورة والمدرس
                  والمجموعة، ثم أنشئ حصة فعلية.
                </Empty>
              )}
            </section>
            {!s.groups.length && (
              <div className="edu-start">
                <h2>ابدأ أول مجموعة</h2>
                <p>
                  {manager
                    ? 'سجل دورة ومدرسًا، أنشئ مجموعة، ثم أضف الطلاب وسجلهم فيها.'
                    : 'ستظهر هنا المجموعات التي يضيفها مدير المركز ضمن صلاحيتك.'}
                </p>
                {manager && (
                  <button onClick={() => setView('masters')}>
                    إضافة الدورات والمدرسين
                  </button>
                )}
                {office && (
                  <button onClick={() => edit(studentForm())}>
                    تسجيل طالب
                  </button>
                )}
              </div>
            )}
          </>
        )}
        {view === 'students' && (
          <>
            <div className="edu-toolbar">
              <input
                aria-label="بحث الطلاب"
                placeholder="بحث بالاسم أو الكود أو المستوى"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {office && (
                <button
                  className="primary"
                  onClick={() => edit(studentForm())}
                  disabled={busy}
                >
                  تسجيل طالب
                </button>
              )}
              {office && (
                <button onClick={() => edit(enrollmentForm(s))} disabled={busy}>
                  تسجيل في مجموعة
                </button>
              )}
            </div>
            {s.students.length ? (
              <div className="edu-table">
                <table>
                  <thead>
                    <tr>
                      <th>الطالب</th>
                      {office && <th>التواصل والمستوى</th>}
                      <th>المجموعات</th>
                      <th>الإجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.students
                      .filter((x) =>
                        matches(x.name + ' ' + x.code + ' ' + (x.level ?? '')),
                      )
                      .map((x) => (
                        <tr key={x.id}>
                          <td>
                            <button
                              className="edu-link"
                              onClick={() =>
                                invoke(() => open('student', x.id))
                              }
                            >
                              {x.name}
                            </button>
                            <small>
                              {x.code} · {x.active ? 'نشط' : 'متوقف'}
                            </small>
                          </td>
                          {office && (
                            <td>
                              {x.phone || 'لم يسجل هاتف'}
                              <small>{x.level}</small>
                            </td>
                          )}
                          <td>
                            {s.enrollments
                              .filter(
                                (e) =>
                                  e.studentId === x.id && e.status === 'active',
                              )
                              .map((e) => e.groupName)
                              .join('، ') || 'لم يسجل في مجموعة'}
                          </td>
                          <td className="edu-cell-actions">
                            {office && (
                              <>
                                <button
                                  disabled={busy}
                                  onClick={() => edit(studentForm(x))}
                                >
                                  تعديل
                                </button>
                                <button
                                  disabled={busy || !x.active}
                                  onClick={() => edit(enrollmentForm(s, x.id))}
                                >
                                  تسجيل في مجموعة
                                </button>
                              </>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>
                لا يوجد طلاب. سجل بيانات الطالب الفعلية لبدء المتابعة.
              </Empty>
            )}
          </>
        )}
        {view === 'groups' && (
          <>
            <div className="edu-toolbar">
              <input
                aria-label="بحث المجموعات"
                placeholder="بحث بالمجموعة أو الدورة أو المدرس"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {manager && (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => edit(groupForm(s))}
                >
                  مجموعة جديدة
                </button>
              )}
            </div>
            <div className="edu-group-list">
              {s.groups
                .filter((g) =>
                  matches(g.name + ' ' + g.courseName + ' ' + g.teacherName),
                )
                .map((g) => (
                  <article key={g.id}>
                    <div>
                      <span>
                        {g.code} · {g.active ? 'نشطة' : 'متوقفة'}
                      </span>
                      <h2>
                        <button
                          className="edu-link"
                          onClick={() => invoke(() => open('group', g.id))}
                        >
                          {g.name}
                        </button>
                      </h2>
                      <p>
                        {g.courseName} · {g.teacherName}
                      </p>
                      <small>
                        {g.startDay} → {g.endDay}
                      </small>
                    </div>
                    <div className="edu-group-meta">
                      <strong>
                        {g.count} / {g.capacity}
                      </strong>
                      <span>طالب مسجل</span>
                      {office && <small>رسوم {amount(g.fee ?? 0)} ج.م</small>}
                    </div>
                    <div className="edu-cell-actions">
                      {office && (
                        <button
                          disabled={busy || !g.active}
                          onClick={() => edit(enrollmentForm(s, '', g.id))}
                        >
                          إلحاق طالب
                        </button>
                      )}
                      {academic && (
                        <button
                          disabled={busy || !g.active}
                          onClick={() => edit(academicForm(s, 'session', g.id))}
                        >
                          حصة
                        </button>
                      )}
                      {academic && (
                        <button
                          disabled={busy || !g.active}
                          onClick={() => edit(academicForm(s, 'exam', g.id))}
                        >
                          اختبار
                        </button>
                      )}
                      {manager && (
                        <button
                          disabled={busy}
                          onClick={() => edit(groupForm(s, g))}
                        >
                          تعديل
                        </button>
                      )}
                    </div>
                  </article>
                ))}
            </div>
            {!s.groups.length && (
              <Empty>
                أضف دورة ومدرسًا أولًا، ثم أنشئ مجموعة فعلية برسوم وسعة وفترة
                محددة.
              </Empty>
            )}
          </>
        )}
        {view === 'masters' && manager && (
          <div className="edu-two-panels">
            <section>
              <div className="edu-section-head">
                <h2>الدورات والمواد</h2>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => edit(courseForm())}
                >
                  دورة جديدة
                </button>
              </div>
              {s.courses.map((c) => (
                <article className="edu-master" key={c.id}>
                  <div>
                    <strong>{c.name}</strong>
                    <small>
                      {c.code} · {c.active ? 'نشطة' : 'متوقفة'}
                    </small>
                    <p>{c.description}</p>
                  </div>
                  <button disabled={busy} onClick={() => edit(courseForm(c))}>
                    تعديل
                  </button>
                </article>
              ))}
              {!s.courses.length && (
                <Empty>سجل اسم الدورة أو المادة التي تقدمها.</Empty>
              )}
            </section>
            <section>
              <div className="edu-section-head">
                <h2>المدرسون</h2>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => edit(teacherForm(s))}
                >
                  إضافة مدرس
                </button>
              </div>
              {s.teachers.map((t) => (
                <article className="edu-master" key={t.id}>
                  <div>
                    <strong>{t.name}</strong>
                    <small>
                      {t.code} · {t.active ? 'نشط' : 'متوقف'} ·{' '}
                      {t.userId ? 'حساب مرتبط' : 'بدون دخول'}
                    </small>
                    <p>{t.phone}</p>
                  </div>
                  <button
                    disabled={busy}
                    onClick={() => edit(teacherForm(s, t))}
                  >
                    تعديل
                  </button>
                </article>
              ))}
              {!s.teachers.length && (
                <Empty>أضف المدرس الفعلي. ربط حساب الدخول اختياري.</Empty>
              )}
            </section>
          </div>
        )}
        {view === 'fees' && office && (
          <>
            <div className="edu-finance-head">
              <span>مستحقات الاشتراكات الحالية</span>
              <strong>
                {amount(
                  s.enrollments.reduce((n, e) => n + (e.balance ?? 0), 0),
                )}{' '}
                ج.م
              </strong>
              <p>رسوم محفوظة عند التسجيل، ناقص التحصيل والتخفيضات المعتمدة.</p>
            </div>
            <div className="edu-toolbar">
              <input
                aria-label="بحث الرسوم"
                placeholder="بحث بالطالب أو المجموعة"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button disabled={busy} onClick={() => edit(enrollmentForm(s))}>
                تسجيل في مجموعة
              </button>
            </div>
            {enrollmentRows(
              s.enrollments.filter((e) =>
                matches(e.studentName + ' ' + e.groupName),
              ),
            )}
            <h2>آخر إيصالات التحصيل</h2>
            <div className="edu-table">
              <table>
                <thead>
                  <tr>
                    <th>الإيصال</th>
                    <th>الطالب والمجموعة</th>
                    <th>المبلغ</th>
                    <th>الحالة</th>
                    <th>عرض</th>
                  </tr>
                </thead>
                <tbody>
                  {s.payments.map((p) => (
                    <tr key={p.id}>
                      <td>
                        {p.number}
                        <small>{stamp(p.at)}</small>
                      </td>
                      <td>
                        {p.student.name}
                        <small>{p.group.name}</small>
                      </td>
                      <td>
                        {amount(p.amount)} ج.م · {methods[p.method]}
                      </td>
                      <td>{p.voidReason ? 'ملغى' : 'مسجل'}</td>
                      <td>
                        <button onClick={() => setReceipt(p)}>
                          عرض الإيصال
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {view === 'exams' && (
          <>
            <div className="edu-toolbar">
              <input
                aria-label="بحث الاختبارات"
                placeholder="بحث بالاختبار أو المجموعة"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {academic && (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => edit(academicForm(s, 'exam'))}
                >
                  اختبار جديد
                </button>
              )}
            </div>
            <div className="edu-table">
              <table>
                <thead>
                  <tr>
                    <th>الاختبار</th>
                    <th>المجموعة</th>
                    <th>التاريخ</th>
                    <th>النهاية</th>
                    <th>الحالة</th>
                    <th>الكشف</th>
                  </tr>
                </thead>
                <tbody>
                  {s.exams
                    .filter((x) => matches(x.title + ' ' + x.groupName))
                    .map((x) => (
                      <tr key={x.id}>
                        <td>{x.title}</td>
                        <td>{x.groupName}</td>
                        <td>{x.day}</td>
                        <td>{decimal(x.maxScore)}</td>
                        <td>{x.status === 'published' ? 'منشور' : 'مسودة'}</td>
                        <td>
                          <button
                            disabled={busy}
                            onClick={() => invoke(() => open('exam', x.id))}
                          >
                            فتح الدرجات
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {!s.exams.length && (
              <Empty>
                أنشئ اختبارًا لمجموعة فعلية؛ قائمة الطلاب تثبت وقت الإنشاء.
              </Empty>
            )}
          </>
        )}
        {view === 'reports' && (
          <>
            <div className="edu-toolbar">
              <Field label="من">
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </Field>
              <Field label="إلى">
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </Field>
              {report && (
                <>
                  <button
                    onClick={() =>
                      csv('Education-report-' + to + '.csv', [
                        [
                          'من',
                          'إلى',
                          'الحصص',
                          'الاختبارات',
                          'التسجيلات',
                          'صافي التحصيل',
                          'المستحق الحالي',
                        ],
                        [
                          from,
                          to,
                          report.attendance.length,
                          report.exams.length,
                          report.enrollmentCount,
                          report.finance
                            ? decimal(report.finance.netCollected)
                            : '',
                          report.finance
                            ? decimal(report.finance.outstanding)
                            : '',
                        ],
                      ])
                    }
                  >
                    تصدير التقرير CSV
                  </button>
                  <button onClick={() => window.print()}>طباعة</button>
                </>
              )}
            </div>
            {report && (
              <section className="edu-report print-area">
                <h2>{s.settings.businessName}</h2>
                <p>
                  {from} → {to}
                </p>
                <div className="edu-summary">
                  <span>
                    <strong>{report.attendance.length}</strong> حصة
                  </span>
                  <span>
                    <strong>{report.exams.length}</strong> اختبار
                  </span>
                  <span>
                    <strong>{report.enrollmentCount}</strong> اشتراك سجل في
                    الفترة
                  </span>
                </div>
                {report.finance && (
                  <>
                    <div className="edu-summary">
                      <span>
                        <strong>{amount(report.finance.netCollected)}</strong>{' '}
                        ج.م صافي تحصيل الفترة
                      </span>
                      <span>
                        <strong>{amount(report.finance.outstanding)}</strong>{' '}
                        ج.م المستحق الحالي
                      </span>
                      <span>
                        <strong>{amount(report.finance.voided)}</strong> ج.م
                        إيصالات ألغيت في الفترة
                      </span>
                    </div>
                    <p>
                      الصافي = التحصيل المسجل ناقص الإيصالات التي ألغيت في
                      الفترة. المستحق رصيد حالي لجميع الاشتراكات، وليس رصيدًا
                      تاريخيًا بنهاية الفترة.
                    </p>
                  </>
                )}
                <h3>حصص الفترة</h3>
                <div className="edu-table">
                  <table>
                    <thead>
                      <tr>
                        <th>الحصة</th>
                        <th>المجموعة</th>
                        <th>اليوم</th>
                        <th>الحضور المسجل</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.attendance.map((l) => (
                        <tr key={l.id}>
                          <td>{l.title}</td>
                          <td>{l.groupName}</td>
                          <td>{l.day}</td>
                          <td>
                            {l.status === 'cancelled'
                              ? 'ملغاة'
                              : l.marked + ' / ' + l.count}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </>
        )}
        {view === 'users' && admin && (
          <>
            <button
              className="primary"
              onClick={() => userForm()}
              disabled={busy}
            >
              مستخدم جديد
            </button>
            <div className="edu-table">
              <table>
                <thead>
                  <tr>
                    <th>المستخدم</th>
                    <th>الدور</th>
                    <th>الحالة</th>
                    <th>تعديل</th>
                  </tr>
                </thead>
                <tbody>
                  {s.users.map((u) => (
                    <tr key={u.id}>
                      <td>
                        {u.name}
                        <small>{u.username}</small>
                      </td>
                      <td>{roles[u.role]}</td>
                      <td>{u.active ? 'نشط' : 'معطل'}</td>
                      <td>
                        <button disabled={busy} onClick={() => userForm(u)}>
                          تعديل
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {view === 'audit' && admin && (
          <div className="edu-table">
            <table>
              <thead>
                <tr>
                  <th>التوقيت</th>
                  <th>المستخدم</th>
                  <th>العملية</th>
                  <th>المعرف</th>
                </tr>
              </thead>
              <tbody>
                {s.audit.map((a) => (
                  <tr key={a.id}>
                    <td>{stamp(a.at)}</td>
                    <td>{a.user_name ?? 'النظام'}</td>
                    <td>{a.action}</td>
                    <td>{a.entity_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {view === 'settings' && admin && (
          <div className="edu-settings">
            <section>
              <h2>بيانات المركز</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  const f = new FormData(e.currentTarget)
                  invoke(() =>
                    run('settings.save', {
                      businessName: text(f, 'businessName'),
                      phone: text(f, 'phone'),
                      address: text(f, 'address'),
                      receiptFooter: text(f, 'receiptFooter'),
                      language: 'ar',
                      currency: 'EGP',
                      taxBps: 0,
                    }),
                  )
                }}
              >
                <Field label="اسم المركز">
                  <input
                    name="businessName"
                    defaultValue={s.settings.businessName}
                    required
                    maxLength={160}
                  />
                </Field>
                <Field label="هاتف المركز">
                  <input
                    name="phone"
                    defaultValue={s.settings.phone}
                    maxLength={40}
                  />
                </Field>
                <Field label="العنوان">
                  <input
                    name="address"
                    defaultValue={s.settings.address}
                    maxLength={250}
                  />
                </Field>
                <Field label="نهاية الإيصال">
                  <textarea
                    name="receiptFooter"
                    defaultValue={s.settings.receiptFooter}
                    maxLength={500}
                  />
                </Field>
                <button className="primary" disabled={busy}>
                  حفظ البيانات
                </button>
              </form>
            </section>
            <section>
              <LicensePanel />
            </section>
            <section>
              <h2>النسخ الاحتياطي</h2>
              <p>
                قاعدة البيانات والنسخ غير مشفرة. احفظهما في مكان موثوق؛ مفتاح
                الجهاز محمي في نسخة Windows.
              </p>
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
                      if (r.download)
                        download(
                          r.fileName ?? 'Education.xzbak',
                          new Blob([
                            Uint8Array.from(atob(r.download), (c) =>
                              c.charCodeAt(0),
                            ),
                          ]),
                        )
                      if (!r.cancelled) setNotice('تم إنشاء النسخة الاحتياطية')
                    }),
                  )
                }
              >
                إنشاء نسخة
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  edit({
                    title: 'استعادة نسخة Education',
                    action: 'backup.restore',
                    body: (
                      <>
                        <p>
                          تستبدل بيانات المركز وتنهي الجلسات، مع حفظ نسخة قبل
                          الاستبدال.
                        </p>
                        {!window.xzare && (
                          <Field label="ملف النسخة">
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
                            autoComplete="current-password"
                          />
                        </Field>
                        <label className="a-check">
                          <input type="checkbox" required />
                          أؤكد استعادة هذه النسخة
                        </label>
                      </>
                    ),
                    payload: (f) => ({
                      password: text(f, 'password'),
                      file: f.get('file'),
                    }),
                  })
                }
              >
                استعادة نسخة
              </button>
            </section>
            <section>
              <h2>دعم Xzare</h2>
              <p dir="ltr">
                hello@xzare.com
                <br />
                +201501230440
              </p>
            </section>
          </div>
        )}
        <footer className="edu-footer">
          XZARE SOFTWARE SOLUTIONS · EDUCATION / 0.1{' '}
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
              if (current.action === 'backup.restore') {
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
                      throw new Error('اختر نسخة صحيحة حتى 128 ميجابايت')
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
                    })
                    const v = await r.json()
                    if (!r.ok || !v.ok)
                      throw new Error(v.error ?? 'تعذر الاستعادة')
                    end()
                  }
                })
              } else {
                await run(current.action, p)
                setForm(null)
                if (current.action === 'password.change') end()
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
      {detail?.kind === 'session' && (
        <Attendance
          key={detail.id}
          d={detail.data}
          busy={busy}
          close={() => setDetail(null)}
          save={run}
        />
      )}
      {detail?.kind === 'exam' && (
        <Grades
          key={detail.id}
          d={detail.data}
          busy={busy}
          manager={manager}
          canEdit={academic}
          close={() => setDetail(null)}
          save={run}
        />
      )}
      {detail?.kind === 'student' && (
        <Modal
          title={detail.data.student.name}
          busy={busy}
          error=""
          manual
          onClose={() => setDetail(null)}
        >
          <p>
            {detail.data.student.code}
            {office && (
              <>
                {' '}
                · {detail.data.student.level}
                <br />
                {detail.data.student.phone}
                <br />
                ولي الأمر: {detail.data.student.guardian} ·{' '}
                {detail.data.student.guardianPhone}
                <br />
                {detail.data.student.note}
              </>
            )}
          </p>
          <h3>مجموعات الطالب</h3>
          {enrollmentRows(detail.data.enrollments)}
          {office && (
            <button
              disabled={busy}
              onClick={() => edit(enrollmentForm(s, detail.id))}
            >
              تسجيل في مجموعة
            </button>
          )}
          {office && <History events={detail.data.events} />}
        </Modal>
      )}
      {detail?.kind === 'group' && (
        <Modal
          title={detail.data.group.name}
          busy={busy}
          error=""
          manual
          onClose={() => setDetail(null)}
        >
          <p>
            {detail.data.group.courseName} · {detail.data.group.teacherName} ·{' '}
            {detail.data.group.startDay} → {detail.data.group.endDay}
          </p>
          {enrollmentRows(detail.data.enrollments)}
          {office && (
            <button onClick={() => edit(enrollmentForm(s, '', detail.id))}>
              إلحاق طالب
            </button>
          )}
          {academic && (
            <>
              <button
                onClick={() => edit(academicForm(s, 'session', detail.id))}
              >
                حصة جديدة
              </button>
              <button onClick={() => edit(academicForm(s, 'exam', detail.id))}>
                اختبار جديد
              </button>
            </>
          )}
          <h3>حصص المجموعة</h3>
          {s.sessions
            .filter((l) => l.groupId === detail.id)
            .map((l) => (
              <button
                key={l.id}
                onClick={() => invoke(() => open('session', l.id))}
              >
                {l.day} · {l.title} · {clock(l.startMinute)}
              </button>
            ))}
        </Modal>
      )}
      {detail?.kind === 'enrollment' && office && (
        <Modal
          title={'رسوم — ' + detail.data.enrollment.studentName}
          busy={busy}
          error=""
          manual
          onClose={() => setDetail(null)}
        >
          <p>
            {detail.data.enrollment.groupName} ·{' '}
            {detail.data.enrollment.status === 'active' ? 'اشتراك نشط' : 'ملغى'}
          </p>
          <div className="edu-finance-head">
            <span>المستحق</span>
            <strong>{amount(detail.data.enrollment.balance ?? 0)} ج.م</strong>
            <small>
              الرسوم {amount(detail.data.enrollment.fee ?? 0)} · خصم التسجيل{' '}
              {amount(detail.data.enrollment.discount ?? 0)}
            </small>
          </div>
          <div className="edu-toolbar">
            {detail.data.enrollment.status === 'active' &&
              (detail.data.enrollment.balance ?? 0) > 0 && (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => feeForm(detail.data.enrollment)}
                >
                  تحصيل رسوم
                </button>
              )}
            {manager && detail.data.enrollment.status === 'active' && (
              <>
                <button
                  disabled={busy}
                  onClick={() =>
                    edit({
                      title: 'تخفيض رسوم معتمد',
                      action: 'edu.credit.post',
                      body: (
                        <>
                          <p>
                            المستحق الحالي{' '}
                            {amount(detail.data.enrollment.balance ?? 0)} ج.م
                          </p>
                          <Field label="قيمة التخفيض، ج.م">
                            <input
                              name="amount"
                              type="number"
                              min="0.01"
                              max={(detail.data.enrollment.balance ?? 0) / 100}
                              step="0.01"
                              required
                            />
                          </Field>
                          <Field label="سبب التخفيض">
                            <textarea name="reason" required maxLength={2000} />
                          </Field>
                        </>
                      ),
                      payload: (f) => ({
                        enrollmentId: detail.id,
                        enrollmentVersion: detail.data.enrollment.version,
                        amount: readMoneyLocal(text(f, 'amount')),
                        reason: text(f, 'reason'),
                      }),
                    })
                  }
                >
                  تخفيض معتمد
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    ask(
                      'إلغاء الاشتراك قبل بدء العمل',
                      'edu.enrollment.cancel',
                      {
                        id: detail.id,
                        version: detail.data.enrollment.version,
                      },
                      <p>
                        متاح قبل التحصيل وقبل إدراج الطالب في كشف حصة أو اختبار.
                      </p>,
                    )
                  }
                >
                  إلغاء اشتراك
                </button>
              </>
            )}
          </div>
          <h3>حركة الرسوم</h3>
          <div className="edu-table">
            <table>
              <thead>
                <tr>
                  <th>التوقيت</th>
                  <th>الحركة</th>
                  <th>المبلغ</th>
                  <th>المرجع</th>
                </tr>
              </thead>
              <tbody>
                {detail.data.ledger.map((l) => (
                  <tr key={l.id}>
                    <td>{stamp(l.at)}</td>
                    <td>{ledgerLabels[l.kind]}</td>
                    <td>{amount(l.amount)}</td>
                    <td>{l.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>الإيصالات</h3>
          {detail.data.payments.map((p) => (
            <div key={p.id} className="edu-master">
              <span>
                {p.number} · {amount(p.amount)} ج.م ·{' '}
                {p.voidReason ? 'ملغى' : 'مسجل'}
              </span>
              <button
                onClick={() => {
                  setReceipt(p)
                  setDetail(null)
                }}
              >
                عرض الإيصال
              </button>
              {manager && !p.voidReason && (
                <button
                  disabled={busy}
                  onClick={() =>
                    ask(
                      'إلغاء إيصال وتسجيل عكسه',
                      'edu.payment.void',
                      { id: p.id },
                      <p>
                        {p.number} · {amount(p.amount)} ج.م. يعاد المبلغ إلى
                        المستحق؛ لا ينفذ رد أموال تلقائيًا.
                      </p>,
                    )
                  }
                >
                  إلغاء الإيصال
                </button>
              )}
            </div>
          ))}
          <History events={detail.data.events} />
        </Modal>
      )}
      {receipt && office && (
        <Modal
          title={'إيصال ' + receipt.number}
          busy={busy}
          error=""
          manual
          onClose={() => setReceipt(null)}
        >
          <article className="edu-receipt print-area">
            <header>
              <img src="./icon.svg" alt="" />
              <h2>{receipt.business.businessName}</h2>
              <p>
                {receipt.business.phone} · {receipt.business.address}
              </p>
            </header>
            <h3>إيصال تحصيل رسوم</h3>
            <p>
              {receipt.number} · {stamp(receipt.at)}
            </p>
            {receipt.voidReason && (
              <p className="alert error">إيصال ملغى — {receipt.voidReason}</p>
            )}
            <p>
              الطالب: {receipt.student.name} · {receipt.student.code}
            </p>
            <p>المجموعة: {receipt.group.name}</p>
            <strong>{amount(receipt.amount)} ج.م</strong>
            <p>
              {methods[receipt.method]} · {receipt.reference}
            </p>
            <small>سجله {receipt.actorName}</small>
            <footer>{receipt.business.receiptFooter}</footer>
          </article>
          <button onClick={() => window.print()}>طباعة الإيصال</button>
          <button
            onClick={() =>
              csv('Education-receipt-' + receipt.number + '.csv', [
                [
                  'الإيصال',
                  'الطالب',
                  'المجموعة',
                  'المبلغ',
                  'الطريقة',
                  'المرجع',
                  'الحالة',
                ],
                [
                  receipt.number,
                  receipt.student.name,
                  receipt.group.name,
                  decimal(receipt.amount),
                  methods[receipt.method],
                  receipt.reference,
                  receipt.voidReason ? 'ملغى' : 'مسجل',
                ],
              ])
            }
          >
            تصدير الإيصال CSV
          </button>
        </Modal>
      )}
    </div>
  )
}
import { readMoney as readMoneyLocal } from './model'
