import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Money, Quantity, basisPoints, lineTotal, ulid, unwrap } from '@xzare/core'
import { KeyboardScanBuffer } from '@xzare/barcode'
import type { AppState, Product, Party, Invoice, InvoiceLine, User } from '@xzare/engine'
import { call } from './bridge'
import { useSessionActivity } from './useSessionActivity'
import { Label } from './Label'
import { LicensePanel } from './LicensePanel'
import { ProductBarcode } from './ProductBarcode'
import { AuthScreen } from './AuthScreen'
import { BrandMark } from './BrandMark'
import { Icon } from './Icon'
import { WorkspaceHelp } from './WorkspaceHelp'
import { WorkspaceClock } from './WorkspaceClock'
import { paymentKey } from './payment-keypad'

export type Page =
  | 'dashboard'
  | 'pos'
  | 'products'
  | 'stock'
  | 'purchases'
  | 'customers'
  | 'suppliers'
  | 'invoices'
  | 'shifts'
  | 'reports'
  | 'settings'
  | 'users'
  | 'audit'
type CartLine = { variantId: string; qty: number; price: number }
type Detail = {
  invoice: Invoice
  lines: InvoiceLine[]
  payments: { method: string; amount: number; at: number }[]
  returns: { id: string; at: number; total: number; refunded: number; note: string }[]
}
type Modal = {
  kind:
    | 'product'
    | 'party'
    | 'adjust'
    | 'shiftOpen'
    | 'shiftClose'
    | 'expense'
    | 'cash'
    | 'user'
    | 'password'
    | 'invoice'
    | 'holds'
    | 'holdSave'
    | 'label'
    | 'restore'
    | 'help'
  product?: Product
  party?: Party
  user?: User
  detail?: Detail
}
const titles: Record<Page, string> = {
  dashboard: 'نظرة عامة',
  pos: 'نقطة البيع',
  products: 'الأصناف',
  stock: 'المخزون',
  purchases: 'المشتريات',
  customers: 'العملاء',
  suppliers: 'الموردون',
  invoices: 'الفواتير والمرتجعات',
  shifts: 'الورديات والخزينة',
  reports: 'التقارير',
  settings: 'الإعدادات والنسخ الاحتياطي',
  users: 'المستخدمون',
  audit: 'سجل التدقيق',
}
const dictionary: Record<string, string> = {
  'نظرة عامة': 'Overview',
  'نقطة البيع': 'Point of sale',
  الأصناف: 'Products',
  المخزون: 'Inventory',
  المشتريات: 'Purchases',
  العملاء: 'Customers',
  الموردون: 'Suppliers',
  'الفواتير والمرتجعات': 'Invoices & returns',
  'الورديات والخزينة': 'Shifts & cash',
  التقارير: 'Reports',
  'الإعدادات والنسخ الاحتياطي': 'Settings & backup',
  المستخدمون: 'Users',
  'سجل التدقيق': 'Audit log',
  حفظ: 'Save',
  إلغاء: 'Cancel',
  إغلاق: 'Close',
  بحث: 'Search',
  'إضافة صنف': 'Add product',
  'إضافة عميل': 'Add customer',
  'إضافة مورد': 'Add supplier',
  'رصيد أول المدة': 'Opening stock',
  'تسجيل خروج': 'Sign out',
  'قفل البرنامج': 'Lock',
  'وردية مفتوحة': 'Shift open',
  'الوردية مغلقة': 'Shift closed',
  'افتح وردية': 'Open shift',
  الصنف: 'Product',
  الكود: 'SKU',
  الوحدة: 'Unit',
  السعر: 'Price',
  الكمية: 'Quantity',
  القيمة: 'Value',
  الإجمالي: 'Total',
  خصم: 'Discount',
  'ضريبة %': 'Tax %',
  نقدي: 'Cash',
  بطاقة: 'Card',
  تحويل: 'Transfer',
  آجل: 'Credit',
  'المبلغ كاملًا': 'Full amount',
  'حفظ الفاتورة': 'Save invoice',
  'بدء فاتورة جديدة': 'New invoice',
  'حفظ مؤقت': 'Hold',
  'الفواتير المعلقة': 'Held invoices',
  'لا توجد أصناف بعد': 'No products yet',
  'أضف أصنافك ثم سجل رصيد المخزون أو فاتورة شراء.':
    'Add your products and receive opening stock or a purchase.',
  'لا توجد بيانات مسجلة': 'No records yet',
  'إجمالي المبيعات': 'Sales total',
  'قيمة المخزون': 'Stock value',
  'أرصدة العملاء': 'Customer balances',
  'أصناف تحتاج إعادة طلب': 'Low-stock products',
  'إضافة مخزون': 'Adjust stock',
  تعديل: 'Edit',
  'طباعة ملصق': 'Print label',
  الاسم: 'Name',
  الهاتف: 'Phone',
  العنوان: 'Address',
  'الرصيد المستحق': 'Outstanding',
  عرض: 'View',
  نوع: 'Type',
  تاريخ: 'Date',
  المدفوع: 'Paid',
  المتبقي: 'Balance',
  بيع: 'Sale',
  شراء: 'Purchase',
  مرتجعات: 'Returns',
  مستخدم: 'User',
  'آخر الفواتير': 'Recent invoices',
  'إيرادات اليوم': 'Today sales',
  'مركز العمل': 'Workspace',
  'إنشاء نسخة احتياطية': 'Create backup',
  'استعادة نسخة': 'Restore backup',
  'تغيير كلمة المرور': 'Change password',
  إصدار: 'Version',
  'البيانات محفوظة على هذا الجهاز': 'Data stored on this device',
  طباعة: 'Print',
  'تصدير CSV': 'Export CSV',
}
const money = (v: FormDataEntryValue | null) => unwrap(Money.parse(String(v ?? '0')))
const quantity = (v: FormDataEntryValue | null) => unwrap(Quantity.parse(String(v ?? '0')))
const date = (value: number) =>
  new Date(value).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' })
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : 'تعذر إتمام العملية'
const moneyText = (value: number) => Money.toDecimalString(Money.fromPiastres(value))
function Field({
  label,
  name,
  value = '',
  type = 'text',
  required = false,
  children,
}: {
  label: string
  name: string
  value?: string | number
  type?: string
  required?: boolean
  children?: ReactNode
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children ?? (
        <input
          name={name}
          type={type}
          defaultValue={value}
          required={required}
          maxLength={type === 'password' ? 128 : 500}
          autoComplete={type === 'password' ? 'new-password' : 'off'}
        />
      )}
    </label>
  )
}
function Table({
  headers,
  rows,
  empty = 'لا توجد بيانات مسجلة',
}: {
  headers: string[]
  rows: ReactNode[][]
  empty?: string
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((cells, i) => (
              <tr key={i}>
                {cells.map((c, j) => (
                  <td key={j}>{c}</td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={headers.length}>
                <div className="empty">
                  <span>◇</span>
                  <p>{empty}</p>
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
function downloadCSV(name: string, headers: string[], rows: (string | number)[][]) {
  const escape = (value: string | number) => {
    let text = String(value)
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text
    return '"' + text.replaceAll('"', '""') + '"'
  }
  const url = URL.createObjectURL(
    new Blob(['\ufeff' + [headers, ...rows].map((row) => row.map(escape).join(',')).join('\r\n')], {
      type: 'text/csv;charset=utf-8',
    }),
  )
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export function App({
  embeddedPage,
  initialState,
  onSessionEnd,
  onStateChange,
  restaurant = false,
}: {
  embeddedPage?: Page
  initialState?: AppState
  onSessionEnd?: () => void
  onStateChange?: (state: AppState) => void
  restaurant?: boolean
} = {}) {
  const [configured, setConfigured] = useState<boolean | null>(initialState ? true : null),
    [state, setState] = useState<AppState | null>(initialState ?? null),
    [page, setPage] = useState<Page>(embeddedPage ?? 'dashboard')
  useEffect(() => {
    if (embeddedPage) setPage(embeddedPage)
  }, [embeddedPage])
  useEffect(() => {
    if (initialState && !state) onSessionEnd?.()
  }, [state, initialState, onSessionEnd])
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [modal, setModal] = useState<Modal | null>(null)
  const [search, setSearch] = useState(''),
    [category, setCategory] = useState(''),
    [showInactive, setShowInactive] = useState(false)
  const [cart, setCart] = useState<CartLine[]>([]),
    [partyId, setPartyId] = useState(''),
    [discount, setDiscount] = useState('0'),
    [tax, setTax] = useState('0'),
    [cash, setCash] = useState('0'),
    [card, setCard] = useState('0'),
    [transfer, setTransfer] = useState('0'),
    [note, setNote] = useState(''),
    [holdId, setHoldId] = useState<string | undefined>()
  const [scan, setScan] = useState(''),
    [pending, setPending] = useState(0),
    [report, setReport] = useState<Record<string, number> | null>(null)
  const [paymentTarget, setPaymentTarget] = useState(0),
    [replacePayment, setReplacePayment] = useState(true),
    [keypadOpen, setKeypadOpen] = useState(false)
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10)),
    [to, setTo] = useState(new Date().toISOString().slice(0, 10))
  const [menuOpen, setMenuOpen] = useState(false),
    [collapsed, setCollapsed] = useState(false)
  const dialogRef = useRef<HTMLElement>(null)
  const navigationRef = useRef<HTMLElement>(null)
  const busyRef = useRef(busy)
  busyRef.current = busy
  const modalKey = modal
    ? `${modal.kind}:${modal.product?.id ?? modal.party?.id ?? modal.user?.id ?? modal.detail?.invoice.id ?? ''}`
    : ''
  const mutex = useRef(false),
    scanner = useRef(new KeyboardScanBuffer()),
    queue = useRef(Promise.resolve()),
    generation = useRef(0),
    request = useRef({ body: '', id: ulid() }),
    operations = useRef(new Map<string, { body: string; id: string }>()),
    scanInput = useRef<HTMLInputElement>(null)
  useSessionActivity(!!state && !embeddedPage, () => {
    setState(null)
    setCart([])
    setModal(null)
  })
  const ContentRegion = embeddedPage ? 'section' : 'main'
  const english = state?.settings.language === 'en',
    t = (s: string) => (english ? (dictionary[s] ?? s) : s)
  const fmt = (value: number) =>
    new Intl.NumberFormat(english ? 'en-EG' : 'ar-EG', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value / 100) +
    ' ' +
    (english ? 'EGP' : 'ج.م')
  const manager = state?.user.role !== 'cashier',
    admin = state?.user.role === 'admin'
  const reload = async () => {
    const next = await call<AppState>('state')
    setState(next)
    onStateChange?.(next)
    return next
  }
  useEffect(() => {
    call<{ configured: boolean }>('auth.status')
      .then((v) => {
        setConfigured(v.configured)
        if (v.configured) reload().catch(() => {})
      })
      .catch((e) => setError(errorText(e)))
  }, [])
  useEffect(() => {
    document.documentElement.dir = english ? 'ltr' : 'rtl'
    document.documentElement.lang = english ? 'en' : 'ar'
  }, [english])
  useEffect(() => {
    generation.current++
    setSearch('')
    setCategory('')
    scanner.current.setFocused(false)
    setScan('')
  }, [page, state?.user.id])
  useEffect(() => {
    if (modal) {
      generation.current++
      scanner.current.setFocused(false)
      setScan('')
    }
  }, [modal])
  useEffect(() => {
    if (!state) return
    let last = Date.now()
    const activity = () => {
      last = Date.now()
    }
    const timer = setInterval(() => {
      if (Date.now() - last > 10 * 60 * 1000) {
        call('logout').finally(() => {
          setState(null)
          setCart([])
          setModal(null)
        })
      }
    }, 10000)
    window.addEventListener('pointerdown', activity)
    window.addEventListener('keydown', activity)
    return () => {
      clearInterval(timer)
      window.removeEventListener('pointerdown', activity)
      window.removeEventListener('keydown', activity)
    }
  }, [state?.user.id])
  useLayoutEffect(() => {
    if (!modal) return
    const previous = document.activeElement as HTMLElement | null
    const target =
      dialogRef.current?.querySelector<HTMLElement>(
        'input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
      ) ?? dialogRef.current?.querySelector<HTMLElement>('button:not([disabled])')
    target?.focus()
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) {
        event.preventDefault()
        setModal(null)
        return
      }
      if (event.key !== 'Tab') return
      const elements = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]',
        ) ?? [],
      ).filter((el) => el.getClientRects().length > 0)
      const first = elements[0],
        last = elements.at(-1)
      if (!first || !last) {
        event.preventDefault()
        return
      }
      if (
        event.shiftKey &&
        (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))
      ) {
        event.preventDefault()
        last.focus()
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))
      ) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', keys)
    return () => {
      document.removeEventListener('keydown', keys)
      previous?.focus()
    }
  }, [modalKey])
  useLayoutEffect(() => {
    if (!menuOpen) return
    const previous = document.activeElement as HTMLElement | null
    navigationRef.current
      ?.querySelector<HTMLElement>('button[aria-current="page"], button')
      ?.focus()
    const resize = () => {
      if (window.innerWidth > 850) setMenuOpen(false)
    }
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setMenuOpen(false)
        return
      }
      if (event.key !== 'Tab') return
      const buttons = Array.from(
        navigationRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [],
      ).filter((button) => button.getClientRects().length > 0)
      const first = buttons[0],
        last = buttons.at(-1)
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', keys)
    window.addEventListener('resize', resize)
    return () => {
      document.removeEventListener('keydown', keys)
      window.removeEventListener('resize', resize)
      previous?.focus()
    }
  }, [menuOpen])
  useEffect(() => {
    if (!state) return
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false)
        return
      }
      if (
        event.repeat ||
        event.isComposing ||
        busy ||
        modal ||
        menuOpen ||
        (event.target instanceof Element &&
          event.target.closest('input, textarea, select, [contenteditable="true"]'))
      )
        return
      if (
        !embeddedPage &&
        event.key === 'F2' &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey
      ) {
        event.preventDefault()
        navigate('pos')
      } else if (event.altKey && !event.ctrlKey && !event.metaKey && event.code === 'KeyH') {
        event.preventDefault()
        setModal({ kind: 'help' })
      } else if (
        event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        event.code === 'KeyN' &&
        manager
      ) {
        event.preventDefault()
        setModal({ kind: 'product' })
      }
    }
    document.addEventListener('keydown', keys)
    return () => document.removeEventListener('keydown', keys)
  }, [state?.user.id, page, modal, menuOpen, busy, cart.length])
  function navigate(next: Page) {
    if ((next === 'pos' || next === 'purchases') && cart.length && next !== page) {
      if (!window.confirm('مسح الفاتورة الحالية لتغيير نوع العملية؟')) return
      clear()
    }
    setMenuOpen(false)
    setPage(next)
  }
  async function run<T>(fn: () => Promise<T>, message = 'تم الحفظ'): Promise<T | undefined> {
    if (mutex.current) return
    mutex.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await fn()
      await reload()
      setNotice(message)
      return result
    } catch (e) {
      setError(errorText(e))
      return undefined
    } finally {
      mutex.current = false
      setBusy(false)
    }
  }
  async function mutate(action: string, payload: unknown, close = true) {
    if (
      ['invoice.pay', 'invoice.return', 'stock.adjust', 'cash.add', 'expense.add'].includes(action)
    ) {
      const data = { ...(payload as Record<string, unknown>) }
      delete data.clientTxnId
      const body = JSON.stringify(data),
        previous = operations.current.get(action)
      const operation = previous?.body === body ? previous : { body, id: ulid() }
      operations.current.set(action, operation)
      payload = { ...data, clientTxnId: operation.id }
    }
    const result = await run(() => call(action, payload))
    if (result !== undefined) operations.current.delete(action)
    if (result !== undefined && close) setModal(null)
    return result
  }
  async function logout() {
    await call('logout')
    generation.current++
    operations.current.clear()
    setState(null)
    setCart([])
    setModal(null)
    setPage('dashboard')
  }
  function add(product: Product, qty = 1000) {
    const combined = (cart.find((v) => v.variantId === product.id)?.qty ?? 0) + qty
    try {
      if (combined > 1_000_000_000) throw new Error()
      lineTotal(Money.fromPiastres(product.price), Quantity.fromMilliUnits(combined))
    } catch {
      setError('الكمية أو قيمة السطر تتجاوز الحد المسموح')
      return
    }
    setCart((previous) => {
      const found = previous.find((v) => v.variantId === product.id)
      const nextQuantity = (found?.qty ?? 0) + qty
      try {
        if (nextQuantity > 1_000_000_000) return previous
        lineTotal(Money.fromPiastres(product.price), Quantity.fromMilliUnits(nextQuantity))
      } catch {
        return previous
      }
      return found
        ? previous.map((v) => (v.variantId === product.id ? { ...v, qty: v.qty + qty } : v))
        : [...previous, { variantId: product.id, qty, price: product.price }]
    })
  }
  function lookup(code: string) {
    const current = generation.current
    setPending((n) => n + 1)
    queue.current = queue.current
      .then(async () => {
        if (current !== generation.current) return
        const result = await call<{ product: Product; quantity: number }>('barcode.lookup', {
          code,
        })
        if (current === generation.current) {
          setState((previous) =>
            previous && !previous.products.some((p) => p.id === result.product.id)
              ? { ...previous, products: [...previous.products, result.product] }
              : previous,
          )
          add(result.product, result.quantity)
        }
      })
      .catch((e) => setError(errorText(e)))
      .finally(() => setPending((n) => Math.max(0, n - 1)))
  }
  function clear() {
    generation.current++
    setCart([])
    setPartyId('')
    setDiscount('0')
    setCash('0')
    setCard('0')
    setTransfer('0')
    setNote('')
    setHoldId(undefined)
    setTax(String(Number(state?.settings.taxBps ?? 0) / 100))
    request.current = { body: '', id: ulid() }
    scanInput.current?.focus()
  }
  const purchase = page === 'purchases',
    products = state?.products ?? []
  const gross = cart.map((l) => {
    const p = products.find((p) => p.id === l.variantId)
    return p
      ? lineTotal(Money.fromPiastres(purchase ? l.price : p.price), Quantity.fromMilliUnits(l.qty))
      : Money.zero
  })
  const subtotal = Money.sum(gross)
  let totals = {
    discount: 0,
    taxBps: 0,
    tax: 0,
    total: subtotal as number,
    paid: 0,
    change: 0,
    balance: subtotal as number,
    valid: true,
  }
  try {
    const d = money(discount),
      taxBps = Math.round(Number(tax) * 100)
    if (d > subtotal || taxBps < 0 || taxBps > 10000) throw new Error()
    const net = Money.fromPiastres(subtotal - d),
      taxValue = Money.applyRate(net, basisPoints(taxBps)),
      total = Money.add(net, taxValue),
      paid = Money.sum([money(cash), money(card), money(transfer)])
    totals = {
      discount: d,
      taxBps,
      tax: taxValue,
      total,
      paid,
      change: Math.max(0, paid - total),
      balance: Math.max(0, total - paid),
      valid: true,
    }
  } catch {
    totals.valid = false
  }
  function invoicePayload() {
    return {
      kind: purchase ? ('purchase' as const) : ('sale' as const),
      lines: cart.map((l) => ({
        variantId: l.variantId,
        qty: l.qty,
        ...(purchase ? { price: l.price } : {}),
      })),
      ...(partyId ? { partyId } : {}),
      discount: totals.discount,
      taxBps: totals.taxBps,
      cash: money(cash),
      card: money(card),
      transfer: money(transfer),
      note,
    }
  }
  async function post() {
    if (!totals.valid || !cart.length || pending) return
    const payload = invoicePayload(),
      body = JSON.stringify({ ...payload, holdId })
    if (request.current.body !== body) request.current = { body, id: ulid() }
    const result = await run(
      () =>
        call<Invoice>('invoice.post', {
          ...payload,
          ...(holdId ? { holdId } : {}),
          clientTxnId: request.current.id,
        }),
      'تم حفظ الفاتورة والمخزون',
    )
    if (result) {
      clear()
      const detail = await call<Detail>('invoice.get', { id: result.id })
      setModal({ kind: 'invoice', detail })
    }
  }
  async function detail(id: string) {
    try {
      setError('')
      setModal({ kind: 'invoice', detail: await call<Detail>('invoice.get', { id }) })
    } catch (e) {
      setError(errorText(e))
    }
  }
  const onSubmit =
    (fn: (data: FormData) => Promise<unknown>) => (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const data = new FormData(event.currentTarget)
      Promise.resolve()
        .then(() => fn(data))
        .catch((e) => setError(errorText(e)))
    }
  const saveButton = (
    <button className="primary" disabled={busy} type="submit">
      {busy ? 'جارٍ الحفظ…' : t('حفظ')}
    </button>
  )
  function form(children: ReactNode, submit: (data: FormData) => Promise<unknown>) {
    return (
      <form
        key={modal?.product?.id ?? modal?.kind ?? page}
        onSubmit={onSubmit(submit)}
        className="form-grid"
      >
        {children}
        <div className="form-actions">
          {saveButton}
          {modal && (
            <button type="button" onClick={() => setModal(null)}>
              {t('إلغاء')}
            </button>
          )}
        </div>
      </form>
    )
  }

  if (!state)
    return (
      <AuthScreen
        configured={configured}
        busy={busy}
        error={error}
        onAuthenticate={async (values) => {
          setBusy(true)
          setError('')
          try {
            await call(
              configured ? 'login' : 'setup',
              configured ? { username: values.username, password: values.password } : values,
            )
            setConfigured(true)
            const next = await reload()
            setTax(String(Number(next.settings.taxBps ?? 0) / 100))
          } catch (e) {
            setError(errorText(e))
            throw e
          } finally {
            setBusy(false)
          }
        }}
      />
    )

  const nav = (Object.keys(titles) as Page[]).filter(
    (p) =>
      !(!manager && ['products', 'stock', 'purchases', 'suppliers', 'reports'].includes(p)) &&
      !(!admin && ['settings', 'users', 'audit'].includes(p)),
  )
  const filtered = products.filter(
    (p) =>
      (showInactive || p.active) &&
      (!category || p.category === category) &&
      `${p.name} ${p.sku} ${p.barcode ?? ''}`
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase()),
  )
  const toolbar = (
    <div className="toolbar">
      <div className="search">
        <span>
          <Icon name="search" />
        </span>
        <input
          aria-label={t('بحث')}
          placeholder="ابحث بالاسم أو الكود…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {['pos', 'purchases', 'products', 'stock'].includes(page) && (
        <select aria-label="التصنيف" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">كل التصنيفات</option>
          {[...new Set(products.map((p) => p.category).filter(Boolean))].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      )}
    </div>
  )
  const invoiceRows = (kind?: string) =>
    state.invoices
      .filter(
        (i) => (!kind || i.kind === kind) && `${i.number} ${i.party_name ?? ''}`.includes(search),
      )
      .map((i) => [
        <bdi>{i.number}</bdi>,
        t(i.kind === 'sale' ? 'بيع' : 'شراء'),
        i.party_name ?? '—',
        date(i.at),
        fmt(i.total - i.returned),
        fmt(i.paid - i.refunded),
        <span className={i.balance ? 'badge warning' : 'badge'}>{fmt(i.balance)}</span>,
        <button onClick={() => detail(i.id)}>{t('عرض')}</button>,
      ])
  function invoiceEditor() {
    return (
      <div className="cashier">
        <section className="catalog">
          <div className="scan-input">
            <span>▥</span>
            <input
              ref={scanInput}
              aria-label="مسح الباركود"
              placeholder="امسح الباركود ثم Enter"
              value={scan}
              onChange={() => {}}
              onFocus={() => scanner.current.setFocused(true)}
              onBlur={() => {
                scanner.current.setFocused(false)
                setScan('')
              }}
              onPaste={(e) => {
                e.preventDefault()
                const code = e.clipboardData.getData('text')
                scanner.current.setFocused(false)
                scanner.current.setFocused(true)
                setScan('')
                lookup(code)
              }}
              onKeyDown={(e) => {
                if (e.key.length === 1 || ['Enter', 'Backspace', 'Escape'].includes(e.key))
                  e.preventDefault()
                const result = scanner.current.push({
                  key: e.key,
                  at: performance.now(),
                  repeat: e.repeat,
                  composing: e.nativeEvent.isComposing,
                  ctrl: e.ctrlKey,
                  alt: e.altKey,
                  meta: e.metaKey,
                })
                if (e.key === 'Enter') {
                  setScan('')
                  if (result.ok && result.value) lookup(result.value)
                  else if (!result.ok) setError('قراءة الباركود غير مكتملة؛ أعد المسح')
                } else if (e.key === 'Escape') setScan('')
                else if (e.key === 'Backspace') setScan((v) => v.slice(0, -1))
                else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey)
                  setScan((v) => (v + e.key).slice(0, 64))
              }}
            />
            <kbd>ENTER</kbd>
          </div>
          {toolbar}
          <div className="pos-categories" aria-label="تصنيفات الأصناف">
            {['', ...new Set(products.filter((p) => p.active).map((p) => p.category).filter(Boolean))].map((c) => (
              <button key={c} type="button" aria-pressed={category === c} className={category === c ? 'active' : ''} onClick={() => setCategory(c)}>
                {c || 'كل الأصناف'}
              </button>
            ))}
          </div>
          <div className="pos-catalog-heading"><span>{filtered.length} صنف</span><small>المس الصنف لإضافته إلى الفاتورة</small></div>
          <div className="catalog-list">
            {filtered.length ? (
              filtered.slice(0, 200).map((p) => (
                <button className="product-row" key={p.id} disabled={busy} aria-label={`إضافة ${p.name} بسعر ${fmt(p.price)}`} onClick={() => add(p)}>
                  <span className="product-symbol">{p.name.slice(0, 1)}</span>
                  <span>
                    <strong>{p.name}</strong>
                    <small>
                      <bdi>{p.sku}</bdi> · {p.unit}
                    </small>
                  </span>
                  <span>
                    <strong>{fmt(p.price)}</strong>
                    <small className={p.qty <= p.reorder_qty ? 'danger' : ''}>
                      {Quantity.toDecimalString(Quantity.fromMilliUnits(p.qty))} بالمخزون
                    </small>
                  </span>
                  <span className="plus">+</span>
                </button>
              ))
            ) : (
              <div className="empty">
                <span>▦</span>
                <h3>{products.length ? 'لا توجد أصناف تطابق البحث' : t('لا توجد أصناف بعد')}</h3>
                <p>{products.length ? 'غيّر البحث أو التصنيف لعرض أصناف أخرى.' : t('أضف أصنافك ثم سجل رصيد المخزون أو فاتورة شراء.')}</p>
                {manager && (
                  <button onClick={() => setModal({ kind: 'product' })}>{t('إضافة صنف')}</button>
                )}
              </div>
            )}
          </div>
          {filtered.length > 200 && (
            <p className="muted small">تظهر أول 200 نتيجة؛ استخدم البحث للوصول إلى الصنف.</p>
          )}
        </section>
        <section className="cart">
          <div className="cart-heading">
            <div>
              <span className="eyebrow">{purchase ? 'PURCHASE ORDER' : 'SALES RECEIPT'}</span>
              <h2>
                {purchase ? 'فاتورة شراء' : 'فاتورة جديدة'} <small>{cart.length} صنف</small>
              </h2>
            </div>
            <button
              onClick={() => {
                if (!cart.length || window.confirm('مسح الفاتورة الحالية؟')) clear()
              }}
            >
              {t('بدء فاتورة جديدة')}
            </button>
          </div>
          <label className="field">
            <span>{purchase ? 'المورد' : 'العميل — اختياري للبيع النقدي'}</span>
            <select value={partyId} onChange={(e) => setPartyId(e.target.value)}>
              <option value="">{purchase ? 'اختر المورد' : 'بيع نقدي بدون عميل'}</option>
              {state!.parties
                .filter((p) => p.kind === (purchase ? 'supplier' : 'customer'))
                .map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </label>
          <div className="cart-lines">
            {cart.length ? (
              cart.map((l) => {
                const p = products.find((p) => p.id === l.variantId)
                return (
                  <div className="cart-line" key={l.variantId}>
                    <div>
                      <strong>{p?.name ?? 'صنف غير متاح'}</strong>
                      <small>{p?.unit}</small>
                    </div>
                    <label>
                      <span className="sr-only">كمية {p?.name}</span>
                      <input
                        aria-label={`كمية ${p?.name}`}
                        type="number"
                        min="0.001"
                        step="0.001"
                        value={l.qty / 1000}
                        onChange={(e) => {
                          const v = Quantity.parse(e.target.value)
                          if (
                            v.ok &&
                            v.value > 0 &&
                            v.value <= 1_000_000_000 &&
                            Number.isSafeInteger(
                              Math.ceil(((purchase ? l.price : (p?.price ?? 0)) * v.value) / 1000),
                            )
                          )
                            setCart((old) =>
                              old.map((x) =>
                                x.variantId === l.variantId ? { ...x, qty: v.value } : x,
                              ),
                            )
                        }}
                      />
                    </label>
                    {purchase && (
                      <input
                        aria-label={`تكلفة ${p?.name}`}
                        type="number"
                        min="0"
                        step="0.01"
                        value={l.price / 100}
                        onChange={(e) => {
                          const v = Money.parse(e.target.value)
                          if (
                            v.ok &&
                            v.value >= 0 &&
                            v.value <= 1_000_000_000_000 &&
                            Number.isSafeInteger(Math.ceil((v.value * l.qty) / 1000))
                          )
                            setCart((old) =>
                              old.map((x) =>
                                x.variantId === l.variantId ? { ...x, price: v.value } : x,
                              ),
                            )
                        }}
                      />
                    )}
                    <strong>
                      {fmt(
                        lineTotal(
                          Money.fromPiastres(purchase ? l.price : (p?.price ?? 0)),
                          Quantity.fromMilliUnits(l.qty),
                        ),
                      )}
                    </strong>
                    <button
                      aria-label={`حذف ${p?.name}`}
                      className="icon-button"
                      onClick={() =>
                        setCart((old) => old.filter((v) => v.variantId !== l.variantId))
                      }
                    >
                      ×
                    </button>
                  </div>
                )
              })
            ) : (
              <div className="empty">
                <span>▱</span>
                <p>امسح باركود أو اختر صنفًا لبدء الفاتورة.</p>
              </div>
            )}
          </div>
          <div className="cart-options">
            <label>
              {t('خصم')}
              <input
                value={discount}
                disabled={!manager}
                onChange={(e) => setDiscount(e.target.value)}
                inputMode="decimal"
              />
            </label>
            <label>
              {t('ضريبة %')}
              <input
                value={tax}
                disabled={!manager}
                onChange={(e) => setTax(e.target.value)}
                inputMode="decimal"
              />
            </label>
          </div>
          <label className="field">
            <span>ملاحظة الفاتورة</span>
            <input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="payments">
            {[
              [t('نقدي'), cash, setCash],
              [t('بطاقة'), card, setCard],
              [t('تحويل'), transfer, setTransfer],
            ].map(([label, value, set], i) => (
              <label key={i}>
                {label as string}
                <input
                  aria-label={label as string}
                  value={value as string}
                  inputMode="decimal"
                  onFocus={() => { setPaymentTarget(i); setReplacePayment(true) }}
                  onChange={(e) => (set as (s: string) => void)(e.target.value)}
                />
              </label>
            ))}
          </div>
          <div className="pos-keypad-heading">
            <button type="button" aria-expanded={keypadOpen} aria-controls="payment-keypad" onClick={() => setKeypadOpen((open) => !open)}>
              {keypadOpen ? 'إخفاء لوحة الأرقام' : 'لوحة أرقام الدفع'}
            </button>
            {keypadOpen && <span>إدخال {['نقدي', 'بطاقة', 'تحويل'][paymentTarget]}</span>}
          </div>
          {keypadOpen && (
            <div id="payment-keypad" className="pos-keypad" aria-label="لوحة أرقام الدفع" dir="ltr">
              {['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', 'backspace'].map((key) => (
                <button key={key} type="button" disabled={busy} aria-label={key === 'backspace' ? 'حذف آخر رقم' : key === '.' ? 'فاصلة عشرية' : key} onClick={() => {
                  const setters = [setCash, setCard, setTransfer]
                  setters[paymentTarget]!((value) => paymentKey(value, key, replacePayment))
                  setReplacePayment(false)
                }}>{key === 'backspace' ? '⌫' : key}</button>
              ))}
              <button type="button" className="pos-keypad-clear" disabled={busy} onClick={() => { [setCash, setCard, setTransfer][paymentTarget]!('0'); setReplacePayment(true) }}>مسح المبلغ</button>
            </div>
          )}
          <div className="small-actions">
            <button
              onClick={() => {
                setCash(moneyText(totals.total))
                setCard('0')
                setTransfer('0')
              }}
            >
              {t('المبلغ كاملًا')}
            </button>
            {!purchase && (
              <>
                <button disabled={!cart.length} onClick={() => setModal({ kind: 'holdSave' })}>
                  {t('حفظ مؤقت')}
                </button>
                <button onClick={() => setModal({ kind: 'holds' })}>
                  {t('الفواتير المعلقة')} ({state!.holds.length})
                </button>
              </>
            )}
          </div>
          <div className="cart-total">
            <div>
              <span>{t('الإجمالي')}</span>
              <strong>{fmt(totals.total)}</strong>
            </div>
            <div className="total-meta">
              <span>
                {totals.balance ? `آجل ${fmt(totals.balance)}` : `الباقي ${fmt(totals.change)}`}
              </span>
              <span>الضريبة {fmt(totals.tax)}</span>
            </div>
            <button
              className="primary large"
              onClick={post}
              disabled={busy || !cart.length || !state!.shift || !totals.valid || pending > 0}
            >
              {busy ? 'جارٍ تسجيل الفاتورة…' : t('حفظ الفاتورة')} <span>↵</span>
            </button>
            {!state!.shift && (
              <button className="shift-prompt" onClick={() => setModal({ kind: 'shiftOpen' })}>
                افتح وردية لإتمام البيع
              </button>
            )}
          </div>
        </section>
      </div>
    )
  }

  function modalContent(): ReactNode {
    if (!modal) return null
    if (modal.kind === 'help') return <WorkspaceHelp manager={manager} />
    const p = modal.product,
      party = modal.party,
      u = modal.user
    if (modal.kind === 'product')
      return form(
        <>
          <div className="form-section-heading full">
            <Icon name="products" />
            <span>
              معلومات الصنف<small>الاسم والكود يميزان الصنف في البيع والتقارير.</small>
            </span>
          </div>
          <Field label="اسم الصنف" name="name" value={p?.name} required />
          <Field label="كود الصنف SKU" name="sku" value={p?.sku} required />
          <Field label="الوحدة الأساسية" name="unit" value={p?.unit ?? 'قطعة'} required />
          <Field label="سعر البيع" name="price" value={moneyText(p?.price ?? 0)} required />
          <Field label="التصنيف" name="category" value={p?.category} />
          <Field label="حد إعادة الطلب" name="reorderQty" value={(p?.reorder_qty ?? 0) / 1000} />
          <ProductBarcode
            product={p}
            open={(existing) => {
              setError('')
              setModal({ kind: 'product', product: existing })
            }}
          />
          {p && (
            <label className="check">
              <input name="active" type="checkbox" defaultChecked={!!p.active} />
              الصنف نشط
            </label>
          )}
          <p className="muted full">
            الرصيد لا يتغير من تعديل الصنف؛ استخدم حركة مخزون أو فاتورة شراء.
          </p>
        </>,
        (d) =>
          mutate('product.save', {
            ...(p ? { id: p.id } : {}),
            name: d.get('name'),
            sku: d.get('sku'),
            unit: d.get('unit'),
            price: money(d.get('price')),
            category: d.get('category'),
            reorderQty: quantity(d.get('reorderQty')),
            barcode: d.get('barcode'),
            format: d.get('format'),
            active: p ? !!d.get('active') : true,
          }),
      )
    if (modal.kind === 'party')
      return form(
        <>
          <Field label="الاسم" name="name" value={party?.name} required />
          <Field label="الهاتف" name="phone" value={party?.phone} />
          <Field label="العنوان" name="address" value={party?.address} />
        </>,
        (d) =>
          mutate('party.save', {
            ...(party ? { id: party.id } : {}),
            kind: party?.kind ?? (page === 'suppliers' ? 'supplier' : 'customer'),
            name: d.get('name'),
            phone: d.get('phone'),
            address: d.get('address'),
          }),
      )
    if (modal.kind === 'adjust')
      return form(
        <>
          <Field label="الصنف" name="variantId">
            <select name="variantId" required defaultValue={p?.id ?? ''}>
              <option value="">اختر الصنف</option>
              {products.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name} — {x.sku}
                </option>
              ))}
            </select>
          </Field>
          <Field label="تغير الكمية — موجب للإضافة، سالب للخصم" name="quantity" required />
          <Field label="تكلفة الوحدة المضافة" name="unitCost" value="0" required />
          <Field label="سبب الحركة" name="reason" required />
        </>,
        (d) =>
          mutate('stock.adjust', {
            variantId: d.get('variantId'),
            quantity: quantity(d.get('quantity')),
            unitCost: money(d.get('unitCost')),
            reason: d.get('reason'),
          }),
      )
    if (modal.kind === 'shiftOpen')
      return form(
        <>
          <Field label="النقدية الافتتاحية الفعلية" name="opening" value="0" required />
          <p className="muted full">كل بيع نقدي ومصروف يتسجل في هذه الوردية.</p>
        </>,
        (d) => mutate('shift.open', { opening: money(d.get('opening')) }),
      )
    if (modal.kind === 'shiftClose')
      return form(
        <>
          <div className="stat full">
            <span>النقدية المتوقعة</span>
            <strong>{fmt(state!.shift?.expected ?? 0)}</strong>
          </div>
          <Field label="النقدية الفعلية بعد العد" name="actual" required />
          <p className="muted full">
            سيُحفظ الفرق بين الفعلي والمتوقع. لا يمكن إعادة تعديل الوردية المقفلة.
          </p>
        </>,
        (d) => mutate('shift.close', { actual: money(d.get('actual')) }),
      )
    if (modal.kind === 'expense')
      return form(
        <>
          <Field label="قيمة المصروف" name="amount" required />
          <Field label="تصنيف المصروف" name="category" required />
          <Field label="ملاحظة" name="note" />
        </>,
        (d) =>
          mutate('expense.add', {
            amount: money(d.get('amount')),
            category: d.get('category'),
            note: d.get('note'),
          }),
      )
    if (modal.kind === 'cash')
      return form(
        <>
          <Field label="المبلغ — موجب للإيداع، سالب للسحب" name="amount" required />
          <Field label="السبب" name="note" required />
        </>,
        (d) => mutate('cash.add', { amount: money(d.get('amount')), note: d.get('note') }),
      )
    if (modal.kind === 'user')
      return form(
        <>
          <Field label="الاسم" name="name" value={u?.name} required />
          <Field label="اسم المستخدم" name="username" value={u?.username} required />
          <Field label="الصلاحية" name="role">
            <select name="role" defaultValue={u?.role ?? 'cashier'}>
              {restaurant && <option value="kitchen">المطبخ</option>}
              <option value="cashier">كاشير</option>
              <option value="manager">مدير</option>
              <option value="admin">مسؤول البرنامج</option>
            </select>
          </Field>
          <Field
            label={
              u ? 'كلمة مرور جديدة — اتركها فارغة للإبقاء' : 'كلمة المرور — 12 حرفًا على الأقل'
            }
            name="password"
            type="password"
            required={!u}
          />
          <label className="check">
            <input name="active" type="checkbox" defaultChecked={u ? !!u.active : true} />
            الحساب نشط
          </label>
        </>,
        (d) =>
          mutate('user.save', {
            ...(u ? { id: u.id } : {}),
            username: d.get('username'),
            name: d.get('name'),
            role: d.get('role'),
            ...(d.get('password') ? { password: d.get('password') } : {}),
            active: !!d.get('active'),
          }),
      )
    if (modal.kind === 'password')
      return form(
        <>
          <Field label="كلمة المرور الحالية" name="current" type="password" required />
          <Field label="كلمة المرور الجديدة" name="password" type="password" required />
        </>,
        async (d) => {
          await call('password.change', { current: d.get('current'), password: d.get('password') })
          await logout()
        },
      )
    if (modal.kind === 'holdSave')
      return form(<Field label="اسم الفاتورة المعلقة" name="title" required />, (d) =>
        mutate('hold.save', { title: d.get('title'), cart: invoicePayload() }),
      )
    if (modal.kind === 'holds')
      return (
        <div>
          {state!.holds.length ? (
            state!.holds.map((h) => (
              <div className="hold-row" key={h.id}>
                <div>
                  <strong>{h.title}</strong>
                  <small>{date(h.at)}</small>
                </div>
                <button
                  onClick={() => {
                    if (cart.length && !window.confirm('استبدال الفاتورة الحالية بالمعلقة؟')) return
                    const value = JSON.parse(h.payload) as {
                      lines: { variantId: string; qty: number }[]
                      partyId?: string
                      discount: number
                      taxBps: number
                      cash: number
                      card: number
                      transfer: number
                      note: string
                    }
                    setCart(
                      value.lines.map((l) => ({
                        ...l,
                        price: products.find((p) => p.id === l.variantId)?.price ?? 0,
                      })),
                    )
                    setPartyId(value.partyId ?? '')
                    setDiscount(moneyText(value.discount))
                    setTax(String(value.taxBps / 100))
                    setCash(moneyText(value.cash))
                    setCard(moneyText(value.card))
                    setTransfer(moneyText(value.transfer))
                    setNote(value.note)
                    setHoldId(h.id)
                    setPage('pos')
                    setModal(null)
                  }}
                >
                  استئناف
                </button>
                <button
                  className="danger"
                  onClick={() => {
                    if (window.confirm('حذف الفاتورة المعلقة؟'))
                      mutate('hold.remove', { id: h.id }, false)
                  }}
                >
                  حذف
                </button>
              </div>
            ))
          ) : (
            <div className="empty">لا توجد فواتير معلقة.</div>
          )}
        </div>
      )
    if (modal.kind === 'label' && p)
      return (
        <>
          <Label product={p} />
          <button className="primary no-print" onClick={() => window.print()}>
            طباعة الملصق
          </button>
        </>
      )
    if (modal.kind === 'restore')
      return form(
        <>
          <p className="alert full">
            الاستعادة تستبدل بيانات المتجر الحالية بعد إنشاء نقطة استرجاع. سيتم تسجيل الخروج. أغلق
            الوردية وخذ نسخة احتياطية أولًا.
          </p>
          <Field label="كلمة مرور المسؤول الحالية" name="password" type="password" required />
          {!window.xzare && (
            <Field label="ملف النسخة الاحتياطية .xzbak" name="backup" type="file" required />
          )}
          <label className="check full">
            <input required type="checkbox" />
            أوافق على استبدال البيانات بنسخة اخترتها.
          </label>
        </>,
        async (d) => {
          if (window.xzare) {
            const result = await call<{ cancelled?: boolean }>('backup.restore', {
              password: d.get('password'),
            })
            if (result.cancelled) return
          } else {
            const file = d.get('backup') as File
            const response = await fetch('/api/restore', {
              method: 'POST',
              headers: {
                'X-Xzare-Request': '1',
                'X-Xzare-Password': encodeURIComponent(String(d.get('password'))),
              },
              body: file,
            })
            const result = await response.json()
            if (!result.ok) throw new Error(result.error)
          }
          await logout()
          setNotice('تمت الاستعادة؛ سجّل الدخول بحسابات النسخة المستعادة')
        },
      )
    if (modal.kind === 'invoice' && modal.detail) {
      const d = modal.detail,
        i = d.invoice
      return (
        <>
          <article className="receipt print-area">
            <div className="receipt-head">
              <strong>{state!.settings.businessName}</strong>
              <p>{state!.settings.address}</p>
              <bdi>{state!.settings.phone}</bdi>
              <h3>
                {i.kind === 'sale' ? 'فاتورة بيع' : 'فاتورة شراء'} <bdi>{i.number}</bdi>
              </h3>
              <p>
                {date(i.at)} · {i.party_name ?? 'نقدي'}
              </p>
            </div>
            <Table
              headers={['الصنف', 'الكمية', 'الإجمالي']}
              rows={d.lines.map((l) => [
                l.name,
                Quantity.toDecimalString(Quantity.fromMilliUnits(l.qty)),
                fmt(l.total),
              ])}
            />
            <div className="receipt-totals">
              <p>
                قبل الخصم <b>{fmt(i.subtotal)}</b>
              </p>
              <p>
                الخصم <b>{fmt(i.discount)}</b>
              </p>
              <p>
                الضريبة <b>{fmt(i.tax)}</b>
              </p>
              <p className="grand">
                الإجمالي <b>{fmt(i.total)}</b>
              </p>
              <p>
                المرتجع <b>{fmt(i.returned)}</b>
              </p>
              <p>
                المدفوع بعد الاسترداد <b>{fmt(i.paid - i.refunded)}</b>
              </p>
              <p>
                المتبقي <b>{fmt(i.balance)}</b>
              </p>
              <p>
                الباقي عند البيع <b>{fmt(i.change)}</b>
              </p>
            </div>
            {i.note && <p>{i.note}</p>}
            <p className="receipt-footer">{state!.settings.receiptFooter}</p>
          </article>
          <div className="no-print">
            <button className="primary" onClick={() => window.print()}>
              طباعة / حفظ PDF
            </button>
            {i.balance > 0 && (
              <form
                className="inline-form"
                onSubmit={onSubmit(async (f) => {
                  const result = await mutate(
                    'invoice.pay',
                    {
                      invoiceId: i.id,
                      amount: money(f.get('amount')),
                      method: f.get('method'),
                      clientTxnId: ulid(),
                    },
                    false,
                  )
                  if (result) await detail(i.id)
                })}
              >
                <Field label="دفعة على الرصيد" name="amount" required />
                <select name="method">
                  <option value="cash">نقدي</option>
                  <option value="card">بطاقة</option>
                  <option value="transfer">تحويل</option>
                </select>
                {saveButton}
              </form>
            )}
            {manager && (!restaurant || i.kind === 'purchase') && (
              <section className="return-section">
                <h3>مرتجع ضد الفاتورة الأصلية</h3>
                <p className="muted small">
                  القيم والتكلفة تعتمد على الفاتورة المحفوظة، حتى لو تغير سعر الصنف.
                </p>
                <form
                  onSubmit={onSubmit(async (f) => {
                    const lines = d.lines
                      .map((l) => ({ lineId: l.id, qty: quantity(f.get(l.id)) }))
                      .filter((l) => l.qty > 0)
                    const result = await mutate(
                      'invoice.return',
                      {
                        invoiceId: i.id,
                        lines,
                        method: f.get('method'),
                        note: f.get('reason'),
                        clientTxnId: ulid(),
                      },
                      false,
                    )
                    if (result) await detail(i.id)
                  })}
                >
                  <Table
                    headers={['الصنف', 'المتاح للإرجاع', 'كمية المرتجع']}
                    rows={d.lines.map((l) => [
                      l.name,
                      (l.qty - l.returned_qty) / 1000,
                      <input
                        key={l.id}
                        aria-label={`مرتجع ${l.name}`}
                        name={l.id}
                        type="number"
                        step="0.001"
                        min="0"
                        max={(l.qty - l.returned_qty) / 1000}
                        defaultValue="0"
                      />,
                    ])}
                  />
                  <div className="inline-form">
                    <Field label="سبب المرتجع" name="reason" required />
                    <select name="method">
                      <option value="cash">استرداد نقدي</option>
                      <option value="card">استرداد بطاقة</option>
                      <option value="transfer">استرداد تحويل</option>
                    </select>
                    <button className="primary" disabled={busy}>
                      تسجيل المرتجع
                    </button>
                  </div>
                </form>
              </section>
            )}
            {d.returns.length > 0 && (
              <>
                <h3>المرتجعات المسجلة</h3>
                <Table
                  headers={['التاريخ', 'القيمة', 'المسترد', 'السبب']}
                  rows={d.returns.map((r) => [date(r.at), fmt(r.total), fmt(r.refunded), r.note])}
                />
              </>
            )}
          </div>
        </>
      )
    }
    return null
  }

  function content(): ReactNode {
    if (page === 'pos' || page === 'purchases') return invoiceEditor()
    if (page === 'dashboard') {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const sales = state!.invoices.filter((i) => i.kind === 'sale' && i.at >= today.getTime())
      return (
        <>
          <section className="welcome">
            <div>
              <span className="eyebrow">{t('مركز العمل')}</span>
              <h2>{state!.settings.businessName}</h2>
              <p>ابدأ يومك بوردية، وخلّي كل حركة مسجلة.</p>
            </div>
            <button className="primary" onClick={() => navigate('pos')}>
              فتح نقطة البيع <Icon name="arrow" />
            </button>
          </section>
          <div className="quick-actions" aria-label="إجراءات سريعة">
            {manager && (
              <button onClick={() => setModal({ kind: 'product' })}>
                <Icon name="plus" />
                <span>
                  صنف جديد<small>الاسم، السعر والباركود</small>
                </span>
              </button>
            )}
            <button onClick={() => setModal({ kind: state!.shift ? 'shiftClose' : 'shiftOpen' })}>
              <Icon name="shifts" />
              <span>
                {state!.shift ? 'إغلاق الوردية' : 'بدء وردية'}
                <small>{state!.shift ? 'مراجعة النقدية الفعلية' : 'تجهيز الخزينة للبيع'}</small>
              </span>
            </button>
            <button onClick={() => navigate('invoices')}>
              <Icon name="invoices" />
              <span>
                مراجعة الفواتير<small>التفاصيل، الدفعات والمرتجعات</small>
              </span>
            </button>
            <button onClick={() => setModal({ kind: 'help' })}>
              <Icon name="help" />
              <span>
                كيف أبدأ؟<small>خطوات واختصارات مفيدة</small>
              </span>
            </button>
          </div>
          <div className="stats">
            <div className="stat">
              <span>{t('إيرادات اليوم')}</span>
              <strong>{fmt(sales.reduce((n, i) => n + i.total - i.returned, 0))}</strong>
              <small>من الفواتير المعروضة · حتى 2000 فاتورة حديثة</small>
            </div>
            <div className="stat">
              <span>{t('أصناف تحتاج إعادة طلب')}</span>
              <strong>{products.filter((p) => p.active && p.qty <= p.reorder_qty).length}</strong>
              <small>من الأصناف المسجلة</small>
            </div>
            <div className="stat">
              <span>{t('أرصدة العملاء')}</span>
              <strong>
                {fmt(
                  state!.parties
                    .filter((p) => p.kind === 'customer')
                    .reduce((n, p) => n + p.balance, 0),
                )}
              </strong>
              <small>الرصيد غير المسدد</small>
            </div>
            <div className="stat">
              <span>الخزينة الحالية</span>
              <strong>{fmt(state!.shift?.expected ?? 0)}</strong>
              <small>{state!.shift ? t('وردية مفتوحة') : t('الوردية مغلقة')}</small>
            </div>
          </div>
          <div className="section-head">
            <h3>{t('آخر الفواتير')}</h3>
            <button onClick={() => setPage('invoices')}>عرض الكل</button>
          </div>
          <Table
            headers={[
              'رقم',
              'النوع',
              'الطرف',
              'التاريخ',
              'صافي الفاتورة',
              'المدفوع',
              'المتبقي',
              '',
            ]}
            rows={invoiceRows().slice(0, 8)}
          />
          {!products.length && (
            <div className="onboarding">
              <h3>المتجر جاهز لبياناتك</h3>
              <p>أضف أول صنف، وسجّل المخزون أو الشراء، ثم افتح وردية للبيع.</p>
              <button onClick={() => setModal({ kind: 'product' })} disabled={!manager}>
                {t('إضافة صنف')}
              </button>
              <button onClick={() => setModal({ kind: 'shiftOpen' })} disabled={!!state!.shift}>
                {t('افتح وردية')}
              </button>
            </div>
          )}
        </>
      )
    }
    if (page === 'products' || page === 'stock')
      return (
        <>
          {toolbar}
          <div className="section-head">
            <label className="check">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
              />
              إظهار الأصناف المتوقفة
            </label>
            <div>
              {page === 'products' ? (
                <button className="primary" onClick={() => setModal({ kind: 'product' })}>
                  {t('إضافة صنف')}
                </button>
              ) : (
                <>
                  <button className="primary" onClick={() => setModal({ kind: 'adjust' })}>
                    {t('إضافة مخزون')}
                  </button>
                  <button
                    onClick={async () => {
                      const result = await run(() => call<unknown[]>('stock.reconcile'), '')
                      if (result)
                        setNotice(
                          result.length
                            ? `يوجد ${result.length} اختلاف في دفتر المخزون`
                            : 'دفتر المخزون يطابق الأرصدة بالكامل',
                        )
                    }}
                  >
                    مطابقة دفتر المخزون
                  </button>
                </>
              )}
            </div>
          </div>
          <Table
            headers={[
              'الصنف',
              'SKU',
              'الوحدة',
              'سعر البيع',
              'الرصيد',
              'قيمة المخزون',
              'الباركود',
              '',
            ]}
            rows={filtered.map((p) => [
              <span>
                <strong>{p.name}</strong>
                <small>
                  {p.category || 'بدون تصنيف'}
                  {!p.active ? ' · متوقف' : ''}
                </small>
              </span>,
              <bdi>{p.sku}</bdi>,
              p.unit,
              fmt(p.price),
              <span className={p.qty <= p.reorder_qty ? 'badge warning' : 'badge'}>
                {p.qty / 1000}
              </span>,
              fmt(p.cost),
              <bdi>{p.barcode ?? '—'}</bdi>,
              <div className="row-actions">
                <button onClick={() => setModal({ kind: 'product', product: p })}>
                  {t('تعديل')}
                </button>
                <button onClick={() => setModal({ kind: 'adjust', product: p })}>حركة</button>
                <button
                  disabled={!p.barcode}
                  onClick={() => setModal({ kind: 'label', product: p })}
                >
                  {t('طباعة ملصق')}
                </button>
              </div>,
            ])}
          />
          {page === 'stock' && (
            <>
              <h3>سجل حركات المخزون</h3>
              <Table
                headers={['الصنف', 'النوع', 'تغير الكمية', 'تغير القيمة', 'السبب', 'التاريخ']}
                rows={state!.movements.map((m) => [
                  m.name,
                  m.kind,
                  m.qty / 1000,
                  fmt(m.cost),
                  m.note,
                  date(m.at),
                ])}
              />
            </>
          )}
        </>
      )
    if (page === 'customers' || page === 'suppliers') {
      const rows = state!.parties.filter(
        (p) =>
          p.kind === (page === 'customers' ? 'customer' : 'supplier') &&
          `${p.name} ${p.phone}`.includes(search),
      )
      return (
        <>
          {toolbar}
          <div className="section-head">
            <p className="muted">أرصدة محسوبة من الفواتير والمدفوعات والمرتجعات.</p>
            <button className="primary" onClick={() => setModal({ kind: 'party' })}>
              {t(page === 'customers' ? 'إضافة عميل' : 'إضافة مورد')}
            </button>
          </div>
          <Table
            headers={['الاسم', 'الهاتف', 'العنوان', 'الرصيد المستحق', '']}
            rows={rows.map((p) => [
              p.name,
              <bdi>{p.phone || '—'}</bdi>,
              p.address || '—',
              fmt(p.balance),
              <button onClick={() => setModal({ kind: 'party', party: p })}>{t('تعديل')}</button>,
            ])}
          />
        </>
      )
    }
    if (page === 'invoices')
      return (
        <>
          {toolbar}
          <div className="section-head">
            <span className="muted">آخر 2000 فاتورة · السجلات الأصلية محفوظة بالكامل</span>
            <button
              onClick={() =>
                downloadCSV(
                  'xzare-invoices.csv',
                  ['رقم', 'النوع', 'الطرف', 'التاريخ', 'الإجمالي', 'المرتجع', 'المتبقي'],
                  state!.invoices.map((i) => [
                    i.number,
                    i.kind,
                    i.party_name ?? '',
                    date(i.at),
                    moneyText(i.total),
                    moneyText(i.returned),
                    moneyText(i.balance),
                  ]),
                )
              }
            >
              {t('تصدير CSV')}
            </button>
          </div>
          <Table
            headers={[
              'رقم',
              'النوع',
              'الطرف',
              'التاريخ',
              'صافي الفاتورة',
              'المدفوع',
              'المتبقي',
              '',
            ]}
            rows={invoiceRows()}
          />
        </>
      )
    if (page === 'shifts')
      return (
        <>
          <div className="stats">
            <div className="stat">
              <span>افتتاح الوردية</span>
              <strong>{fmt(state!.shift?.opening ?? 0)}</strong>
            </div>
            <div className="stat">
              <span>النقدية المتوقعة</span>
              <strong>{fmt(state!.shift?.expected ?? 0)}</strong>
            </div>
            <div className="stat">
              <span>الحالة</span>
              <strong className="status-text">{state!.shift ? 'مفتوحة' : 'مغلقة'}</strong>
            </div>
          </div>
          <div className="section-head">
            <h3>وردية {state!.user.name}</h3>
            <div>
              {state!.shift ? (
                <>
                  <button className="primary" onClick={() => setModal({ kind: 'shiftClose' })}>
                    إغلاق وعد الخزينة
                  </button>
                  {manager && (
                    <>
                      <button onClick={() => setModal({ kind: 'expense' })}>تسجيل مصروف</button>
                      <button onClick={() => setModal({ kind: 'cash' })}>إيداع / سحب</button>
                    </>
                  )}
                </>
              ) : (
                <button className="primary" onClick={() => setModal({ kind: 'shiftOpen' })}>
                  {t('افتح وردية')}
                </button>
              )}
            </div>
          </div>
          <Table
            headers={['وقت الفتح', 'الافتتاح', 'المتوقع', 'الفعلي', 'الفرق', 'الحالة']}
            rows={state!.shifts.map((s) => [
              date(s.opened_at),
              fmt(s.opening),
              fmt(s.expected),
              s.actual === null ? '—' : fmt(s.actual),
              s.actual === null ? '—' : fmt(s.actual - s.expected),
              s.closed_at ? 'مقفلة' : 'مفتوحة',
            ])}
          />
          <h3>حركات خزينة حسابك</h3>
          <Table
            headers={['النوع', 'السبب', 'القيمة', 'التاريخ']}
            rows={state!.cash.map((c) => [c.kind, c.note, fmt(c.amount), date(c.at)])}
          />
        </>
      )
    if (page === 'reports')
      return (
        <>
          <div className="report-filter">
            <Field label="من تاريخ" name="from">
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="إلى تاريخ" name="to">
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                const end = new Date(to + 'T00:00:00')
                end.setDate(end.getDate() + 1)
                const r = await run(
                  () =>
                    call<Record<string, number>>('report.get', {
                      from: new Date(from + 'T00:00:00').getTime(),
                      to: end.getTime(),
                    }),
                  '',
                )
                if (r) setReport(r)
              }}
            >
              عرض التقرير
            </button>
            {report && (
              <button
                onClick={() =>
                  downloadCSV(
                    'xzare-report.csv',
                    ['البند', 'القيمة'],
                    Object.entries(report).map(([key, value]) => [
                      key,
                      key === 'count' ? value : moneyText(value),
                    ]),
                  )
                }
              >
                {t('تصدير CSV')}
              </button>
            )}
          </div>
          {report ? (
            <>
              <div className="stats">
                {[
                  ['netSales', 'صافي المبيعات'],
                  ['grossProfit', 'مجمل الربح'],
                  ['expenses', 'المصروفات'],
                  ['inventory', 'قيمة المخزون'],
                ].map(([key, label]) => (
                  <div className="stat" key={key}>
                    <span>{label}</span>
                    <strong>{fmt(report[key!] ?? 0)}</strong>
                  </div>
                ))}
              </div>
              <Table
                headers={['البند', 'القيمة']}
                rows={[
                  ['المبيعات قبل المرتجع', fmt(report.sales ?? 0)],
                  ['المرتجعات خلال الفترة', fmt(report.returns ?? 0)],
                  ['تكلفة البضاعة المباعة بعد المرتجع', fmt(report.cost ?? 0)],
                  ['عدد فواتير البيع', report.count ?? 0],
                  ...(restaurant ? [['هدر التحضير', fmt(report.waste ?? 0)]] : []),
                  [
                    restaurant ? 'النتيجة بعد المصروفات والهدر' : 'مجمل الربح ناقص المصروفات',
                    fmt((report.grossProfit ?? 0) - (report.expenses ?? 0) - (report.waste ?? 0)),
                  ],
                ]}
              />
              <p className="muted">
                التقرير تشغيلي ويشمل الضريبة في قيمة البيع؛ ليس قائمة مالية نظامية أو حسابًا
                ضريبيًا. قيمة المخزون حالية وليست رصيدًا تاريخيًا.
              </p>
            </>
          ) : (
            <div className="empty">
              <span>▤</span>
              <h3>حدد الفترة واعرض الأرقام الفعلية</h3>
              <p>المبيعات والمرتجعات حسب تاريخ كل حركة، وليست بيانات تقديرية.</p>
            </div>
          )}
        </>
      )
    if (page === 'users')
      return (
        <>
          <div className="section-head">
            <p className="muted">
              الكاشير للبيع، المدير للمخزون والمرتجعات، المسؤول للإعدادات والحسابات.
            </p>
            <button className="primary" onClick={() => setModal({ kind: 'user' })}>
              إضافة مستخدم
            </button>
          </div>
          <Table
            headers={['الاسم', 'اسم المستخدم', 'الصلاحية', 'الحالة', '']}
            rows={state!.users.map((u) => [
              u.name,
              <bdi>{u.username}</bdi>,
              u.role,
              u.active ? 'نشط' : 'متوقف',
              <button onClick={() => setModal({ kind: 'user', user: u })}>{t('تعديل')}</button>,
            ])}
          />
        </>
      )
    if (page === 'audit')
      return (
        <>
          <p className="muted">آخر 300 حدث. السجل الأصلي لا يقبل التعديل أو الحذف داخل البرنامج.</p>
          <Table
            headers={['العملية', 'المستخدم', 'مرجع العملية', 'التوقيت']}
            rows={state!.audit.map((a) => [
              a.action,
              a.user_name ?? 'النظام',
              <bdi>{a.entity_id}</bdi>,
              date(a.at),
            ])}
          />
        </>
      )
    if (page === 'settings')
      return (
        <div className="settings-grid">
          <section className="panel">
            <h3>بيانات المتجر والفاتورة</h3>
            {form(
              <>
                <Field
                  label="اسم المتجر"
                  name="businessName"
                  value={state!.settings.businessName}
                  required
                />
                <Field label="الهاتف" name="phone" value={state!.settings.phone} />
                <Field label="العنوان" name="address" value={state!.settings.address} />
                <Field
                  label="تذييل الفاتورة"
                  name="receiptFooter"
                  value={state!.settings.receiptFooter}
                />
                <Field
                  label="ضريبة افتراضية %"
                  name="tax"
                  value={Number(state!.settings.taxBps ?? 0) / 100}
                />
                <Field label="لغة الواجهة" name="language">
                  <select name="language" defaultValue={state!.settings.language}>
                    <option value="ar">العربية</option>
                    <option value="en">English</option>
                  </select>
                </Field>
                <p className="muted full">عملة نسخة البيع الحالية: الجنيه المصري EGP.</p>
                <h3 className="full">باركود الميزان — ملف وزن EAN-13</h3>
                <p className="muted full">
                  أدخل صيغة ميزانك. البادئة + خانات الصنف + خانات الوزن = ١٢، والخانة الأخيرة رقم
                  مراجعة. سجّل كود PLU للصنف كـ CODE128 بنفس الأصفار.
                </p>
                <label className="check full">
                  <input
                    type="checkbox"
                    name="scaleEnabled"
                    defaultChecked={JSON.parse(state!.settings.scaleProfiles ?? '[]').length > 0}
                  />
                  تفعيل قراءة وزن الميزان
                </label>
                <Field
                  label="بادئة الميزان"
                  name="scalePrefix"
                  value={JSON.parse(state!.settings.scaleProfiles ?? '[]')[0]?.prefix ?? ''}
                />
                <Field
                  label="عدد خانات كود الصنف"
                  name="scaleProductDigits"
                  value={JSON.parse(state!.settings.scaleProfiles ?? '[]')[0]?.productDigits ?? ''}
                />
                <Field
                  label="عدد خانات الوزن"
                  name="scaleValueDigits"
                  value={JSON.parse(state!.settings.scaleProfiles ?? '[]')[0]?.valueDigits ?? ''}
                />
                <Field
                  label="منازل الوزن العشرية — من ٠ إلى ٣"
                  name="scaleDecimals"
                  value={JSON.parse(state!.settings.scaleProfiles ?? '[]')[0]?.decimals ?? ''}
                />
              </>,
              (d) =>
                mutate(
                  'settings.save',
                  {
                    businessName: d.get('businessName'),
                    phone: d.get('phone'),
                    address: d.get('address'),
                    receiptFooter: d.get('receiptFooter'),
                    currency: 'EGP',
                    language: d.get('language'),
                    taxBps: Math.round(Number(d.get('tax')) * 100),
                    scaleProfiles: JSON.stringify(
                      d.has('scaleEnabled')
                        ? [
                            {
                              id: 'store-weight',
                              kind: 'weight',
                              prefix: String(d.get('scalePrefix')),
                              productDigits: Number(d.get('scaleProductDigits')),
                              valueDigits: Number(d.get('scaleValueDigits')),
                              decimals: Number(d.get('scaleDecimals')),
                            },
                          ]
                        : [],
                    ),
                  },
                  false,
                ),
            )}
          </section>
          <section className="panel">
            <h3>البيانات والأمان</h3>
            <p>
              احتفظ بنسخة خارج الجهاز. الاستعادة تتحقق من بصمة الملف وسلامة قاعدة البيانات قبل
              الاستبدال.
            </p>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const result = await call<{
                    cancelled?: boolean
                    download?: string
                    fileName?: string
                  }>('backup.create')
                  if (result.download) {
                    const bytes = Uint8Array.from(atob(result.download), (c) => c.charCodeAt(0))
                    const url = URL.createObjectURL(
                      new Blob([bytes], { type: 'application/octet-stream' }),
                    )
                    const a = document.createElement('a')
                    a.href = url
                    a.download = result.fileName ?? 'xzare.xzbak'
                    a.click()
                    URL.revokeObjectURL(url)
                  }
                  return result
                }, 'تم إنشاء النسخة الاحتياطية')
              }
            >
              {t('إنشاء نسخة احتياطية')}
            </button>
            <button onClick={() => setModal({ kind: 'restore' })}>{t('استعادة نسخة')}</button>
            <hr />
            <button onClick={() => setModal({ kind: 'password' })}>{t('تغيير كلمة المرور')}</button>
            <hr />
            <h3>{restaurant ? 'XZARE RESTAURANT' : 'XZARE POS'}</h3>
            <p className="muted">
              إصدار 0.2.0 · تفعيل عبر الإنترنت ومهلة دون اتصال
              <br />
              الدعم: <a href="mailto:hello@xzare.com">hello@xzare.com</a>
              <br />
              <bdi>+201501230440</bdi>
            </p>
          </section>
          <LicensePanel />
        </div>
      )
    return null
  }
  return (
    <div
      className={
        'app-shell' +
        (embeddedPage ? ' embedded-workspace' : '') +
        (collapsed ? ' nav-collapsed' : '') +
        (menuOpen ? ' menu-open' : '')
      }
    >
      {menuOpen && (
        <button
          className="menu-scrim no-print"
          aria-label="إغلاق القائمة"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <aside
        id="workspace-navigation"
        ref={navigationRef}
        role={menuOpen ? 'dialog' : undefined}
        aria-modal={menuOpen ? true : undefined}
        className="sidebar no-print"
        aria-label="قائمة البرنامج"
      >
        <div className="brand">
          <BrandMark />
          <div className="brand-name">
            XZARE<small>POS / BUSINESS ENGINE</small>
          </div>
        </div>
        <div className="store-name">
          {state.settings.businessName}
          <small>{t('البيانات محفوظة على هذا الجهاز')}</small>
        </div>
        <nav aria-label="أقسام البرنامج">
          {[
            { label: 'العمل اليومي', pages: ['dashboard', 'pos', 'invoices', 'shifts'] },
            {
              label: 'إدارة المتجر',
              pages: ['products', 'stock', 'purchases', 'customers', 'suppliers', 'reports'],
            },
            { label: 'النظام', pages: ['settings', 'users', 'audit'] },
          ].map((group) => (
            <div className="nav-group" key={group.label}>
              {group.pages.some((p) => nav.includes(p as Page)) && (
                <span className="nav-group-label">{group.label}</span>
              )}
              {group.pages
                .filter((p) => nav.includes(p as Page))
                .map((p) => (
                  <button
                    key={p}
                    aria-label={t(titles[p as Page])}
                    aria-current={page === p ? 'page' : undefined}
                    title={t(titles[p as Page])}
                    className={page === p ? 'active' : ''}
                    onClick={() => navigate(p as Page)}
                  >
                    <Icon name={p as Page} />
                    <span className="nav-label">{t(titles[p as Page])}</span>
                    {p === 'pos' && <kbd>F2</kbd>}
                  </button>
                ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <Icon name="device" />
          <span>
            بيانات محلية على جهازك<small>XZARE / 0.3</small>
          </span>
        </div>
        <button
          className="nav-collapse"
          aria-label={collapsed ? 'توسيع القائمة' : 'تصغير القائمة'}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(!collapsed)}
        >
          <Icon name="menu" />
          <span>{collapsed ? 'توسيع' : 'تصغير القائمة'}</span>
        </button>
      </aside>
      <div className="workspace" inert={menuOpen}>
        <header className="topbar no-print">
          <button
            className="mobile-menu"
            aria-label="فتح القائمة"
            aria-expanded={menuOpen}
            aria-controls="workspace-navigation"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <Icon name="menu" />
          </button>
          <div className="breadcrumb">
            XZARE / <strong>{t(titles[page])}</strong>
          </div>
          <div className="header-actions">
            <button
              className="help-button"
              onClick={() => setModal({ kind: 'help' })}
              aria-label="مساعدة الاستخدام"
              title="مساعدة الاستخدام (Alt + H)"
            >
              <Icon name="help" />
            </button>
            <button
              className={state.shift ? 'shift-badge' : 'shift-badge closed'}
              onClick={() => setModal({ kind: state.shift ? 'shiftClose' : 'shiftOpen' })}
            >
              <span />
              {t(state.shift ? 'وردية مفتوحة' : 'الوردية مغلقة')}
            </button>
            <button
              onClick={() => {
                void logout().catch((e) => setError(errorText(e)))
              }}
              title={t('قفل البرنامج')}
              aria-label={t('قفل البرنامج')}
            >
              <Icon name="lock" />
              <span className="user-name">{state.user.name}</span>
            </button>
          </div>
        </header>
        <ContentRegion
          className={'main-content ' + (['pos', 'purchases'].includes(page) ? 'pos-content' : '')}
        >
          {!embeddedPage && (
            <div className="page-heading no-print">
              <div>
                <span className="eyebrow">{state.settings.businessName}</span>
                <h1>{t(titles[page])}</h1>
              </div>
              <WorkspaceClock english={english} />
            </div>
          )}
          {error && (
            <div className="alert error no-print" role="alert">
              {error}
              <button aria-label="إغلاق التنبيه" onClick={() => setError('')}>
                ×
              </button>
            </div>
          )}
          {notice && (
            <div className="alert success no-print" role="status">
              {notice}
              <button onClick={() => setNotice('')}>×</button>
            </div>
          )}
          {content()}
        </ContentRegion>
      </div>
      {modal && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) setModal(null)
          }}
        >
          <section
            className={'modal ' + (modal.kind === 'invoice' ? 'wide' : '')}
            role="dialog"
            ref={dialogRef}
            aria-modal="true"
            aria-labelledby="modal-title"
          >
            <div className="modal-header no-print">
              <h2 id="modal-title">
                {
                  {
                    product: 'بيانات الصنف',
                    party: 'بيانات الطرف',
                    adjust: 'حركة مخزون',
                    shiftOpen: 'فتح وردية',
                    shiftClose: 'إغلاق الوردية',
                    expense: 'تسجيل مصروف',
                    cash: 'حركة خزينة',
                    user: 'حساب المستخدم',
                    password: 'تغيير كلمة المرور',
                    invoice: 'تفاصيل الفاتورة',
                    holds: 'الفواتير المعلقة',
                    holdSave: 'حفظ فاتورة معلقة',
                    label: 'ملصق الباركود',
                    restore: 'استعادة نسخة احتياطية',
                    help: 'خطوات بسيطة ليومك',
                  }[modal.kind]
                }
              </h2>
              <button aria-label="إغلاق النافذة" disabled={busy} onClick={() => setModal(null)}>
                ×
              </button>
            </div>
            {error && (
              <div className="alert error no-print" role="alert">
                {error}
              </div>
            )}
            {modalContent()}
          </section>
        </div>
      )}
    </div>
  )
}
