import { expect, it } from 'vitest'
import { generateKeyPairSync, sign } from 'node:crypto'
import { openDatabase } from '@xzare/db'
import { LicenseAuthority } from './license-authority.js'
import { deviceId, proofBody } from './license-protocol.js'
function keys() {
  const pair = generateKeyPairSync('ed25519')
  return { pub: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(), priv: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() }
}
it('upgrades the actual old single-device schema and preserves its bound public key', () => {
  const db = openDatabase(':memory:'), issuer = keys(), device = keys()
  try {
    db.exec(`CREATE TABLE license_accounts(id TEXT PRIMARY KEY,code_hash TEXT NOT NULL UNIQUE,customer TEXT NOT NULL,expires_at INTEGER,device TEXT,public_key TEXT,revoked INTEGER NOT NULL DEFAULT 0);`)
    db.prepare('INSERT INTO license_accounts VALUES(?,?,?,?,?,?,?)').run('legacy-id', 'old-hash', 'Legacy buyer', null, deviceId(device.pub), device.pub, 0)
    const authority = new LicenseAuthority(db, issuer.priv)
    expect(authority.listDevices('legacy-id')[0]?.id).toBe(deviceId(device.pub))
    const unsigned = { action: 'renew' as const, credential: 'legacy-id', publicKey: device.pub, device: deviceId(device.pub), nonce: 'a'.repeat(32), issuedAt: Date.now() }
    const response = authority.handle({ ...unsigned, signature: sign(null, proofBody(unsigned), device.priv).toString('base64url') })
    const body = JSON.parse(Buffer.from(JSON.parse(response.lease).payload, 'base64url').toString())
    expect(body.version).toBe(2)
    authority.deactivateDevice('legacy-id', deviceId(device.pub))
    new LicenseAuthority(db, issuer.priv)
    expect(authority.listDevices('legacy-id')).toEqual([])
  } finally { db.close() }
})
it('returns HTTP 409 device names for signed credentials and never exposes keys', async () => {
  // The real Node host consumes built authority/protocol modules together.
  const tool = new URL('../../../tools/license-server.mjs', import.meta.url).href
  const { createLicenseServer } = await import(tool)
  const { LicenseAuthority: BuiltAuthority } = await import('../dist/license-authority.js')
  const db = openDatabase(':memory:'), issuer = keys(), first = keys(), second = keys(), authority = new BuiltAuthority(db, issuer.priv)
  const server = createLicenseServer(authority)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const address = server.address() as { port: number }
  const post = async (device: ReturnType<typeof keys>, name: string, code: string) => {
    const unsigned = { action: 'activate' as const, credential: code, publicKey: device.pub, device: deviceId(device.pub), fingerprint: deviceId(device.pub), deviceName: name, nonce: deviceId(device.pub).slice(0, 32), issuedAt: Date.now() }
    return fetch(`http://127.0.0.1:${address.port}/v1/license`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...unsigned, signature: sign(null, proofBody(unsigned), device.priv).toString('base64url') }) })
  }
  try {
    const purchase = authority.issue('Buyer', null, 'xzare-pos', { customerId: 'customer-1', maxDevices: 1 })
    expect((await post(first, 'Cash register', purchase.code)).status).toBe(200)
    const quota = await post(second, 'Second register', purchase.code)
    expect(quota.status).toBe(409)
    const body = await quota.json() as any
    expect(body.devices).toHaveLength(1)
    expect(body.devices[0].deviceName).toBe('Cash register')
    expect(JSON.stringify(body)).not.toMatch(/PUBLIC|PRIVATE|fingerprint|code_hash/)
  } finally { server.closeAllConnections(); await new Promise<void>((r) => server.close(() => r())); db.close() }
})
it('client proof uses the old exact byte sequence when no optional identity fields exist', () => {
  const device = keys(), r = { action: 'renew' as const, credential: 'legacy-id', publicKey: device.pub, device: deviceId(device.pub), nonce: 'a'.repeat(32), issuedAt: 1800000000000 }
  expect(proofBody(r).toString()).toBe(JSON.stringify(['xzare-license-v1', r.action, r.credential, r.publicKey, r.device, r.nonce, r.issuedAt]))
})
