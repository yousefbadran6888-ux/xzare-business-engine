import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ulid } from '@xzare/core'
import type {
  EstateState,
  EstateDeal,
  EstateDetail,
  EstateEntry,
  EstateContract,
  EstateReport,
  EstateContact,
} from '@xzare/engine'
import { call } from '../../pos/src/bridge'
import { useSessionActivity } from '../../pos/src/useSessionActivity'
import { LicensePanel } from '../../pos/src/LicensePanel'
import { WorkspaceClock } from '../../pos/src/WorkspaceClock'
import { AuthScreen, type AuthValues } from './AuthScreen'
import { Modal, Empty, Field, amount, today, csv, download } from './ui'
import {
  contactForm,
  unitForm,
  dealForm,
  contractForm,
  entryForm,
  decision,
  userForm,
  passwordForm,
  inp,
  text,
  type FormSpec,
} from './Forms'
import {
  roles,
  statuses,
  categories,
  offers,
  availability,
  kinds,
  channels,
  movements,
  methods,
  eventLabel,
  stamp,
  passwordValue,
} from './model'
import { exclusive } from './exclusive'
import { EstateScope } from './scope'
const pages = {
  units: 'دليل الوحدات',
  deals: 'مسار الصفقات',
  contracts: 'سجل العقود',
  commissions: 'العمولات',
  owners: 'الملاك',
  clients: 'العملاء',
  brokers: 'الوسطاء',
  reports: 'التقارير',
  users: 'المستخدمون',
  audit: 'سجل التدقيق',
  settings: 'الإعدادات والترخيص',
}
type View = keyof typeof pages
type Doc = {
  id: string
  dealId: string
  kind: 'entry' | 'contract'
  data: EstateEntry | EstateContract
}
export function App() {
  const [s, setS] = useState<EstateState | null>(null),
    [configured, setConfigured] = useState<boolean | null>(null),
    [view, setView] = useState<View>('units'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [search, setSearch] = useState(''),
    [filter, setFilter] = useState('all'),
    [form, setForm] = useState<FormSpec | null>(null),
    [detail, setDetail] = useState<EstateDetail | null>(null),
    [doc, setDoc] = useState<Doc | null>(null),
    [from, setFrom] = useState(today().slice(0, 8) + '01'),
    [to, setTo] = useState(today()),
    [report, setReport] = useState<EstateReport | null>(null)
  const lock = useRef(false),
    generation = useRef(0),
    loads = useRef(0),
    scope = useRef(new EstateScope()),
    detailRef = useRef(detail),
    docRef = useRef(doc),
    requests = useRef(new Map<string, string>())
  detailRef.current = detail
  docRef.current = doc
  function clearPrivate() {
    setForm(null)
    setDetail(null)
    setDoc(null)
    detailRef.current = null
    docRef.current = null
    setReport(null)
    setView('units')
    setSearch('')
    setFilter('all')
    requests.current.clear()
  }
  function end() {
    generation.current++
    loads.current++
    scope.current.clear()
    setS(null)
    clearPrivate()
    setError('')
    setNotice('')
  }
  function fail(e: unknown) {
    const m = e instanceof Error ? e.message : 'تعذر إتمام العملية'
    if (/انتهت الجلسة|سجّل الدخول/.test(m)) end()
    setError(m)
  }
  useSessionActivity(!!s, () => {
    end()
    setError('انتهت الجلسة؛ سجّل الدخول مرة أخرى')
  })
  async function load() {
    const n = ++loads.current,
      g = generation.current,
      captured = detailRef.current,
      capturedDoc = docRef.current
    const fresh = await call<EstateState>('re.state')
    let d: EstateDetail | null = null
    if (captured || capturedDoc) {
      const id = captured?.deal.id ?? capturedDoc!.dealId
      try {
        d = await call<EstateDetail>('re.deal.get', { id })
      } catch {}
    }
    if (g !== generation.current || n !== loads.current) return
    const lost = scope.current.update(fresh.user)
    if (lost) {
      generation.current++
      clearPrivate()
    }
    setS(fresh)
    if (!lost && captured && detailRef.current === captured) setDetail(d)
    if (!lost && capturedDoc && docRef.current === capturedDoc) {
      const value =
        capturedDoc.kind === 'entry' ? d?.entries.find((x) => x.id === capturedDoc.id) : d?.contract
      setDoc(value ? { ...capturedDoc, data: value } : null)
    }
  }
  useEffect(() => {
    void call<{ configured: boolean }>('auth.status')
      .then((r) => {
        setConfigured(r.configured)
        if (r.configured) void load().catch(() => {})
      })
      .catch(fail)
  }, [])
  useEffect(() => {
    if (!s) return
    const timer = setInterval(() => {
      if (!lock.current) void load().catch(fail)
    }, 15000)
    return () => clearInterval(timer)
  }, [s?.user.id])
  useEffect(() => {
    if (!s || view !== 'reports' || !['admin', 'manager'].includes(s.user.role)) return
    let live = true
    const g = generation.current,
      t = scope.current.ticket()
    setReport(null)
    void call<EstateReport>('re.report', { from, to })
      .then((r) => {
        if (live && g === generation.current && scope.current.current(t)) setReport(r)
      })
      .catch((e) => {
        if (live && g === generation.current) fail(e)
      })
    return () => {
      live = false
    }
  }, [s, view, from, to])
  async function authenticate(v: AuthValues) {
    setError('')
    try {
      await exclusive(lock, setBusy, async () => {
        await call(
          configured ? 'login' : 'setup',
          configured ? { username: v.username.trim(), password: v.password } : v,
        )
        setConfigured(true)
        await load()
      })
    } catch (e) {
      fail(e)
      throw e
    }
  }
  function open(f: FormSpec) {
    if (lock.current) return
    setError('')
    setForm(f)
    setDetail(null)
    detailRef.current = null
    setDoc(null)
    docRef.current = null
  }
  async function run(action: string, p: Record<string, unknown>) {
    const g = generation.current
    await exclusive(lock, setBusy, async () => {
      const key = JSON.stringify({ action, p }),
        tx = requests.current.get(key) ?? ulid()
      requests.current.set(key, tx)
      await call(action, action.startsWith('re.') ? { ...p, clientTxnId: tx } : p)
      if (g !== generation.current) return
      requests.current.delete(key)
      if (action === 'password.change') {
        end()
        setNotice('تم تغيير كلمة المرور؛ سجّل الدخول مرة أخرى')
        return
      }
      setNotice('تم حفظ العملية')
      await load()
    })
  }
  async function show(id: string) {
    if (lock.current) return
    const g = generation.current,
      t = scope.current.ticket()
    setError('')
    try {
      await exclusive(lock, setBusy, async () => {
        const d = await call<EstateDetail>('re.deal.get', { id })
        if (g === generation.current && scope.current.current(t)) {
          setForm(null)
          setDoc(null)
          docRef.current = null
          setDetail(d)
          detailRef.current = d
        }
      })
    } catch (e) {
      fail(e)
    }
  }
  async function backup() {
    setError('')
    try {
      await exclusive(lock, setBusy, async () => {
        const r = await call<{ download?: string; fileName?: string; cancelled?: boolean }>(
          'backup.create',
        )
        if (r.download && r.fileName)
          download(
            r.fileName,
            new Blob([Uint8Array.from(atob(r.download), (c) => c.charCodeAt(0))]),
          )
        if (!r.cancelled) setNotice('تم إنشاء النسخة الاحتياطية')
      })
    } catch (e) {
      fail(e)
    }
  }
  function restore() {
    open({
      title: 'استعادة نسخة احتياطية',
      action: 'backup.restore',
      content: (
        <>
          <p className="review">
            الاستعادة تستبدل بيانات المكتب الحالية؛ جهز نسخة حديثة قبل المتابعة.
          </p>
          {inp('كلمة مرور المسؤول الحالية', 'password', '', true, 'password', 128)}
          {!window.xzare && (
            <Field label="ملف النسخة">
              <input name="file" type="file" accept=".xzbak" required />
            </Field>
          )}
        </>
      ),
      payload: (f) => ({ password: passwordValue(f, 'password'), file: f.get('file') }),
      submit: 'استعادة البيانات',
    })
  }
  async function submit(f: FormSpec, fd: FormData) {
    setError('')
    const g = generation.current
    try {
      const p = f.payload(fd)
      if (f.action === 'backup.restore') {
        await exclusive(lock, setBusy, async () => {
          if (window.xzare) {
            const r = await call<{ restored?: boolean; cancelled?: boolean }>('backup.restore', {
              password: p.password,
            })
            if (r.restored) end()
            else if (r.cancelled) setForm(null)
          } else {
            if (!(p.file instanceof File) || !p.file.size || p.file.size > 128 * 1024 * 1024)
              throw Error('اختر نسخة صحيحة حتى 128 ميجابايت')
            const response = await fetch('/api/restore', {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                  'X-Xzare-Request': '1',
                  'X-Xzare-Password': encodeURIComponent(String(p.password)),
                },
                body: p.file,
              }),
              r = await response.json()
            if (!response.ok || !r.ok) throw Error(r.error ?? 'تعذر الاستعادة')
            end()
          }
        })
      } else {
        await run(f.action, p)
        if (g === generation.current) setForm(null)
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
    allowed = (Object.keys(pages) as View[]).filter(
      (k) =>
        admin ||
        (!['users', 'audit'].includes(k) &&
          (manager || !['contracts', 'commissions', 'brokers', 'reports'].includes(k))),
    ),
    v = allowed.includes(view) ? view : 'units',
    matches = (xs: unknown[]) => xs.join(' ').toLowerCase().includes(search.toLowerCase()),
    sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0),
    openDeals = s.deals.filter((d) => ['reserved', 'contracted'].includes(d.status)),
    availableUnits = s.units.filter(
      (u) => u.active && u.availability === 'available' && !u.openDealId,
    )
  function navigate(next: View) {
    if (lock.current) return
    setView(next)
    setSearch('')
    setFilter('all')
    setError('')
    setNotice('')
    setDetail(null)
    detailRef.current = null
    setDoc(null)
    docRef.current = null
    setForm(null)
  }
  function DealTable({ rows }: { rows: EstateDeal[] }) {
    return rows.length ? (
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>الصفقة / العميل</th>
              <th>الوحدة</th>
              <th>نوع الاتفاق</th>
              <th>القيمة المتفق عليها</th>
              <th>الحالة</th>
              <th>عربون بحوزة المكتب</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id}>
                <td>
                  <strong>{d.client.name}</strong>
                  <small>{d.number}</small>
                </td>
                <td>
                  {d.unit.code}
                  <small>{d.unit.name}</small>
                </td>
                <td>
                  {offers[d.kind]}
                  <small>{d.kind === 'lease' ? d.leaseStart + ' ← ' + d.leaseEnd : ''}</small>
                </td>
                <td>
                  {amount(d.price)}
                  <small>{d.kind === 'lease' ? 'إيجار شهري' : 'قيمة بيع'} · ج.م</small>
                </td>
                <td>
                  <span className={'tag ' + d.status}>{statuses[d.status]}</span>
                </td>
                <td>{amount(d.depositHeld)}</td>
                <td>
                  <button disabled={busy} onClick={() => void show(d.id)}>
                    فتح الصفقة
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <Empty>لا توجد صفقات مطابقة. أضف المالك والعميل والوسيط والوحدة، ثم احجز الصفقة.</Empty>
    )
  }
  function contacts(kind: EstateContact['kind']) {
    const rows = s!.contacts.filter((x) => x.kind === kind && matches([x.code, x.name, x.phone]))
    return (
      <>
        <div className="section-head">
          <p>بيانات {kinds[kind]} الفعلية، مع الاحتفاظ بتاريخ التعديل.</p>
          {(manager || kind === 'client') && (
            <button
              className="primary"
              disabled={busy}
              onClick={() => open(contactForm(kind, manager))}
            >
              إضافة {kinds[kind]}
            </button>
          )}
        </div>
        {rows.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>الاسم</th>
                  <th>الكود</th>
                  <th>التواصل</th>
                  {manager && <th>وثيقة الهوية</th>}
                  <th>الحالة</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((x) => (
                  <tr key={x.id}>
                    <td>
                      <strong>{x.name}</strong>
                      <small>{x.note}</small>
                    </td>
                    <td dir="ltr">{x.code}</td>
                    <td dir="ltr">{x.phone || '—'}</td>
                    {manager && <td>{x.document || '—'}</td>}
                    <td>{x.active ? 'نشط' : 'غير نشط'}</td>
                    <td>
                      {(manager || kind === 'client') && (
                        <button disabled={busy} onClick={() => open(contactForm(kind, manager, x))}>
                          تعديل
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>سجل {kinds[kind]} أولًا لربطه بالوحدات والصفقات.</Empty>
        )}
      </>
    )
  }
  function document(kind: 'entry' | 'contract', data: EstateEntry | EstateContract) {
    setDetail(null)
    detailRef.current = null
    const next = { id: data.id, dealId: data.dealId, kind, data }
    setDoc(next)
    docRef.current = next
  }
  return (
    <div className="estate-app">
      <aside className="sidebar">
        <a
          className="wordmark"
          href="#"
          onClick={(e) => {
            e.preventDefault()
            navigate('units')
          }}
        >
          <img src="./icon.svg" alt="" />
          <span>
            XZARE<small>REAL ESTATE</small>
          </span>
        </a>
        <div className="workspace">
          <small>المكتب العقاري</small>
          <strong>{s.settings.businessName}</strong>
        </div>
        <nav aria-label="صفحات البرنامج">
          {allowed.map((k) => (
            <button
              key={k}
              className={v === k ? 'active' : ''}
              disabled={busy}
              aria-current={v === k ? 'page' : undefined}
              onClick={() => navigate(k)}
            >
              <span className="nav-dot" />
              {pages[k]}
            </button>
          ))}
        </nav>
        <footer>
          <strong>{s.user.name}</strong>
          <small>{roles[s.user.role]}</small>
          <button disabled={busy} onClick={() => open(passwordForm())}>
            تغيير كلمة المرور
          </button>
          <button
            disabled={busy}
            onClick={() =>
              void exclusive(lock, setBusy, async () => {
                await call('logout')
                end()
              }).catch(fail)
            }
          >
            تسجيل الخروج
          </button>
          <a href="mailto:hello@xzare.com">hello@xzare.com</a>
        </footer>
      </aside>
      <main className="workspace-main">
        <header className="topbar">
          <span>مساحة عمل العقارات</span>
          <WorkspaceClock english={false} />
          <button disabled={busy} onClick={() => void load().catch(fail)}>
            تحديث العرض
          </button>
        </header>
        <div className="page">
          <div className="page-title">
            <div>
              <span className="eyebrow">XZARE / REAL ESTATE</span>
              <h1>{pages[v]}</h1>
            </div>
            {v === 'units' && manager && (
              <button className="primary" disabled={busy} onClick={() => open(unitForm(s))}>
                إضافة وحدة
              </button>
            )}
            {v === 'deals' && manager && (
              <button
                className="primary"
                disabled={busy || !availableUnits.length}
                onClick={() => open(dealForm(s))}
              >
                حجز صفقة جديدة
              </button>
            )}
          </div>
          {error && (
            <p role="alert" className="alert error">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="alert success">
              {notice}
            </p>
          )}
          {!['settings', 'reports', 'audit'].includes(v) && (
            <div className="searchbar">
              <label>
                <span>بحث</span>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="ابحث بالكود أو الاسم أو الموقع"
                />
              </label>
              {v === 'units' && (
                <Field label="نوع العرض">
                  <select value={filter} onChange={(e) => setFilter(e.target.value)}>
                    <option value="all">كل الوحدات</option>
                    <option value="sale">للبيع</option>
                    <option value="lease">للإيجار</option>
                    <option value="available">متاحة لصفقة</option>
                    <option value="inactive">غير نشطة</option>
                  </select>
                </Field>
              )}
            </div>
          )}
          {v === 'units' && (
            <>
              <section className="catalog-intro">
                <div>
                  <span>محفظة الوحدات</span>
                  <h2>العرض الواضح يبدأ من بيانات واضحة.</h2>
                  <p>الموقع والمساحة والمالك والسعر، ثم انتقال منظم إلى الصفقة والعقد.</p>
                </div>
                <div className="catalog-count">
                  <strong>{availableUnits.length}</strong>
                  <span>وحدة متاحة لصفقة</span>
                </div>
              </section>
              <div className="metric-strip">
                <Metric label="إجمالي الوحدات" value={s.units.length} />
                <Metric label="صفقات مفتوحة" value={openDeals.length} />
                <Metric
                  label="عربون بحوزة المكتب"
                  value={amount(sum(s.deals.map((d) => d.depositHeld))) + ' ج.م'}
                  note="أمانات منفصلة عن إيراد المكتب"
                />
              </div>
              {!s.contacts.some((c) => c.kind === 'owner' && c.active) && manager && (
                <div className="onboard">
                  <p>ابدأ بتسجيل المالك، ثم أضف الوحدة التابعة له.</p>
                  <button onClick={() => navigate('owners')}>تسجيل الملاك</button>
                </div>
              )}
              <div className="unit-grid">
                {s.units
                  .filter(
                    (u) =>
                      matches([u.code, u.name, u.location, u.ownerName]) &&
                      (filter === 'all' ||
                        (filter === 'inactive' && !u.active) ||
                        (filter === 'available' &&
                          u.active &&
                          u.availability === 'available' &&
                          !u.openDealId) ||
                        (['sale', 'lease'].includes(filter) &&
                          u.active &&
                          ['both', filter].includes(u.offer))),
                  )
                  .map((u) => (
                    <article className="unit-card" key={u.id}>
                      <header>
                        <span>{categories[u.category]}</span>
                        <span className={'tag ' + (u.openDealId ? 'reserved' : u.availability)}>
                          {!u.active
                            ? 'غير نشطة'
                            : u.openDealId
                              ? 'محجوزة لصفقة'
                              : availability[u.availability]}
                        </span>
                      </header>
                      <div className="unit-identity">
                        <span className="unit-code" dir="ltr">
                          {u.code}
                        </span>
                        <h2>{u.name}</h2>
                        <p>{u.location}</p>
                      </div>
                      <div className="unit-spec">
                        <span>{u.area.toLocaleString('ar-EG')} م²</span>
                        <span>{u.rooms.toLocaleString('ar-EG')} غرفة</span>
                        <span>{offers[u.offer]}</span>
                      </div>
                      <dl>
                        <div>
                          <dt>المالك</dt>
                          <dd>{u.ownerName}</dd>
                        </div>
                        {u.offer !== 'lease' && (
                          <div>
                            <dt>سعر البيع</dt>
                            <dd>{amount(u.salePrice)} ج.م</dd>
                          </div>
                        )}
                        {u.offer !== 'sale' && (
                          <div>
                            <dt>الإيجار الشهري</dt>
                            <dd>{amount(u.rentPrice)} ج.م</dd>
                          </div>
                        )}
                      </dl>
                      <footer>
                        {u.openDealId ? (
                          <button disabled={busy} onClick={() => void show(u.openDealId!)}>
                            فتح الصفقة الحالية
                          </button>
                        ) : manager && u.active && u.availability === 'available' ? (
                          <button
                            className="primary"
                            disabled={busy}
                            onClick={() => open(dealForm(s, u))}
                          >
                            حجز صفقة
                          </button>
                        ) : manager && u.availability !== 'available' ? (
                          <button
                            disabled={busy}
                            onClick={() => open(decision('إعادة عرض الوحدة', 're.unit.relist', u))}
                          >
                            إعادة عرض
                          </button>
                        ) : null}
                        {manager && (
                          <button disabled={busy} onClick={() => open(unitForm(s, u))}>
                            تعديل الوحدة
                          </button>
                        )}
                      </footer>
                    </article>
                  ))}
              </div>
              {!s.units.length && (
                <Empty>لا توجد وحدات مسجلة. أضف المالك والوحدة ببياناتك الفعلية.</Empty>
              )}
            </>
          )}
          {v === 'deals' && (
            <>
              <div className="pipeline" aria-label="تصفية مراحل الصفقات">
                {(['all', 'reserved', 'contracted', 'completed', 'cancelled'] as const).map((k) => (
                  <button
                    key={k}
                    className={filter === k ? 'selected' : ''}
                    onClick={() => setFilter(k)}
                  >
                    <span>{k === 'all' ? 'كل الصفقات' : statuses[k]}</span>
                    <strong>{s.deals.filter((d) => k === 'all' || d.status === k).length}</strong>
                  </button>
                ))}
              </div>
              <DealTable
                rows={s.deals.filter(
                  (d) =>
                    (filter === 'all' || d.status === filter) &&
                    matches([d.number, d.client.name, d.unit.code, d.unit.location]),
                )}
              />
            </>
          )}
          {v === 'clients' && contacts('client')}
          {v === 'owners' && contacts('owner')}
          {v === 'brokers' && contacts('broker')}
          {v === 'contracts' && manager && (
            <>
              <p className="review">
                سجل إداري للعقود الموقعة بالفعل. تُحفظ بيانات الاتفاق وقت التسجيل وتبقى العقود
                الملغاة في السجل.
              </p>
              {s.contracts.filter((c) =>
                matches([c.number, c.reference, c.snapshot.client.name, c.snapshot.unit.code]),
              ).length ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>السجل / المرجع</th>
                        <th>الوحدة / العميل</th>
                        <th>التوقيع</th>
                        <th>الحالة</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {s.contracts
                        .filter((c) =>
                          matches([
                            c.number,
                            c.reference,
                            c.snapshot.client.name,
                            c.snapshot.unit.code,
                          ]),
                        )
                        .map((c) => (
                          <tr key={c.id}>
                            <td>
                              <strong>{c.number}</strong>
                              <small>{c.reference}</small>
                            </td>
                            <td>
                              {c.snapshot.unit.code}
                              <small>{c.snapshot.client.name}</small>
                            </td>
                            <td>{c.signedDay}</td>
                            <td>{c.cancelReason ? 'ملغى: ' + c.cancelReason : 'مسجل'}</td>
                            <td>
                              <button onClick={() => document('contract', c)}>عرض سجل العقد</button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty>لم يُسجل عقد موقع بعد. افتح الصفقة ثم سجل مرجع العقد الفعلي.</Empty>
              )}
            </>
          )}
          {v === 'commissions' && manager && (
            <>
              <div className="metric-strip">
                <Metric
                  label="عمولات مكتسبة"
                  value={amount(sum(s.deals.map((d) => d.earned))) + ' ج.م'}
                />
                <Metric
                  label="عمولات لم تُحصّل"
                  value={amount(sum(s.deals.map((d) => d.earned - d.feeCollected))) + ' ج.م'}
                />
                <Metric
                  label="حصص وسطاء لم تُصرف"
                  value={amount(sum(s.deals.map((d) => d.brokerDue))) + ' ج.م'}
                />
              </div>
              <p className="review">
                تُكتسب العمولة عند إتمام الصفقة. يُتاح صرف حصة الوسيط بعد تحصيل عمولة المكتب
                بالكامل.
              </p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>الصفقة / الوسيط</th>
                      <th>عمولة المكتب</th>
                      <th>المحصل</th>
                      <th>حصة الوسيط</th>
                      <th>المتبقي للوسيط</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {s.deals
                      .filter(
                        (d) =>
                          d.status === 'completed' &&
                          matches([d.number, d.broker.name, d.unit.code]),
                      )
                      .map((d) => (
                        <tr key={d.id}>
                          <td>
                            {d.number}
                            <small>{d.broker.name}</small>
                          </td>
                          <td>{amount(d.earned)}</td>
                          <td>{amount(d.feeCollected)}</td>
                          <td>{amount(d.brokerShare)}</td>
                          <td>{amount(d.brokerDue)}</td>
                          <td>
                            <button onClick={() => void show(d.id)}>فتح الحساب</button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              {!s.deals.some((d) => d.status === 'completed') && (
                <Empty>تظهر هنا عمولات الصفقات المكتملة.</Empty>
              )}
            </>
          )}
          {v === 'reports' && manager && (
            <>
              <div className="report-filters">
                <Field label="من تاريخ">
                  <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                </Field>
                <Field label="إلى تاريخ">
                  <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                </Field>
                {report && (
                  <button
                    onClick={() =>
                      csv('Xzare-Real-Estate-report.csv', [
                        [
                          'الصفقة',
                          'الوحدة',
                          'العميل',
                          'نوع الاتفاق',
                          'قيمة البيع أو الإيجار الشهري',
                          'عمولة مكتسبة',
                          'حصة الوسيط',
                        ],
                        ...report.deals.map((d) => [
                          d.number,
                          d.unit.code,
                          d.client.name,
                          offers[d.kind],
                          d.price / 100,
                          d.earned / 100,
                          d.brokerShare / 100,
                        ]),
                      ])
                    }
                  >
                    تصدير الصفقات المكتملة CSV
                  </button>
                )}
              </div>
              {report ? (
                <>
                  <div className="metric-strip">
                    <Metric
                      label="عمولات مكتسبة في الفترة"
                      value={amount(report.earned) + ' ج.م'}
                    />
                    <Metric
                      label="صافي المكتسب للمكتب"
                      value={amount(report.agencyNetEarned) + ' ج.م'}
                      note="بعد استحقاق حصص الوسطاء"
                    />
                    <Metric
                      label="صافي تحصيل العمولة في الفترة"
                      value={amount(report.feeCollected) + ' ج.م'}
                    />
                  </div>
                  <div className="metric-strip">
                    <Metric
                      label="العربون المحتفظ به حاليًا"
                      value={amount(report.depositHeld) + ' ج.م'}
                    />
                    <Metric
                      label="عمولات مستحقة حاليًا"
                      value={amount(report.feeOutstanding) + ' ج.م'}
                    />
                    <Metric
                      label="حصص وسطاء متبقية حاليًا"
                      value={amount(report.brokerDue) + ' ج.م'}
                    />
                  </div>
                  <p className="review">
                    التحصيل والتصحيحات حسب تاريخ الحركة. أرصدة العربون والمستحقات أرصدة حالية؛ قيمة
                    العقار ليست إيرادًا للمكتب. قيمة الإيجار المسجلة شهرية.
                  </p>
                  <DealTable rows={report.deals} />
                </>
              ) : (
                <p className="muted">جارٍ تحميل التقرير أو راجع نطاق التاريخ.</p>
              )}
            </>
          )}
          {v === 'users' && admin && (
            <>
              <div className="section-head">
                <p>حساب مستقل لكل موظف، بصلاحيات محددة.</p>
                <button className="primary" disabled={busy} onClick={() => open(userForm())}>
                  إضافة مستخدم
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
                    {s.users
                      .filter((u) => matches([u.name, u.username]))
                      .map((u) => (
                        <tr key={u.id}>
                          <td>{u.name}</td>
                          <td>{u.username}</td>
                          <td>{roles[u.role]}</td>
                          <td>{u.active ? 'نشط' : 'موقوف'}</td>
                          <td>
                            <button disabled={busy} onClick={() => open(userForm(u))}>
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
          {v === 'audit' && admin && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>الوقت</th>
                    <th>الموظف</th>
                    <th>العملية</th>
                    <th>مرجع السجل</th>
                  </tr>
                </thead>
                <tbody>
                  {s.audit.map((a) => (
                    <tr key={a.id}>
                      <td>{stamp(a.at)}</td>
                      <td>{a.user_name}</td>
                      <td>{eventLabel(a.action)}</td>
                      <td dir="ltr">{a.entity_id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {v === 'settings' && (
            <>
              <section className="settings-section">
                <h2>بيانات المكتب</h2>
                <p>
                  {s.settings.businessName} · {s.settings.phone || 'لم يسجل رقم المكتب'}
                </p>
                {admin && (
                  <button
                    onClick={() =>
                      open({
                        title: 'بيانات المكتب',
                        action: 'settings.save',
                        content: (
                          <>
                            {inp('اسم المكتب', 'businessName', s.settings.businessName, true)}
                            {inp('رقم المكتب', 'phone', s.settings.phone)}
                            {inp('العنوان', 'address', s.settings.address)}
                            {inp('تذييل الإيصالات', 'receiptFooter', s.settings.receiptFooter)}
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
                    تعديل بيانات المكتب
                  </button>
                )}
              </section>
              {admin && (
                <>
                  <section className="settings-section">
                    <h2>النسخ الاحتياطي</h2>
                    <p>
                      نسخة لبيانات المكتب على جهازك. احتفظ بها في مكان آمن؛ ملف النسخة غير مشفر.
                    </p>
                    <div className="actions">
                      <button disabled={busy} onClick={() => void backup()}>
                        إنشاء نسخة احتياطية
                      </button>
                      <button disabled={busy} onClick={restore}>
                        استعادة نسخة
                      </button>
                    </div>
                  </section>
                  <section className="settings-section">
                    <h2>التفعيل والترخيص</h2>
                    <LicensePanel />
                  </section>
                </>
              )}
              <section className="settings-section">
                <h2>دعم Xzare</h2>
                <a href="mailto:hello@xzare.com">hello@xzare.com</a>
                <p dir="ltr">+201501230440</p>
                <a href="https://wa.me/201501230440" target="_blank" rel="noreferrer">
                  التواصل عبر واتساب
                </a>
              </section>
            </>
          )}
        </div>
      </main>
      {form && (
        <Modal
          title={form.title}
          busy={busy}
          error={error}
          onClose={() => setForm(null)}
          onSubmit={(e) => void submit(form, new FormData(e.currentTarget))}
          submit={form.submit}
        >
          {form.content}
        </Modal>
      )}
      {detail && (
        <Modal
          title={'الصفقة ' + detail.deal.number}
          manual
          busy={busy}
          error={error}
          onClose={() => {
            setDetail(null)
            detailRef.current = null
          }}
        >
          <DealAccount d={detail} manager={manager} busy={busy} open={open} document={document} />
        </Modal>
      )}
      {doc && (
        <Modal
          title={doc.kind === 'contract' ? 'سجل العقد' : 'إيصال حركة مالية'}
          manual
          busy={busy}
          error={error}
          onClose={() => {
            setDoc(null)
            docRef.current = null
          }}
        >
          <RecordDocument doc={doc} />
          <div className="actions">
            <button onClick={() => window.print()}>طباعة السجل</button>
            <button onClick={() => void show(doc.dealId)}>فتح الصفقة</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
function Metric({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
  return (
    <article className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </article>
  )
}
function DealAccount({
  d,
  manager,
  busy,
  open,
  document,
}: {
  d: EstateDetail
  manager: boolean
  busy: boolean
  open: (f: FormSpec) => void
  document: (k: 'entry' | 'contract', x: EstateEntry | EstateContract) => void
}) {
  const r = d.deal,
    live = ['reserved', 'contracted'].includes(r.status)
  return (
    <>
      <div className="deal-summary">
        <span className={'tag ' + r.status}>{statuses[r.status]}</span>
        <h2>{r.unit.name}</h2>
        <p>
          {r.unit.code} · {r.unit.location}
        </p>
        <dl>
          <div>
            <dt>العميل</dt>
            <dd>
              {r.client.name} · {r.client.phone}
            </dd>
          </div>
          <div>
            <dt>المالك</dt>
            <dd>{r.owner.name}</dd>
          </div>
          <div>
            <dt>{r.kind === 'sale' ? 'قيمة البيع' : 'الإيجار الشهري'}</dt>
            <dd>{amount(r.price)} ج.م</dd>
          </div>
          {r.kind === 'lease' && (
            <div>
              <dt>فترة الإيجار</dt>
              <dd>
                {r.leaseStart} ← {r.leaseEnd}
              </dd>
            </div>
          )}
        </dl>
      </div>
      <div className="metric-strip">
        <Metric label="عربون بحوزة المكتب" value={amount(r.depositHeld)} />
        <Metric
          label="عمولة مكتسبة / محصلة"
          value={amount(r.earned) + ' / ' + amount(r.feeCollected)}
        />
        {manager && <Metric label="المتبقي للوسيط" value={amount(r.brokerDue)} />}
      </div>
      <div className="actions">
        {live && r.depositReceived < r.depositLimit && (
          <button disabled={busy} onClick={() => open(entryForm(r, 'deposit', 'receipt'))}>
            تحصيل عربون
          </button>
        )}
        {live && manager && r.depositHeld > 0 && (
          <>
            <button disabled={busy} onClick={() => open(entryForm(r, 'deposit', 'refund'))}>
              رد عربون
            </button>
            {r.status === 'contracted' && (
              <button disabled={busy} onClick={() => open(entryForm(r, 'deposit', 'handover'))}>
                تسليم العربون للمالك
              </button>
            )}
          </>
        )}
        {manager && r.status === 'reserved' && (
          <button className="primary" disabled={busy} onClick={() => open(contractForm(r))}>
            تسجيل العقد الموقع
          </button>
        )}
        {manager && r.status === 'contracted' && (
          <button
            className="primary"
            disabled={busy || r.depositHeld !== 0}
            onClick={() => open(decision('إتمام الصفقة', 're.deal.complete', r))}
          >
            إتمام الصفقة
          </button>
        )}
        {manager && live && (
          <button
            className="danger"
            disabled={busy || r.depositHeld !== 0 || r.depositReceived !== 0}
            onClick={() => open(decision('إلغاء الصفقة', 're.deal.cancel', r))}
          >
            إلغاء الصفقة
          </button>
        )}
        {r.status === 'completed' && r.feeCollected < r.earned && (
          <button disabled={busy} onClick={() => open(entryForm(r, 'fee', 'receipt'))}>
            تحصيل عمولة المكتب
          </button>
        )}
        {manager && r.status === 'completed' && r.feeCollected > 0 && r.brokerPaid === 0 && (
          <button disabled={busy} onClick={() => open(entryForm(r, 'fee', 'refund'))}>
            رد عمولة
          </button>
        )}
        {manager && r.status === 'completed' && r.brokerDue > 0 && (
          <button
            disabled={busy || r.feeCollected !== r.commission}
            onClick={() => open(entryForm(r, 'broker', 'payout'))}
          >
            صرف حصة الوسيط
          </button>
        )}
        {d.contract && (
          <button onClick={() => document('contract', d.contract!)}>عرض سجل العقد</button>
        )}
      </div>
      {live && r.depositHeld > 0 && (
        <p className="review">
          سوِّ العربون قبل إغلاق الصفقة. التسليم للمالك يسجل حركة فعلية بمرجع؛ لا ينفذ تحويلًا
          بنكيًا.
        </p>
      )}
      <h3>الحركات المالية</h3>
      {d.entries.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>الإيصال</th>
                <th>الحساب / الحركة</th>
                <th>المبلغ</th>
                <th>السبب</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {d.entries.map((e) => (
                <tr key={e.id}>
                  <td>
                    {e.number}
                    <small>
                      {stamp(e.at)} · {e.actorName}
                    </small>
                  </td>
                  <td>
                    {channels[e.channel]}
                    <small>{movements[e.kind]}</small>
                  </td>
                  <td>{amount(e.amount)}</td>
                  <td>
                    {e.reason}
                    {e.voidReason && <small className="debt">مصحح: {e.voidReason}</small>}
                  </td>
                  <td>
                    <button onClick={() => document('entry', e)}>عرض الإيصال</button>
                    {manager &&
                      !e.voidReason &&
                      e.kind !== 'void' &&
                      (e.channel === 'deposit' ? live : r.status === 'completed') && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            open(decision('تصحيح الحركة', 're.entry.void', r, { entryId: e.id }))
                          }
                        >
                          تصحيح
                        </button>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>لم تسجل حركة مالية بعد.</Empty>
      )}
      <details>
        <summary>تاريخ الصفقة</summary>
        <div className="timeline">
          {d.events.map((e) => (
            <div key={e.id}>
              <strong>{eventLabel(e.action)}</strong>
              <small>
                {stamp(e.at)} · {e.actorName}
              </small>
              <p>{e.reason}</p>
            </div>
          ))}
        </div>
      </details>
    </>
  )
}
function RecordDocument({ doc }: { doc: Doc }) {
  const x = doc.data,
    s = x.snapshot
  return (
    <section className="receipt">
      <header>
        <img src="./icon.svg" alt="" />
        <h2>{s.business.businessName}</h2>
        <p>{s.business.address}</p>
        <p>{s.business.phone}</p>
      </header>
      <span className="eyebrow">
        {doc.kind === 'contract'
          ? 'سجل عقد موقع — سجل إداري'
          : channels[(x as EstateEntry).channel] + ' · ' + movements[(x as EstateEntry).kind]}
      </span>
      <h2>{x.number}</h2>
      {doc.kind === 'contract' ? (
        <>
          <p>
            المرجع: {(x as EstateContract).reference} · تاريخ التوقيع:{' '}
            {(x as EstateContract).signedDay}
          </p>
          {(x as EstateContract).cancelReason && (
            <p className="alert error">ملغى: {(x as EstateContract).cancelReason}</p>
          )}
        </>
      ) : (
        <>
          {(x as EstateEntry).voidReason && (
            <p className="alert error">مصحح: {(x as EstateEntry).voidReason}</p>
          )}
          <h2>{amount((x as EstateEntry).amount)} ج.م</h2>
          <p>
            {methods[(x as EstateEntry).method]} · {(x as EstateEntry).reference}
          </p>
          <p>{(x as EstateEntry).reason}</p>
        </>
      )}
      <p>
        الصفقة: {s.number} · {offers[s.kind]}
      </p>
      <p>
        الوحدة: {s.unit.code} · {s.unit.name} · {s.unit.location}
      </p>
      <p>
        المالك: {s.owner.name} · العميل: {s.client.name}
      </p>
      {doc.kind === 'contract' && (
        <>
          <p>
            {s.kind === 'sale' ? 'قيمة البيع' : 'الإيجار الشهري'}: {amount(s.price)} ج.م
          </p>
          {s.kind === 'lease' && (
            <p>
              {s.leaseStart} ← {s.leaseEnd}
            </p>
          )}
          <p>عمولة المكتب: {amount(s.commission)} ج.م</p>
          <p className="terms">{(x as EstateContract).terms}</p>
        </>
      )}
      <small>
        {stamp(x.at)} · {x.actorName}
      </small>
      <footer>{s.business.receiptFooter}</footer>
    </section>
  )
}
