import { clinicDayBounds } from './clinic-time.js'
import type { XzareDatabase } from '@xzare/db'
import { ulid } from '@xzare/core'
import { Identity } from './identity.js'
import { fingerprint } from './commerce.js'
import type { User, Audit } from './types.js'
import {
  clinicSchemas,
  type ClinicPatient,
  type ClinicDoctor,
  type ClinicService,
  type ClinicAppointment,
  type ClinicInvoice,
} from './clinic-validation.js'
const pq =
    'SELECT id,number,name,phone,birth_date AS birthDate,sex,address,active,version FROM clinic_patients',
  dq = 'SELECT id,name,specialty,user_id AS userId,active,version FROM clinic_doctors',
  sq = 'SELECT * FROM clinic_services'
const aq = `SELECT a.id,a.number,a.patient_id AS patientId,p.name AS patientName,p.number AS patientNumber,a.doctor_id AS doctorId,d.name AS doctorName,a.start,a.duration,a.reason,a.status,a.version,a.created_at AS createdAt,v.id AS visitId,i.id AS invoiceId FROM clinic_appointments a JOIN clinic_patients p ON p.id=a.patient_id JOIN clinic_doctors d ON d.id=a.doctor_id LEFT JOIN clinic_visits v ON v.appointment_id=a.id LEFT JOIN clinic_invoices i ON i.appointment_id=a.id`
const iq = `SELECT i.id,i.number,i.appointment_id AS appointmentId,i.patient_snapshot AS patient,i.doctor_snapshot AS doctor,i.at,i.subtotal,i.discount,i.tax_bps AS taxBps,i.tax,i.total,COALESCE((SELECT sum(amount) FROM clinic_payments p WHERE p.invoice_id=i.id),0) AS paid,EXISTS(SELECT 1 FROM clinic_voids v WHERE v.invoice_id=i.id) AS voided FROM clinic_invoices i`
function safe(n: bigint | number): number {
  const b = BigInt(n)
  if (b < 0n || b > 1000000000000n) throw new Error('المبلغ أكبر من الحد المسموح')
  return Number(b)
}
const plus = (ns: number[]) => safe(ns.reduce((n, x) => n + BigInt(x), 0n))
export class Clinic {
  constructor(
    readonly db: XzareDatabase,
    readonly identity: Identity,
  ) {}
  private number(kind: string, prefix: string) {
    this.db
      .prepare('INSERT INTO sequences VALUES(?,1) ON CONFLICT(kind) DO UPDATE SET value=value+1')
      .run('clinic-' + kind)
    return (
      prefix +
      String(
        (
          this.db.prepare('SELECT value FROM sequences WHERE kind=?').get('clinic-' + kind) as {
            value: number
          }
        ).value,
      ).padStart(6, '0')
    )
  }
  private patient(id: string) {
    const p = this.db.prepare(pq + ' WHERE id=?').get(id) as ClinicPatient | undefined
    if (!p) throw new Error('ملف المريض غير موجود')
    return p
  }
  private doctor(id: string) {
    const d = this.db.prepare(dq + ' WHERE id=?').get(id) as ClinicDoctor | undefined
    if (!d) throw new Error('الطبيب غير موجود')
    return d
  }
  private appointment(id: string) {
    const a = this.db.prepare(aq + ' WHERE a.id=?').get(id) as ClinicAppointment | undefined
    if (!a) throw new Error('الموعد غير موجود')
    return a
  }
  private doctorId(u: User) {
    return (
      (
        this.db.prepare('SELECT id FROM clinic_doctors WHERE user_id=? AND active=1').get(u.id) as
          { id: string } | undefined
      )?.id ?? ''
    )
  }
  private access(a: ClinicAppointment, u: User, clinical = false) {
    if (clinical && u.role !== 'admin' && u.role !== 'doctor')
      throw new Error('ليس لديك صلاحية للملاحظات الطبية')
    if (u.role === 'doctor' && a.doctorId !== this.doctorId(u))
      throw new Error('ليس لديك صلاحية لهذا المريض أو الموعد')
  }
  private invoice(id: string): ClinicInvoice {
    const raw = this.db.prepare(iq + ' WHERE i.id=?').get(id) as
      | (Omit<ClinicInvoice, 'patient' | 'doctor' | 'balance'> & {
          patient: string
          doctor: string
        })
      | undefined
    if (!raw) throw new Error('الفاتورة غير موجودة')
    return {
      ...raw,
      patient: JSON.parse(raw.patient),
      doctor: JSON.parse(raw.doctor),
      balance: raw.voided ? 0 : safe(raw.total - raw.paid),
    }
  }
  private event(a: ClinicAppointment, u: User, note: string) {
    this.db
      .prepare('INSERT INTO clinic_appointment_events VALUES(?,?,?,?,?,?,?,?)')
      .run(ulid(), a.id, u.id, Date.now(), a.status, note, a.start, a.duration)
  }
  private version(row: { version: number }, v: unknown) {
    if (row.version !== v) throw new Error('البيانات تغيرت؛ حدّث العرض ثم حاول مرة أخرى')
  }
  private visitRow(id: string) {
    const v = this.db
      .prepare(
        'SELECT v.*,f.at AS finalizedAt FROM clinic_visits v LEFT JOIN clinic_visit_final f ON f.visit_id=v.id WHERE v.id=?',
      )
      .get(id) as
      | {
          id: string
          appointment_id: string
          version: number
          opened_at: number
          complaint: string
          assessment: string
          plan: string
          finalizedAt: number | null
        }
      | undefined
    if (!v) throw new Error('الزيارة غير موجودة')
    return v
  }
  state(u: User) {
    const doctor = u.role === 'doctor',
      id = this.doctorId(u),
      admin = u.role === 'admin'
    const patients = this.db
      .prepare(
        pq +
          (doctor
            ? ' WHERE id IN(SELECT patient_id FROM clinic_appointments WHERE doctor_id=?)'
            : '') +
          ' ORDER BY name,number',
      )
      .all(...(doctor ? [id] : [])) as ClinicPatient[]
    const appointments = this.db
      .prepare(
        aq +
          ` WHERE (a.status IN('scheduled','checked_in','in_visit') OR a.id IN(SELECT id FROM clinic_appointments ORDER BY start DESC LIMIT 1000))` +
          (doctor ? ' AND a.doctor_id=?' : '') +
          ' ORDER BY a.start,a.number',
      )
      .all(...(doctor ? [id] : [])) as ClinicAppointment[]
    const invoices = doctor
      ? []
      : (
          this.db
            .prepare(
              iq +
                ` WHERE i.id IN(SELECT id FROM clinic_invoices ORDER BY at DESC LIMIT 1000) OR (NOT EXISTS(SELECT 1 FROM clinic_voids v WHERE v.invoice_id=i.id) AND i.total>COALESCE((SELECT sum(amount) FROM clinic_payments p WHERE p.invoice_id=i.id),0)) ORDER BY i.at DESC`,
            )
            .all() as { id: string }[]
        ).map((i) => this.invoice(i.id))
    const settings = Object.fromEntries(
      (
        this.db
          .prepare(
            "SELECT key,value FROM settings WHERE key IN('businessName','phone','address','currency','receiptFooter','taxBps','language')",
          )
          .all() as { key: string; value: string }[]
      ).map((r) => [r.key, r.value]),
    )
    return {
      user: u,
      settings,
      patients,
      appointments,
      invoices,
      doctors: this.db
        .prepare(dq + (doctor ? ' WHERE id=?' : '') + ' ORDER BY name')
        .all(...(doctor ? [id] : [])) as ClinicDoctor[],
      services: doctor ? [] : (this.db.prepare(sq + ' ORDER BY name').all() as ClinicService[]),
      visits:
        u.role === 'doctor' || admin
          ? (this.db
              .prepare(
                'SELECT v.id,v.appointment_id AS appointmentId,v.opened_at AS openedAt,v.version,f.at AS finalizedAt,p.name AS patientName,p.number AS patientNumber,d.name AS doctorName FROM clinic_visits v JOIN clinic_appointments a ON a.id=v.appointment_id JOIN clinic_patients p ON p.id=a.patient_id JOIN clinic_doctors d ON d.id=a.doctor_id LEFT JOIN clinic_visit_final f ON f.visit_id=v.id' +
                  (doctor ? ' WHERE a.doctor_id=?' : '') +
                  ' ORDER BY v.opened_at DESC',
              )
              .all(...(doctor ? [id] : [])) as {
              id: string
              appointmentId: string
              openedAt: number
              version: number
              finalizedAt: number | null
              patientName: string
              patientNumber: string
              doctorName: string
            }[])
          : [],
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
      reconciled: doctor ? true : this.reconciled(),
    }
  }
  private reconciled() {
    const bad = this.db
      .prepare(
        `SELECT i.id FROM clinic_invoices i WHERE i.total != i.subtotal-i.discount+i.tax OR i.subtotal != COALESCE((SELECT sum(total) FROM clinic_invoice_lines l WHERE l.invoice_id=i.id),0) OR COALESCE((SELECT sum(amount) FROM clinic_payments p WHERE p.invoice_id=i.id),0)>i.total OR EXISTS(SELECT 1 FROM clinic_voids v WHERE v.invoice_id=i.id AND v.amount!=COALESCE((SELECT sum(amount) FROM clinic_payments p WHERE p.invoice_id=i.id),0)) LIMIT 1`,
      )
      .get()
    return !bad
  }
  report(from: string, to: string) {
    if (from > to) throw new Error('راجع فترة التقرير')
    const { lo, hi, timeZone } = clinicDayBounds(from, to)
    const invoices = (
      this.db.prepare(iq + ' WHERE i.at>=? AND i.at<? ORDER BY i.at DESC').all(lo, hi) as {
        id: string
      }[]
    ).map((i) => this.invoice(i.id))
    const payments = this.db
      .prepare(
        'SELECT p.id,i.number,p.at,p.amount,p.method,p.reference,u.name AS userName FROM clinic_payments p JOIN clinic_invoices i ON i.id=p.invoice_id JOIN users u ON u.id=p.user_id WHERE p.at>=? AND p.at<? ORDER BY p.at DESC',
      )
      .all(lo, hi) as {
      id: string
      number: string
      at: number
      amount: number
      method: string
      reference: string
      userName: string
    }[]
    const refunds = this.db
      .prepare(
        'SELECT v.invoice_id AS id,i.number,v.at,v.amount,v.method,v.reference,v.note,u.name AS userName FROM clinic_voids v JOIN clinic_invoices i ON i.id=v.invoice_id JOIN users u ON u.id=v.user_id WHERE v.at>=? AND v.at<? ORDER BY v.at DESC',
      )
      .all(lo, hi) as {
      id: string
      number: string
      at: number
      amount: number
      method: string
      reference: string
      note: string
      userName: string
    }[]
    const all = this.db.prepare(iq).all() as { id: string }[]
    return {
      from,
      to,
      timeZone,
      invoices,
      payments,
      refunds,
      revenue:
        plus(invoices.map((i) => i.total)) - plus(refunds.map((r) => this.invoice(r.id).total)),
      collected: plus(payments.map((p) => p.amount)),
      refunded: plus(refunds.map((p) => p.amount)),
      receivable: plus(all.map((i) => this.invoice(i.id).balance)),
      reconciled: this.reconciled(),
      appointments: this.db
        .prepare(
          'SELECT status,count(*) AS count FROM clinic_appointments WHERE start>=? AND start<? GROUP BY status',
        )
        .all(lo, hi) as { status: string; count: number }[],
    }
  }
  call(action: string, payload: unknown, u: User): unknown {
    const schema = clinicSchemas[action as keyof typeof clinicSchemas]
    if (!schema) throw new Error('العملية غير متاحة في العيادات')
    const parsed = schema.safeParse(payload)
    if (!parsed.success) throw new Error('راجع الحقول والتواريخ والمبالغ')
    const d = parsed.data as any
    const clinical = action.startsWith('clinic.visit.')
    if (clinical && u.role !== 'admin' && u.role !== 'doctor')
      throw new Error('ليس لديك صلاحية للملاحظات الطبية')
    if (
      u.role === 'doctor' &&
      !clinical &&
      !['clinic.state', 'clinic.patient.get', 'clinic.appointment.get'].includes(action)
    )
      throw new Error('ليس لديك صلاحية للعملية الإدارية')
    if (
      ['clinic.doctor.save', 'clinic.service.save'].includes(action) &&
      !['admin', 'manager'].includes(u.role)
    )
      throw new Error('ليس لديك صلاحية لإدارة الأطباء والخدمات')
    if (action === 'clinic.invoice.void' && u.role !== 'admin')
      throw new Error('ليس لديك صلاحية لإلغاء الفاتورة والاسترداد')
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
        case 'clinic.state':
          return this.state(u)
        case 'clinic.patient.get': {
          const p = this.patient(d.id)
          if (
            u.role === 'doctor' &&
            !this.db
              .prepare(
                'SELECT id FROM clinic_appointments WHERE patient_id=? AND doctor_id=? LIMIT 1',
              )
              .get(p.id, this.doctorId(u))
          )
            throw new Error('ليس لديك صلاحية لهذا المريض')
          return {
            patient: p,
            appointments: this.db
              .prepare(
                aq +
                  ' WHERE a.patient_id=?' +
                  (u.role === 'doctor' ? ' AND a.doctor_id=?' : '') +
                  ' ORDER BY a.start DESC',
              )
              .all(p.id, ...(u.role === 'doctor' ? [this.doctorId(u)] : [])) as ClinicAppointment[],
            invoices:
              u.role === 'doctor'
                ? []
                : (
                    this.db
                      .prepare(
                        'SELECT i.id FROM clinic_invoices i JOIN clinic_appointments a ON a.id=i.appointment_id WHERE a.patient_id=? ORDER BY i.at DESC',
                      )
                      .all(p.id) as { id: string }[]
                  ).map((i) => this.invoice(i.id)),
          }
        }
        case 'clinic.appointment.get': {
          const a = this.appointment(d.id)
          this.access(a, u)
          return {
            appointment: a,
            events: this.db
              .prepare(
                'SELECT e.*,u.name AS userName FROM clinic_appointment_events e JOIN users u ON u.id=e.user_id WHERE appointment_id=? ORDER BY e.at,e.rowid',
              )
              .all(a.id) as {
              id: string
              at: number
              status: string
              note: string
              start: number
              duration: number
              userName: string
            }[],
          }
        }
        case 'clinic.visit.get': {
          const v = this.visitRow(d.id),
            a = this.appointment(v.appointment_id)
          this.access(a, u, true)
          const f = this.db
            .prepare('SELECT * FROM clinic_visit_final WHERE visit_id=?')
            .get(v.id) as
            | {
                patient_snapshot: string
                doctor_snapshot: string
                complaint: string
                assessment: string
                plan: string
              }
            | undefined
          this.identity.audit(u.id, action, v.id)
          return {
            visit: {
              id: v.id,
              appointmentId: a.id,
              version: v.version,
              openedAt: v.opened_at,
              finalizedAt: v.finalizedAt,
              complaint: f?.complaint ?? v.complaint,
              assessment: f?.assessment ?? v.assessment,
              plan: f?.plan ?? v.plan,
            },
            appointment: a,
            patient: f
              ? (JSON.parse(f.patient_snapshot) as ClinicPatient)
              : this.patient(a.patientId),
            doctor: f ? (JSON.parse(f.doctor_snapshot) as ClinicDoctor) : this.doctor(a.doctorId),
            addenda: this.db
              .prepare(
                'SELECT x.id,x.at,x.note,x.reason,u.name AS userName FROM clinic_addenda x JOIN users u ON u.id=x.user_id WHERE visit_id=? ORDER BY x.at,x.rowid',
              )
              .all(v.id) as {
              id: string
              at: number
              note: string
              reason: string
              userName: string
            }[],
          }
        }
        case 'clinic.invoice.get':
          return {
            invoice: this.invoice(d.id),
            lines: this.db
              .prepare(
                'SELECT id,name,qty,price,total FROM clinic_invoice_lines WHERE invoice_id=?',
              )
              .all(d.id) as {
              id: string
              name: string
              qty: number
              price: number
              total: number
            }[],
            payments: this.db
              .prepare(
                'SELECT id,at,amount,method,reference FROM clinic_payments WHERE invoice_id=? ORDER BY at,rowid',
              )
              .all(d.id) as {
              id: string
              at: number
              amount: number
              method: string
              reference: string
            }[],
            refund: this.db
              .prepare(
                'SELECT at,amount,note,method,reference FROM clinic_voids WHERE invoice_id=?',
              )
              .get(d.id) as
              | { at: number; amount: number; note: string; method: string; reference: string }
              | undefined,
          }
        case 'clinic.report':
          return this.report(d.from, d.to)
        case 'clinic.patient.save': {
          const id = d.id ?? ulid()
          if (d.id) {
            const p = this.patient(id)
            this.version(p, d.version)
            if (
              !d.active &&
              this.db
                .prepare(
                  "SELECT id FROM clinic_appointments WHERE patient_id=? AND status IN('scheduled','checked_in','in_visit') LIMIT 1",
                )
                .get(id)
            )
              throw new Error('للمريض موعد مفتوح؛ أغلقه قبل الأرشفة')
            this.db
              .prepare(
                'UPDATE clinic_patients SET name=?,phone=?,birth_date=?,sex=?,address=?,active=?,version=version+1 WHERE id=?',
              )
              .run(d.name, d.phone, d.birthDate, d.sex, d.address, Number(d.active), id)
          } else
            this.db
              .prepare('INSERT INTO clinic_patients VALUES(?,?,?,?,?,?,?,?,0)')
              .run(
                id,
                this.number('patient', 'P-'),
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
        case 'clinic.doctor.save': {
          const id = d.id ?? ulid()
          if (
            d.userId &&
            !this.db
              .prepare("SELECT id FROM users WHERE id=? AND role='doctor' AND active=1")
              .get(d.userId)
          )
            throw new Error('اربط حساب طبيب نشط من المستخدمين')
          if (d.id) {
            const p = this.doctor(id)
            this.version(p, d.version)
            if (
              !d.active &&
              this.db
                .prepare(
                  "SELECT id FROM clinic_appointments WHERE doctor_id=? AND status IN('scheduled','checked_in','in_visit') LIMIT 1",
                )
                .get(id)
            )
              throw new Error('للطبيب موعد مفتوح؛ أغلقه قبل إيقافه')
            if (
              p.userId !== d.userId &&
              this.db
                .prepare(
                  'SELECT v.id FROM clinic_visits v JOIN clinic_appointments a ON a.id=v.appointment_id WHERE a.doctor_id=? LIMIT 1',
                )
                .get(id)
            )
              throw new Error('حساب الطبيب مرتبط بزيارات محفوظة؛ أنشئ طبيبًا مستقلًا')
            this.db
              .prepare(
                'UPDATE clinic_doctors SET name=?,specialty=?,user_id=?,active=?,version=version+1 WHERE id=?',
              )
              .run(d.name, d.specialty, d.userId, Number(d.active), id)
          } else
            this.db
              .prepare('INSERT INTO clinic_doctors VALUES(?,?,?,?,?,0)')
              .run(id, d.name, d.specialty, d.userId, Number(d.active))
          result = { id }
          break
        }
        case 'clinic.service.save': {
          const id = d.id ?? ulid()
          if (d.id) {
            const old = this.db.prepare(sq + ' WHERE id=?').get(id) as ClinicService | undefined
            if (!old) throw new Error('الخدمة غير موجودة')
            this.version(old, d.version)
            this.db
              .prepare(
                'UPDATE clinic_services SET name=?,price=?,active=?,version=version+1 WHERE id=?',
              )
              .run(d.name, d.price, Number(d.active), id)
          } else
            this.db
              .prepare('INSERT INTO clinic_services VALUES(?,?,?,?,0)')
              .run(id, d.name, d.price, Number(d.active))
          result = { id }
          break
        }
        case 'clinic.appointment.save': {
          const id = d.id ?? ulid(),
            p = this.patient(d.patientId),
            doc = this.doctor(d.doctorId)
          if (!p.active || !doc.active) throw new Error('اختر مريضًا وطبيبًا نشطين')
          if (d.id) {
            const old = this.appointment(id)
            this.version(old, d.version)
            if (old.status !== 'scheduled') throw new Error('تعديل موعد متاح قبل تسجيل الحضور فقط')
            if (old.invoiceId && (old.patientId !== p.id || old.doctorId !== doc.id))
              throw new Error('الفاتورة تثبت هوية المريض والطبيب؛ أنشئ موعدًا جديدًا')
          }
          if (
            this.db
              .prepare(
                "SELECT id FROM clinic_appointments WHERE id!=? AND status NOT IN('cancelled','no_show') AND (doctor_id=? OR patient_id=?) AND start<? AND start+duration*60000>? LIMIT 1",
              )
              .get(id, doc.id, p.id, d.start + d.duration * 60000, d.start)
          )
            throw new Error('الموعد يتعارض مع حجز للطبيب أو المريض')
          if (d.id)
            this.db
              .prepare(
                'UPDATE clinic_appointments SET patient_id=?,doctor_id=?,start=?,duration=?,reason=?,version=version+1 WHERE id=?',
              )
              .run(p.id, doc.id, d.start, d.duration, d.reason, id)
          else
            this.db
              .prepare("INSERT INTO clinic_appointments VALUES(?,?,?,?,?,?,?,'scheduled',0,?)")
              .run(
                id,
                this.number('appointment', 'A-'),
                p.id,
                doc.id,
                d.start,
                d.duration,
                d.reason,
                Date.now(),
              )
          this.event(this.appointment(id), u, d.id ? 'تعديل الموعد' : 'إنشاء الموعد')
          result = { id }
          break
        }
        case 'clinic.appointment.status': {
          const a = this.appointment(d.id)
          this.version(a, d.version)
          if (d.status === 'no_show' && Date.now() < a.start + a.duration * 60000)
            throw new Error('سجّل عدم الحضور بعد انتهاء وقت الموعد')
          if (d.status === 'checked_in' && a.start > Date.now() + 3600000)
            throw new Error('تسجيل الحضور متاح قبل الموعد بساعة أو بعده')
          if (!(
            (a.status === 'scheduled' &&
              ['checked_in', 'cancelled', 'no_show'].includes(d.status)) ||
            (a.status === 'checked_in' && d.status === 'cancelled' && !a.visitId)
          ))
            throw new Error('لا يمكن تغيير حالة الموعد بهذه الطريقة')
          this.db
            .prepare('UPDATE clinic_appointments SET status=?,version=version+1 WHERE id=?')
            .run(d.status, a.id)
          this.event(this.appointment(a.id), u, d.note)
          result = { id: a.id }
          break
        }
        case 'clinic.visit.open': {
          const a = this.appointment(d.appointmentId)
          this.access(a, u, true)
          if (a.status !== 'checked_in' || a.visitId)
            throw new Error('سجّل حضور المريض قبل فتح الزيارة')
          const id = ulid()
          this.db
            .prepare(
              'INSERT INTO clinic_visits(id,appointment_id,user_id,opened_at) VALUES(?,?,?,?)',
            )
            .run(id, a.id, u.id, Date.now())
          this.db
            .prepare(
              "UPDATE clinic_appointments SET status='in_visit',version=version+1 WHERE id=?",
            )
            .run(a.id)
          this.event(this.appointment(a.id), u, 'بدء الزيارة')
          result = { id }
          break
        }
        case 'clinic.visit.save':
        case 'clinic.visit.finalize':
        case 'clinic.visit.addendum': {
          const v = this.visitRow(d.id),
            a = this.appointment(v.appointment_id)
          this.access(a, u, true)
          if (action === 'clinic.visit.addendum') {
            if (!v.finalizedAt) throw new Error('الإضافة متاحة للزيارة المعتمدة فقط')
            this.db
              .prepare('INSERT INTO clinic_addenda VALUES(?,?,?,?,?,?)')
              .run(ulid(), v.id, u.id, Date.now(), d.reason, d.note)
          } else {
            this.version(v, d.version)
            if (v.finalizedAt) throw new Error('الزيارة معتمدة؛ التصحيح يتم بإضافة محفوظة')
            if (action === 'clinic.visit.save')
              this.db
                .prepare(
                  'UPDATE clinic_visits SET complaint=?,assessment=?,plan=?,version=version+1 WHERE id=?',
                )
                .run(d.complaint, d.assessment, d.plan, v.id)
            else {
              if (!v.assessment.trim() || !v.plan.trim())
                throw new Error('أدخل التقييم والخطة قبل اعتماد الزيارة')
              this.db
                .prepare('INSERT INTO clinic_visit_final VALUES(?,?,?,?,?,?,?,?)')
                .run(
                  v.id,
                  u.id,
                  Date.now(),
                  JSON.stringify(this.patient(a.patientId)),
                  JSON.stringify(this.doctor(a.doctorId)),
                  v.complaint,
                  v.assessment,
                  v.plan,
                )
              this.db.prepare('UPDATE clinic_visits SET version=version+1 WHERE id=?').run(v.id)
              this.db
                .prepare(
                  "UPDATE clinic_appointments SET status='completed',version=version+1 WHERE id=?",
                )
                .run(a.id)
              this.event(this.appointment(a.id), u, 'اعتماد الزيارة')
            }
          }
          result = { id: v.id }
          break
        }
        case 'clinic.invoice.post': {
          const a = this.appointment(d.appointmentId)
          if (a.invoiceId || ['cancelled', 'no_show'].includes(a.status))
            throw new Error('الفاتورة موجودة أو الموعد ملغي')
          const lines = d.lines.map((l: { serviceId: string; qty: number; price: number }) => {
            const s = this.db.prepare(sq + ' WHERE id=?').get(l.serviceId) as
              ClinicService | undefined
            if (!s?.active) throw new Error('اختر خدمة نشطة')
            return { ...l, name: s.name, total: safe(BigInt(l.qty) * BigInt(l.price)) }
          })
          const subtotal = plus(lines.map((l: { total: number }) => l.total))
          if (d.discount > subtotal) throw new Error('الخصم أكبر من قيمة الخدمات')
          const tax = safe((BigInt(subtotal - d.discount) * BigInt(d.taxBps) + 5000n) / 10000n),
            total = safe(BigInt(subtotal - d.discount) + BigInt(tax)),
            id = ulid()
          this.db
            .prepare('INSERT INTO clinic_invoices VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
            .run(
              id,
              this.number('invoice', 'CI-'),
              a.id,
              JSON.stringify(this.patient(a.patientId)),
              JSON.stringify(this.doctor(a.doctorId)),
              u.id,
              Date.now(),
              subtotal,
              d.discount,
              d.taxBps,
              tax,
              total,
            )
          for (const l of lines)
            this.db
              .prepare('INSERT INTO clinic_invoice_lines VALUES(?,?,?,?,?,?,?)')
              .run(ulid(), id, l.serviceId, l.name, l.qty, l.price, l.total)
          result = { id }
          break
        }
        case 'clinic.invoice.pay': {
          const i = this.invoice(d.id)
          if (i.voided || d.amount > i.balance)
            throw new Error('الفاتورة ملغاة أو المبلغ أكبر من المتبقي')
          this.db
            .prepare('INSERT INTO clinic_payments VALUES(?,?,?,?,?,?,?)')
            .run(ulid(), i.id, u.id, Date.now(), d.amount, d.method, d.reference)
          result = { id: i.id }
          break
        }
        case 'clinic.invoice.void': {
          const i = this.invoice(d.id)
          if (i.voided) throw new Error('الفاتورة ملغاة بالفعل')
          this.db
            .prepare('INSERT INTO clinic_voids VALUES(?,?,?,?,?,?,?)')
            .run(i.id, u.id, Date.now(), d.note, i.paid, d.method, d.reference)
          result = { id: i.id }
          break
        }
        default:
          throw new Error('العملية غير متاحة في العيادات')
      }
      this.identity.audit(u.id, action, result.id)
      this.db
        .prepare('INSERT INTO commands VALUES(?,?,?,?,?)')
        .run(d.clientTxnId, action, u.id, fingerprint(d), JSON.stringify(result))
      return result
    })()
  }
}
