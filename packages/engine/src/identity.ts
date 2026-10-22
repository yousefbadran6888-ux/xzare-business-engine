import { hash, verify } from '@node-rs/argon2'
import { performance } from 'node:perf_hooks'
import { createHash, randomBytes } from 'node:crypto'
import { ulid } from '@xzare/core'
import type { XzareDatabase } from '@xzare/db'
import type { User, Role } from './types.js'
import { schemas, validated } from './validation.js'

const hashOptions = {
  algorithm: 2 as const,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
}
const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex')
export class Identity {
  private readonly dummy: Promise<string>
  private authBusy = false
  private readonly sessionActivity = new Map<string, number>()
  constructor(
    readonly db: XzareDatabase,
    readonly allowKitchen = false,
    private readonly clock: () => number = () => performance.now(),
    readonly allowDoctor = false,
    readonly allowTechnician = false,
    readonly allowHR = false,
    readonly allowCRM = false,
    readonly allowEducation = false,
    readonly allowGym = false,
    readonly allowSalon = false,
  ) {
    this.dummy = hash(randomBytes(32), hashOptions)
  }
  audit(userId: string | null, action: string, entityId: string) {
    this.db
      .prepare('INSERT INTO audit_log VALUES(?,?,?,?,?)')
      .run(ulid(), userId, action, entityId, Date.now())
  }
  require(
    token: string | null,
    minimum: Role = this.allowKitchen ? 'kitchen' : 'cashier',
  ): User {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token))
      throw new Error('سجّل الدخول للمتابعة')
    const key = digest(token),
      last = this.sessionActivity.get(key),
      now = this.clock()
    if (last === undefined || now < last || now - last >= 600000) {
      this.sessionActivity.delete(key)
      this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(key)
      throw new Error('انتهت الجلسة؛ سجّل الدخول مرة أخرى')
    }
    const user = this.db
      .prepare(
        'SELECT u.id,u.username,u.name,u.role,u.active FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1',
      )
      .get(digest(token), Date.now()) as User | undefined
    if (!user) throw new Error('انتهت الجلسة؛ سجّل الدخول مرة أخرى')
    if (
      {
        admin: 3,
        manager: 2,
        cashier: 1,
        kitchen: 0,
        doctor: 1,
        technician: 1,
        hr: 1,
        payroll: 1,
        teacher: 1,
        trainer: 1,
        stylist: 1,
      }[user.role] <
      {
        admin: 3,
        manager: 2,
        cashier: 1,
        kitchen: 0,
        doctor: 1,
        technician: 1,
        hr: 1,
        payroll: 1,
        teacher: 1,
        trainer: 1,
        stylist: 1,
      }[minimum]
    )
      throw new Error('ليس لديك صلاحية لتنفيذ هذه العملية')
    return user
  }
  activity(token: string | null) {
    this.require(token)
    this.sessionActivity.set(digest(token!), this.clock())
    return { active: true }
  }
  /** Only used after failed restore returns the original DB; retain original deadlines. */
  recoverSessionsFrom(source: Identity) {
    for (const row of this.db
      .prepare('SELECT token_hash FROM sessions WHERE expires_at>?')
      .all(Date.now()) as { token_hash: string }[]) {
      const last = source.sessionActivity.get(row.token_hash)
      if (last !== undefined && this.clock() - last < 600000)
        this.sessionActivity.set(row.token_hash, last)
    }
  }
  private session(userId: string) {
    const token = randomBytes(32).toString('hex')
    this.db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now())
    this.db
      .prepare('INSERT INTO sessions VALUES(?,?,?)')
      .run(digest(token), userId, Date.now() + 8 * 60 * 60 * 1000)
    this.sessionActivity.set(digest(token), this.clock())
    for (const [key, last] of this.sessionActivity) {
      if (this.clock() - last >= 600000) {
        this.sessionActivity.delete(key)
        this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(key)
      }
    }
    return { token }
  }
  async setup(input: unknown) {
    const data = validated(schemas.setup, input)
    if (this.db.prepare('SELECT id FROM users LIMIT 1').get())
      throw new Error('تم إعداد البرنامج بالفعل')
    const encoded = await hash(data.password, hashOptions)
    return this.db.transaction(() => {
      if (this.db.prepare('SELECT id FROM users LIMIT 1').get())
        throw new Error('تم إعداد البرنامج بالفعل')
      const uid = ulid()
      this.db
        .prepare(
          'INSERT INTO users(id,username,name,password_hash,role) VALUES(?,?,?,?,?)',
        )
        .run(uid, data.username, data.name, encoded, 'admin')
      this.db
        .prepare('INSERT INTO warehouses VALUES(?,?)')
        .run(ulid(), 'المخزن الرئيسي')
      const defaults = {
        businessName: data.businessName,
        phone: '',
        address: '',
        currency: 'EGP',
        language: 'ar',
        receiptFooter: '',
        taxBps: '0',
        trialStarted: String(Date.now()),
        clockHighWater: String(Date.now()),
      }
      for (const [key, value] of Object.entries(defaults))
        this.db.prepare('INSERT INTO settings VALUES(?,?)').run(key, value)
      this.audit(uid, 'setup', uid)
      return this.session(uid)
    })()
  }
  async login(input: unknown) {
    const data = validated(schemas.login, input)
    if (this.authBusy) throw new Error('انتظر انتهاء محاولة تسجيل الدخول')
    const key = digest(data.username.toLowerCase())
    const attempt = this.db
      .prepare('SELECT failures,locked_until FROM auth_attempts WHERE key=?')
      .get(key) as { failures: number; locked_until: number } | undefined
    if (attempt && attempt.locked_until > Date.now())
      throw new Error('محاولات كثيرة؛ حاول مرة أخرى بعد 15 دقيقة')
    this.authBusy = true
    try {
      const user = this.db
        .prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE')
        .get(data.username) as (User & { password_hash: string }) | undefined
      const valid = await verify(
        user?.password_hash ?? (await this.dummy),
        data.password,
      )
      const current = user
        ? (this.db
            .prepare('SELECT password_hash,active FROM users WHERE id=?')
            .get(user.id) as
            { password_hash: string; active: number } | undefined)
        : undefined
      if (
        !user ||
        !valid ||
        !current?.active ||
        current.password_hash !== user.password_hash
      ) {
        const failures =
          (attempt?.locked_until && attempt.locked_until <= Date.now()
            ? 0
            : (attempt?.failures ?? 0)) + 1
        this.db
          .prepare(
            'INSERT INTO auth_attempts VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET failures=excluded.failures,locked_until=excluded.locked_until',
          )
          .run(key, failures, failures >= 5 ? Date.now() + 15 * 60 * 1000 : 0)
        this.audit(null, 'login.failed', 'authentication')
        throw new Error('اسم المستخدم أو كلمة المرور غير صحيحة')
      }
      this.db.prepare('DELETE FROM auth_attempts WHERE key=?').run(key)
      this.audit(user.id, 'login', user.id)
      return this.session(user.id)
    } finally {
      this.authBusy = false
    }
  }
  logout(token: string | null) {
    if (token) {
      this.db
        .prepare('DELETE FROM sessions WHERE token_hash=?')
        .run(digest(token))
      this.sessionActivity.delete(digest(token))
    }
    return { loggedOut: true }
  }
  async saveUser(token: string | null, input: unknown) {
    const actor = this.require(token, 'admin'),
      data = validated(schemas['user.save'], input)
    if (data.role === 'stylist' && !this.allowSalon)
      throw Error('هذا الدور خاص بالصالون')
    if (
      this.allowSalon &&
      !['admin', 'manager', 'cashier', 'stylist'].includes(data.role)
    )
      throw Error('الدور غير متاح في الصالون')
    if (data.role === 'trainer' && !this.allowGym)
      throw new Error('هذا الدور خاص بالجيم')
    if (
      this.allowGym &&
      !['admin', 'manager', 'cashier', 'trainer'].includes(data.role)
    )
      throw new Error('الدور غير متاح في الجيم')
    if (data.role === 'teacher' && !this.allowEducation)
      throw new Error('هذا الدور خاص بالتعليم')
    if (
      this.allowEducation &&
      !['admin', 'manager', 'cashier', 'teacher'].includes(data.role)
    )
      throw new Error('الدور غير متاح في التعليم')
    if (this.allowCRM && !['admin', 'manager', 'cashier'].includes(data.role))
      throw new Error('اختر صلاحية CRM')
    if (['hr', 'payroll'].includes(data.role) && !this.allowHR)
      throw new Error('حساب الموارد البشرية متاح في برنامج HR فقط')
    if (
      this.allowHR &&
      !['admin', 'manager', 'hr', 'payroll'].includes(data.role)
    )
      throw new Error('اختر صلاحية موارد بشرية')
    if (data.role === 'technician' && !this.allowTechnician)
      throw new Error('حساب الفني متاح في برنامج المعامل فقط')
    if (data.role === 'doctor' && !this.allowDoctor)
      throw new Error('حساب الطبيب متاح في برنامج العيادات فقط')
    if (data.role === 'kitchen' && !this.allowKitchen)
      throw new Error('حساب المطبخ متاح في برنامج المطاعم فقط')
    if (!data.id && !data.password)
      throw new Error('كلمة المرور مطلوبة للحساب الجديد')
    const encoded = data.password
      ? await hash(data.password, hashOptions)
      : null
    // Recheck permissions after the asynchronous hash, before starting a synchronous transaction.
    this.require(token, 'admin')
    return this.db.transaction(() => {
      const existing = data.id
        ? (this.db.prepare('SELECT * FROM users WHERE id=?').get(data.id) as
            User | undefined)
        : undefined
      if (data.id && !existing) throw new Error('الحساب غير موجود')
      if (
        existing?.active &&
        existing.role === 'admin' &&
        (!data.active || data.role !== 'admin')
      ) {
        const count = this.db
          .prepare(
            "SELECT count(*) AS n FROM users WHERE active=1 AND role='admin'",
          )
          .get() as { n: number }
        if (count.n <= 1) throw new Error('لا يمكن تعطيل آخر مسؤول للبرنامج')
      }
      const uid = data.id ?? ulid()
      if (existing)
        this.db
          .prepare(
            'UPDATE users SET username=?,name=?,role=?,active=?,password_hash=COALESCE(?,password_hash) WHERE id=?',
          )
          .run(
            data.username,
            data.name,
            data.role,
            Number(data.active),
            encoded,
            uid,
          )
      else
        this.db
          .prepare(
            'INSERT INTO users(id,username,name,password_hash,role,active) VALUES(?,?,?,?,?,?)',
          )
          .run(
            uid,
            data.username,
            data.name,
            encoded,
            data.role,
            Number(data.active),
          )
      this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(uid)
      this.audit(actor.id, 'user.save', uid)
      return { id: uid }
    })()
  }
  async checkPassword(token: string | null, password: string) {
    const user = this.require(token)
    const row = this.db
      .prepare('SELECT password_hash FROM users WHERE id=?')
      .get(user.id) as {
      password_hash: string
    }
    if (!(await verify(row.password_hash, password)))
      throw new Error('كلمة المرور الحالية غير صحيحة')
    this.require(token)
    const current = this.db
      .prepare('SELECT password_hash FROM users WHERE id=?')
      .get(user.id) as {
      password_hash: string
    }
    if (current.password_hash !== row.password_hash)
      throw new Error('تغيّرت كلمة المرور؛ سجّل الدخول مرة أخرى')
    return user
  }
  async changePassword(token: string | null, input: unknown) {
    const data = validated(schemas['password.change'], input),
      user = await this.checkPassword(token, data.current)
    const encoded = await hash(data.password, hashOptions)
    this.require(token)
    this.db.transaction(() => {
      this.db
        .prepare('UPDATE users SET password_hash=? WHERE id=?')
        .run(encoded, user.id)
      this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id)
      this.audit(user.id, 'password.change', user.id)
    })()
    return { loggedOut: true }
  }
}
