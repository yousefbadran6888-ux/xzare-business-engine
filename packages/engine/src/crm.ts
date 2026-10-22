import { Money, Quantity, basisPoints, lineTotal, ulid } from '@xzare/core'
import type { XzareDatabase } from '@xzare/db'
import { Identity } from './identity.js'
import { fingerprint } from './commerce.js'
import { clinicToday, clinicDayBounds } from './clinic-time.js'
import {
  crmSchemas,
  type CrmEntity,
  type CrmLead,
  type CrmContact,
  type CrmOpportunity,
  type CrmTask,
  type CrmQuote,
  type CrmState,
  type CrmActivity,
  type CrmRecordDetail,
  type CrmQuoteDetail,
  type CrmReport,
} from './crm-validation.js'
import type { User } from './types.js'
const manager = (u: User) => u.role === 'admin' || u.role === 'manager'
const leadQuery =
  "SELECT id,name,company,phone,COALESCE(email,'') email,source,owner_id AS ownerId,note,status,contact_id AS contactId,at,version FROM crm_leads"
const contactQuery =
  "SELECT id,code,name,company,phone,COALESCE(email,'') email,address,owner_id AS ownerId,note,active,at,version FROM crm_contacts"
const opportunityQuery =
  'SELECT o.id,o.contact_id AS contactId,o.title,o.value,o.probability,o.expected_close AS expectedClose,o.note,o.stage,o.actual_value AS actualValue,o.closed_at AS closedAt,o.at,o.version,c.name AS contactName,c.company,c.owner_id AS ownerId FROM crm_opportunities o JOIN crm_contacts c ON c.id=o.contact_id'
const taskQuery =
  'SELECT id,entity_type AS entityType,entity_id AS entityId,title,kind,due_day AS dueDay,due_minute AS dueMinute,note,status,outcome,at,version FROM crm_tasks'
const quoteQuery =
  'SELECT q.id,q.number,q.opportunity_id AS opportunityId,q.valid_until AS validUntil,q.reference,q.note,q.customer,q.business,q.subtotal,q.discount,q.tax_bps AS taxBps,q.tax,q.total,q.creator_name AS creatorName,q.at,s.status,s.version,s.reason AS decisionReason,s.reference AS decisionReference FROM crm_quotes q JOIN crm_quote_status s ON s.quote_id=q.id'
const activityQuery =
  'SELECT id,entity_type AS entityType,entity_id AS entityId,action,kind,text,snapshot,actor_name AS actorName,at FROM crm_activities'
const safe = (n: number) => {
  if (!Number.isSafeInteger(n) || Math.abs(n) > 1e12) throw new Error('المبلغ تجاوز الحد الآمن')
  return n
}
const weighted = (o: { value: number; probability: number; stage: string }) =>
  ['won', 'lost'].includes(o.stage)
    ? 0
    : (Money.applyRate(Money.fromPiastres(o.value), basisPoints(o.probability * 100)) as number)
export class CRM {
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
  private version(old: { version: number } | undefined, v: unknown) {
    if (old && old.version !== v) throw new Error('البيانات تغيرت؛ حدّث العرض وأعد المحاولة')
    if (!old && v !== undefined) throw new Error('الإصدار يخص التعديل')
  }
  private owner(ownerId: string, u: User) {
    if (!manager(u) && ownerId !== u.id) throw new Error('ليس لديك صلاحية تعيين سجل لمستخدم آخر')
    if (
      !this.row(
        "SELECT id FROM users WHERE id=? AND active=1 AND role IN('admin','manager','cashier')",
        ownerId,
      )
    )
      throw new Error('المستخدم المكلف غير نشط أو غير متاح')
  }
  private entity(type: CrmEntity, id: string, u: User): any {
    let x: any
    if (type === 'lead') x = this.row(leadQuery + ' WHERE id=?', id)
    else if (type === 'contact') x = this.row(contactQuery + ' WHERE id=?', id)
    else {
      x = this.row(opportunityQuery + ' WHERE o.id=?', id)
      if (x) x = { ...x, weighted: weighted(x) }
    }
    if (!x || (!manager(u) && x.ownerId !== u.id))
      throw new Error('السجل غير موجود أو ليس لديك صلاحية عرضه')
    return x
  }
  private task(id: string, u: User) {
    const x = this.row<CrmTask>(taskQuery + ' WHERE id=?', id)
    if (!x) throw new Error('المتابعة غير موجودة')
    this.entity(x.entityType, x.entityId, u)
    return x
  }
  private quote(id: string, u: User): CrmQuote {
    const q = this.row<any>(quoteQuery + ' WHERE q.id=?', id)
    if (!q) throw new Error('عرض السعر غير موجود')
    this.entity('opportunity', q.opportunityId, u)
    return {
      ...q,
      customer: JSON.parse(q.customer),
      business: JSON.parse(q.business),
      expired: q.status === 'issued' && q.validUntil < clinicToday(),
    }
  }
  private settings() {
    return Object.fromEntries(
      this.rows<{ key: string; value: string }>(
        "SELECT key,value FROM settings WHERE key IN('businessName','phone','address','receiptFooter','language','currency','taxBps')",
      ).map((x) => [x.key, x.value]),
    )
  }
  private activities(type: CrmEntity, id: string): CrmActivity[] {
    return this.rows<any>(
      activityQuery + ' WHERE entity_type=? AND entity_id=? ORDER BY at DESC,rowid DESC LIMIT 1000',
      type,
      id,
    ).map((x) => ({ ...x, snapshot: JSON.parse(x.snapshot) }))
  }
  get(type: CrmEntity, id: string, u: User): CrmRecordDetail {
    const record = this.entity(type, id, u)
    return {
      entityType: type,
      record,
      tasks: this.rows<CrmTask>(
        taskQuery + ' WHERE entity_type=? AND entity_id=? ORDER BY due_day,due_minute',
        type,
        id,
      ),
      activities: this.activities(type, id),
      quotes:
        type === 'opportunity'
          ? this.rows<{ id: string }>(
              'SELECT id FROM crm_quotes WHERE opportunity_id=? ORDER BY at DESC,rowid DESC',
              id,
            ).map((x) => this.quote(x.id, u))
          : [],
    }
  }
  getQuote(id: string, u: User): CrmQuoteDetail {
    return {
      quote: this.quote(id, u),
      lines: this.rows(
        'SELECT id,description,unit,qty,price,value FROM crm_quote_lines WHERE quote_id=? ORDER BY rowid',
        id,
      ),
    }
  }
  state(u: User): CrmState {
    if (!['admin', 'manager', 'cashier'].includes(u.role)) throw new Error('ليس لديك صلاحية CRM')
    const leads = this.rows<CrmLead>(
        leadQuery + (manager(u) ? '' : ' WHERE owner_id=?') + ' ORDER BY at DESC',
        ...(manager(u) ? [] : [u.id]),
      ),
      contacts = this.rows<CrmContact>(
        contactQuery + (manager(u) ? '' : ' WHERE owner_id=?') + ' ORDER BY name',
        ...(manager(u) ? [] : [u.id]),
      ),
      opportunities = this.rows<Omit<CrmOpportunity, 'weighted'>>(
        opportunityQuery + (manager(u) ? '' : ' WHERE c.owner_id=?') + ' ORDER BY o.at DESC',
        ...(manager(u) ? [] : [u.id]),
      ).map((x) => ({ ...x, weighted: weighted(x) }))
    const visible = {
      lead: new Set(leads.map((x) => x.id)),
      contact: new Set(contacts.map((x) => x.id)),
      opportunity: new Set(opportunities.map((x) => x.id)),
    }
    const tasks = this.rows<CrmTask>(taskQuery + ' ORDER BY due_day,due_minute').filter((x) =>
      visible[x.entityType].has(x.entityId),
    )
    const quotes = this.rows<{ id: string; opportunity_id: string }>(
      'SELECT id,opportunity_id FROM crm_quotes ORDER BY at DESC,rowid DESC',
    )
      .filter((x) => visible.opportunity.has(x.opportunity_id))
      .slice(0, 1000)
      .map((x) => this.quote(x.id, u))
    const now = new Date()
    return {
      user: u,
      settings: this.settings(),
      today: clinicToday(),
      nowMinute: now.getHours() * 60 + now.getMinutes(),
      leads,
      contacts,
      opportunities,
      tasks,
      quotes,
      assignees: this.rows(
        "SELECT id,name,role,active FROM users WHERE active=1 AND role IN('admin','manager','cashier')" +
          (manager(u) ? '' : ' AND id=?') +
          ' ORDER BY name',
        ...(manager(u) ? [] : [u.id]),
      ),
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
  report(d: { from: string; to: string }, u: User): CrmReport {
    const days = (Date.parse(d.to) - Date.parse(d.from)) / 86400000
    if (days < 0 || days > 365) throw new Error('اختر نطاقًا حتى 366 يومًا')
    const s = this.state(u),
      b = clinicDayBounds(d.from, d.to),
      visible = {
        lead: new Set(s.leads.map((x) => x.id)),
        contact: new Set(s.contacts.map((x) => x.id)),
        opportunity: new Set(s.opportunities.map((x) => x.id)),
      }
    return {
      opportunities: s.opportunities,
      weighted: s.opportunities.reduce((n, x) => safe(n + x.weighted), 0),
      wonValue: s.opportunities
        .filter(
          (x) =>
            x.stage === 'won' && x.closedAt !== null && x.closedAt >= b.lo && x.closedAt < b.hi,
        )
        .reduce((n, x) => safe(n + (x.actualValue ?? 0)), 0),
      activities: this.rows<any>(
        activityQuery + ' WHERE at>=? AND at<? ORDER BY at DESC,rowid DESC',
        b.lo,
        b.hi,
      )
        .filter((x) => visible[x.entityType as CrmEntity].has(x.entityId))
        .map((x) => ({ ...x, snapshot: JSON.parse(x.snapshot) })),
      leads: s.leads.filter((x) => x.at >= b.lo && x.at < b.hi),
      quotes: this.rows<{ id: string; opportunity_id: string }>(
        'SELECT id,opportunity_id FROM crm_quotes WHERE at>=? AND at<? ORDER BY at DESC,rowid DESC',
        b.lo,
        b.hi,
      )
        .filter((x) => visible.opportunity.has(x.opportunity_id))
        .map((x) => this.quote(x.id, u)),
    }
  }
  private activity(
    type: CrmEntity,
    id: string,
    action: string,
    kind: string,
    text: string,
    snapshot: unknown,
    u: User,
  ) {
    const aid = ulid()
    this.db
      .prepare('INSERT INTO crm_activities VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(aid, type, id, action, kind, text, JSON.stringify(snapshot), u.id, u.name, Date.now())
    return aid
  }
  private savePerson(type: 'lead' | 'contact', d: any, u: User) {
    const old = d.id ? this.entity(type, d.id, u) : undefined
    this.version(old, d.version)
    this.owner(d.ownerId, u)
    if (type === 'lead' && old?.status === 'converted')
      throw new Error('العميل المحتمل محول؛ عدّل ملف العميل الفعلي')
    const id = d.id ?? ulid()
    if (type === 'lead')
      this.db
        .prepare(
          'INSERT INTO crm_leads VALUES(?,?,?,?,?,?,?,?,?,NULL,?,0) ON CONFLICT(id) DO UPDATE SET name=excluded.name,company=excluded.company,phone=excluded.phone,email=excluded.email,source=excluded.source,owner_id=excluded.owner_id,note=excluded.note,version=crm_leads.version+1',
        )
        .run(
          id,
          d.name,
          d.company,
          d.phone,
          d.email || null,
          d.source,
          d.ownerId,
          d.note,
          'new',
          Date.now(),
        )
    else {
      this.db
        .prepare(
          'INSERT INTO crm_contacts VALUES(?,?,?,?,?,?,?,?,?,?,?,0) ON CONFLICT(id) DO UPDATE SET code=excluded.code,name=excluded.name,company=excluded.company,phone=excluded.phone,email=excluded.email,address=excluded.address,owner_id=excluded.owner_id,note=excluded.note,active=excluded.active,version=crm_contacts.version+1',
        )
        .run(
          id,
          d.code,
          d.name,
          d.company,
          d.phone,
          d.email || null,
          d.address,
          d.ownerId,
          d.note,
          Number(d.active),
          Date.now(),
        )
      if (old && old.ownerId !== d.ownerId) {
        this.db
          .prepare(
            "UPDATE crm_leads SET owner_id=?,version=version+1 WHERE contact_id=? AND status='converted'",
          )
          .run(d.ownerId, id)
      }
    }
    return id
  }
  private convert(d: any, u: User) {
    const l = this.entity('lead', d.id, u) as CrmLead
    this.version(l, d.version)
    if (!['new', 'qualified'].includes(l.status))
      throw new Error('حالة العميل المحتمل لا تسمح بالتحويل')
    let id = d.contactId
    if (id) {
      const c = this.entity('contact', id, u) as CrmContact
      if (c.ownerId !== l.ownerId || !c.active)
        throw new Error('اختر عميلًا نشطًا بنفس المستخدم المكلف')
    } else {
      if (!d.code) throw new Error('كود العميل الفعلي مطلوب')
      id = this.savePerson(
        'contact',
        {
          code: d.code,
          name: l.name,
          company: l.company,
          phone: l.phone,
          email: l.email,
          address: '',
          ownerId: l.ownerId,
          note: l.note,
          active: true,
        },
        u,
      )
    }
    this.db
      .prepare("UPDATE crm_leads SET status='converted',contact_id=?,version=version+1 WHERE id=?")
      .run(id, l.id)
    return id
  }
  private saveOpportunity(d: any, u: User) {
    const c = this.entity('contact', d.contactId, u) as CrmContact
    if (!c.active) throw new Error('العميل متوقف')
    const old = d.id ? (this.entity('opportunity', d.id, u) as CrmOpportunity) : undefined
    this.version(old, d.version)
    if (old && old.contactId !== d.contactId) throw new Error('الفرصة تخص عميلًا آخر')
    if (old && ['won', 'lost'].includes(old.stage)) throw new Error('أعد فتح الفرصة قبل تعديلها')
    const id = d.id ?? ulid()
    this.db
      .prepare(
        "INSERT INTO crm_opportunities VALUES(?,?,?,?,?,?,?,'new',NULL,NULL,?,0) ON CONFLICT(id) DO UPDATE SET title=excluded.title,value=excluded.value,probability=excluded.probability,expected_close=excluded.expected_close,note=excluded.note,version=crm_opportunities.version+1",
      )
      .run(id, d.contactId, d.title, d.value, d.probability, d.expectedClose, d.note, Date.now())
    return id
  }
  private stage(d: any, u: User) {
    const o = this.entity('opportunity', d.id, u) as CrmOpportunity
    this.version(o, d.version)
    if (o.stage === d.stage) throw new Error('المرحلة مسجلة بالفعل')
    if (['won', 'lost'].includes(o.stage) && (!manager(u) || ['won', 'lost'].includes(d.stage)))
      throw new Error('إعادة فتح الفرصة تحتاج المدير ومرحلة مفتوحة')
    if (
      (d.stage === 'won' && d.actualValue === null) ||
      (d.stage !== 'won' && d.actualValue !== null)
    )
      throw new Error('أدخل القيمة المؤكدة للفوز فقط')
    const closed = ['won', 'lost'].includes(d.stage)
    this.db
      .prepare(
        'UPDATE crm_opportunities SET stage=?,actual_value=?,closed_at=?,version=version+1 WHERE id=?',
      )
      .run(d.stage, d.actualValue, closed ? Date.now() : null, o.id)
    return o.id
  }
  private saveTask(d: any, u: User) {
    const entity = this.entity(d.entityType, d.entityId, u),
      old = d.id ? this.task(d.id, u) : undefined
    this.version(old, d.version)
    if (old && (old.entityType !== d.entityType || old.entityId !== d.entityId))
      throw new Error('المتابعة تخص سجلًا آخر')
    if (old && old.status !== 'open') throw new Error('المتابعة مغلقة؛ أعد فتحها أولًا')
    if (d.entityType === 'opportunity' && ['won', 'lost'].includes(entity.stage))
      throw new Error('الفرصة مغلقة')
    if (d.entityType === 'contact' && !entity.active) throw new Error('العميل متوقف')
    const id = d.id ?? ulid()
    this.db
      .prepare(
        "INSERT INTO crm_tasks VALUES(?,?,?,?,?,?,?,?,'open','',?,0) ON CONFLICT(id) DO UPDATE SET title=excluded.title,kind=excluded.kind,due_day=excluded.due_day,due_minute=excluded.due_minute,note=excluded.note,version=crm_tasks.version+1",
      )
      .run(id, d.entityType, d.entityId, d.title, d.kind, d.dueDay, d.dueMinute, d.note, Date.now())
    return id
  }
  private issue(d: any, u: User) {
    const o = this.entity('opportunity', d.opportunityId, u) as CrmOpportunity,
      c = this.entity('contact', o.contactId, u) as CrmContact
    this.version(o, d.opportunityVersion)
    this.version(c, d.contactVersion)
    if (!c.active || ['won', 'lost'].includes(o.stage)) throw new Error('الفرصة أو العميل مغلق')
    if (d.validUntil < clinicToday()) throw new Error('صلاحية العرض يجب ألا تكون في الماضي')
    const lines = d.lines.map((x: any) => ({
        ...x,
        value: safe(
          lineTotal(Money.fromPiastres(x.price), Quantity.fromMilliUnits(x.qty)) as number,
        ),
      })),
      subtotal = lines.reduce((n: number, x: any) => safe(n + x.value), 0)
    if (d.discount > subtotal) throw new Error('الخصم أكبر من إجمالي العرض')
    const tax = Money.applyRate(
        Money.fromPiastres(subtotal - d.discount),
        basisPoints(d.taxBps),
      ) as number,
      total = safe(subtotal - d.discount + tax)
    const id = ulid()
    this.db
      .prepare(
        "INSERT INTO sequences VALUES('crm',1) ON CONFLICT(kind) DO UPDATE SET value=value+1",
      )
      .run()
    const n = this.row<{ value: number }>("SELECT value FROM sequences WHERE kind='crm'").value
    const { note: privateNote, ownerId, version, ...customer } = c
    void privateNote
    void ownerId
    void version
    this.db
      .prepare('INSERT INTO crm_quotes VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(
        id,
        'CRM-' + String(n).padStart(6, '0'),
        o.id,
        d.validUntil,
        d.reference,
        d.note,
        JSON.stringify(customer),
        JSON.stringify(this.settings()),
        subtotal,
        d.discount,
        d.taxBps,
        tax,
        total,
        u.id,
        u.name,
        Date.now(),
      )
    this.db.prepare("INSERT INTO crm_quote_status VALUES(?,'issued','','',?,0)").run(id, Date.now())
    for (const x of lines)
      this.db
        .prepare('INSERT INTO crm_quote_lines VALUES(?,?,?,?,?,?,?)')
        .run(ulid(), id, x.description, x.unit, x.qty, x.price, x.value)
    return id
  }
  private decideQuote(d: any, u: User) {
    const q = this.quote(d.id, u)
    this.version(q, d.version)
    if (q.status !== 'issued') throw new Error('حالة العرض نهائية؛ أصدر نسخة جديدة عند الحاجة')
    if (d.status === 'accepted') {
      if (q.validUntil < clinicToday()) throw new Error('صلاحية العرض انتهت')
      const o = this.entity('opportunity', q.opportunityId, u)
      if (o.stage === 'lost' || !this.entity('contact', o.contactId, u).active)
        throw new Error('الفرصة خاسرة أو العميل متوقف')
      if (
        this.row(
          "SELECT 1 FROM crm_quotes q JOIN crm_quote_status s ON s.quote_id=q.id WHERE q.opportunity_id=? AND s.status='accepted'",
          q.opportunityId,
        )
      )
        throw new Error('يوجد عرض مقبول لهذه الفرصة بالفعل')
    }
    this.db
      .prepare(
        'UPDATE crm_quote_status SET status=?,reason=?,reference=?,at=?,version=version+1 WHERE quote_id=?',
      )
      .run(d.status, d.reason, d.reference, Date.now(), q.id)
    return q.id
  }
  call(action: string, input: unknown, u: User) {
    if (!['admin', 'manager', 'cashier'].includes(u.role)) throw new Error('ليس لديك صلاحية CRM')
    const schema = crmSchemas[action as keyof typeof crmSchemas]
    if (!schema) throw new Error('العملية غير متاحة')
    const d = schema.parse(input) as any
    if (action === 'crm.state') return this.state(u)
    if (action === 'crm.report') return this.report(d, u)
    if (action === 'crm.quote.get') return this.getQuote(d.id, u)
    if (action.endsWith('.get')) return this.get(action.split('.')[1] as CrmEntity, d.id, u)
    return this.db.transaction(() => {
      const h = fingerprint(d),
        prev = this.row<any>('SELECT * FROM commands WHERE client_txn_id=?', d.clientTxnId)
      if (prev) {
        if (prev.action !== action || prev.user_id !== u.id || prev.request_hash !== h)
          throw new Error('معرف العملية مستخدم لبيانات مختلفة')
        return JSON.parse(prev.result)
      }
      let id: string,
        type: CrmEntity,
        entityId: string,
        snapshot: unknown = {}
      if (action === 'crm.lead.save' || action === 'crm.contact.save') {
        type = action.includes('.lead.') ? 'lead' : 'contact'
        id = this.savePerson(type, d, u)
        entityId = id
        snapshot = this.entity(type, id, u)
      } else if (action === 'crm.lead.status') {
        type = 'lead'
        const l = this.entity(type, d.id, u)
        this.version(l, d.version)
        if (l.status === 'converted' || l.status === d.status)
          throw new Error('حالة العميل لا تسمح بهذا التغيير')
        this.db
          .prepare('UPDATE crm_leads SET status=?,version=version+1 WHERE id=?')
          .run(d.status, l.id)
        id = entityId = l.id
        snapshot = this.entity(type, id, u)
      } else if (action === 'crm.lead.convert') {
        type = 'lead'
        id = this.convert(d, u)
        entityId = d.id
        snapshot = { contactId: id }
      } else if (action === 'crm.opportunity.save') {
        type = 'opportunity'
        id = this.saveOpportunity(d, u)
        entityId = id
        snapshot = this.entity(type, id, u)
      } else if (action === 'crm.opportunity.stage') {
        type = 'opportunity'
        id = this.stage(d, u)
        entityId = id
        snapshot = this.entity(type, id, u)
      } else if (action === 'crm.task.save') {
        type = d.entityType
        entityId = d.entityId
        id = this.saveTask(d, u)
        snapshot = this.task(id, u)
      } else if (action === 'crm.task.status') {
        const x = this.task(d.id, u)
        this.version(x, d.version)
        if (x.status === d.status || (x.status !== 'open' && (!manager(u) || d.status !== 'open')))
          throw new Error('إعادة فتح المتابعة تحتاج المدير')
        this.db
          .prepare('UPDATE crm_tasks SET status=?,outcome=?,version=version+1 WHERE id=?')
          .run(d.status, d.outcome, x.id)
        type = x.entityType
        entityId = x.entityId
        id = x.id
        snapshot = this.task(id, u)
      } else if (action === 'crm.activity.add') {
        this.entity(d.entityType, d.entityId, u)
        type = d.entityType
        entityId = d.entityId
        id = ulid()
        snapshot = {}
      } else if (action === 'crm.quote.issue') {
        type = 'opportunity'
        id = this.issue(d, u)
        entityId = d.opportunityId
        snapshot = { quoteId: id, number: this.quote(id, u).number, total: this.quote(id, u).total }
      } else if (action === 'crm.quote.status') {
        type = 'opportunity'
        const q = this.quote(d.id, u)
        id = this.decideQuote(d, u)
        entityId = q.opportunityId
        snapshot = { quoteId: id, status: d.status, reference: d.reference }
      } else throw new Error('العملية غير متاحة')
      const aid = this.activity(
        type,
        entityId,
        action,
        d.kind ?? (action === 'crm.lead.convert' ? 'conversion' : 'event'),
        d.text ??
          d.reason ??
          d.outcome ??
          (action === 'crm.lead.convert' ? 'تم التحويل إلى ملف عميل' : ''),
        snapshot,
        u,
      )
      if (action === 'crm.activity.add') id = aid
      this.identity.audit(u.id, action, id)
      const result = { id }
      this.db
        .prepare('INSERT INTO commands VALUES(?,?,?,?,?)')
        .run(d.clientTxnId, action, u.id, h, JSON.stringify(result))
      return result
    })()
  }
}
