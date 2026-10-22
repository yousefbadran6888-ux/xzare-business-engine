import { useState, useEffect, useRef, type ReactNode } from 'react'
import { ulid } from '@xzare/core'
import type {
  HotelState,
  HotelRoom,
  HotelReservation,
  HotelDetail,
  HotelGuestDetail,
  HotelPayment,
  HotelReport,
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
  roomForm,
  guestForm,
  reservationForm,
  decision,
  payForm,
  chargeForm,
  correction,
  userForm,
  passwordForm,
  text,
  type FormSpec,
} from './Forms'
import {
  roles,
  statuses,
  cleanLabels,
  methods,
  ledgerLabels,
  stamp,
  addDay,
  eventLabel,
  passwordValue,
} from './model'
import { exclusive } from './exclusive'
import { HotelScope, freshCaptured } from './scope'
const pages = {
  desk: 'الاستقبال',
  reservations: 'الحجوزات',
  stays: 'الإقامات والحسابات',
  housekeeping: 'تجهيز الغرف',
  guests: 'النزلاء',
  reports: 'التقارير',
  users: 'المستخدمون',
  audit: 'سجل التدقيق',
  settings: 'الإعدادات والترخيص',
}
type View = keyof typeof pages
type Detail = {
  id: string
  kind: 'reservation' | 'guest'
  data: HotelDetail | HotelGuestDetail
}
type Document = { id: string; reservationId: string; data: HotelPayment }
export function App() {
  const [s, setS] = useState<HotelState | null>(null),
    [configured, setConfigured] = useState<boolean | null>(null),
    [view, setView] = useState<View>('desk'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [form, setForm] = useState<FormSpec | null>(null),
    [detail, setDetail] = useState<Detail | null>(null),
    [document, setDocument] = useState<Document | null>(null),
    [search, setSearch] = useState(''),
    [status, setStatus] = useState('all'),
    [day, setDay] = useState(today()),
    [arrival, setArrival] = useState(today()),
    [departure, setDeparture] = useState(addDay(today(), 1)),
    [adults, setAdults] = useState(1),
    [available, setAvailable] = useState<HotelRoom[] | null>(null),
    [from, setFrom] = useState(today().slice(0, 8) + '01'),
    [to, setTo] = useState(today()),
    [report, setReport] = useState<HotelReport | null>(null)
  const mutex = useRef(false),
    generation = useRef(0),
    loadSeq = useRef(0),
    detailSeq = useRef(0),
    scope = useRef(new HotelScope()),
    stateRef = useRef<HotelState | null>(null),
    detailRef = useRef<Detail | null>(null),
    documentRef = useRef<Document | null>(null),
    requests = useRef(new Map<string, string>())
  detailRef.current = detail
  documentRef.current = document
  const end = () => {
    generation.current++
    loadSeq.current++
    detailSeq.current++
    scope.current.clear()
    stateRef.current = null
    setS(null)
    setForm(null)
    setDetail(null)
    setDocument(null)
    setReport(null)
    setAvailable(null)
    setView('desk')
    setSearch('')
    setError('')
    setNotice('')
    requests.current.clear()
  }
  const fail = (e: unknown) => {
    const m = e instanceof Error ? e.message : 'تعذر إتمام العملية'
    if (/انتهت الجلسة|سجّل الدخول/.test(m)) end()
    setError(m)
  }
  useSessionActivity(!!s, () => {
    end()
    setError('انتهت الجلسة؛ سجّل الدخول مرة أخرى')
  })
  async function load() {
    const seq = ++loadSeq.current,
      g = generation.current,
      captured = detailRef.current,
      capturedDocument = documentRef.current
    const v = await call<HotelState>('hotel.state')
    let fresh: Detail | null = null,
      freshDoc: Document | null = null
    if (captured) {
      try {
        const data = await call<HotelDetail | HotelGuestDetail>(
          'hotel.' + captured.kind + '.get',
          { id: captured.id },
        )
        fresh = { ...captured, data }
      } catch {}
    }
    if (capturedDocument) {
      try {
        const d = await call<HotelDetail>('hotel.reservation.get', {
            id: capturedDocument.reservationId,
          }),
          payment = d.payments.find((p) => p.id === capturedDocument.id)
        if (payment) freshDoc = { ...capturedDocument, data: payment }
      } catch {}
    }
    if (g !== generation.current || seq !== loadSeq.current) return
    const lost = scope.current.update(v.user)
    if (lost) {
      generation.current++
      setForm(null)
      setReport(null)
      setAvailable(null)
      setView('desk')
      requests.current.clear()
    }
    stateRef.current = v
    setS(v)
    setDetail((d) => freshCaptured(d, captured, fresh, lost))
    setDocument((d) => freshCaptured(d, capturedDocument, freshDoc, lost))
  }
  useEffect(() => {
    void call<{ configured: boolean }>('auth.status')
      .then((v) => {
        setConfigured(v.configured)
        if (v.configured) void load().catch(() => {})
      })
      .catch(fail)
  }, [])
  useEffect(() => {
    if (!s) return
    const timer = setInterval(() => {
      if (!mutex.current) void load().catch(fail)
    }, 15000)
    return () => clearInterval(timer)
  }, [s?.user.id])
  useEffect(() => {
    if (!s || view !== 'reports' || !['admin', 'manager'].includes(s.user.role))
      return
    let live = true
    const g = generation.current,
      t = scope.current.ticket()
    setReport(null)
    void call<HotelReport>('hotel.report', { from, to })
      .then((r) => {
        if (live && g === generation.current && scope.current.current(t))
          setReport(r)
      })
      .catch((e) => {
        if (live) fail(e)
      })
    return () => {
      live = false
    }
  }, [s, view, from, to])
  async function authenticate(v: AuthValues) {
    setError('')
    try {
      await exclusive(mutex, setBusy, async () => {
        await call(
          configured ? 'login' : 'setup',
          configured
            ? { username: v.username.trim(), password: v.password }
            : v,
        )
        setConfigured(true)
        await load()
      })
    } catch (e) {
      fail(e)
      throw e
    }
  }
  async function run(action: string, p: Record<string, unknown>) {
    const g = generation.current
    await exclusive(mutex, setBusy, async () => {
      const key = JSON.stringify({ action, p }),
        txn = requests.current.get(key) ?? ulid()
      requests.current.set(key, txn)
      await call(
        action,
        action.startsWith('hotel.') ? { ...p, clientTxnId: txn } : p,
      )
      if (g !== generation.current) return
      requests.current.delete(key)
      if (action === 'password.change') {
        end()
        setNotice('تم تغيير كلمة المرور؛ سجّل الدخول من جديد')
        return
      }
      setNotice('تم حفظ العملية')
      setAvailable(null)
      await load()
    })
  }
  const openForm = (f: FormSpec) => {
    if (mutex.current) return
    setError('')
    setForm(f)
    setDetail(null)
    setDocument(null)
  }
  async function show(kind: 'reservation' | 'guest', id: string) {
    if (mutex.current) return
    const seq = ++detailSeq.current,
      g = generation.current,
      t = scope.current.ticket()
    setError('')
    try {
      await exclusive(mutex, setBusy, async () => {
        const data = await call<HotelDetail | HotelGuestDetail>(
          'hotel.' + kind + '.get',
          { id },
        )
        if (
          seq === detailSeq.current &&
          g === generation.current &&
          scope.current.current(t)
        ) {
          setForm(null)
          setDetail({ id, kind, data })
          setDocument(null)
        }
      })
    } catch (e) {
      fail(e)
    }
  }
  async function backup() {
    setError('')
    try {
      await exclusive(mutex, setBusy, async () => {
        const r = await call<{
          download?: string
          fileName?: string
          cancelled?: boolean
        }>('backup.create')
        if (r.download && r.fileName) {
          const bytes = Uint8Array.from(atob(r.download), (c) =>
            c.charCodeAt(0),
          )
          download(r.fileName, new Blob([bytes]))
        }
        if (!r.cancelled) setNotice('تم إنشاء النسخة الاحتياطية')
      })
    } catch (e) {
      fail(e)
    }
  }
  function restoreForm() {
    openForm({
      title: 'استعادة نسخة احتياطية',
      action: 'backup.restore',
      content: (
        <>
          <p className="review">
            الاستعادة تستبدل بيانات الفندق الحالية. تأكد من وجود نسخة حديثة قبل
            المتابعة.
          </p>
          <Field label="كلمة مرور المسؤول الحالية">
            <input name="password" type="password" required maxLength={128} />
          </Field>
          {!window.xzare && (
            <Field label="ملف النسخة">
              <input name="file" type="file" accept=".xzbak" required />
            </Field>
          )}
        </>
      ),
      payload: (f) => ({
        password: passwordValue(f, 'password'),
        file: f.get('file'),
      }),
      submit: 'استعادة البيانات',
    })
  }
  async function submit(f: FormSpec, fd: FormData) {
    setError('')
    try {
      const p = f.payload(fd)
      if (f.action === 'backup.restore')
        await exclusive(mutex, setBusy, async () => {
          if (window.xzare) {
            const r = await call<{ restored?: boolean; cancelled?: boolean }>(
              'backup.restore',
              { password: p.password },
            )
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
                credentials: 'same-origin',
                headers: {
                  'X-Xzare-Request': '1',
                  'X-Xzare-Password': encodeURIComponent(String(p.password)),
                },
                body: p.file,
              }),
              v = await r.json()
            if (!r.ok || !v.ok) throw Error(v.error ?? 'تعذر الاستعادة')
            end()
          }
        })
      else {
        await run(f.action, p)
        setForm(null)
      }
    } catch (e) {
      fail(e)
    }
  }
  if (!s)
    return (
      <AuthScreen
        configured={configured}
        busy={busy}
        error={error || notice}
        onAuthenticate={authenticate}
      />
    )
  const manager = ['admin', 'manager'].includes(s.user.role),
    admin = s.user.role === 'admin',
    filtered = s.reservations.filter(
      (r) =>
        (status === 'all' || r.status === status) &&
        [r.number, r.guest.name, r.room.code, r.guest.phone]
          .join(' ')
          .toLowerCase()
          .includes(search.toLowerCase()),
    ),
    inHouse = s.reservations.filter((r) => r.status === 'in-house'),
    due = s.reservations.reduce((n, r) => n + r.balance, 0),
    arrivals = s.reservations.filter(
      (r) => r.status === 'reserved' && r.arrival === day,
    ),
    departures = inHouse.filter((r) => r.departure <= day),
    activeRooms = s.rooms.filter((r) => r.active),
    ready = activeRooms.filter(
      (r) =>
        !r.blocked &&
        r.cleanliness === 'ready' &&
        !inHouse.some((b) => b.roomId === r.id),
    ),
    occupancy = activeRooms.length
      ? Math.round((inHouse.length / activeRooms.length) * 100)
      : 0
  function ReservationTable({ rows }: { rows: HotelReservation[] }) {
    return rows.length ? (
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>الحجز / النزيل</th>
              <th>الغرفة</th>
              <th>الوصول ← المغادرة</th>
              <th>الحالة</th>
              <th>الإجمالي</th>
              <th>المستحق</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <strong>{r.guest.name}</strong>
                  <small>
                    {r.number} · {r.adults} نزيل
                  </small>
                </td>
                <td>
                  {r.room.code}
                  <small>{r.room.category}</small>
                </td>
                <td dir="ltr">
                  {r.arrival} → {r.departure}
                  <small>{r.nights} ليلة</small>
                </td>
                <td>
                  <span className={'tag ' + r.status}>
                    {statuses[r.status]}
                  </span>
                </td>
                <td>{amount(r.total)}</td>
                <td className={r.balance ? 'debt' : ''}>{amount(r.balance)}</td>
                <td>
                  <button
                    disabled={busy}
                    onClick={() => void show('reservation', r.id)}
                  >
                    فتح الحساب
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <Empty>لا توجد إقامات مطابقة. أضف النزلاء والغرف ثم سجل حجزًا.</Empty>
    )
  }
  function booking(r?: HotelReservation, room?: HotelRoom) {
    if (!s) return
    openForm(reservationForm(s, r, room, { arrival, departure, adults }))
  }
  function roomStatus(r: HotelRoom) {
    const stay = inHouse.find((b) => b.roomId === r.id)
    return !r.active
      ? 'غير نشطة'
      : r.blocked
        ? 'متوقفة'
        : stay
          ? 'مشغولة'
          : cleanLabels[r.cleanliness]
  }
  function RoomGrid({ cleaning = false }: { cleaning?: boolean }) {
    return activeRooms.length ? (
      <div className="room-grid">
        {activeRooms.map((r) => {
          const stay = inHouse.find((b) => b.roomId === r.id),
            next = s!.reservations
              .filter(
                (b) =>
                  b.roomId === r.id &&
                  b.status === 'reserved' &&
                  b.arrival >= today(),
              )
              .sort((a, b) => a.arrival.localeCompare(b.arrival))[0]
          return (
            <article
              key={r.id}
              className={
                'room-card ' +
                (r.blocked ? 'blocked' : stay ? 'occupied' : r.cleanliness)
              }
            >
              <header>
                <span className="room-code">{r.code}</span>
                <span className="tag">{roomStatus(r)}</span>
              </header>
              <h3>{r.name}</h3>
              <p>
                {r.category || 'غرفة'} · طابق {r.floor || '—'} · سعة{' '}
                {r.capacity}
              </p>
              {stay ? (
                <div className="room-guest">
                  <strong>{stay.guest.name}</strong>
                  <small>المغادرة {stay.departure}</small>
                </div>
              ) : (
                <div className="room-guest">
                  <strong>
                    {cleaning
                      ? cleanLabels[r.cleanliness]
                      : amount(r.rate) + ' ج.م / ليلة'}
                  </strong>
                  <small>
                    {next
                      ? 'الوصول القادم ' + next.arrival
                      : 'لا يوجد وصول قادم'}
                  </small>
                </div>
              )}
              <footer>
                {cleaning ? (
                  <>
                    <button
                      disabled={busy}
                      onClick={() =>
                        openForm({
                          title: 'تحديث تجهيز غرفة ' + r.code,
                          action: 'hotel.housekeeping.set',
                          content: (
                            <>
                              <Field label="حالة التجهيز">
                                <select
                                  name="cleanliness"
                                  defaultValue={r.cleanliness}
                                >
                                  <option value="dirty">تحتاج تنظيف</option>
                                  <option value="cleaning">جارٍ التجهيز</option>
                                  <option value="ready">جاهزة بعد الفحص</option>
                                </select>
                              </Field>
                              <Field label="ملاحظات الفحص">
                                <textarea
                                  name="reason"
                                  required
                                  maxLength={2000}
                                />
                              </Field>
                            </>
                          ),
                          payload: (f) => ({
                            id: r.id,
                            version: r.version,
                            cleanliness: text(f, 'cleanliness'),
                            reason: text(f, 'reason'),
                          }),
                        })
                      }
                    >
                      تحديث التجهيز
                    </button>
                    {manager && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          openForm(
                            decision(
                              r.blocked
                                ? 'إعادة الغرفة للعمل'
                                : 'إيقاف الغرفة للصيانة',
                              'hotel.room.block',
                              r,
                              'الغرفة ' +
                                r.code +
                                '. يتطلب الإيقاف عدم وجود حجوزات مفتوحة.',
                              true,
                              { blocked: !r.blocked },
                            ),
                          )
                        }
                      >
                        {r.blocked ? 'إعادة للعمل' : 'صيانة'}
                      </button>
                    )}
                  </>
                ) : stay ? (
                  <button
                    onClick={() => void show('reservation', stay.id)}
                    disabled={busy}
                  >
                    حساب الإقامة
                  </button>
                ) : (
                  <button
                    disabled={busy || !!r.blocked}
                    onClick={() => booking(undefined, r)}
                  >
                    حجز الغرفة
                  </button>
                )}
                {manager && (
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => openForm(roomForm(r))}
                  >
                    تعديل
                  </button>
                )}
              </footer>
            </article>
          )
        })}
      </div>
    ) : (
      <Empty>أضف غرف الفندق الفعلية لتبدأ متابعة حالتها.</Empty>
    )
  }
  return (
    <div className="hotel-app">
      <aside className="sidebar">
        <div className="wordmark">
          <img src="./icon.svg" alt="" />
          <div>
            XZARE<small>HOTEL</small>
          </div>
        </div>
        <span className="sidebar-caption">إدارة الإقامة</span>
        <nav aria-label="صفحات الفندق">
          {Object.entries(pages)
            .filter(
              ([k]) =>
                (!['reports'].includes(k) || manager) &&
                (!['users', 'audit'].includes(k) || admin),
            )
            .map(([k, v], i) => (
              <button
                key={k}
                className={view === k ? 'active' : ''}
                aria-current={view === k ? 'page' : undefined}
                onClick={() => {
                  setView(k as View)
                  setSearch('')
                  setError('')
                }}
              >
                <span className="nav-number">
                  {String(i + 1).padStart(2, '0')}
                </span>
                {v}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <strong>{s.user.name}</strong>
          <small>{roles[s.user.role]}</small>
          <button
            disabled={busy}
            onClick={() =>
              void exclusive(mutex, setBusy, async () => {
                await call('logout')
                end()
              }).catch(fail)
            }
          >
            تسجيل الخروج
          </button>
          <a href="mailto:hello@xzare.com">hello@xzare.com</a>
        </div>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <div>
            <small>XZARE HOTEL / {s.settings.businessName}</small>
            <h1>{pages[view]}</h1>
          </div>
          <div className="top-actions">
            <WorkspaceClock english={false} />
            <button disabled={busy} onClick={() => void load().catch(fail)}>
              تحديث
            </button>
            {['desk', 'reservations', 'stays'].includes(view) && (
              <button
                className="primary"
                disabled={
                  busy ||
                  !s.rooms.some((r) => r.active && !r.blocked) ||
                  !s.guests.some((g) => g.active)
                }
                onClick={() => booking()}
              >
                + حجز إقامة
              </button>
            )}
          </div>
        </header>
        {error && !form && (
          <p className="alert error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <div className="notice" role="status">
            {notice}
            <button aria-label="إغلاق التنبيه" onClick={() => setNotice('')}>
              ×
            </button>
          </div>
        )}
        {view === 'desk' && (
          <>
            <section className="welcome">
              <div>
                <span className="eyebrow">مكتب الاستقبال</span>
                <h2>
                  كل غرفة لها حالة.
                  <br /> وكل إقامة لها حساب.
                </h2>
                <p>تابع الوصول والمغادرة وتجهيز الغرف من هنا.</p>
              </div>
              <div className="welcome-date">
                <span>يوم العمل</span>
                <input
                  type="date"
                  value={day}
                  onChange={(e) => setDay(e.target.value)}
                />
                <small>المواعيد وفق ساعة Windows المحلية</small>
              </div>
            </section>
            <section className="metrics">
              <Metric
                label="غرف مشغولة الآن"
                value={inHouse.length}
                note={occupancy + '٪ من الغرف النشطة'}
              />
              <Metric
                label="جاهزة للدخول الآن"
                value={ready.length}
                note="غير مشغولة ومفحوصة"
              />
              <Metric
                label="وصول في اليوم المحدد"
                value={arrivals.length}
                note={day}
              />
              <Metric
                label="مستحقات الإقامات"
                value={amount(due)}
                note="جنيه مصري"
              />
            </section>
            <section className="availability panel">
              <div>
                <h2>ابحث عن غرفة متاحة</h2>
                <p>الفحص بحسب الفترة والسعة؛ التجهيز يُراجع عند الدخول.</p>
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  setError('')
                  const g = generation.current,
                    t = scope.current.ticket()
                  void exclusive(mutex, setBusy, async () => {
                    const r = await call<{ rooms: HotelRoom[] }>(
                      'hotel.availability',
                      { arrival, departure, adults },
                    )
                    if (g === generation.current && scope.current.current(t))
                      setAvailable(r.rooms)
                  }).catch(fail)
                }}
              >
                <Field label="الوصول">
                  <input
                    type="date"
                    required
                    value={arrival}
                    onChange={(e) => {
                      setArrival(e.target.value)
                      setAvailable(null)
                    }}
                  />
                </Field>
                <Field label="المغادرة">
                  <input
                    type="date"
                    required
                    value={departure}
                    onChange={(e) => {
                      setDeparture(e.target.value)
                      setAvailable(null)
                    }}
                  />
                </Field>
                <Field label="النزلاء">
                  <input
                    type="number"
                    min="1"
                    max="20"
                    required
                    value={adults}
                    onChange={(e) => {
                      setAdults(Number(e.target.value))
                      setAvailable(null)
                    }}
                  />
                </Field>
                <button className="primary" disabled={busy}>
                  فحص التوافر
                </button>
              </form>
              {available && (
                <div className="availability-result">
                  {available.length ? (
                    available.map((r) => (
                      <button key={r.id} onClick={() => booking(undefined, r)}>
                        {r.code} · {r.name} · {amount(r.rate)} ج.م
                      </button>
                    ))
                  ) : (
                    <Empty>لا توجد غرفة مناسبة في هذه الفترة.</Empty>
                  )}
                </div>
              )}
            </section>
            <section className="desk-columns">
              <div className="panel">
                <div className="section-title">
                  <h2>الوصول المتوقع</h2>
                  <span>{arrivals.length}</span>
                </div>
                {arrivals.length ? (
                  arrivals.map((r) => (
                    <button
                      className="arrival-row"
                      key={r.id}
                      disabled={busy}
                      onClick={() => void show('reservation', r.id)}
                    >
                      <b>{r.room.code}</b>
                      <span>
                        {r.guest.name}
                        <small>
                          {r.number} · {r.nights} ليلة
                        </small>
                      </span>
                      <span>فتح ←</span>
                    </button>
                  ))
                ) : (
                  <Empty>لا يوجد وصول مسجل لهذا اليوم.</Empty>
                )}
              </div>
              <div className="panel">
                <div className="section-title">
                  <h2>المغادرة والمتأخرون</h2>
                  <span>{departures.length}</span>
                </div>
                {departures.length ? (
                  departures.map((r) => (
                    <button
                      className="arrival-row"
                      key={r.id}
                      disabled={busy}
                      onClick={() => void show('reservation', r.id)}
                    >
                      <b>{r.room.code}</b>
                      <span>
                        {r.guest.name}
                        <small>
                          {r.departure} · مستحق {amount(r.balance)}
                        </small>
                      </span>
                      <span>الحساب ←</span>
                    </button>
                  ))
                ) : (
                  <Empty>لا توجد مغادرة مستحقة في هذا اليوم.</Empty>
                )}
              </div>
            </section>
            <div className="section-title">
              <h2>خريطة الغرف الحالية</h2>
              {manager && (
                <button disabled={busy} onClick={() => openForm(roomForm())}>
                  + إضافة غرفة
                </button>
              )}
            </div>
            <RoomGrid />
          </>
        )}
        {view === 'reservations' && (
          <>
            <div className="filters">
              <input
                aria-label="بحث الحجوزات"
                placeholder="رقم الحجز، النزيل، الغرفة أو الهاتف"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select
                aria-label="حالة الحجز"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="all">كل الحالات</option>
                {Object.entries(statuses).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <ReservationTable rows={filtered} />
          </>
        )}
        {view === 'stays' && (
          <>
            <section className="metrics">
              <Metric label="داخل الفندق" value={inHouse.length} />
              <Metric
                label="إقامات تحتاج تسوية"
                value={s.reservations.filter((r) => r.balance > 0).length}
              />
              <Metric label="إجمالي المستحقات" value={amount(due)} note="ج.م" />
            </section>
            <div className="section-title">
              <h2>الإقامات الحالية والحسابات غير المسددة</h2>
            </div>
            <ReservationTable
              rows={s.reservations.filter(
                (r) => r.status === 'in-house' || r.balance > 0,
              )}
            />
            <div className="section-title">
              <h2>سجل التحصيل والرد</h2>
            </div>
            {s.payments.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>الإيصال</th>
                      <th>النزيل / الغرفة</th>
                      <th>النوع</th>
                      <th>المبلغ</th>
                      <th>الحالة</th>
                      <th />
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
                          {p.guest.name}
                          <small>{p.room.code}</small>
                        </td>
                        <td>{p.kind === 'receipt' ? 'تحصيل' : 'رد مبلغ'}</td>
                        <td>{amount(p.amount)}</td>
                        <td>{p.voidReason ? 'مصحح' : 'مسجل'}</td>
                        <td>
                          <button
                            disabled={busy}
                            onClick={() => {
                              setDocument({
                                id: p.id,
                                reservationId: p.reservationId,
                                data: p,
                              })
                              setDetail(null)
                            }}
                          >
                            عرض الإيصال
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>لا توجد إيصالات مسجلة.</Empty>
            )}
          </>
        )}
        {view === 'housekeeping' && (
          <>
            <div className="section-title">
              <div>
                <h2>حالة الغرف وتجهيزها</h2>
                <p>
                  المغادرة تحول الغرفة إلى «تحتاج تنظيف». لا يتم الدخول حتى فحص
                  التجهيز.
                </p>
              </div>
              {manager && (
                <button onClick={() => openForm(roomForm())} disabled={busy}>
                  + إضافة غرفة
                </button>
              )}
            </div>
            <RoomGrid cleaning />
            <details className="panel inactive">
              <summary>
                الغرف غير النشطة ({s.rooms.filter((r) => !r.active).length})
              </summary>
              {s.rooms
                .filter((r) => !r.active)
                .map((r) => (
                  <div className="line" key={r.id}>
                    {r.code} · {r.name}
                    {manager && (
                      <button onClick={() => openForm(roomForm(r))}>
                        تعديل
                      </button>
                    )}
                  </div>
                ))}
            </details>
            <div className="section-title">
              <h2>سجل التجهيز والصيانة</h2>
            </div>
            <Events rows={s.housekeeping} />
          </>
        )}
        {view === 'guests' && (
          <>
            <div className="filters">
              <input
                aria-label="بحث النزلاء"
                placeholder="اسم، كود أو هاتف"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button
                className="primary"
                disabled={busy}
                onClick={() => openForm(guestForm(manager))}
              >
                + إضافة نزيل
              </button>
            </div>
            {s.guests.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>النزيل</th>
                      <th>الهاتف</th>
                      <th>الحالة</th>
                      <th>الإقامات</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {s.guests
                      .filter((g) =>
                        [g.code, g.name, g.phone]
                          .join(' ')
                          .toLowerCase()
                          .includes(search.toLowerCase()),
                      )
                      .map((g) => (
                        <tr key={g.id}>
                          <td>
                            <strong>{g.name}</strong>
                            <small>{g.code}</small>
                          </td>
                          <td dir="ltr">{g.phone || '—'}</td>
                          <td>{g.active ? 'نشط' : 'غير نشط'}</td>
                          <td>
                            {
                              s.reservations.filter((r) => r.guestId === g.id)
                                .length
                            }
                          </td>
                          <td>
                            <button
                              disabled={busy}
                              onClick={() => void show('guest', g.id)}
                            >
                              ملف النزيل
                            </button>
                            <button
                              disabled={busy}
                              onClick={() => openForm(guestForm(manager, g))}
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
              <Empty>سجل بيانات أول نزيل لبدء حجز الإقامة.</Empty>
            )}
          </>
        )}
        {view === 'reports' && manager && (
          <>
            <div className="filters">
              <Field label="من تاريخ">
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </Field>
              <Field label="إلى تاريخ">
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </Field>
              {report && (
                <button
                  onClick={() =>
                    csv('Hotel-Report.csv', [
                      [
                        'الحجز',
                        'النزيل',
                        'الغرفة',
                        'الوصول',
                        'المغادرة',
                        'الحالة',
                        'القيمة ج.م',
                        'المحصل ج.م',
                        'المستحق ج.م',
                      ],
                      ...report.reservations.map((r) => [
                        r.number,
                        r.guest.name,
                        r.room.code,
                        r.arrival,
                        r.departure,
                        statuses[r.status],
                        decimal(r.total),
                        decimal(r.collected),
                        decimal(r.balance),
                      ]),
                    ])
                  }
                >
                  تصدير CSV
                </button>
              )}
            </div>
            {report ? (
              <>
                <section className="metrics">
                  <Metric
                    label="رسوم سجلت خلال الفترة"
                    value={amount(report.charges)}
                    note="بعد التصحيحات؛ لا تمثل إيرادًا محاسبيًا مستحقًا"
                  />
                  <Metric
                    label="صافي التحصيل خلال الفترة"
                    value={amount(report.collected)}
                    note="التحصيل ناقص الرد والتصحيح"
                  />
                  <Metric
                    label="مستحقات كل الإقامات الآن"
                    value={amount(report.outstanding)}
                    note="ج.م"
                  />
                  <Metric
                    label="ليالي إقامة فعلية منقضية"
                    value={report.roomNights}
                    note="الدخول حتى المغادرة الفعلية أو اليوم"
                  />
                </section>
                <ReservationTable rows={report.reservations} />
              </>
            ) : (
              <Empty>جارٍ تحميل التقرير؛ اختر فترة صحيحة حتى 366 يومًا.</Empty>
            )}
          </>
        )}
        {view === 'users' && admin && (
          <>
            <div className="section-title">
              <h2>حسابات الموظفين</h2>
              <button className="primary" onClick={() => openForm(userForm())}>
                + إضافة مستخدم
              </button>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>الموظف</th>
                    <th>اسم المستخدم</th>
                    <th>الدور</th>
                    <th>الحالة</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {s.users.map((u) => (
                    <tr key={u.id}>
                      <td>{u.name}</td>
                      <td>{u.username}</td>
                      <td>{roles[u.role]}</td>
                      <td>{u.active ? 'نشط' : 'موقوف'}</td>
                      <td>
                        <button onClick={() => openForm(userForm(u))}>
                          تعديل
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted">
              الاستقبال يحجز ويسجل الدخول والخروج ويحصّل ويجهز الغرف. المدير
              يصحح الحسابات ويرد المبالغ ويدير الغرف والتقارير. مسؤول النظام
              يدير الحسابات والنسخ والترخيص.
            </p>
          </>
        )}
        {view === 'audit' && admin && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>الوقت</th>
                  <th>المستخدم</th>
                  <th>العملية</th>
                  <th>السجل</th>
                </tr>
              </thead>
              <tbody>
                {s.audit.map((a) => (
                  <tr key={a.id}>
                    <td>{stamp(a.at)}</td>
                    <td>{a.user_name ?? 'النظام'}</td>
                    <td>{eventLabel(a.action)}</td>
                    <td dir="ltr">{a.entity_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {view === 'settings' && (
          <div className="settings-grid">
            <section className="panel">
              <h2>بيانات الفندق</h2>
              <p>{s.settings.businessName}</p>
              <p>{s.settings.address || 'لم يضف عنوان'}</p>
              <p dir="ltr">{s.settings.phone || 'لم يضف هاتف'}</p>
              {admin && (
                <button
                  onClick={() =>
                    openForm({
                      title: 'بيانات الفندق',
                      action: 'settings.save',
                      content: (
                        <>
                          <Field label="اسم الفندق">
                            <input
                              name="businessName"
                              defaultValue={s.settings.businessName}
                              required
                              maxLength={160}
                            />
                          </Field>
                          <Field label="الهاتف">
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
                              maxLength={250}
                            />
                          </Field>
                          <Field label="تذييل المستندات">
                            <textarea
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
                        language: 'ar',
                        currency: 'EGP',
                        taxBps: Number(s.settings.taxBps ?? 0),
                      }),
                    })
                  }
                >
                  تعديل بيانات الفندق
                </button>
              )}
              <hr />
              <h3>حسابي</h3>
              <button onClick={() => openForm(passwordForm())}>
                تغيير كلمة المرور
              </button>
            </section>
            {admin && (
              <>
                <section className="panel">
                  <h2>النسخ الاحتياطية</h2>
                  <p>
                    احتفظ بالنسخ في مكان خاص. البيانات والنسخ لا تستخدم تشفيرًا
                    كاملًا حاليًا.
                  </p>
                  <div className="actions">
                    <button disabled={busy} onClick={() => void backup()}>
                      إنشاء نسخة احتياطية
                    </button>
                    <button disabled={busy} onClick={restoreForm}>
                      استعادة نسخة
                    </button>
                  </div>
                </section>
                <section className="panel license-panel">
                  <h2>ترخيص الجهاز</h2>
                  <LicensePanel />
                </section>
              </>
            )}
            <section className="panel">
              <h2>الدعم</h2>
              <p>
                <a href="mailto:hello@xzare.com">hello@xzare.com</a>
              </p>
              <p>
                <a
                  href="https://wa.me/201501230440"
                  target="_blank"
                  rel="noreferrer"
                >
                  +201501230440
                </a>
              </p>
              <p>إصدار 0.1.0 · جنيه مصري · تواريخ حسب Windows</p>
            </section>
          </div>
        )}
        <footer className="workspace-footer">
          <span>XZARE HOTEL · 0.1.0</span>
          <span>
            hello@xzare.com · <b dir="ltr">+201501230440</b>
          </span>
        </footer>
      </main>
      {form && (
        <Modal
          title={form.title}
          busy={busy}
          error={error}
          onClose={() => {
            if (!mutex.current) {
              setForm(null)
              setError('')
            }
          }}
          onSubmit={(e) => void submit(form, new FormData(e.currentTarget))}
          submit={form.submit}
        >
          {form.content}
        </Modal>
      )}
      {detail && (
        <Modal
          title={
            detail.kind === 'reservation'
              ? 'حساب إقامة — ' +
                (detail.data as HotelDetail).reservation.number
              : 'ملف النزيل'
          }
          manual
          busy={busy}
          error={error}
          onClose={() => {
            detailSeq.current++
            setDetail(null)
          }}
        >
          {detail.kind === 'guest'
            ? (() => {
                const d = detail.data as HotelGuestDetail
                return (
                  <>
                    <h3>{d.guest.name}</h3>
                    <p>
                      {d.guest.code} · {d.guest.phone}
                    </p>
                    {manager && d.guest.document && (
                      <p>وثيقة الهوية: {d.guest.document}</p>
                    )}
                    <p>{d.guest.note}</p>
                    <ReservationTable rows={d.reservations} />
                    <Events rows={d.events} />
                  </>
                )
              })()
            : (() => {
                const d = detail.data as HotelDetail,
                  r = d.reservation,
                  open = ['reserved', 'in-house'].includes(r.status)
                return (
                  <>
                    <div className="folio-business">
                      <strong>{r.business.businessName}</strong>
                      <small>
                        {r.business.address} · {r.business.phone}
                      </small>
                    </div>
                    <div className="folio-head">
                      <span className="folio-room">{r.room.code}</span>
                      <div>
                        <h3>{r.guest.name}</h3>
                        <p>
                          {r.room.name} · {r.adults} نزيل · {r.nights} ليلة
                        </p>
                        <p dir="ltr">
                          {r.arrival} → {r.departure}
                        </p>
                      </div>
                      <span className={'tag ' + r.status}>
                        {statuses[r.status]}
                      </span>
                    </div>
                    <section className="metrics folio-metrics">
                      <Metric label="إجمالي الحساب" value={amount(r.total)} />
                      <Metric label="صافي المحصل" value={amount(r.collected)} />
                      <Metric label="المستحق" value={amount(r.balance)} />
                    </section>
                    <p>{r.note}</p>
                    <div className="actions">
                      {r.status === 'reserved' && (
                        <button
                          className="primary"
                          disabled={busy}
                          onClick={() =>
                            openForm(
                              decision(
                                'تسجيل دخول النزيل',
                                'hotel.reservation.checkin',
                                r,
                                <>
                                  {r.guest.name} · الغرفة {r.room.code}
                                  <br />
                                  يجب أن تكون الغرفة جاهزة داخل فترة الإقامة.
                                </>,
                              ),
                            )
                          }
                        >
                          تسجيل الدخول
                        </button>
                      )}
                      {r.status === 'in-house' && (
                        <>
                          <button
                            disabled={busy}
                            onClick={() => openForm(chargeForm(r))}
                          >
                            + خدمة إضافية
                          </button>
                          <button
                            disabled={busy || r.balance !== 0}
                            onClick={() =>
                              openForm(
                                decision(
                                  'تسوية ومغادرة',
                                  'hotel.reservation.checkout',
                                  r,
                                  <>
                                    {r.guest.name} · حساب مسدد {amount(r.total)}{' '}
                                    ج.م
                                    <br />
                                    ستحتاج الغرفة لتنظيف بعد المغادرة. الرسوم
                                    المتفق عليها لا تتغير تلقائيًا عند المغادرة
                                    المبكرة؛ راجع الحساب وصحح السعر ورد الزيادة
                                    قبل الإغلاق.
                                  </>,
                                ),
                              )
                            }
                          >
                            تسجيل المغادرة
                          </button>
                        </>
                      )}
                      {open && r.balance > 0 && (
                        <button
                          className="primary"
                          disabled={busy}
                          onClick={() => openForm(payForm(r))}
                        >
                          تحصيل
                        </button>
                      )}
                      {open && manager && (
                        <>
                          <button disabled={busy} onClick={() => booking(r)}>
                            تعديل الإقامة
                          </button>
                          {r.collected > 0 && (
                            <button
                              disabled={busy}
                              onClick={() => openForm(payForm(r, true))}
                            >
                              رد مبلغ
                            </button>
                          )}
                          {r.status === 'reserved' && (
                            <>
                              <button
                                disabled={busy}
                                onClick={() =>
                                  openForm(
                                    decision(
                                      'إلغاء الحجز',
                                      'hotel.reservation.cancel',
                                      r,
                                      'لن تحذف المستندات السابقة. رد صافي المحصل أولًا.',
                                      true,
                                    ),
                                  )
                                }
                              >
                                إلغاء الحجز
                              </button>
                              <button
                                disabled={busy}
                                onClick={() =>
                                  openForm(
                                    decision(
                                      'تسجيل عدم الحضور',
                                      'hotel.reservation.no-show',
                                      r,
                                      'متاح بعد يوم الوصول. رد صافي المحصل أولًا.',
                                      true,
                                    ),
                                  )
                                }
                              >
                                لم يحضر
                              </button>
                            </>
                          )}
                        </>
                      )}
                      <button onClick={() => window.print()}>
                        طباعة حساب الإقامة
                      </button>
                    </div>
                    {r.status === 'in-house' && r.balance > 0 && (
                      <p className="alert">
                        سدّد {amount(r.balance)} ج.م لفتح تسجيل المغادرة.
                      </p>
                    )}
                    <h3>الخدمات الإضافية</h3>
                    {d.charges.length ? (
                      d.charges.map((c) => (
                        <div className="line" key={c.id}>
                          <span>
                            {c.title} · {amount(c.amount)} ج.م{' '}
                            <small>
                              {c.voidReason
                                ? 'مصحح: ' + c.voidReason
                                : stamp(c.at)}
                            </small>
                          </span>
                          {manager && open && !c.voidReason && (
                            <button
                              onClick={() =>
                                openForm(
                                  correction(
                                    'تصحيح رسم',
                                    'hotel.charge.void',
                                    c.id,
                                  ),
                                )
                              }
                            >
                              تصحيح
                            </button>
                          )}
                        </div>
                      ))
                    ) : (
                      <p className="muted">لا توجد خدمات إضافية.</p>
                    )}
                    <h3>إيصالات التحصيل والرد</h3>
                    {d.payments.length ? (
                      d.payments.map((p) => (
                        <div className="line" key={p.id}>
                          <span>
                            {p.number} · {p.kind === 'receipt' ? 'تحصيل' : 'رد'}{' '}
                            · {amount(p.amount)} ج.م
                            <small>
                              {p.voidReason
                                ? 'مصحح: ' + p.voidReason
                                : methods[p.method] + ' · ' + stamp(p.at)}
                            </small>
                          </span>
                          <button
                            onClick={() => {
                              setDocument({
                                id: p.id,
                                reservationId: r.id,
                                data: p,
                              })
                              setDetail(null)
                            }}
                          >
                            عرض الإيصال
                          </button>
                          {manager && open && !p.voidReason && (
                            <button
                              onClick={() =>
                                openForm(
                                  correction(
                                    'تصحيح إيصال',
                                    'hotel.payment.void',
                                    p.id,
                                  ),
                                )
                              }
                            >
                              تصحيح
                            </button>
                          )}
                        </div>
                      ))
                    ) : (
                      <p className="muted">لم يسجل تحصيل.</p>
                    )}
                    <h3>سجل الحساب</h3>
                    <table>
                      <thead>
                        <tr>
                          <th>البند</th>
                          <th>المبلغ</th>
                          <th>السبب</th>
                          <th>الموظف</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.ledger.map((l) => (
                          <tr key={l.id}>
                            <td>
                              {ledgerLabels[l.kind]}
                              <small>{stamp(l.at)}</small>
                            </td>
                            <td>{amount(l.amount)}</td>
                            <td>{l.reason}</td>
                            <td>{l.actorName}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <details>
                      <summary>تاريخ الحجز والتصحيحات</summary>
                      <Events rows={d.events} />
                    </details>
                  </>
                )
              })()}
        </Modal>
      )}
      {document && (
        <Modal
          title={'إيصال ' + document.data.number}
          manual
          busy={busy}
          error={error}
          onClose={() => setDocument(null)}
        >
          <section className="receipt">
            <header>
              <img src="./icon.svg" alt="" />
              <h2>{document.data.business.businessName}</h2>
              <p>{document.data.business.address}</p>
              <p>{document.data.business.phone}</p>
            </header>
            <span className="eyebrow">
              {document.data.kind === 'receipt'
                ? 'إيصال تحصيل'
                : 'إيصال رد مبلغ'}
            </span>
            <h2>{document.data.number}</h2>
            {document.data.voidReason && (
              <p className="alert error">مصحح: {document.data.voidReason}</p>
            )}
            <p>
              النزيل: {document.data.guest.name} · {document.data.guest.code}
            </p>
            <p>
              الغرفة: {document.data.room.code} · {document.data.room.name}
            </p>
            <h2>{amount(document.data.amount)} ج.م</h2>
            <p>
              {methods[document.data.method]} · {document.data.reference}
            </p>
            <p>{document.data.reason}</p>
            <p>
              {stamp(document.data.at)} · {document.data.actorName}
            </p>
            <footer>{document.data.business.receiptFooter}</footer>
          </section>
          <div className="actions">
            <button onClick={() => window.print()}>طباعة الإيصال</button>
            <button
              disabled={busy}
              onClick={() => void show('reservation', document.reservationId)}
            >
              فتح حساب الإقامة
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
function Metric({
  label,
  value,
  note,
}: {
  label: string
  value: ReactNode
  note?: string
}) {
  return (
    <article className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note || ' '}</small>
    </article>
  )
}
function Events({
  rows,
}: {
  rows: {
    id: string
    action: string
    reason: string
    actorName: string
    at: number
    snapshot?: string
  }[]
}) {
  return rows.length ? (
    <div className="timeline">
      {rows.map((e) => (
        <div key={e.id}>
          <strong>{eventLabel(e.action)}</strong>
          <small>
            {stamp(e.at)} · {e.actorName}
          </small>
          <p>{e.reason}</p>
          {e.snapshot && (
            <details>
              <summary>التفاصيل المسجلة</summary>
              <pre>{JSON.stringify(JSON.parse(e.snapshot), null, 2)}</pre>
            </details>
          )}
        </div>
      ))}
    </div>
  ) : (
    <Empty>لا توجد حركة مسجلة.</Empty>
  )
}
