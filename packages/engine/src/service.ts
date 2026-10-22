import { RealEstate } from './real-estate.js'
import { Hotel } from './hotel.js'
import { Salon } from './salon.js'
import { Gym } from './gym.js'
import { Education } from './education.js'
import { CRM } from './crm.js'
import { HR } from './hr.js'
import { Pharmacy } from './pharmacy.js'
import { Laboratory } from './laboratory.js'
import { Clinic } from './clinic.js'
import type { XzareDatabase, ProductKind } from '@xzare/db'
import { ServiceCenter } from './service-center.js'
import { Workshop } from './workshop.js'
import { Manufacturing } from './manufacturing.js'
import { Inventory, inventoryProductQuery } from './inventory.js'
import { Accounting } from './accounting.js'
import { Restaurant } from './restaurant.js'
import { Barcode, ScaleBarcodeCodec } from '@xzare/barcode'
import { CostBasis, Money, Quantity, lineTotal, ulid } from '@xzare/core'
import { Identity } from './identity.js'
import { Commerce, productQuery, invoiceQuery, sum, fingerprint } from './commerce.js'
import { schemas, validated } from './validation.js'
import type { AppState, Party, Product, Shift, User } from './types.js'

export class BusinessEngine {
  readonly realEstate: RealEstate | undefined
  readonly hotel: Hotel | undefined
  readonly salon: Salon | undefined
  readonly gym: Gym | undefined
  readonly education: Education | undefined
  readonly crm: CRM | undefined
  readonly hr: HR | undefined
  readonly pharmacy: Pharmacy | undefined
  readonly laboratory: Laboratory | undefined
  readonly clinic: Clinic | undefined
  readonly identity: Identity
  readonly commerce: Commerce
  readonly serviceCenter: ServiceCenter | undefined
  readonly workshop: Workshop | undefined
  readonly manufacturing: Manufacturing | undefined
  readonly inventory: Inventory | undefined
  readonly accounting: Accounting | undefined
  readonly restaurant: Restaurant | undefined
  constructor(
    readonly db: XzareDatabase,
    readonly product: ProductKind = 'pos',
  ) {
    this.inventory = undefined
    this.identity = new Identity(
      db,
      product === 'restaurant',
      undefined,
      product === 'clinic',
      product === 'laboratory',
      product === 'hr',
      product === 'crm',
      product === 'education',
      product === 'gym',
      product === 'salon',
    )
    this.realEstate = product === 'real-estate' ? new RealEstate(db, this.identity) : undefined
    this.hotel = product === 'hotel' ? new Hotel(db, this.identity) : undefined
    this.salon = product === 'salon' ? new Salon(db, this.identity) : undefined
    this.gym = product === 'gym' ? new Gym(db, this.identity) : undefined
    this.education = product === 'education' ? new Education(db, this.identity) : undefined
    this.crm = product === 'crm' ? new CRM(db, this.identity) : undefined
    this.hr = product === 'hr' ? new HR(db, this.identity) : undefined
    this.pharmacy = product === 'pharmacy' ? new Pharmacy(db, this.identity) : undefined
    this.laboratory = product === 'laboratory' ? new Laboratory(db, this.identity) : undefined
    this.clinic = product === 'clinic' ? new Clinic(db, this.identity) : undefined
    this.inventory =
      product === 'inventory' ||
      product === 'manufacturing' ||
      product === 'workshop' ||
      product === 'service-center'
        ? new Inventory(db, this.identity)
        : undefined
    this.serviceCenter =
      product === 'service-center'
        ? new ServiceCenter(db, this.identity, this.inventory!)
        : undefined
    this.workshop =
      product === 'workshop' ? new Workshop(db, this.identity, this.inventory!) : undefined
    this.manufacturing =
      product === 'manufacturing'
        ? new Manufacturing(db, this.identity, this.inventory!)
        : undefined
    this.accounting = product === 'accounting' ? new Accounting(db, this.identity) : undefined
    this.commerce = new Commerce(db, this.identity)
    this.restaurant =
      product === 'restaurant' ? new Restaurant(db, this.identity, this.commerce) : undefined
  }
  settings(): Record<string, string> {
    return Object.fromEntries(
      (
        this.db.prepare('SELECT key,value FROM settings').all() as {
          key: string
          value: string
        }[]
      ).map((r) => [r.key, r.value]),
    )
  }
  state(user: User): AppState {
    const manager = user.role !== 'cashier',
      admin = user.role === 'admin'
    const allowedSettings = new Set([
      'businessName',
      'phone',
      'address',
      'receiptFooter',
      'language',
      'currency',
      'taxBps',
      'scaleProfiles',
    ])
    const settings = Object.fromEntries(
      Object.entries(this.settings()).filter(([key]) => allowedSettings.has(key)),
    )
    const products = this.db
      .prepare(
        `${productQuery} ${this.product === 'restaurant' ? "WHERE v.id NOT IN(SELECT id FROM restaurant_menu) AND v.sku!='__XZARE_DELIVERY_FEE'" : ''} ORDER BY p.name,v.sku LIMIT 10000`,
      )
      .all() as Product[]
    const invoices = this.db
      .prepare(`${invoiceQuery} ${manager ? '' : "WHERE kind='sale'"} ORDER BY at DESC LIMIT 2000`)
      .all() as AppState['invoices']
    return {
      user,
      settings,
      products: products.map((p) => (manager ? p : { ...p, cost: 0 })),
      parties: this.db
        .prepare(
          `SELECT p.*,COALESCE((SELECT sum(amount) FROM party_ledger l WHERE l.party_id=p.id),0) AS balance FROM parties p ${manager ? '' : "WHERE kind='customer'"} ORDER BY p.name`,
        )
        .all() as Party[],
      invoices: invoices.map((i) => (manager ? i : { ...i, cost: 0 })),
      shift: (() => {
        try {
          return this.commerce.shift(user)
        } catch {
          return null
        }
      })(),
      shifts: this.db
        .prepare(
          `SELECT s.*,COALESCE(s.expected,s.opening+COALESCE((SELECT sum(amount) FROM cash_movements c WHERE c.shift_id=s.id),0)) AS expected FROM shifts s ${manager ? '' : 'WHERE user_id=?'} ORDER BY opened_at DESC LIMIT 200`,
        )
        .all(...(manager ? [] : [user.id])) as Shift[],
      cash: this.db
        .prepare(
          'SELECT c.* FROM cash_movements c JOIN shifts s ON s.id=c.shift_id WHERE s.user_id=? ORDER BY c.at DESC LIMIT 500',
        )
        .all(user.id) as AppState['cash'],
      holds: this.db
        .prepare('SELECT id,title,payload,at FROM holds WHERE user_id=? ORDER BY at DESC')
        .all(user.id) as AppState['holds'],
      users: admin
        ? (this.db
            .prepare('SELECT id,username,name,role,active FROM users ORDER BY name')
            .all() as User[])
        : [],
      audit: admin
        ? (this.db
            .prepare(
              'SELECT a.*,u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.at DESC LIMIT 300',
            )
            .all() as AppState['audit'])
        : [],
      movements: manager
        ? (this.db
            .prepare(
              'SELECT s.*,p.name FROM stock_movements s JOIN variants v ON v.id=s.variant_id JOIN products p ON p.id=v.product_id ORDER BY s.at DESC LIMIT 500',
            )
            .all() as AppState['movements'])
        : [],
    }
  }
  async call(action: string, payload: unknown, token: string | null = null): Promise<unknown> {
    if (action === 'auth.status')
      return {
        configured: !!this.db.prepare('SELECT id FROM users LIMIT 1').get(),
      }
    if (action === 'setup') return this.identity.setup(payload)
    if (action === 'login') return this.identity.login(payload)
    if (action === 'logout') return this.identity.logout(token)
    if (this.realEstate && action.startsWith('re.'))
      return this.realEstate.call(action, payload, this.identity.require(token))
    if (this.realEstate && !['password.change', 'user.save', 'settings.save'].includes(action))
      throw Error('العملية غير متاحة في المكتب العقاري')
    if (this.hotel && action.startsWith('hotel.'))
      return this.hotel.call(action, payload, this.identity.require(token))
    if (this.hotel && !['password.change', 'user.save', 'settings.save'].includes(action))
      throw Error('العملية غير متاحة في الفندق')
    if (this.salon && action.startsWith('sal.'))
      return this.salon.call(action, payload, this.identity.require(token))
    if (this.salon && !['password.change', 'user.save', 'settings.save'].includes(action))
      throw Error('العملية غير متاحة في الصالون')
    if (this.gym && action.startsWith('gym.'))
      return this.gym.call(action, payload, this.identity.require(token))
    if (this.gym && !['password.change', 'user.save', 'settings.save'].includes(action))
      throw new Error('العملية غير متاحة في الجيم')
    if (this.education && action.startsWith('edu.'))
      return this.education.call(action, payload, this.identity.require(token))
    if (this.education && !['password.change', 'user.save', 'settings.save'].includes(action))
      throw new Error('العملية غير متاحة في التعليم')
    if (this.crm && action.startsWith('crm.'))
      return this.crm.call(action, payload, this.identity.require(token))
    if (this.crm && !['password.change', 'user.save', 'settings.save'].includes(action))
      throw new Error('العملية غير متاحة في CRM')
    if (this.hr && action.startsWith('hr.'))
      return this.hr.call(action, payload, this.identity.require(token))
    if (this.hr && !['password.change', 'user.save', 'settings.save'].includes(action))
      throw new Error('العملية غير متاحة في الموارد البشرية')
    if (this.pharmacy && action.startsWith('pharmacy.'))
      return this.pharmacy.call(action, payload, this.identity.require(token))
    if (this.pharmacy && !['password.change', 'user.save', 'settings.save'].includes(action))
      throw new Error('العملية غير متاحة في الصيدلية')
    if (this.laboratory && action.startsWith('laboratory.'))
      return this.laboratory.call(action, payload, this.identity.require(token))
    if (this.laboratory && !['password.change', 'user.save', 'settings.save'].includes(action))
      throw new Error('العملية غير متاحة في المعمل')
    if (this.clinic && action.startsWith('clinic.'))
      return this.clinic.call(action, payload, this.identity.require(token))
    if (this.clinic && !['password.change', 'user.save', 'settings.save'].includes(action))
      throw new Error('العملية غير متاحة في العيادات')
    if (this.serviceCenter && action.startsWith('service-center.'))
      return this.serviceCenter.call(action, payload, this.identity.require(token))
    if (this.workshop && action.startsWith('workshop.'))
      return this.workshop.call(action, payload, this.identity.require(token))
    if (this.manufacturing && action.startsWith('manufacturing.'))
      return this.manufacturing.call(action, payload, this.identity.require(token))
    if (this.inventory && action.startsWith('inventory.'))
      return this.inventory.call(action, payload, this.identity.require(token))
    if (
      this.inventory &&
      ![
        'password.change',
        'user.save',
        'settings.save',
        'product.save',
        'product.archive',
        'product.barcodeCheck',
        'barcode.lookup',
      ].includes(action)
    )
      throw new Error('العملية غير متاحة في المخازن')
    if (this.accounting && action.startsWith('accounting.'))
      return this.accounting.call(action, payload, this.identity.require(token))
    if (
      this.accounting &&
      !['password.change', 'user.save', 'settings.save', 'state'].includes(action)
    )
      throw new Error('العملية غير متاحة في المحاسبة')
    if (action.startsWith('restaurant.')) {
      if (!this.restaurant) throw new Error('هذه العملية تخص برنامج المطاعم')
      return this.restaurant.call(action, payload, this.identity.require(token, 'kitchen'))
    }
    const minimum =
      action.startsWith('user.') || action.startsWith('settings.')
        ? 'admin'
        : action.startsWith('stock.') ||
            action.startsWith('product.') ||
            action === 'invoice.return' ||
            action === 'expense.add' ||
            action === 'cash.add' ||
            action === 'report.get'
          ? 'manager'
          : action === 'password.change' && this.restaurant
            ? 'kitchen'
            : 'cashier'
    const user = this.identity.require(token, minimum)
    if (this.restaurant) {
      const data = payload as {
        id?: string
        variantId?: string
        kind?: string
        lines?: { variantId: string }[]
      }
      if ((action === 'invoice.post' && data.kind === 'sale') || action.startsWith('hold.'))
        throw new Error('البيع في المطعم يتم من الطلب بعد التحضير')
      const targets = action.startsWith('product.')
        ? [data.id]
        : action === 'stock.adjust'
          ? [data.variantId]
          : action === 'invoice.post'
            ? (data.lines?.map((line) => line.variantId) ?? [])
            : []
      if (
        targets.some(
          (id) =>
            id &&
            this.db
              .prepare(
                "SELECT id FROM variants WHERE id=? AND (id IN(SELECT id FROM restaurant_menu) OR sku='__XZARE_DELIVERY_FEE')",
              )
              .get(id),
        )
      )
        throw new Error('صنف القائمة ليس خامة؛ عدّله من قائمة المطعم')
    }
    if (action === 'state') return this.state(user)
    if (action === 'product.barcodeCheck') {
      const { code } = validated(schemas['barcode.lookup'], payload)
      if (!Barcode.parse(code, 'CODE128').ok) throw new Error('الباركود غير صالح')
      const product = this.db
        .prepare(
          `${this.inventory ? inventoryProductQuery : productQuery} WHERE v.id=(SELECT variant_id FROM barcodes WHERE code=?)`,
        )
        .get(code) as Product | undefined
      return { product: product ?? null }
    }
    if (action === 'user.save') return this.identity.saveUser(token, payload)
    if (action === 'password.change') return this.identity.changePassword(token, payload)
    if (action === 'invoice.post' || action === 'invoice.pay') {
      const invoice =
        action === 'invoice.post'
          ? this.commerce.post(user, payload)
          : this.commerce.pay(user, payload)
      return user.role === 'cashier' ? { ...invoice, cost: 0 } : invoice
    }
    if (action === 'invoice.return') {
      if (
        this.restaurant &&
        this.db
          .prepare('SELECT id FROM restaurant_orders WHERE invoice_id=?')
          .get((payload as { invoiceId?: string })?.invoiceId ?? '')
      )
        throw new Error('استرداد طلب المطعم يتم من الطلب؛ لا تُعاد الخامات المحضّرة للمخزون')
      return this.commerce.returnInvoice(user, payload)
    }
    if (action === 'invoice.get') {
      const data = validated(schemas['invoice.get'], payload),
        inv = this.commerce.invoice(data.id)
      if (inv.kind === 'purchase' && user.role === 'cashier')
        throw new Error('ليس لديك صلاحية عرض المشتريات')
      const lines = this.commerce.lines(inv.id)
      return {
        invoice: user.role === 'cashier' ? { ...inv, cost: 0 } : inv,
        lines: lines.map((l) => (user.role === 'cashier' ? { ...l, cost: 0 } : l)),
        payments: this.db
          .prepare('SELECT method,amount,at FROM payments WHERE invoice_id=?')
          .all(inv.id),
        returns: this.db
          .prepare('SELECT id,at,total,refunded,note FROM returns WHERE invoice_id=?')
          .all(inv.id),
      }
    }
    if (action === 'barcode.lookup') {
      const data = validated(schemas['barcode.lookup'], payload)
      let code = data.code,
        quantity = 1000
      const profiles = JSON.parse(this.settings().scaleProfiles ?? '[]') as {
        prefix: string
      }[]
      if (profiles.some((p) => code.startsWith(p.prefix))) {
        const engine = ScaleBarcodeCodec.create(profiles)
        if (!engine.ok) throw new Error('راجع إعدادات باركود الميزان')
        const reading = engine.value.decode(code)
        if (!reading.ok) throw new Error('باركود الميزان غير صالح')
        if (reading.value.kind !== 'weight')
          throw new Error('قراءة إجمالي السعر غير مفعلة في البيع؛ استخدم ملف الوزن')
        code = reading.value.productCode
        quantity = reading.value.quantity
      }
      const b = this.db.prepare('SELECT * FROM barcodes WHERE code=?').get(code) as
        { format: string; variant_id: string } | undefined
      if (!b || !Barcode.parse(code, b.format).ok)
        throw new Error('الباركود غير مسجل؛ أضف الصنف من شاشة الأصناف')
      const product = this.db
        .prepare(
          `${this.inventory ? inventoryProductQuery : productQuery} WHERE v.id=? AND p.active=1`,
        )
        .get(b.variant_id) as Product | undefined
      if (!product) throw new Error('الصنف متوقف')
      return {
        product: user.role === 'cashier' ? { ...product, cost: 0 } : product,
        quantity,
      }
    }
    // All synchronous write commands below share one transaction, including their audit entry.
    const execute = () => {
      if (action === 'product.save') {
        const data = validated(schemas['product.save'], payload)
        if (data.barcode && !Barcode.parse(data.barcode, data.format).ok)
          throw new Error('الباركود لا يوافق الصيغة المختارة أو رقم المراجعة')
        if (data.barcode) {
          const owner = this.db
            .prepare('SELECT variant_id FROM barcodes WHERE code=?')
            .get(data.barcode) as { variant_id: string } | undefined
          if (owner && owner.variant_id !== data.id)
            throw new Error('الباركود مسجل لصنف آخر؛ افتح الصنف الموجود بدل إنشاء نسخة مكررة')
        }
        const previous = data.id
          ? (this.db.prepare('SELECT product_id,unit FROM variants WHERE id=?').get(data.id) as
              { product_id: string; unit: string } | undefined)
          : undefined
        if (data.id && !previous) throw new Error('الصنف غير موجود')
        if (
          this.serviceCenter &&
          previous &&
          previous.unit !== data.unit &&
          this.db
            .prepare(
              'SELECT 1 FROM service_center_estimate_lines WHERE variant_id=? UNION ALL SELECT 1 FROM inventory_lots WHERE variant_id=? LIMIT 1',
            )
            .get(data.id, data.id)
        )
          throw new Error('وحدة القطعة مستخدمة في عرض سعر أو مخزون؛ أنشئ صنفًا مستقلًا')
        if (
          this.workshop &&
          previous &&
          previous.unit !== data.unit &&
          this.db
            .prepare(
              'SELECT 1 FROM workshop_estimate_lines WHERE variant_id=? UNION ALL SELECT 1 FROM inventory_lots WHERE variant_id=? LIMIT 1',
            )
            .get(data.id, data.id)
        )
          throw new Error('وحدة القطعة مستخدمة في عرض سعر أو مخزون؛ أنشئ صنفًا مستقلًا')
        if (
          this.manufacturing &&
          previous &&
          previous.unit !== data.unit &&
          this.db
            .prepare(
              `SELECT 1 FROM manufacturing_boms WHERE output_variant_id=? UNION ALL SELECT 1 FROM manufacturing_bom_lines WHERE variant_id=? UNION ALL SELECT 1 FROM inventory_lots WHERE variant_id=? LIMIT 1`,
            )
            .get(data.id, data.id, data.id)
        )
          throw new Error(
            'لا يمكن تغيير وحدة صنف استُخدم في قائمة خامات أو حركة مخزون؛ أنشئ صنفًا بوحدة جديدة',
          )
        const pid = previous?.product_id ?? ulid(),
          id = data.id ?? ulid()
        if (previous) {
          this.db
            .prepare('UPDATE products SET name=?,category=?,active=? WHERE id=?')
            .run(data.name, data.category, Number(data.active), pid)
          this.db
            .prepare('UPDATE variants SET sku=?,unit=?,price=?,reorder_qty=? WHERE id=?')
            .run(data.sku, data.unit, data.price, data.reorderQty, id)
        } else {
          this.db
            .prepare('INSERT INTO products VALUES(?,?,?,?)')
            .run(pid, data.name, data.category, 1)
          this.db
            .prepare(
              'INSERT INTO variants(id,product_id,sku,unit,price,reorder_qty) VALUES(?,?,?,?,?,?)',
            )
            .run(id, pid, data.sku, data.unit, data.price, data.reorderQty)
        }
        this.db.prepare('DELETE FROM barcodes WHERE variant_id=?').run(id)
        if (data.barcode)
          this.db.prepare('INSERT INTO barcodes VALUES(?,?,?)').run(data.barcode, data.format, id)
        this.identity.audit(user.id, action, id)
        return { id }
      }
      if (action === 'product.archive') {
        const d = validated(schemas['product.archive'], payload)
        const p = this.db.prepare('SELECT product_id FROM variants WHERE id=?').get(d.id) as
          { product_id: string } | undefined
        if (!p) throw new Error('الصنف غير موجود')
        this.db.prepare('UPDATE products SET active=0 WHERE id=?').run(p.product_id)
        this.identity.audit(user.id, action, d.id)
        return { id: d.id }
      }
      if (action === 'party.save') {
        const d = validated(schemas['party.save'], payload)
        if (d.kind === 'supplier' && user.role === 'cashier')
          throw new Error('ليس لديك صلاحية إدارة الموردين')
        const id = d.id ?? ulid()
        if (d.id) {
          const p = this.db.prepare('SELECT kind FROM parties WHERE id=?').get(id) as
            { kind: string } | undefined
          if (!p || p.kind !== d.kind) throw new Error('لا يمكن تغيير نوع الطرف المالي')
          this.db
            .prepare('UPDATE parties SET name=?,phone=?,address=? WHERE id=?')
            .run(d.name, d.phone, d.address, id)
        } else
          this.db
            .prepare('INSERT INTO parties(id,kind,name,phone,address) VALUES(?,?,?,?,?)')
            .run(id, d.kind, d.name, d.phone, d.address)
        this.identity.audit(user.id, action, id)
        return { id }
      }
      if (action === 'stock.adjust') {
        const d = validated(schemas['stock.adjust'], payload),
          p = this.db
            .prepare(`${this.inventory ? inventoryProductQuery : productQuery} WHERE v.id=?`)
            .get(d.variantId) as Product | undefined
        if (!p) throw new Error('الصنف غير موجود')
        const cost =
          d.quantity > 0
            ? lineTotal(Money.fromPiastres(d.unitCost), Quantity.fromMilliUnits(d.quantity))
            : -CostBasis.create(Money.fromPiastres(p.cost), Quantity.fromMilliUnits(p.qty)).take(
                Quantity.fromMilliUnits(-d.quantity),
              ).cost
        this.commerce.move(user, p.id, d.quantity, cost, 'adjustment', ulid(), d.reason)
        this.identity.audit(user.id, action, p.id)
        return { id: p.id }
      }
      if (action === 'shift.open') {
        const d = validated(schemas['shift.open'], payload)
        if (
          this.db
            .prepare('SELECT id FROM shifts WHERE user_id=? AND closed_at IS NULL')
            .get(user.id)
        )
          throw new Error('لديك وردية مفتوحة بالفعل')
        const id = ulid()
        this.db
          .prepare('INSERT INTO shifts(id,user_id,opened_at,opening) VALUES(?,?,?,?)')
          .run(id, user.id, Date.now(), d.opening)
        this.identity.audit(user.id, action, id)
        return this.commerce.shift(user)
      }
      if (action === 'shift.close') {
        const d = validated(schemas['shift.close'], payload),
          s = this.commerce.shift(user)
        this.db
          .prepare('UPDATE shifts SET closed_at=?,actual=?,expected=? WHERE id=?')
          .run(Date.now(), d.actual, s.expected, s.id)
        this.identity.audit(user.id, action, s.id)
        return {
          id: s.id,
          expected: s.expected,
          actual: d.actual,
          variance: d.actual - s.expected,
        }
      }
      if (action === 'cash.add' || action === 'expense.add') {
        const s = this.commerce.shift(user),
          id = ulid()
        if (action === 'expense.add') {
          const d = validated(schemas['expense.add'], payload)
          this.db
            .prepare('INSERT INTO expenses VALUES(?,?,?,?,?,?,?)')
            .run(id, s.id, user.id, d.amount, d.category, d.note, Date.now())
          this.commerce.cash(
            user,
            s.id,
            -d.amount,
            'expense',
            d.category + (d.note ? ' · ' + d.note : ''),
            id,
          )
        } else {
          const d = validated(schemas['cash.add'], payload)
          this.commerce.cash(
            user,
            s.id,
            d.amount,
            d.amount > 0 ? 'cash_in' : 'cash_out',
            d.note,
            id,
          )
        }
        this.identity.audit(user.id, action, id)
        return { id }
      }
      if (action === 'hold.save') {
        const d = validated(schemas['hold.save'], payload),
          id = ulid()
        this.db
          .prepare('INSERT INTO holds VALUES(?,?,?,?,?)')
          .run(id, user.id, d.title, JSON.stringify(d.cart), Date.now())
        this.identity.audit(user.id, action, id)
        return { id }
      }
      if (action === 'hold.remove') {
        const d = validated(schemas['hold.remove'], payload)
        if (
          !this.db.prepare('DELETE FROM holds WHERE id=? AND user_id=?').run(d.id, user.id).changes
        )
          throw new Error('الفاتورة المعلقة غير موجودة')
        this.identity.audit(user.id, action, d.id)
        return { id: d.id }
      }
      if (action === 'settings.save') {
        const d = validated(schemas['settings.save'], payload)
        if (d.scaleProfiles !== undefined) {
          let profiles: unknown
          try {
            profiles = JSON.parse(d.scaleProfiles)
          } catch {
            throw new Error('راجع إعدادات باركود الميزان')
          }
          if (
            !Array.isArray(profiles) ||
            (profiles.length > 0 &&
              (!ScaleBarcodeCodec.create(profiles).ok || profiles.some((p) => p.kind !== 'weight')))
          )
            throw new Error('إعدادات الميزان يجب أن تكون ملف وزن صحيحًا')
        }
        for (const [key, value] of Object.entries(d))
          this.db
            .prepare(
              'INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
            )
            .run(key, String(value))
        this.identity.audit(user.id, action, 'store')
        return { saved: true }
      }
      if (action === 'stock.reconcile') {
        return this.db
          .prepare(
            'SELECT s.* FROM stock_levels s WHERE s.qty!=COALESCE((SELECT sum(m.qty) FROM stock_movements m WHERE m.variant_id=s.variant_id AND m.warehouse_id=s.warehouse_id),0) OR s.cost!=COALESCE((SELECT sum(m.cost) FROM stock_movements m WHERE m.variant_id=s.variant_id AND m.warehouse_id=s.warehouse_id),0)',
          )
          .all()
      }
      if (action === 'report.get') {
        const d = payload as { from: number; to: number }
        if (
          !d ||
          !Number.isSafeInteger(d.from) ||
          !Number.isSafeInteger(d.to) ||
          d.from < 0 ||
          d.to <= d.from
        )
          throw new Error('راجع فترة التقرير')
        const sales = this.db
          .prepare(
            "SELECT COALESCE(sum(total),0) AS total,count(*) AS count FROM invoices WHERE kind='sale' AND at>=? AND at<?",
          )
          .get(d.from, d.to) as { total: number; count: number }
        const returns = this.db
          .prepare(
            "SELECT COALESCE(sum(r.total),0) AS total FROM returns r JOIN invoices i ON i.id=r.invoice_id WHERE i.kind='sale' AND r.at>=? AND r.at<?",
          )
          .get(d.from, d.to) as { total: number }
        const cost = this.db
          .prepare(
            "SELECT COALESCE(sum(l.cost),0) AS total FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id WHERE i.kind='sale' AND i.at>=? AND i.at<?",
          )
          .get(d.from, d.to) as { total: number }
        const returnedCost = this.db
          .prepare(
            "SELECT COALESCE(sum(l.cost),0) AS total FROM return_lines l JOIN returns r ON r.id=l.return_id JOIN invoices i ON i.id=r.invoice_id WHERE i.kind='sale' AND r.at>=? AND r.at<?",
          )
          .get(d.from, d.to) as { total: number }
        const expenses = this.db
          .prepare('SELECT COALESCE(sum(amount),0) AS total FROM expenses WHERE at>=? AND at<?')
          .get(d.from, d.to) as { total: number }
        const inventory = this.db
          .prepare('SELECT COALESCE(sum(cost),0) AS value FROM stock_levels')
          .get() as { value: number }
        const waste = this.restaurant
          ? (
              this.db
                .prepare(
                  'SELECT COALESCE(sum(cost),0) AS total FROM restaurant_waste WHERE at>=? AND at<?',
                )
                .get(d.from, d.to) as { total: number }
            ).total
          : 0
        return {
          sales: sales.total,
          count: sales.count,
          returns: returns.total,
          netSales: sales.total - returns.total,
          cost: cost.total - returnedCost.total,
          grossProfit: sum([sales.total, -returns.total, -cost.total, returnedCost.total]),
          expenses: expenses.total,
          inventory: inventory.value,
          ...(this.restaurant
            ? {
                waste,
                netProfit: sum([
                  sales.total,
                  -returns.total,
                  -cost.total,
                  returnedCost.total,
                  -expenses.total,
                  -waste,
                ]),
              }
            : {}),
        }
      }
      throw new Error('العملية غير متاحة')
    }
    return this.db.transaction(() => {
      if (action === 'stock.adjust' || action === 'cash.add' || action === 'expense.add') {
        const data = validated<{ clientTxnId: string }>(schemas[action], payload)
        const requestHash = fingerprint(data)
        const previous = this.db
          .prepare('SELECT * FROM commands WHERE client_txn_id=?')
          .get(data.clientTxnId) as
          | {
              action: string
              user_id: string
              request_hash: string
              result: string
            }
          | undefined
        if (previous) {
          if (
            previous.action !== action ||
            previous.user_id !== user.id ||
            previous.request_hash !== requestHash
          )
            throw new Error('معرّف العملية مستخدم لبيانات مختلفة')
          return JSON.parse(previous.result) as unknown
        }
        const result = execute()
        this.db
          .prepare('INSERT INTO commands VALUES(?,?,?,?,?)')
          .run(data.clientTxnId, action, user.id, requestHash, JSON.stringify(result))
        return result
      }
      return execute()
    })()
  }
}
