import { ulid } from '@xzare/core'
import type { XzareDatabase } from '@xzare/db'
import { Identity } from './identity.js'
import { Inventory } from './inventory.js'
import { fingerprint } from './commerce.js'
import type { User } from './types.js'
import {
  serviceCenterSchemas,
  type ServiceCenterDevice,
  type ServiceCenterOrder,
  type ServiceCenterEstimate,
  type ServiceCenterTechnician,
  type ServiceCenterStatus,
} from './service-center-validation.js'
const orderQuery =
  "SELECT o.id,o.number,o.device_id AS deviceId,o.device_snapshot AS deviceSnapshot,o.warehouse_id AS warehouseId,o.condition,o.accessories,o.kind,o.parent_id AS parentId,(SELECT number FROM service_center_orders WHERE id=o.parent_id) AS parentNumber,o.coverage_note AS coverageNote,o.complaint,o.due_date AS dueDate,o.status,o.estimate_id AS estimateId,o.technician_id AS technicianId,t.name AS technicianName,o.issue_id AS issueId,o.parts_cost AS partsCost,o.labor_cost AS laborCost,o.at,o.ready_at AS readyAt,o.delivered_at AS deliveredAt,COALESCE(e.total,0) AS total,COALESCE(e.warranty_days,0) AS warrantyDays,COALESCE(e.warranty_terms,'') AS warrantyTerms,COALESCE((SELECT sum(amount) FROM service_center_payments WHERE order_id=o.id),0) AS paid FROM service_center_orders o LEFT JOIN service_center_estimates e ON e.id=o.estimate_id LEFT JOIN service_center_technicians t ON t.id=o.technician_id"
function safe(n: number) {
  if (!Number.isSafeInteger(n) || n < 0 || n > 1e12)
    throw new Error('الكمية أو المبلغ تجاوز الحد الآمن')
  return n
}
function rounded(n: bigint, d: bigint) {
  return safe(Number((n + d / 2n) / d))
}
function day() {
  const d = new Date()
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-')
}
export class ServiceCenter {
  constructor(
    readonly db: XzareDatabase,
    readonly identity: Identity,
    readonly inventory: Inventory,
  ) {}
  private device(id: string) {
    const v = this.db.prepare('SELECT * FROM service_center_devices WHERE id=?').get(id) as
      ServiceCenterDevice | undefined
    if (!v) throw new Error('الجهاز غير موجودة')
    return v
  }
  private orderRow(r: any): ServiceCenterOrder {
    const { deviceSnapshot, ...rest } = r
    return {
      ...rest,
      device: JSON.parse(deviceSnapshot),
      warrantyUntil:
        rest.kind === 'repair' && rest.deliveredAt && rest.warrantyDays > 0
          ? rest.deliveredAt + rest.warrantyDays * 86400000
          : null,
    }
  }
  private order(id: string) {
    const r = this.db.prepare(orderQuery + ' WHERE o.id=?').get(id)
    if (!r) throw new Error('أمر الصيانة غير موجود')
    return this.orderRow(r)
  }
  private estimate(id: string): ServiceCenterEstimate {
    const e = this.db
      .prepare(
        'SELECT id,order_id AS orderId,revision,diagnosis,subtotal,discount,tax_bps AS taxBps,tax,warranty_days AS warrantyDays,warranty_terms AS warrantyTerms,total,at FROM service_center_estimates WHERE id=?',
      )
      .get(id) as ServiceCenterEstimate | undefined
    if (!e) throw new Error('عرض السعر غير موجود')
    return {
      ...e,
      lines: this.db
        .prepare(
          'SELECT id,kind,variant_id AS variantId,description,unit,qty,price,total FROM service_center_estimate_lines WHERE estimate_id=? ORDER BY rowid',
        )
        .all(id) as ServiceCenterEstimate['lines'],
    }
  }
  get(id: string) {
    const order = this.order(id)
    return {
      order,
      parent: order.parentId ? this.order(order.parentId) : null,
      estimates: (
        this.db
          .prepare('SELECT id FROM service_center_estimates WHERE order_id=? ORDER BY revision')
          .all(id) as { id: string }[]
      ).map((x) => this.estimate(x.id)),
      allocations: this.db
        .prepare(
          'SELECT a.qty,a.cost,a.variant_id AS variantId,l.batch,l.serial,l.expiry,p.name FROM service_center_allocations a JOIN inventory_lots l ON l.id=a.lot_id JOIN variants v ON v.id=a.variant_id JOIN products p ON p.id=v.product_id WHERE a.order_id=? ORDER BY a.rowid',
        )
        .all(id) as {
        qty: number
        cost: number
        variantId: string
        batch: string
        serial: string
        expiry: string | null
        name: string
      }[],
      payments: this.db
        .prepare(
          'SELECT p.id,p.amount,p.method,p.reference,p.at,u.name AS userName FROM service_center_payments p JOIN users u ON u.id=p.user_id WHERE p.order_id=? ORDER BY p.rowid',
        )
        .all(id) as {
        id: string
        amount: number
        method: string
        reference: string
        at: number
        userName: string
      }[],
      events: this.db
        .prepare(
          'SELECT e.status,e.note,e.at,u.name AS userName FROM service_center_events e JOIN users u ON u.id=e.user_id WHERE e.order_id=? ORDER BY e.rowid',
        )
        .all(id) as { status: ServiceCenterStatus; note: string; at: number; userName: string }[],
    }
  }
  state(user: User) {
    return {
      ...this.inventory.state(user),
      devices: this.db
        .prepare('SELECT * FROM service_center_devices ORDER BY serial')
        .all() as ServiceCenterDevice[],
      technicians: this.db
        .prepare('SELECT * FROM service_center_technicians ORDER BY name')
        .all() as ServiceCenterTechnician[],
      orders: this.db
        .prepare(
          orderQuery +
            " WHERE o.status NOT IN('delivered','cancelled') OR o.id IN(SELECT id FROM service_center_orders ORDER BY at DESC,id DESC LIMIT 1000) ORDER BY o.at DESC,o.id DESC",
        )
        .all()
        .map((r) => this.orderRow(r)),
      orderCount: (
        this.db.prepare('SELECT count(*) n FROM service_center_orders').get() as { n: number }
      ).n,
    }
  }
  report(d: { from: string; to: string }) {
    if (d.from > d.to) throw new Error('راجع نطاق التقرير')
    const start = new Date(d.from + 'T00:00:00').getTime(),
      end = new Date(d.to + 'T00:00:00')
    end.setDate(end.getDate() + 1)
    const rows = this.db
      .prepare(
        orderQuery +
          ' WHERE COALESCE(o.ready_at,o.at)>=? AND COALESCE(o.ready_at,o.at)<? ORDER BY o.at,o.id',
      )
      .all(start, end.getTime())
      .map((r) => this.orderRow(r))
    const finished = rows.filter((r) => r.status === 'ready' || r.status === 'delivered')
    const revenue = safe(finished.reduce((s, r) => s + r.total, 0)),
      cost = safe(finished.reduce((s, r) => s + r.partsCost + r.laborCost, 0))
    const payments = this.db
      .prepare(
        'SELECT p.id,o.number,p.amount,p.method,p.reference,p.at FROM service_center_payments p JOIN service_center_orders o ON o.id=p.order_id WHERE p.at>=? AND p.at<? ORDER BY p.at,p.id',
      )
      .all(start, end.getTime()) as {
      id: string
      number: string
      amount: number
      method: string
      reference: string
      at: number
    }[]
    return {
      rows,
      payments,
      revenue,
      cost,
      margin: revenue - cost,
      warrantyCost: safe(
        finished
          .filter((r) => r.kind === 'warranty')
          .reduce((s, r) => s + r.partsCost + r.laborCost, 0),
      ),
      collected: safe(payments.reduce((s, p) => s + p.amount, 0)),
      receivable: safe(finished.reduce((s, r) => s + r.total - r.paid, 0)),
    }
  }
  private event(id: string, status: ServiceCenterStatus, note: string, user: User) {
    this.db
      .prepare('INSERT INTO service_center_events VALUES(?,?,?,?,?,?)')
      .run(ulid(), id, status, note, user.id, Date.now())
  }
  private status(o: ServiceCenterOrder, allowed: ServiceCenterStatus[]) {
    if (!allowed.includes(o.status))
      throw new Error('العملية غير متاحة في مرحلة أمر الصيانة الحالية')
  }
  private technician(id: string) {
    const t = this.db
      .prepare('SELECT * FROM service_center_technicians WHERE id=? AND active=1')
      .get(id) as ServiceCenterTechnician | undefined
    if (!t) throw new Error('الفني غير موجود أو متوقف')
    return t
  }
  private saveDevice(d: any) {
    const id = d.id ?? ulid()
    if (d.id) {
      const v = this.device(id)
      if (
        d.serial !== v.serial &&
        this.db.prepare('SELECT 1 FROM service_center_orders WHERE device_id=? LIMIT 1').get(id)
      )
        throw new Error('لا يمكن تغيير السيريال لجهاز له سجل صيانة')
    }
    this.db
      .prepare(
        'INSERT INTO service_center_devices VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET customer=excluded.customer,phone=excluded.phone,serial=excluded.serial,type=excluded.type,brand=excluded.brand,model=excluded.model',
      )
      .run(id, d.customer, d.phone, d.serial, d.type, d.brand, d.model)
    return this.device(id)
  }
  private saveTechnician(d: any) {
    const id = d.id ?? ulid()
    if (d.id && !this.db.prepare('SELECT id FROM service_center_technicians WHERE id=?').get(id))
      throw new Error('الفني غير موجود')
    this.db
      .prepare(
        'INSERT INTO service_center_technicians VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,phone=excluded.phone,active=excluded.active',
      )
      .run(id, d.name, d.phone, Number(d.active))
    return this.db.prepare('SELECT * FROM service_center_technicians WHERE id=?').get(id)
  }
  private createOrder(d: any, user: User, parent: ServiceCenterOrder | null = null) {
    const v = this.device(d.deviceId)
    if (!this.db.prepare('SELECT id FROM warehouses WHERE id=?').get(d.warehouseId))
      throw new Error('المخزن غير موجود')
    if (
      this.db
        .prepare(
          "SELECT id FROM service_center_orders WHERE device_id=? AND status NOT IN('delivered','cancelled')",
        )
        .get(v.id)
    )
      throw new Error('الجهاز له أمر صيانة مفتوح بالفعل')
    this.db
      .prepare(
        "INSERT INTO sequences VALUES('service-center',1) ON CONFLICT(kind) DO UPDATE SET value=value+1",
      )
      .run()
    const n = (
        this.db.prepare("SELECT value FROM sequences WHERE kind='service-center'").get() as {
          value: number
        }
      ).value,
      id = ulid()
    this.db
      .prepare(
        "INSERT INTO service_center_orders(id,number,device_id,device_snapshot,warehouse_id,condition,accessories,kind,parent_id,coverage_note,complaint,due_date,status,user_id,at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'received',?,?)",
      )
      .run(
        id,
        'SC-' + String(n).padStart(6, '0'),
        v.id,
        JSON.stringify(v),
        d.warehouseId,
        d.condition,
        d.accessories,
        parent ? 'warranty' : 'repair',
        parent?.id ?? null,
        parent ? d.coverageNote : '',
        d.complaint,
        d.dueDate,
        user.id,
        Date.now(),
      )
    this.event(id, 'received', parent ? 'قبول رجوع ضمان: ' + d.coverageNote : d.complaint, user)
    return this.order(id)
  }
  private createWarranty(d: any, user: User) {
    const parent = this.order(d.parentId)
    if (parent.kind !== 'repair' || parent.status !== 'delivered' || !parent.warrantyUntil)
      throw new Error('الأمر غير مؤهل لرجوع ضمان')
    if (Date.now() > parent.warrantyUntil) throw new Error('انتهت مدة ضمان الإصلاح')
    return this.createOrder({ ...d, deviceId: parent.deviceId }, user, parent)
  }
  private createEstimate(d: any, user: User) {
    const o = this.order(d.id)
    this.status(o, ['received', 'estimated'])
    if (d.warrantyDays > 0 && !d.warrantyTerms) throw new Error('حدد شروط ضمان الإصلاح')
    if (
      o.kind === 'warranty' &&
      (d.warrantyDays !== 0 ||
        d.warrantyTerms ||
        d.discount !== 0 ||
        d.taxBps !== 0 ||
        [...d.parts, ...d.services].some((l: any) => l.price !== 0))
    )
      throw new Error('رجوع الضمان لا يقبل تحصيلًا أو تمديدًا للضمان')
    if (!d.parts.length && !d.services.length) throw new Error('أضف قطعة أو خدمة واحدة على الأقل')
    if (new Set(d.parts.map((p: any) => p.variantId)).size !== d.parts.length)
      throw new Error('القطعة مكررة؛ اجمع الكمية في سطر واحد')
    const lines: ServiceCenterEstimate['lines'] = []
    for (const p of d.parts) {
      const v = this.db
        .prepare(
          'SELECT p.name,v.unit FROM variants v JOIN products p ON p.id=v.product_id WHERE v.id=? AND p.active=1',
        )
        .get(p.variantId) as { name: string; unit: string } | undefined
      if (!v) throw new Error('قطعة الغيار غير موجودة أو متوقفة')
      lines.push({
        id: ulid(),
        kind: 'part',
        variantId: p.variantId,
        description: v.name,
        unit: v.unit,
        qty: p.qty,
        price: p.price,
        total: rounded(BigInt(p.qty) * BigInt(p.price), 1000n),
      })
    }
    for (const s of d.services)
      lines.push({
        id: ulid(),
        kind: 'service',
        variantId: null,
        description: s.description,
        unit: 'service',
        qty: s.qty,
        price: s.price,
        total: rounded(BigInt(s.qty) * BigInt(s.price), 1000n),
      })
    const subtotal = safe(lines.reduce((s, l) => s + l.total, 0))
    if (d.discount > subtotal) throw new Error('الخصم أكبر من إجمالي عرض السعر')
    const tax = rounded(BigInt(subtotal - d.discount) * BigInt(d.taxBps), 10000n),
      total = safe(subtotal - d.discount + tax),
      id = ulid(),
      revision = (
        this.db
          .prepare(
            'SELECT COALESCE(max(revision),0)+1 n FROM service_center_estimates WHERE order_id=?',
          )
          .get(o.id) as { n: number }
      ).n
    this.db
      .prepare('INSERT INTO service_center_estimates VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(
        id,
        o.id,
        revision,
        d.diagnosis,
        subtotal,
        d.discount,
        d.taxBps,
        tax,
        d.warrantyDays,
        d.warrantyTerms,
        total,
        user.id,
        Date.now(),
      )
    for (const l of lines)
      this.db
        .prepare('INSERT INTO service_center_estimate_lines VALUES(?,?,?,?,?,?,?,?,?)')
        .run(l.id, id, l.kind, l.variantId, l.description, l.unit, l.qty, l.price, l.total)
    this.db
      .prepare("UPDATE service_center_orders SET status='estimated',estimate_id=? WHERE id=?")
      .run(id, o.id)
    this.event(o.id, 'estimated', 'عرض سعر ' + revision + ' · ' + d.diagnosis, user)
    return this.estimate(id)
  }
  private approve(d: any, user: User) {
    const o = this.order(d.id)
    this.status(o, ['estimated'])
    if (d.estimateId !== o.estimateId)
      throw new Error('عرض السعر تغير؛ افتح آخر نسخة واحصل على موافقة العميل عليها')
    this.technician(d.technicianId)
    this.db
      .prepare("UPDATE service_center_orders SET status='approved',technician_id=? WHERE id=?")
      .run(d.technicianId, o.id)
    this.event(o.id, 'approved', d.note, user)
    return this.get(o.id)
  }
  private start(d: any, user: User) {
    const o = this.order(d.id)
    this.status(o, ['approved'])
    this.technician(o.technicianId!)
    const e = this.estimate(o.estimateId!),
      lines: { variantId: string; qty: number; batch: string; serial: string }[] = []
    for (const p of e.lines.filter((l) => l.kind === 'part')) {
      let left = p.qty
      const lots = this.db
        .prepare(
          'SELECT l.batch,l.serial,b.qty FROM inventory_balances b JOIN inventory_lots l ON l.id=b.lot_id WHERE l.variant_id=? AND b.warehouse_id=? AND b.qty>0 AND (l.expiry IS NULL OR l.expiry>=?) ORDER BY l.expiry IS NULL,l.expiry,l.id',
        )
        .all(p.variantId, o.warehouseId, day()) as { batch: string; serial: string; qty: number }[]
      for (const l of lots) {
        if (left === 0) break
        const qty = Math.min(left, l.qty)
        if (l.serial && qty !== 1000) continue
        lines.push({ variantId: p.variantId!, qty, batch: l.batch, serial: l.serial })
        left -= qty
      }
      if (left > 0)
        throw new Error(
          'القطع المتاحة لا تكفي أو القطعة التسلسلية تحتاج وحدة كاملة: ' + p.description,
        )
    }
    if (lines.length > 100) throw new Error('الأمر يحتاج أكثر من 100 تشغيلة؛ قسّم أمر الصيانة')
    let issueId: string | null = null,
      partsCost = 0
    if (lines.length) {
      const issued = this.inventory.call(
        'inventory.document.post',
        {
          kind: 'issue',
          warehouseId: o.warehouseId,
          note: 'صيانة ' + o.number,
          lines,
          clientTxnId: ulid(),
        },
        user,
      ) as ReturnType<Inventory['get']>
      issueId = issued.document.id
      for (const a of issued.entries) {
        partsCost = safe(partsCost - a.cost)
        this.db
          .prepare('INSERT INTO service_center_allocations VALUES(?,?,?,?,?,?)')
          .run(
            ulid(),
            o.id,
            (a as typeof a & { lot_id: string }).lot_id,
            a.variantId,
            -a.qty,
            -a.cost,
          )
      }
    }
    this.db
      .prepare(
        "UPDATE service_center_orders SET status='in_progress',started_at=?,issue_id=?,parts_cost=? WHERE id=?",
      )
      .run(Date.now(), issueId, partsCost, o.id)
    this.event(o.id, 'in_progress', 'بدء الإصلاح وصرف القطع', user)
    return this.get(o.id)
  }
  private ready(d: any, user: User) {
    const o = this.order(d.id)
    this.status(o, ['in_progress'])
    safe(o.partsCost + d.laborCost)
    this.db
      .prepare("UPDATE service_center_orders SET status='ready',ready_at=?,labor_cost=? WHERE id=?")
      .run(Date.now(), d.laborCost, o.id)
    this.event(o.id, 'ready', d.note, user)
    return this.get(o.id)
  }
  private pay(d: any, user: User) {
    const o = this.order(d.id)
    this.status(o, ['ready'])
    if (d.amount > o.total - o.paid) throw new Error('المبلغ أكبر من المتبقي على أمر الصيانة')
    this.db
      .prepare('INSERT INTO service_center_payments VALUES(?,?,?,?,?,?,?)')
      .run(ulid(), o.id, d.amount, d.method, d.reference, user.id, Date.now())
    return this.get(o.id)
  }
  private deliver(d: any, user: User) {
    const o = this.order(d.id)
    this.status(o, ['ready'])
    if (o.paid !== o.total) throw new Error('أكمل تحصيل المبلغ المتبقي قبل تسليم الجهاز')
    this.db
      .prepare("UPDATE service_center_orders SET status='delivered',delivered_at=? WHERE id=?")
      .run(Date.now(), o.id)
    this.event(o.id, 'delivered', d.note, user)
    return this.get(o.id)
  }
  call(action: string, input: unknown, user: User) {
    const schema = serviceCenterSchemas[action as keyof typeof serviceCenterSchemas]
    if (!schema) throw new Error('العملية غير متاحة')
    const d = schema.parse(input) as any
    if (action === 'service-center.state') return this.state(user)
    if (action === 'service-center.device.history')
      return {
        device: this.device(d.id),
        orders: this.db
          .prepare(orderQuery + ' WHERE o.device_id=? ORDER BY o.at DESC,o.id DESC')
          .all(d.id)
          .map((r) => this.orderRow(r)),
      }
    if (action === 'service-center.order.get') return this.get(d.id)
    if (action === 'service-center.report') return this.report(d)
    if (user.role !== 'admin' && user.role !== 'manager')
      throw new Error('ليس لديك صلاحية تعديل مركز الصيانة')
    return this.db.transaction(() => {
      const hash = fingerprint(d),
        prior = this.db
          .prepare('SELECT * FROM commands WHERE client_txn_id=?')
          .get(d.clientTxnId) as
          { action: string; user_id: string; request_hash: string; result: string } | undefined
      if (prior) {
        if (prior.action !== action || prior.user_id !== user.id || prior.request_hash !== hash)
          throw new Error('معرف العملية مستخدم لبيانات مختلفة')
        return JSON.parse(prior.result)
      }
      let result: any
      if (action === 'service-center.device.save') result = this.saveDevice(d)
      else if (action === 'service-center.technician.save') result = this.saveTechnician(d)
      else if (action === 'service-center.warranty.create') result = this.createWarranty(d, user)
      else if (action === 'service-center.order.create') result = this.createOrder(d, user)
      else if (action === 'service-center.estimate.create') result = this.createEstimate(d, user)
      else if (action === 'service-center.order.approve') result = this.approve(d, user)
      else if (action === 'service-center.order.start') result = this.start(d, user)
      else if (action === 'service-center.order.ready') result = this.ready(d, user)
      else if (action === 'service-center.order.pay') result = this.pay(d, user)
      else if (action === 'service-center.order.deliver') result = this.deliver(d, user)
      else {
        const o = this.order(d.id)
        this.status(o, ['received', 'estimated', 'approved'])
        this.db.prepare("UPDATE service_center_orders SET status='cancelled' WHERE id=?").run(o.id)
        this.event(o.id, 'cancelled', d.note, user)
        result = this.get(o.id)
      }
      this.identity.audit(user.id, action, result.order?.id ?? result.id)
      this.db
        .prepare('INSERT INTO commands VALUES(?,?,?,?,?)')
        .run(d.clientTxnId, action, user.id, hash, JSON.stringify(result))
      return result
    })()
  }
}
