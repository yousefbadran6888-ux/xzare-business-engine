import type { XzareDatabase } from '@xzare/db'
import { ulid } from '@xzare/core'
import { Identity } from './identity.js'
import { fingerprint } from './commerce.js'
import { clinicDayBounds } from './clinic-time.js'
import type { User, Audit } from './types.js'
import {
  laboratorySchemas,
  type LabPatient,
  type LabTest,
  type LabOrder,
  type LabSample,
  type LabResult,
  type LabReport,
  type LabReportSnapshot,
  type LabOrderDetail,
} from './laboratory-validation.js'
const pq =
  'SELECT id,number,name,phone,birth_date AS birthDate,sex,address,active,version FROM lab_patients'
const oq = `SELECT o.id,o.number,o.patient_id AS patientId,o.patient_snapshot AS patient,o.referrer,o.due_at AS dueAt,o.at,o.subtotal,o.discount,o.tax_bps AS taxBps,o.tax,o.total,w.status,w.version,w.amendment_reason AS amendmentReason,w.draft_changed AS draftChanged,COALESCE((SELECT sum(amount) FROM lab_payments p WHERE p.order_id=o.id),0) AS paid,COALESCE((SELECT max(revision) FROM lab_reports r WHERE r.order_id=o.id),0) AS revision FROM lab_orders o JOIN lab_order_work w ON w.order_id=o.id`
const sq = `SELECT s.id,s.number,s.order_id AS orderId,o.number AS orderNumber,json_extract(o.patient_snapshot,'$.name') AS patientName,json_extract(o.patient_snapshot,'$.number') AS patientNumber,s.specimen,s.status,s.version,s.replaces_id AS replacesId,(SELECT c.id FROM lab_samples c WHERE c.replaces_id=s.id) AS replacedBy,s.created_at AS createdAt FROM lab_samples s JOIN lab_orders o ON o.id=s.order_id`
const safe = (n: bigint | number) => {
  const b = BigInt(n)
  if (b < 0n || b > 1000000000000n) throw new Error('المبلغ أكبر من الحد المسموح')
  return Number(b)
}
const sum = (xs: number[]) => safe(xs.reduce((a, n) => a + BigInt(n), 0n))
const numeric = /^(?:[<>]=?|[≤≥])?[-+]?\d+(?:\.\d{1,8})?$/
export class Laboratory {
  constructor(
    readonly db: XzareDatabase,
    readonly identity: Identity,
  ) {}
  private number(kind: string, prefix: string) {
    this.db
      .prepare('INSERT INTO sequences VALUES(?,1) ON CONFLICT(kind) DO UPDATE SET value=value+1')
      .run('laboratory-' + kind)
    return (
      prefix +
      String(
        (
          this.db.prepare('SELECT value FROM sequences WHERE kind=?').get('laboratory-' + kind) as {
            value: number
          }
        ).value,
      ).padStart(6, '0')
    )
  }
  private version(row: { version: number }, v: unknown) {
    if (row.version !== v) throw new Error('البيانات تغيرت؛ حدّث العرض ثم حاول مرة أخرى')
  }
  private patient(id: string) {
    const p = this.db.prepare(pq + ' WHERE id=?').get(id) as LabPatient | undefined
    if (!p) throw new Error('ملف المريض غير موجود')
    return p
  }
  private test(id: string) {
    const t = this.db.prepare('SELECT * FROM lab_tests WHERE id=?').get(id) as LabTest | undefined
    if (!t) throw new Error('التحليل غير موجود')
    return t
  }
  private order(id: string): LabOrder {
    const r = this.db.prepare(oq + ' WHERE o.id=?').get(id) as
      (Omit<LabOrder, 'patient' | 'balance'> & { patient: string }) | undefined
    if (!r) throw new Error('طلب التحاليل غير موجود')
    return {
      ...r,
      patient: JSON.parse(r.patient),
      balance: r.status === 'cancelled' ? 0 : safe(r.total - r.paid),
    }
  }
  private technical(u: User) {
    return ['admin', 'manager', 'technician'].includes(u.role)
  }
  private financialOrder(raw: LabOrder, u: User) {
    const o = { ...raw, amendmentReason: this.technical(u) ? raw.amendmentReason : '' }
    return u.role === 'technician'
      ? { ...o, subtotal: 0, discount: 0, taxBps: 0, tax: 0, total: 0, paid: 0, balance: 0 }
      : o
  }
  private lines(id: string): LabResult[] {
    return (
      this.db
        .prepare(
          'SELECT t.id,t.definition,t.price,r.value,r.note,r.author_id AS authorId,u.name AS authorName FROM lab_order_tests t JOIN lab_results r ON r.order_test_id=t.id LEFT JOIN users u ON u.id=r.author_id WHERE t.order_id=? ORDER BY t.rowid',
        )
        .all(id) as (Omit<LabResult, 'definition'> & { definition: string })[]
    ).map((r) => ({ ...r, definition: JSON.parse(r.definition) }))
  }
  private samples(id: string) {
    return this.db
      .prepare(sq + ' WHERE s.order_id=? ORDER BY s.created_at,s.rowid')
      .all(id) as LabSample[]
  }
  private sample(id: string) {
    const s = this.db.prepare(sq + ' WHERE s.id=?').get(id) as LabSample | undefined
    if (!s) throw new Error('العينة غير موجودة')
    return s
  }
  private event(s: LabSample, u: User, note: string) {
    this.db
      .prepare('INSERT INTO lab_sample_events VALUES(?,?,?,?,?,?)')
      .run(ulid(), s.id, u.id, Date.now(), s.status, note)
  }
  private newSample(
    orderId: string,
    specimen: string,
    u: User,
    note: string,
    replacesId: string | null = null,
  ) {
    const id = ulid()
    this.db
      .prepare("INSERT INTO lab_samples VALUES(?,?,?,?,'pending',0,?,?)")
      .run(id, this.number('sample', 'LS-'), orderId, specimen, replacesId, Date.now())
    this.event(this.sample(id), u, note)
    return id
  }
  private received(id: string) {
    const active = this.samples(id).filter((s) => !s.replacedBy)
    if (!active.length || active.some((s) => s.status !== 'received'))
      throw new Error('استلم كل عينة سليمة قبل حفظ أو اعتماد النتائج')
    return active
  }
  private editable(o: LabOrder) {
    if (o.status !== 'testing')
      throw new Error('الطلب معتمد أو ملغي؛ التصحيح يحتاج فتح مراجعة جديدة')
  }
  private reconciled() {
    return !this.db
      .prepare(
        `SELECT o.id FROM lab_orders o WHERE o.total!=o.subtotal-o.discount+o.tax OR o.subtotal!=COALESCE((SELECT sum(price) FROM lab_order_tests t WHERE t.order_id=o.id),0) OR COALESCE((SELECT sum(amount) FROM lab_payments p WHERE p.order_id=o.id),0)>o.total OR EXISTS(SELECT 1 FROM lab_refunds r WHERE r.order_id=o.id AND r.amount!=COALESCE((SELECT sum(amount) FROM lab_payments p WHERE p.order_id=o.id),0)) LIMIT 1`,
      )
      .get()
  }
  state(u: User) {
    const admin = u.role === 'admin',
      tech = u.role === 'technician'
    return {
      user: u,
      settings: Object.fromEntries(
        (
          this.db
            .prepare(
              "SELECT key,value FROM settings WHERE key IN('businessName','phone','address','currency','receiptFooter','language','taxBps')",
            )
            .all() as { key: string; value: string }[]
        ).map((x) => [x.key, x.value]),
      ),
      patients: this.db.prepare(pq + ' ORDER BY name,number').all() as LabPatient[],
      tests: (this.db.prepare('SELECT * FROM lab_tests ORDER BY name,code').all() as LabTest[]).map(
        (t) => (tech ? { ...t, price: 0 } : t),
      ),
      orders: (
        this.db
          .prepare(
            oq +
              " WHERE w.status='testing' OR o.id IN(SELECT id FROM lab_orders ORDER BY at DESC LIMIT 2000) ORDER BY o.at DESC",
          )
          .all() as { id: string }[]
      ).map((x) => this.financialOrder(this.order(x.id), u)),
      samples: this.db
        .prepare(
          sq +
            " WHERE s.order_id IN(SELECT order_id FROM lab_order_work WHERE status='testing') OR s.id IN(SELECT id FROM lab_samples ORDER BY created_at DESC LIMIT 2000) ORDER BY s.created_at DESC",
        )
        .all() as LabSample[],
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
            .all() as Audit[])
        : [],
      reconciled: tech ? true : this.reconciled(),
    }
  }
  private detail(id: string, u: User): LabOrderDetail {
    const o = this.order(id),
      technical = this.technical(u),
      tech = u.role === 'technician'
    if (technical) this.identity.audit(u.id, 'laboratory.result.read', id)
    return {
      order: this.financialOrder(o, u),
      tests: this.lines(id).map((l) => {
        const base = {
          id: l.id,
          definition: tech ? { ...l.definition, price: 0 } : l.definition,
          price: tech ? 0 : l.price,
        }
        return technical
          ? {
              ...base,
              value: l.value,
              note: l.note,
              authorId: l.authorId,
              authorName: l.authorName,
            }
          : base
      }),
      samples: this.samples(id),
      events: technical
        ? (this.db
            .prepare(
              'SELECT e.id,e.sample_id AS sampleId,e.at,e.status,e.note,u.name AS userName FROM lab_sample_events e JOIN lab_samples s ON s.id=e.sample_id JOIN users u ON u.id=e.user_id WHERE s.order_id=? ORDER BY e.at,e.rowid',
            )
            .all(id) as LabOrderDetail['events'])
        : [],
      reports: technical
        ? (
            this.db
              .prepare(
                'SELECT r.id,r.revision,r.at,r.reason,r.snapshot FROM lab_reports r WHERE r.order_id=? ORDER BY r.revision DESC',
              )
              .all(id) as (Omit<LabReport, 'snapshot'> & { snapshot: string })[]
          ).map((r) => {
            const snapshot = JSON.parse(r.snapshot) as LabReportSnapshot
            return {
              ...r,
              reviewerName: snapshot.reviewerName,
              snapshot: tech
                ? {
                    ...snapshot,
                    tests: snapshot.tests.map((t) => ({
                      ...t,
                      price: 0,
                      definition: { ...t.definition, price: 0 },
                    })),
                  }
                : snapshot,
            }
          })
        : [],
      payments: tech
        ? []
        : (this.db
            .prepare(
              'SELECT id,at,amount,method,reference FROM lab_payments WHERE order_id=? ORDER BY at,rowid',
            )
            .all(id) as LabOrderDetail['payments']),
      refund: tech
        ? undefined
        : (this.db
            .prepare('SELECT at,amount,note,method,reference FROM lab_refunds WHERE order_id=?')
            .get(id) as LabOrderDetail['refund']),
    }
  }
  report(from: string, to: string) {
    if (from > to) throw new Error('راجع فترة التقرير')
    const { lo, hi, timeZone } = clinicDayBounds(from, to)
    const orders = (
      this.db.prepare(oq + ' WHERE o.at>=? AND o.at<? ORDER BY o.at DESC').all(lo, hi) as {
        id: string
      }[]
    ).map((x) => ({ ...this.order(x.id), amendmentReason: '' }))
    const payments = this.db
      .prepare(
        'SELECT p.id,o.number,p.at,p.amount,p.method,p.reference FROM lab_payments p JOIN lab_orders o ON o.id=p.order_id WHERE p.at>=? AND p.at<? ORDER BY p.at DESC',
      )
      .all(lo, hi) as {
      id: string
      number: string
      at: number
      amount: number
      method: string
      reference: string
    }[]
    const refunds = this.db
      .prepare(
        'SELECT r.order_id AS id,o.number,r.at,r.amount,r.note,r.method,r.reference FROM lab_refunds r JOIN lab_orders o ON o.id=r.order_id WHERE r.at>=? AND r.at<? ORDER BY r.at DESC',
      )
      .all(lo, hi) as {
      id: string
      number: string
      at: number
      amount: number
      note: string
      method: string
      reference: string
    }[]
    return {
      from,
      to,
      timeZone,
      orders,
      payments,
      refunds,
      revenue: sum(orders.map((o) => o.total)) - sum(refunds.map((r) => this.order(r.id).total)),
      collected: sum(payments.map((p) => p.amount)),
      refunded: sum(refunds.map((r) => r.amount)),
      receivable: sum(
        (this.db.prepare(oq).all() as { id: string }[]).map((x) => this.order(x.id).balance),
      ),
      reconciled: this.reconciled(),
    }
  }
  call(action: string, payload: unknown, u: User): unknown {
    const schema = laboratorySchemas[action as keyof typeof laboratorySchemas]
    if (!schema) throw new Error('العملية غير متاحة في المعمل')
    const parsed = schema.safeParse(payload)
    if (!parsed.success) throw new Error('راجع الحقول والتواريخ والمبالغ والمجال المرجعي')
    const d = parsed.data as any
    if (
      (action.startsWith('laboratory.result.') || action.startsWith('laboratory.sample.')) &&
      !this.technical(u)
    )
      throw new Error('ليس لديك صلاحية للعينات والنتائج')
    if (
      ['laboratory.result.approve', 'laboratory.result.reopen', 'laboratory.test.save'].includes(
        action,
      ) &&
      !['admin', 'manager'].includes(u.role)
    )
      throw new Error('ليس لديك صلاحية للاعتماد أو دليل التحاليل')
    if (
      u.role === 'technician' &&
      !['laboratory.state', 'laboratory.patient.get', 'laboratory.order.get'].includes(action) &&
      !action.startsWith('laboratory.result.') &&
      !action.startsWith('laboratory.sample.')
    )
      throw new Error('ليس لديك صلاحية للعملية المالية أو الإدارية')
    if (action === 'laboratory.order.cancel' && u.role !== 'admin')
      throw new Error('ليس لديك صلاحية للإلغاء والاسترداد')
    return this.db.transaction(() => {
      if (d.clientTxnId) {
        const old = this.db
          .prepare('SELECT * FROM commands WHERE client_txn_id=?')
          .get(d.clientTxnId) as
          { user_id: string; action: string; request_hash: string; result: string } | undefined
        if (old) {
          if (old.user_id !== u.id || old.action !== action || old.request_hash !== fingerprint(d))
            throw new Error('معرّف العملية مستخدم لطلب آخر')
          return JSON.parse(old.result)
        }
      }
      let result: { id: string }
      switch (action) {
        case 'laboratory.state':
          return this.state(u)
        case 'laboratory.order.get':
          return this.detail(d.id, u)
        case 'laboratory.patient.get':
          return {
            patient: this.patient(d.id),
            orders: (
              this.db
                .prepare('SELECT id FROM lab_orders WHERE patient_id=? ORDER BY at DESC')
                .all(d.id) as { id: string }[]
            ).map((x) => this.financialOrder(this.order(x.id), u)),
          }
        case 'laboratory.report':
          return this.report(d.from, d.to)
        case 'laboratory.patient.save': {
          const id = d.id ?? ulid()
          if (d.id) {
            const p = this.patient(id)
            this.version(p, d.version)
            if (
              !d.active &&
              this.db
                .prepare(
                  "SELECT o.id FROM lab_orders o JOIN lab_order_work w ON w.order_id=o.id WHERE o.patient_id=? AND w.status='testing' LIMIT 1",
                )
                .get(id)
            )
              throw new Error('للمريض طلب مفتوح؛ أغلقه قبل الأرشفة')
            this.db
              .prepare(
                'UPDATE lab_patients SET name=?,phone=?,birth_date=?,sex=?,address=?,active=?,version=version+1 WHERE id=?',
              )
              .run(d.name, d.phone, d.birthDate, d.sex, d.address, Number(d.active), id)
          } else
            this.db
              .prepare('INSERT INTO lab_patients VALUES(?,?,?,?,?,?,?,?,0)')
              .run(
                id,
                this.number('patient', 'LP-'),
                d.name,
                d.phone,
                d.birthDate,
                d.sex,
                d.address,
                Number(d.active),
              )
          result = { id }
          break
        }
        case 'laboratory.test.save': {
          const id = d.id ?? ulid()
          if (
            this.db
              .prepare('SELECT id FROM lab_tests WHERE code=? COLLATE NOCASE AND id!=?')
              .get(d.code, id)
          )
            throw new Error('كود التحليل مستخدم بالفعل')
          if (d.id) {
            this.version(this.test(id), d.version)
            this.db
              .prepare(
                'UPDATE lab_tests SET code=?,name=?,specimen=?,kind=?,unit=?,reference=?,min=?,max=?,price=?,active=?,version=version+1 WHERE id=?',
              )
              .run(
                d.code,
                d.name,
                d.specimen,
                d.kind,
                d.unit,
                d.reference,
                d.min,
                d.max,
                d.price,
                Number(d.active),
                id,
              )
          } else
            this.db
              .prepare('INSERT INTO lab_tests VALUES(?,?,?,?,?,?,?,?,?,?,?,0)')
              .run(
                id,
                d.code,
                d.name,
                d.specimen,
                d.kind,
                d.unit,
                d.reference,
                d.min,
                d.max,
                d.price,
                Number(d.active),
              )
          result = { id }
          break
        }
        case 'laboratory.order.create': {
          const p = this.patient(d.patientId)
          if (!p.active) throw new Error('اختر مريضًا نشطًا')
          const tests = d.testIds.map((id: string) => this.test(id))
          if (tests.some((x: LabTest) => !x.active)) throw new Error('اختر تحاليل نشطة')
          const subtotal = sum(tests.map((x: LabTest) => x.price))
          if (d.discount > subtotal) throw new Error('الخصم أكبر من قيمة التحاليل')
          const tax = safe((BigInt(subtotal - d.discount) * BigInt(d.taxBps) + 5000n) / 10000n),
            total = safe(BigInt(subtotal - d.discount) + BigInt(tax)),
            id = ulid()
          this.db
            .prepare('INSERT INTO lab_orders VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
            .run(
              id,
              this.number('order', 'LO-'),
              p.id,
              JSON.stringify(p),
              d.referrer,
              d.dueAt,
              u.id,
              Date.now(),
              subtotal,
              d.discount,
              d.taxBps,
              tax,
              total,
            )
          this.db.prepare("INSERT INTO lab_order_work(order_id,status) VALUES(?,'testing')").run(id)
          for (const test of tests) {
            const lineId = ulid()
            this.db
              .prepare('INSERT INTO lab_order_tests VALUES(?,?,?,?,?)')
              .run(lineId, id, test.id, JSON.stringify(test), test.price)
            this.db.prepare('INSERT INTO lab_results(order_test_id) VALUES(?)').run(lineId)
          }
          for (const specimen of new Set<string>(tests.map((x: LabTest) => x.specimen)))
            this.newSample(id, specimen, u, 'إنشاء طلب التحاليل')
          result = { id }
          break
        }
        case 'laboratory.sample.status': {
          const s = this.sample(d.id),
            o = this.order(s.orderId)
          this.editable(o)
          this.version(s, d.version)
          if (
            s.replacedBy ||
            !(
              (s.status === 'pending' && d.status === 'collected') ||
              (s.status === 'collected' && ['received', 'rejected'].includes(d.status)) ||
              (s.status === 'received' && d.status === 'rejected')
            )
          )
            throw new Error('انتقال حالة العينة غير مسموح')
          this.db
            .prepare('UPDATE lab_samples SET status=?,version=version+1 WHERE id=?')
            .run(d.status, s.id)
          if (d.status === 'rejected')
            for (const l of this.lines(o.id).filter((l) => l.definition.specimen === s.specimen))
              this.db
                .prepare(
                  "UPDATE lab_results SET value='',note='',author_id=NULL WHERE order_test_id=?",
                )
                .run(l.id)
          this.db
            .prepare('UPDATE lab_order_work SET version=version+1,draft_changed=0 WHERE order_id=?')
            .run(o.id)
          this.event(this.sample(s.id), u, d.note)
          result = { id: s.id }
          break
        }
        case 'laboratory.sample.replace': {
          const s = this.sample(d.id),
            o = this.order(s.orderId)
          this.editable(o)
          this.version(s, d.version)
          if (s.status !== 'rejected' || s.replacedBy)
            throw new Error('إعادة السحب متاحة لعينة مرفوضة لم تُستبدل')
          const id = this.newSample(o.id, s.specimen, u, d.note, s.id)
          this.db
            .prepare('UPDATE lab_order_work SET version=version+1,draft_changed=0 WHERE order_id=?')
            .run(o.id)
          result = { id }
          break
        }
        case 'laboratory.result.save': {
          const o = this.order(d.id)
          this.editable(o)
          this.version(o, d.version)
          this.received(o.id)
          const lines = this.lines(o.id)
          if (
            d.values.length !== lines.length ||
            d.values.some((v: { id: string }) => !lines.some((l) => l.id === v.id))
          )
            throw new Error('أدخل نتائج جميع التحاليل في هذا الطلب')
          for (const v of d.values) {
            const l = lines.find((x) => x.id === v.id)!
            if (
              l.definition.kind === 'number' &&
              (!numeric.test(v.value) ||
                !Number.isFinite(Number(v.value.replace(/^[<>≤≥]=?/, ''))) ||
                Math.abs(Number(v.value.replace(/^[<>≤≥]=?/, ''))) > 1e12)
            )
              throw new Error('أدخل نتيجة رقمية صحيحة حتى 8 خانات عشرية؛ يمكن استخدام < أو >')
            this.db
              .prepare('UPDATE lab_results SET value=?,note=?,author_id=? WHERE order_test_id=?')
              .run(v.value, v.note, u.id, v.id)
          }
          this.db
            .prepare('UPDATE lab_order_work SET version=version+1,draft_changed=1 WHERE order_id=?')
            .run(o.id)
          result = { id: o.id }
          break
        }
        case 'laboratory.result.approve': {
          const o = this.order(d.id)
          this.editable(o)
          this.version(o, d.version)
          const samples = this.received(o.id),
            lines = this.lines(o.id)
          if (!o.draftChanged || lines.some((l) => !l.value?.trim() || !l.authorId))
            throw new Error('احفظ كل النتائج قبل الاعتماد')
          if (lines.some((l) => l.authorId === u.id))
            throw new Error('الاعتماد يحتاج مستخدم آخر غير مُدخل النتائج')
          const snapshot: LabReportSnapshot = {
            reviewerName: u.name,
            patient: o.patient,
            orderNumber: o.number,
            referrer: o.referrer,
            tests: lines.map((l) => {
              const v = Number(l.value),
                def = l.definition
              const flag =
                !/^[-+]?\d+(?:\.\d+)?$/.test(l.value ?? '') ||
                def.kind !== 'number' ||
                (def.min === null && def.max === null)
                  ? 'unclassified'
                  : def.min !== null && v < def.min
                    ? 'low'
                    : def.max !== null && v > def.max
                      ? 'high'
                      : 'normal'
              return {
                ...l,
                flag,
                sampleNumber: samples.find((s) => s.specimen === def.specimen)!.number,
              }
            }),
          }
          this.db
            .prepare('INSERT INTO lab_reports VALUES(?,?,?,?,?,?,?)')
            .run(
              ulid(),
              o.id,
              o.revision + 1,
              u.id,
              Date.now(),
              o.amendmentReason,
              JSON.stringify(snapshot),
            )
          this.db
            .prepare(
              "UPDATE lab_order_work SET status='released',version=version+1,draft_changed=0 WHERE order_id=?",
            )
            .run(o.id)
          result = { id: o.id }
          break
        }
        case 'laboratory.result.reopen': {
          const o = this.order(d.id)
          this.version(o, d.version)
          if (o.status !== 'released') throw new Error('افتح مراجعة للطلب المعتمد فقط')
          this.db
            .prepare(
              "UPDATE lab_order_work SET status='testing',version=version+1,amendment_reason=?,draft_changed=0 WHERE order_id=?",
            )
            .run(d.reason, o.id)
          result = { id: o.id }
          break
        }
        case 'laboratory.order.pay': {
          const o = this.order(d.id)
          if (o.status === 'cancelled' || d.amount > o.balance)
            throw new Error('الطلب ملغي أو المبلغ أكبر من المتبقي')
          this.db
            .prepare('INSERT INTO lab_payments VALUES(?,?,?,?,?,?,?)')
            .run(ulid(), o.id, u.id, Date.now(), d.amount, d.method, d.reference)
          result = { id: o.id }
          break
        }
        case 'laboratory.order.cancel': {
          const o = this.order(d.id)
          this.version(o, d.version)
          if (o.status !== 'testing' || o.revision > 0)
            throw new Error('لا يمكن إلغاء طلب له تقرير معتمد أو سبق إلغاؤه')
          this.db
            .prepare('INSERT INTO lab_refunds VALUES(?,?,?,?,?,?,?)')
            .run(o.id, u.id, Date.now(), d.note, o.paid, d.method, d.reference)
          this.db
            .prepare(
              "UPDATE lab_order_work SET status='cancelled',version=version+1 WHERE order_id=?",
            )
            .run(o.id)
          result = { id: o.id }
          break
        }
        default:
          throw new Error('العملية غير متاحة في المعمل')
      }
      this.identity.audit(u.id, action, result.id)
      this.db
        .prepare('INSERT INTO commands VALUES(?,?,?,?,?)')
        .run(d.clientTxnId, action, u.id, fingerprint(d), JSON.stringify(result))
      return result
    })()
  }
}
