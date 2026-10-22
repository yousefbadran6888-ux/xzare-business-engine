import { Money, basisPoints, ulid } from '@xzare/core'
import { Barcode } from '@xzare/barcode'
import type { XzareDatabase } from '@xzare/db'
import { Identity } from './identity.js'
import { fingerprint } from './commerce.js'
import { clinicToday, clinicDayBounds } from './clinic-time.js'
import {
  pharmacySchemas,
  type PharmacyMedicine,
  type PharmacySupplier,
  type PharmacyLot,
  type PharmacySale,
  type PharmacyState,
  type PharmacySaleDetail,
  type PharmacyDocument,
} from './pharmacy-validation.js'
import type { User, Audit } from './types.js'
const medicineQuery = `SELECT id,code,name,ingredient,strength,form,unit,manufacturer,price,reorder_qty AS reorderQty,COALESCE(barcode,'') AS barcode,format,active,version FROM pharmacy_medicines`
const lotQuery = `SELECT l.id,l.medicine_id AS medicineId,m.name,m.unit,l.batch,l.expiry,s.status,s.version,COALESCE(b.qty,0) qty,COALESCE(b.cost,0) cost,COALESCE(q.qty,0) AS quarantineQty,COALESCE(q.cost,0) AS quarantineCost FROM pharmacy_lots l JOIN pharmacy_medicines m ON m.id=l.medicine_id JOIN pharmacy_lot_status s ON s.lot_id=l.id LEFT JOIN pharmacy_balances b ON b.lot_id=l.id AND b.bucket='available' LEFT JOIN pharmacy_balances q ON q.lot_id=l.id AND q.bucket='quarantine'`
const saleQuery = `SELECT s.id,d.number,s.customer,d.note,d.at,s.subtotal,s.discount,s.tax_bps AS taxBps,s.tax,s.total,COALESCE((SELECT sum(credit) FROM pharmacy_returns r WHERE r.sale_id=s.id),0) credit,COALESCE((SELECT sum(amount) FROM pharmacy_payments p WHERE p.sale_id=s.id),0) paid FROM pharmacy_sales s JOIN pharmacy_documents d ON d.id=s.id`
const safe = (n: number) => {
  if (!Number.isSafeInteger(n) || Math.abs(n) > 1e12) throw new Error('القيمة تجاوزت الحد الآمن')
  return n
}
const part = (value: number, n: number, den: number) => {
  if (!den) return 0
  return safe(Number((BigInt(value) * BigInt(n) + BigInt(Math.floor(den / 2))) / BigInt(den)))
}
const manager = (u: User) => u.role === 'admin' || u.role === 'manager'
export class Pharmacy {
  constructor(
    readonly db: XzareDatabase,
    readonly identity: Identity,
  ) {}
  private row<T>(sql: string, ...args: any[]): T {
    return this.db.prepare(sql).get(...args) as T
  }
  private rows<T>(sql: string, ...args: any[]): T[] {
    return this.db.prepare(sql).all(...args) as T[]
  }
  private reconciles() {
    return (
      !this.row(
        `WITH ledger AS(SELECT lot_id,bucket,sum(qty) qty,sum(cost) cost FROM pharmacy_entries GROUP BY lot_id,bucket),keys AS(SELECT lot_id,bucket FROM ledger UNION SELECT lot_id,bucket FROM pharmacy_balances) SELECT 1 FROM keys k LEFT JOIN ledger l ON l.lot_id=k.lot_id AND l.bucket=k.bucket LEFT JOIN pharmacy_balances b ON b.lot_id=k.lot_id AND b.bucket=k.bucket WHERE COALESCE(l.qty,0)!=COALESCE(b.qty,0) OR COALESCE(l.cost,0)!=COALESCE(b.cost,0) LIMIT 1`,
      ) &&
      !this.row(
        `SELECT 1 FROM pharmacy_sales s WHERE s.total<COALESCE((SELECT sum(credit) FROM pharmacy_returns r WHERE r.sale_id=s.id),0) OR COALESCE((SELECT sum(amount) FROM pharmacy_payments p WHERE p.sale_id=s.id),0)<0 OR COALESCE((SELECT sum(amount) FROM pharmacy_payments p WHERE p.sale_id=s.id),0)>s.total-COALESCE((SELECT sum(credit) FROM pharmacy_returns r WHERE r.sale_id=s.id),0) LIMIT 1`,
      )
    )
  }
  private medicine(id: string) {
    const m = this.row<PharmacyMedicine | undefined>(medicineQuery + ' WHERE id=?', id)
    if (!m) throw new Error('الدواء غير موجود')
    return {
      ...m,
      alternativeIds: this.rows<{ alternative_id: string }>(
        'SELECT alternative_id FROM pharmacy_alternatives WHERE medicine_id=?',
        id,
      ).map((x) => x.alternative_id),
      availableQty: this.row<{ qty: number }>(
        `SELECT COALESCE(sum(b.qty),0) qty FROM pharmacy_balances b JOIN pharmacy_lots l ON l.id=b.lot_id JOIN pharmacy_lot_status s ON s.lot_id=l.id WHERE l.medicine_id=? AND b.bucket='available' AND s.status='available' AND l.expiry>?`,
        id,
        clinicToday(),
      ).qty,
    }
  }
  private lot(id: string) {
    const b = this.row<PharmacyLot | undefined>(lotQuery + ' WHERE l.id=?', id)
    if (!b) throw new Error('التشغيلة غير موجودة')
    return b
  }
  private sale(id: string) {
    const s = this.row<Omit<PharmacySale, 'balance'> | undefined>(saleQuery + ' WHERE s.id=?', id)
    if (!s) throw new Error('الفاتورة غير موجودة')
    return { ...s, balance: safe(s.total - s.credit - s.paid) }
  }
  private doc(id: string) {
    const d = this.row<any>(
      'SELECT id,number,kind,note,reference,at,supplier_snapshot FROM pharmacy_documents WHERE id=?',
      id,
    )
    if (!d) throw new Error('المستند غير موجود')
    return {
      id: d.id,
      number: d.number,
      kind: d.kind,
      note: d.note,
      reference: d.reference,
      at: d.at,
      supplier: d.supplier_snapshot ? JSON.parse(d.supplier_snapshot) : null,
    } as PharmacyDocument
  }
  state(u: User): PharmacyState {
    return {
      user: u,
      settings: Object.fromEntries(
        this.rows<{ key: string; value: string }>(
          `SELECT key,value FROM settings WHERE key IN('businessName','phone','address','currency','language','receiptFooter','taxBps')`,
        ).map((x) => [x.key, x.value]),
      ),
      medicines: this.rows<{ id: string }>('SELECT id FROM pharmacy_medicines ORDER BY name').map(
        (x) => this.medicine(x.id),
      ),
      suppliers: manager(u)
        ? this.rows<PharmacySupplier>(
            'SELECT id,name,phone,address,active,version FROM pharmacy_suppliers ORDER BY name',
          )
        : [],
      lots: this.rows<PharmacyLot>(lotQuery + ' ORDER BY l.expiry,m.name,l.batch').map((b) =>
        manager(u) ? b : { ...b, cost: 0, quarantineCost: 0 },
      ),
      sales: this.rows<{ id: string }>(
        saleQuery + ' ORDER BY d.at DESC,d.rowid DESC LIMIT 1000',
      ).map((x) => this.sale(x.id)),
      documents: manager(u)
        ? this.rows<{ id: string }>(
            'SELECT id FROM pharmacy_documents ORDER BY at DESC,rowid DESC LIMIT 1000',
          ).map((x) => this.doc(x.id))
        : [],
      users:
        u.role === 'admin'
          ? this.rows<User>('SELECT id,username,name,role,active FROM users ORDER BY name')
          : [],
      audit:
        u.role === 'admin'
          ? this.rows<Audit>(
              'SELECT a.*,u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.at DESC LIMIT 300',
            )
          : [],
      reconciled: this.reconciles(),
      today: clinicToday(),
    }
  }
  get(id: string, u: User): PharmacySaleDetail {
    const sale = this.sale(id),
      lines = this.rows<any>(
        'SELECT id,medicine_id AS medicineId,snapshot,qty,price,value FROM pharmacy_sale_lines WHERE sale_id=? ORDER BY rowid',
        id,
      ).map((x) => ({
        ...JSON.parse(x.snapshot),
        id: x.id,
        medicineId: x.medicineId,
        qty: x.qty,
        price: x.price,
        value: x.value,
      }))
    const allocations = this.rows<any>(
      `SELECT a.*,l.line_id AS unused FROM pharmacy_allocations a JOIN (SELECT id AS line_id FROM pharmacy_sale_lines WHERE sale_id=?) l ON l.line_id=a.line_id ORDER BY a.rowid`,
      id,
    ).map((a) => {
      const b = this.lot(a.lot_id),
        line = lines.find((x) => x.id === a.line_id)
      return {
        id: a.id,
        lineId: a.line_id,
        lotId: b.id,
        batch: b.batch,
        expiry: b.expiry,
        name: line.name,
        unit: line.unit,
        qty: a.qty,
        cost: manager(u) ? a.cost : 0,
        value: a.value,
        returnedQty: this.row<{ q: number }>(
          'SELECT COALESCE(sum(qty),0) q FROM pharmacy_return_lines WHERE allocation_id=?',
          a.id,
        ).q,
      }
    })
    return {
      sale,
      lines,
      allocations,
      payments: this.rows(
        'SELECT id,amount,at,method,reference FROM pharmacy_payments WHERE sale_id=? ORDER BY rowid',
        id,
      ),
      returns: this.rows(
        'SELECT r.id,d.number,r.credit,r.refunded,d.note,d.at FROM pharmacy_returns r JOIN pharmacy_documents d ON d.id=r.id WHERE r.sale_id=? ORDER BY d.rowid',
        id,
      ),
    }
  }
  document(id: string) {
    const d = this.doc(id)
    return {
      document: d,
      entries: this.rows<any>(
        'SELECT e.*,l.batch,l.expiry FROM pharmacy_entries e JOIN pharmacy_lots l ON l.id=e.lot_id WHERE document_id=? ORDER BY e.rowid',
        id,
      ).map((x) => ({ ...x, ...JSON.parse(x.snapshot), snapshot: undefined })),
      events: this.rows<any>(
        'SELECT e.status,e.version,l.batch FROM pharmacy_status_events e JOIN pharmacy_lots l ON l.id=e.lot_id WHERE e.document_id=?',
        id,
      ),
    }
  }
  report(d: { from: string; to: string }, u: User) {
    if (!manager(u)) throw new Error('ليس لديك صلاحية للتقارير')
    if (d.from > d.to) throw new Error('راجع نطاق التقرير')
    const { lo: from, hi: to } = clinicDayBounds(d.from, d.to)
    return {
      sales: this.rows<{ id: string }>(
        saleQuery + ' WHERE d.at>=? AND d.at<? ORDER BY d.at',
        from,
        to,
      ).map((x) => this.sale(x.id)),
      payments: this.rows<any>(
        'SELECT p.amount,p.method,p.reference,p.at,d.number FROM pharmacy_payments p JOIN pharmacy_documents d ON d.id=p.sale_id WHERE p.at>=? AND p.at<? ORDER BY p.at',
        from,
        to,
      ),
      movements: this.rows<any>(
        'SELECT d.number,d.kind,d.at,d.note,e.qty,e.cost,e.bucket,e.snapshot,l.batch,l.expiry FROM pharmacy_entries e JOIN pharmacy_documents d ON d.id=e.document_id JOIN pharmacy_lots l ON l.id=e.lot_id WHERE d.at>=? AND d.at<? ORDER BY d.at,e.rowid',
        from,
        to,
      ).map((x) => ({ ...x, ...JSON.parse(x.snapshot), snapshot: undefined })),
      lots: this.rows<PharmacyLot>(lotQuery + ' ORDER BY l.expiry'),
    }
  }
  private version(current: { version: number }, v: unknown) {
    if (v !== current.version) throw new Error('البيانات تغيرت؛ حدّث العرض وأعد المحاولة')
  }
  private newDoc(
    kind: string,
    u: User,
    note: string,
    reference = '',
    supplier: PharmacySupplier | null = null,
  ) {
    this.db
      .prepare(
        `INSERT INTO sequences VALUES('pharmacy',1) ON CONFLICT(kind) DO UPDATE SET value=value+1`,
      )
      .run()
    const n = this.row<{ value: number }>(
        `SELECT value FROM sequences WHERE kind='pharmacy'`,
      ).value,
      id = ulid()
    this.db
      .prepare('INSERT INTO pharmacy_documents VALUES(?,?,?,?,?,?,?,?)')
      .run(
        id,
        'PH-' + String(n).padStart(6, '0'),
        kind,
        supplier ? JSON.stringify(supplier) : null,
        note,
        reference,
        u.id,
        Date.now(),
      )
    return id
  }
  private balance(id: string, bucket: string) {
    return (
      this.row<{ qty: number; cost: number }>(
        'SELECT qty,cost FROM pharmacy_balances WHERE lot_id=? AND bucket=?',
        id,
        bucket,
      ) ?? { qty: 0, cost: 0 }
    )
  }
  private move(doc: string, lotId: string, bucket: string, qty: number, cost: number) {
    const old = this.balance(lotId, bucket),
      q = safe(old.qty + qty),
      c = safe(old.cost + cost)
    if (q < 0 || q > 1e9 || c < 0 || (q === 0 && c !== 0)) throw new Error('المخزون المتاح لا يكفي')
    if (!qty) throw new Error('أدخل كمية أكبر من صفر')
    const b = this.lot(lotId)
    this.db
      .prepare(
        'INSERT INTO pharmacy_balances VALUES(?,?,?,?) ON CONFLICT(lot_id,bucket) DO UPDATE SET qty=excluded.qty,cost=excluded.cost',
      )
      .run(lotId, bucket, q, c)
    this.db
      .prepare('INSERT INTO pharmacy_entries VALUES(?,?,?,?,?,?,?)')
      .run(ulid(), doc, lotId, bucket, qty, cost, JSON.stringify({ name: b.name, unit: b.unit }))
  }
  private pay(
    id: string,
    amount: number,
    method: string,
    reference: string,
    u: User,
    returnId: string | null = null,
  ) {
    if (!returnId && (amount <= 0 || amount > this.sale(id).balance))
      throw new Error('المبلغ أكبر من المتبقي')
    this.db
      .prepare('INSERT INTO pharmacy_payments VALUES(?,?,?,?,?,?,?,?)')
      .run(ulid(), id, returnId, amount, method, reference, u.id, Date.now())
  }
  private saveMedicine(d: any) {
    if (d.barcode && !Barcode.parse(d.barcode, d.format).ok)
      throw new Error('الباركود لا يوافق الصيغة المختارة')
    const old = d.id ? this.medicine(d.id) : null
    if (old) {
      this.version(old, d.version)
      if (
        old.unit !== d.unit &&
        this.row('SELECT id FROM pharmacy_lots WHERE medicine_id=? LIMIT 1', d.id)
      )
        throw new Error('وحدة الدواء مستخدمة في مخزون؛ أنشئ صنفًا جديدًا')
    } else if (d.version !== undefined) throw new Error('الإصدار يخص التعديل')
    const id = d.id ?? ulid()
    for (const a of d.alternativeIds) {
      if (a === id) throw new Error('لا تربط الدواء بنفسه')
      this.medicine(a)
    }
    this.db
      .prepare(
        'INSERT INTO pharmacy_medicines VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET code=excluded.code,name=excluded.name,ingredient=excluded.ingredient,strength=excluded.strength,form=excluded.form,unit=excluded.unit,manufacturer=excluded.manufacturer,price=excluded.price,reorder_qty=excluded.reorder_qty,barcode=excluded.barcode,format=excluded.format,active=excluded.active,version=pharmacy_medicines.version+1',
      )
      .run(
        id,
        d.code,
        d.name,
        d.ingredient,
        d.strength,
        d.form,
        d.unit,
        d.manufacturer,
        d.price,
        d.reorderQty,
        d.barcode || null,
        d.format,
        Number(d.active),
        0,
      )
    this.db.prepare('DELETE FROM pharmacy_alternatives WHERE medicine_id=?').run(id)
    for (const a of d.alternativeIds)
      this.db.prepare('INSERT INTO pharmacy_alternatives VALUES(?,?)').run(id, a)
    return id
  }
  private receive(d: any, u: User) {
    const supplier = this.row<PharmacySupplier>(
      'SELECT * FROM pharmacy_suppliers WHERE id=? AND active=1',
      d.supplierId,
    )
    if (!supplier) throw new Error('المورد غير موجود أو متوقف')
    if (new Set(d.lines.map((x: any) => x.medicineId + '|' + x.batch)).size !== d.lines.length)
      throw new Error('التشغيلة مكررة؛ ادمج الكمية')
    const id = this.newDoc('receipt', u, d.note, d.reference, supplier)
    for (const x of d.lines) {
      const m = this.medicine(x.medicineId)
      if (!m.active) throw new Error('الدواء متوقف')
      if (x.expiry <= clinicToday()) throw new Error('تاريخ الصلاحية يجب أن يكون بعد اليوم')
      let b = this.row<{ id: string; expiry: string }>(
        'SELECT id,expiry FROM pharmacy_lots WHERE medicine_id=? AND batch=?',
        x.medicineId,
        x.batch,
      )
      if (b && b.expiry !== x.expiry) throw new Error('صلاحية التشغيلة ثابتة؛ راجع رقم التشغيلة')
      if (!b) {
        b = { id: ulid(), expiry: x.expiry }
        this.db
          .prepare('INSERT INTO pharmacy_lots VALUES(?,?,?,?)')
          .run(b.id, m.id, x.batch, x.expiry)
        this.db.prepare('INSERT INTO pharmacy_lot_status VALUES(?,?,0)').run(b.id, 'available')
      }
      if (this.lot(b.id).status !== 'available')
        throw new Error('التشغيلة موقوفة؛ راجع حالة العزل أو السحب')
      this.move(id, b.id, 'available', x.qty, x.cost)
    }
    return id
  }
  private postSale(d: any, u: User) {
    if (new Set(d.lines.map((x: any) => x.medicineId)).size !== d.lines.length)
      throw new Error('الدواء مكرر؛ ادمج الكمية')
    const items = d.lines.map((x: any) => {
      const m = this.medicine(x.medicineId)
      if (!m.active) throw new Error('الدواء متوقف')
      const lots = this.rows<PharmacyLot>(
        lotQuery +
          ` WHERE l.medicine_id=? AND l.expiry>? AND s.status='available' AND b.qty>0 ORDER BY l.expiry,l.id`,
        m.id,
        clinicToday(),
      )
      if (lots.reduce((n, b) => safe(n + b.qty), 0) < x.qty)
        throw new Error('المخزون المتاح الآمن لا يكفي')
      return { m, qty: x.qty, subtotal: safe(m.price * x.qty), lots }
    })
    const subtotal = items.reduce((n: any, x: any) => safe(n + x.subtotal), 0)
    if (d.discount > subtotal) throw new Error('الخصم أكبر من قيمة الفاتورة')
    const base = subtotal - d.discount,
      tax = Money.applyRate(Money.fromPiastres(base), basisPoints(d.taxBps)) as number,
      total = safe(base + tax)
    if (d.paid > total) throw new Error('المدفوع أكبر من قيمة الفاتورة')
    const id = this.newDoc('sale', u, d.note, d.reference)
    this.db
      .prepare('INSERT INTO pharmacy_sales VALUES(?,?,?,?,?,?,?)')
      .run(id, d.customer, subtotal, d.discount, d.taxBps, tax, total)
    let cumulative = 0,
      previous = 0
    for (const x of items) {
      cumulative += x.subtotal
      const value = part(total, cumulative, subtotal) - previous
      previous += value
      const lineId = ulid()
      this.db
        .prepare('INSERT INTO pharmacy_sale_lines VALUES(?,?,?,?,?,?,?)')
        .run(lineId, id, x.m.id, JSON.stringify(x.m), x.qty, x.m.price, value)
      let remaining = x.qty,
        taken = 0,
        revenue = 0
      for (const b of x.lots) {
        if (!remaining) break
        const q = Math.min(remaining, b.qty),
          cost = part(b.cost, q, b.qty),
          v = part(value, taken + q, x.qty) - revenue
        this.move(id, b.id, 'available', -q, -cost)
        this.db
          .prepare('INSERT INTO pharmacy_allocations VALUES(?,?,?,?,?,?)')
          .run(ulid(), lineId, b.id, q, cost, v)
        remaining -= q
        taken += q
        revenue += v
      }
    }
    if (d.paid) this.pay(id, d.paid, d.method, d.reference, u)
    return id
  }
  private returnSale(d: any, u: User) {
    const original = this.sale(d.id)
    const items = d.allocations.map((x: any) => {
      const a = this.row<any>(
        'SELECT a.* FROM pharmacy_allocations a JOIN pharmacy_sale_lines l ON l.id=a.line_id WHERE a.id=? AND l.sale_id=?',
        x.id,
        d.id,
      )
      if (!a) throw new Error('التشغيلة لا تخص الفاتورة')
      const returned = this.row<{ qty: number; cost: number; value: number }>(
        'SELECT COALESCE(sum(qty),0) qty,COALESCE(sum(cost),0) cost,COALESCE(sum(value),0) value FROM pharmacy_return_lines WHERE allocation_id=?',
        a.id,
      )
      if (x.qty > a.qty - returned.qty) throw new Error('كمية المرتجع أكبر من المتبقي في الفاتورة')
      return {
        a,
        qty: x.qty,
        cost: part(a.cost, returned.qty + x.qty, a.qty) - returned.cost,
        value: part(a.value, returned.qty + x.qty, a.qty) - returned.value,
      }
    })
    const credit = items.reduce((n: number, x: any) => safe(n + x.value), 0),
      refund = Math.max(0, original.paid - (original.total - original.credit - credit))
    const id = this.newDoc('return', u, d.reason, d.reference)
    this.db.prepare('INSERT INTO pharmacy_returns VALUES(?,?,?,?)').run(id, d.id, credit, refund)
    for (const x of items) {
      this.db
        .prepare('INSERT INTO pharmacy_return_lines VALUES(?,?,?,?,?,?)')
        .run(ulid(), id, x.a.id, x.qty, x.cost, x.value)
      this.move(id, x.a.lot_id, 'quarantine', x.qty, x.cost)
    }
    if (refund) this.pay(d.id, -refund, d.method, d.reference, u, id)
    return id
  }
  call(action: string, input: unknown, u: User) {
    const schema = pharmacySchemas[action as keyof typeof pharmacySchemas]
    if (!schema) throw new Error('العملية غير متاحة')
    const d = schema.parse(input) as any
    if (action === 'pharmacy.state') return this.state(u)
    if (action === 'pharmacy.sale.get') return this.get(d.id, u)
    if (action === 'pharmacy.barcode.lookup') {
      const m = this.row<{ id: string; format: string }>(
        'SELECT id,format FROM pharmacy_medicines WHERE barcode=? AND active=1',
        d.code,
      )
      if (!m || !Barcode.parse(d.code, m.format).ok)
        throw new Error('الباركود غير مسجل أو الدواء متوقف')
      return { medicine: this.medicine(m.id) }
    }
    if (!manager(u) && !['pharmacy.sale.post', 'pharmacy.sale.pay'].includes(action))
      throw new Error('ليس لديك صلاحية لهذه العملية')
    if (action === 'pharmacy.document.get') return this.document(d.id)
    if (action === 'pharmacy.report') return this.report(d, u)
    return this.db.transaction(() => {
      const h = fingerprint(d),
        prev = this.row<{ action: string; user_id: string; request_hash: string; result: string }>(
          'SELECT * FROM commands WHERE client_txn_id=?',
          d.clientTxnId,
        )
      if (prev) {
        if (prev.action !== action || prev.user_id !== u.id || prev.request_hash !== h)
          throw new Error('معرف العملية مستخدم لبيانات مختلفة')
        return JSON.parse(prev.result)
      }
      if (!this.reconciles()) throw new Error('الأرصدة لا تطابق سجل الحركة؛ راجع النسخ الاحتياطية')
      let id: string
      if (action === 'pharmacy.medicine.save') id = this.saveMedicine(d)
      else if (action === 'pharmacy.supplier.save') {
        const old = d.id
          ? this.row<PharmacySupplier>('SELECT * FROM pharmacy_suppliers WHERE id=?', d.id)
          : null
        if (d.id && !old) throw new Error('المورد غير موجود')
        if (old) this.version(old, d.version)
        else if (d.version !== undefined) throw new Error('الإصدار يخص التعديل')
        id = d.id ?? ulid()
        this.db
          .prepare(
            'INSERT INTO pharmacy_suppliers VALUES(?,?,?,?,?,0) ON CONFLICT(id) DO UPDATE SET name=excluded.name,phone=excluded.phone,address=excluded.address,active=excluded.active,version=pharmacy_suppliers.version+1',
          )
          .run(id, d.name, d.phone, d.address, Number(d.active))
      } else if (action === 'pharmacy.receipt.post') id = this.receive(d, u)
      else if (action === 'pharmacy.sale.post') id = this.postSale(d, u)
      else if (action === 'pharmacy.sale.pay') {
        id = d.id
        this.pay(id, d.amount, d.method, d.reference, u)
      } else if (action === 'pharmacy.sale.return') id = this.returnSale(d, u)
      else if (action === 'pharmacy.lot.status') {
        const b = this.lot(d.id)
        this.version(b, d.version)
        if (b.status === d.status) throw new Error('الحالة مسجلة بالفعل')
        id = this.newDoc('status', u, d.reason)
        this.db
          .prepare('UPDATE pharmacy_lot_status SET status=?,version=version+1 WHERE lot_id=?')
          .run(d.status, b.id)
        this.db
          .prepare('INSERT INTO pharmacy_status_events VALUES(?,?,?,?,?)')
          .run(ulid(), id, b.id, d.status, b.version + 1)
      } else if (action === 'pharmacy.lot.dispose') {
        const b = this.lot(d.id),
          bal = this.balance(b.id, d.bucket)
        if (bal.qty !== d.expectedQty || bal.cost !== d.expectedCost)
          throw new Error('الرصيد تغير؛ حدّث العرض')
        if (d.qty > bal.qty) throw new Error('الكمية أكبر من الرصيد')
        id = this.newDoc('dispose', u, d.reason)
        this.move(id, b.id, d.bucket, -d.qty, -part(bal.cost, d.qty, bal.qty))
      } else throw new Error('العملية غير متاحة')
      this.identity.audit(u.id, action, id)
      const result = { id }
      this.db
        .prepare('INSERT INTO commands VALUES(?,?,?,?,?)')
        .run(d.clientTxnId, action, u.id, h, JSON.stringify(result))
      if (!this.reconciles()) throw new Error('الأرصدة لا تطابق سجل الحركة')
      return result
    })()
  }
}
