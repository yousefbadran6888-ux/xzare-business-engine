import { useState, useEffect, useRef, type ReactNode } from 'react'
import { ulid } from '@xzare/core'
import type {
  GymState,
  GymMember,
  GymMembership,
  GymPayment,
  GymSession,
  GymAttendance,
  GymMemberDetail,
  GymMembershipDetail,
  GymSessionDetail,
  GymAccess,
  GymReport,
  User,
} from '@xzare/engine'
import { call } from '../../pos/src/bridge'
import { useSessionActivity } from '../../pos/src/useSessionActivity'
import { LicensePanel } from '../../pos/src/LicensePanel'
import { WorkspaceClock } from '../../pos/src/WorkspaceClock'
import { ScanGate } from './scan-gate'
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
  memberForm,
  planForm,
  trainerForm,
  membershipForm,
  bookingForm,
  text,
  type GymForm,
} from './Forms'
import {
  passwordValue,
  roles,
  methods,
  ledgerLabels,
  sessionLabels,
  eventLabels,
  stamp,
  clock,
  readMoney,
  addDay,
} from './model'
import { MemberCard } from './MemberCard'
import { ScopeGate } from './scope'
import { refreshReceipt } from './receipt-refresh'
import { exclusive } from './exclusive'
const pages = {
  reception: 'الاستقبال',
  members: 'الأعضاء',
  memberships: 'الاشتراكات والتجديد',
  sessions: 'مواعيد التدريب',
  plans: 'الباقات والمدربون',
  fees: 'التحصيل والإيصالات',
  reports: 'التقارير',
  users: 'المستخدمون',
  audit: 'سجل التدقيق',
  settings: 'الإعدادات والترخيص',
}
type View = keyof typeof pages
type Detail =
  | { kind: 'member'; id: string; data: GymMemberDetail }
  | { kind: 'membership'; id: string; data: GymMembershipDetail }
  | { kind: 'session'; id: string; data: GymSessionDetail }
export function App() {
  const [configured, setConfigured] = useState<boolean | null>(null),
    [s, setState] = useState<GymState | null>(null),
    [view, setView] = useState<View>('reception'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [query, setQuery] = useState(''),
    [scan, setScan] = useState(''),
    [access, setAccess] = useState<GymAccess | null>(null),
    [form, setForm] = useState<GymForm | null>(null),
    [detail, setDetail] = useState<Detail | null>(null),
    [card, setCard] = useState<GymMember | null>(null),
    [receipt, setReceipt] = useState<GymPayment | null>(null),
    [day, setDay] = useState(today()),
    [from, setFrom] = useState(today().slice(0, 7) + '-01'),
    [to, setTo] = useState(today()),
    [report, setReport] = useState<GymReport | null>(null)
  const gate = useRef(new ScopeGate()),
    mutex = useRef(false),
    generation = useRef(0),
    loadSeq = useRef(0),
    scope = useRef<GymState | null>(null),
    requests = useRef(new Map<string, string>()),
    scanGate = useRef(new ScanGate())
  const end = () => {
    generation.current++
    gate.current.clear()
    scope.current = null
    setState(null)
    setForm(null)
    setDetail(null)
    setReceipt(null)
    setReport(null)
    setCard(null)
    setAccess(null)
    setScan('')
    scanGate.current.clear()
    setView('reception')
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
  async function load() {
    const g = generation.current,
      n = ++loadSeq.current,
      v = await call<GymState>('gym.state')
    if (g !== generation.current || n !== loadSeq.current) return
    if (gate.current.update(v)) {
      setForm(null)
      setDetail(null)
      setCard(null)
      setReceipt(null)
      setReport(null)
      setAccess(null)
    }
    scope.current = v
    setState(v)
    setDetail((d) => {
      if (!d) return null
      if (d.kind === 'member')
        return v.members.some(
          (m) => m.id === d.id && m.version === d.data.member.version,
        )
          ? d
          : null
      if (d.kind === 'membership')
        return v.memberships.some(
          (m) => m.id === d.id && m.version === d.data.membership.version,
        )
          ? d
          : null
      return v.sessions.some(
        (b) => b.id === d.id && b.version === d.data.session.version,
      ) && v.memberships.some((m) => m.id === d.data.session.membershipId)
        ? d
        : null
    })
    setReceipt((p) =>
      p && v.user.role !== 'trainer' ? refreshReceipt(p, v.payments) : null,
    )
    setAccess((a) => {
      if (!a || v.user.role === 'trainer') return null
      const m = v.members.find((m) => m.id === a.member.id)
      if (!m || m.version !== a.member.version) return null
      if (
        a.membership &&
        !v.memberships.some(
          (m) =>
            m.id === a.membership!.id && m.version === a.membership!.version,
        )
      )
        return null
      return a
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
    void call<GymReport>('gym.report', { from, to })
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
    if (mutex.current) throw Error('انتظر انتهاء العملية')
    mutex.current = true
    setBusy(true)
    setError('')
    setNotice('')
    const g = generation.current,
      key = JSON.stringify([action, p]),
      command = action.startsWith('gym.')
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
  const edit = (f: GymForm) => {
    setDetail(null)
    setCard(null)
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
      d = await call<any>('gym.' + kind + '.get', { id })
    if (g !== generation.current || !scope.current) return
    const target = kind === 'session' ? d.session.membershipId : id,
      type = kind === 'member' ? 'member' : 'membership'
    if (!gate.current.accept(ticket, type, target)) return
    setForm(null)
    setReceipt(null)
    setCard(null)
    setDetail({ kind, id, data: d } as Detail)
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
              required
              autoComplete="current-password"
            />
          </Field>
          <Field label="كلمة المرور الجديدة">
            <input
              name="password"
              type="password"
              required
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
            />
          </Field>
          <Field label="تأكيد الكلمة الجديدة">
            <input
              name="confirm"
              type="password"
              required
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
            />
          </Field>
        </>
      ),
      payload: (f) => {
        if (passwordValue(f, 'password') !== passwordValue(f, 'confirm'))
          throw Error('كلمتا المرور غير متطابقتين')
        return {
          current: passwordValue(f, 'current'),
          password: passwordValue(f, 'password'),
        }
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
    office = s.user.role !== 'trainer',
    nav = (Object.entries(pages) as [View, string][]).filter(
      ([k]) =>
        !(['fees', 'reception'].includes(k) && !office) &&
        !(k === 'plans' && !manager) &&
        !(['users', 'audit', 'settings'].includes(k) && !admin),
    ),
    activeView = nav.some(([k]) => k === view) ? view : 'sessions',
    matches = (v: string) =>
      v.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
    memberOf = (m: GymMembership) =>
      s.members.find((x) => x.id === m.memberId)!,
    status = (m: GymMembership) =>
      m.status === 'cancelled'
        ? 'ملغى'
        : m.status === 'stopped'
          ? 'متوقف'
          : m.startDay > today()
            ? 'قادم'
            : m.endDay < today()
              ? 'منتهي'
              : 'قائم',
    refresh = () => invoke(load)
  const collect = (m: GymMembership) =>
    edit({
      title: 'إيصال تحصيل — ' + m.memberName,
      action: 'gym.payment.post',
      body: (
        <>
          <p>
            {m.planName} — {m.startDay} إلى {m.endDay}
          </p>
          <strong>المستحق {amount(m.balance ?? 0)} ج.م</strong>
          <div className="gym-two">
            <Field label="المبلغ المستلم، ج.م">
              <input
                name="amount"
                type="number"
                required
                min="0.01"
                max={(m.balance ?? 0) / 100}
                step="0.01"
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
            <input name="reference" maxLength={160} required />
          </Field>
          <p>يسجل مبلغًا استلمته بالفعل؛ لا يخصم من بطاقة أو ينفذ تحويلًا.</p>
          <label className="a-check">
            <input type="checkbox" required />
            أؤكد استلام المبلغ ومراجعته
          </label>
        </>
      ),
      submit: 'حفظ إيصال التحصيل',
      payload: (f) => ({
        membershipId: m.id,
        version: m.version,
        amount: readMoney(text(f, 'amount')),
        method: text(f, 'method'),
        reference: text(f, 'reference'),
      }),
    })
  const renew = (m: GymMembership) => edit(membershipForm(s, memberOf(m), m))
  const freeze = (m: GymMembership) =>
    edit({
      title: 'تجميد اشتراك — ' + m.memberName,
      action: 'gym.membership.freeze',
      body: (
        <>
          <p>
            الرصيد {m.freezeDays - m.frozenDays} يومًا — النهاية الحالية{' '}
            {m.endDay}
          </p>
          <div className="gym-two">
            <Field label="من يوم">
              <input
                name="from"
                type="date"
                min={today() > m.startDay ? today() : m.startDay}
                max={m.endDay}
                defaultValue={today() > m.startDay ? today() : m.startDay}
                required
              />
            </Field>
            <Field label="حتى يوم، شامل">
              <input
                name="to"
                type="date"
                min={today() > m.startDay ? today() : m.startDay}
                max={m.endDay}
                required
              />
            </Field>
          </div>
          <Field label="سبب التجميد">
            <textarea name="reason" required maxLength={2000} />
          </Field>
          <p>
            تمتد النهاية بعدد أيام التجميد. إذا كان هناك تجديد أو موعد متداخل
            فلن يقبل التجميد.
          </p>
          <label className="a-check">
            <input type="checkbox" required />
            راجعت الفترة وأؤكد تجميد الاشتراك
          </label>
        </>
      ),
      payload: (f) => ({
        id: m.id,
        version: m.version,
        from: text(f, 'from'),
        to: text(f, 'to'),
        reason: text(f, 'reason'),
      }),
    })
  const assign = (m: GymMembership) =>
    edit({
      title: 'تكليف مدرب — ' + m.memberName,
      action: 'gym.membership.assign',
      body: (
        <>
          <Field label="المدرب">
            <select name="trainerId" defaultValue={m.trainerId ?? ''}>
              <option value="">بدون مدرب</option>
              {s.trainers
                .filter((t) => t.active)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="سبب التغيير">
            <textarea name="reason" required maxLength={2000} />
          </Field>
          <p>
            التغيير ينقل التكليف والجلسات القادمة ويزيل وصول المدرب السابق للعضو
            والاشتراك.
          </p>
        </>
      ),
      payload: (f) => ({
        id: m.id,
        version: m.version,
        trainerId: text(f, 'trainerId') || null,
        reason: text(f, 'reason'),
      }),
    })
  const userForm = (u?: User) =>
    edit({
      title: u ? 'تعديل مستخدم' : 'مستخدم جديد',
      action: 'user.save',
      body: (
        <>
          <div className="gym-two">
            <Field label="اسم المستخدم">
              <input
                name="username"
                required
                disabled={!!u}
                defaultValue={u?.username ?? ''}
                pattern="[A-Za-z0-9_.\-]{3,40}"
                maxLength={40}
              />
            </Field>
            <Field label="الاسم">
              <input
                name="name"
                required
                defaultValue={u?.name ?? ''}
                maxLength={160}
              />
            </Field>
            <Field label="الدور">
              <select name="role" defaultValue={u?.role ?? 'cashier'}>
                {Object.entries(roles).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={u ? 'كلمة مرور جديدة، اختياري' : 'كلمة المرور'}>
              <input
                name="password"
                type="password"
                required={!u}
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
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
        ...(passwordValue(f, 'password') && {
          password: passwordValue(f, 'password'),
        }),
      }),
    })
  const membershipRows = (rows: GymMembership[]) =>
    rows.length ? (
      <div className="gym-table">
        <table>
          <thead>
            <tr>
              <th>العضو</th>
              <th>الباقة والفترة</th>
              <th>الحالة والزيارات</th>
              <th>المدرب</th>
              {office && <th>المستحق</th>}
              <th>إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id}>
                <td>
                  <button
                    className="gym-link"
                    onClick={() => invoke(() => open('member', m.memberId))}
                  >
                    {m.memberName}
                  </button>
                  <small dir="ltr">{m.memberCode}</small>
                </td>
                <td>
                  <strong>{m.planName}</strong>
                  <small>
                    {m.startDay} ← {m.endDay}
                  </small>
                </td>
                <td>
                  <span
                    className={
                      'gym-badge ' + (status(m) === 'قائم' ? 'ok' : '')
                    }
                  >
                    {status(m)}
                  </span>
                  <small>
                    {m.used} / {m.visits ?? 'غير محدود'} زيارة
                  </small>
                </td>
                <td>{m.trainerName ?? 'بدون مدرب'}</td>
                {office && (
                  <td className="gym-number">{amount(m.balance ?? 0)} ج.م</td>
                )}
                <td>
                  <div className="gym-actions">
                    <button
                      disabled={busy}
                      onClick={() => invoke(() => open('membership', m.id))}
                    >
                      فتح
                    </button>
                    {office && (
                      <>
                        <button
                          disabled={
                            busy ||
                            !memberOf(m)?.active ||
                            !s.plans.some((p) => p.active)
                          }
                          onClick={() => renew(m)}
                        >
                          تجديد
                        </button>
                        {(m.balance ?? 0) > 0 && (
                          <button disabled={busy} onClick={() => collect(m)}>
                            تحصيل
                          </button>
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
      <Empty>لا توجد اشتراكات. أضف عضوًا وباقة ثم سجل أول اشتراك.</Empty>
    )
  const attendanceRows = (rows: GymAttendance[]) =>
    rows.length ? (
      <div className="gym-table">
        <table>
          <thead>
            <tr>
              <th>العضو</th>
              <th>اليوم والدخول</th>
              <th>الخروج</th>
              <th>الحالة</th>
              {office && <th>إجراءات</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <td>
                  {a.memberName}
                  <small dir="ltr">{a.memberCode}</small>
                </td>
                <td>
                  {a.day}
                  <small>{stamp(a.at)}</small>
                </td>
                <td>{a.outAt ? stamp(a.outAt) : '—'}</td>
                <td>
                  {a.voidReason
                    ? 'ملغى — ' + a.voidReason
                    : a.outAt
                      ? 'خرج'
                      : 'داخل الجيم'}
                </td>
                {office && (
                  <td>
                    <div className="gym-actions">
                      {!a.voidReason && !a.outAt && a.day === today() && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            edit({
                              title: 'تسجيل خروج — ' + a.memberName,
                              action: 'gym.attendance.out',
                              body: <p>تسجيل وقت الخروج الحالي لهذا العضو.</p>,
                              payload: () => ({ id: a.id }),
                              submit: 'تسجيل الخروج',
                            })
                          }
                        >
                          خروج
                        </button>
                      )}
                      {manager && !a.voidReason && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            ask(
                              'إلغاء تسجيل الحضور',
                              'gym.attendance.void',
                              { id: a.id },
                              <p>يستعيد رصيد الزيارة ويحفظ سبب التصحيح.</p>,
                            )
                          }
                        >
                          تصحيح التسجيل
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <Empty>لا يوجد حضور مسجل في هذا اليوم.</Empty>
    )
  const sessionRows = (rows: GymSession[], interactive = true) => {
    const Row = interactive ? 'button' : 'article'
    return rows.length ? (
      <div className="gym-session-list">
        {rows.map((b) => (
          <Row
            className="gym-session-row"
            key={b.id}
            disabled={interactive ? busy : undefined}
            onClick={
              interactive
                ? () => invoke(() => open('session', b.id))
                : undefined
            }
          >
            <span className="gym-time">
              {clock(b.startMinute)}
              <small>{b.duration} دقيقة</small>
            </span>
            <span>
              <strong>{b.memberName}</strong>
              <small>
                {b.title || 'جلسة تدريب'} — {b.trainerName}
              </small>
            </span>
            <span>
              {b.day}
              <small>{sessionLabels[b.status]}</small>
            </span>
            {interactive && <span>فتح ←</span>}
          </Row>
        ))}
      </div>
    ) : (
      <Empty>
        لا توجد جلسات لهذا اليوم. حدد المدرب من ملف الاشتراك ثم أضف موعدًا.
      </Empty>
    )
  }
  const paymentRows = (rows: GymPayment[]) =>
    rows.length ? (
      <div className="gym-table">
        <table>
          <thead>
            <tr>
              <th>الإيصال</th>
              <th>العضو</th>
              <th>الباقة</th>
              <th>المبلغ</th>
              <th>الحالة</th>
              <th>الإجراءات</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td>
                  <bdi>{p.number}</bdi>
                  <small>{stamp(p.at)}</small>
                </td>
                <td>
                  {p.member.name}
                  <small dir="ltr">{p.member.code}</small>
                </td>
                <td>{p.plan.name}</td>
                <td>
                  {amount(p.amount)} ج.م<small>{methods[p.method]}</small>
                </td>
                <td>{p.voidReason ? 'ملغى' : 'محفوظ'}</td>
                <td>
                  <div className="gym-actions">
                    <button
                      onClick={() => {
                        setReceipt(p)
                        setDetail(null)
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
                            'gym.payment.void',
                            { id: p.id },
                            <p>
                              يعكس المبلغ ويعيده للمستحق؛ لا ينفذ رد أموال
                              تلقائيًا.
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
  const history = (events: GymMemberDetail['events']) =>
    events.length ? (
      <section className="gym-history">
        <h3>سجل التغييرات</h3>
        {events.map((e) => (
          <div key={e.id}>
            <strong>{eventLabels[e.action] ?? e.action}</strong>
            <small>
              {stamp(e.at)} — {e.actorName}
            </small>
            {e.reason && <p>{e.reason}</p>}
          </div>
        ))}
      </section>
    ) : null
  async function lookup() {
    const request = scanGate.current.begin(),
      g = generation.current,
      ticket = gate.current.ticket()
    setAccess(null)
    setError('')
    const a = await call<GymAccess>('gym.access.get', { code: request.code })
    if (
      scanGate.current.accept(request) &&
      g === generation.current &&
      gate.current.current(ticket) &&
      scope.current?.user.role !== 'trainer'
    )
      setAccess(a)
  }
  return (
    <div className="gym-shell" dir="rtl">
      <aside className="gym-nav">
        <div className="gym-logo">
          <img src="./icon.svg" alt="" />
          <strong>
            XZARE<small>GYM / 0.1</small>
          </strong>
        </div>
        <p>{s.settings.businessName}</p>
        <nav aria-label="قائمة الجيم">
          {nav.map(([k, l]) => (
            <button
              key={k}
              className={activeView === k ? 'active' : ''}
              onClick={() => {
                setView(k)
                setQuery('')
                setError('')
              }}
            >
              {l}
            </button>
          ))}
        </nav>
        <div className="gym-nav-user">
          <strong>{s.user.name}</strong>
          <small>{roles[s.user.role as keyof typeof roles]}</small>
          <button disabled={busy} onClick={passwordForm}>
            تغيير كلمة المرور
          </button>
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
        </div>
      </aside>
      <main className="gym-main">
        <header className="gym-top">
          <div>
            <span className="gym-kicker">XZARE GYM</span>
            <h1>{pages[activeView]}</h1>
          </div>
          <WorkspaceClock english={false} />
          <button disabled={busy} onClick={refresh}>
            تحديث
          </button>
        </header>
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
        {activeView === 'reception' && office && (
          <>
            <section className="gym-reception">
              <div>
                <span className="gym-kicker">بوابة الحضور</span>
                <h2>العضو وصل؟ امسح البطاقة.</h2>
                <p>قارئ الباركود أو كود العضوية، ثم مراجعة وتسجيل الدخول.</p>
                <form
                  className="gym-scan"
                  onSubmit={(e) => {
                    e.preventDefault()
                    invoke(lookup)
                  }}
                >
                  <Field label="مسح باركود أو كود العضوية">
                    <input
                      value={scan}
                      onChange={(e) => {
                        scanGate.current.change(e.target.value)
                        setScan(e.target.value)
                        setAccess(null)
                      }}
                      placeholder="كود العضو"
                      dir="ltr"
                      autoComplete="off"
                      maxLength={64}
                      required
                    />
                  </Field>
                  <button type="submit" className="primary" disabled={busy}>
                    مراجعة العضوية
                  </button>
                </form>
              </div>
              <div className="gym-live">
                <strong>
                  {
                    s.attendance.filter(
                      (a) => a.day === today() && !a.voidReason && !a.outAt,
                    ).length
                  }
                </strong>
                <span>داخل الجيم الآن</span>
                <small>
                  {
                    s.attendance.filter(
                      (a) => a.day === today() && !a.voidReason,
                    ).length
                  }{' '}
                  حضور مسجل اليوم
                </small>
              </div>
            </section>
            {access && (
              <section
                className={
                  'gym-access ' + (access.allowed ? 'allowed' : 'blocked')
                }
              >
                <div>
                  <h2>{access.member.name}</h2>
                  <bdi>{access.member.code}</bdi>
                  <p>{access.reason}</p>
                  {access.membership && (
                    <small>
                      {access.membership.planName} ·{' '}
                      {access.membership.startDay} ← {access.membership.endDay}{' '}
                      · المستحق {amount(access.membership.balance ?? 0)} ج.م
                    </small>
                  )}
                </div>
                <div className="gym-actions">
                  <button
                    className="primary"
                    disabled={busy || !access.allowed || !access.membership}
                    onClick={() => {
                      const a = access
                      edit({
                        title: 'تسجيل دخول — ' + a.member.name,
                        action: 'gym.attendance.in',
                        body: (
                          <>
                            <p>
                              {a.membership!.planName} — آخر يوم{' '}
                              {a.membership!.endDay}
                            </p>
                            <label className="a-check">
                              <input type="checkbox" required />
                              راجعت هوية العضو وحضوره اليوم
                            </label>
                          </>
                        ),
                        payload: () => ({
                          membershipId: a.membership!.id,
                          version: a.membership!.version,
                          memberVersion: a.member.version,
                        }),
                        submit: 'تسجيل دخول العضو',
                      })
                    }}
                  >
                    تسجيل الدخول
                  </button>
                  {access.membership && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        invoke(() => open('membership', access.membership!.id))
                      }
                    >
                      ملف الاشتراك
                    </button>
                  )}
                  <button
                    onClick={() =>
                      invoke(() => open('member', access.member.id))
                    }
                  >
                    ملف العضو
                  </button>
                </div>
              </section>
            )}
            <div className="gym-section-head">
              <h2>حركة اليوم</h2>
              <button disabled={busy} onClick={() => edit(memberForm())}>
                عضو جديد
              </button>
            </div>
            {attendanceRows(s.attendance.filter((a) => a.day === today()))}
            <div className="gym-section-head">
              <h2>تنتهي خلال 7 أيام</h2>
              <button onClick={() => setView('memberships')}>
                كل الاشتراكات
              </button>
            </div>
            {membershipRows(
              s.memberships.filter(
                (m) =>
                  m.status === 'active' &&
                  m.endDay >= today() &&
                  m.endDay <= addDay(today(), 7),
              ),
            )}
          </>
        )}
        {activeView === 'members' && (
          <>
            <div className="gym-toolbar">
              <Field label="بحث الأعضاء">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="الاسم أو الكود أو الهاتف"
                />
              </Field>
              {office && (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => edit(memberForm())}
                >
                  عضو جديد
                </button>
              )}
            </div>
            {s.members.length ? (
              <div className="gym-table">
                <table>
                  <thead>
                    <tr>
                      <th>العضو</th>
                      {office && <th>التواصل</th>}
                      <th>الحالة</th>
                      <th>الإجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.members
                      .filter((m) =>
                        matches(m.name + ' ' + m.code + ' ' + (m.phone ?? '')),
                      )
                      .map((m) => (
                        <tr key={m.id}>
                          <td>
                            <strong>{m.name}</strong>
                            <small dir="ltr">{m.code}</small>
                          </td>
                          {office && <td dir="ltr">{m.phone || '—'}</td>}
                          <td>{m.active ? 'نشط' : 'متوقف'}</td>
                          <td>
                            <div className="gym-actions">
                              <button
                                onClick={() =>
                                  invoke(() => open('member', m.id))
                                }
                              >
                                فتح الملف
                              </button>
                              {office && (
                                <>
                                  <button
                                    disabled={busy}
                                    onClick={() => edit(memberForm(m))}
                                  >
                                    تعديل
                                  </button>
                                  <button
                                    onClick={() => {
                                      setCard(m)
                                      setDetail(null)
                                    }}
                                  >
                                    بطاقة العضو
                                  </button>
                                  <button
                                    disabled={
                                      busy ||
                                      !m.active ||
                                      !s.plans.some((p) => p.active)
                                    }
                                    onClick={() => edit(membershipForm(s, m))}
                                  >
                                    اشتراك جديد
                                  </button>
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
                  ? 'أضف أول عضو ببياناته الفعلية.'
                  : 'لا يوجد أعضاء مكلف بهم. راجع مدير الجيم لتحديد الاشتراكات الخاصة بك.'}
              </Empty>
            )}
          </>
        )}
        {activeView === 'memberships' && (
          <>
            <div className="gym-toolbar">
              <Field label="بحث الاشتراكات">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="اسم العضو أو الكود أو الباقة"
                />
              </Field>
              <button
                onClick={() =>
                  csv('Gym-memberships.csv', [
                    [
                      'العضو',
                      'الكود',
                      'الباقة',
                      'البداية',
                      'النهاية',
                      'الحالة',
                      'الزيارات',
                    ],
                    ...s.memberships.map((m) => [
                      m.memberName,
                      m.memberCode,
                      m.planName,
                      m.startDay,
                      m.endDay,
                      status(m),
                      m.used,
                    ]),
                  ])
                }
              >
                تصدير CSV
              </button>
            </div>
            {membershipRows(
              s.memberships.filter((m) =>
                matches(m.memberName + ' ' + m.memberCode + ' ' + m.planName),
              ),
            )}
          </>
        )}
        {activeView === 'sessions' && (
          <>
            <div className="gym-toolbar">
              <Field label="يوم التدريب">
                <input
                  type="date"
                  value={day}
                  onChange={(e) => setDay(e.target.value)}
                />
              </Field>
              <button
                onClick={() =>
                  csv('Gym-training.csv', [
                    [
                      'العضو',
                      'الكود',
                      'المدرب',
                      'اليوم',
                      'الوقت',
                      'المدة',
                      'الحالة',
                    ],
                    ...s.sessions
                      .filter((b) => b.day === day)
                      .map((b) => [
                        b.memberName,
                        b.memberCode,
                        b.trainerName,
                        b.day,
                        clock(b.startMinute),
                        b.duration,
                        sessionLabels[b.status],
                      ]),
                  ])
                }
              >
                تصدير الجدول
              </button>
            </div>
            {sessionRows(s.sessions.filter((b) => b.day === day))}
            <div className="gym-section-head">
              <h2>الحضور المسجل</h2>
              <button
                onClick={() =>
                  csv('Gym-attendance.csv', [
                    ['العضو', 'الكود', 'اليوم', 'الدخول', 'الخروج', 'التصحيح'],
                    ...s.attendance
                      .filter((a) => a.day === day)
                      .map((a) => [
                        a.memberName,
                        a.memberCode,
                        a.day,
                        stamp(a.at),
                        a.outAt ? stamp(a.outAt) : '',
                        a.voidReason ?? '',
                      ]),
                  ])
                }
              >
                تصدير الحضور
              </button>
            </div>
            {attendanceRows(s.attendance.filter((a) => a.day === day))}
          </>
        )}
        {activeView === 'plans' && manager && (
          <>
            <div className="gym-section-head">
              <h2>باقات الاشتراك</h2>
              <button
                className="primary"
                disabled={busy}
                onClick={() => edit(planForm())}
              >
                باقة جديدة
              </button>
            </div>
            {s.plans.length ? (
              <div className="gym-table">
                <table>
                  <thead>
                    <tr>
                      <th>الباقة</th>
                      <th>السعر والمدة</th>
                      <th>الزيارات والتجميد</th>
                      <th>الحالة</th>
                      <th>الإجراء</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.plans.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <strong>{p.name}</strong>
                          <small dir="ltr">{p.code}</small>
                        </td>
                        <td>
                          {amount(p.fee ?? 0)} ج.م<small>{p.days} يومًا</small>
                        </td>
                        <td>
                          {p.visits ?? 'غير محدود'} زيارة
                          <small>تجميد {p.freezeDays} يومًا</small>
                        </td>
                        <td>{p.active ? 'متاحة' : 'متوقفة'}</td>
                        <td>
                          <button
                            disabled={busy}
                            onClick={() => edit(planForm(p))}
                          >
                            تعديل
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>حدد المدة والسعر وحدود الزيارات لأول باقة.</Empty>
            )}
            <div className="gym-section-head">
              <h2>المدربون</h2>
              <button disabled={busy} onClick={() => edit(trainerForm(s))}>
                مدرب جديد
              </button>
            </div>
            {s.trainers.length ? (
              <div className="gym-table">
                <table>
                  <thead>
                    <tr>
                      <th>المدرب</th>
                      <th>التواصل</th>
                      <th>الحساب</th>
                      <th>الحالة</th>
                      <th>الإجراء</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.trainers.map((t) => (
                      <tr key={t.id}>
                        <td>
                          {t.name}
                          <small dir="ltr">{t.code}</small>
                        </td>
                        <td dir="ltr">{t.phone || '—'}</td>
                        <td>
                          {s.trainerAccounts.find((u) => u.id === t.userId)
                            ?.username ?? 'غير مرتبط'}
                        </td>
                        <td>{t.active ? 'نشط' : 'متوقف'}</td>
                        <td>
                          <button
                            disabled={busy}
                            onClick={() => edit(trainerForm(s, t))}
                          >
                            تعديل
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>أضف المدرب ثم كلفه باشتراك عضو.</Empty>
            )}
          </>
        )}
        {activeView === 'fees' && office && (
          <>
            <div className="gym-section-head">
              <h2>المبالغ المستحقة</h2>
            </div>
            {membershipRows(s.memberships.filter((m) => (m.balance ?? 0) > 0))}
            <div className="gym-section-head">
              <h2>الإيصالات</h2>
              <button
                onClick={() =>
                  csv('Gym-receipts.csv', [
                    [
                      'رقم الإيصال',
                      'العضو',
                      'الباقة',
                      'المبلغ',
                      'الطريقة',
                      'التوقيت',
                      'سبب الإلغاء',
                    ],
                    ...s.payments.map((p) => [
                      p.number,
                      p.member.name,
                      p.plan.name,
                      decimal(p.amount),
                      methods[p.method],
                      stamp(p.at),
                      p.voidReason ?? '',
                    ]),
                  ])
                }
              >
                تصدير الإيصالات
              </button>
            </div>
            {paymentRows(s.payments)}
          </>
        )}
        {activeView === 'reports' && (
          <>
            <div className="gym-toolbar">
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
                      csv('Gym-report.csv', [
                        ['المؤشر', 'القيمة'],
                        ['من', report.from],
                        ['حتى', report.to],
                        ['الأعضاء', report.memberCount],
                        ['اشتراكات قائمة', report.activeCount],
                        [
                          'زيارات غير ملغاة',
                          report.attendance.filter((a) => !a.voidReason).length,
                        ],
                        ...(report.finance
                          ? [
                              [
                                'صافي التحصيل',
                                decimal(report.finance.netCollected),
                              ],
                              [
                                'إيصالات ألغيت في الفترة',
                                decimal(report.finance.voided),
                              ],
                              [
                                'المستحق الحالي',
                                decimal(report.finance.outstanding),
                              ],
                            ]
                          : []),
                      ])
                    }
                  >
                    تصدير التقرير
                  </button>
                </>
              )}
            </div>
            {report ? (
              <section className="gym-report print-area">
                <h2>{s.settings.businessName} — تقرير Gym</h2>
                <p>
                  {from} ← {to}
                </p>
                <div className="gym-stats">
                  <div>
                    <strong>{report.memberCount}</strong>
                    <span>أعضاء حاليون</span>
                  </div>
                  <div>
                    <strong>{report.activeCount}</strong>
                    <span>اشتراكات ضمن الفترة اليوم</span>
                  </div>
                  <div>
                    <strong>
                      {report.attendance.filter((a) => !a.voidReason).length}
                    </strong>
                    <span>زيارة في الفترة</span>
                  </div>
                  {report.finance && (
                    <>
                      <div>
                        <strong>{amount(report.finance.netCollected)}</strong>
                        <span>صافي التحصيل، ج.م</span>
                      </div>
                      <div>
                        <strong>{amount(report.finance.outstanding)}</strong>
                        <span>المستحق الحالي، ج.م</span>
                      </div>
                      <div>
                        <strong>{amount(report.finance.voided)}</strong>
                        <span>إيصالات ألغيت في الفترة، ج.م</span>
                      </div>
                    </>
                  )}
                </div>
                <p className="muted">
                  الأعضاء والاشتراكات والمستحق مؤشرات حالية؛ التحصيل والحضور
                  للفترة المختارة. التواريخ حسب المنطقة الزمنية المحلية لهذا
                  الجهاز.
                </p>
                <h3>الحضور</h3>
                {attendanceRows(report.attendance)}
                <h3>جلسات التدريب</h3>
                {sessionRows(report.sessions, false)}
              </section>
            ) : (
              <Empty>اختر فترة صحيحة حتى 366 يومًا.</Empty>
            )}
          </>
        )}
        {activeView === 'users' && admin && (
          <>
            <div className="gym-section-head">
              <h2>حسابات الفريق</h2>
              <button
                className="primary"
                disabled={busy}
                onClick={() => userForm()}
              >
                مستخدم جديد
              </button>
            </div>
            <div className="gym-table">
              <table>
                <thead>
                  <tr>
                    <th>الاسم</th>
                    <th>المستخدم</th>
                    <th>الدور</th>
                    <th>الحالة</th>
                    <th>الإجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {s.users.map((u) => (
                    <tr key={u.id}>
                      <td>{u.name}</td>
                      <td dir="ltr">{u.username}</td>
                      <td>{roles[u.role as keyof typeof roles]}</td>
                      <td>{u.active ? 'نشط' : 'متوقف'}</td>
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
        {activeView === 'audit' && admin && (
          <div className="gym-table">
            <table>
              <thead>
                <tr>
                  <th>الوقت</th>
                  <th>المستخدم</th>
                  <th>العملية</th>
                </tr>
              </thead>
              <tbody>
                {s.audit.map((a) => (
                  <tr key={a.id}>
                    <td>{stamp(a.at)}</td>
                    <td>{a.user_name ?? 'النظام'}</td>
                    <td>{eventLabels[a.action] ?? a.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {activeView === 'settings' && admin && (
          <div className="gym-settings">
            <section>
              <h2>بيانات الجيم</h2>
              <p>
                {s.settings.businessName}
                <br />
                {s.settings.phone}
                <br />
                {s.settings.address}
              </p>
              <button
                disabled={busy}
                onClick={() =>
                  edit({
                    title: 'بيانات الجيم والإيصالات',
                    action: 'settings.save',
                    body: (
                      <>
                        <Field label="اسم الجيم">
                          <input
                            name="businessName"
                            defaultValue={s.settings.businessName}
                            required
                            maxLength={160}
                          />
                        </Field>
                        <Field label="هاتف الجيم">
                          <input
                            name="phone"
                            defaultValue={s.settings.phone}
                            maxLength={40}
                            dir="ltr"
                          />
                        </Field>
                        <Field label="العنوان">
                          <input
                            name="address"
                            defaultValue={s.settings.address}
                            maxLength={250}
                          />
                        </Field>
                        <Field label="تذييل الإيصال">
                          <input
                            name="receiptFooter"
                            defaultValue={s.settings.receiptFooter}
                            maxLength={250}
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
                      language: s.settings.language === 'en' ? 'en' : 'ar',
                      taxBps: 0,
                    }),
                  })
                }
              >
                تعديل البيانات
              </button>
              <p className="muted">
                العملة الحالية: الجنيه المصري. تاريخ التشغيل وفق المنطقة الزمنية
                لهذا الجهاز.
              </p>
            </section>
            <section>
              <h2>الترخيص</h2>
              <LicensePanel />
            </section>
            <section>
              <h2>النسخ الاحتياطي</h2>
              <p>
                قاعدة البيانات والنسخ غير مشفرة. احفظهما في مكان موثوق؛ مفتاح
                الجهاز محمي في نسخة Windows.
              </p>
              <div className="gym-actions">
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
                            r.fileName ?? 'Gym.xzbak',
                            new Blob([
                              Uint8Array.from(atob(r.download), (c) =>
                                c.charCodeAt(0),
                              ),
                            ]),
                          )
                        if (!r.cancelled)
                          setNotice('تم إنشاء النسخة الاحتياطية')
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
                      title: 'استعادة نسخة Gym',
                      action: 'backup.restore',
                      body: (
                        <>
                          <p>
                            تستبدل بيانات الجيم وتنهي الجلسات، مع حفظ نسخة قبل
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
              <h2>دعم Xzare</h2>
              <p dir="ltr">
                hello@xzare.com
                <br />
                +201501230440
              </p>
            </section>
          </div>
        )}
        <footer className="gym-footer">
          XZARE SOFTWARE SOLUTIONS · GYM / 0.1{' '}
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
                      throw Error('اختر نسخة صحيحة حتى 128 ميجابايت')
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
                    if (!r.ok || !v.ok) throw Error(v.error ?? 'تعذر الاستعادة')
                    end()
                  }
                })
              else {
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
      {detail?.kind === 'member' && (
        <Modal
          title={detail.data.member.name}
          busy={busy}
          error={error}
          manual
          onClose={() => setDetail(null)}
        >
          <p dir="ltr">
            {detail.data.member.code}
            {office && ' · ' + (detail.data.member.phone || '')}
          </p>
          {office && (
            <>
              <p>{detail.data.member.note}</p>
              <div className="gym-actions">
                <button
                  disabled={busy}
                  onClick={() => edit(memberForm(detail.data.member))}
                >
                  تعديل بيانات العضو
                </button>
                <button
                  onClick={() => {
                    setCard(detail.data.member)
                    setDetail(null)
                  }}
                >
                  بطاقة العضو
                </button>
                <button
                  disabled={
                    busy ||
                    !detail.data.member.active ||
                    !s.plans.some((p) => p.active)
                  }
                  onClick={() => edit(membershipForm(s, detail.data.member))}
                >
                  اشتراك جديد
                </button>
              </div>
            </>
          )}
          <h3>اشتراكات العضو</h3>
          {membershipRows(detail.data.memberships)}
          {history(detail.data.events)}
        </Modal>
      )}
      {detail?.kind === 'membership' && (
        <Modal
          title={'اشتراك — ' + detail.data.membership.memberName}
          busy={busy}
          error={error}
          manual
          onClose={() => setDetail(null)}
        >
          <p>
            {detail.data.membership.planName} ·{' '}
            {detail.data.membership.startDay} ← {detail.data.membership.endDay}{' '}
            · {status(detail.data.membership)}
          </p>
          <div className="gym-review">
            <span>
              الزيارات {detail.data.membership.used} /{' '}
              {detail.data.membership.visits ?? 'غير محدود'}
            </span>
            <span>
              التجميد المستهلك {detail.data.membership.frozenDays} /{' '}
              {detail.data.membership.freezeDays} يومًا
            </span>
            <span>{detail.data.membership.trainerName ?? 'بدون مدرب'}</span>
            {office && (
              <strong>
                المستحق {amount(detail.data.membership.balance ?? 0)} ج.م
              </strong>
            )}
          </div>
          <div className="gym-actions">
            {office && (
              <>
                <button
                  disabled={
                    busy ||
                    !memberOf(detail.data.membership)?.active ||
                    !s.plans.some((p) => p.active)
                  }
                  onClick={() => renew(detail.data.membership)}
                >
                  تجديد الاشتراك
                </button>
                {(detail.data.membership.balance ?? 0) > 0 && (
                  <button
                    disabled={busy}
                    onClick={() => collect(detail.data.membership)}
                  >
                    تحصيل
                  </button>
                )}
                <button
                  disabled={
                    busy ||
                    !detail.data.membership.trainerId ||
                    detail.data.membership.status !== 'active'
                  }
                  onClick={() => edit(bookingForm(detail.data.membership))}
                >
                  موعد تدريب
                </button>
              </>
            )}
            {manager && (
              <>
                <button
                  disabled={busy || detail.data.membership.status !== 'active'}
                  onClick={() => freeze(detail.data.membership)}
                >
                  تجميد فترة
                </button>
                <button
                  disabled={busy}
                  onClick={() => assign(detail.data.membership)}
                >
                  تكليف المدرب
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    ask(
                      'إيقاف الاشتراك',
                      'gym.membership.stop',
                      {
                        id: detail.id,
                        version: detail.data.membership.version,
                      },
                      <p>
                        يوقف الدخول ويلغي الجلسات القادمة؛ الرسوم والإيصالات
                        والمستحق تبقى محفوظة دون رد مال تلقائي.
                      </p>,
                    )
                  }
                >
                  إيقاف
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    ask(
                      'إلغاء تسجيل الاشتراك',
                      'gym.membership.cancel',
                      {
                        id: detail.id,
                        version: detail.data.membership.version,
                      },
                      <p>
                        متاح قبل التحصيل والحضور والحجز والتجميد فقط، ويعكس
                        الرسوم.
                      </p>,
                    )
                  }
                >
                  إلغاء التسجيل
                </button>
                {(detail.data.membership.balance ?? 0) > 0 && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      edit({
                        title: 'تخفيض مستحق معتمد',
                        action: 'gym.credit.post',
                        body: (
                          <>
                            <p>
                              المستحق{' '}
                              {amount(detail.data.membership.balance ?? 0)} ج.م
                            </p>
                            <Field label="قيمة التخفيض، ج.م">
                              <input
                                name="amount"
                                type="number"
                                required
                                min="0.01"
                                step="0.01"
                                max={
                                  (detail.data.membership.balance ?? 0) / 100
                                }
                              />
                            </Field>
                            <Field label="سبب التخفيض">
                              <textarea
                                name="reason"
                                required
                                maxLength={2000}
                              />
                            </Field>
                          </>
                        ),
                        payload: (f) => ({
                          membershipId: detail.id,
                          version: detail.data.membership.version,
                          amount: readMoney(text(f, 'amount')),
                          reason: text(f, 'reason'),
                        }),
                      })
                    }
                  >
                    تخفيض معتمد
                  </button>
                )}
              </>
            )}
          </div>
          {detail.data.freezes.length > 0 && (
            <>
              <h3>فترات التجميد</h3>
              {detail.data.freezes.map((f) => (
                <p key={f.id}>
                  {f.from} ← {f.to} · {f.days} يومًا {office && '— ' + f.reason}
                </p>
              ))}
            </>
          )}
          <h3>الحضور</h3>
          {attendanceRows(detail.data.attendance)}
          <h3>التدريب</h3>
          {sessionRows(detail.data.sessions)}
          {office && (
            <>
              <h3>كشف الرسوم</h3>
              <div className="gym-table">
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
                    {detail.data.ledger.map((l) => (
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
              {paymentRows(detail.data.payments)}
            </>
          )}
          {history(detail.data.events)}
        </Modal>
      )}
      {detail?.kind === 'session' && (
        <Modal
          title={'جلسة تدريب — ' + detail.data.session.memberName}
          busy={busy}
          error={error}
          manual
          onClose={() => setDetail(null)}
        >
          <p>
            {detail.data.session.day} · {clock(detail.data.session.startMinute)}{' '}
            · {detail.data.session.duration} دقيقة
          </p>
          <p>
            {detail.data.session.trainerName} —{' '}
            {sessionLabels[detail.data.session.status]}
          </p>
          {office && (
            <p>
              {detail.data.session.title}
              <br />
              {detail.data.session.note}
            </p>
          )}
          <div className="gym-actions">
            {office && detail.data.session.status === 'scheduled' && (
              <>
                <button
                  disabled={busy}
                  onClick={() => {
                    const m = s.memberships.find(
                      (m) => m.id === detail.data.session.membershipId,
                    )
                    if (m) edit(bookingForm(m, detail.data.session))
                  }}
                >
                  تعديل الموعد
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    ask('إلغاء الموعد', 'gym.session.cancel', {
                      id: detail.id,
                      version: detail.data.session.version,
                    })
                  }
                >
                  إلغاء الموعد
                </button>
              </>
            )}
            {(manager || s.user.role === 'trainer') &&
              detail.data.session.status !== 'cancelled' &&
              detail.data.session.day <= today() && (
                <button
                  disabled={
                    busy ||
                    (!manager && detail.data.session.status !== 'scheduled')
                  }
                  onClick={() =>
                    edit({
                      title: 'تسجيل نتيجة الجلسة',
                      action: 'gym.session.mark',
                      body: (
                        <>
                          <Field label="نتيجة التدريب">
                            <select name="status">
                              <option value="done">تم التدريب</option>
                              <option value="no-show">لم يحضر</option>
                            </select>
                          </Field>
                          <Field label="ملاحظة التسجيل أو التصحيح">
                            <textarea name="note" required maxLength={2000} />
                          </Field>
                          <p>
                            يسجل الواقع الذي راجعه المدرب، دون تقييم طبي أو قرار
                            أهلية.
                          </p>
                        </>
                      ),
                      payload: (f) => ({
                        id: detail.id,
                        version: detail.data.session.version,
                        status: text(f, 'status'),
                        note: text(f, 'note'),
                      }),
                    })
                  }
                >
                  تسجيل نتيجة التدريب
                </button>
              )}
          </div>
          {history(detail.data.events)}
        </Modal>
      )}
      {card && office && (
        <Modal
          title="بطاقة العضو"
          busy={busy}
          error=""
          manual
          onClose={() => setCard(null)}
        >
          <MemberCard member={card} business={s.settings.businessName ?? ''} />
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
          <div className="gym-receipt print-area">
            <h2>{receipt.business.businessName}</h2>
            <p>
              {receipt.business.phone}
              <br />
              {receipt.business.address}
            </p>
            <h3>
              <bdi>{receipt.number}</bdi>
            </h3>
            {receipt.voidReason && (
              <strong className="gym-void">
                إيصال ملغى — {receipt.voidReason}
              </strong>
            )}
            <p>
              {receipt.member.name} — <bdi>{receipt.member.code}</bdi>
            </p>
            <p>{receipt.plan.name}</p>
            <strong className="gym-receipt-total">
              {amount(receipt.amount)} ج.م
            </strong>
            <p>
              {methods[receipt.method]} · {receipt.reference}
            </p>
            <p>
              {stamp(receipt.at)} · {receipt.actorName}
            </p>
            <p>{receipt.business.receiptFooter}</p>
          </div>
          <button onClick={() => window.print()}>طباعة الإيصال</button>
        </Modal>
      )}
    </div>
  )
}
