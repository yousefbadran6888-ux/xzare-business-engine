import { createHash, createPrivateKey, createPublicKey, randomBytes, randomUUID, sign } from 'node:crypto'
import {
  GRACE_MS, OFFLINE_CHALLENGE_MS, verifyRequest, verifyPurchaseCode, productSchema,
  AuthorityDenied, DeviceQuotaExceeded, InvalidLicenseRequest,
  type LicenseRequest, type LicenseProduct, type DeviceSummary,
} from './license-protocol.js'
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
/** Structural interface permits the host's node:sqlite adapter to share a fulfillment transaction. */
export interface AuthorityDatabase {
  exec(sql: string): unknown
  pragma(sql: string): unknown
  prepare(sql: string): {
    get(...args: any[]): unknown
    all(...args: any[]): unknown[]
    run(...args: any[]): { changes: number | bigint }
  }
  transaction<T>(fn: () => T): () => T
}
interface Account {
  id: string; customer: string; customer_id: string | null; code_hash: string
  expires_at: number | null; revoked: number; product: LicenseProduct; max_devices: 1 | 2
}
interface RegisteredDevice { public_key: string; fingerprint: string | null; deactivated_at: number | null }
/** Operator-only methods require authorization in the host; never expose them as anonymous routes. */
export class LicenseAuthority {
  private readonly publicKey: string
  constructor(readonly db: AuthorityDatabase, private readonly privateKey: string, private readonly now = Date.now) {
    const key = createPrivateKey(privateKey)
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('Invalid issuer key')
    this.publicKey = createPublicKey(key).export({ type: 'spki', format: 'pem' }).toString()
    db.transaction(() => {
      db.exec(`CREATE TABLE IF NOT EXISTS license_accounts (
        id TEXT PRIMARY KEY, code_hash TEXT NOT NULL UNIQUE, customer TEXT NOT NULL,
        expires_at INTEGER, device TEXT, public_key TEXT, revoked INTEGER NOT NULL DEFAULT 0,
        product TEXT NOT NULL DEFAULT 'xzare-pos', customer_id TEXT, max_devices INTEGER NOT NULL DEFAULT 1 CHECK(max_devices IN(1,2))
      ); CREATE TABLE IF NOT EXISTS license_nonces (
        device TEXT NOT NULL, nonce TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(device,nonce)
      ); CREATE TABLE IF NOT EXISTS license_events (
        id TEXT PRIMARY KEY, license_id TEXT NOT NULL, action TEXT NOT NULL, at INTEGER NOT NULL
      );`)
      const columns = (db.pragma('table_info(license_accounts)') as { name: string }[]).map((c) => c.name)
      if (!columns.includes('product')) db.exec("ALTER TABLE license_accounts ADD COLUMN product TEXT NOT NULL DEFAULT 'xzare-pos'")
      if (!columns.includes('customer_id')) db.exec('ALTER TABLE license_accounts ADD COLUMN customer_id TEXT')
      if (!columns.includes('max_devices')) db.exec('ALTER TABLE license_accounts ADD COLUMN max_devices INTEGER NOT NULL DEFAULT 1 CHECK(max_devices IN(1,2))')
      db.exec(`CREATE TABLE IF NOT EXISTS license_devices (
        license_id TEXT NOT NULL REFERENCES license_accounts(id), device TEXT NOT NULL,
        public_key TEXT NOT NULL, fingerprint TEXT, device_name TEXT NOT NULL,
        activated_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, deactivated_at INTEGER,
        PRIMARY KEY(license_id,device)
      ); CREATE UNIQUE INDEX IF NOT EXISTS license_device_fingerprint ON license_devices(license_id,fingerprint) WHERE deactivated_at IS NULL AND fingerprint IS NOT NULL;`)
      // Keep historical rows after transfer so reopening cannot remigrate a deactivated device.
      db.prepare(`INSERT INTO license_devices(license_id,device,public_key,fingerprint,device_name,activated_at,last_seen_at)
        SELECT a.id,a.device,a.public_key,NULL,'جهاز سابق',?,? FROM license_accounts a
        WHERE a.device IS NOT NULL AND a.public_key IS NOT NULL AND NOT EXISTS(SELECT 1 FROM license_devices d WHERE d.license_id=a.id)`)
        .run(now(), now())
    })()
  }
  issue(customer: string, expiresAt: number | null = null, product: LicenseProduct = 'xzare-pos', options?: { customerId: string; maxDevices: 1 | 2 }) {
    const now = this.now()
    if (!productSchema.safeParse(product).success || typeof customer !== 'string' || !customer.trim() || customer.length > 160 ||
      (expiresAt !== null && (!Number.isSafeInteger(expiresAt) || expiresAt <= now)) ||
      (options && (typeof options.customerId !== 'string' || !options.customerId.trim() || options.customerId.length > 160 || ![1, 2].includes(options.maxDevices)))) throw new Error('Invalid purchase')
    const id = randomUUID()
    let code = randomBytes(32).toString('base64url')
    if (options) {
      const payload = Buffer.from(JSON.stringify({ version: 3, id, product, customerId: options.customerId.trim(), maxDevices: options.maxDevices,
        perpetual: expiresAt === null, issuedAt: now, expiresAt }))
      code = `XZ3.${payload.toString('base64url')}.${sign(null, payload, this.privateKey).toString('base64url')}`
    }
    return this.db.transaction(() => {
      this.db.prepare('INSERT INTO license_accounts(id,code_hash,customer,expires_at,product,customer_id,max_devices) VALUES(?,?,?,?,?,?,?)')
        .run(id, digest(code), customer.trim(), expiresAt, product, options?.customerId.trim() ?? null, options?.maxDevices ?? 1)
      this.event(id, 'issue', now)
      return { id, code }
    })()
  }
  private event(id: string, action: string, at = this.now()) {
    this.db.prepare('INSERT INTO license_events VALUES(?,?,?,?)').run(randomUUID(), id, action, at)
  }
  revoke(id: string) {
    this.db.transaction(() => {
      if (!this.db.prepare('UPDATE license_accounts SET revoked=1 WHERE id=?').run(id).changes) throw new Error('Unknown license')
      this.event(id, 'revoke')
    })()
  }
  listDevices(licenseId: string): DeviceSummary[] {
    if (!this.db.prepare('SELECT id FROM license_accounts WHERE id=?').get(licenseId)) throw new Error('Unknown license')
    return this.db.prepare(`SELECT device AS id,device_name AS deviceName,activated_at AS activatedAt,last_seen_at AS lastSeenAt
      FROM license_devices WHERE license_id=? AND deactivated_at IS NULL ORDER BY activated_at,device`).all(licenseId) as DeviceSummary[]
  }
  deactivateDevice(licenseId: string, device: string) {
    return this.db.transaction(() => {
      if (!this.db.prepare('UPDATE license_devices SET deactivated_at=? WHERE license_id=? AND device=? AND deactivated_at IS NULL').run(this.now(), licenseId, device).changes) throw new Error('Unknown active device')
      this.event(licenseId, `deactivate:${device}`)
      return { deactivated: true }
    })()
  }
  handle(input: unknown, options: { offline?: boolean } = {}): { lease: string } {
    const now = this.now()
    let r: LicenseRequest
    try { r = verifyRequest(input, now, options) } catch { throw new InvalidLicenseRequest() }
    return this.db.transaction(() => {
      const row = this.db.prepare(`SELECT * FROM license_accounts WHERE ${r.action === 'activate' ? 'code_hash' : 'id'}=?`)
        .get(r.action === 'activate' ? digest(r.credential) : r.credential) as Account | undefined
      if (!row || row.product !== (r.product ?? 'xzare-pos') || row.revoked || (row.expires_at !== null && row.expires_at <= now)) throw new AuthorityDenied()
      if (row.customer_id !== null && r.action === 'activate') {
        let claims
        try { claims = verifyPurchaseCode(r.credential, this.publicKey, row.product, now) } catch { throw new AuthorityDenied() }
        if (claims.id !== row.id || claims.customerId !== row.customer_id || claims.maxDevices !== row.max_devices || claims.expiresAt !== row.expires_at) throw new AuthorityDenied()
      }
      if (row.customer_id !== null && (!r.fingerprint || !r.deviceName)) throw new InvalidLicenseRequest()
      const registered = this.db.prepare('SELECT public_key,fingerprint,deactivated_at FROM license_devices WHERE license_id=? AND device=?').get(row.id, r.device) as RegisteredDevice | undefined
      if (registered && (registered.public_key !== r.publicKey || (registered.fingerprint !== null && registered.fingerprint !== (r.fingerprint ?? r.device)))) throw new AuthorityDenied()
      if (r.action === 'renew' && (!registered || registered.deactivated_at !== null)) throw new AuthorityDenied()
      if (!registered || registered.deactivated_at !== null) {
        const devices = this.listDevices(row.id)
        if (devices.length >= row.max_devices) throw new DeviceQuotaExceeded(devices)
        if (this.db.prepare('SELECT device FROM license_devices WHERE license_id=? AND fingerprint=? AND deactivated_at IS NULL').get(row.id, r.fingerprint ?? r.device)) throw new AuthorityDenied()
      }
      if (this.db.prepare('SELECT nonce FROM license_nonces WHERE device=? AND nonce=?').get(r.device, r.nonce)) throw new InvalidLicenseRequest()
      this.db.prepare('DELETE FROM license_nonces WHERE at<?').run(now - OFFLINE_CHALLENGE_MS - 300000)
      this.db.prepare('INSERT INTO license_nonces VALUES(?,?,?)').run(r.device, r.nonce, now)
      this.db.prepare(`INSERT INTO license_devices(license_id,device,public_key,fingerprint,device_name,activated_at,last_seen_at,deactivated_at)
        VALUES(?,?,?,?,?,?,?,NULL) ON CONFLICT(license_id,device) DO UPDATE SET fingerprint=excluded.fingerprint,device_name=excluded.device_name,
        activated_at=CASE WHEN license_devices.deactivated_at IS NULL THEN license_devices.activated_at ELSE excluded.activated_at END,
        last_seen_at=excluded.last_seen_at,deactivated_at=NULL`)
        .run(row.id, r.device, r.publicKey, r.fingerprint ?? r.device, r.deviceName ?? 'جهاز سابق', now, now)
      this.event(row.id, r.offline ? `offline.${r.action}` : r.action, now)
      const payload = Buffer.from(JSON.stringify({ product: row.product, version: r.fingerprint ? 3 : 2, nonce: r.nonce,
        licenseId: row.id, customer: row.customer, device: r.device, issuedAt: now, expiresAt: Math.min(now + GRACE_MS, row.expires_at ?? Infinity),
        ...(r.fingerprint ? { fingerprint: r.fingerprint, customerId: row.customer_id, maxDevices: row.max_devices } : {}) }))
      return { lease: JSON.stringify({ payload: payload.toString('base64url'), signature: sign(null, payload, this.privateKey).toString('base64url') }) }
    })()
  }
}
