import { CostBasis, Money, Quantity, basisPoints, lineTotal, ulid } from '@xzare/core'
import type { XzareDatabase } from '@xzare/db'
import { Commerce, fingerprint, productQuery, sum } from './commerce.js'
import { Identity } from './identity.js'
import { validated } from './validation.js'
import {
  restaurantSchemas,
  restaurantActions,
  type RestaurantAction,
} from './restaurant-validation.js'
import type { User, Product } from './types.js'
import type {
  RestaurantOrder,
  RestaurantState,
  MenuItem,
  OrderLine,
  RecipeComponent,
  RestaurantTable,
  Driver,
  Reservation,
} from './restaurant-types.js'

const live = "status NOT IN('completed','cancelled','refunded')"
const orderQuery = `SELECT o.id,o.number,o.kind,o.table_id AS tableId,t.name AS tableName,o.status,o.version,o.customer_name AS customerName,o.phone,o.address,o.note,o.delivery_fee AS deliveryFee,o.tax_bps AS taxBps,o.driver_id AS driverId,d.name AS driverName,o.created_at AS createdAt,o.updated_at AS updatedAt,o.invoice_id AS invoiceId FROM restaurant_orders o LEFT JOIN restaurant_tables t ON t.id=o.table_id LEFT JOIN restaurant_drivers d ON d.id=o.driver_id`
export class Restaurant {
  constructor(
    readonly db: XzareDatabase,
    readonly identity: Identity,
    readonly commerce: Commerce,
  ) {}
  private event(user: User, orderId: string, action: string, note = '') {
    this.db
      .prepare('INSERT INTO restaurant_events VALUES(?,?,?,?,?,?)')
      .run(ulid(), orderId, user.id, action, note, Date.now())
    this.identity.audit(user.id, action, orderId)
  }
  private config() {
    return {
      deliveryFee: Number(
        (
          this.db.prepare("SELECT value FROM settings WHERE key='restaurantDeliveryFee'").get() as
            { value: string } | undefined
        )?.value ?? 0,
      ),
    }
  }
  private recipes(menuId: string): RecipeComponent[] {
    return this.db
      .prepare(
        'SELECT r.variant_id AS variantId,r.qty,p.name,v.unit FROM restaurant_recipes r JOIN variants v ON v.id=r.variant_id JOIN products p ON p.id=v.product_id WHERE r.menu_id=? ORDER BY r.variant_id',
      )
      .all(menuId) as RecipeComponent[]
  }
  private menu(): MenuItem[] {
    return (
      this.db
        .prepare(
          'SELECT m.id,p.name,p.category,v.price,p.active,m.station,m.kind FROM restaurant_menu m JOIN variants v ON v.id=m.id JOIN products p ON p.id=v.product_id ORDER BY p.name LIMIT 10000',
        )
        .all() as Omit<MenuItem, 'components'>[]
    ).map((item) => ({ ...item, components: this.recipes(item.id) }))
  }
  private getOrder(id: string): RestaurantOrder {
    const row = this.db.prepare(orderQuery + ' WHERE o.id=?').get(id) as
      | (Omit<RestaurantOrder, 'lines' | 'invoice' | 'subtotal'> & { invoiceId: string | null })
      | undefined
    if (!row) throw new Error('الطلب غير موجود')
    const lines = (
      this.db
        .prepare(
          'SELECT id,menu_id AS menuId,name,qty,price,station,components,note,status,cost,prepared_at AS preparedAt,ready_at AS readyAt FROM restaurant_order_lines WHERE order_id=? ORDER BY created_at,id',
        )
        .all(id) as (Omit<OrderLine, 'components'> & { components: string })[]
    ).map((line) => ({ ...line, components: JSON.parse(line.components) as RecipeComponent[] }))
    const { invoiceId, ...data } = row
    return {
      ...data,
      lines,
      subtotal: sum([
        ...lines
          .filter((l) => l.status !== 'cancelled')
          .map(
            (l) => lineTotal(Money.fromPiastres(l.price), Quantity.fromMilliUnits(l.qty)) as number,
          ),
        row.deliveryFee,
      ]),
      invoice: invoiceId ? this.commerce.invoice(invoiceId) : null,
    }
  }
  private safeOrder(order: RestaurantOrder, user: User): RestaurantOrder {
    if (user.role === 'kitchen')
      return {
        ...order,
        customerName: '',
        phone: '',
        address: '',
        note: '',
        deliveryFee: 0,
        taxBps: 0,
        driverId: null,
        driverName: null,
        subtotal: 0,
        invoice: null,
        lines: order.lines
          .filter((line) => ['queued', 'preparing', 'ready'].includes(line.status))
          .map((line) => ({ ...line, price: 0, cost: 0, components: [] })),
      }
    if (user.role === 'cashier')
      return {
        ...order,
        invoice: order.invoice ? { ...order.invoice, cost: 0 } : null,
        lines: order.lines.map((line) => ({ ...line, cost: 0, components: [] })),
      }
    return order
  }
  state(user: User): RestaurantState {
    const kitchen = user.role === 'kitchen',
      manager = user.role === 'manager' || user.role === 'admin'
    const rows = this.db
      .prepare(
        `SELECT id FROM restaurant_orders ORDER BY CASE WHEN ${live} THEN 0 ELSE 1 END,created_at DESC LIMIT 1000`,
      )
      .all() as { id: string }[]
    const orders = rows
      .map((row) => this.getOrder(row.id))
      .filter(
        (order) =>
          !kitchen ||
          (order.status !== 'out' &&
            order.lines.some((line) => ['queued', 'preparing', 'ready'].includes(line.status))),
      )
      .map((order) => this.safeOrder(order, user))
    return {
      user,
      businessName: (
        this.db.prepare("SELECT value FROM settings WHERE key='businessName'").get() as {
          value: string
        }
      ).value,
      tables: this.db
        .prepare(
          `SELECT t.*,o.id AS orderId,o.number AS orderNumber,o.status FROM restaurant_tables t LEFT JOIN restaurant_orders o ON o.table_id=t.id AND o.${live} ORDER BY t.zone,t.name`,
        )
        .all() as RestaurantTable[],
      menu: kitchen
        ? []
        : this.menu().map((item) => (manager ? item : { ...item, components: [] })),
      orders,
      drivers: kitchen
        ? []
        : (this.db
            .prepare(
              "SELECT d.*,COALESCE((SELECT count(*) FROM restaurant_orders o WHERE o.driver_id=d.id AND o.status='out'),0) AS trips FROM restaurant_drivers d ORDER BY d.name",
            )
            .all() as Driver[]),
      reservations: kitchen
        ? []
        : (this.db
            .prepare(
              'SELECT r.id,r.table_id AS tableId,t.name AS tableName,r.name,r.phone,r.guests,r.starts_at AS startsAt,r.ends_at AS endsAt,r.status,r.order_id AS orderId FROM restaurant_reservations r JOIN restaurant_tables t ON t.id=r.table_id ORDER BY r.starts_at DESC LIMIT 1000',
            )
            .all() as Reservation[]),
      waste: manager
        ? (this.db
            .prepare(
              'SELECT w.id,w.order_id AS orderId,w.line_id AS lineId,l.name,w.qty,w.cost,w.reason,w.at FROM restaurant_waste w JOIN restaurant_order_lines l ON l.id=w.line_id ORDER BY w.at DESC LIMIT 500',
            )
            .all() as RestaurantState['waste'])
        : [],
      config: kitchen ? { deliveryFee: 0 } : this.config(),
    }
  }
  private authorize(action: string, user: User, payload: unknown) {
    if (action === 'restaurant.state') return
    if (user.role === 'kitchen' && action !== 'restaurant.line.advance')
      throw new Error('حساب المطبخ لا يملك صلاحية هذه العملية')
    const managers = [
      'restaurant.table.save',
      'restaurant.menu.save',
      'restaurant.driver.save',
      'restaurant.config.save',
      'restaurant.refund',
    ]
    if (managers.includes(action) && !['admin', 'manager'].includes(user.role))
      throw new Error('هذه العملية تحتاج صلاحية مدير')
    if (action === 'restaurant.line.advance') {
      const status = (payload as { status?: unknown } | null)?.status
      if (status === 'served' && user.role === 'kitchen')
        throw new Error('التقديم من صلاحيات الصالة')
      if (status !== 'served' && user.role === 'cashier')
        throw new Error('بدء التحضير يحتاج حساب مطبخ أو مدير')
    }
  }
  call(action: string, payload: unknown, user: User): unknown {
    if (!restaurantActions.has(action)) throw new Error('العملية غير متاحة')
    this.authorize(action, user, payload)
    const d = validated<unknown>(restaurantSchemas[action as RestaurantAction], payload) as Record<
      string,
      any
    >
    if (action === 'restaurant.state') return this.state(user)
    const hash = fingerprint(d)
    const result = this.db.transaction(() => {
      if (d.clientTxnId) {
        const previous = this.db
          .prepare('SELECT * FROM commands WHERE client_txn_id=?')
          .get(d.clientTxnId) as
          { action: string; user_id: string; request_hash: string; result: string } | undefined
        if (previous) {
          if (
            previous.action !== action ||
            previous.user_id !== user.id ||
            previous.request_hash !== hash
          )
            throw new Error('معرّف العملية مستخدم لبيانات مختلفة')
          return JSON.parse(previous.result)
        }
      }
      const value = this.execute(action, d, user)
      if (d.clientTxnId)
        this.db
          .prepare('INSERT INTO commands VALUES(?,?,?,?,?)')
          .run(d.clientTxnId, action, user.id, hash, JSON.stringify(value))
      return value
    })()
    return result && typeof result === 'object' && 'lines' in result
      ? this.safeOrder(result as RestaurantOrder, user)
      : result
  }
  private activeTable(id: string) {
    const table = this.db
      .prepare('SELECT * FROM restaurant_tables WHERE id=? AND active=1')
      .get(id) as { id: string; seats: number } | undefined
    if (!table) throw new Error('الطاولة غير موجودة أو متوقفة')
    if (this.db.prepare(`SELECT id FROM restaurant_orders WHERE table_id=? AND ${live}`).get(id))
      throw new Error('الطاولة مشغولة بطلب آخر')
    return table
  }
  private create(d: Record<string, any>, user: User) {
    if (d.kind === 'dinein') {
      if (!d.tableId) throw new Error('اختر طاولة للصالة')
      this.activeTable(d.tableId)
    } else if (d.tableId) throw new Error('الطاولة تخص طلبات الصالة فقط')
    if (
      d.kind === 'delivery' &&
      (!d.customerName?.trim() || !d.phone?.trim() || !d.address?.trim())
    )
      throw new Error('اسم العميل والهاتف والعنوان مطلوبون للتوصيل')
    this.db
      .prepare(
        "INSERT INTO sequences VALUES('restaurant',1) ON CONFLICT(kind) DO UPDATE SET value=value+1",
      )
      .run()
    const sequence = this.db
      .prepare("SELECT value FROM sequences WHERE kind='restaurant'")
      .get() as { value: number }
    const id = ulid(),
      at = Date.now(),
      number = 'R-' + String(sequence.value).padStart(6, '0')
    const tax = Number(
      (this.db.prepare("SELECT value FROM settings WHERE key='taxBps'").get() as { value: string })
        .value,
    )
    this.db
      .prepare(
        'INSERT INTO restaurant_orders(id,number,kind,table_id,user_id,status,customer_name,phone,address,note,delivery_fee,tax_bps,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      )
      .run(
        id,
        number,
        d.kind,
        d.tableId ?? null,
        user.id,
        'open',
        d.customerName ?? '',
        d.phone ?? '',
        d.address ?? '',
        d.note ?? '',
        d.kind === 'delivery' ? this.config().deliveryFee : 0,
        tax,
        at,
        at,
      )
    this.event(user, id, 'restaurant.order.create')
    return this.getOrder(id)
  }
  private current(d: Record<string, any>) {
    const current = this.getOrder(d.orderId)
    if (current.version !== d.version)
      throw new Error('تغير الطلب؛ حدّث الشاشة وراجع آخر نسخة قبل المحاولة')
    if (['completed', 'cancelled', 'refunded'].includes(current.status))
      throw new Error('الطلب مغلق؛ لا يمكن تعديله')
    return current
  }
  private refresh(id: string, user: User, action: string, note = '') {
    const order = this.getOrder(id),
      lines = order.lines.filter((l) => l.status !== 'cancelled')
    let status = order.status
    if (!lines.length && order.lines.length) status = 'cancelled'
    else if (status !== 'out' && status !== 'cancelled')
      status = lines.some((l) => l.status === 'draft')
        ? 'open'
        : lines.some((l) => l.status === 'queued')
          ? 'queued'
          : lines.some((l) => l.status === 'preparing')
            ? 'preparing'
            : lines.every((l) => l.status === 'served') && lines.length
              ? 'served'
              : lines.length
                ? 'ready'
                : 'open'
    this.db
      .prepare('UPDATE restaurant_orders SET version=version+1,status=?,updated_at=? WHERE id=?')
      .run(status, Date.now(), id)
    this.event(user, id, action, note)
    return this.getOrder(id)
  }
  private cancel(line: OrderLine, order: RestaurantOrder, user: User, reason: string) {
    if (line.status === 'cancelled') throw new Error('الصنف ملغى بالفعل')
    if (line.preparedAt !== null) {
      if (!['admin', 'manager'].includes(user.role))
        throw new Error('إلغاء صنف بدأ تحضيره يحتاج مديرًا')
      this.db
        .prepare('INSERT INTO restaurant_waste VALUES(?,?,?,?,?,?,?,?)')
        .run(ulid(), order.id, line.id, user.id, line.qty, line.cost, reason, Date.now())
    }
    this.db.prepare("UPDATE restaurant_order_lines SET status='cancelled' WHERE id=?").run(line.id)
  }
  private execute(action: string, d: Record<string, any>, user: User): any {
    if (action === 'restaurant.config.save') {
      this.db
        .prepare(
          "INSERT INTO settings VALUES('restaurantDeliveryFee',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(String(d.deliveryFee))
      this.identity.audit(user.id, action, 'restaurant')
      return this.config()
    }
    if (action === 'restaurant.table.save' || action === 'restaurant.driver.save') {
      const table = action === 'restaurant.table.save' ? 'restaurant_tables' : 'restaurant_drivers',
        id = d.id ?? ulid()
      if (d.id && !this.db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(id))
        throw new Error('السجل غير موجود')
      if (d.id && (!d.active || table === 'restaurant_tables')) {
        const occupied =
          table === 'restaurant_tables'
            ? this.db
                .prepare(`SELECT id FROM restaurant_orders WHERE table_id=? AND ${live}`)
                .get(id)
            : this.db
                .prepare("SELECT id FROM restaurant_orders WHERE driver_id=? AND status='out'")
                .get(id)
        if (occupied) throw new Error('السجل مرتبط بطلب نشط؛ أنهِ الطلب أولًا')
        if (
          !d.active &&
          table === 'restaurant_tables' &&
          this.db
            .prepare(
              "SELECT id FROM restaurant_reservations WHERE table_id=? AND status='booked' AND ends_at>?",
            )
            .get(id, Date.now())
        )
          throw new Error('الطاولة مرتبطة بحجز قادم')
      }
      if (table === 'restaurant_tables')
        this.db
          .prepare(
            'INSERT INTO restaurant_tables VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,zone=excluded.zone,seats=excluded.seats,active=excluded.active',
          )
          .run(id, d.name, d.zone, d.seats, Number(d.active))
      else
        this.db
          .prepare(
            'INSERT INTO restaurant_drivers VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,phone=excluded.phone,active=excluded.active',
          )
          .run(id, d.name, d.phone, Number(d.active))
      this.identity.audit(user.id, action, id)
      return { id }
    }
    if (action === 'restaurant.menu.save') {
      if (
        new Set(d.components.map((c: RecipeComponent) => c.variantId)).size !== d.components.length
      )
        throw new Error('الخامة مكررة في الوصفة')
      if (
        (d.kind === 'service' && d.components.length) ||
        (d.kind !== 'service' && !d.components.length)
      )
        throw new Error('الوصفة مطلوبة للطعام؛ صنف الخدمة لا يستهلك خامات')
      if (d.kind === 'stocked' && (d.components.length !== 1 || d.components[0].qty !== 1000))
        throw new Error('الصنف الجاهز يحتاج وحدة واحدة من خامة واحدة')
      for (const component of d.components as RecipeComponent[]) {
        if (
          !this.db
            .prepare(
              'SELECT v.id FROM variants v JOIN products p ON p.id=v.product_id WHERE v.id=? AND p.active=1 AND v.id NOT IN(SELECT id FROM restaurant_menu)',
            )
            .get(component.variantId)
        )
          throw new Error('اختر خامة فعلية نشطة؛ لا تستخدم صنف قائمة داخل وصفة')
      }
      const id = d.id ?? ulid(),
        existing = d.id
          ? (this.db
              .prepare(
                'SELECT v.product_id FROM restaurant_menu m JOIN variants v ON v.id=m.id WHERE m.id=?',
              )
              .get(id) as { product_id: string } | undefined)
          : undefined
      if (d.id && !existing) throw new Error('صنف القائمة غير موجود')
      const product = existing?.product_id ?? ulid()
      this.db
        .prepare(
          'INSERT INTO products VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,category=excluded.category,active=excluded.active',
        )
        .run(product, d.name, d.category, Number(d.active))
      if (existing) this.db.prepare('UPDATE variants SET price=? WHERE id=?').run(d.price, id)
      else
        this.db
          .prepare(
            'INSERT INTO variants(id,product_id,sku,unit,price,reorder_qty) VALUES(?,?,?,?,?,0)',
          )
          .run(id, product, 'MENU-' + id, 'حصة', d.price)
      this.db
        .prepare(
          'INSERT INTO restaurant_menu VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET station=excluded.station,kind=excluded.kind',
        )
        .run(id, d.station, d.kind)
      this.db.prepare('DELETE FROM restaurant_recipes WHERE menu_id=?').run(id)
      for (const c of d.components as RecipeComponent[])
        this.db.prepare('INSERT INTO restaurant_recipes VALUES(?,?,?)').run(id, c.variantId, c.qty)
      this.identity.audit(user.id, action, id)
      return { id }
    }
    if (action === 'restaurant.order.create') return this.create(d, user)
    if (action === 'restaurant.reservation.save') {
      const table = this.db
        .prepare('SELECT seats FROM restaurant_tables WHERE id=? AND active=1')
        .get(d.tableId) as { seats: number } | undefined
      if (!table || d.guests > table.seats) throw new Error('راجع الطاولة وعدد الضيوف')
      if (
        d.startsAt < Date.now() - 900000 ||
        d.endsAt <= d.startsAt ||
        d.endsAt - d.startsAt > 86400000
      )
        throw new Error('راجع بداية الحجز ومدته')
      if (
        this.db
          .prepare(
            "SELECT id FROM restaurant_reservations WHERE table_id=? AND status='booked' AND starts_at<? AND ends_at>?",
          )
          .get(d.tableId, d.endsAt, d.startsAt)
      )
        throw new Error('وقت الحجز يتداخل مع حجز آخر')
      const id = ulid()
      this.db
        .prepare("INSERT INTO restaurant_reservations VALUES(?,?,?,?,?,?,?,'booked',NULL)")
        .run(id, d.tableId, d.name, d.phone, d.guests, d.startsAt, d.endsAt)
      this.identity.audit(user.id, action, id)
      return { id }
    }
    if (action === 'restaurant.reservation.cancel' || action === 'restaurant.reservation.seat') {
      const booking = this.db
        .prepare("SELECT * FROM restaurant_reservations WHERE id=? AND status='booked'")
        .get(d.reservationId) as { table_id: string; name: string; ends_at: number } | undefined
      if (!booking) throw new Error('الحجز غير متاح أو استُخدم بالفعل')
      if (action.endsWith('.cancel')) {
        this.db
          .prepare("UPDATE restaurant_reservations SET status='cancelled' WHERE id=?")
          .run(d.reservationId)
        this.identity.audit(user.id, action, d.reservationId)
        return { id: d.reservationId }
      }
      if (booking.ends_at <= Date.now()) throw new Error('انتهى وقت الحجز')
      const order = this.create(
        { kind: 'dinein', tableId: booking.table_id, customerName: booking.name },
        user,
      )
      this.db
        .prepare("UPDATE restaurant_reservations SET status='seated',order_id=? WHERE id=?")
        .run(order.id, d.reservationId)
      return order
    }
    if (action === 'restaurant.refund') return this.refund(d, user)
    const order = this.current(d)
    if (order.status === 'out' && action !== 'restaurant.checkout')
      throw new Error('الطلب خرج للتوصيل؛ أكّد التحصيل قبل أي تعديل')
    if (action === 'restaurant.order.add') {
      const item = this.menu().find((item) => item.id === d.menuId && item.active)
      if (!item) throw new Error('صنف القائمة غير موجود أو متوقف')
      if (order.lines.length >= 200) throw new Error('وصل الطلب للحد الأقصى؛ افتح طلبًا آخر')
      this.db
        .prepare(
          "INSERT INTO restaurant_order_lines(id,order_id,menu_id,name,qty,price,station,components,note,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,'draft',?)",
        )
        .run(
          ulid(),
          order.id,
          item.id,
          item.name,
          d.qty,
          item.price,
          item.station,
          JSON.stringify(item.components),
          d.note,
          Date.now(),
        )
    } else if (action === 'restaurant.order.send') {
      if (!order.lines.some((l) => l.status === 'draft'))
        throw new Error('لا توجد أصناف جديدة لإرسالها للمطبخ')
      this.db
        .prepare(
          "UPDATE restaurant_order_lines SET status='queued' WHERE order_id=? AND status='draft'",
        )
        .run(order.id)
    } else if (action === 'restaurant.order.move') {
      if (order.kind !== 'dinein') throw new Error('نقل الطاولة متاح للصالة فقط')
      this.activeTable(d.tableId)
      this.db.prepare('UPDATE restaurant_orders SET table_id=? WHERE id=?').run(d.tableId, order.id)
    } else if (action === 'restaurant.line.advance') {
      const line = order.lines.find((l) => l.id === d.lineId)
      if (!line) throw new Error('الصنف غير موجود في الطلب')
      const expected = { preparing: 'queued', ready: 'preparing', served: 'ready' }[
        d.status as 'preparing' | 'ready' | 'served'
      ]
      if (line.status !== expected || (d.status === 'served' && order.kind !== 'dinein'))
        throw new Error('انتقال حالة الصنف غير مسموح')
      let cost = line.cost
      if (d.status === 'preparing') {
        cost = 0
        for (const component of line.components) {
          const raw = this.db
            .prepare(`${productQuery} WHERE v.id=? AND p.active=1`)
            .get(component.variantId) as Product | undefined
          const qty = component.qty * (line.qty / 1000)
          if (!Number.isSafeInteger(qty) || qty > 1000000000 || !raw || raw.qty < qty)
            throw new Error('المخزون المتاح للخامات لا يكفي للتحضير')
          const portion = CostBasis.create(
            Money.fromPiastres(raw.cost),
            Quantity.fromMilliUnits(raw.qty),
          ).take(Quantity.fromMilliUnits(qty)).cost
          this.commerce.move(
            user,
            raw.id,
            -qty,
            -portion,
            'restaurant.prepare',
            line.id,
            order.number,
          )
          cost = sum([cost, portion])
        }
      }
      this.db
        .prepare(
          'UPDATE restaurant_order_lines SET status=?,cost=?,prepared_at=COALESCE(prepared_at,?),ready_at=COALESCE(ready_at,?) WHERE id=?',
        )
        .run(
          d.status,
          cost,
          d.status === 'preparing' ? Date.now() : null,
          d.status === 'ready' ? Date.now() : null,
          line.id,
        )
    } else if (action === 'restaurant.line.cancel') {
      const line = order.lines.find((l) => l.id === d.lineId)
      if (!line) throw new Error('الصنف غير موجود في الطلب')
      this.cancel(line, order, user, d.reason)
    } else if (action === 'restaurant.order.cancel') {
      for (const line of order.lines.filter((l) => l.status !== 'cancelled'))
        this.cancel(line, order, user, d.reason)
      if (!order.lines.length)
        this.db.prepare("UPDATE restaurant_orders SET status='cancelled' WHERE id=?").run(order.id)
    } else if (action === 'restaurant.delivery.dispatch') {
      if (order.kind !== 'delivery' || order.status !== 'ready')
        throw new Error('التوصيل يحتاج طلبًا جاهزًا')
      if (
        !this.db
          .prepare('SELECT id FROM restaurant_drivers WHERE id=? AND active=1')
          .get(d.driverId)
      )
        throw new Error('اختر مندوبًا نشطًا')
      this.db
        .prepare("UPDATE restaurant_orders SET status='out',driver_id=? WHERE id=?")
        .run(d.driverId, order.id)
    } else if (action === 'restaurant.checkout') return this.checkout(order, d, user)
    else throw new Error('العملية غير متاحة')
    return this.refresh(order.id, user, action, d.reason ?? '')
  }
  private checkout(order: RestaurantOrder, d: Record<string, any>, user: User) {
    const lines = order.lines.filter((l) => l.status !== 'cancelled')
    if (!lines.length || lines.some((l) => !['ready', 'served'].includes(l.status)))
      throw new Error('انتظر تجهيز جميع أصناف الطلب قبل التحصيل')
    if (order.kind === 'delivery' && order.status !== 'out')
      throw new Error('عيّن المندوب وأرسل الطلب أولًا')
    const shift = this.commerce.shift(user)
    if (d.discount > order.subtotal || (d.discount > 0 && user.role === 'cashier'))
      throw new Error('الخصم غير مسموح أو يحتاج مديرًا')
    const tax = Money.applyRate(
      Money.fromPiastres(order.subtotal - d.discount),
      basisPoints(order.taxBps),
    ) as number
    const total = sum([order.subtotal - d.discount, tax]),
      tender = sum([d.cash, d.card, d.transfer])
    if (tender < total || sum([d.card, d.transfer]) > total)
      throw new Error('سجّل الدفع الكامل؛ البطاقة والتحويل لا يتجاوزان الإجمالي')
    const change = tender - total,
      cash = d.cash - change,
      id = ulid(),
      at = Date.now()
    this.db
      .prepare(
        "INSERT INTO sequences VALUES('sale',1) ON CONFLICT(kind) DO UPDATE SET value=value+1",
      )
      .run()
    const seq = this.db.prepare("SELECT value FROM sequences WHERE kind='sale'").get() as {
      value: number
    }
    const number = 'S-' + String(seq.value).padStart(6, '0')
    this.db
      .prepare(
        "INSERT INTO invoices(id,number,kind,user_id,party_id,shift_id,at,subtotal,discount,tax,total,client_txn_id,request_hash,note,cash_received,change) VALUES(?,?,'sale',?,NULL,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        number,
        user.id,
        shift.id,
        at,
        order.subtotal,
        d.discount,
        tax,
        total,
        d.clientTxnId,
        fingerprint(d),
        order.number,
        d.cash,
        change,
      )
    const saleLines = lines.map((line) => ({
      variant: line.menuId,
      name: line.name,
      qty: line.qty,
      price: line.price,
      cost: line.cost,
      gross: lineTotal(Money.fromPiastres(line.price), Quantity.fromMilliUnits(line.qty)) as number,
    }))
    if (order.deliveryFee > 0) {
      const feeId = this.feeVariant()
      saleLines.push({
        variant: feeId,
        name: 'خدمة التوصيل',
        qty: 1000,
        price: order.deliveryFee,
        cost: 0,
        gross: order.deliveryFee,
      })
    }
    const allocation = Money.allocate(
      Money.fromPiastres(total),
      saleLines.map((l) => (order.subtotal === 0 ? l.qty : l.gross)),
    )
    saleLines.forEach((line, index) =>
      this.db
        .prepare('INSERT INTO invoice_lines VALUES(?,?,?,?,?,?,?,?,?)')
        .run(
          ulid(),
          id,
          line.variant,
          line.name,
          'حصة',
          line.qty,
          line.price,
          allocation[index]!,
          line.cost,
        ),
    )
    for (const [method, amount] of [
      ['cash', cash],
      ['card', d.card],
      ['transfer', d.transfer],
    ] as const)
      if (amount > 0)
        this.db
          .prepare('INSERT INTO payments VALUES(?,?,?,?,?,?,?)')
          .run(ulid(), id, shift.id, method, amount, at, ulid())
    this.commerce.cash(user, shift.id, cash, 'restaurant.sale', number, id)
    this.db
      .prepare(
        "UPDATE restaurant_orders SET invoice_id=?,status='completed',version=version+1,updated_at=? WHERE id=?",
      )
      .run(id, at, order.id)
    this.event(user, order.id, 'restaurant.checkout')
    return this.getOrder(order.id)
  }
  private feeVariant() {
    const row = this.db
      .prepare("SELECT id FROM variants WHERE sku='__XZARE_DELIVERY_FEE'")
      .get() as { id: string } | undefined
    if (row) return row.id
    const product = ulid(),
      id = ulid()
    this.db
      .prepare('INSERT INTO products VALUES(?,?,?,1)')
      .run(product, 'خدمة التوصيل', 'خدمات المطعم')
    this.db
      .prepare(
        "INSERT INTO variants(id,product_id,sku,unit,price,reorder_qty) VALUES(?,?,'__XZARE_DELIVERY_FEE','خدمة',0,0)",
      )
      .run(id, product)
    return id
  }
  private refund(d: Record<string, any>, user: User) {
    const order = this.getOrder(d.orderId),
      invoice = order.invoice
    if (order.status !== 'completed' || !invoice || invoice.returned || invoice.balance !== 0)
      throw new Error('الطلب غير قابل للاسترداد الكامل')
    const shift = this.commerce.shift(user),
      id = ulid(),
      at = Date.now()
    this.db
      .prepare('INSERT INTO returns VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(
        id,
        invoice.id,
        user.id,
        shift.id,
        at,
        invoice.total,
        invoice.total,
        d.method,
        d.clientTxnId,
        fingerprint(d),
        d.reason,
      )
    for (const line of this.commerce.lines(invoice.id))
      this.db
        .prepare('INSERT INTO return_lines VALUES(?,?,?,?,?,?)')
        .run(ulid(), id, line.id, line.qty, line.total, 0)
    if (d.method === 'cash')
      this.commerce.cash(user, shift.id, -invoice.total, 'restaurant.refund', d.reason, id)
    this.db
      .prepare(
        "UPDATE restaurant_orders SET status='refunded',version=version+1,updated_at=? WHERE id=?",
      )
      .run(at, order.id)
    this.event(user, order.id, 'restaurant.refund', d.reason)
    return this.getOrder(order.id)
  }
}
