import { ulid } from '@xzare/core'
import type { XzareDatabase } from '@xzare/db'
import { Identity } from './identity.js'
import { fingerprint } from './commerce.js'
import { clinicToday, clinicDayBounds } from './clinic-time.js'
import {
  estateSchemas,
  type EstateState,
  type EstateDeal,
  type EstateDetail,
  type EstateContract,
  type EstateEntry,
  type EstateReport,
} from './real-estate-validation.js'
import type { User } from './types.js'
const manage = (u: User) => ['admin', 'manager'].includes(u.role)
const safe = (n: number) => {
  if (!Number.isSafeInteger(n) || Math.abs(n) > 1e12) throw Error('المبلغ تجاوز الحد الآمن')
  return n === 0 ? 0 : n
}
const total = (n: number) => {
  if (!Number.isSafeInteger(n)) throw Error('الإجمالي تجاوز الحد الآمن')
  return n === 0 ? 0 : n
}
const uq =
  "SELECT u.id,u.code,u.name,u.owner_id AS ownerId,o.name AS ownerName,u.category,u.location,u.area,u.rooms,u.offer,u.sale_price AS salePrice,u.rent_price AS rentPrice,u.active,u.availability,u.version,u.at,(SELECT d.id FROM estate_deals d WHERE d.unit_id=u.id AND d.status IN('reserved','contracted')) AS openDealId FROM estate_units u JOIN estate_contacts o ON o.id=u.owner_id"
const cq = 'SELECT id,kind,code,name,phone,document,note,active,version,at FROM estate_contacts'
const dq =
  'SELECT id,number,unit_id AS unitId,client_id AS clientId,broker_id AS brokerId,unit_json AS unit,owner_json AS owner,client_json AS client,broker_json AS broker,business_json AS business,kind,price,deposit_limit AS depositLimit,commission,broker_share AS brokerShare,lease_start AS leaseStart,lease_end AS leaseEnd,note,status,version,at,completed_at AS completedAt FROM estate_deals'
const party = (p: any) => ({ code: p.code, name: p.name, phone: p.phone })
export class RealEstate {
  constructor(
    readonly db: XzareDatabase,
    readonly identity: Identity,
  ) {}
  private row(sql: string, ...args: any[]): any {
    return this.db.prepare(sql).get(...args)
  }
  private rows(sql: string, ...args: any[]): any[] {
    return this.db.prepare(sql).all(...args)
  }
  private manager(u: User) {
    if (!manage(u)) throw Error('هذه العملية تحتاج مدير المكتب')
  }
  private version(x: any, v: unknown) {
    if (x && x.version !== v) throw Error('البيانات تغيرت؛ حدّث العرض وأعد المحاولة')
    if (!x && v !== undefined) throw Error('الإصدار يخص التعديل')
  }
  private contact(id: string) {
    const x = this.row(cq + ' WHERE id=?', id)
    if (!x) throw Error('جهة الاتصال غير موجودة')
    return x
  }
  private unit(id: string) {
    const x = this.row(uq + ' WHERE u.id=?', id)
    if (!x) throw Error('الوحدة غير موجودة')
    return x
  }
  private business() {
    return Object.fromEntries(
      this.rows('SELECT key,value FROM settings')
        .filter((x) =>
          ['businessName', 'phone', 'address', 'currency', 'receiptFooter'].includes(x.key),
        )
        .map((x) => [x.key, x.value]),
    )
  }
  private balances(id: string) {
    const rows = this.rows('SELECT e.channel,e.kind,e.amount,o.kind AS originalKind FROM estate_entries e LEFT JOIN estate_entries o ON o.id=e.original_id WHERE e.deal_id=?', id)
    const sum = (channel: string) =>
      total(rows.filter((x) => x.channel === channel).reduce((n, x) => n + x.amount, 0))
    const depositReceived=total(rows.filter(x=>x.channel==='deposit' && (['receipt','refund'].includes(x.kind)||(x.kind==='void'&&['receipt','refund'].includes(x.originalKind)))).reduce((n,x)=>n+x.amount,0))
    return { depositReceived,depositHeld: sum('deposit'), feeCollected: sum('fee'), brokerPaid: sum('broker') }
  }
  private deal(id: string): EstateDeal {
    const x = this.row(dq + ' WHERE id=?', id)
    if (!x) throw Error('الصفقة غير موجودة')
    return this.decode(x)
  }
  private decode(x: any): EstateDeal {
    for (const k of ['unit', 'owner', 'client', 'broker', 'business']) x[k] = JSON.parse(x[k])
    const b = this.balances(x.id),
      earned = x.status === 'completed' ? x.commission : 0
    return { ...x, ...b, earned, brokerDue: earned ? x.brokerShare - b.brokerPaid : 0 }
  }
  private deals() {
    return this.rows(dq + ' ORDER BY at DESC,number DESC').map((x) => this.decode(x))
  }
  private contracts(where = '', ...args: any[]): EstateContract[] {
    return this.rows(
      'SELECT c.id,c.deal_id AS dealId,c.number,c.reference,c.signed_day AS signedDay,c.terms,c.snapshot,c.actor_name AS actorName,c.at,(SELECT v.reason FROM estate_contract_cancels v WHERE v.contract_id=c.id) AS cancelReason FROM estate_contracts c' +
        where,
      ...args,
    ).map((x) => ({ ...x, snapshot: JSON.parse(x.snapshot) }))
  }
  private entries(where = '', ...args: any[]): EstateEntry[] {
    return this.rows(
      'SELECT e.id,e.number,e.deal_id AS dealId,e.channel,e.kind,e.amount,e.original_id AS originalId,e.method,e.reference,e.reason,e.snapshot,e.actor_name AS actorName,e.at,(SELECT v.reason FROM estate_entries v WHERE v.original_id=e.id) AS voidReason FROM estate_entries e' +
        where,
      ...args,
    ).map((x) => ({ ...x, snapshot: JSON.parse(x.snapshot) }))
  }
  private number(table: 'estate_deals' | 'estate_contracts' | 'estate_entries', prefix: string) {
    return prefix + String(this.row('SELECT count(*)+1 AS n FROM ' + table).n).padStart(6, '0')
  }
  private bump(id: string) {
    this.db.prepare('UPDATE estate_deals SET version=version+1 WHERE id=?').run(id)
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
      .prepare('INSERT INTO estate_events VALUES(?,?,?,?,?,?,?,?,?)')
      .run(ulid(), type, id, action, reason, JSON.stringify(snapshot), u.id, u.name, Date.now())
  }
  private validBalance(id: string) {
    const d = this.deal(id)
    if (
      d.depositHeld < 0 ||
      d.depositHeld > d.depositReceived ||
      d.depositReceived < 0 || d.depositReceived > d.depositLimit ||
      d.feeCollected < 0 ||
      d.feeCollected > d.earned ||
      d.brokerPaid < 0 ||
      d.brokerPaid > (d.earned ? d.brokerShare : 0)
    )
      throw Error('الحركة تتجاوز الرصيد أو الاستحقاق')
    if (d.brokerPaid > 0 && d.feeCollected !== d.commission)
      throw Error('تحصيل عمولة المكتب بالكامل مطلوب قبل صرف حصة الوسيط أو رد العمولة')
    for (const channel of ['deposit', 'fee', 'broker'])
      total(
        this.row('SELECT COALESCE(sum(amount),0) AS n FROM estate_entries WHERE channel=?', channel)
          .n,
      )
  }
  private entry(
    d: EstateDeal,
    id: string,
    p: any,
    amount: number,
    u: User,
    original: string | null = null,
  ) {
    this.db
      .prepare('INSERT INTO estate_entries VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(
        id,
        this.number('estate_entries', 'RE-'),
        d.id,
        p.channel,
        p.kind,
        safe(amount),
        original,
        p.method,
        p.reference,
        p.reason,
        JSON.stringify(d),
        u.id,
        u.name,
        Date.now(),
      )
    this.validBalance(d.id)
    this.bump(d.id)
  }
  state(u: User): EstateState {
    return {
      user: u,
      settings: { ...this.business(), language: 'ar' },
      contacts: this.rows(cq + ' ORDER BY kind,name').map((x) => {
        if (!manage(u)) delete x.document
        return x
      }),
      units: this.rows(uq + ' ORDER BY u.at DESC,u.code'),
      deals: this.deals(),
      contracts: manage(u) ? this.contracts(' ORDER BY c.at DESC,c.number DESC') : [],
      entries: this.entries(' ORDER BY e.at DESC,e.number DESC LIMIT 1000'),
      users:
        u.role === 'admin'
          ? this.rows('SELECT id,username,name,role,active FROM users ORDER BY name')
          : [],
      audit:
        u.role === 'admin'
          ? this.rows(
              'SELECT a.*,u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.at DESC LIMIT 300',
            )
          : [],
    }
  }
  private detail(id: string, u: User): EstateDetail {
    return {
      deal: this.deal(id),
      contract: manage(u) ? (this.contracts(' WHERE c.deal_id=?', id)[0] ?? null) : null,
      entries: this.entries(' WHERE e.deal_id=? ORDER BY e.rowid', id),
      events: this.rows(
        "SELECT id,action,reason,snapshot,actor_name AS actorName,at FROM estate_events WHERE entity_type='deal' AND entity_id=? ORDER BY rowid DESC",
        id,
      ).map((x) => (manage(u) ? x : { ...x, snapshot: '' })),
    }
  }
  call(action: string, payload: unknown, u: User): unknown {
    if (!['admin', 'manager', 'cashier'].includes(u.role))
      throw Error('الدور غير متاح في المكتب العقاري')
    const schema = (estateSchemas as Record<string, { parse: (p: unknown) => any }>)[action]
    if (!schema) throw Error('العملية غير متاحة')
    const p = schema.parse(payload)
    if (action === 're.state') return this.state(u)
    if (action === 're.deal.get') return this.detail(p.id, u)
    if (action === 're.report') {
      this.manager(u)
      const { lo, hi } = clinicDayBounds(p.from, p.to),
        deals = this.deals(),
        done = deals.filter(
          (d) => d.completedAt !== null && d.completedAt >= lo && d.completedAt < hi,
        ),
        entries = this.entries(' WHERE e.at>=? AND e.at<? ORDER BY e.rowid', lo, hi),
        sum = (xs: number[]) => total(xs.reduce((n, x) => n + x, 0))
      return {
        from: p.from,
        to: p.to,
        earned: sum(done.map((d) => d.commission)),
        agencyNetEarned: sum(done.map((d) => d.commission - d.brokerShare)),
        completedValue: sum(done.map((d) => d.price)),
        feeCollected: sum(entries.filter((x) => x.channel === 'fee').map((x) => x.amount)),
        brokerPaid: sum(entries.filter((x) => x.channel === 'broker').map((x) => x.amount)),
        brokerDue: sum(deals.map((d) => d.brokerDue)),
        depositHeld: sum(deals.map((d) => d.depositHeld)),
        feeOutstanding: sum(deals.map((d) => d.earned - d.feeCollected)),
        deals: done,
        entries,
      } satisfies EstateReport
    }
    return this.db.transaction(() => {
      const hash = fingerprint(p),
        oldCommand = this.row('SELECT * FROM estate_commands WHERE id=?', p.clientTxnId)
      if (oldCommand) {
        if (
          oldCommand.actor_id !== u.id ||
          oldCommand.action !== action ||
          oldCommand.fingerprint !== hash
        )
          throw Error('معرف العملية مستخدم لطلب مختلف')
        return JSON.parse(oldCommand.result)
      }
      let id = p.id ?? ulid()
      if (action === 're.contact.save') {
        if (p.kind !== 'client') this.manager(u)
        const old = p.id ? this.contact(p.id) : undefined
        this.version(old, p.version)
        if (old && old.kind !== p.kind) throw Error('لا يمكن تغيير نوع جهة الاتصال')
        if (old && !p.reason) throw Error('اذكر سبب تعديل البيانات')
        if (!manage(u) && p.document) throw Error('وثيقة الهوية تحتاج مدير المكتب')
        const values = [
          p.kind,
          p.code,
          p.name,
          p.phone,
          manage(u) ? p.document : (old?.document ?? ''),
          p.note,
          +p.active,
        ]
        if (old)
          this.db
            .prepare(
              'UPDATE estate_contacts SET kind=?,code=?,name=?,phone=?,document=?,note=?,active=?,version=version+1 WHERE id=?',
            )
            .run(...values, id)
        else
          this.db
            .prepare(
              'INSERT INTO estate_contacts(id,kind,code,name,phone,document,note,active,at) VALUES(?,?,?,?,?,?,?,?,?)',
            )
            .run(id, ...values, Date.now())
        this.event(
          'contact',
          id,
          action,
          p.reason,
          { before: old ?? null, after: this.contact(id) },
          u,
        )
      } else if (action === 're.unit.save') {
        this.manager(u)
        const old = p.id ? this.unit(p.id) : undefined
        this.version(old, p.version)
        if (old && !p.reason) throw Error('اذكر سبب تعديل الوحدة')
        const owner = this.contact(p.ownerId)
        this.version(owner, p.ownerVersion)
        if (owner.kind !== 'owner' || !owner.active) throw Error('اختر مالكًا نشطًا')
        if (old?.openDealId && (!p.active || p.ownerId !== old.ownerId || p.offer !== old.offer))
          throw Error('الوحدة مرتبطة بصفقة؛ أغلقها قبل تغيير المالك أو العرض أو تعطيل الوحدة')
        if ((p.offer === 'sale' || p.offer === 'both') && p.salePrice <= 0)
          throw Error('حدد سعر البيع')
        if ((p.offer === 'lease' || p.offer === 'both') && p.rentPrice <= 0)
          throw Error('حدد قيمة الإيجار الشهري')
        const values = [
          p.code,
          p.name,
          p.ownerId,
          p.category,
          p.location,
          p.area,
          p.rooms,
          p.offer,
          p.salePrice,
          p.rentPrice,
          +p.active,
        ]
        if (old)
          this.db
            .prepare(
              'UPDATE estate_units SET code=?,name=?,owner_id=?,category=?,location=?,area=?,rooms=?,offer=?,sale_price=?,rent_price=?,active=?,version=version+1 WHERE id=?',
            )
            .run(...values, id)
        else
          this.db
            .prepare(
              'INSERT INTO estate_units(id,code,name,owner_id,category,location,area,rooms,offer,sale_price,rent_price,active,at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
            )
            .run(id, ...values, Date.now())
        this.event('unit', id, action, p.reason, { before: old ?? null, after: this.unit(id) }, u)
      } else if (action === 're.unit.relist') {
        this.manager(u)
        const old = this.unit(id)
        this.version(old, p.version)
        if (old.openDealId || old.availability === 'available')
          throw Error('إعادة العرض تخص وحدة مغلقة بلا صفقة مفتوحة')
        this.db
          .prepare("UPDATE estate_units SET availability='available',version=version+1 WHERE id=?")
          .run(id)
        this.event('unit', id, action, p.reason, { before: old, after: this.unit(id) }, u)
      } else if (action === 're.deal.add') {
        this.manager(u)
        const unit = this.unit(p.unitId),
          client = this.contact(p.clientId),
          broker = this.contact(p.brokerId),
          owner = this.contact(unit.ownerId)
        this.version(unit, p.unitVersion)
        this.version(client, p.clientVersion)
        this.version(broker, p.brokerVersion)
        if (!unit.active || unit.availability !== 'available' || unit.openDealId)
          throw Error('الوحدة غير متاحة لصفقة جديدة')
        if (unit.offer !== 'both' && unit.offer !== p.kind)
          throw Error('نوع الصفقة لا يطابق عرض الوحدة')
        if (
          client.kind !== 'client' ||
          broker.kind !== 'broker' ||
          !client.active ||
          !broker.active ||
          !owner.active
        )
          throw Error('اختر مالكًا وعميلًا ووسيطًا نشطين')
        this.db
          .prepare(
            'INSERT INTO estate_deals(id,number,unit_id,client_id,broker_id,unit_json,owner_json,client_json,broker_json,business_json,kind,price,deposit_limit,commission,broker_share,lease_start,lease_end,note,status,at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          )
          .run(
            id,
            this.number('estate_deals', 'D-'),
            unit.id,
            client.id,
            broker.id,
            JSON.stringify({
              code: unit.code,
              name: unit.name,
              category: unit.category,
              location: unit.location,
              area: unit.area,
              rooms: unit.rooms,
            }),
            JSON.stringify(party(owner)),
            JSON.stringify(party(client)),
            JSON.stringify(party(broker)),
            JSON.stringify(this.business()),
            p.kind,
            p.price,
            p.depositLimit,
            p.commission,
            p.brokerShare,
            p.leaseStart,
            p.leaseEnd,
            p.note,
            'reserved',
            Date.now(),
          )
        this.db.prepare('UPDATE estate_units SET version=version+1 WHERE id=?').run(unit.id)
        this.event('deal', id, action, '', this.deal(id), u)
      } else if (action === 're.contract.record') {
        this.manager(u)
        const d = this.deal(id)
        this.version(d, p.version)
        if (d.status !== 'reserved') throw Error('العقد يخص صفقة محجوزة بلا عقد')
        if (p.signedDay > clinicToday()) throw Error('تاريخ توقيع العقد لا يكون في المستقبل')
        this.db
          .prepare('INSERT INTO estate_contracts VALUES(?,?,?,?,?,?,?,?,?,?)')
          .run(
            ulid(),
            id,
            this.number('estate_contracts', 'C-'),
            p.reference,
            p.signedDay,
            p.terms,
            JSON.stringify(d),
            u.id,
            u.name,
            Date.now(),
          )
        this.db
          .prepare("UPDATE estate_deals SET status='contracted',version=version+1 WHERE id=?")
          .run(id)
        this.event(
          'deal',
          id,
          action,
          '',
          { reference: p.reference, signedDay: p.signedDay, terms: p.terms },
          u,
        )
      } else if (action === 're.deal.complete' || action === 're.deal.cancel') {
        this.manager(u)
        const d = this.deal(id)
        this.version(d, p.version)
        if (!['reserved', 'contracted'].includes(d.status)) throw Error('الصفقة مغلقة')
        if (d.depositHeld !== 0)
          throw Error('سوِّ العربون بالتسليم للمالك أو الرد قبل إغلاق الصفقة')
        if (action === 're.deal.cancel' && d.depositReceived !== 0) throw Error('استرجع العربون المسلم للمالك ورد صافي عربون العميل قبل الإلغاء')
        if (action === 're.deal.complete') {
          if (d.status !== 'contracted') throw Error('سجل العقد الموقع قبل إتمام الصفقة')
          this.db
            .prepare(
              "UPDATE estate_deals SET status='completed',completed_at=?,version=version+1 WHERE id=?",
            )
            .run(Date.now(), id)
          this.db
            .prepare('UPDATE estate_units SET availability=?,version=version+1 WHERE id=?')
            .run(d.kind === 'sale' ? 'sold' : 'leased', d.unitId)
        } else {
          const c = this.contracts(' WHERE c.deal_id=?', id)[0]
          if (c)
            this.db
              .prepare('INSERT INTO estate_contract_cancels VALUES(?,?,?,?,?,?)')
              .run(ulid(), c.id, p.reason, u.id, u.name, Date.now())
          this.db
            .prepare("UPDATE estate_deals SET status='cancelled',version=version+1 WHERE id=?")
            .run(id)
          this.db.prepare('UPDATE estate_units SET version=version+1 WHERE id=?').run(d.unitId)
        }
        this.event('deal', id, action, p.reason, { before: d, after: this.deal(id) }, u)
      } else if (action === 're.entry.post') {
        const d = this.deal(id)
        this.version(d, p.version)
        if (p.channel === 'deposit') {
          if (!['reserved', 'contracted'].includes(d.status)) throw Error('حساب العربون مغلق')
          if (!['receipt', 'refund', 'handover'].includes(p.kind))
            throw Error('نوع حركة غير متاح للعربون')
          if (p.kind !== 'receipt') this.manager(u)
          if (p.kind === 'handover' && d.status !== 'contracted')
            throw Error('سجل العقد قبل تسليم العربون للمالك')
        } else {
          if (d.status !== 'completed') throw Error('العمولات تخص صفقة مكتملة')
          if (p.channel === 'fee' && !['receipt', 'refund'].includes(p.kind))
            throw Error('نوع الحركة غير متاح لعمولة المكتب')
          if (p.channel === 'broker' && p.kind !== 'payout')
            throw Error('حصة الوسيط تقبل صرفًا فقط')
          if (p.kind !== 'receipt') this.manager(u)
        }
        const entryId = ulid()
        this.entry(
          d,
          entryId,
          p,
          p.kind === 'refund' || p.kind === 'handover' ? -p.amount : p.amount,
          u,
        )
        this.event(
          'deal',
          d.id,
          action,
          p.reason,
          { entryId, channel: p.channel, kind: p.kind, amount: p.amount },
          u,
        )
        id = entryId
      } else if (action === 're.entry.void') {
        this.manager(u)
        const d = this.deal(id)
        this.version(d, p.version)
        const original = this.row(
          'SELECT * FROM estate_entries WHERE id=? AND deal_id=?',
          p.entryId,
          id,
        )
        if (!original || original.kind === 'void') throw Error('الحركة الأصلية غير موجودة')
        if (this.row('SELECT id FROM estate_entries WHERE original_id=?', original.id))
          throw Error('الحركة مصححة بالفعل')
        if (original.channel === 'deposit' && !['reserved', 'contracted'].includes(d.status))
          throw Error('حساب العربون مغلق')
        if (original.channel !== 'deposit' && d.status !== 'completed')
          throw Error('الصفقة ليست مكتملة')
        const entryId = ulid()
        this.entry(
          d,
          entryId,
          {
            channel: original.channel,
            kind: 'void',
            method: original.method,
            reference: original.reference,
            reason: p.reason,
          },
          -original.amount,
          u,
          original.id,
        )
        this.event('deal', d.id, action, p.reason, { entryId, originalId: original.id }, u)
        id = entryId
      } else throw Error('العملية غير متاحة')
      const result = { id }
      this.identity.audit(u.id, action, id)
      this.db
        .prepare('INSERT INTO estate_commands VALUES(?,?,?,?,?,?)')
        .run(p.clientTxnId, u.id, action, hash, JSON.stringify(result), Date.now())
      return result
    })()
  }
}
