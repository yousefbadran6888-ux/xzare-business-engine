import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ulid } from '@xzare/core'
import type {
  Pharmacy,
  PharmacyState,
  PharmacyMedicine,
  PharmacySupplier,
  PharmacyLot,
  PharmacySaleDetail,
  User,
} from '@xzare/engine'
import { call } from '../../pos/src/bridge'
import { useSessionActivity } from '../../pos/src/useSessionActivity'
import { LicensePanel } from '../../pos/src/LicensePanel'
import { WorkspaceClock } from '../../pos/src/WorkspaceClock'
import { AuthScreen, type AuthValues } from './AuthScreen'
import { commitThenRefresh } from './commit-refresh'
import { Counter, ReceiptEditor } from './Editors'
import { SaleDetail } from './SaleDetail'
import { Modal, Field, Empty, amount, decimal, today, csv, download } from './ui'
import { readMoney, roles, statusLabels, documentKinds, stamp, methods } from './model'
const pages = {
  counter: 'كاونتر الصرف',
  catalog: 'دليل الأدوية',
  batches: 'التشغيلات والصلاحية',
  receiving: 'الاستلام والموردون',
  sales: 'الفواتير والتحصيل',
  reports: 'التقارير',
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
function BarcodeLabel({ m }: { m: PharmacyMedicine }) {
  const ref = useRef<HTMLCanvasElement>(null),
    [error, setError] = useState('')
  useEffect(() => {
    let live = true
    void import('bwip-js/browser')
      .then((b) => {
        if (!live || !ref.current) return
        b.default.toCanvas(ref.current, {
          bcid:
            (
              { CODE128: 'code128', EAN13: 'ean13', EAN8: 'ean8', UPCA: 'upca' } as Record<
                string,
                string
              >
            )[m.format] ?? 'code128',
          text: m.barcode,
          scale: 3,
          height: 12,
          includetext: true,
          textxalign: 'center',
          paddingwidth: 12,
        })
      })
      .catch(() => {
        if (live) setError('تعذر توليد الباركود؛ راجع الصيغة')
      })
    return () => {
      live = false
    }
  }, [m.barcode, m.format])
  return (
    <div className="ph-label print-area">
      <strong>{m.name}</strong>
      <span>
        {m.unit} · {amount(m.price)} ج.م
      </span>
      {error ? <p role="alert">{error}</p> : <canvas ref={ref} />}
    </div>
  )
}
export function App() {
  const [configured, setConfigured] = useState<boolean | null>(null),
    [state, setState] = useState<PharmacyState | null>(null),
    [view, setView] = useState<View>('counter'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [query, setQuery] = useState(''),
    [form, setForm] = useState<Form | null>(null),
    [formSaving, setFormSaving] = useState(false),
    [receipt, setReceipt] = useState(false),
    [detail, setDetail] = useState<PharmacySaleDetail | null>(null),
    [document, setDocument] = useState<ReturnType<Pharmacy['document']> | null>(null),
    [label, setLabel] = useState<PharmacyMedicine | null>(null),
    [batchFilter, setBatchFilter] = useState('all'),
    [from, setFrom] = useState(today()),
    [to, setTo] = useState(today()),
    [report, setReport] = useState<ReturnType<Pharmacy['report']> | null>(null)
  const mutex = useRef(false),
    requests = useRef(new Map<string, string>()),
    generation = useRef(0),
    loadSeq = useRef(0)
  const end = () => {
    generation.current++
    setState(null)
    setDetail(null)
    setDocument(null)
    setLabel(null)
    setForm(null)
    setReceipt(false)
    setReport(null)
    setView('counter')
    setQuery('')
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
      s = await call<PharmacyState>('pharmacy.state')
    if (g === generation.current && n === loadSeq.current) setState(s)
  }
  useEffect(() => {
    void call<{ configured: boolean }>('auth.status')
      .then((r) => {
        setConfigured(r.configured)
        if (r.configured) void load().catch(() => {})
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
    void call<ReturnType<Pharmacy['report']>>('pharmacy.report', { from, to })
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
  }, [view, from, to, state])
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
    const command = action.startsWith('pharmacy.'),
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
        setError('تم الحفظ؛ حدّث العرض لقراءة البيانات')
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
  async function openSale(id: string) {
    const g = generation.current,
      d = await call<PharmacySaleDetail>('pharmacy.sale.get', { id })
    if (g === generation.current) {
      setDetail(d)
      setError('')
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
  if (!state)
    return (
      <AuthScreen configured={configured} busy={busy} error={error} onAuthenticate={authenticate} />
    )
  const s = state,
    admin = s.user.role === 'admin',
    manager = admin || s.user.role === 'manager',
    locked = busy || formSaving,
    q = query.trim().toLowerCase(),
    matches = (...v: unknown[]) => v.join(' ').toLowerCase().includes(q)
  function medicineForm(m?: PharmacyMedicine) {
    saveForm(
      m ? 'تعديل الدواء' : 'دواء جديد',
      <>
        <div className="a-form-row">
          <Field label="اسم الدواء">
            <input name="name" required maxLength={160} defaultValue={m?.name ?? ''} />
          </Field>
          <Field label="كود الصنف">
            <input name="code" required maxLength={160} dir="ltr" defaultValue={m?.code ?? ''} />
          </Field>
        </div>
        <div className="a-form-row">
          <Field label="المادة الفعالة (اختياري)">
            <input name="ingredient" maxLength={160} defaultValue={m?.ingredient ?? ''} />
          </Field>
          <Field label="التركيز (اختياري)">
            <input name="strength" maxLength={160} defaultValue={m?.strength ?? ''} />
          </Field>
          <Field label="الشكل (اختياري)">
            <input name="form" maxLength={160} defaultValue={m?.form ?? ''} />
          </Field>
        </div>
        <div className="a-form-row">
          <Field label="وحدة التسجيل والصرف">
            <input name="unit" required maxLength={160} defaultValue={m?.unit ?? 'علبة'} />
          </Field>
          <Field label="المصنّع (اختياري)">
            <input name="manufacturer" maxLength={160} defaultValue={m?.manufacturer ?? ''} />
          </Field>
        </div>
        <div className="a-form-row">
          <Field label="سعر البيع · ج.م">
            <input
              name="price"
              required
              inputMode="decimal"
              dir="ltr"
              defaultValue={m ? decimal(m.price) : ''}
            />
          </Field>
          <Field label="حد إعادة الطلب">
            <input
              name="reorderQty"
              type="number"
              min="0"
              step="1"
              max="1000000000"
              required
              defaultValue={m?.reorderQty ?? 0}
            />
          </Field>
        </div>
        <div className="a-form-row">
          <Field label="الباركود (اختياري)">
            <input
              name="barcode"
              autoComplete="off"
              maxLength={80}
              dir="ltr"
              defaultValue={m?.barcode ?? ''}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.preventDefault()
              }}
            />
          </Field>
          <Field label="صيغة الباركود">
            <select name="format" defaultValue={m?.format ?? 'CODE128'}>
              {['CODE128', 'EAN13', 'EAN8', 'UPCA'].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </Field>
        </div>
        <small>
          الباركود يُفحص عند الحفظ مع منع التكرار. EAN وUPC للكود التجاري، وCODE128 للكود الداخلي.
          يمكن للقارئ إدخاله مباشرة.
        </small>
        <h3>روابط بدائل مسجلة يدويًا</h3>
        <div className="ph-alternatives">
          {s.medicines
            .filter((x) => x.id !== m?.id)
            .map((x) => (
              <label key={x.id} className="a-check">
                <input
                  name="alternativeIds"
                  type="checkbox"
                  value={x.id}
                  defaultChecked={m?.alternativeIds.includes(x.id)}
                />
                {x.name}
              </label>
            ))}
        </div>
        <small>
          حدد الروابط المعتمدة لديك فقط. البرنامج لا يستنتج تكافؤًا أو يختار بديلًا تلقائيًا.
        </small>
        <label className="a-check">
          <input name="active" type="checkbox" defaultChecked={m ? !!m.active : true} />
          دواء نشط
        </label>
      </>,
      'pharmacy.medicine.save',
      (f) => ({
        ...(m && { id: m.id, version: m.version }),
        name: String(f.get('name')),
        code: String(f.get('code')),
        ingredient: String(f.get('ingredient')),
        strength: String(f.get('strength')),
        form: String(f.get('form')),
        unit: String(f.get('unit')),
        manufacturer: String(f.get('manufacturer')),
        price: readMoney(f.get('price')),
        reorderQty: Number(f.get('reorderQty')),
        barcode: String(f.get('barcode')),
        format: String(f.get('format')),
        alternativeIds: f.getAll('alternativeIds'),
        active: f.has('active'),
      }),
    )
  }
  function supplierForm(p?: PharmacySupplier) {
    saveForm(
      p ? 'تعديل المورد' : 'مورد جديد',
      <>
        <Field label="اسم المورد">
          <input name="name" required maxLength={160} defaultValue={p?.name ?? ''} />
        </Field>
        <Field label="رقم التواصل">
          <input name="phone" type="tel" maxLength={40} dir="ltr" defaultValue={p?.phone ?? ''} />
        </Field>
        <Field label="العنوان">
          <input name="address" maxLength={250} defaultValue={p?.address ?? ''} />
        </Field>
        <label className="a-check">
          <input name="active" type="checkbox" defaultChecked={p ? !!p.active : true} />
          مورد نشط
        </label>
      </>,
      'pharmacy.supplier.save',
      (f) => ({
        ...(p && { id: p.id, version: p.version }),
        name: String(f.get('name')),
        phone: String(f.get('phone')),
        address: String(f.get('address')),
        active: f.has('active'),
      }),
    )
  }
  function lotStatus(b: PharmacyLot) {
    saveForm(
      'حالة التشغيلة ' + b.batch,
      <>
        <p>
          {b.name} · صلاحية {b.expiry}
        </p>
        <Field label="الحالة الجديدة">
          <select name="status" defaultValue={b.status}>
            {Object.entries(statusLabels).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="سبب تغيير الحالة">
          <textarea name="reason" required maxLength={1000} />
        </Field>
        <small>
          العزل والسحب يمنعان كل صرف من هذه التشغيلة. تغيير الحالة لا يعيد المرتجعات المعزولة للبيع.
        </small>
      </>,
      'pharmacy.lot.status',
      (f) => ({
        id: b.id,
        version: b.version,
        status: String(f.get('status')),
        reason: String(f.get('reason')),
      }),
    )
  }
  function dispose(b: PharmacyLot, bucket: 'available' | 'quarantine') {
    const qty = bucket === 'available' ? b.qty : b.quarantineQty,
      cost = bucket === 'available' ? b.cost : b.quarantineCost
    saveForm(
      'تسجيل هالك · ' + b.batch,
      <>
        <p>
          {b.name} · {bucket === 'available' ? 'الرصيد الأساسي' : 'رصيد المرتجعات المعزول'}: {qty}{' '}
          {b.unit}
        </p>
        <Field label="كمية الهالك">
          <input name="qty" type="number" min="1" max={qty} step="1" required />
        </Field>
        <Field label="سبب الهالك">
          <textarea name="reason" required maxLength={1000} />
        </Field>
        <label className="a-check">
          <input type="checkbox" required />
          أكد إخراج الكمية من المخزون وتوثيق السبب
        </label>
      </>,
      'pharmacy.lot.dispose',
      (f) => ({
        id: b.id,
        bucket,
        qty: Number(f.get('qty')),
        expectedQty: qty,
        expectedCost: cost,
        reason: String(f.get('reason')),
      }),
      'تأكيد الهالك',
    )
  }
  function userForm(u?: User) {
    saveForm(
      u ? 'تعديل المستخدم' : 'مستخدم جديد',
      <>
        <div className="a-form-row">
          <Field label="الاسم">
            <input name="name" required maxLength={160} defaultValue={u?.name ?? ''} />
          </Field>
          <Field label="اسم المستخدم">
            <input
              name="username"
              required
              pattern="[A-Za-z0-9_.-]{3,40}"
              maxLength={40}
              dir="ltr"
              defaultValue={u?.username ?? ''}
            />
          </Field>
        </div>
        <Field label="الصلاحية">
          <select name="role" defaultValue={u?.role ?? 'cashier'}>
            <option value="cashier">موظف الكاونتر — صرف وتحصيل</option>
            <option value="manager">مدير — مخزون وموردون ومرتجعات</option>
            <option value="admin">مسؤول النظام — جميع الصلاحيات</option>
          </select>
        </Field>
        <Field label={u ? 'كلمة مرور جديدة (اتركها فارغة للإبقاء)' : 'كلمة المرور'}>
          <input
            name="password"
            type="password"
            minLength={12}
            maxLength={128}
            required={!u}
            autoComplete="new-password"
          />
        </Field>
        <label className="a-check">
          <input name="active" type="checkbox" defaultChecked={u ? !!u.active : true} />
          حساب نشط
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
  const batchList = s.lots.filter(
    (b) =>
      matches(b.name, b.batch, b.expiry) &&
      (batchFilter === 'all' ||
        (batchFilter === 'expired' && b.expiry <= s.today) ||
        (batchFilter === 'near' &&
          b.expiry > s.today &&
          b.expiry <= new Date(Date.now() + 90 * 86400000).toLocaleDateString('en-CA')) ||
        (batchFilter === 'held' && (b.status !== 'available' || b.quarantineQty > 0))),
  )
  return (
    <div className="ph-shell">
      <aside className="ph-rail">
        <div className="ph-brand">
          <img src="./icon.svg" alt="" />
          <span>
            XZARE<small>PHARMACY</small>
          </span>
        </div>
        <div className="ph-business">
          {s.settings.businessName}
          <small>إدارة يوم الصيدلية</small>
        </div>
        <nav>
          {(Object.entries(pages) as [View, string][])
            .filter(
              ([v]) =>
                !(['catalog', 'batches', 'receiving', 'reports'].includes(v) && !manager) &&
                !(['users', 'audit', 'settings'].includes(v) && !admin),
            )
            .map(([v, name], i) => (
              <button
                key={v}
                className={view === v ? 'active' : ''}
                aria-current={view === v ? 'page' : undefined}
                disabled={locked}
                onClick={() => {
                  setView(v)
                  setQuery('')
                  setError('')
                  setNotice('')
                }}
              >
                <span className="ph-nav-index">{String(i + 1).padStart(2, '0')}</span>
                {name}
              </button>
            ))}
        </nav>
        <div className="ph-rail-bottom">
          <span className="ph-user-avatar">{s.user.name.slice(0, 1)}</span>
          <strong>{s.user.name}</strong>
          <small>{roles[s.user.role]}</small>
          <button
            disabled={locked}
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
                  <small>بعد التغيير ينتهي تسجيل الدخول على كل الأجهزة.</small>
                </>,
                'password.change',
                (f) => ({ current: String(f.get('current')), password: String(f.get('password')) }),
              )
            }
          >
            تغيير كلمة المرور
          </button>
          <button
            disabled={locked}
            onClick={() =>
              invoke(async () => {
                await call('logout')
                end()
              })
            }
          >
            تسجيل الخروج
          </button>
          <small dir="ltr">
            hello@xzare.com
            <br />
            +201501230440
          </small>
        </div>
      </aside>
      <main className="ph-workspace">
        <header className="ph-topbar">
          <div>
            <span className="eyebrow">PHARMACY / WORKSPACE</span>
            <h1>{pages[view]}</h1>
          </div>
          <div className="ph-header-side">
            <WorkspaceClock english={false} />
            <button disabled={locked} onClick={() => invoke(load)}>
              تحديث
            </button>
          </div>
        </header>
        {error && !form && (
          <p className="alert error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="alert success" role="status">
            {notice}
          </p>
        )}
        {!s.reconciled && (
          <p className="alert error">
            المخزون لا يطابق سجل الحركة. توقف عن التسجيل وراجع النسخ الاحتياطية.
          </p>
        )}
        <div hidden={view !== 'counter'}>
          <Counter
            s={s}
            busy={locked}
            save={run}
            onSaved={async (id) => {
              try {
                await openSale(id)
              } catch (e) {
                const m = e instanceof Error ? e.message : ''
                authError(m)
                setError('تم تسجيل الصرف؛ أعد فتح الفاتورة من قائمة الفواتير.')
              }
            }}
          />
        </div>
        {view !== 'counter' && (
          <div className="ph-page">
            <div className="ph-page-tools">
              <input
                aria-label="بحث في الصفحة"
                placeholder="ابحث في السجلات…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {view === 'catalog' && (
                <button className="primary" disabled={locked} onClick={() => medicineForm()}>
                  + دواء جديد
                </button>
              )}
              {view === 'receiving' && (
                <>
                  <button disabled={locked} onClick={() => supplierForm()}>
                    + مورد
                  </button>
                  <button
                    className="primary"
                    disabled={
                      locked ||
                      !s.medicines.some((x) => x.active) ||
                      !s.suppliers.some((x) => x.active)
                    }
                    onClick={() => setReceipt(true)}
                  >
                    استلام أدوية
                  </button>
                </>
              )}
              {view === 'users' && (
                <button className="primary" disabled={locked} onClick={() => userForm()}>
                  + مستخدم
                </button>
              )}
            </div>
            {view === 'catalog' && (
              <>
                <div className="ph-section-note">
                  الوحدة ثابتة بعد أول استلام. الروابط البديلة تدخلها أنت، والكميات تُصرف في وحدات
                  صحيحة.
                </div>
                <div className="ph-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>الدواء</th>
                        <th>الكود والباركود</th>
                        <th>الوحدة</th>
                        <th>المتاح الآمن</th>
                        <th>حد الطلب</th>
                        <th>السعر · ج.م</th>
                        <th>إجراءات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.medicines
                        .filter((m) => matches(m.name, m.code, m.barcode, m.ingredient))
                        .map((m) => (
                          <tr key={m.id}>
                            <td>
                              <strong>{m.name}</strong>
                              <small>
                                {[m.ingredient, m.strength, m.form].filter(Boolean).join(' · ')}
                              </small>
                              {!m.active && <span className="ph-badge danger">متوقف</span>}
                            </td>
                            <td dir="ltr">
                              {m.code}
                              <small>{m.barcode || '—'}</small>
                            </td>
                            <td>{m.unit}</td>
                            <td>
                              <span
                                className={
                                  m.availableQty <= m.reorderQty ? 'ph-badge warn' : 'ph-badge'
                                }
                              >
                                {m.availableQty}
                              </span>
                            </td>
                            <td>{m.reorderQty}</td>
                            <td>{amount(m.price)}</td>
                            <td>
                              <div className="toolbar">
                                <button disabled={locked} onClick={() => medicineForm(m)}>
                                  تعديل
                                </button>
                                <button disabled={locked || !m.barcode} onClick={() => setLabel(m)}>
                                  ملصق
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                {!s.medicines.length && (
                  <Empty>لا توجد أدوية. أضف الدواء ببياناته الفعلية ثم استلم أول تشغيلة.</Empty>
                )}
              </>
            )}
            {view === 'batches' && (
              <>
                <div className="ph-batch-summary">
                  <button
                    className={batchFilter === 'all' ? 'selected' : ''}
                    onClick={() => setBatchFilter('all')}
                  >
                    كل التشغيلات <b>{s.lots.length}</b>
                  </button>
                  <button
                    className={batchFilter === 'expired' ? 'selected' : ''}
                    onClick={() => setBatchFilter('expired')}
                  >
                    انتهت أو تنتهي اليوم{' '}
                    <b>{s.lots.filter((b) => b.expiry <= s.today && b.qty > 0).length}</b>
                  </button>
                  <button
                    className={batchFilter === 'near' ? 'selected' : ''}
                    onClick={() => setBatchFilter('near')}
                  >
                    تنتهي خلال 90 يومًا
                  </button>
                  <button
                    className={batchFilter === 'held' ? 'selected' : ''}
                    onClick={() => setBatchFilter('held')}
                  >
                    عزل وسحب ومرتجعات
                  </button>
                </div>
                <div className="ph-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>الدواء / التشغيلة</th>
                        <th>الصلاحية</th>
                        <th>حالة الصرف</th>
                        <th>الرصيد الأساسي</th>
                        <th>مرتجع معزول</th>
                        <th>التكلفة · ج.م</th>
                        <th>إجراءات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {batchList.map((b) => (
                        <tr key={b.id}>
                          <td>
                            <strong>{b.name}</strong>
                            <small dir="ltr">{b.batch}</small>
                          </td>
                          <td dir="ltr">{b.expiry}</td>
                          <td>
                            <span
                              className={
                                'ph-badge ' +
                                (b.expiry <= s.today
                                  ? 'danger'
                                  : b.status === 'available'
                                    ? ''
                                    : 'warn')
                              }
                            >
                              {b.expiry <= s.today ? 'منتهية — لا تُصرف' : statusLabels[b.status]}
                            </span>
                          </td>
                          <td>
                            {b.qty} {b.unit}
                          </td>
                          <td>
                            {b.quarantineQty} {b.unit}
                          </td>
                          <td>{amount(b.cost + b.quarantineCost)}</td>
                          <td>
                            <div className="toolbar">
                              <button disabled={locked} onClick={() => lotStatus(b)}>
                                الحالة
                              </button>
                              <button
                                disabled={locked || !b.qty}
                                onClick={() => dispose(b, 'available')}
                              >
                                هالك
                              </button>
                              <button
                                disabled={locked || !b.quarantineQty}
                                onClick={() => dispose(b, 'quarantine')}
                              >
                                إتلاف المرتجع
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!batchList.length && (
                  <Empty>لا توجد تشغيلات مطابقة. استلم الأدوية لبدء متابعة الصلاحية.</Empty>
                )}
              </>
            )}
            {view === 'receiving' && (
              <>
                <h2>الموردون</h2>
                {!s.suppliers.length ? (
                  <Empty>أضف المورد الفعلي قبل استلام الأدوية.</Empty>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>المورد</th>
                        <th>التواصل</th>
                        <th>العنوان</th>
                        <th>الحالة</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {s.suppliers
                        .filter((x) => matches(x.name, x.phone))
                        .map((x) => (
                          <tr key={x.id}>
                            <td>{x.name}</td>
                            <td dir="ltr">{x.phone || '—'}</td>
                            <td>{x.address || '—'}</td>
                            <td>{x.active ? 'نشط' : 'متوقف'}</td>
                            <td>
                              <button disabled={locked} onClick={() => supplierForm(x)}>
                                تعديل
                              </button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                )}
                <h2 className="ph-section-title">سجل المستندات</h2>
                <small>
                  يوثق الاستلام والصرف والمرتجعات والهالك وتغيير الحالة. الاستلام يسجل الكمية
                  والتكلفة ومرجع المورد؛ لا يدير سداد فواتير المورد.
                </small>
                <table>
                  <thead>
                    <tr>
                      <th>المستند</th>
                      <th>النوع</th>
                      <th>الوقت</th>
                      <th>المورد / المرجع</th>
                      <th>الملاحظة</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {s.documents
                      .filter((x) => matches(x.number, x.note, x.reference, x.supplier?.name))
                      .map((x) => (
                        <tr key={x.id}>
                          <td>{x.number}</td>
                          <td>{documentKinds[x.kind as keyof typeof documentKinds]}</td>
                          <td>{stamp(x.at)}</td>
                          <td>{x.supplier?.name ?? (x.reference || '—')}</td>
                          <td>{x.note || '—'}</td>
                          <td>
                            <button
                              disabled={locked}
                              onClick={() =>
                                invoke(async () => {
                                  const g = generation.current,
                                    r = await call<ReturnType<Pharmacy['document']>>(
                                      'pharmacy.document.get',
                                      { id: x.id },
                                    )
                                  if (g === generation.current) setDocument(r)
                                })
                              }
                            >
                              عرض
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                {!s.documents.length && <Empty>سيظهر أول مستند بعد الاستلام.</Empty>}
              </>
            )}
            {view === 'sales' && (
              <>
                <div className="ph-section-note">
                  تتبع الفواتير وصافي التحصيل والمتبقي. آخر 1000 فاتورة؛ التقرير يشمل النطاق المحدد
                  كاملًا.
                </div>
                <table>
                  <thead>
                    <tr>
                      <th>الفاتورة</th>
                      <th>الوقت</th>
                      <th>العميل</th>
                      <th>الإجمالي</th>
                      <th>المرتجع</th>
                      <th>صافي المحصل</th>
                      <th>المتبقي</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {s.sales
                      .filter((x) => matches(x.number, x.customer))
                      .map((x) => (
                        <tr key={x.id}>
                          <td>{x.number}</td>
                          <td>{stamp(x.at)}</td>
                          <td>{x.customer || 'عميل الكاونتر'}</td>
                          <td>{amount(x.total)}</td>
                          <td>{amount(x.credit)}</td>
                          <td>{amount(x.paid)}</td>
                          <td>
                            <span className={'ph-badge ' + (x.balance ? 'warn' : '')}>
                              {amount(x.balance)}
                            </span>
                          </td>
                          <td>
                            <button disabled={locked} onClick={() => invoke(() => openSale(x.id))}>
                              عرض الفاتورة
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                {!s.sales.length && <Empty>لا توجد فواتير. ابدأ بالصرف من الكاونتر.</Empty>}
              </>
            )}
            {view === 'reports' && (
              <>
                <div className="ph-report-tools">
                  <Field label="من">
                    <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                  </Field>
                  <Field label="إلى">
                    <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                  </Field>
                  <button
                    disabled={!report}
                    onClick={() =>
                      report &&
                      csv('Pharmacy-sales.csv', [
                        [
                          'الفاتورة',
                          'الوقت',
                          'العميل',
                          'الإجمالي',
                          'المرتجع',
                          'صافي المحصل',
                          'المتبقي',
                        ],
                        ...report.sales.map((x) => [
                          x.number,
                          stamp(x.at),
                          x.customer,
                          decimal(x.total),
                          decimal(x.credit),
                          decimal(x.paid),
                          decimal(x.balance),
                        ]),
                      ])
                    }
                  >
                    تصدير الفواتير CSV
                  </button>
                  <button
                    disabled={!report}
                    onClick={() =>
                      report &&
                      csv('Pharmacy-stock.csv', [
                        [
                          'المستند',
                          'النوع',
                          'الوقت',
                          'الدواء',
                          'التشغيلة',
                          'الصلاحية',
                          'المخزون',
                          'الكمية',
                          'التكلفة',
                          'السبب',
                        ],
                        ...report.movements.map((x) => [
                          x.number,
                          x.kind,
                          stamp(x.at),
                          x.name,
                          x.batch,
                          x.expiry,
                          x.bucket,
                          x.qty,
                          decimal(x.cost),
                          x.note,
                        ]),
                      ])
                    }
                  >
                    تصدير حركة المخزون
                  </button>
                  <button
                    disabled={!report}
                    onClick={() =>
                      report &&
                      csv('Pharmacy-payments.csv', [
                        ['الفاتورة', 'الوقت', 'الطريقة', 'المرجع', 'المبلغ'],
                        ...report.payments.map((x) => [
                          x.number,
                          stamp(x.at),
                          x.method,
                          x.reference,
                          decimal(x.amount),
                        ]),
                      ])
                    }
                  >
                    تصدير التحصيل
                  </button>
                </div>
                {report ? (
                  <>
                    <div className="ph-report-totals">
                      <div>
                        <small>صافي فواتير الفترة بعد مرتجعاتها</small>
                        <b>
                          {amount(report.sales.reduce((n, x) => n + x.total - x.credit, 0))} ج.م
                        </b>
                      </div>
                      <div>
                        <small>التحصيل والاسترداد خلال الفترة</small>
                        <b>{amount(report.payments.reduce((n, x) => n + x.amount, 0))} ج.م</b>
                      </div>
                      <div>
                        <small>المتبقي الحالي لفواتير الفترة</small>
                        <b>{amount(report.sales.reduce((n, x) => n + x.balance, 0))} ج.م</b>
                      </div>
                    </div>
                    <h2>التحصيل الفعلي في الفترة</h2>
                    <table>
                      <thead>
                        <tr>
                          <th>الفاتورة</th>
                          <th>الوقت</th>
                          <th>الطريقة</th>
                          <th>المرجع</th>
                          <th>المبلغ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.payments.map((x, i) => (
                          <tr key={i}>
                            <td>{x.number}</td>
                            <td>{stamp(x.at)}</td>
                            <td>{methods[x.method as keyof typeof methods]}</td>
                            <td>{x.reference}</td>
                            <td>{amount(x.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <h2 className="ph-section-title">حركة التشغيلات</h2>
                    <table>
                      <thead>
                        <tr>
                          <th>المستند</th>
                          <th>الحركة</th>
                          <th>الدواء</th>
                          <th>التشغيلة</th>
                          <th>المخزون</th>
                          <th>الكمية</th>
                          <th>التكلفة</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.movements
                          .filter((x) => matches(x.number, x.name, x.batch))
                          .map((x, i) => (
                            <tr key={i}>
                              <td>{x.number}</td>
                              <td>{documentKinds[x.kind as keyof typeof documentKinds]}</td>
                              <td>{x.name}</td>
                              <td>{x.batch}</td>
                              <td>{x.bucket === 'available' ? 'أساسي' : 'مرتجع معزول'}</td>
                              <td>{x.qty}</td>
                              <td>{amount(x.cost)}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </>
                ) : (
                  <Empty>اختر نطاقًا صحيحًا لقراءة التقرير</Empty>
                )}
              </>
            )}
            {view === 'users' && (
              <table>
                <thead>
                  <tr>
                    <th>الاسم</th>
                    <th>اسم المستخدم</th>
                    <th>الصلاحية</th>
                    <th>الحالة</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {s.users
                    .filter((x) => matches(x.name, x.username))
                    .map((u) => (
                      <tr key={u.id}>
                        <td>{u.name}</td>
                        <td>{u.username}</td>
                        <td>{roles[u.role]}</td>
                        <td>{u.active ? 'نشط' : 'متوقف'}</td>
                        <td>
                          <button disabled={locked} onClick={() => userForm(u)}>
                            تعديل
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
            {view === 'audit' && (
              <>
                <small>آخر 300 حدث؛ تسجيل الحسابات وعمليات المخزون والتحصيل والتفعيل.</small>
                <table>
                  <thead>
                    <tr>
                      <th>الوقت</th>
                      <th>المستخدم</th>
                      <th>العملية</th>
                      <th>معرف السجل</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.audit
                      .filter((x) => matches(x.action, x.user_name))
                      .map((x) => (
                        <tr key={x.id}>
                          <td>{stamp(x.at)}</td>
                          <td>{x.user_name || 'النظام'}</td>
                          <td dir="ltr">{x.action}</td>
                          <td dir="ltr">{x.entity_id}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </>
            )}
            {view === 'settings' && (
              <>
                <section className="ph-settings">
                  <h2>بيانات الصيدلية</h2>
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
                      <Field label="اسم الصيدلية">
                        <input
                          name="businessName"
                          required
                          maxLength={160}
                          defaultValue={s.settings.businessName}
                        />
                      </Field>
                      <Field label="التواصل">
                        <input
                          name="phone"
                          maxLength={40}
                          dir="ltr"
                          defaultValue={s.settings.phone}
                        />
                      </Field>
                    </div>
                    <Field label="العنوان">
                      <input name="address" maxLength={250} defaultValue={s.settings.address} />
                    </Field>
                    <Field label="نهاية الإيصال">
                      <input
                        name="receiptFooter"
                        maxLength={250}
                        defaultValue={s.settings.receiptFooter}
                      />
                    </Field>
                    <button disabled={locked} className="primary">
                      حفظ البيانات
                    </button>
                  </form>
                </section>
                <section className="ph-settings">
                  <LicensePanel />
                </section>
                <section className="ph-settings">
                  <h2>النسخ الاحتياطي</h2>
                  <p>
                    احتفظ بنسخة على قرص موثوق. قاعدة البيانات والنسخ غير مشفرة؛ الترخيص وحده محمي
                    بتشفير Windows.
                  </p>
                  <button
                    disabled={locked}
                    onClick={() =>
                      invoke(async () => {
                        const r = await call<{
                          download?: string
                          fileName?: string
                          cancelled?: boolean
                        }>('backup.create')
                        if (r.download)
                          download(
                            r.fileName ?? 'Pharmacy.xzbak',
                            new Blob([Uint8Array.from(atob(r.download), (c) => c.charCodeAt(0))]),
                          )
                        if (!r.cancelled) setNotice('تم إنشاء النسخة الاحتياطية')
                      })
                    }
                  >
                    إنشاء نسخة احتياطية
                  </button>
                  <button
                    disabled={locked}
                    onClick={() =>
                      saveForm(
                        'استعادة نسخة الصيدلية',
                        <>
                          <p>
                            تستبدل سجلات العمل وتنتهي الجلسات. تُحفظ نسخة تلقائية قبل الاستعادة،
                            ويظل ترخيص هذا الجهاز محفوظًا.
                          </p>
                          {!window.xzare && (
                            <Field label="ملف النسخة">
                              <input type="file" name="file" accept=".xzbak" required />
                            </Field>
                          )}
                          <Field label="كلمة مرور المسؤول">
                            <input
                              type="password"
                              name="password"
                              required
                              autoComplete="current-password"
                            />
                          </Field>
                          <label className="a-check">
                            <input required type="checkbox" />
                            أكد الاستعادة من النسخة المختارة
                          </label>
                        </>,
                        'backup.restore',
                        (f) => ({ password: String(f.get('password')), file: f.get('file') }),
                        'استعادة النسخة',
                      )
                    }
                  >
                    استعادة نسخة
                  </button>
                </section>
              </>
            )}
          </div>
        )}
      </main>
      {form && (
        <Modal
          title={form.title}
          busy={locked}
          error={error}
          submit={form.submit}
          onClose={() => setForm(null)}
          onSubmit={async (e) => {
            if (formSaving || mutex.current) return
            const current = form,
              f = new FormData(e.currentTarget)
            setFormSaving(true)
            try {
              const p = current.payload(f)
              if (current.action === 'backup.restore') {
                if (window.xzare) {
                  const r = await call<{ restored?: boolean; cancelled?: boolean }>(
                    'backup.restore',
                    { password: p.password },
                  )
                  if (r.restored) end()
                  else if (r.cancelled) setForm(null)
                } else {
                  const file = p.file
                  if (!(file instanceof File) || !file.size || file.size > 128 * 1024 * 1024)
                    throw new Error('اختر نسخة احتياطية صحيحة حتى 128 ميجابايت')
                  const r = await fetch('/api/restore', {
                    method: 'POST',
                    headers: {
                      'X-Xzare-Request': '1',
                      'X-Xzare-Password': encodeURIComponent(String(p.password)),
                    },
                    credentials: 'same-origin',
                    body: file,
                  })
                  const v = await r.json()
                  if (!r.ok || !v.ok) throw new Error(v.error ?? 'تعذر الاستعادة')
                  end()
                }
              } else {
                await run(current.action, p)
                setForm(null)
                if (current.action === 'password.change') end()
              }
            } catch (e) {
              setError(e instanceof Error ? e.message : 'تعذر الحفظ')
            } finally {
              setFormSaving(false)
            }
          }}
        >
          {form.body}
        </Modal>
      )}
      {receipt && (
        <ReceiptEditor s={s} busy={locked} save={run} onClose={() => setReceipt(false)} />
      )}
      {detail && (
        <SaleDetail
          key={detail.sale.id}
          d={detail}
          busy={locked}
          manager={manager}
          businessName={s.settings.businessName ?? ''}
          phone={s.settings.phone ?? ''}
          address={s.settings.address ?? ''}
          receiptFooter={s.settings.receiptFooter ?? ''}
          onClose={() => setDetail(null)}
          mutate={async (a, p) => {
            await commitThenRefresh(
              () => run(a, p),
              () => openSale(detail.sale.id),
              (e) => {
                setDetail(null)
                const m = e instanceof Error ? e.message : ''
                authError(m)
                setError('تم حفظ العملية؛ تعذر تحديث الفاتورة. أعد فتحها لقراءة الرصيد الجديد.')
              },
            )
          }}
        />
      )}
      {document && (
        <Modal
          title={document.document.number}
          busy={locked}
          error=""
          manual
          onClose={() => setDocument(null)}
        >
          <p>
            {documentKinds[document.document.kind as keyof typeof documentKinds]} ·{' '}
            {stamp(document.document.at)}
          </p>
          {document.document.supplier && <p>المورد: {document.document.supplier.name}</p>}
          <p>{document.document.note || document.document.reference}</p>
          <table>
            <thead>
              <tr>
                <th>الدواء</th>
                <th>التشغيلة</th>
                <th>الصلاحية</th>
                <th>المخزون</th>
                <th>الكمية</th>
                <th>التكلفة</th>
              </tr>
            </thead>
            <tbody>
              {document.entries.map((x) => (
                <tr key={x.id}>
                  <td>{x.name}</td>
                  <td>{x.batch}</td>
                  <td>{x.expiry}</td>
                  <td>{x.bucket === 'available' ? 'أساسي' : 'مرتجع معزول'}</td>
                  <td>{x.qty}</td>
                  <td>{amount(x.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {document.events.map((x) => (
            <p key={x.batch}>
              تشغيلة {x.batch} — {statusLabels[x.status as keyof typeof statusLabels]}
            </p>
          ))}
        </Modal>
      )}
      {label && (
        <Modal title="ملصق الدواء" busy={locked} error="" manual onClose={() => setLabel(null)}>
          <BarcodeLabel m={label} />
          <button onClick={() => window.print()}>طباعة الملصق</button>
        </Modal>
      )}
    </div>
  )
}
