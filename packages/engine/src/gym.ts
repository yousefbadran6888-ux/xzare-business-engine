import { ulid } from '@xzare/core'
import type { XzareDatabase } from '@xzare/db'
import { Identity } from './identity.js'
import { fingerprint } from './commerce.js'
import { clinicToday, clinicDayBounds } from './clinic-time.js'
import { gymSchemas, type GymState, type GymReport } from './gym-validation.js'
import type { User } from './types.js'
const manager = (u: User) => ['admin', 'manager'].includes(u.role),
  staff = (u: User) => u.role !== 'trainer'
const mq = 'SELECT id,code,name,phone,note,active,at,version FROM gym_members',
  tq =
    'SELECT id,code,name,phone,note,user_id AS userId,active,at,version FROM gym_trainers',
  pq =
    'SELECT id,code,name,days,fee,visits,freeze_days AS freezeDays,description,active,at,version FROM gym_plans'
const sq = `SELECT s.id,s.member_id AS memberId,m.name AS memberName,m.code AS memberCode,s.plan_id AS planId,json_extract(s.plan_json,'$.name') AS planName,s.trainer_id AS trainerId,t.name AS trainerName,s.start_day AS startDay,s.end_day AS endDay,s.fee,s.discount,s.visits,s.freeze_days AS freezeDays,s.status,s.previous_id AS previousId,s.at,s.version,COALESCE((SELECT sum(l.amount) FROM gym_ledger l WHERE l.membership_id=s.id),0) AS balance,(SELECT count(*) FROM gym_checkins c WHERE c.membership_id=s.id AND NOT EXISTS(SELECT 1 FROM gym_checkin_voids v WHERE v.checkin_id=c.id)) AS used,COALESCE((SELECT sum(f.days) FROM gym_freezes f WHERE f.membership_id=s.id),0) AS frozenDays FROM gym_memberships s JOIN gym_members m ON m.id=s.member_id LEFT JOIN gym_trainers t ON t.id=s.trainer_id`
const aq = `SELECT c.id,c.membership_id AS membershipId,c.member_id AS memberId,c.member_name AS memberName,c.member_code AS memberCode,c.day,c.at,c.actor_name AS actorName,(SELECT o.at FROM gym_checkouts o WHERE o.checkin_id=c.id) AS outAt,(SELECT v.reason FROM gym_checkin_voids v WHERE v.checkin_id=c.id) AS voidReason FROM gym_checkins c`
const bq =
  'SELECT id,membership_id AS membershipId,trainer_id AS trainerId,trainer_name AS trainerName,member_name AS memberName,member_code AS memberCode,day,start_minute AS startMinute,duration,title,note,status,at,version FROM gym_sessions'
const rq = `SELECT p.id,p.number,p.membership_id AS membershipId,p.amount,p.method,p.reference,p.member_json AS member,p.plan_json AS plan,p.business_json AS business,p.actor_name AS actorName,p.at,(SELECT v.reason FROM gym_payment_voids v WHERE v.payment_id=p.id) AS voidReason FROM gym_payments p`
const dayAdd = (d: string, n: number) =>
  new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000)
    .toISOString()
    .slice(0, 10)
const safe = (n: number) => {
  if (!Number.isSafeInteger(n) || Math.abs(n) > 1e12)
    throw Error('المبلغ تجاوز الحد الآمن')
  return n
}
export class Gym {
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
  private version(x: any, v: unknown) {
    if (x && x.version !== v)
      throw Error('البيانات تغيرت؛ حدّث العرض وأعد المحاولة')
    if (!x && v !== undefined) throw Error('الإصدار يخص التعديل')
  }
  private manage(u: User) {
    if (!manager(u)) throw Error('هذه العملية تحتاج مدير الجيم')
  }
  private office(u: User) {
    if (!staff(u)) throw Error('هذه العملية تخص الاستقبال والتحصيل')
  }
  private member(id: string, u: User) {
    let m = this.row(mq + ' WHERE id=?', id)
    if (!m) throw Error('العضو غير موجود')
    if (
      !staff(u) &&
      !this.row(
        `SELECT s.id FROM gym_memberships s JOIN gym_trainers t ON t.id=s.trainer_id WHERE s.member_id=? AND t.user_id=? AND t.active=1`,
        id,
        u.id,
      )
    )
      throw Error('العضو خارج تكليفك')
    return staff(u)
      ? m
      : {
          id: m.id,
          code: m.code,
          name: m.name,
          active: m.active,
          at: m.at,
          version: m.version,
        }
  }
  private membership(id: string, u: User) {
    let s = this.row(sq + ' WHERE s.id=?', id)
    if (!s) throw Error('الاشتراك غير موجود')
    if (
      !staff(u) &&
      !this.row(
        'SELECT id FROM gym_trainers WHERE id=? AND user_id=? AND active=1',
        s.trainerId,
        u.id,
      )
    )
      throw Error('الاشتراك خارج تكليفك')
    return { ...s, renewalDay: this.renewalDay(s.memberId) }
  }
  private visible(s: any, u: User) {
    if (staff(u)) return s
    const { fee, discount, balance, ...v } = s
    return v
  }
  private renewalDay(memberId: string) {
    const last = this.row<{ end: string | null }>(
      `SELECT max(end_day) AS end FROM gym_memberships WHERE member_id=? AND status='active'`,
      memberId,
    ).end
    const today = clinicToday()
    return last && last >= today ? dayAdd(last, 1) : today
  }
  private trainer(id: string | null) {
    if (id === null) return null
    const t = this.row(tq + ' WHERE id=? AND active=1', id)
    if (!t) throw Error('اختر مدربًا نشطًا')
    return t
  }
  private session(id: string, u: User) {
    const s = this.row(bq + ' WHERE id=?', id)
    if (!s) throw Error('الجلسة غير موجودة')
    this.membership(s.membershipId, u)
    return s
  }
  private freezes(id: string, u: User) {
    return this.rows(
      'SELECT id,from_day AS "from",to_day AS "to",days,original_end AS originalEnd,new_end AS newEnd,reason,actor_name AS actorName,at FROM gym_freezes WHERE membership_id=? ORDER BY from_day',
      id,
    ).map((f) => (staff(u) ? f : { ...f, reason: '', actorName: '' }))
  }
  private frozen(id: string, day: string) {
    return !!this.row(
      'SELECT id FROM gym_freezes WHERE membership_id=? AND from_day<=? AND to_day>=?',
      id,
      day,
      day,
    )
  }
  private bump(id: string) {
    this.db
      .prepare('UPDATE gym_memberships SET version=version+1 WHERE id=?')
      .run(id)
  }
  private ledger(
    id: string,
    kind: string,
    amount: number,
    ref: string | null,
    reason: string,
    u: User,
  ) {
    this.db
      .prepare('INSERT INTO gym_ledger VALUES(?,?,?,?,?,?,?,?,?)')
      .run(
        ulid(),
        id,
        kind,
        safe(amount),
        ref,
        reason,
        u.id,
        u.name,
        Date.now(),
      )
  }
  private events(type: string, id: string, u: User) {
    return staff(u)
      ? this.rows(
          'SELECT id,action,reason,snapshot,actor_name AS actorName,at FROM gym_events WHERE entity_type=? AND entity_id=? ORDER BY at DESC,id DESC LIMIT 1000',
          type,
          id,
        )
      : []
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
      .prepare('INSERT INTO gym_events VALUES(?,?,?,?,?,?,?,?,?)')
      .run(
        ulid(),
        type,
        id,
        action,
        reason,
        JSON.stringify(snapshot),
        u.id,
        u.name,
        Date.now(),
      )
  }
  private payments(where = '', ...a: any[]) {
    return this.rows(rq + where, ...a).map((p) => ({
      ...p,
      member: JSON.parse(p.member),
      plan: JSON.parse(p.plan),
      business: JSON.parse(p.business),
    }))
  }
  private attendance(where = '', ...a: any[]) {
    return this.rows(aq + where, ...a)
  }
  private sessionVisible(s: any, u: User) {
    return staff(u) ? s : { ...s, title: '', note: '' }
  }
  private attendanceVisible(a: any, u: User) {
    return staff(u)
      ? a
      : {
          ...a,
          actorName: '',
          voidReason: a.voidReason ? 'تم إلغاء التسجيل' : null,
        }
  }
  state(u: User): GymState {
    let memberships = this.rows(sq + ' ORDER BY s.start_day DESC,s.at DESC')
      .filter(
        (s) =>
          staff(u) ||
          !!this.row(
            'SELECT id FROM gym_trainers WHERE id=? AND user_id=? AND active=1',
            s.trainerId,
            u.id,
          ),
      )
      .map((s) => ({ ...s, renewalDay: this.renewalDay(s.memberId) }))
    const ids = new Set(memberships.map((s) => s.id)),
      mids = new Set(memberships.map((s) => s.memberId))
    return {
      user: u,
      settings: Object.fromEntries(
        this.rows<{ key: string; value: string }>(
          'SELECT key,value FROM settings',
        )
          .filter((x) =>
            [
              'businessName',
              'phone',
              'address',
              'receiptFooter',
              'language',
              'currency',
            ].includes(x.key),
          )
          .map((x) => [x.key, x.value]),
      ),
      members: this.rows(mq + ' ORDER BY name')
        .filter((m) => staff(u) || mids.has(m.id))
        .map((m) =>
          staff(u)
            ? m
            : {
                id: m.id,
                code: m.code,
                name: m.name,
                active: m.active,
                at: m.at,
                version: m.version,
              },
        ),
      trainers: this.rows(tq + ' ORDER BY name')
        .filter((t) => staff(u) || t.userId === u.id)
        .map((t) =>
          staff(u)
            ? t
            : {
                id: t.id,
                code: t.code,
                name: t.name,
                userId: t.userId,
                active: t.active,
                at: t.at,
                version: t.version,
              },
        ),
      plans: staff(u) ? this.rows(pq + ' ORDER BY name') : [],
      memberships: memberships.map((s) => this.visible(s, u)),
      attendance: this.attendance(' ORDER BY c.at DESC LIMIT 2000')
        .filter((a) => ids.has(a.membershipId))
        .map((a) => this.attendanceVisible(a, u)),
      sessions: this.rows(bq + ' ORDER BY day DESC,start_minute')
        .filter((b) => ids.has(b.membershipId))
        .map((b) => this.sessionVisible(b, u)),
      payments: staff(u) ? this.payments(' ORDER BY p.at DESC LIMIT 1000') : [],
      users:
        u.role === 'admin'
          ? this.rows(
              'SELECT id,username,name,role,active FROM users ORDER BY name',
            )
          : [],
      trainerAccounts: manager(u)
        ? this.rows(
            `SELECT id,username,name,role,active FROM users WHERE role='trainer' ORDER BY name`,
          )
        : [],
      audit:
        u.role === 'admin'
          ? this.rows(
              'SELECT a.*,u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.at DESC LIMIT 300',
            )
          : [],
    }
  }
  private get(action: string, id: string, u: User) {
    if (action === 'gym.member.get') {
      const member = this.member(id, u)
      let memberships = this.rows(
        sq + ' WHERE s.member_id=? ORDER BY s.start_day DESC',
        id,
      )
        .filter((s) => {
          try {
            this.membership(s.id, u)
            return true
          } catch {
            return false
          }
        })
        .map((s) =>
          this.visible({ ...s, renewalDay: this.renewalDay(s.memberId) }, u),
        )
      return { member, memberships, events: this.events('member', id, u) }
    }
    if (action === 'gym.membership.get') {
      const s = this.membership(id, u)
      return {
        membership: this.visible(s, u),
        freezes: this.freezes(id, u),
        attendance: this.attendance(
          ' WHERE c.membership_id=? ORDER BY c.at DESC LIMIT 2000',
          id,
        ).map((a) => this.attendanceVisible(a, u)),
        sessions: this.rows(
          bq + ' WHERE membership_id=? ORDER BY day DESC,start_minute',
          id,
        ).map((b) => this.sessionVisible(b, u)),
        payments: staff(u)
          ? this.payments(' WHERE p.membership_id=? ORDER BY p.at DESC', id)
          : [],
        ledger: staff(u)
          ? this.rows(
              'SELECT id,kind,amount,reason,actor_name AS actorName,at FROM gym_ledger WHERE membership_id=? ORDER BY at,id',
              id,
            )
          : [],
        events: this.events('membership', id, u),
      }
    }
    const session = this.session(id, u)
    return {
      session: this.sessionVisible(session, u),
      events: this.events('session', id, u),
    }
  }
  private entryReason(s: any, m: any) {
    const today = clinicToday()
    if (!m.active) return 'العضو متوقف'
    if (s.status !== 'active') return 'الاشتراك متوقف أو ملغى'
    if (today < s.startDay) return 'الاشتراك لم يبدأ'
    if (today > s.endDay) return 'الاشتراك انتهى؛ جدّد الاشتراك'
    if (this.frozen(s.id, today)) return 'الاشتراك مجمد اليوم'
    if (s.balance !== 0) return 'سدد المستحق قبل تسجيل الدخول'
    if (s.visits !== null && s.used >= s.visits)
      return 'استهلك عدد الزيارات المتاح'
    if (
      this.row(
        `SELECT c.id FROM gym_checkins c WHERE c.member_id=? AND c.day=? AND NOT EXISTS(SELECT 1 FROM gym_checkin_voids v WHERE v.checkin_id=c.id)`,
        m.id,
        today,
      )
    )
      return 'الحضور مسجل بالفعل اليوم'
    return ''
  }
  private access(code: string, u: User) {
    this.office(u)
    let m = this.row(mq + ' WHERE code=?', code)
    if (!m) throw Error('كود العضو غير موجود؛ راجع البطاقة')
    let s = this.row(
      sq +
        ` WHERE s.member_id=? AND s.status='active' AND s.start_day<=? AND s.end_day>=? ORDER BY s.start_day DESC LIMIT 1`,
      m.id,
      clinicToday(),
      clinicToday(),
    )
    if (!s)
      s = this.row(
        sq + ' WHERE s.member_id=? ORDER BY s.start_day DESC LIMIT 1',
        m.id,
      )
    if (!s)
      return {
        member: m,
        membership: null,
        allowed: false,
        reason: 'لا يوجد اشتراك؛ أضف اشتراكًا',
      }
    s = { ...s, renewalDay: this.renewalDay(m.id) }
    const reason = this.entryReason(s, m)
    return {
      member: m,
      membership: s,
      allowed: !reason,
      reason: reason || 'الاشتراك صالح للدخول اليوم',
    }
  }
  private saveMember(d: any, u: User) {
    this.office(u)
    let old = d.id ? this.member(d.id, u) : undefined
    this.version(old, d.version)
    if (
      old &&
      old.code !== d.code &&
      this.row('SELECT id FROM gym_memberships WHERE member_id=?', old.id)
    )
      throw Error('الكود ثابت بعد تسجيل الاشتراكات')
    const id = d.id ?? ulid()
    this.db
      .prepare(
        `INSERT INTO gym_members VALUES(?,?,?,?,?,?,?,0) ON CONFLICT(id) DO UPDATE SET code=excluded.code,name=excluded.name,phone=excluded.phone,note=excluded.note,active=excluded.active,version=gym_members.version+1`,
      )
      .run(id, d.code, d.name, d.phone, d.note, +d.active, Date.now())
    return id
  }
  private saveTrainer(d: any, u: User) {
    this.manage(u)
    let old = d.id ? this.row(tq + ' WHERE id=?', d.id) : undefined
    if (d.id && !old) throw Error('المدرب غير موجود')
    this.version(old, d.version)
    if (
      d.userId &&
      !this.row(
        `SELECT id FROM users WHERE id=? AND role='trainer' AND active=1`,
        d.userId,
      )
    )
      throw Error('اختر حساب مدرب نشطًا')
    const id = d.id ?? ulid()
    this.db
      .prepare(
        `INSERT INTO gym_trainers VALUES(?,?,?,?,?,?,?,?,0) ON CONFLICT(id) DO UPDATE SET code=excluded.code,name=excluded.name,phone=excluded.phone,note=excluded.note,user_id=excluded.user_id,active=excluded.active,version=gym_trainers.version+1`,
      )
      .run(id, d.code, d.name, d.phone, d.note, d.userId, +d.active, Date.now())
    return id
  }
  private savePlan(d: any, u: User) {
    this.manage(u)
    let old = d.id ? this.row(pq + ' WHERE id=?', d.id) : undefined
    if (d.id && !old) throw Error('الباقة غير موجودة')
    this.version(old, d.version)
    const id = d.id ?? ulid()
    this.db
      .prepare(
        `INSERT INTO gym_plans VALUES(?,?,?,?,?,?,?,?,?,?,0) ON CONFLICT(id) DO UPDATE SET code=excluded.code,name=excluded.name,days=excluded.days,fee=excluded.fee,visits=excluded.visits,freeze_days=excluded.freeze_days,description=excluded.description,active=excluded.active,version=gym_plans.version+1`,
      )
      .run(
        id,
        d.code,
        d.name,
        d.days,
        d.fee,
        d.visits,
        d.freezeDays,
        d.description,
        +d.active,
        Date.now(),
      )
    return id
  }
  private noOverlap(memberId: string, from: string, to: string, except = '') {
    if (
      this.row(
        `SELECT id FROM gym_memberships WHERE member_id=? AND status='active' AND start_day<=? AND end_day>=? AND id<>?`,
        memberId,
        to,
        from,
        except,
      )
    )
      throw Error('الفترة تتداخل مع اشتراك قائم')
  }
  private addMembership(d: any, u: User, previous: string | null = null) {
    this.office(u)
    const m = this.member(d.memberId, u),
      p = this.row(pq + ' WHERE id=?', d.planId)
    this.version(m, d.memberVersion)
    if (!p) throw Error('الباقة غير موجودة')
    this.version(p, d.planVersion)
    if (!m.active || !p.active) throw Error('العضو أو الباقة متوقف')
    this.trainer(d.trainerId)
    if (d.discount > p.fee) throw Error('الخصم أكبر من سعر الباقة')
    if (d.discount > 0 && !manager(u)) throw Error('الخصم يحتاج المدير')
    if (d.startDay < clinicToday())
      throw Error('بداية الاشتراك لا تكون في الماضي')
    const end = dayAdd(d.startDay, p.days - 1)
    if (end > '2100-12-31') throw Error('نهاية الاشتراك خارج الفترة المدعومة')
    this.noOverlap(m.id, d.startDay, end)
    const id = ulid()
    this.db
      .prepare(
        `INSERT INTO gym_memberships VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'active',?,?,0)`,
      )
      .run(
        id,
        m.id,
        p.id,
        d.trainerId,
        JSON.stringify({ name: m.name, code: m.code }),
        JSON.stringify({
          name: p.name,
          code: p.code,
          days: p.days,
          visits: p.visits,
          freezeDays: p.freezeDays,
        }),
        d.startDay,
        end,
        p.fee,
        d.discount,
        p.visits,
        p.freezeDays,
        previous,
        Date.now(),
      )
    this.ledger(
      id,
      'charge',
      p.fee - d.discount,
      null,
      'رسوم الباقة وقت الاشتراك',
      u,
    )
    return id
  }
  private renew(d: any, u: User) {
    this.office(u)
    const s = this.membership(d.id, u)
    this.version(s, d.version)
    const start = this.renewalDay(s.memberId)
    if (d.startDay !== start)
      throw Error('تاريخ التجديد تغير؛ راجع البداية الجديدة')
    const m = this.member(s.memberId, u)
    const id = this.addMembership(
      { ...d, memberId: m.id, memberVersion: m.version },
      u,
      s.id,
    )
    this.bump(s.id)
    return id
  }
  private freeze(d: any, u: User) {
    this.manage(u)
    const s = this.membership(d.id, u)
    this.version(s, d.version)
    const days = (Date.parse(d.to) - Date.parse(d.from)) / 86400000 + 1
    if (
      s.status !== 'active' ||
      d.from < clinicToday() ||
      d.from < s.startDay ||
      d.to > s.endDay ||
      s.frozenDays + days > s.freezeDays
    )
      throw Error('فترة التجميد خارج الاشتراك أو رصيد الأيام')
    if (
      this.row(
        'SELECT id FROM gym_freezes WHERE membership_id=? AND from_day<=? AND to_day>=?',
        s.id,
        d.to,
        d.from,
      )
    )
      throw Error('فترة التجميد تتداخل مع تجميد سابق')
    if (
      this.row(
        `SELECT c.id FROM gym_checkins c WHERE c.membership_id=? AND c.day BETWEEN ? AND ? AND NOT EXISTS(SELECT 1 FROM gym_checkin_voids v WHERE v.checkin_id=c.id)`,
        s.id,
        d.from,
        d.to,
      ) ||
      this.row(
        `SELECT id FROM gym_sessions WHERE membership_id=? AND day BETWEEN ? AND ? AND status<>'cancelled'`,
        s.id,
        d.from,
        d.to,
      )
    )
      throw Error('الفترة تحتوي حضورًا أو جلسة؛ راجع الموعد أولًا')
    const end = dayAdd(s.endDay, days)
    if (end > '2100-12-31') throw Error('النهاية خارج الفترة المدعومة')
    this.noOverlap(s.memberId, s.startDay, end, s.id)
    const id = ulid()
    this.db
      .prepare('INSERT INTO gym_freezes VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(
        id,
        s.id,
        d.from,
        d.to,
        days,
        s.endDay,
        end,
        d.reason,
        u.id,
        u.name,
        Date.now(),
      )
    this.db
      .prepare(
        'UPDATE gym_memberships SET end_day=?,version=version+1 WHERE id=?',
      )
      .run(end, s.id)
    return id
  }
  private overlap(
    trainerId: string,
    memberId: string,
    day: string,
    start: number,
    duration: number,
    except = '',
  ) {
    if (
      this.row(
        `SELECT b.id FROM gym_sessions b JOIN gym_memberships s ON s.id=b.membership_id WHERE (b.trainer_id=? OR s.member_id=?) AND b.day=? AND b.status<>'cancelled' AND b.start_minute<? AND b.start_minute+b.duration>? AND b.id<>?`,
        trainerId,
        memberId,
        day,
        start + duration,
        start,
        except,
      )
    )
      throw Error('الموعد يتداخل مع جلسة للمدرب أو العضو')
  }
  private assign(d: any, u: User) {
    this.manage(u)
    const s = this.membership(d.id, u)
    this.version(s, d.version)
    const t = this.trainer(d.trainerId),
      pending = this.rows(
        `SELECT * FROM gym_sessions WHERE membership_id=? AND status='scheduled' AND day>=?`,
        s.id,
        clinicToday(),
      )
    if (!t && pending.length)
      throw Error('راجع الجلسات القادمة قبل إزالة المدرب')
    if (t)
      for (const b of pending)
        this.overlap(t.id, s.memberId, b.day, b.start_minute, b.duration, b.id)
    this.db
      .prepare(
        'UPDATE gym_memberships SET trainer_id=?,version=version+1 WHERE id=?',
      )
      .run(d.trainerId, s.id)
    if (t)
      this.db
        .prepare(
          `UPDATE gym_sessions SET trainer_id=?,trainer_name=?,version=version+1 WHERE membership_id=? AND status='scheduled' AND day>=?`,
        )
        .run(t.id, t.name, s.id, clinicToday())
    return s.id
  }
  private stop(d: any, u: User, cancel: boolean) {
    this.manage(u)
    const s = this.membership(d.id, u)
    this.version(s, d.version)
    if (s.status !== 'active') throw Error('الاشتراك متوقف أو ملغى')
    if (
      cancel &&
      (this.row(
        `SELECT id FROM gym_ledger WHERE membership_id=? AND kind<>'charge'`,
        s.id,
      ) ||
        this.row('SELECT id FROM gym_checkins WHERE membership_id=?', s.id) ||
        this.row('SELECT id FROM gym_sessions WHERE membership_id=?', s.id) ||
        this.row('SELECT id FROM gym_freezes WHERE membership_id=?', s.id))
    )
      throw Error('الإلغاء متاح قبل التحصيل أو الحضور أو التجميد أو الجلسات')
    this.db
      .prepare(
        'UPDATE gym_memberships SET status=?,version=version+1 WHERE id=?',
      )
      .run(cancel ? 'cancelled' : 'stopped', s.id)
    if (cancel) this.ledger(s.id, 'cancel', -s.balance, null, d.reason, u)
    else
      this.db
        .prepare(
          `UPDATE gym_sessions SET status='cancelled',version=version+1 WHERE membership_id=? AND status='scheduled' AND day>=?`,
        )
        .run(s.id, clinicToday())
    return s.id
  }
  private collect(d: any, u: User) {
    this.office(u)
    const s = this.membership(d.membershipId, u)
    this.version(s, d.version)
    if (s.status === 'cancelled' || d.amount > s.balance)
      throw Error('المبلغ أكبر من المستحق أو الاشتراك ملغى')
    const id = ulid(),
      number =
        'GYM-' +
        String(
          this.row<{ n: number }>('SELECT count(*) n FROM gym_payments').n + 1,
        ).padStart(6, '0')
    const raw = this.row(
        'SELECT member_json,plan_json FROM gym_memberships WHERE id=?',
        s.id,
      ),
      business = Object.fromEntries(
        this.rows<{ key: string; value: string }>(
          'SELECT key,value FROM settings',
        )
          .filter((x) =>
            ['businessName', 'phone', 'address', 'receiptFooter'].includes(
              x.key,
            ),
          )
          .map((x) => [x.key, x.value]),
      )
    this.db
      .prepare('INSERT INTO gym_payments VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(
        id,
        number,
        s.id,
        d.amount,
        d.method,
        d.reference,
        raw.member_json,
        raw.plan_json,
        JSON.stringify(business),
        u.id,
        u.name,
        Date.now(),
      )
    this.ledger(s.id, 'payment', -d.amount, id, d.reference, u)
    this.bump(s.id)
    return id
  }
  private voidPayment(d: any, u: User) {
    this.manage(u)
    const p = this.row('SELECT * FROM gym_payments WHERE id=?', d.id)
    if (
      !p ||
      this.row('SELECT id FROM gym_payment_voids WHERE payment_id=?', d.id)
    )
      throw Error('الإيصال غير موجود أو ملغى')
    const id = ulid(),
      s = this.membership(p.membership_id, u)
    safe(s.balance + p.amount)
    this.db
      .prepare('INSERT INTO gym_payment_voids VALUES(?,?,?,?,?,?)')
      .run(id, p.id, d.reason, u.id, u.name, Date.now())
    this.ledger(s.id, 'void', p.amount, p.id, d.reason, u)
    this.bump(s.id)
    return { id, entityId: s.id }
  }
  private credit(d: any, u: User) {
    this.manage(u)
    const s = this.membership(d.membershipId, u)
    this.version(s, d.version)
    if (s.status === 'cancelled' || d.amount > s.balance)
      throw Error('التخفيض أكبر من المستحق')
    this.ledger(s.id, 'credit', -d.amount, null, d.reason, u)
    this.bump(s.id)
    return s.id
  }
  private checkin(d: any, u: User) {
    this.office(u)
    const s = this.membership(d.membershipId, u),
      m = this.member(s.memberId, u)
    this.version(s, d.version)
    this.version(m, d.memberVersion)
    const reason = this.entryReason(s, m)
    if (reason) throw Error(reason)
    const id = ulid()
    this.db
      .prepare('INSERT INTO gym_checkins VALUES(?,?,?,?,?,?,?,?,?)')
      .run(
        id,
        s.id,
        m.id,
        m.name,
        m.code,
        clinicToday(),
        u.id,
        u.name,
        Date.now(),
      )
    this.bump(s.id)
    return id
  }
  private checkout(d: any, u: User) {
    this.office(u)
    const c = this.row('SELECT * FROM gym_checkins WHERE id=?', d.id)
    if (
      !c ||
      c.day !== clinicToday() ||
      this.row('SELECT id FROM gym_checkin_voids WHERE checkin_id=?', d.id) ||
      this.row('SELECT id FROM gym_checkouts WHERE checkin_id=?', d.id)
    )
      throw Error('التسجيل غير متاح للخروج أو خرج بالفعل')
    const id = ulid()
    this.db
      .prepare('INSERT INTO gym_checkouts VALUES(?,?,?,?,?)')
      .run(id, c.id, u.id, u.name, Date.now())
    this.bump(c.membership_id)
    return { id, entityId: c.membership_id }
  }
  private voidCheckin(d: any, u: User) {
    this.manage(u)
    const c = this.row('SELECT * FROM gym_checkins WHERE id=?', d.id)
    if (
      !c ||
      this.row('SELECT id FROM gym_checkin_voids WHERE checkin_id=?', d.id)
    )
      throw Error('التسجيل غير موجود أو ملغى')
    const id = ulid()
    this.db
      .prepare('INSERT INTO gym_checkin_voids VALUES(?,?,?,?,?,?)')
      .run(id, c.id, d.reason, u.id, u.name, Date.now())
    this.bump(c.membership_id)
    return { id, entityId: c.membership_id }
  }
  private saveSession(d: any, u: User) {
    this.office(u)
    const s = this.membership(d.membershipId, u)
    this.version(s, d.version)
    const m = this.member(s.memberId, u),
      t = this.trainer(s.trainerId)
    const old = d.id ? this.session(d.id, u) : undefined
    this.version(old, d.sessionVersion)
    if (old && (old.status !== 'scheduled' || old.membershipId !== s.id))
      throw Error('الجلسة لا تقبل تعديل هذا الاشتراك')
    if (
      !m.active ||
      !t ||
      s.status !== 'active' ||
      d.day < clinicToday() ||
      d.day < s.startDay ||
      d.day > s.endDay ||
      this.frozen(s.id, d.day)
    )
      throw Error('الموعد خارج الاشتراك أو التجميد أو لا يوجد مدرب نشط')
    this.overlap(t.id, s.memberId, d.day, d.startMinute, d.duration, d.id)
    const id = d.id ?? ulid()
    this.db
      .prepare(
        `INSERT INTO gym_sessions VALUES(?,?,?,?,?,?,?,?,?,?,?,'scheduled',?,0) ON CONFLICT(id) DO UPDATE SET day=excluded.day,start_minute=excluded.start_minute,duration=excluded.duration,title=excluded.title,note=excluded.note,version=gym_sessions.version+1`,
      )
      .run(
        id,
        s.id,
        t.id,
        t.name,
        m.name,
        m.code,
        d.day,
        d.startMinute,
        d.duration,
        d.title,
        d.note,
        Date.now(),
      )
    this.bump(s.id)
    return id
  }
  private cancelSession(d: any, u: User) {
    this.office(u)
    const b = this.session(d.id, u)
    this.version(b, d.version)
    if (b.status !== 'scheduled') throw Error('الجلسة محفوظة أو ملغاة')
    this.db
      .prepare(
        `UPDATE gym_sessions SET status='cancelled',version=version+1 WHERE id=?`,
      )
      .run(b.id)
    this.bump(b.membershipId)
    return b.id
  }
  private mark(d: any, u: User) {
    if (!manager(u) && u.role !== 'trainer')
      throw Error('تسجيل نتيجة التدريب يخص المدرب أو المدير')
    const b = this.session(d.id, u)
    this.version(b, d.version)
    if (b.status === 'cancelled' || b.day > clinicToday())
      throw Error('الجلسة ملغاة أو في المستقبل')
    if (b.status !== 'scheduled' && !manager(u))
      throw Error('تصحيح نتيجة محفوظة يحتاج المدير')
    if (b.status !== 'scheduled' && !d.note) throw Error('التصحيح يحتاج ملاحظة')
    this.db
      .prepare(
        'UPDATE gym_sessions SET status=?,note=?,version=version+1 WHERE id=?',
      )
      .run(d.status, d.note, b.id)
    return b.id
  }
  private report(d: any, u: User): GymReport {
    const state = this.state(u),
      bounds = clinicDayBounds(d.from, d.to),
      sum = (sql: string, ...a: any[]) =>
        safe(this.row<{ n: number | null }>(sql, ...a).n ?? 0)
    const finance = staff(u)
      ? {
          netCollected:
            sum(
              'SELECT sum(amount) n FROM gym_payments WHERE at>=? AND at<?',
              bounds.lo,
              bounds.hi,
            ) -
            sum(
              'SELECT sum(p.amount) n FROM gym_payment_voids v JOIN gym_payments p ON p.id=v.payment_id WHERE v.at>=? AND v.at<?',
              bounds.lo,
              bounds.hi,
            ),
          voided: sum(
            'SELECT sum(p.amount) n FROM gym_payment_voids v JOIN gym_payments p ON p.id=v.payment_id WHERE v.at>=? AND v.at<?',
            bounds.lo,
            bounds.hi,
          ),
          outstanding: sum('SELECT sum(amount) n FROM gym_ledger'),
          charges: sum(
            `SELECT sum(amount) n FROM gym_ledger WHERE kind='charge' AND at>=? AND at<?`,
            bounds.lo,
            bounds.hi,
          ),
          credits: -sum(
            `SELECT sum(amount) n FROM gym_ledger WHERE kind='credit' AND at>=? AND at<?`,
            bounds.lo,
            bounds.hi,
          ),
        }
      : null
    const ids = new Set(state.memberships.map((s) => s.id))
    return {
      from: d.from,
      to: d.to,
      finance,
      attendance: this.attendance(
        ' WHERE c.day BETWEEN ? AND ? ORDER BY c.at DESC',
        d.from,
        d.to,
      )
        .filter((a) => ids.has(a.membershipId))
        .map((a) => this.attendanceVisible(a, u)),
      sessions: state.sessions.filter((s) => s.day >= d.from && s.day <= d.to),
      payments: staff(u)
        ? this.payments(
            ' WHERE p.at>=? AND p.at<? ORDER BY p.at DESC',
            bounds.lo,
            bounds.hi,
          )
        : [],
      memberCount: state.members.length,
      activeCount: state.memberships.filter(
        (s) =>
          s.status === 'active' &&
          s.startDay <= clinicToday() &&
          s.endDay >= clinicToday(),
      ).length,
      expiring: state.memberships
        .filter(
          (s) =>
            s.status === 'active' &&
            s.endDay >= clinicToday() &&
            s.endDay <= dayAdd(clinicToday(), 7),
        )
        .map((s) => this.visible(s, u)),
    }
  }
  call(action: string, input: unknown, u: User): unknown {
    const schema = gymSchemas[action as keyof typeof gymSchemas]
    if (!schema) throw Error('العملية غير متاحة')
    const d = schema.parse(input) as any
    if (action === 'gym.state') return this.state(u)
    if (action === 'gym.report') return this.report(d, u)
    if (action === 'gym.access.get') return this.access(d.code, u)
    if (action.endsWith('.get')) return this.get(action, d.id, u)
    if (action === 'gym.session.mark') {
      if (!manager(u) && u.role !== 'trainer')
        throw Error('نتيجة الجلسة تحتاج المدرب أو المدير')
      this.session(d.id, u)
    } else this.office(u)
    return this.db.transaction(() => {
      const h = fingerprint(d),
        prev = this.row(
          'SELECT * FROM commands WHERE client_txn_id=?',
          d.clientTxnId,
        )
      if (prev) {
        if (
          prev.action !== action ||
          prev.user_id !== u.id ||
          prev.request_hash !== h
        )
          throw Error('معرف العملية مستخدم لبيانات مختلفة')
        return JSON.parse(prev.result)
      }
      let id: string,
        type = 'membership',
        entityId: string,
        snapshot: unknown = {}
      if (action === 'gym.member.save') {
        id = this.saveMember(d, u)
        type = 'member'
        entityId = id
        snapshot = this.member(id, u)
      } else if (action === 'gym.trainer.save') {
        id = this.saveTrainer(d, u)
        type = 'trainer'
        entityId = id
      } else if (action === 'gym.plan.save') {
        id = this.savePlan(d, u)
        type = 'plan'
        entityId = id
      } else if (action === 'gym.membership.add') {
        id = this.addMembership(d, u)
        entityId = id
        snapshot = this.membership(id, u)
      } else if (action === 'gym.membership.renew') {
        id = this.renew(d, u)
        entityId = id
        snapshot = this.membership(id, u)
      } else if (action === 'gym.membership.freeze') {
        id = this.freeze(d, u)
        entityId = d.id
        snapshot = { from: d.from, to: d.to }
      } else if (action === 'gym.membership.assign') {
        id = this.assign(d, u)
        entityId = id
        snapshot = { trainerId: d.trainerId }
      } else if (
        action === 'gym.membership.stop' ||
        action === 'gym.membership.cancel'
      ) {
        id = this.stop(d, u, action.endsWith('.cancel'))
        entityId = id
      } else if (action === 'gym.payment.post') {
        id = this.collect(d, u)
        entityId = d.membershipId
        snapshot = { paymentId: id, amount: d.amount }
      } else if (action === 'gym.payment.void') {
        const v = this.voidPayment(d, u)
        id = v.id
        entityId = v.entityId
        snapshot = { paymentId: d.id }
      } else if (action === 'gym.credit.post') {
        id = this.credit(d, u)
        entityId = id
        snapshot = { amount: d.amount }
      } else if (action === 'gym.attendance.in') {
        id = this.checkin(d, u)
        entityId = d.membershipId
        snapshot = { checkinId: id }
      } else if (
        action === 'gym.attendance.out' ||
        action === 'gym.attendance.void'
      ) {
        const v = action.endsWith('.out')
          ? this.checkout(d, u)
          : this.voidCheckin(d, u)
        id = v.id
        entityId = v.entityId
        snapshot = { checkinId: d.id }
      } else if (action === 'gym.session.save') {
        id = this.saveSession(d, u)
        type = 'session'
        entityId = id
        snapshot = this.session(id, u)
      } else if (action === 'gym.session.cancel') {
        id = this.cancelSession(d, u)
        type = 'session'
        entityId = id
      } else if (action === 'gym.session.mark') {
        id = this.mark(d, u)
        type = 'session'
        entityId = id
        snapshot = { status: d.status, note: d.note }
      } else throw Error('العملية غير متاحة')
      this.event(type, entityId, action, d.reason ?? '', snapshot, u)
      this.identity.audit(u.id, action, entityId)
      const result = { id }
      this.db
        .prepare('INSERT INTO commands VALUES(?,?,?,?,?)')
        .run(d.clientTxnId, action, u.id, h, JSON.stringify(result))
      return result
    })()
  }
}
