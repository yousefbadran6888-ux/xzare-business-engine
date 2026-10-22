import { createHash, createPublicKey, verify } from 'node:crypto'
import { z } from 'zod'
export const GRACE_MS = 7 * 86400000
export const OFFLINE_CHALLENGE_MS = 86400000
export const productSchema = z.enum([
  'xzare-pos', 'xzare-restaurant', 'xzare-accounting', 'xzare-inventory',
  'xzare-manufacturing', 'xzare-workshop', 'xzare-service-center', 'xzare-clinic',
  'xzare-laboratory', 'xzare-pharmacy', 'xzare-hr', 'xzare-crm', 'xzare-education',
  'xzare-gym', 'xzare-salon', 'xzare-real-estate', 'xzare-hotel',
])
export type LicenseProduct = z.infer<typeof productSchema>
export const deviceSummarySchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/),
  deviceName: z.string().min(1).max(80),
  activatedAt: z.number().int().nonnegative(),
  lastSeenAt: z.number().int().nonnegative(),
}).strict()
export type DeviceSummary = z.infer<typeof deviceSummarySchema>
const fingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/)
export const requestSchema = z.object({
  action: z.enum(['activate', 'renew']),
  product: productSchema.optional(),
  credential: z.string().min(1).max(4096),
  publicKey: z.string().min(40).max(512),
  device: fingerprintSchema,
  fingerprint: fingerprintSchema.optional(),
  deviceName: z.string().trim().min(1).max(80).regex(/^[^\u0000-\u001f\u007f<>]*$/).optional(),
  offline: z.literal(true).optional(),
  nonce: z.string().regex(/^[a-f0-9]{32}$/),
  issuedAt: z.number().int().nonnegative(),
  signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
}).strict()
export type LicenseRequest = z.infer<typeof requestSchema>
const purchaseSchema = z.object({
  version: z.literal(3), id: z.string().uuid(), product: productSchema,
  customerId: z.string().trim().min(1).max(160), maxDevices: z.union([z.literal(1), z.literal(2)]),
  perpetual: z.boolean(), issuedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive().nullable(),
}).strict().refine((p) => p.perpetual === (p.expiresAt === null) && (p.expiresAt === null || p.expiresAt > p.issuedAt))
export type PurchaseClaims = z.infer<typeof purchaseSchema>
/** The signed purchase is an entitlement credential, never a device lease. */
export function verifyPurchaseCode(code: string, publicKey: string, product?: LicenseProduct, now = Date.now()): PurchaseClaims {
  if (typeof code !== 'string' || code.length > 4096) throw new Error('كود التفعيل غير صالح')
  const match = /^XZ3\.([A-Za-z0-9_-]{1,3000})\.([A-Za-z0-9_-]{86})$/.exec(code)
  if (!match) throw new Error('كود التفعيل غير صالح')
  const payload = Buffer.from(match[1]!, 'base64url'), signature = Buffer.from(match[2]!, 'base64url')
  if (payload.toString('base64url') !== match[1] || signature.toString('base64url') !== match[2] || !verify(null, payload, publicKey, signature)) throw new Error('كود التفعيل غير صالح')
  const claims = purchaseSchema.parse(JSON.parse(payload.toString('utf8')))
  if ((product && claims.product !== product) || claims.issuedAt > now + 300000 || (claims.expiresAt !== null && claims.expiresAt <= now)) throw new Error('كود التفعيل غير صالح لهذا المنتج أو انتهت صلاحيته')
  return claims
}
export function deviceId(publicKey: string) {
  const key = createPublicKey(publicKey)
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('هوية الجهاز غير صالحة')
  return createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex')
}
export function proofBody(r: Omit<LicenseRequest, 'signature'>) {
  const legacy = ['xzare-license-v1', r.action, r.credential, r.publicKey, r.device, r.nonce, r.issuedAt, ...(r.product ? [r.product] : [])]
  // Retain the precise old proof for legacy clients; new optional fields are authenticated together.
  return Buffer.from(JSON.stringify(r.fingerprint !== undefined || r.deviceName !== undefined || r.offline !== undefined
    ? [...legacy, { fingerprint: r.fingerprint ?? null, deviceName: r.deviceName ?? null, offline: r.offline === true }]
    : legacy))
}
export function verifyRequest(input: unknown, now: number, options: { offline?: boolean } = {}): LicenseRequest {
  const r = requestSchema.parse(input), sig = Buffer.from(r.signature, 'base64url')
  if ((r.offline === true && options.offline !== true) || (options.offline === true && r.offline !== true) ||
    r.issuedAt > now + 300000 || now - r.issuedAt > (r.offline ? OFFLINE_CHALLENGE_MS : 300000) ||
    deviceId(r.publicKey) !== r.device || sig.toString('base64url') !== r.signature ||
    !verify(null, proofBody(r), r.publicKey, sig)) throw new Error('طلب التفعيل غير صالح')
  return r
}
export class AuthorityDenied extends Error {
  constructor(message = 'تعذر التحقق من الترخيص؛ راجع الاتصال والدعم') { super(message); this.name = 'AuthorityDenied' }
}
export class DeviceQuotaExceeded extends AuthorityDenied {
  readonly devices: DeviceSummary[]
  constructor(devices: DeviceSummary[]) {
    super('تم بلوغ حد الأجهزة؛ ألغِ تفعيل جهاز من حسابك قبل نقل الترخيص')
    this.name = 'DeviceQuotaExceeded'
    this.devices = z.array(deviceSummarySchema).max(2).parse(devices)
  }
}
export class InvalidLicenseRequest extends Error {}
