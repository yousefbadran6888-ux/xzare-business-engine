import { estateActions } from './real-estate-validation.js'
import { hotelActions } from './hotel-validation.js'
import { salonActions } from './salon-validation.js'
import { gymActions } from './gym-validation.js'
import { eduActions } from './education-validation.js'
import { crmActions } from './crm-validation.js'
import { hrActions } from './hr-validation.js'
import { pharmacyActions } from './pharmacy-validation.js'
import { laboratoryActions } from './laboratory-validation.js'
import { clinicActions } from './clinic-validation.js'
import { serviceCenterActions } from './service-center-validation.js'
import { openDatabase, type XzareDatabase, type ProductKind } from '@xzare/db'
import { workshopActions } from './workshop-validation.js'
import { manufacturingActions } from './manufacturing-validation.js'
import { inventoryActions } from './inventory-validation.js'
import { accountingActions } from './accounting-validation.js'
import { restaurantActions } from './restaurant-validation.js'
import { BusinessEngine } from './service.js'
import { createBackup, validateBackup } from './backup.js'
import { verifyLicense } from './license.js'
import { mkdirSync, renameSync, unlinkSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { OnlineLicense } from './online-license.js'

export const actions = new Set([
  'auth.status',
  'setup',
  'login',
  'logout',
  'state',
  'password.change',
  'session.activity',
  'user.save',
  'settings.save',
  'product.save',
  'product.barcodeCheck',
  'product.archive',
  'party.save',
  'stock.adjust',
  'stock.reconcile',
  'shift.open',
  'shift.close',
  'cash.add',
  'expense.add',
  'hold.save',
  'hold.remove',
  'invoice.post',
  'invoice.get',
  'invoice.pay',
  'invoice.return',
  'barcode.lookup',
  'product.barcodeCheck',
  'report.get',
  'license.status',
  'license.activate',
  'license.renew',
])
export function actionsFor(product: ProductKind): Set<string> {
  return new Set([...domainActionsFor(product), 'boot.status', 'license.offline.export', 'license.offline.import'])
}
function domainActionsFor(product: ProductKind): Set<string> {
  if (product === 'real-estate')
    return new Set([
      'auth.status',
      'setup',
      'login',
      'logout',
      'session.activity',
      'password.change',
      'user.save',
      'settings.save',
      'backup.create',
      'backup.restore',
      'license.status',
      'license.activate',
      'license.renew',
      ...estateActions,
    ])
  if (product === 'hotel')
    return new Set([
      'auth.status',
      'setup',
      'login',
      'logout',
      'session.activity',
      'password.change',
      'user.save',
      'settings.save',
      'backup.create',
      'backup.restore',
      'license.status',
      'license.activate',
      'license.renew',
      ...hotelActions,
    ])
  if (product === 'salon')
    return new Set([
      'auth.status',
      'setup',
      'login',
      'logout',
      'session.activity',
      'password.change',
      'user.save',
      'settings.save',
      'backup.create',
      'backup.restore',
      'license.status',
      'license.activate',
      'license.renew',
      ...salonActions,
    ])
  if (product === 'gym')
    return new Set([
      'auth.status',
      'setup',
      'login',
      'logout',
      'password.change',
      'session.activity',
      'user.save',
      'settings.save',
      'license.status',
      'license.activate',
      'license.renew',
      ...gymActions,
    ])
  if (product === 'education')
    return new Set([
      'auth.status',
      'setup',
      'login',
      'logout',
      'password.change',
      'session.activity',
      'user.save',
      'settings.save',
      'license.status',
      'license.activate',
      'license.renew',
      ...eduActions,
    ])
  if (product === 'crm')
    return new Set([
      'auth.status',
      'setup',
      'login',
      'logout',
      'password.change',
      'session.activity',
      'user.save',
      'settings.save',
      'license.status',
      'license.activate',
      'license.renew',
      ...crmActions,
    ])
  if (product === 'hr')
    return new Set([
      'auth.status',
      'setup',
      'login',
      'logout',
      'password.change',
      'session.activity',
      'user.save',
      'settings.save',
      'license.status',
      'license.activate',
      'license.renew',
      ...hrActions,
    ])
  if (product === 'pharmacy')
    return new Set([
      'auth.status',
      'setup',
      'login',
      'logout',
      'password.change',
      'session.activity',
      'user.save',
      'settings.save',
      'license.status',
      'license.activate',
      'license.renew',
      ...pharmacyActions,
    ])
  if (product === 'laboratory')
    return new Set([
      'auth.status',
      'setup',
      'login',
      'logout',
      'password.change',
      'session.activity',
      'user.save',
      'settings.save',
      'license.status',
      'license.activate',
      'license.renew',
      ...laboratoryActions,
    ])
  if (product === 'clinic')
    return new Set([
      'auth.status',
      'setup',
      'login',
      'logout',
      'password.change',
      'session.activity',
      'user.save',
      'settings.save',
      'license.status',
      'license.activate',
      'license.renew',
      ...clinicActions,
    ])
  if (product === 'service-center')
    return new Set([...actionsFor('inventory'), ...serviceCenterActions])
  if (product === 'workshop') return new Set([...actionsFor('inventory'), ...workshopActions])
  if (product === 'manufacturing')
    return new Set([...actionsFor('inventory'), ...manufacturingActions])
  if (product === 'inventory')
    return new Set([
      'auth.status',
      'setup',
      'login',
      'logout',
      'password.change',
      'session.activity',
      'user.save',
      'settings.save',
      'product.save',
      'product.archive',
      'product.barcodeCheck',
      'barcode.lookup',
      'license.status',
      'license.activate',
      'license.renew',
      ...inventoryActions,
    ])
  if (product === 'accounting')
    return new Set([
      'auth.status',
      'setup',
      'login',
      'logout',
      'password.change',
      'session.activity',
      'user.save',
      'settings.save',
      'license.status',
      'license.activate',
      'license.renew',
      ...accountingActions,
    ])
  return new Set([...actions, ...(product === 'restaurant' ? restaurantActions : [])])
}
const readable = new Set([
  're.state',
  're.deal.get',
  're.report',
  'hotel.state',
  'hotel.reservation.get',
  'hotel.guest.get',
  'hotel.availability',
  'hotel.report',
  'sal.state',
  'sal.customer.get',
  'sal.booking.get',
  'sal.package.get',
  'sal.invoice.get',
  'sal.report',
  'sal.commissions',
  'gym.state',
  'gym.member.get',
  'gym.membership.get',
  'gym.session.get',
  'gym.access.get',
  'gym.report',
  'edu.state',
  'edu.student.get',
  'edu.group.get',
  'edu.enrollment.get',
  'edu.session.get',
  'edu.exam.get',
  'edu.report',
  'crm.state',
  'crm.lead.get',
  'crm.contact.get',
  'crm.opportunity.get',
  'crm.quote.get',
  'crm.report',
  'hr.state',
  'hr.period',
  'hr.leave.balances',
  'hr.payroll.get',
  'pharmacy.state',
  'pharmacy.sale.get',
  'pharmacy.document.get',
  'pharmacy.barcode.lookup',
  'pharmacy.report',
  'laboratory.state',
  'laboratory.patient.get',
  'laboratory.order.get',
  'laboratory.report',
  'clinic.state',
  'clinic.patient.get',
  'clinic.appointment.get',
  'clinic.visit.get',
  'clinic.invoice.get',
  'clinic.report',
  'auth.status',
  'login',
  'logout',
  'state',
  'invoice.get',
  'stock.reconcile',
  'barcode.lookup',
  'report.get',
  'license.status',
  'license.activate',
  'license.renew',
  'password.change',
  'shift.close',
  'restaurant.state',
  'service-center.state',
  'service-center.device.history',
  'service-center.order.get',
  'service-center.report',
  'workshop.state',
  'workshop.vehicle.history',
  'workshop.order.get',
  'workshop.report',
  'manufacturing.state',
  'manufacturing.order.get',
  'manufacturing.mrp',
  'manufacturing.report',
  'inventory.state',
  'inventory.document.get',
  'inventory.report',
  'accounting.state',
  'accounting.journal.get',
  'accounting.report',
  'accounting.ledger',
])

/** One trusted process owns the database. Serialized operations prevent restore/hash races. */
export class Runtime {
  db: XzareDatabase
  engine: BusinessEngine
  readonly databasePath: string
  private tail: Promise<unknown> = Promise.resolve()
  private closed = false
  private shuttingDown = false
  backupError = ''
  readonly actions: Set<string>
  constructor(
    readonly directory: string,
    readonly publicKey: string,
    readonly device: string,
    readonly onlineLicense?: OnlineLicense,
    readonly product: ProductKind = 'pos',
  ) {
    mkdirSync(directory, { recursive: true })
    this.databasePath = join(directory, 'xzare.sqlite')
    this.actions = actionsFor(product)
    this.db = openDatabase(this.databasePath, product)
    this.engine = new BusinessEngine(this.db, product)
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    if (this.shuttingDown) return Promise.reject(new Error('جارٍ إغلاق البرنامج'))
    const result = this.tail.then(() => {
      if (this.closed) throw new Error('البرنامج مغلق')
      return fn()
    })
    this.tail = result.catch(() => {})
    return result
  }
  licenseStatus() {
    if (this.onlineLicense) return { ...this.onlineLicense.status(), backupError: this.backupError }
    const settings = this.engine.settings(),
      now = Date.now(),
      high = Number(settings.clockHighWater ?? now),
      start = Number(settings.trialStarted ?? now)
    const rollback = now + 300000 < high
    if (now > high)
      this.db
        .prepare(
          "INSERT INTO settings VALUES('clockHighWater',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(String(now))
    let customer = ''
    let licensed = false
    if (settings.license) {
      try {
        customer = verifyLicense(
          settings.license,
          this.publicKey,
          this.device,
          Math.max(now, high),
          false,
          this.product === 'real-estate'
            ? 'xzare-real-estate'
            : this.product === 'hotel'
              ? 'xzare-hotel'
              : this.product === 'salon'
                ? 'xzare-salon'
                : this.product === 'gym'
                  ? 'xzare-gym'
                  : this.product === 'education'
                    ? 'xzare-education'
                    : this.product === 'crm'
                      ? 'xzare-crm'
                      : this.product === 'hr'
                        ? 'xzare-hr'
                        : this.product === 'pharmacy'
                          ? 'xzare-pharmacy'
                          : this.product === 'laboratory'
                            ? 'xzare-laboratory'
                            : this.product === 'clinic'
                              ? 'xzare-clinic'
                              : this.product === 'service-center'
                                ? 'xzare-service-center'
                                : this.product === 'workshop'
                                  ? 'xzare-workshop'
                                  : this.product === 'manufacturing'
                                    ? 'xzare-manufacturing'
                                    : this.product === 'inventory'
                                      ? 'xzare-inventory'
                                      : this.product === 'accounting'
                                        ? 'xzare-accounting'
                                        : this.product === 'restaurant'
                                          ? 'xzare-restaurant'
                                          : 'xzare-pos',
        ).customer
        licensed = true
      } catch {}
    }
    const days = Math.max(0, Math.ceil((start + 30 * 86400000 - Math.max(now, high)) / 86400000))
    return {
      device: this.device,
      licensed,
      customer,
      days,
      readOnly: rollback || (!licensed && days === 0),
      clockRollback: rollback,
      backupError: this.backupError,
    }
  }
  call(action: string, payload: unknown = {}, token: string | null = null): Promise<unknown> {
    return this.serial(async () => {
      if (!this.actions.has(action)) throw new Error('العملية غير متاحة')
      const configured = !!this.db.prepare('SELECT id FROM users LIMIT 1').get()
      if (action === 'boot.status') {
        z.object({}).strict().parse(payload)
        if (configured) return { configured: true, activationRequired: false }
        const status = this.licenseStatus()
        return { configured: false, activationRequired: !!this.onlineLicense && status.readOnly,
          licensed: status.licensed, canRenew: this.onlineLicense?.status().canRenew ?? false,
          onlineConfigured: this.onlineLicense?.status().onlineConfigured ?? false }
      }
      if (action === 'setup' && this.onlineLicense && this.licenseStatus().readOnly)
        throw new Error('يلزم التفعيل قبل إنشاء حساب المدير')
      if (action === 'license.offline.export' || action === 'license.offline.import') {
        const user = configured ? this.engine.identity.require(token, 'admin') : null
        if (!this.onlineLicense) throw new Error('التفعيل دون إنترنت متاح في نسخة Windows المؤمنة')
        if (action === 'license.offline.export') {
          const { license } = z.object({ license: z.string().min(1).max(4096).optional() }).strict().parse(payload)
          const challenge = this.onlineLicense.exportOfflineChallenge(license)
          if (user) this.engine.identity.audit(user.id, action, 'device')
          return { challenge }
        }
        const { response } = z.object({ response: z.string().min(1).max(20000) }).strict().parse(payload)
        this.onlineLicense.importOfflineResponse(response)
        if (user) this.engine.identity.audit(user.id, action, 'device')
        return this.licenseStatus()
      }
      if (action === 'session.activity') {
        z.object({}).strict().parse(payload)
        return this.engine.identity.activity(token)
      }
      if (action === 'license.status') {
        const user = this.engine.identity.require(token),
          status = this.licenseStatus()
        return user.role === 'admin' ? status : { ...status, device: '', customer: '' }
      }
      if (action === 'license.activate') {
        const user = !configured && this.onlineLicense ? null : this.engine.identity.require(token, 'admin')
        const { license } = z
          .object({ license: z.string().min(1).max(16384) })
          .strict()
          .parse(payload)
        if (this.onlineLicense) {
          await this.onlineLicense.activate(license)
          if (user) this.engine.identity.audit(user.id, action, 'device')
          return this.licenseStatus()
        }
        verifyLicense(
          license,
          this.publicKey,
          this.device,
          Math.max(Date.now(), Number(this.engine.settings().clockHighWater ?? 0)),
          false,
          this.product === 'real-estate'
            ? 'xzare-real-estate'
            : this.product === 'hotel'
              ? 'xzare-hotel'
              : this.product === 'salon'
                ? 'xzare-salon'
                : this.product === 'gym'
                  ? 'xzare-gym'
                  : this.product === 'education'
                    ? 'xzare-education'
                    : this.product === 'crm'
                      ? 'xzare-crm'
                      : this.product === 'hr'
                        ? 'xzare-hr'
                        : this.product === 'pharmacy'
                          ? 'xzare-pharmacy'
                          : this.product === 'laboratory'
                            ? 'xzare-laboratory'
                            : this.product === 'clinic'
                              ? 'xzare-clinic'
                              : this.product === 'service-center'
                                ? 'xzare-service-center'
                                : this.product === 'workshop'
                                  ? 'xzare-workshop'
                                  : this.product === 'manufacturing'
                                    ? 'xzare-manufacturing'
                                    : this.product === 'inventory'
                                      ? 'xzare-inventory'
                                      : this.product === 'accounting'
                                        ? 'xzare-accounting'
                                        : this.product === 'restaurant'
                                          ? 'xzare-restaurant'
                                          : 'xzare-pos',
        )
        this.db.transaction(() => {
          this.db
            .prepare(
              "INSERT INTO settings VALUES('license',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            )
            .run(license)
          this.engine.identity.audit(user!.id, action, 'device')
        })()
        return this.licenseStatus()
      }
      if (action === 'license.renew') {
        const user = !configured && this.onlineLicense ? null : this.engine.identity.require(token, 'admin')
        if (!this.onlineLicense)
          throw new Error('التفعيل عبر الإنترنت متاح في نسخة Windows المؤمنة')
        await this.onlineLicense.renew()
        if (user) this.engine.identity.audit(user.id, action, 'device')
        return this.licenseStatus()
      }
      if (action !== 'setup' && !readable.has(action) && this.licenseStatus().readOnly)
        throw new Error('يلزم تفعيل الترخيص أو مراجعة توقيت الجهاز؛ العرض والتصدير والنسخ متاحون')
      const result = await this.engine.call(action, payload, token)
      return result
    })
  }
  backup(token: string | null, target: string) {
    return this.serial(async () => {
      const user = this.engine.identity.require(token, 'admin')
      await createBackup(this.db, target, this.product)
      this.engine.identity.audit(user.id, 'backup.create', 'database')
      return { saved: true }
    })
  }
  restore(token: string | null, password: string, source: string) {
    return this.serial(async () => {
      this.engine.identity.require(token, 'admin')
      if (typeof password !== 'string' || password.length < 1 || password.length > 128)
        throw new Error('كلمة المرور مطلوبة')
      const user = await this.engine.identity.checkPassword(token, password)
      this.engine.identity.require(token, 'admin')
      if (this.db.prepare('SELECT id FROM shifts WHERE closed_at IS NULL LIMIT 1').get())
        throw new Error('أغلق جميع الورديات قبل الاستعادة')
      if (
        this.product === 'restaurant' &&
        this.db
          .prepare(
            "SELECT id FROM restaurant_orders WHERE status NOT IN('completed','cancelled','refunded') LIMIT 1",
          )
          .get()
      )
        throw new Error('أغلق جميع طلبات المطعم قبل الاستعادة')
      const candidate = validateBackup(source, this.directory, this.product),
        stamp = randomUUID(),
        recovery = join(this.directory, 'backups', `before-restore-${stamp}.xzbak`),
        old = join(this.directory, `before-restore-${stamp}.sqlite`)
      const currentSettings = this.engine.settings(),
        previousIdentity = this.engine.identity
      try {
        await createBackup(this.db, recovery, this.product)
        this.engine.identity.audit(user.id, 'backup.restore', 'database')
        this.db.pragma('wal_checkpoint(TRUNCATE)')
        this.db.close()
        let movedOriginal = false,
          installedCandidate = false
        try {
          renameSync(this.databasePath, old)
          movedOriginal = true
          renameSync(candidate.databasePath, this.databasePath)
          installedCandidate = true
          this.db = openDatabase(this.databasePath, this.product)
          this.db.prepare('DELETE FROM sessions').run()
          // Restore business records; preserve this machine's purchase/trial and clock state.
          for (const key of ['license', 'trialStarted', 'clockHighWater']) {
            this.db.prepare('DELETE FROM settings WHERE key=?').run(key)
            if (currentSettings[key] !== undefined)
              this.db.prepare('INSERT INTO settings VALUES(?,?)').run(key, currentSettings[key])
          }
          this.engine = new BusinessEngine(this.db, this.product)
          this.engine.identity.audit(null, 'backup.restore', 'database')
        } catch (error) {
          if (this.db.open) this.db.close()
          if (installedCandidate && existsSync(this.databasePath)) unlinkSync(this.databasePath)
          if (movedOriginal) renameSync(old, this.databasePath)
          this.db = openDatabase(this.databasePath, this.product)
          this.engine = new BusinessEngine(this.db, this.product)
          this.engine.identity.recoverSessionsFrom(previousIdentity)
          throw error
        }
        return { restored: true, recovery }
      } finally {
        if (existsSync(candidate.databasePath)) unlinkSync(candidate.databasePath)
      }
    })
  }
  dailyBackup() {
    return this.serial(async () => {
      if (!this.db.prepare('SELECT id FROM users LIMIT 1').get()) return
      const directory = join(this.directory, 'backups')
      const name = `automatic-${new Date().toISOString().slice(0, 10)}.xzbak`,
        target = join(directory, name)
      try {
        mkdirSync(directory, { recursive: true })
        if (!existsSync(target)) await createBackup(this.db, target, this.product)
        const history = readdirSync(directory)
          .filter((n) => /^automatic-\d{4}-\d{2}-\d{2}\.xzbak$/.test(n))
          .sort()
        for (const name of history.slice(0, -7)) unlinkSync(join(directory, name))
        this.backupError = ''
      } catch {
        this.backupError = 'تعذر إنشاء النسخة التلقائية؛ أنشئ نسخة يدويًا وراجع مساحة القرص'
      }
    })
  }
  refreshLicense() {
    return this.serial(async () => {
      await this.onlineLicense?.renew()
    })
  }
  close() {
    if (this.closed) return
    this.closed = true
    if (this.db.open) this.db.close()
  }
  async shutdown() {
    this.shuttingDown = true
    await this.tail
    this.close()
  }
}

export function publicError(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  // Application errors are localized. Native SQL, paths and validation internals stay private.
  return /^[\u0600-\u06ff]/.test(message) && message.length < 600
    ? message
    : 'تعذر إتمام العملية. راجع المدخلات وتفرّد الأكواد ومساحة القرص، ثم أعد المحاولة'
}
