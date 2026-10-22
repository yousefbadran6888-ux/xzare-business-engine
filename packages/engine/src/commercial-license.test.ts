import { afterEach, expect, it } from 'vitest'
import { generateKeyPairSync, sign, verify } from 'node:crypto'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { openDatabase } from '@xzare/db'
import { LicenseAuthority } from './license-authority.js'
import { OnlineLicense } from './online-license.js'
import { Runtime } from './runtime.js'

const dbs: ReturnType<typeof openDatabase>[] = [], dirs: string[] = [], runtimes: Runtime[] = []
afterEach(() => {
  runtimes.splice(0).forEach((r) => r.close())
  dbs.splice(0).forEach((db) => db.close())
  for (const dir of dirs.splice(0)) {
    if (!resolve(dir).startsWith(resolve(tmpdir()) + '\\xzare-commercial-')) throw new Error('Unsafe cleanup')
    rmSync(dir, { recursive: true, force: true })
  }
})
function fixture() {
  const pair = generateKeyPairSync('ed25519'), pub = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    priv = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), db = openDatabase(':memory:')
  dbs.push(db)
  let now = Date.now(), serial = 0
  const authority = new LicenseAuthority(db, priv, () => now)
  // Deliberately transparent protector only in isolated tests, never shipped.
  const protector = { seal: (raw: string) => Buffer.from(raw), open: (raw: Buffer) => raw.toString() }
  const client = (online = true, product = 'xzare-pos', fingerprint?: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'xzare-commercial-')); dirs.push(dir)
    serial++
    return new OnlineLicense(dir, pub, protector, online ? async (r) => authority.handle(r) : null,
      () => now, undefined, product as 'xzare-pos', { fingerprint: fingerprint ?? serial.toString(16).padStart(64, '0'), deviceName: `Workstation ${serial}` })
  }
  return { authority, client, pub, priv, db, now: () => now, advance: (ms: number) => { now += ms } }
}
it('issues signed product and customer bound purchase claims with no fabricated expiry', () => {
  const f = fixture(), p = f.authority.issue('Buyer', null, 'xzare-clinic', { customerId: 'customer-1', maxDevices: 2 })
  expect(p.code).toMatch(/^XZ3\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{86}$/)
  const [, payload, signature] = p.code.split('.'), body = Buffer.from(payload!, 'base64url')
  expect(verify(null, body, f.pub, Buffer.from(signature!, 'base64url'))).toBe(true)
  expect(JSON.parse(body.toString())).toMatchObject({ id: p.id, product: 'xzare-clinic', customerId: 'customer-1', maxDevices: 2, perpetual: true, issuedAt: f.now(), expiresAt: null })
  expect(f.authority.issue('Legacy').code).toMatch(/^[A-Za-z0-9_-]{43}$/)
})
it.each([1, 2] as const)('enforces %s device quota and returns only registered display data', async (maxDevices) => {
  const f = fixture(), p = f.authority.issue('Buyer', null, 'xzare-pos', { customerId: 'customer-1', maxDevices })
  const clients = Array.from({ length: maxDevices + 1 }, () => f.client())
  for (const client of clients.slice(0, maxDevices)) await client.activate(p.code)
  const request = clients[maxDevices]!.request('activate', p.code)
  expect(() => f.authority.handle(request)).toThrow('حد الأجهزة')
  try { f.authority.handle(request) } catch (error: any) {
    expect(error.name).toBe('DeviceQuotaExceeded')
    expect(error.devices).toHaveLength(maxDevices)
    expect(error.devices[0]).toEqual({ id: clients[0]!.device, deviceName: 'Workstation 1', activatedAt: f.now(), lastSeenAt: f.now() })
    expect(JSON.stringify(error.devices)).not.toMatch(/PRIVATE|PUBLIC|fingerprint/)
  }
  await clients[0]!.renew()
  expect(f.authority.listDevices(p.id)).toHaveLength(maxDevices)
})
it('deactivation permits an authenticated transfer and denies former device renewals', async () => {
  const f = fixture(), p = f.authority.issue('Buyer', null, 'xzare-pos', { customerId: 'customer-1', maxDevices: 1 }), first = f.client(), second = f.client()
  await first.activate(p.code)
  expect(f.authority.deactivateDevice(p.id, first.device)).toEqual({ deactivated: true })
  expect(f.authority.listDevices(p.id)).toEqual([])
  await expect(first.renew()).rejects.toThrow()
  expect(first.status().readOnly).toBe(true)
  await second.activate(p.code)
  expect(f.authority.listDevices(p.id)[0]?.id).toBe(second.device)
  expect(() => f.authority.deactivateDevice('other-license', second.device)).toThrow()
})
it('binds fingerprint and name to the device proof and prevents identity replacement', async () => {
  const f = fixture(), p = f.authority.issue('Buyer', null, 'xzare-pos', { customerId: 'customer-1', maxDevices: 2 }), first = f.client(), request = first.request('activate', p.code)
  expect(request.fingerprint).toMatch(/^[a-f0-9]{64}$/)
  expect(() => f.authority.handle({ ...request, fingerprint: 'f'.repeat(64) })).toThrow()
  expect(() => f.authority.handle({ ...request, deviceName: 'Changed' })).toThrow()
  await first.activate(p.code)
  const clone = f.client(true, 'xzare-pos', request.fingerprint)
  await expect(clone.activate(p.code)).rejects.toThrow()
})
it('rejects signed purchase tampering and cross-product activation', async () => {
  const f = fixture(), p = f.authority.issue('Buyer', null, 'xzare-clinic', { customerId: 'customer-1', maxDevices: 2 }), wrong = f.client(), right = f.client(true, 'xzare-clinic')
  await expect(wrong.activate(p.code)).rejects.toThrow()
  const pieces = p.code.split('.'), body = JSON.parse(Buffer.from(pieces[1]!, 'base64url').toString())
  body.maxDevices = 1; pieces[1] = Buffer.from(JSON.stringify(body)).toString('base64url')
  await expect(right.activate(pieces.join('.'))).rejects.toThrow()
  await right.activate(p.code)
  expect(right.status().licensed).toBe(true)
})
it('migrates an already bound legacy entitlement without granting a second slot', async () => {
  const f = fixture(), first = f.client(), p = f.authority.issue('Legacy')
  // Simulates a database from the pre-device-table release.
  const request = first.request('activate', p.code)
  f.db.prepare('UPDATE license_accounts SET device=?,public_key=? WHERE id=?').run(request.device, request.publicKey, p.id)
  f.db.prepare('DELETE FROM license_devices').run()
  const authority = new LicenseAuthority(f.db, f.priv, f.now)
  expect(authority.listDevices(p.id)[0]?.id).toBe(first.device)
  await first.activate(p.code)
  await expect(f.client().activate(p.code)).rejects.toThrow()
})
it('rolls back license issuance when the enclosing verified-payment transaction fails', () => {
  const f = fixture()
  expect(() => f.db.transaction(() => {
    f.authority.issue('Buyer', null, 'xzare-pos', { customerId: 'customer-1', maxDevices: 1 })
    throw new Error('Fulfillment failure')
  })()).toThrow('Fulfillment failure')
  expect(f.db.prepare('SELECT COUNT(*) AS n FROM license_accounts').get()).toEqual({ n: 0 })
  expect(f.db.prepare('SELECT COUNT(*) AS n FROM license_events').get()).toEqual({ n: 0 })
})
it('imports offline authority replies only for the currently protected pending challenge', async () => {
  const f = fixture(), p = f.authority.issue('Buyer', null, 'xzare-pos', { customerId: 'customer-1', maxDevices: 1 }), client = f.client(false)
  const challenge = client.exportOfflineChallenge(p.code)
  expect(challenge.offline).toBe(true)
  expect(() => f.authority.handle(challenge)).toThrow()
  f.advance(60 * 60000)
  const response = f.authority.handle(challenge, { offline: true })
  expect(() => f.authority.handle(challenge, { offline: true })).toThrow()
  expect(client.importOfflineResponse(JSON.stringify(response)).licensed).toBe(true)
  expect(() => client.importOfflineResponse(JSON.stringify(response))).toThrow()
  expect(readFileSync(client.path).includes(Buffer.from(p.code))).toBe(false)
  const next = client.exportOfflineChallenge()
  expect(() => client.importOfflineResponse(JSON.stringify(response))).toThrow()
  f.advance(8 * 86400000)
  expect(() => f.authority.handle(next, { offline: true })).toThrow()
  expect(client.status().readOnly).toBe(true)
})
it('rejects arbitrary valid signed leases and superseded offline responses', () => {
  const f = fixture(), p = f.authority.issue('Buyer'), client = f.client(false), first = client.exportOfflineChallenge(p.code)
  const response = f.authority.handle(first, { offline: true })
  client.exportOfflineChallenge(p.code)
  expect(() => client.importOfflineResponse(JSON.stringify(response))).toThrow()
  const payload = Buffer.from(JSON.stringify({ product: 'xzare-pos', version: 2, nonce: 'a'.repeat(32), licenseId: p.id, customer: 'Buyer', device: client.device, issuedAt: f.now(), expiresAt: f.now() + 86400000 }))
  expect(() => client.importOfflineResponse(JSON.stringify({ lease: JSON.stringify({ payload: payload.toString('base64url'), signature: sign(null, payload, f.priv).toString('base64url') }) }))).toThrow()
})
it('persists an offline challenge across restart and rejects a lease on changed hardware', () => {
  const f = fixture(), p = f.authority.issue('Buyer', null, 'xzare-pos', { customerId: 'customer-1', maxDevices: 1 }), client = f.client(false)
  const challenge = client.exportOfflineChallenge(p.code), response = f.authority.handle(challenge, { offline: true })
  const restarted = new OnlineLicense(resolve(client.path, '..'), f.pub, { seal: (raw) => Buffer.from(raw), open: (raw) => raw.toString() }, null, f.now, undefined, 'xzare-pos', { fingerprint: challenge.fingerprint!, deviceName: challenge.deviceName! })
  expect(restarted.importOfflineResponse(JSON.stringify(response)).readOnly).toBe(false)
  const copied = new OnlineLicense(resolve(client.path, '..'), f.pub, { seal: (raw) => Buffer.from(raw), open: (raw) => raw.toString() }, null, f.now, undefined, 'xzare-pos', { fingerprint: 'f'.repeat(64), deviceName: 'Other machine' })
  expect(copied.status().readOnly).toBe(true)
})
it('expires the protected pending offline challenge after 24 hours', () => {
  const f = fixture(), p = f.authority.issue('Buyer'), client = f.client(false), challenge = client.exportOfflineChallenge(p.code)
  const response = f.authority.handle(challenge, { offline: true })
  f.advance(86400000 + 1)
  expect(() => client.importOfflineResponse(JSON.stringify(response))).toThrow()
  expect(() => f.authority.handle(challenge, { offline: true })).toThrow()
})
it('blocks setup bypass while exposing only first-run licensing operations', async () => {
  const f = fixture(), client = f.client(), runtime = new Runtime(resolve(client.path, '..'), f.pub, client.device, client); runtimes.push(runtime)
  const setup = { businessName: 'Buyer', username: 'owner', name: 'Owner', password: 'Commercial-test-password-123!' }
  await expect(runtime.call('setup', setup)).rejects.toThrow('التفعيل')
  expect(runtime.db.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 0 })
  expect(await runtime.call('boot.status')).toMatchObject({ configured: false, activationRequired: true, onlineConfigured: true })
  await expect(runtime.call('state')).rejects.toThrow()
  const p = f.authority.issue('Buyer', null, 'xzare-pos', { customerId: 'customer-1', maxDevices: 1 })
  await runtime.call('license.activate', { license: p.code })
  const { token } = await runtime.call('setup', setup) as { token: string }
  expect(await runtime.call('boot.status')).toEqual({ configured: true, activationRequired: false })
  await expect(runtime.call('license.activate', { license: p.code })).rejects.toThrow()
  f.advance(8 * 86400000)
  expect(((await runtime.call('state', {}, token)) as any).user.username).toBe('owner')
  await runtime.backup(token, join(resolve(client.path, '..'), 'readonly.xzbak'))
  await expect(runtime.call('party.save', { kind: 'customer', name: 'Mutation' }, token)).rejects.toThrow()
})
