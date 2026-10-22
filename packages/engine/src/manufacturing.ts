import { ulid } from '@xzare/core'
import type { XzareDatabase } from '@xzare/db'
import { Identity } from './identity.js'
import { Inventory } from './inventory.js'
import { fingerprint } from './commerce.js'
import type { User } from './types.js'
import {
  manufacturingSchemas,
  type ManufacturingBom,
  type ProductionOrder,
  type MaterialRequirement,
} from './manufacturing-validation.js'
const orderQuery =
  'SELECT o.id,o.number,o.bom_id AS bomId,o.qty,o.warehouse_id AS warehouseId,o.destination_id AS destinationId,o.due_date AS dueDate,o.note,o.user_id AS userId,o.at,o.status,o.started_at AS startedAt,o.completed_at AS completedAt,o.issue_id AS issueId,o.receipt_id AS receiptId,o.material_cost AS materialCost,o.good_qty AS goodQty,o.scrap_qty AS scrapQty,o.labor_cost AS laborCost,o.overhead_cost AS overheadCost,o.total_cost AS totalCost,o.writeoff_cost AS writeoffCost,b.output_variant_id AS outputVariantId,b.revision,p.name AS outputName,v.sku,v.unit FROM manufacturing_orders o JOIN manufacturing_boms b ON b.id=o.bom_id JOIN variants v ON v.id=b.output_variant_id JOIN products p ON p.id=v.product_id'
const bomQuery =
  'SELECT b.id,b.output_variant_id AS outputVariantId,b.revision,b.name,b.yield_qty AS yieldQty,b.at,p.name AS outputName,v.sku,v.unit FROM manufacturing_boms b JOIN variants v ON v.id=b.output_variant_id JOIN products p ON p.id=v.product_id'
function safe(n: number) {
  if (!Number.isSafeInteger(n) || n < 0 || n > 1e12)
    throw new Error('الكمية أو القيمة تجاوزت الحد الآمن')
  return n
}
function day() {
  const d = new Date()
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-')
}
export class Manufacturing {
  constructor(
    readonly db: XzareDatabase,
    readonly identity: Identity,
    readonly inventory: Inventory,
  ) {}
  private bom(id: string): ManufacturingBom {
    const b = this.db.prepare(bomQuery + ' WHERE b.id=?').get(id) as ManufacturingBom | undefined
    if (!b) throw new Error('قائمة الخامات غير موجودة')
    return {
      ...b,
      components: this.db
        .prepare(
          'SELECT c.variant_id AS variantId,c.qty,c.waste_bps AS wasteBps,p.name,v.sku,v.unit FROM manufacturing_bom_lines c JOIN variants v ON v.id=c.variant_id JOIN products p ON p.id=v.product_id WHERE c.bom_id=? ORDER BY c.rowid',
        )
        .all(id) as ManufacturingBom['components'],
    }
  }
  private order(id: string) {
    const o = this.db.prepare(orderQuery + ' WHERE o.id=?').get(id) as ProductionOrder | undefined
    if (!o) throw new Error('أمر الإنتاج غير موجود')
    return o
  }
  private usable(variantId: string, warehouseId: string) {
    return this.db
      .prepare(
        "SELECT l.id AS lotId,l.batch,l.serial,l.expiry,b.qty,b.cost FROM inventory_balances b JOIN inventory_lots l ON l.id=b.lot_id WHERE l.variant_id=? AND b.warehouse_id=? AND b.qty>0 AND (l.expiry IS NULL OR l.expiry>=?) ORDER BY l.expiry IS NULL,l.expiry,l.serial!='',l.id",
      )
      .all(variantId, warehouseId, day()) as {
      lotId: string
      batch: string
      serial: string
      expiry: string | null
      qty: number
      cost: number
    }[]
  }
  private requirements(o: ProductionOrder): MaterialRequirement[] {
    const b = this.bom(o.bomId)
    return b.components.map((c) => {
      const n = BigInt(c.qty) * BigInt(o.qty) * BigInt(10000 + c.wasteBps),
        d = BigInt(b.yieldQty) * 10000n,
        qty = safe(Number((n + d - 1n) / d)),
        availableQty = safe(this.usable(c.variantId, o.warehouseId).reduce((s, l) => s + l.qty, 0))
      return { ...c, qty, availableQty, shortageQty: Math.max(0, qty - availableQty) }
    })
  }
  get(id: string) {
    const order = this.order(id)
    return {
      order,
      bom: this.bom(order.bomId),
      requirements: this.requirements(order),
      allocations: this.db
        .prepare(
          'SELECT a.id,a.variant_id AS variantId,a.warehouse_id AS warehouseId,a.qty,a.cost,l.batch,l.serial,l.expiry,p.name,v.sku,v.unit FROM manufacturing_allocations a JOIN inventory_lots l ON l.id=a.lot_id JOIN variants v ON v.id=a.variant_id JOIN products p ON p.id=v.product_id WHERE a.order_id=? ORDER BY a.rowid',
        )
        .all(id) as {
        id: string
        variantId: string
        warehouseId: string
        qty: number
        cost: number
        batch: string
        serial: string
        expiry: string | null
        name: string
        sku: string
        unit: string
      }[],
      events: this.db
        .prepare(
          'SELECT e.status,e.note,e.at,u.name AS userName FROM manufacturing_events e JOIN users u ON u.id=e.user_id WHERE e.order_id=? ORDER BY e.rowid',
        )
        .all(id) as {
        status: ProductionOrder['status']
        note: string
        at: number
        userName: string
      }[],
    }
  }
  state(user: User) {
    const base = this.inventory.state(user),
      orders = this.db
        .prepare(orderQuery + ' ORDER BY o.at DESC,o.id DESC LIMIT 1000')
        .all() as ProductionOrder[],
      boms = (
        this.db
          .prepare('SELECT id FROM manufacturing_boms ORDER BY at DESC,revision DESC')
          .all() as { id: string }[]
      ).map((b) => this.bom(b.id))
    const wipValue = safe(
      (
        this.db
          .prepare(
            "SELECT COALESCE(sum(material_cost),0) n FROM manufacturing_orders WHERE status='started'",
          )
          .get() as { n: number }
      ).n,
    )
    return { ...base, boms, orders, wipValue }
  }
  mrp(d: { warehouseId?: string }) {
    if (d.warehouseId) this.warehouse(d.warehouseId)
    const orders = this.db
      .prepare(
        orderQuery +
          " WHERE o.status='planned'" +
          (d.warehouseId ? ' AND o.warehouse_id=?' : '') +
          ' ORDER BY o.due_date,o.id',
      )
      .all(...(d.warehouseId ? [d.warehouseId] : [])) as ProductionOrder[]
    const totals = new Map<
      string,
      MaterialRequirement & {
        warehouseId: string
        warehouse: string
        requiredQty: number
        orderCount: number
      }
    >()
    for (const o of orders) {
      for (const r of this.requirements(o)) {
        const key = o.warehouseId + ':' + r.variantId,
          prior = totals.get(key),
          requiredQty = safe((prior?.requiredQty ?? 0) + r.qty),
          warehouse = (
            this.db.prepare('SELECT name FROM warehouses WHERE id=?').get(o.warehouseId) as {
              name: string
            }
          ).name
        totals.set(key, {
          ...r,
          warehouseId: o.warehouseId,
          warehouse,
          requiredQty,
          orderCount: (prior?.orderCount ?? 0) + 1,
          shortageQty: Math.max(0, requiredQty - r.availableQty),
        })
      }
    }
    return { rows: [...totals.values()], orders: orders.length }
  }
  report(d: { from: string; to: string; warehouseId?: string }) {
    if (d.from > d.to) throw new Error('راجع نطاق التقرير')
    const end = new Date(d.to + 'T00:00:00')
    end.setDate(end.getDate() + 1)
    end.setHours(0, 0, 0, 0)
    const args: (string | number)[] = [new Date(d.from + 'T00:00:00').getTime(), end.getTime()]
    if (d.warehouseId) {
      this.warehouse(d.warehouseId)
      args.push(d.warehouseId)
    }
    const rows = this.db
      .prepare(
        orderQuery +
          ' WHERE COALESCE(o.completed_at,o.started_at,o.at)>=? AND COALESCE(o.completed_at,o.started_at,o.at)<?' +
          (d.warehouseId ? ' AND o.warehouse_id=?' : '') +
          ' ORDER BY COALESCE(o.completed_at,o.started_at,o.at),o.id',
      )
      .all(...args) as ProductionOrder[]
    return {
      rows,
      wipValue: safe(
        rows.filter((o) => o.status === 'started').reduce((s, o) => s + o.materialCost, 0),
      ),
      completedCost: safe(
        rows.filter((o) => o.status === 'completed').reduce((s, o) => s + o.totalCost, 0),
      ),
      writeoffCost: safe(rows.reduce((s, o) => s + o.writeoffCost, 0)),
    }
  }
  private warehouse(id: string) {
    if (!this.db.prepare('SELECT id FROM warehouses WHERE id=?').get(id))
      throw new Error('المخزن غير موجود')
  }
  private active(id: string) {
    if (
      !this.db
        .prepare(
          'SELECT v.id FROM variants v JOIN products p ON p.id=v.product_id WHERE v.id=? AND p.active=1',
        )
        .get(id)
    )
      throw new Error('الصنف غير موجود أو متوقف')
  }
  private event(o: string, status: ProductionOrder['status'], note: string, user: User) {
    this.db
      .prepare('INSERT INTO manufacturing_events VALUES(?,?,?,?,?,?)')
      .run(ulid(), o, status, note, user.id, Date.now())
  }
  private createBom(d: any, user: User) {
    this.active(d.outputVariantId)
    if (new Set(d.components.map((c: any) => c.variantId)).size !== d.components.length)
      throw new Error('الخامة مكررة؛ اجمع كميتها في سطر واحد')
    const graph = new Map<string, string[]>()
    const edges = this.db
      .prepare(
        'SELECT b.output_variant_id AS output,c.variant_id AS component FROM manufacturing_bom_lines c JOIN manufacturing_boms b ON b.id=c.bom_id WHERE b.output_variant_id!=?',
      )
      .all(d.outputVariantId) as { output: string; component: string }[]
    for (const edge of edges)
      graph.set(edge.output, [...(graph.get(edge.output) ?? []), edge.component])
    const reaches = (id: string, visited = new Set<string>()): boolean => {
      if (id === d.outputVariantId) return true
      if (visited.has(id)) return false
      visited.add(id)
      return (graph.get(id) ?? []).some((x) => reaches(x, visited))
    }
    for (const c of d.components) {
      this.active(c.variantId)
      if (reaches(c.variantId)) throw new Error('قائمة الخامات تحتوي دورة إنتاج أو المنتج نفسه')
    }
    const revision = (
        this.db
          .prepare(
            'SELECT COALESCE(max(revision),0)+1 n FROM manufacturing_boms WHERE output_variant_id=?',
          )
          .get(d.outputVariantId) as { n: number }
      ).n,
      id = ulid()
    this.db
      .prepare('INSERT INTO manufacturing_boms VALUES(?,?,?,?,?,?,?)')
      .run(id, d.outputVariantId, revision, d.name, d.yieldQty, user.id, Date.now())
    for (const c of d.components)
      this.db
        .prepare('INSERT INTO manufacturing_bom_lines VALUES(?,?,?,?)')
        .run(id, c.variantId, c.qty, c.wasteBps)
    return this.bom(id)
  }
  private createOrder(d: any, user: User) {
    const b = this.bom(d.bomId)
    this.active(b.outputVariantId)
    this.warehouse(d.warehouseId)
    this.warehouse(d.destinationId)
    this.db
      .prepare(
        "INSERT INTO sequences VALUES('manufacturing',1) ON CONFLICT(kind) DO UPDATE SET value=value+1",
      )
      .run()
    const n = (
        this.db.prepare("SELECT value FROM sequences WHERE kind='manufacturing'").get() as {
          value: number
        }
      ).value,
      id = ulid()
    this.db
      .prepare(
        "INSERT INTO manufacturing_orders(id,number,bom_id,qty,warehouse_id,destination_id,due_date,note,user_id,at,status) VALUES(?,?,?,?,?,?,?,?,?,?,'planned')",
      )
      .run(
        id,
        'MO-' + String(n).padStart(6, '0'),
        d.bomId,
        d.qty,
        d.warehouseId,
        d.destinationId,
        d.dueDate,
        d.note,
        user.id,
        Date.now(),
      )
    const result = this.order(id)
    this.requirements(result)
    this.event(id, 'planned', d.note, user)
    return result
  }
  private start(d: any, user: User) {
    const o = this.order(d.id)
    if (o.status !== 'planned') throw new Error('بدء التصنيع متاح للأمر المخطط فقط')
    this.active(o.outputVariantId)
    const needs = this.requirements(o),
      lines: { variantId: string; batch: string; serial: string; qty: number }[] = []
    for (const r of needs) {
      this.active(r.variantId)
      if (r.shortageQty > 0) throw new Error('الخامات المتاحة لا تكفي: ' + r.name)
      let remaining = r.qty
      for (const l of this.usable(r.variantId, o.warehouseId)) {
        if (remaining === 0) break
        const qty = Math.min(remaining, l.qty)
        if (l.serial && qty !== 1000) continue
        lines.push({ variantId: r.variantId, batch: l.batch, serial: l.serial, qty })
        remaining -= qty
      }
      if (remaining > 0) throw new Error('الخامة ذات الرقم التسلسلي تُصرف كوحدة كاملة: ' + r.name)
    }
    if (lines.length > 100) throw new Error('الأمر يحتاج أكثر من 100 تشغيلة؛ قسّم أمر الإنتاج')
    const issued = this.inventory.call(
      'inventory.document.post',
      {
        clientTxnId: ulid(),
        kind: 'issue',
        warehouseId: o.warehouseId,
        note: 'إنتاج ' + o.number,
        lines,
      },
      user,
    ) as ReturnType<Inventory['get']>
    let materialCost = 0
    for (const entry of issued.entries) {
      materialCost = safe(materialCost - entry.cost)
      this.db
        .prepare('INSERT INTO manufacturing_allocations VALUES(?,?,?,?,?,?,?)')
        .run(
          ulid(),
          o.id,
          (entry as typeof entry & { lot_id: string }).lot_id,
          entry.variantId,
          o.warehouseId,
          -entry.qty,
          -entry.cost,
        )
    }
    this.db
      .prepare(
        "UPDATE manufacturing_orders SET status='started',started_at=?,issue_id=?,material_cost=? WHERE id=?",
      )
      .run(Date.now(), issued.document.id, materialCost, o.id)
    this.event(o.id, 'started', 'صرف الخامات إلى الإنتاج', user)
    return this.get(o.id)
  }
  private complete(d: any, user: User) {
    const o = this.order(d.id)
    if (o.status !== 'started') throw new Error('أكمل أمرًا جاري تصنيعه')
    if (safe(d.goodQty + d.scrapQty) !== o.qty)
      throw new Error('الكمية السليمة والهالك يجب أن يساويا كمية الأمر')
    const totalCost = safe(o.materialCost + d.laborCost + d.overheadCost)
    if (
      d.serials.length &&
      (new Set(d.serials).size !== d.serials.length || d.goodQty !== d.serials.length * 1000)
    )
      throw new Error('كل رقم تسلسلي يخص وحدة سليمة واحدة')
    if (d.goodQty === 0 && (d.serials.length || d.expiry))
      throw new Error('الأمر بالكامل هالك؛ لا تسجل تشغيلة منتج')
    let receiptId: string | null = null
    if (d.goodQty > 0) {
      if (d.expiry && d.expiry < day()) throw new Error('صلاحية المنتج المصنّع منتهية')
      const lines = d.serials.length
        ? d.serials.map((serial: string, i: number) => ({
            variantId: o.outputVariantId,
            qty: 1000,
            cost:
              Math.floor(totalCost / d.serials.length) + (i < totalCost % d.serials.length ? 1 : 0),
            batch: d.batch,
            serial,
            ...(d.expiry ? { expiry: d.expiry } : {}),
          }))
        : [
            {
              variantId: o.outputVariantId,
              qty: d.goodQty,
              cost: totalCost,
              batch: d.batch,
              serial: '',
              ...(d.expiry ? { expiry: d.expiry } : {}),
            },
          ]
      const received = this.inventory.call(
        'inventory.document.post',
        {
          clientTxnId: ulid(),
          kind: 'receipt',
          warehouseId: o.destinationId,
          note: 'إكمال إنتاج ' + o.number + ' · ' + d.note,
          lines,
        },
        user,
      ) as ReturnType<Inventory['get']>
      receiptId = received.document.id
    }
    this.db
      .prepare(
        "UPDATE manufacturing_orders SET status='completed',completed_at=?,receipt_id=?,good_qty=?,scrap_qty=?,labor_cost=?,overhead_cost=?,total_cost=?,writeoff_cost=? WHERE id=?",
      )
      .run(
        Date.now(),
        receiptId,
        d.goodQty,
        d.scrapQty,
        d.laborCost,
        d.overheadCost,
        totalCost,
        d.goodQty === 0 ? totalCost : 0,
        o.id,
      )
    this.event(o.id, 'completed', d.note, user)
    return this.get(o.id)
  }
  call(action: string, input: unknown, user: User) {
    const schema = manufacturingSchemas[action as keyof typeof manufacturingSchemas]
    if (!schema) throw new Error('العملية غير متاحة')
    const d = schema.parse(input) as any
    if (action === 'manufacturing.state') return this.state(user)
    if (action === 'manufacturing.order.get') return this.get(d.id)
    if (action === 'manufacturing.mrp') return this.mrp(d)
    if (action === 'manufacturing.report') return this.report(d)
    if (user.role !== 'admin' && user.role !== 'manager')
      throw new Error('ليس لديك صلاحية تعديل الإنتاج')
    return this.db.transaction(() => {
      const requestHash = fingerprint(d),
        previous = this.db
          .prepare('SELECT * FROM commands WHERE client_txn_id=?')
          .get(d.clientTxnId) as
          { action: string; user_id: string; request_hash: string; result: string } | undefined
      if (previous) {
        if (
          previous.action !== action ||
          previous.user_id !== user.id ||
          previous.request_hash !== requestHash
        )
          throw new Error('معرف العملية مستخدم لبيانات مختلفة')
        return JSON.parse(previous.result)
      }
      let result: any
      if (action === 'manufacturing.bom.create') result = this.createBom(d, user)
      else if (action === 'manufacturing.order.create') result = this.createOrder(d, user)
      else if (action === 'manufacturing.order.start') result = this.start(d, user)
      else if (action === 'manufacturing.order.complete') result = this.complete(d, user)
      else {
        const o = this.order(d.id)
        if (o.status !== 'planned')
          throw new Error('لا يمكن إلغاء أمر صُرفت خاماته؛ أكمله وسجل الهالك الفعلي')
        this.db.prepare("UPDATE manufacturing_orders SET status='cancelled' WHERE id=?").run(o.id)
        this.event(o.id, 'cancelled', d.note, user)
        result = this.get(o.id)
      }
      this.identity.audit(user.id, action, result.order?.id ?? result.id)
      this.db
        .prepare('INSERT INTO commands VALUES(?,?,?,?,?)')
        .run(d.clientTxnId, action, user.id, requestHash, JSON.stringify(result))
      return result
    })()
  }
}
