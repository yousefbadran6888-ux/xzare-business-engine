import { verify } from 'node:crypto'
import { z } from 'zod'
const legacyPayloadSchema = z
  .object({
    product: z.enum([
      'xzare-pos',
      'xzare-restaurant',
      'xzare-accounting',
      'xzare-inventory',
      'xzare-manufacturing',
      'xzare-workshop',
      'xzare-service-center',
      'xzare-clinic',
      'xzare-laboratory',
      'xzare-pharmacy',
      'xzare-hr',
      'xzare-crm',
      'xzare-education',
      'xzare-gym',
      'xzare-salon',
      'xzare-real-estate',
      'xzare-hotel',
    ]),
    version: z.literal(1),
    licenseId: z.string().min(1).max(64),
    customer: z.string().min(1).max(160),
    device: z.string().regex(/^[a-f0-9]{64}$/),
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive().nullable(),
  })
  .strict()
const payloadSchema = z.discriminatedUnion('version', [
  legacyPayloadSchema,
  legacyPayloadSchema
    .extend({
      version: z.literal(2),
      nonce: z.string().regex(/^[a-f0-9]{32}$/),
    })
    .strict(),
  legacyPayloadSchema.extend({
    version: z.literal(3),
    nonce: z.string().regex(/^[a-f0-9]{32}$/),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    customerId: z.string().min(1).max(160).nullable(),
    maxDevices: z.union([z.literal(1), z.literal(2)]),
  }).strict(),
])
export type License = z.infer<typeof payloadSchema>
export function verifyLicense(
  raw: unknown,
  key: string,
  device: string,
  now = Date.now(),
  allowExpired = false,
  product:
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
): License {
  try {
    if (typeof raw !== 'string' || raw.length > 16384) throw new Error()
    const envelope = z
      .object({
        payload: z.string().min(1).max(8192),
        signature: z.string().min(1).max(128),
      })
      .strict()
      .parse(JSON.parse(raw))
    const body = Buffer.from(envelope.payload, 'base64url'),
      signature = Buffer.from(envelope.signature, 'base64url')
    if (
      body.toString('base64url') !== envelope.payload ||
      signature.toString('base64url') !== envelope.signature ||
      signature.length !== 64 ||
      !verify(null, body, key, signature)
    )
      throw new Error()
    const license = payloadSchema.parse(JSON.parse(body.toString('utf8')))
    if (
      license.product !== product ||
      license.device !== device ||
      license.issuedAt > now + 300000 ||
      (!allowExpired && license.expiresAt !== null && license.expiresAt <= now)
    )
      throw new Error()
    return license
  } catch {
    throw new Error('الترخيص غير صالح لهذا الجهاز أو انتهت صلاحيته')
  }
}
