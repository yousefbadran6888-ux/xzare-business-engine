import { createHash } from 'node:crypto'
import { CostBasis, Money, Quantity, basisPoints, lineTotal, ulid } from '@xzare/core'
import type { XzareDatabase } from '@xzare/db'
import type { Invoice, InvoiceLine, Product, Shift, User } from './types.js'
import { Identity } from './identity.js'
import { schemas, validated } from './validation.js'

export const sum = (values: number[]) => Money.sum(values.map(Money.fromPiastres)) as number
export const fingerprint = (data: unknown) =>
  createHash('sha256').update(JSON.stringify(data)).digest('hex')
export const invoiceQuery = `SELECT *,total-paid-returned+refunded AS balance FROM (
 SELECT i.*,p.name AS party_name,
 COALESCE((SELECT sum(l.cost) FROM invoice_lines l WHERE l.invoice_id=i.id),0)-COALESCE((SELECT sum(rl.cost) FROM return_lines rl JOIN returns r ON r.id=rl.return_id WHERE r.invoice_id=i.id),0) AS cost,
 COALESCE((SELECT sum(amount) FROM payments WHERE invoice_id=i.id),0) AS paid,
 COALESCE((SELECT sum(total) FROM returns WHERE invoice_id=i.id),0) AS returned,
 COALESCE((SELECT sum(refunded) FROM returns WHERE invoice_id=i.id),0) AS refunded
 FROM invoices i LEFT JOIN parties p ON p.id=i.party_id)`
export const productQuery = `SELECT v.id,v.product_id,p.name,v.name AS variant_name,v.sku,v.unit,v.price,v.reorder_qty,p.category,p.active,COALESCE(s.qty,0) AS qty,COALESCE(s.cost,0) AS cost,(SELECT code FROM barcodes b WHERE b.variant_id=v.id LIMIT 1) AS barcode,(SELECT format FROM barcodes b WHERE b.variant_id=v.id LIMIT 1) AS format FROM variants v JOIN products p ON p.id=v.product_id LEFT JOIN stock_levels s ON s.variant_id=v.id`

export class Commerce {
  constructor(
    readonly db: XzareDatabase,
    readonly identity: Identity,
  ) {}
  invoice(id: string): Invoice {
    const row = this.db.prepare(`${invoiceQuery} WHERE id=?`).get(id) as Invoice | undefined
    if (!row) throw new Error('الفاتورة غير موجودة')
    return row
  }
  lines(id: string): InvoiceLine[] {
    return this.db
      .prepare(
        'SELECT l.*,COALESCE((SELECT sum(qty) FROM return_lines WHERE invoice_line_id=l.id),0) AS returned_qty FROM invoice_lines l WHERE l.invoice_id=?',
      )
      .all(id) as InvoiceLine[]
  }
  shift(user: User): Shift {
    const row = this.db
      .prepare(
        'SELECT *,opening+COALESCE((SELECT sum(amount) FROM cash_movements c WHERE c.shift_id=s.id),0) AS expected FROM shifts s WHERE user_id=? AND closed_at IS NULL',
      )
      .get(user.id) as Shift | undefined
    if (!row) throw new Error('افتح وردية قبل إجراء حركة مالية')
    return row
  }
  move(
    user: User,
    variantId: string,
    qty: number,
    cost: number,
    kind: string,
    doc: string,
    note = '',
  ) {
    const warehouse = this.db.prepare('SELECT id FROM warehouses LIMIT 1').get() as { id: string }
    const current = this.db
      .prepare('SELECT qty,cost FROM stock_levels WHERE variant_id=? AND warehouse_id=?')
      .get(variantId, warehouse.id) as { qty: number; cost: number } | undefined
    const nextQty = sum([current?.qty ?? 0, qty]),
      nextCost = sum([current?.cost ?? 0, cost])
    if (nextQty < 0 || nextCost < 0 || (nextQty === 0 && nextCost !== 0))
      throw new Error('المخزون المتاح لا يكفي لهذه الحركة')
    this.db
      .prepare(
        'INSERT INTO stock_levels VALUES(?,?,?,?) ON CONFLICT(variant_id,warehouse_id) DO UPDATE SET qty=excluded.qty,cost=excluded.cost',
      )
      .run(variantId, warehouse.id, nextQty, nextCost)
    this.db
      .prepare('INSERT INTO stock_movements VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(ulid(), variantId, warehouse.id, user.id, qty, cost, kind, doc, Date.now(), note)
  }
  cash(user: User, shiftId: string, amount: number, kind: string, note: string, doc: string) {
    if (amount === 0) return
    if (sum([this.shift(user).expected, amount]) < 0)
      throw new Error('رصيد النقدية لا يكفي؛ راجع الوردية وحركات الخزينة')
    this.db
      .prepare('INSERT INTO cash_movements VALUES(?,?,?,?,?,?,?,?)')
      .run(ulid(), shiftId, user.id, amount, kind, note, doc, Date.now())
  }
  party(partyId: string | null, amount: number, kind: string, doc: string) {
    if (!partyId || amount === 0) return
    const current = this.db
      .prepare('SELECT COALESCE(sum(amount),0) AS balance FROM party_ledger WHERE party_id=?')
      .get(partyId) as { balance: number }
    sum([current.balance, amount])
    this.db
      .prepare('INSERT INTO party_ledger VALUES(?,?,?,?,?,?)')
      .run(ulid(), partyId, amount, kind, doc, Date.now())
  }
  private outgoing(product: Product, qty: number) {
    if (qty > product.qty || product.qty === 0)
      throw new Error(`المخزون لا يكفي للصنف: ${product.name}`)
    return CostBasis.create(
      Money.fromPiastres(product.cost),
      Quantity.fromMilliUnits(product.qty),
    ).take(Quantity.fromMilliUnits(qty)).cost as number
  }
  post(user: User, input: unknown) {
    const data = validated(schemas['invoice.post'], input)
    if (data.kind === 'purchase' && user.role === 'cashier')
      throw new Error('ليس لديك صلاحية تسجيل المشتريات')
    const configuredTax = this.db
      .prepare("SELECT value FROM settings WHERE key='taxBps'")
      .get() as { value: string }
    if (user.role === 'cashier' && data.taxBps !== Number(configuredTax.value))
      throw new Error('تغيير الضريبة يحتاج صلاحية مدير')
    const requestHash = fingerprint(data)
    return this.db.transaction(() => {
      const previous = this.db
        .prepare('SELECT id,request_hash,user_id FROM invoices WHERE client_txn_id=?')
        .get(data.clientTxnId) as { id: string; request_hash: string; user_id: string } | undefined
      if (previous) {
        if (previous.request_hash !== requestHash || previous.user_id !== user.id)
          throw new Error('معرّف العملية مستخدم لبيانات مختلفة')
        return this.invoice(previous.id)
      }
      const shift = this.shift(user)
      if (new Set(data.lines.map((l) => l.variantId)).size !== data.lines.length)
        throw new Error('ادمج كميات الصنف المتكرر في سطر واحد')
      const items = data.lines.map((l) => {
        const p = this.db
          .prepare(`${productQuery} WHERE v.id=? AND p.active=1`)
          .get(l.variantId) as Product | undefined
        if (!p) throw new Error('الصنف غير موجود أو متوقف')
        if (data.kind === 'sale' && l.price !== undefined && l.price !== p.price)
          throw new Error('سعر البيع يعتمد على الكتالوج؛ استخدم الخصم المسموح')
        if (data.kind === 'purchase' && l.price === undefined)
          throw new Error('أدخل تكلفة شراء كل صنف')
        const price = data.kind === 'sale' ? p.price : l.price!
        const gross = lineTotal(Money.fromPiastres(price), Quantity.fromMilliUnits(l.qty)) as number
        return {
          p,
          qty: l.qty,
          price,
          gross,
          cost: data.kind === 'sale' ? this.outgoing(p, l.qty) : gross,
        }
      })
      const subtotal = sum(items.map((i) => i.gross))
      if (data.discount > subtotal) throw new Error('راجع إجمالي الفاتورة والخصم')
      if (data.discount > 0 && user.role === 'cashier') throw new Error('الخصم يحتاج صلاحية مدير')
      const net = Money.fromPiastres(subtotal - data.discount)
      const tax = Money.applyRate(net, basisPoints(data.taxBps)) as number
      const total = sum([net, tax])
      if (data.card + data.transfer > total)
        throw new Error('دفع البطاقة والتحويل أكبر من الإجمالي')
      const tender = sum([data.cash, data.card, data.transfer]),
        change = Math.max(0, tender - total),
        cash = data.cash - change
      const paid = Math.min(tender, total)
      if (data.partyId) {
        const p = this.db
          .prepare('SELECT kind,active FROM parties WHERE id=?')
          .get(data.partyId) as { kind: string; active: number } | undefined
        if (!p || !p.active || p.kind !== (data.kind === 'sale' ? 'customer' : 'supplier'))
          throw new Error('راجع العميل أو المورد المحدد')
      }
      if (paid < total && !data.partyId)
        throw new Error('الفاتورة الآجلة تحتاج عميلًا أو موردًا مسجلًا')
      const shares = Money.allocate(
        Money.fromPiastres(total),
        items.map((i) => (subtotal === 0 ? i.qty : i.gross)),
      )
      this.db
        .prepare('INSERT INTO sequences VALUES(?,1) ON CONFLICT(kind) DO UPDATE SET value=value+1')
        .run(data.kind)
      const seq = this.db.prepare('SELECT value FROM sequences WHERE kind=?').get(data.kind) as {
        value: number
      }
      const id = ulid(),
        number = (data.kind === 'sale' ? 'S-' : 'P-') + String(seq.value).padStart(6, '0'),
        at = Date.now()
      this.db
        .prepare(
          'INSERT INTO invoices(id,number,kind,user_id,party_id,shift_id,at,subtotal,discount,tax,total,client_txn_id,request_hash,note,cash_received,change) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          id,
          number,
          data.kind,
          user.id,
          data.partyId ?? null,
          shift.id,
          at,
          subtotal,
          data.discount,
          tax,
          total,
          data.clientTxnId,
          requestHash,
          data.note,
          data.cash,
          change,
        )
      items.forEach((item, index) => {
        const total = shares[index]!
        // Purchase tax/discount form part of acquisition cost in this simplified non-VAT-ledger edition.
        const cost = data.kind === 'sale' ? item.cost : total
        this.db
          .prepare('INSERT INTO invoice_lines VALUES(?,?,?,?,?,?,?,?,?)')
          .run(ulid(), id, item.p.id, item.p.name, item.p.unit, item.qty, item.price, total, cost)
        this.move(
          user,
          item.p.id,
          data.kind === 'sale' ? -item.qty : item.qty,
          data.kind === 'sale' ? -cost : cost,
          data.kind,
          id,
        )
      })
      for (const [method, amount] of [
        ['cash', cash],
        ['card', data.card],
        ['transfer', data.transfer],
      ] as const) {
        if (amount > 0)
          this.db
            .prepare('INSERT INTO payments VALUES(?,?,?,?,?,?,?)')
            .run(ulid(), id, shift.id, method, amount, at, ulid())
      }
      this.cash(user, shift.id, data.kind === 'sale' ? cash : -cash, data.kind, number, id)
      this.party(data.partyId ?? null, total - paid, data.kind, id)
      if (data.holdId) {
        const removed = this.db
          .prepare('DELETE FROM holds WHERE id=? AND user_id=?')
          .run(data.holdId, user.id)
        if (!removed.changes) throw new Error('الفاتورة المعلقة غير موجودة لحسابك')
      }
      this.identity.audit(user.id, `${data.kind}.post`, id)
      return this.invoice(id)
    })()
  }
  pay(user: User, input: unknown) {
    const data = validated(schemas['invoice.pay'], input)
    return this.db.transaction(() => {
      const inv = this.invoice(data.invoiceId)
      if (inv.kind === 'purchase' && user.role === 'cashier')
        throw new Error('ليس لديك صلاحية مدفوعات الموردين')
      const previous = this.db
        .prepare('SELECT invoice_id,amount,method FROM payments WHERE client_txn_id=?')
        .get(data.clientTxnId) as { invoice_id: string; amount: number; method: string } | undefined
      if (previous) {
        if (
          previous.invoice_id !== data.invoiceId ||
          previous.amount !== data.amount ||
          previous.method !== data.method
        )
          throw new Error('معرّف دفعة مستخدم لبيانات مختلفة')
        return inv
      }
      const shift = this.shift(user)
      if (data.amount > inv.balance) throw new Error('الدفعة أكبر من الرصيد المتبقي')
      const id = ulid()
      this.db
        .prepare('INSERT INTO payments VALUES(?,?,?,?,?,?,?)')
        .run(id, inv.id, shift.id, data.method, data.amount, Date.now(), data.clientTxnId)
      if (data.method === 'cash')
        this.cash(
          user,
          shift.id,
          inv.kind === 'sale' ? data.amount : -data.amount,
          'payment',
          inv.number,
          id,
        )
      this.party(inv.party_id, -data.amount, 'payment', id)
      this.identity.audit(user.id, 'invoice.pay', inv.id)
      return this.invoice(inv.id)
    })()
  }
  returnInvoice(user: User, input: unknown) {
    if (user.role === 'cashier') throw new Error('المرتجع يحتاج صلاحية مدير')
    const data = validated(schemas['invoice.return'], input),
      requestHash = fingerprint(data)
    return this.db.transaction(() => {
      const previous = this.db
        .prepare('SELECT * FROM returns WHERE client_txn_id=?')
        .get(data.clientTxnId) as { request_hash: string; user_id: string } | undefined
      if (previous) {
        if (previous.request_hash !== requestHash || previous.user_id !== user.id)
          throw new Error('معرّف مرتجع مستخدم لبيانات مختلفة')
        return previous
      }
      const inv = this.invoice(data.invoiceId),
        shift = this.shift(user),
        lines = this.lines(inv.id)
      if (new Set(data.lines.map((l) => l.lineId)).size !== data.lines.length)
        throw new Error('سطر المرتجع مكرر')
      const items = data.lines.map((l) => {
        const original = lines.find((v) => v.id === l.lineId)
        if (!original || l.qty > original.qty - original.returned_qty)
          throw new Error('كمية المرتجع تتجاوز الكمية القابلة للإرجاع')
        const take = (total: number) =>
          CostBasis.restore(
            Money.fromPiastres(total),
            Quantity.fromMilliUnits(original.qty),
            Quantity.fromMilliUnits(original.returned_qty),
          ).take(Quantity.fromMilliUnits(l.qty)).cost as number
        const p = this.db
          .prepare(`${productQuery} WHERE v.id=?`)
          .get(original.variant_id) as Product
        return {
          original,
          qty: l.qty,
          total: take(original.total),
          cost: inv.kind === 'sale' ? take(original.cost) : this.outgoing(p, l.qty),
        }
      })
      const total = sum(items.map((i) => i.total))
      const credited = Math.min(inv.balance, total),
        refunded = total - credited,
        id = ulid(),
        at = Date.now()
      this.db
        .prepare('INSERT INTO returns VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        .run(
          id,
          inv.id,
          user.id,
          shift.id,
          at,
          total,
          refunded,
          data.method,
          data.clientTxnId,
          requestHash,
          data.note,
        )
      for (const item of items) {
        this.db
          .prepare('INSERT INTO return_lines VALUES(?,?,?,?,?,?)')
          .run(ulid(), id, item.original.id, item.qty, item.total, item.cost)
        this.move(
          user,
          item.original.variant_id,
          inv.kind === 'sale' ? item.qty : -item.qty,
          inv.kind === 'sale' ? item.cost : -item.cost,
          'return',
          id,
        )
      }
      if (data.method === 'cash')
        this.cash(
          user,
          shift.id,
          inv.kind === 'sale' ? -refunded : refunded,
          'return',
          data.note,
          id,
        )
      this.party(inv.party_id, -credited, 'return', id)
      this.identity.audit(user.id, 'invoice.return', id)
      return { id, total, refunded }
    })()
  }
}
