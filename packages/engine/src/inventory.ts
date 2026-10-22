import { ulid, CostBasis, Money, Quantity } from '@xzare/core'
import type { XzareDatabase } from '@xzare/db'
import { Identity } from './identity.js'
import { fingerprint } from './commerce.js'
import {
  inventorySchemas,
  type InventoryLine,
  type InventoryDocument,
  type InventoryBalance,
} from './inventory-validation.js'
import type { User, Product, Audit } from './types.js'
const docQuery =
  'SELECT id,number,kind,warehouse_id AS warehouseId,destination_id AS destinationId,note,user_id AS userId,at FROM inventory_documents'
const balanceQuery =
  'SELECT b.lot_id AS lotId,l.variant_id AS variantId,b.warehouse_id AS warehouseId,l.batch,l.serial,l.expiry,b.qty,b.cost,p.name,v.sku,v.unit FROM inventory_balances b JOIN inventory_lots l ON l.id=b.lot_id JOIN variants v ON v.id=l.variant_id JOIN products p ON p.id=v.product_id'
export const inventoryProductQuery = `SELECT v.id,v.product_id,p.name,v.name AS variant_name,v.sku,v.unit,v.price,v.reorder_qty,p.category,p.active,COALESCE((SELECT sum(qty) FROM stock_levels WHERE variant_id=v.id),0) AS qty,COALESCE((SELECT sum(cost) FROM stock_levels WHERE variant_id=v.id),0) AS cost,(SELECT code FROM barcodes WHERE variant_id=v.id LIMIT 1) AS barcode,(SELECT format FROM barcodes WHERE variant_id=v.id LIMIT 1) AS format FROM variants v JOIN products p ON p.id=v.product_id`
function safe(n: number) {
  if (!Number.isSafeInteger(n) || Math.abs(n) > 1e12) throw new Error('الرصيد تجاوز الحد الآمن')
  return n
}
function localDay() {
  let d = new Date()
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-')
}
export class Inventory {
  constructor(
    readonly db: XzareDatabase,
    readonly identity: Identity,
  ) {}
  private reconciles() {
    const ledgerDifference = this.db
      .prepare(
        `WITH ledger AS(SELECT lot_id,warehouse_id,sum(qty) qty,sum(cost) cost FROM inventory_entries GROUP BY lot_id,warehouse_id), keys AS(SELECT lot_id,warehouse_id FROM ledger UNION SELECT lot_id,warehouse_id FROM inventory_balances) SELECT 1 FROM keys k LEFT JOIN ledger l ON l.lot_id=k.lot_id AND l.warehouse_id=k.warehouse_id LEFT JOIN inventory_balances b ON b.lot_id=k.lot_id AND b.warehouse_id=k.warehouse_id WHERE COALESCE(l.qty,0)!=COALESCE(b.qty,0) OR COALESCE(l.cost,0)!=COALESCE(b.cost,0) LIMIT 1`,
      )
      .get()
    const catalogDifference = this.db
      .prepare(
        `WITH totals AS(SELECT l.variant_id,b.warehouse_id,sum(b.qty) qty,sum(b.cost) cost FROM inventory_balances b JOIN inventory_lots l ON l.id=b.lot_id GROUP BY l.variant_id,b.warehouse_id), keys AS(SELECT variant_id,warehouse_id FROM totals UNION SELECT variant_id,warehouse_id FROM stock_levels) SELECT 1 FROM keys k LEFT JOIN totals t ON t.variant_id=k.variant_id AND t.warehouse_id=k.warehouse_id LEFT JOIN stock_levels s ON s.variant_id=k.variant_id AND s.warehouse_id=k.warehouse_id WHERE COALESCE(t.qty,0)!=COALESCE(s.qty,0) OR COALESCE(t.cost,0)!=COALESCE(s.cost,0) LIMIT 1`,
      )
      .get()
    return !ledgerDifference && !catalogDifference
  }
  state(user: User) {
    const balances = this.db
      .prepare(balanceQuery + ' ORDER BY p.name,l.batch,l.serial')
      .all() as InventoryBalance[]
    const reconciled = this.reconciles()
    return {
      user,
      settings: Object.fromEntries(
        (
          this.db
            .prepare(
              "SELECT key,value FROM settings WHERE key IN('businessName','phone','address','currency','language','receiptFooter','taxBps')",
            )
            .all() as { key: string; value: string }[]
        ).map((r) => [r.key, r.value]),
      ),
      products: this.db
        .prepare(inventoryProductQuery + ' ORDER BY p.name,v.sku')
        .all() as Product[],
      warehouses: this.db.prepare('SELECT id,name FROM warehouses ORDER BY name').all() as {
        id: string
        name: string
      }[],
      balances,
      documents: this.db
        .prepare(docQuery + ' ORDER BY at DESC,id DESC LIMIT 1000')
        .all() as InventoryDocument[],
      reconciled,
      users:
        user.role === 'admin'
          ? (this.db
              .prepare('SELECT id,username,name,role,active FROM users ORDER BY name')
              .all() as User[])
          : [],
      audit:
        user.role === 'admin'
          ? (this.db
              .prepare(
                'SELECT a.*,u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.at DESC LIMIT 300',
              )
              .all() as Audit[])
          : [],
    }
  }
  get(id: string) {
    const document = this.db.prepare(docQuery + ' WHERE id=?').get(id) as
      InventoryDocument | undefined
    if (!document) throw new Error('المستند غير موجود')
    return {
      document,
      observations: this.db
        .prepare(
          'SELECT o.expected_qty AS expectedQty,o.expected_cost AS expectedCost,o.actual_qty AS actualQty,o.difference,l.batch,l.serial,p.name FROM inventory_count_observations o JOIN inventory_lots l ON l.id=o.lot_id JOIN variants v ON v.id=l.variant_id JOIN products p ON p.id=v.product_id WHERE o.document_id=? ORDER BY o.rowid',
        )
        .all(id) as {
        expectedQty: number
        expectedCost: number
        actualQty: number
        difference: number
        batch: string
        serial: string
        name: string
      }[],
      entries: this.db
        .prepare(
          'SELECT e.*,l.variant_id AS variantId,l.batch,l.serial,l.expiry,p.name,v.sku,w.name AS warehouse FROM inventory_entries e JOIN inventory_lots l ON l.id=e.lot_id JOIN variants v ON v.id=l.variant_id JOIN products p ON p.id=v.product_id JOIN warehouses w ON w.id=e.warehouse_id WHERE document_id=? ORDER BY e.rowid',
        )
        .all(id) as (InventoryBalance & { warehouse: string })[],
    }
  }
  private warehouse(id: string) {
    if (!this.db.prepare('SELECT id FROM warehouses WHERE id=?').get(id))
      throw new Error('المخزن غير موجود')
  }
  private lot(line: InventoryLine, kind: string) {
    if (
      !this.db
        .prepare(
          'SELECT v.id FROM variants v JOIN products p ON p.id=v.product_id WHERE v.id=? AND p.active=1',
        )
        .get(line.variantId)
    )
      throw new Error('الصنف غير موجود أو متوقف')
    let lot = this.db
      .prepare('SELECT id,expiry FROM inventory_lots WHERE variant_id=? AND batch=? AND serial=?')
      .get(line.variantId, line.batch, line.serial) as
      { id: string; expiry: string | null } | undefined
    if (kind === 'receipt') {
      if (
        line.serial &&
        this.db.prepare('SELECT id FROM inventory_lots WHERE serial=?').get(line.serial)
      )
        throw new Error('الرقم التسلسلي مسجل بالفعل')
      if (line.expiry && !line.batch) throw new Error('تاريخ الصلاحية يحتاج رقم تشغيلة')
      if (lot && lot.expiry !== (line.expiry ?? null))
        throw new Error('صلاحية التشغيلة ثابتة؛ اختر تشغيلة مختلفة')
      if (!lot) {
        lot = { id: ulid(), expiry: line.expiry ?? null }
        this.db
          .prepare('INSERT INTO inventory_lots VALUES(?,?,?,?,?)')
          .run(lot.id, line.variantId, line.batch, line.serial, lot.expiry)
      }
    }
    if (!lot) throw new Error('التشغيلة أو الرقم التسلسلي غير مسجل')
    if (kind === 'issue' && lot.expiry && lot.expiry < localDay())
      throw new Error('التشغيلة منتهية الصلاحية؛ استخدم الجرد لتوثيق الهالك')
    return lot
  }
  private move(docId: string, lotId: string, warehouseId: string, qty: number, cost: number) {
    if (qty === 0) {
      if (cost !== 0) throw new Error('لا تغير التكلفة دون كمية')
      return
    }
    const current = this.db
      .prepare('SELECT qty,cost FROM inventory_balances WHERE lot_id=? AND warehouse_id=?')
      .get(lotId, warehouseId) as { qty: number; cost: number } | undefined
    const nextQty = safe((current?.qty ?? 0) + qty),
      nextCost = safe((current?.cost ?? 0) + cost)
    if (nextQty < 0 || nextCost < 0 || (nextQty === 0 && nextCost !== 0))
      throw new Error('المخزون المتاح لا يكفي')
    this.db
      .prepare(
        'INSERT INTO inventory_balances VALUES(?,?,?,?) ON CONFLICT(lot_id,warehouse_id) DO UPDATE SET qty=excluded.qty,cost=excluded.cost',
      )
      .run(lotId, warehouseId, nextQty, nextCost)
    this.db
      .prepare('INSERT INTO inventory_entries VALUES(?,?,?,?,?,?)')
      .run(ulid(), docId, lotId, warehouseId, qty, cost)
    const variant = (
      this.db.prepare('SELECT variant_id FROM inventory_lots WHERE id=?').get(lotId) as {
        variant_id: string
      }
    ).variant_id
    const total = this.db
      .prepare(
        'SELECT COALESCE(sum(b.qty),0) qty,COALESCE(sum(b.cost),0) cost FROM inventory_balances b JOIN inventory_lots l ON l.id=b.lot_id WHERE l.variant_id=? AND warehouse_id=?',
      )
      .get(variant, warehouseId) as { qty: number; cost: number }
    safe(total.qty)
    safe(total.cost)
    this.db
      .prepare(
        'INSERT INTO stock_levels VALUES(?,?,?,?) ON CONFLICT(variant_id,warehouse_id) DO UPDATE SET qty=excluded.qty,cost=excluded.cost',
      )
      .run(variant, warehouseId, total.qty, total.cost)
  }
  private post(d: any, user: User) {
    if (!this.reconciles())
      throw new Error('الأرصدة لا تطابق سجل الحركة؛ راجع النسخة الاحتياطية قبل تسجيل حركة جديدة')
    this.warehouse(d.warehouseId)
    if (d.kind === 'transfer') {
      if (!d.destinationId || d.destinationId === d.warehouseId)
        throw new Error('اختر مخزن وجهة مختلفًا')
      this.warehouse(d.destinationId)
    } else if (d.destinationId) throw new Error('الوجهة تخص التحويل فقط')
    if (
      new Set(d.lines.map((l: InventoryLine) => JSON.stringify([l.variantId, l.batch, l.serial])))
        .size !== d.lines.length
    )
      throw new Error('الصنف والتشغيلة مكرران؛ ادمج الكمية')
    this.db
      .prepare(
        "INSERT INTO sequences VALUES('inventory',1) ON CONFLICT(kind) DO UPDATE SET value=value+1",
      )
      .run()
    const seq = (
      this.db.prepare("SELECT value FROM sequences WHERE kind='inventory'").get() as {
        value: number
      }
    ).value
    const docId = ulid()
    this.db
      .prepare('INSERT INTO inventory_documents VALUES(?,?,?,?,?,?,?,?)')
      .run(
        docId,
        'WH-' + String(seq).padStart(6, '0'),
        d.kind,
        d.warehouseId,
        d.destinationId ?? null,
        d.note,
        user.id,
        Date.now(),
      )
    for (const line of d.lines as InventoryLine[]) {
      if (d.kind !== 'count' && line.qty === 0) throw new Error('أدخل كمية أكبر من صفر')
      if (line.serial && line.qty !== 1000 && !(d.kind === 'count' && line.qty === 0))
        throw new Error('كل رقم تسلسلي يخص وحدة واحدة')
      if (d.kind !== 'receipt' && line.expiry !== undefined)
        throw new Error('الصلاحية تسجل مع الاستلام فقط')
      if (d.kind !== 'count' && (line.expectedQty !== undefined || line.expectedCost !== undefined))
        throw new Error('الرصيد المتوقع يخص الجرد')
      if ((d.kind === 'issue' || d.kind === 'transfer') && line.cost !== undefined)
        throw new Error('تكلفة الصرف والتحويل يحسبها البرنامج')
      const lot = this.lot(line, d.kind)
      const current = this.db
        .prepare('SELECT qty,cost FROM inventory_balances WHERE lot_id=? AND warehouse_id=?')
        .get(lot.id, d.warehouseId) as { qty: number; cost: number } | undefined
      const q = current?.qty ?? 0,
        c = current?.cost ?? 0
      const take = (n: number) => {
        if (n > q || q === 0) throw new Error('المخزون المتاح لا يكفي')
        return CostBasis.create(Money.fromPiastres(c), Quantity.fromMilliUnits(q)).take(
          Quantity.fromMilliUnits(n),
        ).cost as number
      }
      if (d.kind === 'receipt') {
        if (line.cost === undefined) throw new Error('أدخل تكلفة الاستلام الإجمالية')
        this.move(docId, lot.id, d.warehouseId, line.qty, line.cost)
      } else if (d.kind === 'count') {
        if (line.expectedQty !== q || line.expectedCost !== c)
          throw new Error('الرصيد تغير أثناء الجرد؛ حدّث العرض وأعد العد')
        const diff = line.qty - q
        this.db
          .prepare('INSERT INTO inventory_count_observations VALUES(?,?,?,?,?,?,?,?)')
          .run(ulid(), docId, lot.id, d.warehouseId, q, c, line.qty, diff)
        if (line.serial && diff > 0) throw new Error('إضافة رقم تسلسلي تتم من الاستلام')
        if (diff > 0) {
          if (line.cost === undefined) throw new Error('أدخل تكلفة كمية الزيادة')
          this.move(docId, lot.id, d.warehouseId, diff, line.cost)
        } else if (diff < 0) {
          if (line.cost !== undefined) throw new Error('تكلفة العجز يحسبها البرنامج')
          this.move(docId, lot.id, d.warehouseId, diff, -take(-diff))
        } else if (line.cost !== undefined && line.cost !== 0)
          throw new Error('لا تغير التكلفة دون فرق كمية')
      } else {
        const cost = take(line.qty)
        this.move(docId, lot.id, d.warehouseId, -line.qty, -cost)
        if (d.kind === 'transfer') this.move(docId, lot.id, d.destinationId, line.qty, cost)
      }
    }
    return this.get(docId)
  }
  report(d: { from: string; to: string; warehouseId?: string; variantId?: string }) {
    if (d.from > d.to) throw new Error('راجع نطاق التقرير')
    const where = ['d.at>=?', 'd.at<?'],
      args: any[] = [
        new Date(d.from + 'T00:00:00').getTime(),
        (() => {
          const end = new Date(d.to + 'T00:00:00')
          end.setDate(end.getDate() + 1)
          end.setHours(0, 0, 0, 0)
          return end.getTime()
        })(),
      ]
    if (d.warehouseId) {
      where.push('e.warehouse_id=?')
      args.push(d.warehouseId)
    }
    if (d.variantId) {
      where.push('l.variant_id=?')
      args.push(d.variantId)
    }
    return {
      rows: this.db
        .prepare(
          'SELECT d.number,d.kind,d.at,d.note,p.name,v.sku,l.batch,l.serial,w.name AS warehouse,e.qty,e.cost FROM inventory_entries e JOIN inventory_documents d ON d.id=e.document_id JOIN inventory_lots l ON l.id=e.lot_id JOIN variants v ON v.id=l.variant_id JOIN products p ON p.id=v.product_id JOIN warehouses w ON w.id=e.warehouse_id WHERE ' +
            where.join(' AND ') +
            ' ORDER BY d.at,e.rowid',
        )
        .all(...args) as {
        number: string
        kind: string
        at: number
        note: string
        name: string
        sku: string
        batch: string
        serial: string
        warehouse: string
        qty: number
        cost: number
      }[],
    }
  }
  call(action: string, input: unknown, user: User) {
    const schema = inventorySchemas[action as keyof typeof inventorySchemas]
    if (!schema) throw new Error('العملية غير متاحة')
    const d = schema.parse(input) as any
    if (action === 'inventory.state') return this.state(user)
    if (action === 'inventory.document.get') return this.get(d.id)
    if (action === 'inventory.report') return this.report(d)
    if (user.role !== 'admin' && user.role !== 'manager')
      throw new Error('ليس لديك صلاحية لتعديل المخزون')
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
      let result
      if (action === 'inventory.warehouse.save') {
        const id = d.id ?? ulid()
        if (d.id && !this.db.prepare('SELECT id FROM warehouses WHERE id=?').get(id))
          throw new Error('المخزن غير موجود')
        this.db
          .prepare(
            'INSERT INTO warehouses VALUES(?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name',
          )
          .run(id, d.name)
        result = { id }
      } else result = this.post(d, user)
      this.identity.audit(user.id, action, 'document' in result ? result.document.id : result.id)
      this.db
        .prepare('INSERT INTO commands VALUES(?,?,?,?,?)')
        .run(d.clientTxnId, action, user.id, requestHash, JSON.stringify(result))
      return result
    })()
  }
}
