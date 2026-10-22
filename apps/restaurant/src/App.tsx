import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Money, basisPoints, ulid } from '@xzare/core'
import type {
  AppState,
  RestaurantState,
  RestaurantOrder,
  MenuItem,
  RestaurantTable,
  Driver,
  OrderLine,
  Invoice,
  InvoiceLine,
} from '@xzare/engine'
import { App as Management, type Page } from '../../pos/src/App'
import { AuthScreen } from '../../pos/src/AuthScreen'
import { BrandMark } from '../../pos/src/BrandMark'
import { Icon } from '../../pos/src/Icon'
import { WorkspaceClock } from '../../pos/src/WorkspaceClock'
import { RestaurantIcon } from './RestaurantIcon'
import { PaymentForm } from './PaymentForm'
import { StartGuide } from './StartGuide'
import { call } from '../../pos/src/bridge'
import { useSessionActivity } from '../../pos/src/useSessionActivity'
import { floorState } from './floor-state'
import {
  Dialog,
  Field,
  Empty,
  fmt,
  decimal,
  amount,
  quantity,
  status,
  kind,
  terminal,
  date,
} from './ui'
type View = 'tables' | 'orders' | 'kitchen' | 'menu' | 'delivery' | 'reservations' | Page
type Form = {
  title: string
  body: ReactNode
  submit: (data: FormData) => Promise<void>
  button?: string
}
const names: Partial<Record<View, string>> = {
  tables: 'الطاولات',
  orders: 'الطلبات',
  kitchen: 'المطبخ',
  menu: 'قائمة الطعام',
  delivery: 'التوصيل',
  reservations: 'الحجوزات',
  products: 'الخامات والباركود',
  stock: 'المخزون',
  purchases: 'المشتريات',
  suppliers: 'الموردون',
  invoices: 'الفواتير',
  shifts: 'الوردية والخزينة',
  reports: 'التقارير',
  settings: 'الإعدادات والترخيص',
  users: 'المستخدمون',
  audit: 'سجل التدقيق',
}
const shared: Page[] = [
  'products',
  'stock',
  'purchases',
  'suppliers',
  'invoices',
  'shifts',
  'reports',
  'settings',
  'users',
  'audit',
]
export function App() {
  const [configured, setConfigured] = useState<boolean | null>(null),
    [state, setState] = useState<RestaurantState | null>(null),
    [core, setCore] = useState<AppState | null>(null),
    [view, setView] = useState<View>('tables'),
    [selected, setSelected] = useState(''),
    [form, setForm] = useState<Form | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [search, setSearch] = useState(''),
    [station, setStation] = useState(''),
    [floorZone, setFloorZone] = useState(''),
    [history, setHistory] = useState(false),
    [managementOpen, setManagementOpen] = useState(false),
    [receipt, setReceipt] = useState<{ invoice: Invoice; lines: InvoiceLine[] } | null>(null)
  const mutex = useRef(false),
    requests = useRef(new Map<string, string>()),
    polling = useRef(false),
    generation = useRef(0),
    loadSequence = useRef(0)
  const manager = state?.user.role === 'admin' || state?.user.role === 'manager',
    chef = state?.user.role === 'kitchen'
  const current = state?.orders.find((o) => o.id === selected)
  const sessionEnd = () => {
    generation.current++
    setState(null)
    setCore(null)
    setSelected('')
    setForm(null)
    setReceipt(null)
    setError('')
    requests.current.clear()
  }
  useSessionActivity(!!state, sessionEnd)
  const load = async () => {
    const sequence = ++loadSequence.current
    const g = generation.current
    const next = await call<RestaurantState>('restaurant.state')
    const base = next.user.role === 'kitchen' ? null : await call<AppState>('state')
    if (g !== generation.current || sequence !== loadSequence.current) return
    setState(next)
    setCore(base)
    return next
  }
  useEffect(() => {
    call<{ configured: boolean }>('auth.status')
      .then((v) => {
        setConfigured(v.configured)
        if (v.configured)
          void load()
            .then((next) => {
              if (next?.user.role === 'kitchen') setView('kitchen')
            })
            .catch(() => {})
      })
      .catch((e) => setError(String(e.message)))
  }, [])
  useEffect(() => {
    if (!state) return
    const timer = setInterval(() => {
      if (polling.current || mutex.current) return
      polling.current = true
      void load()
        .catch((e) => {
          if (/انتهت الجلسة|سجّل الدخول/.test(e.message)) sessionEnd()
          else setError(e.message)
        })
        .finally(() => {
          polling.current = false
        })
    }, 5000)
    return () => clearInterval(timer)
  }, [state?.user.id])
  useEffect(() => {
    if (!state) return
    let last = Date.now()
    const activity = () => {
      last = Date.now()
    }
    const timer = setInterval(() => {
      if (Date.now() - last > 600000) void call('logout').finally(sessionEnd)
    }, 10000)
    window.addEventListener('pointerdown', activity)
    window.addEventListener('keydown', activity)
    return () => {
      clearInterval(timer)
      window.removeEventListener('pointerdown', activity)
      window.removeEventListener('keydown', activity)
    }
  }, [state?.user.id])
  const run = async (action: string, payload: Record<string, unknown> = {}, command = true) => {
    if (mutex.current) throw new Error('انتظر انتهاء العملية')
    mutex.current = true
    setBusy(true)
    setError('')
    const key = JSON.stringify([action, payload])
    try {
      if (command && !requests.current.has(key)) requests.current.set(key, ulid())
      const result = await call<any>(
        action,
        command ? { ...payload, clientTxnId: requests.current.get(key) } : payload,
      )
      requests.current.delete(key)
      if (
        result?.lines &&
        result?.id &&
        ['restaurant.order.create', 'restaurant.reservation.seat'].includes(action)
      )
        setSelected(result.id)
      setNotice('تم حفظ العملية')
      try {
        await load()
      } catch (e) {
        const message = e instanceof Error ? e.message : ''
        if (/انتهت الجلسة|سجّل الدخول/.test(message)) sessionEnd()
        else setError('تم الحفظ؛ تعذر تحديث العرض. سيُعاد تحديثه تلقائيًا.')
      }
      return result
    } catch (e) {
      const message = e instanceof Error ? e.message : 'تعذر إتمام العملية'
      setError(message)
      if (/انتهت الجلسة|سجّل الدخول/.test(message)) sessionEnd()
      throw e
    } finally {
      mutex.current = false
      setBusy(false)
    }
  }
  const show = (next: Form) => {
    setError('')
    setForm(next)
  }
  const saveForm = (
    title: string,
    body: ReactNode,
    action: string,
    payload: (f: FormData) => Record<string, unknown>,
    command = false,
    button?: string,
  ) =>
    show({
      title,
      body,
      button,
      submit: async (f) => {
        await run(action, payload(f), command)
        setForm(null)
      },
    })
  const navigate = (next: View) => {
    setView(next)
    if (
      !['tables', 'orders', 'kitchen', 'delivery', 'reservations', 'shifts', 'invoices'].includes(
        next,
      )
    )
      setManagementOpen(true)
    setSelected('')
    setSearch('')
    setError('')
    setNotice('')
  }
  const openShift = () =>
    saveForm(
      'افتح وردية اليوم',
      <>
        <p className="muted">اكتب النقد الموجود فعليًا في الخزينة عند بداية ورديتك.</p>
        <Field label="رصيد بداية الوردية (ج.م)" name="opening" value="0" required />
      </>,
      'shift.open',
      (f) => ({ opening: amount(f.get('opening')) }),
      false,
      'فتح الوردية',
    )
  const quickOrder = (kind: 'dinein' | 'takeaway', tableId?: string) =>
    invoke(() =>
      run('restaurant.order.create', {
        kind,
        ...(tableId && { tableId }),
        customerName: '',
        phone: '',
        address: '',
        note: '',
      }),
    )
  const orderAction = (
    action: string,
    order: RestaurantOrder,
    extra: Record<string, unknown> = {},
  ) => run(action, { orderId: order.id, version: order.version, ...extra })
  const tableForm = (table?: RestaurantTable) =>
    saveForm(
      table ? 'تعديل الطاولة' : 'إضافة طاولة',
      <>
        <Field label="اسم الطاولة" name="name" value={table?.name} required />
        <Field label="المنطقة" name="zone" value={table?.zone} />
        <Field label="عدد المقاعد" name="seats" type="number" value={table?.seats ?? 2} required />
        <Field label="الحالة">
          <select name="active" defaultValue={table?.active === 0 ? '0' : '1'}>
            <option value="1">متاحة للاستخدام</option>
            <option value="0">متوقفة</option>
          </select>
        </Field>
      </>,
      'restaurant.table.save',
      (f) => ({
        ...(table && { id: table.id }),
        name: f.get('name'),
        zone: f.get('zone'),
        seats: Number(f.get('seats')),
        active: f.get('active') === '1',
      }),
    )
  const create = (type: 'dinein' | 'takeaway' | 'delivery', tableId?: string) =>
    saveForm(
      'طلب ' + kind[type],
      <>
        {type === 'dinein' && (
          <Field label="الطاولة">
            <select name="tableId" defaultValue={tableId}>
              {state!.tables
                .filter((t) => t.active && !t.orderId)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
          </Field>
        )}
        <Field label="اسم العميل" name="customerName" required={type === 'delivery'} />
        <Field label="الهاتف" name="phone" type="tel" required={type === 'delivery'} />
        {type === 'delivery' && (
          <>
            <Field label="عنوان التوصيل" name="address" required />
            <p className="muted">رسوم التوصيل: {fmt(state!.config.deliveryFee)}</p>
          </>
        )}
        <Field label="ملاحظة الطلب" name="note" />
      </>,
      'restaurant.order.create',
      (f) => ({
        kind: type,
        ...(type === 'dinein' && { tableId: f.get('tableId') }),
        customerName: f.get('customerName'),
        phone: f.get('phone'),
        address: f.get('address') ?? '',
        note: f.get('note'),
      }),
      true,
      'إنشاء الطلب',
    )
  const menuForm = (item?: MenuItem) => {
    if (!core) return
    const ingredients = core.products.filter((p) => p.active)
    show({
      title: item ? 'تعديل صنف الطعام' : 'إضافة صنف الطعام',
      body: (
        <>
          <Field label="الاسم" name="name" value={item?.name} required />
          <Field label="التصنيف" name="category" value={item?.category} />
          <Field label="سعر الحصة (ج.م)" name="price" value={decimal(item?.price ?? 0)} required />
          <div className="r-two">
            <Field label="محطة التحضير">
              <select name="station" defaultValue={item?.station ?? 'kitchen'}>
                <option value="kitchen">المطبخ</option>
                <option value="bar">المشروبات</option>
              </select>
            </Field>
            <Field label="طريقة تقديمه">
              <select name="kind" defaultValue={item?.kind ?? 'prepared'}>
                <option value="prepared">وصفة من خامات</option>
                <option value="stocked">منتج جاهز من المخزون</option>
                <option value="service">خدمة بلا خامات</option>
              </select>
            </Field>
          </div>
          <Field label="الحالة">
            <select name="active" defaultValue={item?.active === 0 ? '0' : '1'}>
              <option value="1">متاح</option>
              <option value="0">متوقف</option>
            </select>
          </Field>
          <h3>الخامات لكل حصة</h3>
          <p className="muted">
            اكتب الكمية بجانب الخامات المستخدمة فقط. المنتج الجاهز يحتاج خامة واحدة بكمية 1؛ الخدمة
            لا تحتاج خامات. أضف الخامات ورصيدها من قسم الخامات والمخزون.
          </p>
          {ingredients.map((p) => (
            <Field
              key={p.id}
              label={`${p.name} (${p.unit})`}
              name={'recipe:' + p.id}
              value={String((item?.components.find((c) => c.variantId === p.id)?.qty ?? 0) / 1000)}
            />
          ))}
          {!ingredients.length && (
            <p className="muted">لا توجد خامات بعد. يمكنك تسجيل خدمة، أو إضافة الخامات أولًا.</p>
          )}
        </>
      ),
      submit: async (f) => {
        const components = ingredients
          .map((p) => ({ variantId: p.id, qty: quantity(f.get('recipe:' + p.id)) }))
          .filter((c) => c.qty > 0)
        await run(
          'restaurant.menu.save',
          {
            ...(item && { id: item.id }),
            name: f.get('name'),
            category: f.get('category'),
            price: amount(f.get('price')),
            station: f.get('station'),
            kind: f.get('kind'),
            active: f.get('active') === '1',
            components,
          },
          false,
        )
        setForm(null)
      },
    })
  }
  const driverForm = (driver?: Driver) =>
    saveForm(
      driver ? 'تعديل المندوب' : 'إضافة مندوب',
      <>
        <Field label="الاسم" name="name" value={driver?.name} required />
        <Field label="الهاتف" name="phone" type="tel" value={driver?.phone} />
        <Field label="الحالة">
          <select name="active" defaultValue={driver?.active === 0 ? '0' : '1'}>
            <option value="1">متاح</option>
            <option value="0">متوقف</option>
          </select>
        </Field>
      </>,
      'restaurant.driver.save',
      (f) => ({
        ...(driver && { id: driver.id }),
        name: f.get('name'),
        phone: f.get('phone'),
        active: f.get('active') === '1',
      }),
    )
  const cancel = (order: RestaurantOrder, line?: OrderLine) =>
    saveForm(
      line ? 'إلغاء ' + line.name : 'إلغاء الطلب',
      <>
        <p>
          {line?.preparedAt || order.lines.some((l) => l.preparedAt)
            ? 'الصنف الذي بدأ تحضيره يُسجل كهدر ولا تعود خاماته إلى المخزون.'
            : 'سيُلغى الطلب أو الصنف قبل التحضير.'}
        </p>
        <Field label="سبب الإلغاء" name="reason" required />
      </>,
      line ? 'restaurant.line.cancel' : 'restaurant.order.cancel',
      (f) => ({
        orderId: order.id,
        version: order.version,
        ...(line && { lineId: line.id }),
        reason: f.get('reason'),
      }),
      true,
      'تأكيد الإلغاء',
    )
  const add = (item: MenuItem, order: RestaurantOrder) =>
    saveForm(
      item.name,
      <>
        <p>{fmt(item.price)} / حصة</p>
        <Field label="عدد الحصص" name="qty" type="number" value={1} required />
        <Field label="ملاحظة للمطبخ" name="note" />
      </>,
      'restaurant.order.add',
      (f) => ({
        orderId: order.id,
        version: order.version,
        menuId: item.id,
        qty: Number(f.get('qty')) * 1000,
        note: f.get('note'),
      }),
      true,
      'إضافة للطلب',
    )
  const checkout = (order: RestaurantOrder) => {
    if (!core?.shift) {
      setError('افتح ورديتك من قسم الوردية والخزينة قبل التحصيل')
      return
    }
    saveForm(
      'تحصيل ' + order.number,
      <PaymentForm order={order} allowDiscount={!!manager} />,
      'restaurant.checkout',
      (f) => ({
        orderId: order.id,
        version: order.version,
        cash: amount(f.get('cash')),
        card: amount(f.get('card')),
        transfer: amount(f.get('transfer')),
        discount: amount(f.get('discount')),
      }),
      true,
      'تسجيل التحصيل',
    )
  }
  const dispatch = (order: RestaurantOrder) =>
    saveForm(
      'إرسال ' + order.number,
      <Field label="المندوب">
        <select name="driverId" required>
          {state!.drivers
            .filter((d) => d.active)
            .map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} · {d.trips} طلب مع المندوب
              </option>
            ))}
        </select>
      </Field>,
      'restaurant.delivery.dispatch',
      (f) => ({ orderId: order.id, version: order.version, driverId: f.get('driverId') }),
      true,
      'إرسال مع المندوب',
    )
  const booking = () =>
    saveForm(
      'حجز طاولة',
      <>
        <Field label="الطاولة">
          <select name="tableId" required>
            {state!.tables
              .filter((t) => t.active)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} · {t.seats} مقاعد
                </option>
              ))}
          </select>
        </Field>
        <Field label="اسم الضيف" name="name" required />
        <Field label="الهاتف" name="phone" type="tel" />
        <Field label="عدد الضيوف" name="guests" type="number" value={2} required />
        <Field label="من" name="startsAt" type="datetime-local" required />
        <Field label="إلى" name="endsAt" type="datetime-local" required />
      </>,
      'restaurant.reservation.save',
      (f) => ({
        tableId: f.get('tableId'),
        name: f.get('name'),
        phone: f.get('phone'),
        guests: Number(f.get('guests')),
        startsAt: new Date(String(f.get('startsAt'))).getTime(),
        endsAt: new Date(String(f.get('endsAt'))).getTime(),
      }),
      true,
    )
  const invoke = (fn: () => Promise<unknown>) =>
    void fn().catch((e) => {
      const message = e instanceof Error ? e.message : 'تعذر إتمام العملية'
      setError(message)
      if (/انتهت الجلسة|سجّل الدخول/.test(message)) sessionEnd()
    })
  const ticket = (order: RestaurantOrder, kitchen = false, kitchenStage?: string) => {
    const lines = kitchen
      ? order.lines.filter(
          (l) =>
            ['queued', 'preparing', 'ready'].includes(l.status) &&
            (!kitchenStage || l.status === kitchenStage) &&
            (!station || l.station === station),
        )
      : order.lines
    return (
      <article className="r-ticket" key={order.id}>
        <header>
          <div>
            <b dir="ltr">{order.number}</b>
            <span>{order.tableName ?? kind[order.kind]}</span>
          </div>
          <span className={'r-status ' + (kitchenStage ?? order.status)}>{status[kitchenStage ?? order.status]}</span>
        </header>
        <small className="muted">{date(order.createdAt)}</small>
        {lines.map((l) => (
          <div className={'r-ticket-line ' + l.status} key={l.id}>
            <div>
              <b>
                {l.qty / 1000} × {l.name}
              </b>
              <small>
                {status[l.status]} · {l.station === 'bar' ? 'المشروبات' : 'المطبخ'}
                {l.preparedAt
                  ? ' · ' +
                    Math.max(0, Math.floor((Date.now() - l.preparedAt) / 60000)) +
                    ' دقيقة منذ بدء التحضير'
                  : ''}
              </small>
              {l.note && <p className="r-food-note">{l.note}</p>}
            </div>
            {kitchen &&
              state?.user.role !== 'cashier' &&
              ['queued', 'preparing'].includes(l.status) && (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    invoke(() =>
                      orderAction('restaurant.line.advance', order, {
                        lineId: l.id,
                        status: l.status === 'queued' ? 'preparing' : 'ready',
                      }),
                    )
                  }
                >
                  {l.status === 'queued' ? 'بدء التحضير' : 'جاهز'}
                </button>
              )}
          </div>
        ))}
        {!kitchen && <button onClick={() => setSelected(order.id)}>فتح الطلب</button>}
      </article>
    )
  }
  const detail = (order: RestaurantOrder) => (
    <div className="r-order-layout">
      <section className="r-order-menu">
        <div className="r-section-title">
          <div>
            <span className="eyebrow">الطلب الفعلي</span>
            <h2>
              {order.tableName ?? kind[order.kind]} <small dir="ltr">{order.number}</small>
            </h2>
          </div>
          <button onClick={() => setSelected('')}>العودة</button>
        </div>
        {order.customerName && (
          <p>
            {order.customerName} · {order.phone}
          </p>
        )}
        {order.address && <p>{order.address}</p>}
        {order.note && <p className="r-food-note">{order.note}</p>}
        {!terminal(order.status) && order.status !== 'out' && (
          <>
            <input
              className="r-search"
              aria-label="بحث في قائمة الطعام"
              placeholder="ابحث عن صنف الطعام"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="r-menu-grid">
              {state!.menu
                .filter((m) => m.active && m.name.includes(search))
                .map((m) => (
                  <button key={m.id} disabled={busy} onClick={() => add(m, order)}>
                    <strong>{m.name}</strong>
                    <small>{m.category || 'بدون تصنيف'}</small>
                    <b>{fmt(m.price)}</b>
                  </button>
                ))}
            </div>
            {!state!.menu.some((m) => m.active) && (
              <Empty title="أضف قائمة الطعام">
                سجّل الخامات ثم الوصفات والأسعار من قائمة الطعام.
              </Empty>
            )}
          </>
        )}
      </section>
      <section className="r-order-summary">
        <header>
          <h3>تفاصيل الطلب</h3>
          <span className={'r-status ' + order.status}>{status[order.status]}</span>
        </header>
        {order.lines.map((l) => (
          <div key={l.id} className={'r-order-line ' + l.status}>
            <div>
              <strong>
                {l.qty / 1000} × {l.name}
              </strong>
              <small>{status[l.status]}</small>
              {l.note && <p>{l.note}</p>}
            </div>
            <b>{fmt((l.price * l.qty) / 1000)}</b>
            {!terminal(order.status) && order.status !== 'out' && l.status !== 'cancelled' && (
              <div className="r-line-actions">
                {l.status === 'ready' && order.kind === 'dinein' && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      invoke(() =>
                        orderAction('restaurant.line.advance', order, {
                          lineId: l.id,
                          status: 'served',
                        }),
                      )
                    }
                  >
                    تم التقديم
                  </button>
                )}
                {(!l.preparedAt || manager) && (
                  <button disabled={busy} onClick={() => cancel(order, l)}>
                    إلغاء الصنف
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
        {!order.lines.length && <p className="muted">اختر الأصناف ثم أرسلها للمطبخ.</p>}
        <div className="r-totals">
          <p>
            الطعام والخدمات <b>{fmt(order.subtotal - order.deliveryFee)}</b>
          </p>
          {order.deliveryFee > 0 && (
            <p>
              التوصيل <b>{fmt(order.deliveryFee)}</b>
            </p>
          )}
          <p>
            ضريبة {order.taxBps / 100}%{' '}
            <b>
              {fmt(
                Money.applyRate(
                  Money.fromPiastres(order.subtotal),
                  basisPoints(order.taxBps),
                ) as number,
              )}
            </b>
          </p>
          <p>
            الإجمالي{' '}
            <b>
              {fmt(
                order.invoice?.total ??
                  order.subtotal +
                    (Money.applyRate(
                      Money.fromPiastres(order.subtotal),
                      basisPoints(order.taxBps),
                    ) as number),
              )}
            </b>
          </p>
        </div>
        <div className="r-order-actions">
          {order.lines.some((l) => l.status === 'draft') && !terminal(order.status) && (
            <button
              className="primary"
              disabled={busy}
              onClick={() => invoke(() => orderAction('restaurant.order.send', order))}
            >
              إرسال للمطبخ
            </button>
          )}
          {['ready', 'served', 'out'].includes(order.status) && (
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                order.kind === 'delivery' && order.status !== 'out'
                  ? dispatch(order)
                  : checkout(order)
              }
            >
              {order.kind === 'delivery' && order.status !== 'out'
                ? 'تعيين المندوب وإرسال'
                : 'تحصيل وإغلاق الطلب'}
            </button>
          )}
          {!terminal(order.status) && order.status !== 'out' && order.kind === 'dinein' && (
            <button
              disabled={busy}
              onClick={() =>
                saveForm(
                  'نقل الطاولة',
                  <Field label="الطاولة الجديدة">
                    <select name="tableId" required>
                      {state!.tables
                        .filter((t) => t.active && !t.orderId)
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                    </select>
                  </Field>,
                  'restaurant.order.move',
                  (f) => ({ orderId: order.id, version: order.version, tableId: f.get('tableId') }),
                  true,
                )
              }
            >
              نقل إلى طاولة أخرى
            </button>
          )}
          {!terminal(order.status) &&
            order.status !== 'out' &&
            (!order.lines.some((l) => l.preparedAt) || manager) && (
              <button className="danger" disabled={busy} onClick={() => cancel(order)}>
                إلغاء الطلب
              </button>
            )}
          {order.invoice && (
            <>
              <p>
                فاتورة {order.invoice.number} · الباقي للعميل {fmt(order.invoice.change)}
              </p>
              <button
                disabled={busy}
                onClick={() =>
                  invoke(async () => {
                    const data = await call<{ invoice: Invoice; lines: InvoiceLine[] }>(
                      'invoice.get',
                      { id: order.invoice!.id },
                    )
                    setReceipt(data)
                  })
                }
              >
                عرض وطباعة الفاتورة
              </button>
              {manager && order.status === 'completed' && (
                <button
                  onClick={() =>
                    saveForm(
                      'استرداد كامل للطلب',
                      <>
                        <p>
                          يُسترد {fmt(order.invoice!.total)}؛ تظل تكلفة الخامات المستهلكة مسجلة.
                        </p>
                        <Field label="السبب" name="reason" required />
                        <Field label="طريقة الاسترداد">
                          <select name="method">
                            <option value="cash">نقدي</option>
                            <option value="card">بطاقة</option>
                            <option value="transfer">تحويل</option>
                          </select>
                        </Field>
                      </>,
                      'restaurant.refund',
                      (f) => ({
                        orderId: order.id,
                        reason: f.get('reason'),
                        method: f.get('method'),
                      }),
                      true,
                      'تسجيل الاسترداد',
                    )
                  }
                >
                  استرداد كامل
                </button>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  )
  if (!state)
    return (
      <AuthScreen
        product="restaurant"
        configured={configured}
        busy={busy}
        error={error}
        onAuthenticate={async (values) => {
          if (mutex.current) return
          mutex.current = true
          setBusy(true)
          setError('')
          try {
            await call(
              configured ? 'login' : 'setup',
              configured ? { username: values.username, password: values.password } : values,
            )
            setConfigured(true)
            const next = await load()
            setView(next?.user.role === 'kitchen' ? 'kitchen' : 'tables')
          } catch (e) {
            setError(e instanceof Error ? e.message : 'تعذر الدخول')
            throw e
          } finally {
            mutex.current = false
            setBusy(false)
          }
        }}
      />
    )
  const daily: View[] = chef
    ? ['kitchen']
    : ['tables', 'orders', 'kitchen', 'delivery', 'reservations', 'shifts', 'invoices']
  const administration: View[] = chef
    ? []
    : [
        'menu',
        ...(manager ? (['products', 'stock', 'purchases', 'suppliers', 'reports'] as View[]) : []),
        ...(state.user.role === 'admin' ? (['settings', 'users', 'audit'] as View[]) : []),
      ]
  const active = state.orders.filter((o) => !terminal(o.status))
  const navButton = (v: View) => (
    <button
      key={v}
      className={view === v ? 'active' : ''}
      aria-current={view === v ? 'page' : undefined}
      onClick={() => navigate(v)}
    >
      {shared.includes(v as Page) ? <Icon name={v as Page} /> : <RestaurantIcon name={v} />}
      {names[v]}
      {v === 'orders' && <span>{active.length}</span>}
    </button>
  )
  return (
    <div className="r-app">
      <aside className="r-sidebar no-print">
        <div className="r-brand">
          <BrandMark />
          <div>
            XZARE<small>RESTAURANT</small>
          </div>
        </div>
        <div className="r-business">
          {state.businessName}
          <small>مساحة إدارة المطعم</small>
        </div>
        <nav aria-label="أقسام المطعم">
          <small className="r-nav-label">العمل اليومي</small>
          {daily.map(navButton)}
          {!!administration.length && (
            <details
              className="r-management-nav"
              open={managementOpen}
              onToggle={(e) => setManagementOpen(e.currentTarget.open)}
            >
              <summary>إدارة المطعم</summary>
              {administration.map(navButton)}
            </details>
          )}
        </nav>
        <footer>
          <span>XZARE / 0.2</span>
          <small>hello@xzare.com</small>
        </footer>
      </aside>
      <div className="r-workspace">
        <header className="r-topbar no-print">
          <div>
            المطعم / <strong>{names[view]}</strong>
          </div>
          <div className="r-top-actions">
            <WorkspaceClock english={false} />
            {!chef && (
              <button
                disabled={busy}
                onClick={() => (core?.shift ? navigate('shifts') : openShift())}
              >
                {core?.shift ? 'وردية مفتوحة' : 'افتح وردية'}
              </button>
            )}
            <button
              onClick={() =>
                saveForm(
                  'تغيير كلمة المرور',
                  <>
                    <Field
                      label="كلمة المرور الحالية"
                      name="currentPassword"
                      type="password"
                      required
                    />
                    <Field
                      label="كلمة المرور الجديدة"
                      name="newPassword"
                      type="password"
                      required
                    />
                  </>,
                  'password.change',
                  (f) => ({ current: f.get('currentPassword'), password: f.get('newPassword') }),
                  false,
                )
              }
            >
              كلمة المرور
            </button>
            <button
              disabled={busy}
              onClick={() =>
                invoke(async () => {
                  await call('logout')
                  sessionEnd()
                })
              }
            >
              {state.user.name} · قفل
            </button>
          </div>
        </header>
        <main className="r-main">
          <div className="r-page-heading">
            <div>
              <span className="eyebrow">XZARE RESTAURANT</span>
              <h1>{names[view]}</h1>
              <p>
                {view === 'kitchen'
                  ? 'طلبات مرسلة فعلًا؛ بدء التحضير يخصم الخامات مرة واحدة.'
                  : view === 'tables'
                    ? 'استقبل الضيف، وافتح طلبه من طاولته.'
                    : view === 'menu'
                      ? 'أسعار ووصفات تخصم الخامات عند التحضير.'
                      : 'عمليات مطعمك المسجلة على هذا الجهاز.'}
              </p>
            </div>
            <div className="r-toolbar">
              {view === 'tables' && manager && (
                <button className="primary" onClick={() => tableForm()}>
                  إضافة طاولة
                </button>
              )}
              {view === 'orders' && !current && (
                <>
                  <button disabled={busy} onClick={() => quickOrder('takeaway')}>
                    طلب تيك أواي
                  </button>
                  <button className="primary" onClick={() => create('delivery')}>
                    طلب توصيل
                  </button>
                </>
              )}
              {view === 'menu' && manager && (
                <button className="primary" onClick={() => menuForm()}>
                  إضافة صنف الطعام
                </button>
              )}
              {view === 'delivery' && (
                <>
                  <button onClick={() => create('delivery')}>طلب توصيل</button>
                  {manager && (
                    <button className="primary" onClick={() => driverForm()}>
                      إضافة مندوب
                    </button>
                  )}
                </>
              )}
              {view === 'reservations' && (
                <button className="primary" onClick={booking}>
                  حجز طاولة
                </button>
              )}
            </div>
          </div>
          {error && !form && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="r-notice" role="status">
              {notice}
            </p>
          )}
          {manager && core && view === 'tables' && !current && (
            <StartGuide state={state} core={core} openShift={openShift} navigate={navigate} />
          )}
          {shared.includes(view as Page) && core ? (
            <Management
              key={view}
              embeddedPage={view as Page}
              initialState={core}
              restaurant
              onSessionEnd={sessionEnd}
              onStateChange={setCore}
            />
          ) : current && !chef ? (
            detail(current)
          ) : (
            <>
              {view === 'tables' && (
                <>
                  <div className="r-legend">
                    <span className="free">
                      متاحة: {state.tables.filter((t) => t.active && floorState(t.id, t.orderId, state.orders) === 'free').length}
                    </span>
                    <span className="occupied">مشغولة: {state.tables.filter((t) => t.orderId).length}</span>
                    <span className="billed">مفوترة ومتاحة: {state.tables.filter((t) => t.active && floorState(t.id, t.orderId, state.orders) === 'billed').length}</span>
                  </div>
                  <div className="r-floor-tools">
                    <div className="r-zone-tabs" aria-label="مناطق المطعم">
                      {['', ...new Set(state.tables.map((t) => t.zone || 'الصالة'))].map((zone) => (
                        <button key={zone} type="button" aria-pressed={floorZone === zone} className={floorZone === zone ? 'primary' : ''} onClick={() => setFloorZone(zone)}>{zone || 'كل المناطق'}</button>
                      ))}
                    </div>
                    <small>المس طاولة متاحة لفتح طلب، أو طاولة مشغولة لمتابعة طلبها.</small>
                  </div>
                  <div className="r-table-grid r-floor-plan" aria-label="مخطط الطاولات">
                    {state.tables
                      .filter((t) => (t.active || manager) && (!floorZone || (t.zone || 'الصالة') === floorZone))
                      .map((t) => (
                        <article
                          className={
                            'r-table ' +
                            floorState(t.id, t.orderId, state.orders) +
                            (t.active ? '' : ' inactive')
                          }
                          key={t.id}
                        >
                          <button
                            disabled={!t.active || busy}
                            onClick={() =>
                              t.orderId ? setSelected(t.orderId) : quickOrder('dinein', t.id)
                            }
                          >
                            <span className="r-table-mark" aria-hidden="true">
                              <span /><span /><span /><span />
                            </span>
                            <strong>{t.name}</strong>
                            <small>
                              {t.zone || 'الصالة'} · {t.seats} مقاعد
                            </small>
                            <span className={'r-status ' + (t.status ?? 'available')}>
                              {!t.active ? 'متوقفة' : t.status ? status[t.status] : floorState(t.id, t.orderId, state.orders) === 'billed' ? 'مفوتر · متاحة لطلب جديد' : 'متاحة'}
                            </span>
                            {t.orderNumber && <b dir="ltr">{t.orderNumber}</b>}
                          </button>
                          {manager && (
                            <button className="r-table-edit" onClick={() => tableForm(t)}>
                              تعديل
                            </button>
                          )}
                        </article>
                      ))}
                  </div>
                  {!state.tables.length && (
                    <Empty title="ابدأ بتوزيع طاولاتك">
                      أضف أسماء الطاولات وعدد المقاعد الفعلي؛ أو افتح طلب تيك أواي من الطلبات.
                    </Empty>
                  )}
                </>
              )}
              {view === 'orders' && (
                <>
                  <div className="r-filter">
                    <button className={!history ? 'primary' : ''} onClick={() => setHistory(false)}>
                      الطلبات النشطة ({active.length})
                    </button>
                    <button className={history ? 'primary' : ''} onClick={() => setHistory(true)}>
                      آخر الطلبات المغلقة
                    </button>
                  </div>
                  <div className="r-ticket-grid">
                    {state.orders
                      .filter((o) => (history ? terminal(o.status) : !terminal(o.status)))
                      .map((o) => ticket(o))}
                  </div>
                  {!(history ? state.orders.filter((o) => terminal(o.status)) : active).length && (
                    <Empty title="لا توجد طلبات هنا">
                      افتح طلبًا من الطاولات، أو اختر تيك أواي أو توصيل.
                    </Empty>
                  )}
                </>
              )}
              {view === 'kitchen' && (
                <>
                  <div className="r-filter">
                    <label>
                      محطة التحضير{' '}
                      <select
                        aria-label="محطة التحضير"
                        value={station}
                        onChange={(e) => setStation(e.target.value)}
                      >
                        <option value="">جميع المحطات</option>
                        <option value="kitchen">المطبخ</option>
                        <option value="bar">المشروبات</option>
                      </select>
                    </label>
                    <span className="muted">يتحدث العرض كل 5 ثوانٍ</span>
                  </div>
                  <div className="r-kds-board" aria-label="مراحل تحضير الطلبات">
                    {(['queued', 'preparing', 'ready'] as const).map((lane) => {
                      const orders = active.filter((order) => order.status !== 'out' && order.lines.some((line) => line.status === lane && (!station || line.station === station)))
                      return <section key={lane} className={'r-kds-lane ' + lane} aria-label={status[lane]}>
                        <header className="r-kds-lane-head"><h2>{status[lane]}</h2><b>{orders.length}</b></header>
                        {orders.length ? orders.map((order) => ticket(order, true, lane)) : <p className="r-kds-empty">لا توجد أصناف في هذه المرحلة</p>}
                      </section>
                    })}
                  </div>
                  {!active.some(
                    (o) =>
                      o.status !== 'out' &&
                      o.lines.some(
                        (l) =>
                          ['queued', 'preparing', 'ready'].includes(l.status) &&
                          (!station || l.station === station),
                      ),
                  ) && (
                    <Empty title="لا توجد تذاكر تحضير">
                      تظهر هنا الأصناف بعد إرسال الطلب للمطبخ.
                    </Empty>
                  )}
                </>
              )}
              {view === 'menu' && (
                <>
                  <input
                    className="r-search"
                    aria-label="بحث في الأصناف"
                    placeholder="ابحث بالاسم أو التصنيف"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <div className="r-menu-grid">
                    {state.menu
                      .filter((m) => manager || m.active)
                      .filter((m) => (m.name + ' ' + m.category).includes(search))
                      .map((m) => (
                        <article
                          className={'r-menu-item ' + (m.active ? '' : 'inactive')}
                          key={m.id}
                        >
                          <div className="r-menu-stripe" />
                          <small>
                            {m.category || 'بدون تصنيف'} ·{' '}
                            {m.station === 'bar' ? 'المشروبات' : 'المطبخ'}
                          </small>
                          <h3>{m.name}</h3>
                          <strong>{fmt(m.price)}</strong>
                          <p>
                            {m.kind === 'service'
                              ? 'خدمة'
                              : m.kind === 'stocked'
                                ? 'منتج جاهز'
                                : 'وصفة'}{' '}
                            · {m.active ? 'متاح' : 'متوقف'}
                          </p>
                          {manager && (
                            <>
                              <small>
                                {m.components
                                  .map((c) => `${c.name}: ${c.qty / 1000} ${c.unit}`)
                                  .join('، ')}
                              </small>
                              <button onClick={() => menuForm(m)}>تعديل الوصفة والسعر</button>
                            </>
                          )}
                        </article>
                      ))}
                  </div>
                  {!state.menu.length && (
                    <Empty title="قائمة الطعام فارغة">
                      أضف الخامات ورصيد المخزون، ثم سجّل وصفاتك وأسعارك الفعلية.
                    </Empty>
                  )}
                </>
              )}
              {view === 'delivery' && (
                <>
                  <div className="r-delivery-drivers">
                    {state.drivers.map((d) => (
                      <article key={d.id}>
                        <strong>{d.name}</strong>
                        <span>{d.phone}</span>
                        <small>{d.active ? `${d.trips} طلب مع المندوب` : 'متوقف'}</small>
                        {manager && <button onClick={() => driverForm(d)}>تعديل</button>}
                      </article>
                    ))}
                  </div>
                  {manager && (
                    <button
                      onClick={() =>
                        saveForm(
                          'رسوم التوصيل',
                          <Field
                            label="رسوم التوصيل الافتراضية (ج.م)"
                            name="deliveryFee"
                            value={decimal(state.config.deliveryFee)}
                            required
                          />,
                          'restaurant.config.save',
                          (f) => ({ deliveryFee: amount(f.get('deliveryFee')) }),
                        )
                      }
                    >
                      رسوم التوصيل: {fmt(state.config.deliveryFee)}
                    </button>
                  )}
                  <div className="r-ticket-grid">
                    {active
                      .filter((o) => o.kind === 'delivery')
                      .map((o) => (
                        <article key={o.id} className="r-ticket">
                          <header>
                            <b dir="ltr">{o.number}</b>
                            <span className={'r-status ' + o.status}>{status[o.status]}</span>
                          </header>
                          <h3>{o.customerName}</h3>
                          <p>{o.phone}</p>
                          <p>{o.address}</p>
                          {o.driverName && <p>المندوب: {o.driverName}</p>}
                          <button onClick={() => setSelected(o.id)}>فتح الطلب</button>
                          {o.status === 'ready' && (
                            <button
                              disabled={busy || !state.drivers.some((d) => d.active)}
                              className="primary"
                              onClick={() => dispatch(o)}
                            >
                              تعيين المندوب وإرسال
                            </button>
                          )}
                          {o.status === 'out' && (
                            <button className="primary" onClick={() => checkout(o)}>
                              تأكيد التسليم والتحصيل
                            </button>
                          )}
                        </article>
                      ))}
                  </div>
                  {!active.some((o) => o.kind === 'delivery') && (
                    <Empty title="لا توجد طلبات توصيل نشطة">
                      سجّل الطلب وعنوان العميل، ثم عيّن المندوب بعد تجهيز الطعام.
                    </Empty>
                  )}
                </>
              )}
              {view === 'reservations' && (
                <>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          {[
                            'الطاولة',
                            'الضيف',
                            'الهاتف',
                            'العدد',
                            'الوقت',
                            'الحالة',
                            'الإجراء',
                          ].map((t) => (
                            <th key={t}>{t}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {state.reservations.map((b) => (
                          <tr key={b.id}>
                            <td>{b.tableName}</td>
                            <td>{b.name}</td>
                            <td>{b.phone}</td>
                            <td>{b.guests}</td>
                            <td>
                              {date(b.startsAt)}
                              <br />
                              {date(b.endsAt)}
                            </td>
                            <td>{status[b.status]}</td>
                            <td>
                              {b.status === 'booked' && (
                                <>
                                  <button
                                    disabled={busy}
                                    onClick={() =>
                                      invoke(async () => {
                                        const result = await run('restaurant.reservation.seat', {
                                          reservationId: b.id,
                                        })
                                        if (result?.id) {
                                          setView('orders')
                                          setSelected(result.id)
                                        }
                                      })
                                    }
                                  >
                                    حضر الضيف
                                  </button>
                                  <button
                                    disabled={busy}
                                    onClick={() =>
                                      saveForm(
                                        'إلغاء الحجز',
                                        <p>
                                          إلغاء حجز {b.name} على {b.tableName}؟
                                        </p>,
                                        'restaurant.reservation.cancel',
                                        () => ({ reservationId: b.id }),
                                        true,
                                        'تأكيد الإلغاء',
                                      )
                                    }
                                  >
                                    إلغاء الحجز
                                  </button>
                                </>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!state.reservations.length && (
                    <Empty title="لا توجد حجوزات">
                      اختر الطاولة والفترة وعدد الضيوف؛ يُرفض أي حجز متداخل.
                    </Empty>
                  )}
                </>
              )}
            </>
          )}
        </main>
      </div>
      {form && (
        <Dialog
          title={form.title}
          busy={busy}
          error={error}
          close={() => setForm(null)}
          submit={async (f) => {
            try {
              await form.submit(f)
            } catch (e) {
              setError(e instanceof Error ? e.message : 'راجع البيانات')
            }
          }}
          button={form.button}
        >
          {form.body}
        </Dialog>
      )}
      {receipt && (
        <Dialog
          title="فاتورة الطلب"
          busy={false}
          error=""
          close={() => setReceipt(null)}
          submit={async () => window.print()}
          button="طباعة / حفظ PDF"
        >
          <article className="r-receipt">
            <h2>{state.businessName}</h2>
            {core?.settings.phone && <p>{core.settings.phone}</p>}
            {core?.settings.address && <p>{core.settings.address}</p>}
            <p>
              {receipt.invoice.number} · {date(receipt.invoice.at)}
            </p>
            {receipt.lines.map((l) => (
              <p key={l.id}>
                {l.qty / 1000} × {l.name} <b>{fmt(l.total)}</b>
              </p>
            ))}
            <p>قبل الخصم والضريبة: {fmt(receipt.invoice.subtotal)}</p>
            <p>
              الخصم: {fmt(receipt.invoice.discount)} · الضريبة: {fmt(receipt.invoice.tax)}
            </p>
            <h3>الإجمالي: {fmt(receipt.invoice.total)}</h3>
            <p>
              المسترد: {fmt(receipt.invoice.refunded)} · الباقي عند البيع:{' '}
              {fmt(receipt.invoice.change)}
            </p>
            {core?.settings.receiptFooter && <p>{core.settings.receiptFooter}</p>}
          </article>
        </Dialog>
      )}
    </div>
  )
}
