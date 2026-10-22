import { ulid } from '@xzare/core'
import type { XzareDatabase } from '@xzare/db'
import { Identity } from './identity.js'
import { fingerprint } from './commerce.js'
import { clinicToday } from './clinic-time.js'
import {
  hrSchemas,
  type HrEmployee,
  type HrShift,
  type HrRoster,
  type HrAttendance,
  type HrLeave,
  type HrPayroll,
  type HrPayrollDetail,
  type HrState,
  type HrPeriod,
} from './hr-validation.js'
import type { User } from './types.js'
const ops = (u: User) => ['admin', 'manager', 'hr'].includes(u.role),
  finance = (u: User) => ['admin', 'manager', 'payroll'].includes(u.role)
const employeeQuery =
  'SELECT id,code,name,department,job,phone,email,hired,ended,active,note,version FROM hr_employees'
const rosterQuery =
  'SELECT id,employee_id AS employeeId,day,shift_id AS shiftId,shift_name AS shiftName,off,start,end,break_minutes AS breakMinutes,grace_minutes AS graceMinutes,version FROM hr_roster'
const attendanceQuery =
  'SELECT id,employee_id AS employeeId,day,status,in_minute AS inMinute,out_minute AS outMinute,break_minutes AS breakMinutes,worked,late,overtime,version FROM hr_attendance'
const leaveQuery =
  'SELECT id,employee_id AS employeeId,from_day AS "from",to_day AS "to",kind,days,dates,reason,status,at,version FROM hr_leaves'
const runQuery =
  'SELECT r.id,r.number,r.month,r.note,r.total,r.creator_id AS creatorId,r.creator_name AS creatorName,r.at,s.status,s.version,s.approver_name AS approverName,s.reason,COALESCE((SELECT sum(p.amount) FROM hr_payroll_payments p JOIN hr_payroll_items i ON i.id=p.item_id WHERE i.run_id=r.id),0) paid FROM hr_payroll_runs r JOIN hr_payroll_status s ON s.run_id=r.id'
const safe = (n: number) => {
  if (!Number.isSafeInteger(n) || Math.abs(n) > 1e12) throw new Error('المبلغ تجاوز الحد الآمن')
  return n
}
const daysBetween = (from: string, to: string) => {
  const lo = Date.parse(from + 'T00:00:00Z'),
    hi = Date.parse(to + 'T00:00:00Z'),
    n = (hi - lo) / 86400000
  if (n < 0 || n > 92) throw new Error('اختر نطاقًا لا يتجاوز 93 يومًا')
  return Array.from({ length: n + 1 }, (_, i) =>
    new Date(lo + i * 86400000).toISOString().slice(0, 10),
  )
}
const monthBounds = (month: string) => {
  const [y, m] = month.split('-').map(Number)
  return { from: month + '-01', to: new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10) }
}
export class HR {
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
  private employee(id: string) {
    const x = this.row<HrEmployee | undefined>(employeeQuery + ' WHERE id=?', id)
    if (!x) throw new Error('الموظف غير موجود')
    return x
  }
  private employed(e: HrEmployee, day: string) {
    if (!e.active || day < e.hired || (e.ended && day > e.ended))
      throw new Error('الموظف غير نشط في هذا اليوم')
  }
  private checkVersion(old: { version: number } | undefined, v: unknown) {
    if (old && v !== old.version) throw new Error('البيانات تغيرت؛ حدّث العرض وأعد المحاولة')
    if (!old && v !== undefined) throw new Error('الإصدار يخص سجلًا موجودًا')
  }
  private leaveRows(sql: string, ...a: any[]): HrLeave[] {
    return this.rows<any>(sql, ...a).map((x) => ({ ...x, dates: JSON.parse(x.dates) }))
  }
  private periodData(from: string, to: string): HrPeriod {
    daysBetween(from, to)
    return {
      roster: this.rows<HrRoster>(
        rosterQuery + ' WHERE day>=? AND day<=? ORDER BY day,employee_id',
        from,
        to,
      ),
      attendance: this.rows<HrAttendance>(
        attendanceQuery + ' WHERE day>=? AND day<=? ORDER BY day,employee_id',
        from,
        to,
      ),
      leaves: this.leaveRows(
        leaveQuery + ' WHERE from_day<=? AND to_day>=? ORDER BY at DESC',
        to,
        from,
      ),
    }
  }
  private balance(employeeId: string, year: number) {
    const granted = this.row<{ n: number }>(
        'SELECT COALESCE(sum(days),0) n FROM hr_leave_credits WHERE employee_id=? AND year=?',
        employeeId,
        year,
      ).n,
      used = this.row<{ n: number }>(
        "SELECT COALESCE(sum(days),0) n FROM hr_leaves WHERE employee_id=? AND substr(from_day,1,4)=? AND kind='paid' AND status='approved'",
        employeeId,
        String(year),
      ).n
    return { employeeId, year, granted, used, available: granted - used }
  }
  private reconciles() {
    return (
      !this.row(
        'SELECT 1 FROM hr_payroll_items i WHERE (SELECT COALESCE(sum(p.amount),0) FROM hr_payroll_payments p WHERE p.item_id=i.id)>i.net OR i.net!=i.base+i.allowance+i.overtime-i.deduction-i.tax-i.insurance LIMIT 1',
      ) &&
      !this.row(
        'SELECT 1 FROM hr_payroll_runs r WHERE r.total!=(SELECT COALESCE(sum(net),0) FROM hr_payroll_items i WHERE i.run_id=r.id) LIMIT 1',
      ) &&
      !this.row(
        "SELECT 1 FROM hr_payroll_status s JOIN hr_payroll_items i ON i.run_id=s.run_id JOIN hr_payroll_payments p ON p.item_id=i.id WHERE s.status!='approved' LIMIT 1",
      )
    )
  }
  private run(id: string): HrPayroll {
    const r = this.row<any>(runQuery + ' WHERE r.id=?', id)
    if (!r) throw new Error('مسير الراتب غير موجود')
    return { ...r, balance: safe(r.total - r.paid) }
  }
  private items(id: string) {
    return this.rows<any>(
      'SELECT id,employee_id AS employeeId,employee_code AS employeeCode,employee_name AS employeeName,department,job,base,allowance,overtime,deduction,tax,insurance,net,note,source FROM hr_payroll_items WHERE run_id=? ORDER BY rowid',
      id,
    ).map((x) => {
      const paid = this.row<{ n: number }>(
        'SELECT COALESCE(sum(amount),0) n FROM hr_payroll_payments WHERE item_id=?',
        x.id,
      ).n
      return { ...x, paid, balance: safe(x.net - paid), source: JSON.parse(x.source) }
    })
  }
  get(id: string, u: User): HrPayrollDetail {
    if (!finance(u)) throw new Error('ليس لديك صلاحية الرواتب')
    return {
      run: this.run(id),
      items: this.items(id),
      payments: this.rows(
        'SELECT p.id,p.item_id AS itemId,p.amount,p.method,p.reference,p.at FROM hr_payroll_payments p JOIN hr_payroll_items i ON i.id=p.item_id WHERE i.run_id=? ORDER BY p.rowid',
        id,
      ),
    }
  }
  state(u: User): HrState {
    if (!ops(u) && !finance(u)) throw new Error('ليس لديك صلاحية الموارد البشرية')
    const today = clinicToday(),
      range = monthBounds(today.slice(0, 7)),
      year = Number(today.slice(0, 4))
    const employees = this.rows<HrEmployee>(employeeQuery + ' ORDER BY name')
    return {
      user: u,
      settings: Object.fromEntries(
        this.rows<{ key: string; value: string }>(
          "SELECT key,value FROM settings WHERE key IN('businessName','phone','address','currency','language','receiptFooter')",
        ).map((x) => [x.key, x.value]),
      ),
      today,
      employees: ops(u) ? employees : employees.map(({ phone, email, note, ...x }) => x),
      salaries: finance(u)
        ? this.rows('SELECT employee_id AS employeeId,base,version FROM hr_salaries')
        : [],
      shifts: ops(u)
        ? this.rows(
            'SELECT id,name,start,end,break_minutes AS breakMinutes,grace_minutes AS graceMinutes,active,version FROM hr_shifts ORDER BY name',
          )
        : [],
      ...(ops(u)
        ? this.periodData(range.from, range.to)
        : { roster: [], attendance: [], leaves: [] }),
      leaveBalances: ops(u) ? employees.map((x) => this.balance(x.id, year)) : [],
      evaluations: ops(u)
        ? this.rows(
            'SELECT id,employee_id AS employeeId,period,quality,reliability,teamwork,goals,note,reviewer_name AS reviewerName,at,version FROM hr_evaluations ORDER BY at DESC LIMIT 1000',
          )
        : [],
      payrolls: finance(u)
        ? this.rows<{ id: string }>(
            'SELECT id FROM hr_payroll_runs ORDER BY at DESC,rowid DESC LIMIT 1000',
          ).map((x) => this.run(x.id))
        : [],
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
      reconciled: finance(u) ? this.reconciles() : true,
    }
  }
  private saveEmployee(d: any) {
    const old = d.id ? this.employee(d.id) : undefined
    this.checkVersion(old, d.version)
    if (d.ended && d.ended < d.hired) throw new Error('تاريخ انتهاء العمل قبل التعيين')
    if (old && (old.hired !== d.hired || old.ended !== d.ended)) {
      if (
        this.row(
          "SELECT 1 FROM hr_roster WHERE employee_id=? AND (day<? OR (?!='' AND day>?)) LIMIT 1",
          old.id,
          d.hired,
          d.ended,
          d.ended,
        )
      )
        throw new Error('تواريخ العقد تستبعد أيامًا مجدولة؛ راجع جدول الموظف')
    }
    const id = d.id ?? ulid()
    this.db
      .prepare(
        'INSERT INTO hr_employees VALUES(?,?,?,?,?,?,?,?,?,?,?,0) ON CONFLICT(id) DO UPDATE SET code=excluded.code,name=excluded.name,department=excluded.department,job=excluded.job,phone=excluded.phone,email=excluded.email,hired=excluded.hired,ended=excluded.ended,active=excluded.active,note=excluded.note,version=hr_employees.version+1',
      )
      .run(
        id,
        d.code,
        d.name,
        d.department,
        d.job,
        d.phone,
        d.email,
        d.hired,
        d.ended,
        Number(d.active),
        d.note,
      )
    return id
  }
  private saveShift(d: any) {
    const old = d.id
      ? this.row<HrShift>(
          'SELECT *,break_minutes AS breakMinutes,grace_minutes AS graceMinutes FROM hr_shifts WHERE id=?',
          d.id,
        )
      : undefined
    if (d.id && !old) throw new Error('الوردية غير موجودة')
    this.checkVersion(old, d.version)
    if (d.start === d.end) throw new Error('بداية ونهاية الوردية متساويتان')
    const end = d.end < d.start ? d.end + 1440 : d.end
    if (d.breakMinutes >= end - d.start) throw new Error('الراحة يجب أن تكون أقل من مدة الوردية')
    const id = d.id ?? ulid()
    this.db
      .prepare(
        'INSERT INTO hr_shifts VALUES(?,?,?,?,?,?,?,0) ON CONFLICT(id) DO UPDATE SET name=excluded.name,start=excluded.start,end=excluded.end,break_minutes=excluded.break_minutes,grace_minutes=excluded.grace_minutes,active=excluded.active,version=hr_shifts.version+1',
      )
      .run(id, d.name, d.start, end, d.breakMinutes, d.graceMinutes, Number(d.active))
    return id
  }
  private overlaps(
    table: 'hr_roster' | 'hr_attendance',
    employeeId: string,
    day: string,
    start: number,
    end: number,
  ) {
    const base = Date.parse(day + 'T00:00:00Z') / 60000,
      from = base + start,
      to = base + end
    const query = table === 'hr_roster' ? rosterQuery : attendanceQuery
    return this.rows<any>(
      query + ' WHERE employee_id=? AND day!=? AND day>=? AND day<=?',
      employeeId,
      day,
      new Date((base - 2880) * 60000).toISOString().slice(0, 10),
      new Date((base + 2880) * 60000).toISOString().slice(0, 10),
    ).some((x) => {
      if ((table === 'hr_roster' && x.off) || (table === 'hr_attendance' && x.status === 'absent'))
        return false
      const b = Date.parse(x.day + 'T00:00:00Z') / 60000,
        s = table === 'hr_roster' ? x.start : x.inMinute,
        e = table === 'hr_roster' ? x.end : x.outMinute
      return from < b + e && to > b + s
    })
  }
  private roster(d: any) {
    this.employed(this.employee(d.employeeId), d.day)
    const old = this.row<HrRoster>(
      rosterQuery + ' WHERE employee_id=? AND day=?',
      d.employeeId,
      d.day,
    )
    this.checkVersion(old, d.version)
    if (this.row('SELECT 1 FROM hr_attendance WHERE employee_id=? AND day=?', d.employeeId, d.day))
      throw new Error('اليوم له حضور مسجل؛ الوردية الأصلية محفوظة')
    if (
      this.row(
        "SELECT 1 FROM hr_leaves WHERE employee_id=? AND from_day<=? AND to_day>=? AND status IN('pending','approved')",
        d.employeeId,
        d.day,
        d.day,
      )
    )
      throw new Error('اليوم مرتبط بطلب إجازة؛ راجع الإجازة أولًا')
    if (d.off ? d.shiftId !== null : !d.shiftId) throw new Error('اختر وردية أو يوم راحة')
    const s = d.off
      ? null
      : this.row<HrShift>(
          'SELECT *,break_minutes AS breakMinutes,grace_minutes AS graceMinutes FROM hr_shifts WHERE id=? AND active=1',
          d.shiftId,
        )
    if (!d.off && !s) throw new Error('الوردية غير موجودة أو متوقفة')
    if (s && this.overlaps('hr_roster', d.employeeId, d.day, s.start, s.end))
      throw new Error('تداخل ورديات بين أيام متجاورة')
    const id = old?.id ?? ulid()
    this.db
      .prepare(
        'INSERT INTO hr_roster VALUES(?,?,?,?,?,?,?,?,?,?,0) ON CONFLICT(employee_id,day) DO UPDATE SET shift_id=excluded.shift_id,shift_name=excluded.shift_name,off=excluded.off,start=excluded.start,end=excluded.end,break_minutes=excluded.break_minutes,grace_minutes=excluded.grace_minutes,version=hr_roster.version+1',
      )
      .run(
        id,
        d.employeeId,
        d.day,
        s?.id ?? null,
        s?.name ?? 'راحة',
        Number(d.off),
        s?.start ?? 0,
        s?.end ?? 0,
        s?.breakMinutes ?? 0,
        s?.graceMinutes ?? 0,
      )
    return id
  }
  private attendance(d: any) {
    this.employed(this.employee(d.employeeId), d.day)
    if (d.day > clinicToday()) throw new Error('لا يمكن تسجيل حضور يوم مستقبلي')
    const r = this.row<HrRoster>(
      rosterQuery + ' WHERE employee_id=? AND day=?',
      d.employeeId,
      d.day,
    )
    if (!r || r.off) throw new Error('جدول اليوم غير متاح للعمل')
    if (
      this.row(
        "SELECT 1 FROM hr_leaves WHERE employee_id=? AND from_day<=? AND to_day>=? AND status='approved'",
        d.employeeId,
        d.day,
        d.day,
      )
    )
      throw new Error('اليوم داخل إجازة معتمدة')
    const old = this.row<HrAttendance>(
      attendanceQuery + ' WHERE employee_id=? AND day=?',
      d.employeeId,
      d.day,
    )
    this.checkVersion(old, d.version)
    let worked = 0,
      late = 0,
      overtime = 0
    if (d.status === 'present') {
      if (
        d.inMinute === null ||
        d.outMinute === null ||
        d.outMinute <= d.inMinute ||
        d.outMinute - d.inMinute > 1440 ||
        d.breakMinutes >= d.outMinute - d.inMinute
      )
        throw new Error('راجع وقت الدخول والخروج والراحة')
      const now = new Date(),
        nowMinute =
          Date.parse(clinicToday() + 'T00:00:00Z') / 60000 + now.getHours() * 60 + now.getMinutes()
      if (Date.parse(d.day + 'T00:00:00Z') / 60000 + d.outMinute > nowMinute)
        throw new Error('وقت الخروج مستقبلي؛ سجل الحضور المكتمل فقط')
      if (this.overlaps('hr_attendance', d.employeeId, d.day, d.inMinute, d.outMinute))
        throw new Error('تداخل حضور بين أيام متجاورة')
      worked = d.outMinute - d.inMinute - d.breakMinutes
      late = Math.max(0, d.inMinute - r.start - r.graceMinutes)
      overtime = Math.max(0, worked - (r.end - r.start - r.breakMinutes))
    } else if (d.inMinute !== null || d.outMinute !== null || d.breakMinutes !== 0)
      throw new Error('سجل الغياب دون أوقات أو راحة')
    const id = old?.id ?? ulid()
    this.db
      .prepare(
        'INSERT INTO hr_attendance VALUES(?,?,?,?,?,?,?,?,?,?,0) ON CONFLICT(employee_id,day) DO UPDATE SET status=excluded.status,in_minute=excluded.in_minute,out_minute=excluded.out_minute,break_minutes=excluded.break_minutes,worked=excluded.worked,late=excluded.late,overtime=excluded.overtime,version=hr_attendance.version+1',
      )
      .run(
        id,
        d.employeeId,
        d.day,
        d.status,
        d.inMinute,
        d.outMinute,
        d.breakMinutes,
        worked,
        late,
        overtime,
      )
    return id
  }
  private requestLeave(d: any, u: User) {
    const e = this.employee(d.employeeId),
      dates = daysBetween(d.from, d.to)
    if (d.from.slice(0, 4) !== d.to.slice(0, 4)) throw new Error('قسّم الإجازة إلى طلب لكل سنة')
    this.employed(e, d.from)
    this.employed(e, d.to)
    if (
      this.row(
        "SELECT 1 FROM hr_leaves WHERE employee_id=? AND from_day<=? AND to_day>=? AND status IN('pending','approved')",
        e.id,
        d.to,
        d.from,
      )
    )
      throw new Error('طلب إجازة متداخل')
    const planned = dates.map((day) =>
      this.row<HrRoster>(rosterQuery + ' WHERE employee_id=? AND day=?', e.id, day),
    )
    if (planned.some((x) => !x)) throw new Error('حدد جدول الوردية أو الراحة لكل يوم في الإجازة')
    const work = planned.filter((x) => !x.off).map((x) => x.day)
    if (!work.length) throw new Error('الفترة كلها أيام راحة')
    const id = ulid()
    this.db
      .prepare('INSERT INTO hr_leaves VALUES(?,?,?,?,?,?,?,?,?,?,?,0)')
      .run(
        id,
        e.id,
        d.from,
        d.to,
        d.kind,
        work.length,
        JSON.stringify(work),
        d.reason,
        'pending',
        u.id,
        Date.now(),
      )
    return id
  }
  private decideLeave(d: any) {
    const l = this.leaveRows(leaveQuery + ' WHERE id=?', d.id)[0]
    if (!l) throw new Error('طلب الإجازة غير موجود')
    this.checkVersion(l, d.version)
    if (!(
      (l.status === 'pending' && ['approved', 'rejected', 'cancelled'].includes(d.status)) ||
      (l.status === 'approved' && d.status === 'cancelled')
    ))
      throw new Error('حالة الإجازة لا تسمح بهذا القرار')
    if (d.status === 'approved') {
      const e = this.employee(l.employeeId)
      this.employed(e, l.from)
      this.employed(e, l.to)
      if (
        this.row(
          'SELECT 1 FROM hr_attendance WHERE employee_id=? AND day>=? AND day<=? LIMIT 1',
          e.id,
          l.from,
          l.to,
        )
      )
        throw new Error('الإجازة تتعارض مع حضور مسجل')
      if (l.kind === 'paid' && this.balance(e.id, Number(l.from.slice(0, 4))).available < l.days)
        throw new Error('رصيد الإجازات المدفوعة لا يكفي')
    }
    this.db
      .prepare('UPDATE hr_leaves SET status=?,version=version+1 WHERE id=?')
      .run(d.status, l.id)
    return l.id
  }
  private evaluation(d: any, u: User) {
    this.employee(d.employeeId)
    const old = d.id ? this.row<any>('SELECT * FROM hr_evaluations WHERE id=?', d.id) : undefined
    if (d.id && !old) throw new Error('التقييم غير موجود')
    this.checkVersion(old, d.version)
    if (old && old.employee_id !== d.employeeId) throw new Error('التقييم يخص موظفًا آخر')
    const id = d.id ?? ulid()
    this.db
      .prepare(
        'INSERT INTO hr_evaluations VALUES(?,?,?,?,?,?,?,?,?,?,?,0) ON CONFLICT(id) DO UPDATE SET period=excluded.period,quality=excluded.quality,reliability=excluded.reliability,teamwork=excluded.teamwork,goals=excluded.goals,note=excluded.note,reviewer_id=excluded.reviewer_id,reviewer_name=excluded.reviewer_name,at=excluded.at,version=hr_evaluations.version+1',
      )
      .run(
        id,
        d.employeeId,
        d.period,
        d.quality,
        d.reliability,
        d.teamwork,
        d.goals,
        d.note,
        u.id,
        u.name,
        Date.now(),
      )
    return id
  }
  private submit(d: any, u: User) {
    if (
      this.row(
        "SELECT 1 FROM hr_payroll_runs r JOIN hr_payroll_status s ON s.run_id=r.id WHERE r.month=? AND s.status!='void'",
        d.month,
      )
    )
      throw new Error('يوجد مسير غير ملغى لهذا الشهر')
    const range = monthBounds(d.month),
      period = this.periodData(range.from, range.to)
    const items = d.items.map((x: any) => {
      const e = this.employee(x.employeeId)
      if (e.hired > range.to || (e.ended && e.ended < range.from))
        throw new Error('الموظف خارج فترة العمل في الشهر')
      const s = this.row<{ base: number; version: number }>(
        'SELECT base,version FROM hr_salaries WHERE employee_id=?',
        e.id,
      )
      if (!s || s.version !== x.salaryVersion) throw new Error('أساس الراتب تغير أو لم يسجل')
      const net = safe(s.base + x.allowance + x.overtime - x.deduction - x.tax - x.insurance)
      if (net < 0) throw new Error('الاستقطاعات أكبر من الاستحقاقات')
      return {
        e,
        s,
        x,
        net,
        source: {
          salaryVersion: s.version,
          roster: period.roster.filter((a) => a.employeeId === e.id),
          attendance: period.attendance.filter((a) => a.employeeId === e.id),
          leaves: period.leaves
            .filter((a) => a.employeeId === e.id && a.status === 'approved')
            .map((a) => ({ ...a, reason: '' })),
        },
      }
    })
    const total = items.reduce((n: number, x: any) => safe(n + x.net), 0)
    this.db
      .prepare("INSERT INTO sequences VALUES('hr',1) ON CONFLICT(kind) DO UPDATE SET value=value+1")
      .run()
    const n = this.row<{ value: number }>("SELECT value FROM sequences WHERE kind='hr'").value,
      id = ulid()
    this.db
      .prepare('INSERT INTO hr_payroll_runs VALUES(?,?,?,?,?,?,?,?)')
      .run(id, 'HR-' + String(n).padStart(6, '0'), d.month, d.note, total, u.id, u.name, Date.now())
    this.db
      .prepare('INSERT INTO hr_payroll_status VALUES(?,?,0,NULL,?,?,?)')
      .run(id, 'submitted', '', '', Date.now())
    for (const { e, s, x, net, source } of items)
      this.db
        .prepare('INSERT INTO hr_payroll_items VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(
          ulid(),
          id,
          e.id,
          e.code,
          e.name,
          e.department,
          e.job,
          s.base,
          x.allowance,
          x.overtime,
          x.deduction,
          x.tax,
          x.insurance,
          net,
          x.note,
          JSON.stringify(source),
        )
    return id
  }
  call(action: string, input: unknown, u: User) {
    const schema = hrSchemas[action as keyof typeof hrSchemas]
    if (!schema) throw new Error('العملية غير متاحة')
    const salaryAction = action.startsWith('hr.payroll.') || action === 'hr.salary.save'
    if (salaryAction && !finance(u)) throw new Error('ليس لديك صلاحية الرواتب')
    if (action !== 'hr.state' && !salaryAction && !ops(u))
      throw new Error('ليس لديك صلاحية شؤون الموظفين')
    const d = schema.parse(input) as any
    if (action === 'hr.state') return this.state(u)
    if (action === 'hr.leave.balances')
      return this.rows<{ id: string }>('SELECT id FROM hr_employees').map((e) =>
        this.balance(e.id, d.year),
      )
    if (action === 'hr.period') return this.periodData(d.from, d.to)
    if (action === 'hr.payroll.get') return this.get(d.id, u)
    return this.db.transaction(() => {
      const h = fingerprint(d),
        prev = this.row<any>('SELECT * FROM commands WHERE client_txn_id=?', d.clientTxnId)
      if (prev) {
        if (prev.action !== action || prev.user_id !== u.id || prev.request_hash !== h)
          throw new Error('معرف العملية مستخدم لبيانات مختلفة')
        return JSON.parse(prev.result)
      }
      if (!this.reconciles()) throw new Error('أرصدة الرواتب لا تطابق سجل الصرف')
      let id: string
      if (action === 'hr.employee.save') id = this.saveEmployee(d)
      else if (action === 'hr.shift.save') id = this.saveShift(d)
      else if (action === 'hr.roster.save') id = this.roster(d)
      else if (action === 'hr.attendance.save') id = this.attendance(d)
      else if (action === 'hr.leave.request') id = this.requestLeave(d, u)
      else if (action === 'hr.leave.decide') id = this.decideLeave(d)
      else if (action === 'hr.evaluation.save') id = this.evaluation(d, u)
      else if (action === 'hr.leave.credit') {
        this.employee(d.employeeId)
        const b = this.balance(d.employeeId, d.year)
        if (b.available + d.days < 0 || b.granted + d.days > 366)
          throw new Error('الرصيد المعدل خارج الحدود أو يقل عن الإجازات المعتمدة')
        id = ulid()
        this.db
          .prepare('INSERT INTO hr_leave_credits VALUES(?,?,?,?,?,?,?)')
          .run(id, d.employeeId, d.year, d.days, d.reason, u.id, Date.now())
      } else if (action === 'hr.salary.save') {
        this.employee(d.employeeId)
        const old = this.row<{ version: number }>(
          'SELECT version FROM hr_salaries WHERE employee_id=?',
          d.employeeId,
        )
        if (d.version !== (old?.version ?? 0)) throw new Error('أساس الراتب تغير؛ حدّث العرض')
        id = d.employeeId
        this.db
          .prepare(
            'INSERT INTO hr_salaries VALUES(?,?,1) ON CONFLICT(employee_id) DO UPDATE SET base=excluded.base,version=hr_salaries.version+1',
          )
          .run(id, d.base)
      } else if (action === 'hr.payroll.submit') id = this.submit(d, u)
      else if (action === 'hr.payroll.approve' || action === 'hr.payroll.void') {
        const r = this.run(d.id)
        this.checkVersion(r, d.version)
        if (action === 'hr.payroll.approve') {
          if (r.status !== 'submitted') throw new Error('المسير غير جاهز للاعتماد')
          if (r.creatorId === u.id) throw new Error('الاعتماد يحتاج مستخدمًا آخر غير منشئ المسير')
        } else if (r.status === 'void' || r.paid !== 0)
          throw new Error('لا يمكن إلغاء مسير ملغى أو تم صرف مبلغ منه')
        id = r.id
        this.db
          .prepare(
            'UPDATE hr_payroll_status SET status=?,version=version+1,approver_id=?,approver_name=?,reason=?,at=? WHERE run_id=?',
          )
          .run(
            action.endsWith('approve') ? 'approved' : 'void',
            u.id,
            u.name,
            d.reason,
            Date.now(),
            id,
          )
      } else if (action === 'hr.payroll.pay') {
        const item = this.row<{ run_id: string; net: number }>(
          'SELECT run_id,net FROM hr_payroll_items WHERE id=?',
          d.id,
        )
        if (!item) throw new Error('بند الراتب غير موجود')
        if (this.run(item.run_id).status !== 'approved')
          throw new Error('يلزم اعتماد المسير قبل الصرف')
        const paid = this.row<{ n: number }>(
          'SELECT COALESCE(sum(amount),0) n FROM hr_payroll_payments WHERE item_id=?',
          d.id,
        ).n
        if (d.amount > item.net - paid) throw new Error('المبلغ أكبر من المتبقي')
        id = ulid()
        this.db
          .prepare('INSERT INTO hr_payroll_payments VALUES(?,?,?,?,?,?,?)')
          .run(id, d.id, d.amount, d.method, d.reference, u.id, Date.now())
      } else throw new Error('العملية غير متاحة')
      let snapshot: unknown = {}
      if (action === 'hr.employee.save') snapshot = this.employee(id)
      else if (action === 'hr.shift.save')
        snapshot = this.row('SELECT * FROM hr_shifts WHERE id=?', id)
      else if (action === 'hr.roster.save') snapshot = this.row(rosterQuery + ' WHERE id=?', id)
      else if (action === 'hr.attendance.save')
        snapshot = this.row(attendanceQuery + ' WHERE id=?', id)
      else if (action.startsWith('hr.leave.') && action !== 'hr.leave.credit')
        snapshot = this.leaveRows(leaveQuery + ' WHERE id=?', id)[0]
      else if (action === 'hr.evaluation.save')
        snapshot = this.row('SELECT * FROM hr_evaluations WHERE id=?', id)
      else if (action === 'hr.salary.save')
        snapshot = this.row('SELECT * FROM hr_salaries WHERE employee_id=?', id)
      else snapshot = d
      this.db
        .prepare('INSERT INTO hr_events VALUES(?,?,?,?,?,?,?)')
        .run(
          ulid(),
          id,
          action,
          d.reason ?? d.note ?? '',
          u.id,
          Date.now(),
          JSON.stringify(snapshot),
        )
      this.identity.audit(u.id, action, id)
      const result = { id }
      this.db
        .prepare('INSERT INTO commands VALUES(?,?,?,?,?)')
        .run(d.clientTxnId, action, u.id, h, JSON.stringify(result))
      if (!this.reconciles()) throw new Error('أرصدة الرواتب لا تطابق سجل الصرف')
      return result
    })()
  }
}
