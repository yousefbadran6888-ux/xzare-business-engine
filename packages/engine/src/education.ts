import { ulid } from "@xzare/core";
import type { XzareDatabase } from "@xzare/db";
import { Identity } from "./identity.js";
import { fingerprint } from "./commerce.js";
import { clinicToday, clinicDayBounds } from "./clinic-time.js";
import {
  eduSchemas,
  type EduState,
  type EduReport,
} from "./education-validation.js";
import type { User } from "./types.js";
const manager = (u: User) => ["admin", "manager"].includes(u.role),
  staff = (u: User) => u.role !== "teacher";
const sq = `SELECT id,code,name,phone,guardian,guardian_phone AS guardianPhone,birth_day AS birthDay,level,note,active,at,version FROM edu_students`;
const tq = `SELECT id,code,name,phone,note,user_id AS userId,active,at,version FROM edu_teachers`;
const cq = `SELECT * FROM edu_courses`;
const gq = `SELECT g.id,g.code,g.name,g.course_id AS courseId,c.name AS courseName,g.teacher_id AS teacherId,t.name AS teacherName,g.start_day AS startDay,g.end_day AS endDay,g.fee,g.capacity,g.note,g.active,g.at,g.version,(SELECT count(*) FROM edu_enrollments e WHERE e.group_id=g.id AND e.status='active') AS count FROM edu_groups g JOIN edu_courses c ON c.id=g.course_id JOIN edu_teachers t ON t.id=g.teacher_id`;
const eq = `SELECT e.id,e.student_id AS studentId,s.name AS studentName,s.code AS studentCode,e.group_id AS groupId,g.name AS groupName,e.fee,e.discount,e.status,e.at,e.version,COALESCE((SELECT sum(l.amount) FROM edu_fee_ledger l WHERE l.enrollment_id=e.id),0) AS balance FROM edu_enrollments e JOIN edu_students s ON s.id=e.student_id JOIN edu_groups g ON g.id=e.group_id`;
const lq = `SELECT l.id,l.group_id AS groupId,g.name AS groupName,t.name AS teacherName,l.day,l.start_minute AS startMinute,l.duration,l.title,l.note,l.status,l.at,l.version,(SELECT count(*) FROM edu_session_roster r WHERE r.session_id=l.id) AS count,(SELECT count(*) FROM edu_session_roster r JOIN edu_attendance a ON a.roster_id=r.id WHERE r.session_id=l.id) AS marked FROM edu_sessions l JOIN edu_groups g ON g.id=l.group_id JOIN edu_teachers t ON t.id=g.teacher_id`;
const xq = `SELECT x.id,x.group_id AS groupId,g.name AS groupName,x.day,x.title,x.max_score AS maxScore,x.note,x.status,x.at,x.version,(SELECT count(*) FROM edu_exam_roster r WHERE r.exam_id=x.id) AS count FROM edu_exams x JOIN edu_groups g ON g.id=x.group_id`;
const pq = `SELECT p.id,p.number,p.enrollment_id AS enrollmentId,p.amount,p.method,p.reference,p.student_json AS student,p.group_json AS "group",p.business_json AS business,p.actor_name AS actorName,p.at,(SELECT v.reason FROM edu_payment_voids v WHERE v.payment_id=p.id) AS voidReason FROM edu_payments p`;
const safe = (n: number) => {
  if (!Number.isSafeInteger(n) || Math.abs(n) > 1e12)
    throw new Error("المبلغ تجاوز الحد الآمن");
  return n;
};
export class Education {
  constructor(
    readonly db: XzareDatabase,
    readonly identity: Identity,
  ) {}
  private row<T = any>(sql: string, ...a: any[]): T {
    return this.db.prepare(sql).get(...a) as T;
  }
  private rows<T = any>(sql: string, ...a: any[]): T[] {
    return this.db.prepare(sql).all(...a) as T[];
  }
  private version(x: any, v: unknown) {
    if (x && x.version !== v)
      throw new Error("البيانات تغيرت؛ حدّث العرض وأعد المحاولة");
    if (!x && v !== undefined) throw new Error("الإصدار يخص التعديل");
  }
  private manage(u: User) {
    if (!manager(u)) throw new Error("هذه العملية تحتاج مدير المركز");
  }
  private office(u: User) {
    if (!staff(u)) throw new Error("هذه العملية تخص الاستقبال والتحصيل");
  }
  private group(id: string, u: User) {
    const g = this.row(gq + " WHERE g.id=?", id);
    if (!g) throw new Error("المجموعة غير موجودة");
    if (
      !staff(u) &&
      !this.row(
        `SELECT id FROM edu_teachers WHERE id=? AND user_id=? AND active=1`,
        g.teacherId,
        u.id,
      )
    )
      throw new Error("هذه المجموعة غير مكلف بها");
    return g;
  }
  private student(id: string, u: User) {
    const s = this.row(sq + " WHERE id=?", id);
    if (!s) throw new Error("الطالب غير موجود");
    if (
      !staff(u) &&
      !this.row(
        `SELECT e.id FROM edu_enrollments e JOIN edu_groups g ON g.id=e.group_id JOIN edu_teachers t ON t.id=g.teacher_id WHERE e.student_id=? AND t.user_id=? AND t.active=1`,
        id,
        u.id,
      )
    )
      throw new Error("الطالب خارج مجموعاتك");
    return staff(u) ? s : this.publicStudent(s);
  }
  private publicStudent(s: any) {
    return {
      id: s.id,
      code: s.code,
      name: s.name,
      active: s.active,
      at: s.at,
      version: s.version,
    };
  }
  private enrollment(id: string, u: User) {
    this.office(u);
    const e = this.row(eq + " WHERE e.id=?", id);
    if (!e) throw new Error("الاشتراك غير موجود");
    return e;
  }
  private lesson(id: string, u: User) {
    const l = this.row(lq + " WHERE l.id=?", id);
    if (!l) throw new Error("الحصة غير موجودة");
    this.group(l.groupId, u);
    return l;
  }
  private exam(id: string, u: User) {
    const x = this.row(xq + " WHERE x.id=?", id);
    if (!x) throw new Error("الاختبار غير موجود");
    this.group(x.groupId, u);
    return x;
  }
  private events(type: string, id: string) {
    return this.rows(
      `SELECT id,action,reason,snapshot,actor_name AS actorName,at FROM edu_events WHERE entity_type=? AND entity_id=? ORDER BY at DESC,id DESC LIMIT 1000`,
      type,
      id,
    );
  }
  private event(
    type: string,
    id: string,
    a: string,
    reason: string,
    snapshot: unknown,
    u: User,
  ) {
    this.db
      .prepare(`INSERT INTO edu_events VALUES(?,?,?,?,?,?,?,?,?)`)
      .run(
        ulid(),
        type,
        id,
        a,
        reason,
        JSON.stringify(snapshot),
        u.id,
        u.name,
        Date.now(),
      );
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
      .prepare(`INSERT INTO edu_fee_ledger VALUES(?,?,?,?,?,?,?,?,?)`)
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
      );
  }
  private bump(id: string) {
    this.db
      .prepare(`UPDATE edu_enrollments SET version=version+1 WHERE id=?`)
      .run(id);
  }
  private payments(where = "", ...a: any[]) {
    return this.rows(pq + where, ...a).map((p) => ({
      ...p,
      student: JSON.parse(p.student),
      group: JSON.parse(p.group),
      business: JSON.parse(p.business),
    }));
  }
  private academicEnrollment(e: any) {
    const { fee, discount, balance, ...visible } = e;
    return visible;
  }
  state(u: User): EduState {
    const groups = this.rows(gq + " ORDER BY g.start_day DESC,g.name").filter(
      (g) =>
        staff(u) ||
        !!this.row(
          `SELECT id FROM edu_teachers WHERE id=? AND user_id=? AND active=1`,
          g.teacherId,
          u.id,
        ),
    );
    const gs = new Set(groups.map((g) => g.id));
    let enrollments = this.rows(eq + " ORDER BY e.at DESC").filter((e) =>
      gs.has(e.groupId),
    );
    const ss = new Set(enrollments.map((e) => e.studentId));
    const students = this.rows(sq + " ORDER BY name")
      .filter((s) => staff(u) || ss.has(s.id))
      .map((s) => (staff(u) ? s : this.publicStudent(s)));
    const settings = Object.fromEntries(
      this.rows<{ key: string; value: string }>(
        `SELECT key,value FROM settings`,
      )
        .filter((x) =>
          [
            "businessName",
            "phone",
            "address",
            "receiptFooter",
            "language",
            "currency",
          ].includes(x.key),
        )
        .map((x) => [x.key, x.value]),
    );
    return {
      user: u,
      settings,
      students,
      teachers: this.rows(tq + " ORDER BY name")
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
      courses: this.rows(cq + " ORDER BY name").filter(
        (c) => staff(u) || groups.some((g) => g.courseId === c.id),
      ),
      groups: groups.map((g) => {
        if (staff(u)) return g;
        const { fee, note, ...v } = g;
        return v;
      }),
      enrollments: staff(u)
        ? enrollments
        : enrollments.map((e) => this.academicEnrollment(e)),
      sessions: this.rows(lq + " ORDER BY l.day,l.start_minute").filter((l) =>
        gs.has(l.groupId),
      ),
      exams: this.rows(xq + " ORDER BY x.day DESC,x.at DESC").filter((x) =>
        gs.has(x.groupId),
      ),
      payments: staff(u) ? this.payments(" ORDER BY p.at DESC LIMIT 1000") : [],
      users:
        u.role === "admin"
          ? this.rows(
              `SELECT id,username,name,role,active FROM users ORDER BY name`,
            )
          : [],
      teacherAccounts: manager(u)
        ? this.rows(
            `SELECT id,username,name,role,active FROM users WHERE role='teacher' ORDER BY name`,
          )
        : [],
      audit:
        u.role === "admin"
          ? this.rows(
              `SELECT a.*,u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.at DESC LIMIT 300`,
            )
          : [],
    };
  }
  private get(action: string, id: string, u: User) {
    if (action === "edu.student.get") {
      const s = this.student(id, u);
      let es = this.rows(
        eq + " WHERE e.student_id=? ORDER BY e.at DESC",
        id,
      ).filter((e) => {
        try {
          this.group(e.groupId, u);
          return true;
        } catch {
          return false;
        }
      });
      return {
        student: s,
        enrollments: staff(u) ? es : es.map((e) => this.academicEnrollment(e)),
        events: staff(u) ? this.events("student", id) : [],
      };
    }
    if (action === "edu.group.get") {
      const g = this.group(id, u),
        es = this.rows(eq + " WHERE e.group_id=? ORDER BY s.name", id);
      const { fee, note, ...academic } = g;
      return {
        group: staff(u) ? g : academic,
        enrollments: staff(u) ? es : es.map((e) => this.academicEnrollment(e)),
        events: staff(u) ? this.events("group", id) : [],
      };
    }
    if (action === "edu.enrollment.get") {
      const e = this.enrollment(id, u);
      return {
        enrollment: e,
        ledger: this.rows(
          `SELECT id,kind,amount,reason,actor_name AS actorName,at FROM edu_fee_ledger WHERE enrollment_id=? ORDER BY at,id`,
          id,
        ),
        payments: this.payments(
          " WHERE p.enrollment_id=? ORDER BY p.at DESC",
          id,
        ),
        events: this.events("enrollment", id),
      };
    }
    if (action === "edu.session.get") {
      const session = this.lesson(id, u);
      return {
        session,
        roster: this.rows(
          `SELECT r.id,r.enrollment_id AS enrollmentId,r.student_id AS studentId,r.student_name AS studentName,r.student_code AS studentCode,a.status,COALESCE(a.note,'') AS note,a.at AS marked FROM edu_session_roster r LEFT JOIN edu_attendance a ON a.roster_id=r.id WHERE r.session_id=? ORDER BY r.student_name`,
          id,
        ),
        events: this.events("session", id),
      };
    }
    const exam = this.exam(id, u);
    return {
      exam,
      roster: this.rows(
        `SELECT r.id,r.enrollment_id AS enrollmentId,r.student_id AS studentId,r.student_name AS studentName,r.student_code AS studentCode,a.score,COALESCE(a.note,'') AS note,a.at AS marked FROM edu_exam_roster r LEFT JOIN edu_grades a ON a.roster_id=r.id WHERE r.exam_id=? ORDER BY r.student_name`,
        id,
      ),
      events: this.events("exam", id),
    };
  }
  private saveStudent(d: any, u: User) {
    this.office(u);
    const old = d.id ? this.student(d.id, u) : undefined;
    this.version(old, d.version);
    if (d.birthDay && d.birthDay > clinicToday())
      throw new Error("تاريخ الميلاد في المستقبل");
    const id = d.id ?? ulid();
    this.db
      .prepare(
        `INSERT INTO edu_students VALUES(?,?,?,?,?,?,?,?,?,?,?,0) ON CONFLICT(id) DO UPDATE SET code=excluded.code,name=excluded.name,phone=excluded.phone,guardian=excluded.guardian,guardian_phone=excluded.guardian_phone,birth_day=excluded.birth_day,level=excluded.level,note=excluded.note,active=excluded.active,version=edu_students.version+1`,
      )
      .run(
        id,
        d.code,
        d.name,
        d.phone,
        d.guardian,
        d.guardianPhone,
        d.birthDay,
        d.level,
        d.note,
        +d.active,
        Date.now(),
      );
    return id;
  }
  private saveTeacher(d: any, u: User) {
    this.manage(u);
    const old = d.id ? this.row(tq + " WHERE id=?", d.id) : undefined;
    if (d.id && !old) throw new Error("المدرس غير موجود");
    this.version(old, d.version);
    if (
      d.userId &&
      !this.row(
        `SELECT id FROM users WHERE id=? AND role='teacher' AND active=1`,
        d.userId,
      )
    )
      throw new Error("اختر حساب مدرس نشطًا");
    const id = d.id ?? ulid();
    this.db
      .prepare(
        `INSERT INTO edu_teachers VALUES(?,?,?,?,?,?,?, ?,0) ON CONFLICT(id) DO UPDATE SET code=excluded.code,name=excluded.name,phone=excluded.phone,note=excluded.note,user_id=excluded.user_id,active=excluded.active,version=edu_teachers.version+1`,
      )
      .run(
        id,
        d.code,
        d.name,
        d.phone,
        d.note,
        d.userId,
        +d.active,
        Date.now(),
      );
    return id;
  }
  private saveCourse(d: any, u: User) {
    this.manage(u);
    const old = d.id ? this.row(cq + " WHERE id=?", d.id) : undefined;
    if (d.id && !old) throw new Error("الدورة غير موجودة");
    this.version(old, d.version);
    const id = d.id ?? ulid();
    this.db
      .prepare(
        `INSERT INTO edu_courses VALUES(?,?,?,?,?,?,0) ON CONFLICT(id) DO UPDATE SET code=excluded.code,name=excluded.name,description=excluded.description,active=excluded.active,version=edu_courses.version+1`,
      )
      .run(id, d.code, d.name, d.description, +d.active, Date.now());
    return id;
  }
  private saveGroup(d: any, u: User) {
    this.manage(u);
    const old = d.id ? this.group(d.id, u) : undefined;
    this.version(old, d.version);
    if (
      !this.row(
        `SELECT id FROM edu_courses WHERE id=? AND active=1`,
        d.courseId,
      ) ||
      !this.row(
        `SELECT id FROM edu_teachers WHERE id=? AND active=1`,
        d.teacherId,
      )
    )
      throw new Error("اختر دورة ومدرسًا نشطين");
    if (old) {
      if (old.count > d.capacity)
        throw new Error("السعة أقل من عدد الطلاب الحالي");
      if (
        old.courseId !== d.courseId &&
        this.row(`SELECT id FROM edu_enrollments WHERE group_id=?`, old.id)
      )
        throw new Error("لا يمكن تغيير الدورة بعد تسجيل الطلاب");
      if (
        this.row(
          `SELECT id FROM edu_sessions WHERE group_id=? AND (day<? OR day>?) UNION ALL SELECT id FROM edu_exams WHERE group_id=? AND (day<? OR day>?)`,
          old.id,
          d.startDay,
          d.endDay,
          old.id,
          d.startDay,
          d.endDay,
        )
      )
        throw new Error("الفترة تستبعد حصصًا أو اختبارات محفوظة");
      if (old.teacherId !== d.teacherId) {
        const conflicts = this.rows(
          `SELECT l.id,l.day,l.start_minute AS startMinute,l.duration FROM edu_sessions l WHERE l.group_id=? AND l.status='scheduled'`,
          old.id,
        );
        for (const l of conflicts)
          this.overlap(
            d.teacherId,
            old.id,
            l.day,
            l.startMinute,
            l.duration,
            l.id,
          );
      }
    }
    const id = d.id ?? ulid();
    this.db
      .prepare(
        `INSERT INTO edu_groups VALUES(?,?,?,?,?,?,?,?,?,?,?, ?,0) ON CONFLICT(id) DO UPDATE SET code=excluded.code,name=excluded.name,course_id=excluded.course_id,teacher_id=excluded.teacher_id,start_day=excluded.start_day,end_day=excluded.end_day,fee=excluded.fee,capacity=excluded.capacity,note=excluded.note,active=excluded.active,version=edu_groups.version+1`,
      )
      .run(
        id,
        d.code,
        d.name,
        d.courseId,
        d.teacherId,
        d.startDay,
        d.endDay,
        d.fee,
        d.capacity,
        d.note,
        +d.active,
        Date.now(),
      );
    return id;
  }
  private enroll(d: any, u: User) {
    this.office(u);
    const s = this.student(d.studentId, u),
      g = this.group(d.groupId, u);
    this.version(s, d.studentVersion);
    this.version(g, d.groupVersion);
    if (!s.active || !g.active || g.endDay < clinicToday())
      throw new Error("الطالب أو المجموعة متوقف أو انتهت الفترة");
    if (g.count >= g.capacity) throw new Error("المجموعة ممتلئة");
    if (d.discount > g.fee) throw new Error("الخصم أكبر من رسوم المجموعة");
    const id = ulid();
    this.db
      .prepare(`INSERT INTO edu_enrollments VALUES(?,?,?,?,?,?,?,'active',?,0)`)
      .run(
        id,
        s.id,
        g.id,
        JSON.stringify({ name: s.name, code: s.code }),
        JSON.stringify({
          name: g.name,
          code: g.code,
          courseName: g.courseName,
        }),
        g.fee,
        d.discount,
        Date.now(),
      );
    this.ledger(
      id,
      "charge",
      g.fee - d.discount,
      null,
      "رسوم الاشتراك وقت التسجيل",
      u,
    );
    return id;
  }
  private cancelEnrollment(d: any, u: User) {
    this.manage(u);
    const e = this.enrollment(d.id, u);
    this.version(e, d.version);
    if (
      e.status !== "active" ||
      this.row(
        `SELECT id FROM edu_fee_ledger WHERE enrollment_id=? AND kind<>'charge'`,
        e.id,
      ) ||
      this.row(
        `SELECT id FROM edu_session_roster WHERE enrollment_id=? UNION ALL SELECT id FROM edu_exam_roster WHERE enrollment_id=?`,
        e.id,
        e.id,
      )
    )
      throw new Error(
        "الإلغاء متاح قبل التحصيل وتسجيل الطالب في حصة أو اختبار",
      );
    this.db
      .prepare(
        `UPDATE edu_enrollments SET status='cancelled',version=version+1 WHERE id=?`,
      )
      .run(e.id);
    this.ledger(e.id, "cancel", -e.balance, null, d.reason, u);
    return e.id;
  }
  private collect(d: any, u: User) {
    this.office(u);
    const e = this.enrollment(d.enrollmentId, u);
    this.version(e, d.enrollmentVersion);
    if (e.status !== "active" || d.amount > e.balance)
      throw new Error("المبلغ أكبر من المستحق أو الاشتراك ملغى");
    const id = ulid(),
      number =
        "EDU-" +
        String(
          this.row<{ n: number }>(`SELECT count(*) n FROM edu_payments`).n + 1,
        ).padStart(6, "0"),
      s = this.student(e.studentId, u),
      g = this.group(e.groupId, u);
    const business = Object.fromEntries(
      this.rows<{ key: string; value: string }>(
        `SELECT key,value FROM settings`,
      )
        .filter((x) =>
          ["businessName", "phone", "address", "receiptFooter"].includes(x.key),
        )
        .map((x) => [x.key, x.value]),
    );
    this.db
      .prepare(`INSERT INTO edu_payments VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(
        id,
        number,
        e.id,
        d.amount,
        d.method,
        d.reference,
        JSON.stringify({ name: s.name, code: s.code }),
        JSON.stringify({
          name: g.name,
          code: g.code,
          courseName: g.courseName,
        }),
        JSON.stringify(business),
        u.id,
        u.name,
        Date.now(),
      );
    this.ledger(e.id, "payment", -d.amount, id, d.reference, u);
    this.bump(e.id);
    return id;
  }
  private voidPayment(d: any, u: User) {
    this.manage(u);
    const p = this.row(`SELECT * FROM edu_payments WHERE id=?`, d.id);
    if (
      !p ||
      this.row(`SELECT id FROM edu_payment_voids WHERE payment_id=?`, d.id)
    )
      throw new Error("الإيصال غير موجود أو ملغى بالفعل");
    const id = ulid();
    this.db
      .prepare(`INSERT INTO edu_payment_voids VALUES(?,?,?,?,?,?)`)
      .run(id, p.id, d.reason, u.id, u.name, Date.now());
    const e = this.enrollment(p.enrollment_id, u);
    safe(e.balance + p.amount);
    this.ledger(e.id, "void", p.amount, p.id, d.reason, u);
    this.bump(e.id);
    return { id, entityId: e.id };
  }
  private credit(d: any, u: User) {
    this.manage(u);
    const e = this.enrollment(d.enrollmentId, u);
    this.version(e, d.enrollmentVersion);
    if (e.status !== "active" || d.amount > e.balance)
      throw new Error("التخفيض أكبر من المستحق");
    const id = ulid();
    this.ledger(e.id, "credit", -d.amount, id, d.reason, u);
    this.bump(e.id);
    return id;
  }
  private overlap(
    teacherId: string,
    groupId: string,
    day: string,
    start: number,
    duration: number,
    except: string | null,
  ) {
    if (
      this.row(
        `SELECT l.id FROM edu_sessions l JOIN edu_groups g ON g.id=l.group_id WHERE l.status='scheduled' AND l.day=? AND g.teacher_id=? AND l.id<>COALESCE(?,'') AND l.group_id<>? AND l.start_minute<? AND l.start_minute+l.duration>?`,
        day,
        teacherId,
        except,
        groupId,
        start + duration,
        start,
      )
    )
      throw new Error("موعد المدرس يتداخل مع مجموعة أخرى");
    if (
      this.row(
        `SELECT id FROM edu_sessions WHERE status='scheduled' AND day=? AND group_id=? AND id<>COALESCE(?,'') AND start_minute<? AND start_minute+duration>?`,
        day,
        groupId,
        except,
        start + duration,
        start,
      )
    )
      throw new Error("موعد الحصة يتداخل مع حصة المجموعة");
  }
  private validAcademicGroup(g: any, day: string) {
    if (!g.active || day < g.startDay || day > g.endDay)
      throw new Error("موعد خارج فترة المجموعة أو المجموعة متوقفة");
    if (
      !this.row(
        `SELECT id FROM edu_teachers WHERE id=? AND active=1`,
        g.teacherId,
      )
    )
      throw new Error("المدرس متوقف");
  }
  private roster(groupId: string) {
    const es = this.rows(
      eq + ` WHERE e.group_id=? AND e.status='active' ORDER BY s.name`,
      groupId,
    );
    if (!es.length) throw new Error("سجل طلابًا في المجموعة أولًا");
    return es;
  }
  private saveSession(d: any, u: User) {
    const g = this.group(d.groupId, u);
    this.validAcademicGroup(g, d.day);
    const old = d.id ? this.lesson(d.id, u) : undefined;
    this.version(old, d.version);
    if (old && (old.groupId !== g.id || old.status !== "scheduled"))
      throw new Error("الحصة تخص مجموعة أخرى أو ملغاة");
    if (
      old &&
      this.row(
        `SELECT a.roster_id FROM edu_attendance a JOIN edu_session_roster r ON r.id=a.roster_id WHERE r.session_id=?`,
        old.id,
      )
    )
      throw new Error("الحصة لها حضور محفوظ؛ وقتها وقائمتها ثابتان");
    this.overlap(
      g.teacherId,
      g.id,
      d.day,
      d.startMinute,
      d.duration,
      d.id ?? null,
    );
    const id = d.id ?? ulid();
    this.db
      .prepare(
        `INSERT INTO edu_sessions VALUES(?,?,?,?,?,?,?,'scheduled',?,0) ON CONFLICT(id) DO UPDATE SET day=excluded.day,start_minute=excluded.start_minute,duration=excluded.duration,title=excluded.title,note=excluded.note,version=edu_sessions.version+1`,
      )
      .run(
        id,
        g.id,
        d.day,
        d.startMinute,
        d.duration,
        d.title,
        d.note,
        Date.now(),
      );
    if (!old)
      for (const e of this.roster(g.id))
        this.db
          .prepare(`INSERT INTO edu_session_roster VALUES(?,?,?,?,?,?)`)
          .run(ulid(), id, e.id, e.studentId, e.studentName, e.studentCode);
    return id;
  }
  private cancelSession(d: any, u: User) {
    this.manage(u);
    const l = this.lesson(d.id, u);
    this.version(l, d.version);
    if (l.status === "cancelled") throw new Error("الحصة ملغاة بالفعل");
    if (
      this.row(
        `SELECT a.roster_id FROM edu_attendance a JOIN edu_session_roster r ON r.id=a.roster_id WHERE r.session_id=?`,
        l.id,
      )
    )
      throw new Error("الحصة لها حضور؛ لا يمكن إلغاء سجل تم تنفيذه");
    this.db
      .prepare(
        `UPDATE edu_sessions SET status='cancelled',version=version+1 WHERE id=?`,
      )
      .run(l.id);
    return l.id;
  }
  private reviewedRows(rows: any[], input: any[]) {
    const expected = new Set(rows.map((r) => r.enrollment_id)),
      actual = new Set(input.map((r) => r.enrollmentId));
    if (
      actual.size !== input.length ||
      actual.size !== expected.size ||
      [...actual].some((x) => !expected.has(x))
    )
      throw new Error(
        "راجع قائمة الطلاب كاملة؛ يوجد طالب مكرر أو خارج القائمة",
      );
  }
  private attendance(d: any, u: User) {
    const l = this.lesson(d.sessionId, u);
    this.version(l, d.version);
    if (l.status === "cancelled" || l.day > clinicToday())
      throw new Error("لا يسجل حضور لحصة ملغاة أو يوم لم يأت");
    const rows = this.rows(
      `SELECT * FROM edu_session_roster WHERE session_id=?`,
      l.id,
    );
    this.reviewedRows(rows, d.marks);
    for (const m of d.marks) {
      const r = rows.find((x) => x.enrollment_id === m.enrollmentId);
      this.db
        .prepare(
          `INSERT INTO edu_attendance VALUES(?,?,?,?,?) ON CONFLICT(roster_id) DO UPDATE SET status=excluded.status,note=excluded.note,actor_id=excluded.actor_id,at=excluded.at`,
        )
        .run(r.id, m.status, m.note, u.id, Date.now());
    }
    this.db
      .prepare(`UPDATE edu_sessions SET version=version+1 WHERE id=?`)
      .run(l.id);
    return l.id;
  }
  private addExam(d: any, u: User) {
    const g = this.group(d.groupId, u);
    this.validAcademicGroup(g, d.day);
    const id = ulid();
    this.db
      .prepare(`INSERT INTO edu_exams VALUES(?,?,?,?,?,?,'draft',?,0)`)
      .run(id, g.id, d.day, d.title, d.maxScore, d.note, Date.now());
    for (const e of this.roster(g.id))
      this.db
        .prepare(`INSERT INTO edu_exam_roster VALUES(?,?,?,?,?,?)`)
        .run(ulid(), id, e.id, e.studentId, e.studentName, e.studentCode);
    return id;
  }
  private grades(d: any, u: User) {
    const x = this.exam(d.examId, u);
    this.version(x, d.version);
    if (x.day > clinicToday()) throw new Error("الاختبار لم يأت موعده");
    if (x.status === "published" && !manager(u))
      throw new Error("تصحيح درجات منشورة يحتاج المدير وسببًا");
    if (x.status === "published" && !d.publish)
      throw new Error("لا يمكن إعادة الدرجات المنشورة إلى مسودة");
    const rows = this.rows(
      `SELECT * FROM edu_exam_roster WHERE exam_id=?`,
      x.id,
    );
    this.reviewedRows(rows, d.grades);
    for (const g of d.grades) {
      if (g.score !== null && g.score > x.maxScore)
        throw new Error("الدرجة أكبر من الدرجة النهائية");
      if (d.publish && g.score === null && !g.note.trim())
        throw new Error("اكتب سبب عدم تسجيل درجة الطالب");
      const r = rows.find((x) => x.enrollment_id === g.enrollmentId);
      this.db
        .prepare(
          `INSERT INTO edu_grades VALUES(?,?,?,?,?) ON CONFLICT(roster_id) DO UPDATE SET score=excluded.score,note=excluded.note,actor_id=excluded.actor_id,at=excluded.at`,
        )
        .run(r.id, g.score, g.note, u.id, Date.now());
    }
    this.db
      .prepare(`UPDATE edu_exams SET status=?,version=version+1 WHERE id=?`)
      .run(d.publish ? "published" : "draft", x.id);
    return x.id;
  }
  report(d: any, u: User): EduReport {
    const s = this.state(u),
      b = clinicDayBounds(d.from, d.to);
    const inRange = (day: string) => day >= d.from && day <= d.to;
    let finance = null;
    if (staff(u)) {
      const sums = this.row(
        `SELECT COALESCE(sum(CASE WHEN kind IN('payment','void') THEN -amount ELSE 0 END),0) AS netCollected,COALESCE(sum(CASE WHEN kind='charge' THEN amount ELSE 0 END),0) AS charges,COALESCE(sum(CASE WHEN kind IN('credit','cancel') THEN -amount ELSE 0 END),0) AS credits,COALESCE(sum(CASE WHEN kind='void' THEN amount ELSE 0 END),0) AS voided FROM edu_fee_ledger WHERE at>=? AND at<?`,
        b.lo,
        b.hi,
      );
      finance = {
        ...sums,
        outstanding: safe(
          this.row(`SELECT COALESCE(sum(amount),0) n FROM edu_fee_ledger`).n,
        ),
      };
      for (const v of Object.values(finance!)) safe(v as number);
    }
    return {
      from: d.from,
      to: d.to,
      finance,
      attendance: s.sessions.filter((l) => inRange(l.day)),
      exams: s.exams.filter((x) => inRange(x.day)),
      payments: staff(u)
        ? this.payments(
            " WHERE p.at>=? AND p.at<? ORDER BY p.at DESC",
            b.lo,
            b.hi,
          )
        : [],
      enrollmentCount: s.enrollments.filter((e) => e.at >= b.lo && e.at < b.hi)
        .length,
    };
  }
  call(action: string, input: unknown, u: User) {
    if (!["admin", "manager", "cashier", "teacher"].includes(u.role))
      throw new Error("ليس لديك صلاحية التعليم");
    if (
      ["edu.session.save", "edu.exam.add", "edu.grades.save"].includes(
        action,
      ) &&
      u.role === "cashier"
    )
      throw new Error("هذه العملية تخص المدرس أو المدير");
    const schema = eduSchemas[action as keyof typeof eduSchemas];
    if (!schema) throw new Error("العملية غير متاحة");
    const d = schema.parse(input) as any;
    if (action === "edu.state") return this.state(u);
    if (action === "edu.report") return this.report(d, u);
    if (action.endsWith(".get")) return this.get(action, d.id, u);
    return this.db.transaction(() => {
      const h = fingerprint(d),
        prev = this.row(
          `SELECT * FROM commands WHERE client_txn_id=?`,
          d.clientTxnId,
        );
      if (prev) {
        if (
          prev.action !== action ||
          prev.user_id !== u.id ||
          prev.request_hash !== h
        )
          throw new Error("معرف العملية مستخدم لبيانات مختلفة");
        return JSON.parse(prev.result);
      }
      let id: string,
        type: string,
        entityId: string,
        snapshot: unknown = {};
      if (action === "edu.student.save") {
        id = this.saveStudent(d, u);
        type = "student";
        entityId = id;
        snapshot = this.student(id, u);
      } else if (action === "edu.teacher.save") {
        id = this.saveTeacher(d, u);
        type = "teacher";
        entityId = id;
      } else if (action === "edu.course.save") {
        id = this.saveCourse(d, u);
        type = "course";
        entityId = id;
      } else if (action === "edu.group.save") {
        id = this.saveGroup(d, u);
        type = "group";
        entityId = id;
        snapshot = this.group(id, u);
      } else if (action === "edu.enrollment.add") {
        id = this.enroll(d, u);
        type = "enrollment";
        entityId = id;
        snapshot = this.enrollment(id, u);
      } else if (action === "edu.enrollment.cancel") {
        id = this.cancelEnrollment(d, u);
        type = "enrollment";
        entityId = id;
      } else if (action === "edu.payment.post") {
        id = this.collect(d, u);
        type = "enrollment";
        entityId = d.enrollmentId;
        snapshot = { paymentId: id, amount: d.amount };
      } else if (action === "edu.payment.void") {
        const v = this.voidPayment(d, u);
        id = v.id;
        type = "enrollment";
        entityId = v.entityId;
        snapshot = { paymentId: d.id };
      } else if (action === "edu.credit.post") {
        id = this.credit(d, u);
        type = "enrollment";
        entityId = d.enrollmentId;
        snapshot = { amount: d.amount };
      } else if (action === "edu.session.save") {
        id = this.saveSession(d, u);
        type = "session";
        entityId = id;
        snapshot = this.lesson(id, u);
      } else if (action === "edu.session.cancel") {
        id = this.cancelSession(d, u);
        type = "session";
        entityId = id;
      } else if (action === "edu.attendance.save") {
        id = this.attendance(d, u);
        type = "session";
        entityId = id;
        snapshot = d.marks;
      } else if (action === "edu.exam.add") {
        id = this.addExam(d, u);
        type = "exam";
        entityId = id;
        snapshot = this.exam(id, u);
      } else if (action === "edu.grades.save") {
        id = this.grades(d, u);
        type = "exam";
        entityId = id;
        snapshot = d.grades;
      } else throw new Error("العملية غير متاحة");
      this.event(type, entityId, action, d.reason ?? "", snapshot, u);
      this.identity.audit(u.id, action, entityId);
      const result = { id };
      this.db
        .prepare(`INSERT INTO commands VALUES(?,?,?,?,?)`)
        .run(d.clientTxnId, action, u.id, h, JSON.stringify(result));
      return result;
    })();
  }
}
