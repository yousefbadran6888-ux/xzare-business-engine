import { ulid } from '@xzare/core'
import type { XzareDatabase } from '@xzare/db'
import { Identity } from './identity.js'
import { fingerprint } from './commerce.js'
import { clinicToday, clinicDayBounds } from './clinic-time.js'
import {
  salonSchemas,
  type SalonState,
  type SalonReport,
  type SalonCommissions,
} from './salon-validation.js'
import type { User } from './types.js'
const management = (u: User) => ['admin', 'manager'].includes(u.role),
  office = (u: User) => u.role !== 'stylist'
const cq =
    'SELECT id,code,name,phone,note,active,at,version FROM sal_customers',
  sq =
    'SELECT id,code,name,category,duration,fee,active,at,version FROM sal_services',
  tq =
    'SELECT id,code,name,phone,note,user_id AS userId,commission_bps AS commissionBps,active,at,version FROM sal_staff',
  pq =
    'SELECT p.id,p.code,p.name,p.service_id AS serviceId,s.name AS serviceName,p.credits,p.days,p.fee,p.description,p.active,p.at,p.version FROM sal_plans p JOIN sal_services s ON s.id=p.service_id'
const bq = `SELECT b.id,b.customer_id AS customerId,json_extract(b.customer_json,'$.name') AS customerName,json_extract(b.customer_json,'$.code') AS customerCode,b.service_id AS serviceId,json_extract(b.service_json,'$.name') AS serviceName,b.staff_id AS staffId,json_extract(b.staff_json,'$.name') AS staffName,json_extract(b.staff_json,'$.commissionBps') AS rateBps,b.day,b.start_minute AS startMinute,b.duration,b.fee,b.discount,b.package_id AS packageId,b.note,b.status,b.at,b.version FROM sal_bookings b`
const iq = `SELECT i.id,i.kind,i.source_id AS sourceId,i.number,i.customer_id AS customerId,i.status,i.at,i.version,x.total,x.customer_json AS customer,x.item_json AS item,x.business_json AS business,COALESCE((SELECT sum(l.amount) FROM sal_ledger l WHERE l.invoice_id=i.id),0) AS balance FROM sal_invoices i JOIN sal_invoice_snapshots x ON x.id=i.id`
const usedFilter = `NOT EXISTS(SELECT 1 FROM sal_completions c JOIN sal_completion_voids v ON v.completion_id=c.id WHERE c.booking_id=u.booking_id)`
const packq = `SELECT p.id,p.customer_id AS customerId,json_extract(p.customer_json,'$.name') AS customerName,json_extract(p.customer_json,'$.code') AS customerCode,p.plan_id AS planId,json_extract(p.plan_json,'$.name') AS planName,p.service_id AS serviceId,json_extract(p.plan_json,'$.serviceName') AS serviceName,p.start_day AS startDay,p.end_day AS endDay,p.credits,p.net,p.invoice_id AS invoiceId,p.status,p.at,p.version,(SELECT count(*) FROM sal_package_uses u WHERE u.package_id=p.id AND ${usedFilter}) AS used,(SELECT count(*) FROM sal_bookings b WHERE b.package_id=p.id AND b.status IN('booked','arrived')) AS reserved,COALESCE((SELECT sum(l.amount) FROM sal_ledger l WHERE l.invoice_id=p.invoice_id),0) AS balance FROM sal_packages p`
const receiptq = `SELECT p.id,p.number,p.invoice_id AS invoiceId,p.amount,p.method,p.reference,p.customer_json AS customer,p.item_json AS item,p.business_json AS business,p.actor_name AS actorName,p.at,(SELECT v.reason FROM sal_payment_voids v WHERE v.payment_id=p.id) AS voidReason FROM sal_payments p`
const completionq = `SELECT c.id,c.invoice_id AS invoiceId,c.staff_id AS staffId,c.basis,c.rate_bps AS rateBps,c.commission,c.package_index AS packageIndex,c.actor_name AS actorName,c.at,(SELECT v.reason FROM sal_completion_voids v WHERE v.completion_id=c.id) AS voidReason FROM sal_completions c`
const addDay = (s: string, n: number) =>
  new Date(Date.parse(s + 'T12:00:00Z') + n * 86400000)
    .toISOString()
    .slice(0, 10)
const safe = (n: number) => {
  if (!Number.isSafeInteger(n) || Math.abs(n) > 1e12)
    throw Error('المبلغ تجاوز الحد الآمن')
  return n
}
const aggregate = (n: number) => {
  if (!Number.isSafeInteger(n)) throw Error('الإجمالي تجاوز الحد الحسابي الآمن')
  return n
}
const minuteNow = () => {
  const d = new Date()
  return d.getHours() * 60 + d.getMinutes()
}
export class Salon {
  constructor(
    readonly db: XzareDatabase,
    readonly identity: Identity,
  ) {}
  private row<T = any>(sql: string, ...a: any[]): T {
    return this.db.prepare(sql).get(...a) as T
  }
  private rows<T = any>(sql: string, ...a: any[]): T[] {
    return this.db.prepare(sql).all(...a) as T[]
  }
  private manage(u: User) {
    if (!management(u)) throw Error('هذه العملية تحتاج مدير الصالون')
  }
  private office(u: User) {
    if (!office(u)) throw Error('هذه العملية تخص الاستقبال والتحصيل')
  }
  private version(x: any, v: unknown) {
    if (x && x.version !== v)
      throw Error('البيانات تغيرت؛ حدّث العرض وأعد المحاولة')
    if (!x && v !== undefined) throw Error('الإصدار يخص التعديل')
  }
  private own(u: User) {
    return this.row(tq + ' WHERE user_id=? AND active=1', u.id)
  }
  private customer(id: string, u: User) {
    const c = this.row(cq + ' WHERE id=?', id)
    if (!c) throw Error('العميل غير موجود')
    if (
      !office(u) &&
      !this.row(
        'SELECT b.id FROM sal_bookings b JOIN sal_staff t ON t.id=b.staff_id WHERE b.customer_id=? AND t.user_id=? AND t.active=1',
        id,
        u.id,
      )
    )
      throw Error('العميل خارج تكليفك')
    return office(u)
      ? c
      : {
          id: c.id,
          code: c.code,
          name: c.name,
          active: c.active,
          at: c.at,
          version: c.version,
        }
  }
  private employee(id: string) {
    const t = this.row(tq + ' WHERE id=?', id)
    if (!t || !t.active) throw Error('اختر موظفًا نشطًا')
    return t
  }
  private booking(id: string, u: User) {
    const b = this.row(bq + ' WHERE b.id=?', id)
    if (!b) throw Error('الحجز غير موجود')
    if (!office(u) && this.own(u)?.id !== b.staffId)
      throw Error('الحجز خارج تكليفك')
    return b
  }
  private bookingView(b: any, u: User) {
    if (office(u)) return b
    const { fee, discount, rateBps, ...s } = b
    return { ...s, packageId: null, note: '' }
  }
  private invoice(id: string, u: User) {
    this.office(u)
    const i = this.row(iq + ' WHERE i.id=?', id)
    if (!i) throw Error('الفاتورة غير موجودة')
    safe(i.balance)
    return {
      ...i,
      customer: JSON.parse(i.customer),
      item: JSON.parse(i.item),
      business: JSON.parse(i.business),
    }
  }
  private invoices(where = '', ...a: any[]) {
    return this.rows(iq + where, ...a).map((i) => ({
      ...i,
      balance: safe(i.balance),
      customer: JSON.parse(i.customer),
      item: JSON.parse(i.item),
      business: JSON.parse(i.business),
    }))
  }
  private package(id: string, u: User) {
    this.office(u)
    return this.packageData(id)
  }
  private packageData(id: string) {
    const p = this.row(packq + ' WHERE p.id=?', id)
    if (!p) throw Error('الباقة غير موجودة')
    safe(p.balance)
    return p
  }
  private payments(where = '', ...a: any[]) {
    return this.rows(receiptq + where, ...a).map((p) => ({
      ...p,
      customer: JSON.parse(p.customer),
      item: JSON.parse(p.item),
      business: JSON.parse(p.business),
    }))
  }
  private bump(
    table: 'sal_bookings' | 'sal_packages' | 'sal_invoices',
    id: string,
  ) {
    this.db
      .prepare('UPDATE ' + table + ' SET version=version+1 WHERE id=?')
      .run(id)
  }
  private packBump(id: string | null) {
    if (id) this.bump('sal_packages', id)
  }
  private business() {
    return Object.fromEntries(
      this.rows<{ key: string; value: string }>(
        'SELECT key,value FROM settings',
      )
        .filter((s) =>
          [
            'businessName',
            'phone',
            'address',
            'receiptFooter',
            'currency',
          ].includes(s.key),
        )
        .map((s) => [s.key, s.value]),
    )
  }
  private number(
    table: 'sal_invoices' | 'sal_payments' | 'sal_payouts',
    prefix: string,
  ) {
    return (
      prefix +
      String(
        this.row<{ n: number }>('SELECT count(*)+1 n FROM ' + table).n,
      ).padStart(6, '0')
    )
  }
  private ledger(
    invoiceId: string,
    kind: string,
    amount: number,
    ref: string | null,
    reason: string,
    u: User,
  ) {
    this.db
      .prepare('INSERT INTO sal_ledger VALUES(?,?,?,?,?,?,?,?,?)')
      .run(
        ulid(),
        invoiceId,
        kind,
        safe(amount),
        ref,
        reason,
        u.id,
        u.name,
        Date.now(),
      )
    aggregate(
      this.row<{ n: number }>(
        'SELECT COALESCE(sum(amount),0) n FROM sal_ledger',
      ).n,
    )
  }
  private commission(
    staffId: string,
    kind: string,
    amount: number,
    ref: string,
    reason: string,
    u: User,
  ) {
    this.db
      .prepare('INSERT INTO sal_commission_ledger VALUES(?,?,?,?,?,?,?,?,?)')
      .run(
        ulid(),
        staffId,
        kind,
        safe(amount),
        ref,
        reason,
        u.id,
        u.name,
        Date.now(),
      )
    this.due(staffId)
    for (const group of ["'earned','reverse'", "'payout','payout-void'"])
      aggregate(
        this.row<{ n: number }>(
          `SELECT COALESCE(sum(amount),0) n FROM sal_commission_ledger WHERE staff_id=? AND kind IN(${group})`,
          staffId,
        ).n,
      )
  }
  private due(staffId: string) {
    return aggregate(
      this.row<{ n: number }>(
        'SELECT COALESCE(sum(amount),0) n FROM sal_commission_ledger WHERE staff_id=?',
        staffId,
      ).n,
    )
  }
  private event(
    type: string,
    id: string,
    action: string,
    reason: string,
    snapshot: unknown,
    u: User,
  ) {
    this.db
      .prepare('INSERT INTO sal_events VALUES(?,?,?,?,?,?,?,?,?)')
      .run(
        ulid(),
        type,
        id,
        action,
        reason,
        JSON.stringify(snapshot),
        u.id,
        u.name,
        Date.now(),
      )
  }
  private events(type: string, id: string, u: User) {
    return office(u)
      ? this.rows(
          'SELECT id,action,reason,snapshot,actor_name AS actorName,at FROM sal_events WHERE entity_type=? AND entity_id=? ORDER BY at DESC,id DESC LIMIT1000'.replace(
            'LIMIT1000',
            'LIMIT 1000',
          ),
          type,
          id,
        )
      : []
  }
  state(u: User): SalonState {
    const own = this.own(u)
    const bookings = this.rows(
      bq + ' ORDER BY b.day DESC,b.start_minute,b.id',
    ).filter((b) => office(u) || b.staffId === own?.id)
    const customerIds = new Set(bookings.map((b) => b.customerId)),
      serviceIds = new Set(bookings.map((b) => b.serviceId))
    return {
      user: u,
      settings: { ...this.business(), language: 'ar' },
      customers: this.rows(cq + ' ORDER BY name')
        .filter((c) => office(u) || customerIds.has(c.id))
        .map((c) =>
          office(u)
            ? c
            : {
                id: c.id,
                code: c.code,
                name: c.name,
                active: c.active,
                at: c.at,
                version: c.version,
              },
        ),
      services: this.rows(sq + ' ORDER BY category,name')
        .filter((s) => office(u) || serviceIds.has(s.id))
        .map((s) =>
          office(u)
            ? s
            : {
                id: s.id,
                code: s.code,
                name: s.name,
                category: s.category,
                duration: s.duration,
                active: s.active,
                at: s.at,
                version: s.version,
              },
        ),
      staff: this.rows(tq + ' ORDER BY name')
        .filter((t) => office(u) || t.id === own?.id)
        .map((t) =>
          office(u)
            ? t
            : {
                id: t.id,
                code: t.code,
                name: t.name,
                userId: t.userId,
                commissionBps: t.commissionBps,
                active: t.active,
                at: t.at,
                version: t.version,
              },
        ),
      plans: office(u) ? this.rows(pq + ' ORDER BY p.name') : [],
      bookings: bookings.map((b) => this.bookingView(b, u)),
      packages: office(u) ? this.rows(packq + ' ORDER BY p.at DESC') : [],
      invoices: office(u)
        ? this.invoices(' ORDER BY i.at DESC,i.number DESC')
        : [],
      payments: office(u)
        ? this.payments(' ORDER BY p.at DESC,p.number DESC LIMIT 1000')
        : [],
      users:
        u.role === 'admin'
          ? this.rows(
              'SELECT id,username,name,role,active FROM users ORDER BY name',
            )
          : [],
      staffAccounts: management(u)
        ? this.rows(
            `SELECT id,username,name,role,active FROM users WHERE role='stylist' ORDER BY name`,
          )
        : [],
      audit: management(u)
        ? this.rows(
            'SELECT a.id,a.action,a.entity_id AS entityId,u.name AS user,a.at FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.at DESC LIMIT 500',
          )
        : [],
    }
  }
  private get(action: string, id: string, u: User): unknown {
    if (action === 'sal.customer.get') {
      const c = this.customer(id, u),
        s = this.state(u)
      return {
        customer: c,
        bookings: s.bookings.filter((b) => b.customerId === id),
        packages: office(u)
          ? s.packages.filter((p) => p.customerId === id)
          : [],
        invoices: office(u)
          ? s.invoices.filter((i) => i.customerId === id)
          : [],
        events: this.events('customer', id, u),
      }
    }
    if (action === 'sal.booking.get') {
      const b = this.booking(id, u),
        c = this.row(completionq + ' WHERE c.booking_id=?', id)
      return {
        booking: this.bookingView(b, u),
        completion: office(u)
          ? (c ?? null)
          : c
            ? {
                id: c.id,
                invoiceId: '',
                staffId: c.staffId,
                basis: 0,
                rateBps: c.rateBps,
                commission: c.commission,
                packageIndex: null,
                actorName: '',
                at: c.at,
                voidReason: c.voidReason ? 'تم تصحيح النتيجة' : null,
              }
            : null,
        invoice: office(u) && c ? this.invoice(c.invoiceId, u) : null,
        events: this.events('booking', id, u),
      }
    }
    if (action === 'sal.package.get') {
      const p = this.package(id, u)
      return {
        package: p,
        bookings: this.rows(
          bq + ' WHERE b.package_id=? ORDER BY b.day,b.start_minute',
          id,
        ),
        uses: this.rows(
          `SELECT u.id,u.booking_id AS bookingId,u.credit_index AS creditIndex,u.basis,u.at,(SELECT v.reason FROM sal_completions c JOIN sal_completion_voids v ON v.completion_id=c.id WHERE c.booking_id=u.booking_id) AS voidReason FROM sal_package_uses u WHERE u.package_id=? ORDER BY u.at,u.id`,
          id,
        ),
        invoice: this.invoice(p.invoiceId, u),
        events: this.events('package', id, u),
      }
    }
    const i = this.invoice(id, u)
    return {
      invoice: i,
      payments: this.payments(' WHERE p.invoice_id=? ORDER BY p.at DESC', id),
      ledger: this.rows(
        'SELECT id,kind,amount,reason,actor_name AS actorName,at FROM sal_ledger WHERE invoice_id=? ORDER BY at,id',
        id,
      ),
      events: this.events('invoice', id, u),
    }
  }
  private saveCustomer(d: any, u: User) {
    this.office(u)
    const old = d.id ? this.customer(d.id, u) : undefined
    this.version(old, d.version)
    if (
      old &&
      old.code !== d.code &&
      (this.row(
        'SELECT id FROM sal_bookings WHERE customer_id=? LIMIT 1',
        old.id,
      ) ||
        this.row(
          'SELECT id FROM sal_packages WHERE customer_id=? LIMIT 1',
          old.id,
        ))
    )
      throw Error('كود العميل ثابت بعد الحجز أو بيع باقة')
    if (
      old &&
      !d.active &&
      this.row(
        `SELECT id FROM sal_bookings WHERE customer_id=? AND status IN('booked','arrived') LIMIT 1`,
        old.id,
      )
    )
      throw Error('عالج الحجوزات القائمة قبل تعطيل العميل')
    const id = d.id ?? ulid()
    this.db
      .prepare(
        'INSERT INTO sal_customers VALUES(?,?,?,?,?,?,?,0) ON CONFLICT(id) DO UPDATE SET code=excluded.code,name=excluded.name,phone=excluded.phone,note=excluded.note,active=excluded.active,version=sal_customers.version+1',
      )
      .run(id, d.code, d.name, d.phone, d.note, +d.active, Date.now())
    return id
  }
  private saveService(d: any, u: User) {
    this.manage(u)
    const old = d.id ? this.row(sq + ' WHERE id=?', d.id) : undefined
    if (d.id && !old) throw Error('الخدمة غير موجودة')
    this.version(old, d.version)
    const id = d.id ?? ulid()
    this.db
      .prepare(
        'INSERT INTO sal_services VALUES(?,?,?,?,?,?,?,?,0) ON CONFLICT(id) DO UPDATE SET code=excluded.code,name=excluded.name,category=excluded.category,duration=excluded.duration,fee=excluded.fee,active=excluded.active,version=sal_services.version+1',
      )
      .run(
        id,
        d.code,
        d.name,
        d.category,
        d.duration,
        d.fee,
        +d.active,
        Date.now(),
      )
    return id
  }
  private saveStaff(d: any, u: User) {
    this.manage(u)
    const old = d.id ? this.row(tq + ' WHERE id=?', d.id) : undefined
    if (d.id && !old) throw Error('الموظف غير موجود')
    this.version(old, d.version)
    if (
      d.userId &&
      !this.row(
        `SELECT id FROM users WHERE id=? AND role='stylist' AND active=1`,
        d.userId,
      )
    )
      throw Error('اختر حساب موظف نشطًا')
    if (
      old &&
      !d.active &&
      this.row(
        `SELECT id FROM sal_bookings WHERE staff_id=? AND status IN('booked','arrived') LIMIT 1`,
        d.id,
      )
    )
      throw Error('أعد تكليف الحجوزات القائمة قبل تعطيل الموظف')
    const id = d.id ?? ulid()
    this.db
      .prepare(
        'INSERT INTO sal_staff VALUES(?,?,?,?,?,?,?,?,?,0) ON CONFLICT(id) DO UPDATE SET code=excluded.code,name=excluded.name,phone=excluded.phone,note=excluded.note,user_id=excluded.user_id,commission_bps=excluded.commission_bps,active=excluded.active,version=sal_staff.version+1',
      )
      .run(
        id,
        d.code,
        d.name,
        d.phone,
        d.note,
        d.userId,
        d.commissionBps,
        +d.active,
        Date.now(),
      )
    return id
  }
  private savePlan(d: any, u: User) {
    this.manage(u)
    const old = d.id ? this.row(pq + ' WHERE p.id=?', d.id) : undefined
    if (d.id && !old) throw Error('الباقة غير موجودة')
    this.version(old, d.version)
    if (!this.row(sq + ' WHERE id=? AND active=1', d.serviceId))
      throw Error('اختر خدمة نشطة')
    const id = d.id ?? ulid()
    this.db
      .prepare(
        'INSERT INTO sal_plans VALUES(?,?,?,?,?,?,?,?,?,?,0) ON CONFLICT(id) DO UPDATE SET code=excluded.code,name=excluded.name,service_id=excluded.service_id,credits=excluded.credits,days=excluded.days,fee=excluded.fee,description=excluded.description,active=excluded.active,version=sal_plans.version+1',
      )
      .run(
        id,
        d.code,
        d.name,
        d.serviceId,
        d.credits,
        d.days,
        d.fee,
        d.description,
        +d.active,
        Date.now(),
      )
    return id
  }
  private overlap(
    customerId: string,
    staffId: string,
    day: string,
    start: number,
    duration: number,
    except = '',
  ) {
    if (start + duration > 1440) throw Error('الموعد يتجاوز نهاية اليوم')
    if (
      this.row(
        `SELECT id FROM sal_bookings WHERE day=? AND id<>? AND status IN('booked','arrived','done') AND (customer_id=? OR staff_id=?) AND start_minute<? AND start_minute+duration>? LIMIT 1`,
        day,
        except,
        customerId,
        staffId,
        start + duration,
        start,
      )
    )
      throw Error('تداخل في موعد العميل أو الموظف')
  }
  private checkPackage(
    id: string,
    customerId: string,
    serviceId: string,
    day: string,
    _u: User,
    except = '',
  ) {
    const p = this.packageData(id)
    if (
      p.status !== 'active' ||
      p.customerId !== customerId ||
      p.serviceId !== serviceId ||
      day < p.startDay ||
      day > p.endDay
    )
      throw Error('الباقة لا تطابق العميل أو الخدمة أو الفترة')
    if (p.balance !== 0) throw Error('سداد الباقة كاملًا مطلوب قبل حجز جلسة')
    const ownReservation =
      except &&
      this.row(
        `SELECT id FROM sal_bookings WHERE id=? AND package_id=? AND status IN('booked','arrived')`,
        except,
        id,
      )
        ? 1
        : 0
    if (p.used + p.reserved - ownReservation >= p.credits)
      throw Error('الجلسات المتاحة في الباقة نفدت')
    return p
  }
  private addBooking(d: any, u: User) {
    this.office(u)
    const c = this.customer(d.customerId, u),
      s = this.row(sq + ' WHERE id=?', d.serviceId),
      t = this.employee(d.staffId)
    this.version(c, d.customerVersion)
    if (!s) throw Error('الخدمة غير موجودة')
    this.version(s, d.serviceVersion)
    this.version(t, d.staffVersion)
    if (!c.active || !s.active) throw Error('العميل أو الخدمة متوقف')
    if (d.day < clinicToday()) throw Error('لا يمكن إنشاء حجز في الماضي')
    if (d.discount > s.fee) throw Error('الخصم أكبر من السعر')
    if (d.discount && !management(u)) throw Error('الخصم يحتاج المدير')
    if (d.packageId) {
      if (d.discount) throw Error('الخصم يطبق عند بيع الباقة')
      const p = this.checkPackage(d.packageId, c.id, s.id, d.day, u)
      this.version(p, d.packageVersion)
    } else if (d.packageVersion !== null) throw Error('إصدار الباقة دون باقة')
    this.overlap(c.id, t.id, d.day, d.startMinute, s.duration)
    const id = ulid()
    this.db
      .prepare(
        `INSERT INTO sal_bookings VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'booked',?,0)`,
      )
      .run(
        id,
        c.id,
        s.id,
        t.id,
        JSON.stringify({ name: c.name, code: c.code }),
        JSON.stringify({ name: s.name, code: s.code, category: s.category }),
        JSON.stringify({
          name: t.name,
          code: t.code,
          commissionBps: t.commissionBps,
        }),
        d.day,
        d.startMinute,
        s.duration,
        s.fee,
        d.discount,
        d.packageId,
        d.note,
        Date.now(),
      )
    this.packBump(d.packageId)
    return id
  }
  private move(d: any, u: User) {
    this.office(u)
    const b = this.booking(d.id, u),
      t = this.employee(d.staffId)
    this.version(b, d.version)
    this.version(t, d.staffVersion)
    if (b.status !== 'booked')
      throw Error('نقل الموعد متاح قبل تسجيل الحضور فقط')
    if (d.day < clinicToday()) throw Error('الموعد الجديد في الماضي')
    if (b.packageId)
      this.checkPackage(b.packageId, b.customerId, b.serviceId, d.day, u, b.id)
    this.overlap(b.customerId, t.id, d.day, d.startMinute, b.duration, b.id)
    this.db
      .prepare(
        'UPDATE sal_bookings SET staff_id=?,staff_json=?,day=?,start_minute=?,version=version+1 WHERE id=?',
      )
      .run(
        t.id,
        JSON.stringify({
          name: t.name,
          code: t.code,
          commissionBps: t.commissionBps,
        }),
        d.day,
        d.startMinute,
        b.id,
      )
    this.packBump(b.packageId)
    return b.id
  }
  private mark(d: any, u: User, status: 'arrived' | 'cancelled' | 'no-show') {
    this.office(u)
    const b = this.booking(d.id, u)
    this.version(b, d.version)
    if (
      !['booked', 'arrived'].includes(b.status) ||
      (status !== 'cancelled' && b.status !== 'booked')
    )
      throw Error('حالة الحجز لا تسمح بالعملية')
    if (status === 'arrived' && b.day !== clinicToday())
      throw Error('الحضور يسجل في يوم الحجز فقط')
    if (
      status === 'no-show' &&
      (b.day > clinicToday() ||
        (b.day === clinicToday() && minuteNow() < b.startMinute + b.duration))
    )
      throw Error('لم ينته وقت الموعد')
    if (status === 'arrived') {
      this.employee(b.staffId)
      if (b.packageId)
        this.checkPackage(
          b.packageId,
          b.customerId,
          b.serviceId,
          b.day,
          u,
          b.id,
        )
    }
    this.db
      .prepare('UPDATE sal_bookings SET status=?,version=version+1 WHERE id=?')
      .run(status, b.id)
    if (status !== 'arrived') this.packBump(b.packageId)
    return b.id
  }
  private newInvoice(
    kind: 'service' | 'package',
    sourceId: string,
    c: any,
    item: unknown,
    total: number,
    u: User,
  ) {
    const id = ulid()
    this.db
      .prepare(`INSERT INTO sal_invoices VALUES(?,?,?,?,?,'posted',?,0)`)
      .run(
        id,
        kind,
        sourceId,
        this.number('sal_invoices', 'SAL-I-'),
        c.id,
        Date.now(),
      )
    this.db
      .prepare('INSERT INTO sal_invoice_snapshots VALUES(?,?,?,?,?)')
      .run(
        id,
        JSON.stringify({ name: c.name, code: c.code }),
        JSON.stringify(item),
        JSON.stringify(this.business()),
        safe(total),
      )
    this.ledger(id, 'charge', total, sourceId, 'رسوم مسجلة وقت العملية', u)
    return id
  }
  private sell(d: any, u: User) {
    this.office(u)
    const c = this.customer(d.customerId, u),
      p = this.row(pq + ' WHERE p.id=?', d.planId)
    this.version(c, d.customerVersion)
    if (!p) throw Error('الباقة غير موجودة')
    this.version(p, d.planVersion)
    if (!c.active || !p.active) throw Error('العميل أو الباقة متوقف')
    if (!this.row(sq + ' WHERE id=? AND active=1', p.serviceId))
      throw Error('خدمة الباقة متوقفة')
    if (d.startDay < clinicToday()) throw Error('بداية الباقة في الماضي')
    if (d.discount > p.fee) throw Error('الخصم أكبر من السعر')
    if (d.discount && !management(u)) throw Error('الخصم يحتاج المدير')
    const end = addDay(d.startDay, p.days - 1)
    if (end > '2100-12-31') throw Error('نهاية الباقة خارج الفترة المدعومة')
    const id = ulid(),
      net = p.fee - d.discount,
      invoiceId = this.newInvoice(
        'package',
        id,
        c,
        {
          name: p.name,
          code: p.code,
          serviceName: p.serviceName,
          credits: p.credits,
          fee: p.fee,
          discount: d.discount,
          startDay: d.startDay,
          endDay: end,
        },
        net,
        u,
      )
    this.db
      .prepare(
        `INSERT INTO sal_packages VALUES(?,?,?,?,?,?,?,?,?,?,?,'active',?,0)`,
      )
      .run(
        id,
        c.id,
        p.id,
        p.serviceId,
        JSON.stringify({ name: c.name, code: c.code }),
        JSON.stringify({
          name: p.name,
          code: p.code,
          serviceName: p.serviceName,
        }),
        d.startDay,
        end,
        p.credits,
        net,
        invoiceId,
        Date.now(),
      )
    return id
  }
  private complete(d: any, u: User) {
    if (!management(u) && u.role !== 'stylist')
      throw Error('إتمام الخدمة يحتاج الموظف المكلف أو المدير')
    const b = this.booking(d.id, u)
    this.version(b, d.version)
    if (b.status !== 'arrived') throw Error('سجل الحضور قبل إتمام الخدمة')
    if (
      b.day > clinicToday() ||
      (b.day === clinicToday() && minuteNow() < b.startMinute)
    )
      throw Error('الموعد لم يبدأ بعد')
    this.employee(b.staffId)
    const raw = this.row(
        'SELECT customer_json,service_json,staff_json FROM sal_bookings WHERE id=?',
        b.id,
      ),
      c = { id: b.customerId, ...JSON.parse(raw.customer_json) },
      service = JSON.parse(raw.service_json),
      staff = JSON.parse(raw.staff_json)
    let basis = b.fee - b.discount,
      index: number | null = null
    if (b.packageId) {
      const p = this.checkPackage(
        b.packageId,
        b.customerId,
        b.serviceId,
        b.day,
        u,
        b.id,
      )
      const indexes = new Set(
        this.rows(
          `SELECT u.credit_index AS n FROM sal_package_uses u WHERE u.package_id=? AND ${usedFilter}`,
          p.id,
        ).map((x) => x.n),
      )
      for (let n = 0; n < p.credits; n++)
        if (!indexes.has(n)) {
          index = n
          break
        }
      if (index === null) throw Error('الجلسات المتاحة نفدت')
      basis =
        Math.floor(p.net / p.credits) + (index < p.net % p.credits ? 1 : 0)
    }
    const invoiceId = this.newInvoice(
        'service',
        b.id,
        c,
        {
          name: service.name,
          code: service.code,
          staffName: staff.name,
          day: b.day,
          startMinute: b.startMinute,
          duration: b.duration,
          fee: b.fee,
          discount: b.discount,
          covered: !!b.packageId,
        },
        b.packageId ? 0 : basis,
        u,
      ),
      id = ulid(),
      commission = safe(
        Number((BigInt(basis) * BigInt(staff.commissionBps) + 5000n) / 10000n),
      )
    this.db
      .prepare('INSERT INTO sal_completions VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(
        id,
        b.id,
        invoiceId,
        b.staffId,
        basis,
        staff.commissionBps,
        commission,
        index,
        u.id,
        u.name,
        Date.now(),
      )
    if (b.packageId)
      this.db
        .prepare('INSERT INTO sal_package_uses VALUES(?,?,?,?,?,?)')
        .run(ulid(), b.packageId, b.id, index, basis, Date.now())
    this.commission(
      b.staffId,
      'earned',
      commission,
      id,
      'عمولة الخدمة المنفذة',
      u,
    )
    this.db
      .prepare(
        `UPDATE sal_bookings SET status='done',version=version+1 WHERE id=?`,
      )
      .run(b.id)
    this.packBump(b.packageId)
    this.event(
      'invoice',
      invoiceId,
      'sal.booking.complete',
      '',
      { bookingId: b.id, total: b.packageId ? 0 : basis },
      u,
    )
    return b.id
  }
  private reverseInvoice(i: any, reason: string, u: User) {
    if (i.status !== 'posted' || i.balance !== i.total)
      throw Error('الفاتورة لها تحصيل قائم؛ صحح الإيصالات أولًا')
    this.ledger(i.id, 'reverse', -i.total, i.sourceId, reason, u)
    this.db
      .prepare(
        `UPDATE sal_invoices SET status='void',version=version+1 WHERE id=?`,
      )
      .run(i.id)
    this.event('invoice', i.id, 'sal.invoice.reverse', reason, {}, u)
  }
  private voidBooking(d: any, u: User) {
    this.manage(u)
    const b = this.booking(d.id, u)
    this.version(b, d.version)
    if (b.status !== 'done') throw Error('الحجز ليس خدمة منفذة')
    const c = this.row(completionq + ' WHERE c.booking_id=?', b.id)
    if (!c || c.voidReason) throw Error('النتيجة مصححة بالفعل')
    if (this.due(b.staffId) < c.commission)
      throw Error('صحح صرف العمولة قبل إلغاء نتيجة الخدمة')
    const i = this.invoice(c.invoiceId, u)
    this.reverseInvoice(i, d.reason, u)
    this.db
      .prepare('INSERT INTO sal_completion_voids VALUES(?,?,?,?,?,?)')
      .run(ulid(), c.id, d.reason, u.id, u.name, Date.now())
    this.commission(b.staffId, 'reverse', -c.commission, c.id, d.reason, u)
    this.db
      .prepare(
        `UPDATE sal_bookings SET status='void',version=version+1 WHERE id=?`,
      )
      .run(b.id)
    this.packBump(b.packageId)
    return b.id
  }
  private cancelPackage(d: any, u: User) {
    this.manage(u)
    const p = this.package(d.id, u)
    this.version(p, d.version)
    if (p.status !== 'active' || p.used || p.reserved || p.balance !== p.net)
      throw Error('الباقة لها تحصيل أو جلسات قائمة')
    this.reverseInvoice(this.invoice(p.invoiceId, u), d.reason, u)
    this.db
      .prepare(
        `UPDATE sal_packages SET status='cancelled',version=version+1 WHERE id=?`,
      )
      .run(p.id)
    return p.id
  }
  private collect(d: any, u: User) {
    this.office(u)
    const i = this.invoice(d.invoiceId, u)
    this.version(i, d.version)
    if (i.status !== 'posted' || d.amount > i.balance)
      throw Error('المبلغ أكبر من المستحق أو الفاتورة ملغاة')
    const id = ulid()
    this.db
      .prepare('INSERT INTO sal_payments VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(
        id,
        this.number('sal_payments', 'SAL-R-'),
        i.id,
        d.amount,
        d.method,
        d.reference,
        JSON.stringify(i.customer),
        JSON.stringify(i.item),
        JSON.stringify(i.business),
        u.id,
        u.name,
        Date.now(),
      )
    this.ledger(i.id, 'payment', -d.amount, id, 'تحصيل مبلغ', u)
    this.bump('sal_invoices', i.id)
    if (i.kind === 'package') this.packBump(i.sourceId)
    return { id, entityId: i.id }
  }
  private voidPayment(d: any, u: User) {
    this.manage(u)
    const p = this.row(receiptq + ' WHERE p.id=?', d.id)
    if (!p || p.voidReason) throw Error('الإيصال غير موجود أو ملغى')
    const i = this.invoice(p.invoiceId, u)
    if (i.kind === 'package' && this.package(i.sourceId, u).used > 0)
      throw Error('صحح جلسات الباقة المنفذة قبل إلغاء التحصيل')
    const id = ulid()
    this.db
      .prepare('INSERT INTO sal_payment_voids VALUES(?,?,?,?,?,?)')
      .run(id, p.id, d.reason, u.id, u.name, Date.now())
    this.ledger(i.id, 'payment-void', p.amount, p.id, d.reason, u)
    this.bump('sal_invoices', i.id)
    if (i.kind === 'package') this.packBump(i.sourceId)
    return { id, entityId: i.id }
  }
  commissions(u: User, from?: string, to?: string): SalonCommissions {
    const own = this.own(u)
    const list = this.rows(tq + ' ORDER BY name').filter(
      (t) => office(u) || t.id === own?.id,
    )
    const ids = new Set(list.map((t) => t.id)),
      bounds = from && to ? clinicDayBounds(from, to) : null
    const summary = list.map((t) => ({
      staffId: t.id,
      staffName: t.name,
      earned: aggregate(
        this.row<{ n: number }>(
          `SELECT COALESCE(sum(amount),0) n FROM sal_commission_ledger WHERE staff_id=? AND kind IN('earned','reverse')`,
          t.id,
        ).n,
      ),
      paid: aggregate(
        -this.row<{ n: number }>(
          `SELECT COALESCE(sum(amount),0) n FROM sal_commission_ledger WHERE staff_id=? AND kind IN('payout','payout-void')`,
          t.id,
        ).n,
      ),
      due: this.due(t.id),
    }))
    const entries = this.rows(
      `SELECT l.id,l.staff_id AS staffId,t.name AS staffName,l.kind,l.amount,l.reference_id AS referenceId,l.reason,l.actor_name AS actorName,l.at FROM sal_commission_ledger l JOIN sal_staff t ON t.id=l.staff_id` +
        (bounds ? ' WHERE l.at>=? AND l.at<?' : '') +
        ' ORDER BY l.at DESC,l.id DESC',
      ...(bounds ? [bounds.lo, bounds.hi] : []),
    )
      .filter((x) => ids.has(x.staffId))
      .map((x) =>
        office(u)
          ? x
          : {
              ...x,
              reason:
                x.kind === 'earned'
                  ? 'عمولة خدمة'
                  : x.kind === 'reverse'
                    ? 'تصحيح عمولة'
                    : 'صرف عمولة',
              actorName: '',
            },
      )
    const payouts = this.rows(
      `SELECT p.id,p.number,p.staff_id AS staffId,p.amount,p.method,p.reference,p.staff_json AS staff,p.business_json AS business,p.actor_name AS actorName,p.at,(SELECT v.reason FROM sal_payout_voids v WHERE v.payout_id=p.id) AS voidReason FROM sal_payouts p` +
        (bounds ? ' WHERE p.at>=? AND p.at<?' : '') +
        ' ORDER BY p.at DESC,p.number DESC',
      ...(bounds ? [bounds.lo, bounds.hi] : []),
    )
      .filter((p) => ids.has(p.staffId))
      .map((p) => ({
        ...p,
        staff: JSON.parse(p.staff),
        business: JSON.parse(p.business),
        ...(office(u)
          ? {}
          : {
              reference: '',
              actorName: '',
              voidReason: p.voidReason ? 'تم تصحيح الصرف' : null,
            }),
      }))
    return { summary, entries, payouts }
  }
  private payCommission(d: any, u: User) {
    this.manage(u)
    const t = this.row(tq + ' WHERE id=?', d.staffId)
    if (!t) throw Error('الموظف غير موجود')
    if (d.amount > this.due(t.id))
      throw Error('المبلغ أكبر من العمولة المستحقة')
    const id = ulid()
    this.db
      .prepare('INSERT INTO sal_payouts VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(
        id,
        this.number('sal_payouts', 'SAL-C-'),
        t.id,
        d.amount,
        d.method,
        d.reference,
        JSON.stringify({ name: t.name, code: t.code }),
        JSON.stringify(this.business()),
        u.id,
        u.name,
        Date.now(),
      )
    this.commission(t.id, 'payout', -d.amount, id, 'صرف عمولة مسجل', u)
    return { id, entityId: t.id }
  }
  private voidPayout(d: any, u: User) {
    this.manage(u)
    const p = this.row('SELECT * FROM sal_payouts WHERE id=?', d.id)
    if (
      !p ||
      this.row('SELECT id FROM sal_payout_voids WHERE payout_id=?', p.id)
    )
      throw Error('صرف العمولة غير موجود أو مصحح')
    const id = ulid()
    this.db
      .prepare('INSERT INTO sal_payout_voids VALUES(?,?,?,?,?,?)')
      .run(id, p.id, d.reason, u.id, u.name, Date.now())
    this.commission(p.staff_id, 'payout-void', p.amount, p.id, d.reason, u)
    return { id, entityId: p.staff_id }
  }
  private report(d: any, u: User): SalonReport {
    const s = this.state(u),
      { lo, hi } = clinicDayBounds(d.from, d.to)
    const sum = (sql: string) =>
      aggregate(this.row<{ n: number }>(sql, lo, hi).n)
    return {
      from: d.from,
      to: d.to,
      bookings: s.bookings.filter((b) => b.day >= d.from && b.day <= d.to),
      invoices: office(u)
        ? this.invoices(' WHERE i.at>=? AND i.at<? ORDER BY i.at DESC', lo, hi)
        : [],
      payments: office(u)
        ? this.payments(' WHERE p.at>=? AND p.at<? ORDER BY p.at DESC', lo, hi)
        : [],
      commissions: this.commissions(u, d.from, d.to),
      finance: office(u)
        ? {
            charges: sum(
              `SELECT COALESCE(sum(amount),0) n FROM sal_ledger WHERE kind IN('charge','reverse') AND at>=? AND at<?`,
            ),
            netCollected: aggregate(
              -sum(
                `SELECT COALESCE(sum(amount),0) n FROM sal_ledger WHERE kind IN('payment','payment-void') AND at>=? AND at<?`,
              ),
            ),
            voided: sum(
              `SELECT COALESCE(sum(amount),0) n FROM sal_ledger WHERE kind='payment-void' AND at>=? AND at<?`,
            ),
            outstanding: aggregate(
              s.invoices.reduce((n, i) => aggregate(n + i.balance), 0),
            ),
          }
        : null,
    }
  }
  call(action: string, input: unknown, u: User): unknown {
    const schema = salonSchemas[action as keyof typeof salonSchemas]
    if (!schema) throw Error('العملية غير متاحة')
    const d = schema.parse(input) as any
    if (action === 'sal.state') return this.state(u)
    if (action === 'sal.report') return this.report(d, u)
    if (action === 'sal.commissions') return this.commissions(u)
    if (action.endsWith('.get')) return this.get(action, d.id, u)
    if (action === 'sal.booking.complete') {
      if (!management(u) && u.role !== 'stylist')
        throw Error('إتمام الخدمة يحتاج الموظف المكلف أو المدير')
      this.booking(d.id, u)
    } else this.office(u)
    return this.db.transaction(() => {
      const h = fingerprint(d),
        prev = this.row(
          'SELECT * FROM commands WHERE client_txn_id=?',
          d.clientTxnId,
        )
      if (prev) {
        if (
          prev.action !== action ||
          prev.user_id !== u.id ||
          prev.request_hash !== h
        )
          throw Error('معرف العملية مستخدم لبيانات مختلفة')
        return JSON.parse(prev.result)
      }
      const before =
        action.startsWith('sal.booking.') && action !== 'sal.booking.add'
          ? this.booking(d.id, u)
          : null
      let id: string,
        type = 'booking',
        entityId: string
      switch (action) {
        case 'sal.customer.save':
          id = this.saveCustomer(d, u)
          type = 'customer'
          entityId = id
          break
        case 'sal.service.save':
          id = this.saveService(d, u)
          type = 'service'
          entityId = id
          break
        case 'sal.staff.save':
          id = this.saveStaff(d, u)
          type = 'staff'
          entityId = id
          break
        case 'sal.plan.save':
          id = this.savePlan(d, u)
          type = 'plan'
          entityId = id
          break
        case 'sal.booking.add':
          id = this.addBooking(d, u)
          entityId = id
          break
        case 'sal.booking.move':
          id = this.move(d, u)
          entityId = id
          break
        case 'sal.booking.arrive':
          id = this.mark(d, u, 'arrived')
          entityId = id
          break
        case 'sal.booking.cancel':
          id = this.mark(d, u, 'cancelled')
          entityId = id
          break
        case 'sal.booking.no-show':
          id = this.mark(d, u, 'no-show')
          entityId = id
          break
        case 'sal.booking.complete':
          id = this.complete(d, u)
          entityId = id
          break
        case 'sal.booking.void':
          id = this.voidBooking(d, u)
          entityId = id
          break
        case 'sal.package.sell':
          id = this.sell(d, u)
          type = 'package'
          entityId = id
          break
        case 'sal.package.cancel':
          id = this.cancelPackage(d, u)
          type = 'package'
          entityId = id
          break
        case 'sal.payment.post': {
          const r = this.collect(d, u)
          id = r.id
          entityId = r.entityId
          type = 'invoice'
          break
        }
        case 'sal.payment.void': {
          const r = this.voidPayment(d, u)
          id = r.id
          entityId = r.entityId
          type = 'invoice'
          break
        }
        case 'sal.commission.pay': {
          const r = this.payCommission(d, u)
          id = r.id
          entityId = r.entityId
          type = 'staff'
          break
        }
        case 'sal.commission.void': {
          const r = this.voidPayout(d, u)
          id = r.id
          entityId = r.entityId
          type = 'staff'
          break
        }
        default:
          throw Error('العملية غير متاحة')
      }
      this.event(
        type,
        entityId,
        action,
        d.reason ?? '',
        {
          id,
          ...(type === 'booking'
            ? {
                before,
                after: this.row(bq + ' WHERE b.id=?', id),
              }
            : {}),
        },
        u,
      )
      this.identity.audit(u.id, action, entityId)
      const result = { id }
      this.db
        .prepare('INSERT INTO commands VALUES(?,?,?,?,?)')
        .run(d.clientTxnId, action, u.id, h, JSON.stringify(result))
      return result
    })()
  }
}
