import {
  generateKeyPairSync,
  randomBytes,
  sign,
  createPrivateKey,
  createPublicKey,
} from 'node:crypto'
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  statSync,
  unlinkSync,
} from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { verifyLicense } from './license.js'
import {
  deviceId,
  proofBody,
  GRACE_MS,
  AuthorityDenied,
  DeviceQuotaExceeded,
  deviceSummarySchema,
  verifyPurchaseCode,
  OFFLINE_CHALLENGE_MS,
  type LicenseRequest,
} from './license-protocol.js'
export interface Protector {
  seal(raw: string): Buffer
  open(raw: Buffer): string
}
export type Transport = (request: LicenseRequest) => Promise<{ lease: string }>
export interface LicenseClock {
  uptime(): number
  bootId: string
  requireOnlineAfterReboot: boolean
}
export interface DeviceIdentity { fingerprint: string; deviceName: string }
const stateSchema = z
  .object({
    version: z.literal(1),
    privateKey: z.string().max(512),
    publicKey: z.string().max(512),
    start: z.number().int().nonnegative(),
    high: z.number().int().nonnegative(),
    lease: z.string().max(16384),
    blocked: z.boolean(),
    bootId: z.string().max(128).default(''),
    leaseUptime: z.number().nonnegative().default(0),
    pending: z.object({
      nonce: z.string().regex(/^[a-f0-9]{32}$/), action: z.enum(['activate', 'renew']),
      licenseId: z.string().max(64).nullable(), issuedAt: z.number().int().nonnegative(),
    }).strict().nullable().default(null),
  })
  .strict()
export class OnlineLicense {
  readonly path: string
  readonly device: string
  private readonly identity: DeviceIdentity
  private state: z.infer<typeof stateSchema>
  private renewError = ''
  private savedHigh = 0
  constructor(
    directory: string,
    private readonly issuer: string,
    private readonly protector: Protector,
    private readonly transport: Transport | null,
    private readonly now = Date.now,
    private readonly clock?: LicenseClock,
    private readonly product:
      | 'xzare-pos'
      | 'xzare-restaurant'
      | 'xzare-accounting'
      | 'xzare-inventory'
      | 'xzare-manufacturing'
      | 'xzare-workshop'
      | 'xzare-clinic'
      | 'xzare-laboratory'
      | 'xzare-pharmacy'
      | 'xzare-hr'
      | 'xzare-crm'
      | 'xzare-education'
      | 'xzare-gym'
      | 'xzare-salon'
      | 'xzare-real-estate'
      | 'xzare-hotel'
      | 'xzare-service-center' = 'xzare-pos',
    identity?: DeviceIdentity,
  ) {
    mkdirSync(directory, { recursive: true })
    this.path = join(directory, 'device-license.protected')
    try {
      if (existsSync(this.path)) {
        if (statSync(this.path).size > 32768) throw new Error('Invalid state')
        this.state = stateSchema.parse(JSON.parse(protector.open(readFileSync(this.path))))
        const derived = createPrivateKey(this.state.privateKey)
        const publicKey = createPublicKey(derived)
          .export({ type: 'spki', format: 'pem' })
          .toString()
        if (deviceId(publicKey) !== deviceId(this.state.publicKey))
          throw new Error('Invalid key pair')
      } else {
        const pair = generateKeyPairSync('ed25519'),
          now = this.now()
        this.state = {
          version: 1,
          privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
          publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
          start: now,
          high: now,
          lease: '',
          blocked: false,
          bootId: '',
          leaseUptime: 0,
          pending: null,
        }
        this.save()
      }
      this.device = deviceId(this.state.publicKey)
      this.identity = z.object({
        fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
        deviceName: z.string().trim().min(1).max(80).regex(/^[^\u0000-\u001f\u007f<>]*$/),
      }).strict().parse(identity ?? { fingerprint: this.device, deviceName: 'جهاز العمل' })
      this.savedHigh = this.state.high
    } catch {
      throw new Error(
        'تعذر فتح حماية الترخيص لهذا المستخدم والجهاز؛ احتفظ بالبيانات وتواصل مع الدعم',
      )
    }
  }
  private save() {
    const temporary = this.path + '.' + randomBytes(12).toString('hex') + '.tmp'
    try {
      writeFileSync(temporary, this.protector.seal(JSON.stringify(this.state)), {
        flag: 'wx',
        mode: 0o600,
        flush: true,
      })
      renameSync(temporary, this.path)
      this.savedHigh = this.state.high
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary)
    }
  }
  request(action: 'activate' | 'renew', credential: string, offline = false): LicenseRequest {
    const request = {
      action,
      ...(this.product !== 'xzare-pos' ? { product: this.product } : {}),
      credential,
      publicKey: this.state.publicKey,
      device: this.device,
      fingerprint: this.identity.fingerprint,
      deviceName: this.identity.deviceName,
      ...(offline ? { offline: true as const } : {}),
      nonce: randomBytes(16).toString('hex'),
      issuedAt: this.now(),
    }
    return {
      ...request,
      signature: sign(null, proofBody(request), this.state.privateKey).toString('base64url'),
    }
  }
  status() {
    const wallNow = this.now(),
      high = this.state.high
    const sameBoot = !this.clock || this.state.bootId === this.clock.bootId
    const connectionRequired =
      !!this.clock?.requireOnlineAfterReboot && !!this.state.lease && !sameBoot
    let elapsedNow = wallNow
    if (this.clock && sameBoot && this.state.lease) {
      const old = verifyLicense(
        this.state.lease,
        this.issuer,
        this.device,
        Math.max(wallNow, high),
        true,
        this.product,
      )
      elapsedNow = old.issuedAt + Math.max(0, this.clock.uptime() - this.state.leaseUptime)
    }
    const now = Math.max(wallNow, elapsedNow),
      clockRollback = wallNow + 300000 < high
    // Limit disk writes; expiry checks always use the actual high-water mark in memory.
    if (now > high) {
      this.state.high = now
      if (now - this.savedHigh > 60000) this.save()
    }
    let customer = '',
      licensed = false,
      expiresAt: number | null = null
    if (this.state.lease && !this.state.blocked) {
      try {
        const lease = this.validLease(this.state.lease, Math.max(now, high))
        customer = lease.customer
        expiresAt = lease.expiresAt
        licensed = true
      } catch {}
    }
    // Commercial clients have no resettable local trial. Initial activation is required.
    return {
      device: this.device,
      licensed,
      canRenew: !!this.state.lease,
      customer,
      days: 0,
      readOnly: clockRollback || connectionRequired || this.state.blocked || !licensed,
      clockRollback,
      connectionRequired,
      expiresAt,
      onlineConfigured: this.transport !== null,
      renewError: this.renewError,
    }
  }
  private validLease(raw: string, now: number) {
    const lease = verifyLicense(raw, this.issuer, this.device, now, false, this.product)
    if (
      (lease.version !== 2 && lease.version !== 3) ||
      (lease.version === 3 && lease.fingerprint !== this.identity.fingerprint) ||
      lease.expiresAt === null ||
      lease.expiresAt <= lease.issuedAt ||
      lease.expiresAt - lease.issuedAt > GRACE_MS
    )
      throw new Error('صلاحية الترخيص غير صالحة')
    return lease
  }
  private validateCode(code: string) {
    if (/^[A-Za-z0-9_-]{43}$/.test(code)) return null
    return verifyPurchaseCode(code, this.issuer, this.product, this.now()).id
  }
  /** Stores only a nonce and entitlement id, never the purchase code. Re-export supersedes the old nonce. */
  exportOfflineChallenge(code?: string): LicenseRequest {
    const action = code ? 'activate' : 'renew'
    const licenseId = code ? this.validateCode(code) : this.currentLicenseId()
    const request = this.request(action, code ?? licenseId!, true)
    const previous = this.state
    this.state = { ...previous, pending: { action, licenseId, nonce: request.nonce, issuedAt: request.issuedAt } }
    try { this.save() } catch (error) { this.state = previous; throw error }
    return request
  }
  importOfflineResponse(raw: string) {
    if (typeof raw !== 'string' || raw.length > 20000) throw new Error('ملف الاستجابة غير صالح')
    const pending = this.state.pending
    if (!pending || this.now() - pending.issuedAt > OFFLINE_CHALLENGE_MS || pending.issuedAt > this.now() + 300000) throw new Error('طلب التفعيل انتهى أو لم يتم تصديره من هذا الجهاز')
    const { lease } = z.object({ lease: z.string().max(16384) }).strict().parse(JSON.parse(raw))
    return this.acceptResponse(lease, pending.nonce, pending.licenseId)
  }
  private currentLicenseId() {
    if (!this.state.lease) throw new Error('أدخل كود الشراء للتفعيل الأول')
    return verifyLicense(this.state.lease, this.issuer, this.device, Math.max(this.now(), this.state.high), true, this.product).licenseId
  }
  private acceptResponse(lease: string, nonce: string, licenseId: string | null) {
    const verified = this.validLease(lease, this.now())
    if ((verified.version !== 2 && verified.version !== 3) || verified.nonce !== nonce || (licenseId !== null && verified.licenseId !== licenseId)) throw new Error('الاستجابة لا تطابق طلب هذا الجهاز')
    const previous = this.state
    this.state = { ...previous, lease, blocked: false, pending: null,
      high: Math.max(this.now(), verified.issuedAt), bootId: this.clock?.bootId ?? '', leaseUptime: this.clock?.uptime() ?? 0 }
    try { this.save() } catch (error) { this.state = previous; throw error }
    this.renewError = ''
    return this.status()
  }
  private async exchange(request: LicenseRequest) {
    if (!this.transport) throw new Error('خادم التفعيل لم يُجهّز بعد؛ تواصل مع Xzare')
    try {
      const { lease } = await this.transport(request)
      // A nonce-bound fresh authority response can repair a previously incorrect local clock.
      const verified = this.validLease(lease, this.now())
      if ((verified.version !== 2 && verified.version !== 3) || verified.nonce !== request.nonce)
        throw new Error('Unexpected renewal response')
      if (request.action === 'renew' && verified.licenseId !== request.credential)
        throw new Error('Unexpected renewal license')
      return this.acceptResponse(lease, request.nonce, request.action === 'renew' ? request.credential : this.validateCode(request.credential))
    } catch (error) {
      if (error instanceof AuthorityDenied && request.action === 'renew') {
        this.state.blocked = true
        this.save()
      }
      this.renewError = 'تعذر تحديث الترخيص؛ تحقق من الاتصال قبل انتهاء مهلة العمل دون إنترنت'
      if (error instanceof DeviceQuotaExceeded) throw error
      throw new Error(
        error instanceof AuthorityDenied
          ? 'الترخيص موقوف أو غير صالح لهذا الجهاز؛ تواصل مع الدعم'
          : 'تعذر الاتصال بخادم التفعيل أو التحقق من رده؛ المحاولة لم تمدد صلاحية الترخيص',
      )
    }
  }
  activate(code: string) {
    try { this.validateCode(code) } catch (error) { return Promise.reject(error) }
    return this.exchange(this.request('activate', code))
  }
  renew() {
    if (!this.state.lease) return Promise.resolve(this.status())
    // Inspect authenticated old lease without treating its expiry as renewed authority.
    const lease = verifyLicense(
      this.state.lease,
      this.issuer,
      this.device,
      Math.max(this.now(), this.state.high),
      true,
      this.product,
    )
    return this.exchange(this.request('renew', lease.licenseId))
  }
}

/** Pinned publisher origin only. TLS verification stays enabled; no redirects to another host. */
export function httpsTransport(origin: string): Transport {
  const url = new URL(origin)
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('Invalid activation origin')
  return async (request) => {
    const response = await fetch(new URL('/v1/license', url), {
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(10000),
    })
    if (response.status === 403) throw new AuthorityDenied()
    if (!response.ok && response.status !== 409) throw new Error('Network failure')
    const reader = response.body?.getReader()
    if (!reader) throw new Error('Invalid response')
    const chunks: Uint8Array[] = []
    let length = 0
    try {
      for (;;) {
        const part = await reader.read()
        if (part.done) break
        length += part.value.length
        if (length > 20000) throw new Error('Response too large')
        chunks.push(part.value)
      }
    } finally {
      await reader.cancel()
    }
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString())
    if (response.status === 409) {
      const quota = z.object({ error: z.string().max(200), devices: z.array(deviceSummarySchema).max(2) }).strict().parse(value)
      throw new DeviceQuotaExceeded(quota.devices)
    }
    return z
      .object({ lease: z.string().max(16384) })
      .strict()
      .parse(value)
  }
}
