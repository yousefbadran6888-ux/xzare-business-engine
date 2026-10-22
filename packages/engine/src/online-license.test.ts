import { it, expect, afterEach } from 'vitest'
import {
  generateKeyPairSync,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  sign,
} from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { openDatabase } from '@xzare/db'
import { LicenseAuthority } from './license-authority.js'
import { OnlineLicense, httpsTransport, type Protector } from './online-license.js'
const dirs: string[] = []
const dbs: ReturnType<typeof openDatabase>[] = []
afterEach(() => {
  dbs.splice(0).forEach((db) => db.close())
  for (const dir of dirs.splice(0)) {
    if (!resolve(dir).startsWith(resolve(tmpdir()) + '\\xzare-online-'))
      throw new Error('Unsafe cleanup')
    rmSync(dir, { recursive: true, force: true })
  }
})
function fixture() {
  const pair = generateKeyPairSync('ed25519')
  const pub = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const priv = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const db = openDatabase(':memory:')
  dbs.push(db)
  let now = Date.now()
  const authority = new LicenseAuthority(db, priv, () => now)
  // Test protector only: production uses Windows DPAPI, never a shipped AES key.
  const key = randomBytes(32)
  const protector: Protector = {
    seal: (raw) => {
      const iv = randomBytes(12),
        c = createCipheriv('aes-256-gcm', key, iv)
      const body = Buffer.concat([c.update(raw, 'utf8'), c.final()])
      return Buffer.concat([iv, c.getAuthTag(), body])
    },
    open: (raw) => {
      const c = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12))
      c.setAuthTag(raw.subarray(12, 28))
      return Buffer.concat([c.update(raw.subarray(28)), c.final()]).toString()
    },
  }
  const client = () => {
    const dir = mkdtempSync(join(tmpdir(), 'xzare-online-'))
    dirs.push(dir)
    return new OnlineLicense(
      dir,
      pub,
      protector,
      (request) => Promise.resolve(authority.handle(request)),
      () => now,
    )
  }
  return {
    authority,
    client,
    pub,
    priv,
    protector,
    advance: (ms: number) => {
      now += ms
    },
    now: () => now,
  }
}
it('one purchase binds one device; signed renewals work without retaining the activation code', async () => {
  const f = fixture(),
    purchase = f.authority.issue('Real test purchaser'),
    first = f.client(),
    second = f.client()
  await first.activate(purchase.code)
  expect(first.status().licensed).toBe(true)
  await expect(second.activate(purchase.code)).rejects.toThrow()
  await first.renew()
  expect(readFileSync(first.path).includes(Buffer.from(purchase.code))).toBe(false)
  expect(readFileSync(first.path).includes(Buffer.from('PRIVATE KEY'))).toBe(false)
  expect(JSON.stringify(first.status())).not.toContain(purchase.code)
  expect(f.authority.db.prepare('SELECT code_hash FROM license_accounts').get()).not.toEqual({
    code_hash: purchase.code,
  })
})
it('offline works only for the signed grace period; revocation stops a renewed device', async () => {
  const f = fixture(),
    purchase = f.authority.issue('Grace test'),
    client = f.client()
  await client.activate(purchase.code)
  f.advance(6 * 86400000)
  expect(client.status().licensed).toBe(true)
  f.advance(2 * 86400000)
  expect(client.status().readOnly).toBe(true)
  f.authority.revoke(purchase.id)
  await expect(client.renew()).rejects.toThrow()
  expect(client.status().readOnly).toBe(true)
})
it('rejects replay, altered signatures and different-machine protected storage', async () => {
  const f = fixture(),
    purchase = f.authority.issue('Proof test'),
    client = f.client()
  const request = client.request('activate', purchase.code)
  f.authority.handle(request)
  expect(() => f.authority.handle(request)).toThrow()
  expect(() => f.authority.handle({ ...request, nonce: 'a'.repeat(32) })).toThrow()
  await client.activate(purchase.code)
  expect(
    () =>
      new OnlineLicense(
        resolve(client.path, '..'),
        f.pub,
        {
          seal: (raw) => Buffer.from(raw),
          open: () => {
            throw new Error('Wrong Windows user')
          },
        },
        () => Promise.reject(new Error('offline')),
        f.now,
      ),
  ).toThrow()
})
it('network failure does not extend grace and invalid signatures never activate', async () => {
  const f = fixture(),
    purchase = f.authority.issue('Network test'),
    client = f.client()
  await client.activate(purchase.code)
  const original = client.status().expiresAt
  const offline = new OnlineLicense(
    resolve(client.path, '..'),
    f.pub,
    f.protector,
    () => Promise.reject(new Error('Offline')),
    f.now,
  )
  await expect(offline.renew()).rejects.toThrow()
  expect(offline.status().licensed).toBe(true)
  expect(offline.status().expiresAt).toBe(original)
  f.advance(8 * 86400000)
  expect(offline.status().readOnly).toBe(true)
})
it('a new or replaced protected installation cannot obtain a free resettable trial', () => {
  const f = fixture()
  expect(f.client().status().readOnly).toBe(true)
  expect(f.client().status().days).toBe(0)
})
it('rejects a forged lease and an issuer-signed perpetual or overlong lease', async () => {
  for (const expiry of [null, 8 * 86400000, 7 * 86400000]) {
    const f = fixture(),
      client = f.client()
    const invalid = new OnlineLicense(
      resolve(client.path, '..'),
      f.pub,
      f.protector,
      (request) => {
        const body = Buffer.from(
          JSON.stringify({
            product: 'xzare-pos',
            version: 2,
            nonce: request.nonce,
            licenseId: 'bounded-test',
            customer: 'Signature test',
            device: request.device,
            issuedAt: f.now(),
            expiresAt: expiry === null ? null : f.now() + expiry,
          }),
        )
        const sig = expiry === 7 * 86400000 ? randomBytes(64) : sign(null, body, f.priv)
        return Promise.resolve({
          lease: JSON.stringify({
            payload: body.toString('base64url'),
            signature: sig.toString('base64url'),
          }),
        })
      },
      f.now,
    )
    await expect(invalid.activate(randomBytes(32).toString('base64url'))).rejects.toThrow()
    expect(invalid.status().licensed).toBe(false)
  }
})
it('a cached signed response cannot reactivate a revoked license for another request', async () => {
  const f = fixture(),
    purchase = f.authority.issue('Reply replay test'),
    client = f.client()
  let cached: { lease: string } | undefined
  const active = new OnlineLicense(
    resolve(client.path, '..'),
    f.pub,
    f.protector,
    (request) => {
      cached = f.authority.handle(request)
      return Promise.resolve(cached)
    },
    f.now,
  )
  await active.activate(purchase.code)
  f.authority.revoke(purchase.id)
  await expect(active.renew()).rejects.toThrow()
  const replay = new OnlineLicense(
    resolve(client.path, '..'),
    f.pub,
    f.protector,
    () => Promise.resolve(cached!),
    f.now,
  )
  await expect(replay.renew()).rejects.toThrow()
  expect(replay.status().readOnly).toBe(true)
})
it('same-boot snapshots/frozen wall clocks cannot extend grace, and a new boot needs fresh authority', async () => {
  const f = fixture(),
    purchase = f.authority.issue('Snapshot replay test'),
    client = f.client()
  let up = 1000000
  const clock = { uptime: () => up, bootId: 'boot-a', requireOnlineAfterReboot: true }
  const active = new OnlineLicense(
    resolve(client.path, '..'),
    f.pub,
    f.protector,
    (request) => Promise.resolve(f.authority.handle(request)),
    f.now,
    clock,
  )
  await active.activate(purchase.code)
  const snapshot = readFileSync(active.path)
  up += 8 * 86400000 // Wall clock deliberately stays frozen.
  writeFileSync(active.path, snapshot)
  const replay = new OnlineLicense(
    resolve(client.path, '..'),
    f.pub,
    f.protector,
    null,
    f.now,
    clock,
  )
  expect(replay.status().readOnly).toBe(true)
  writeFileSync(active.path, snapshot)
  const rebooted = new OnlineLicense(resolve(client.path, '..'), f.pub, f.protector, null, f.now, {
    ...clock,
    bootId: 'boot-b',
    uptime: () => 1000,
  })
  expect(rebooted.status().connectionRequired).toBe(true)
  expect(rebooted.status().readOnly).toBe(true)
})
it('persists clock rollback protection and never imports altered ciphertext as a fresh trial', async () => {
  const f = fixture(),
    purchase = f.authority.issue('Clock test'),
    client = f.client()
  await client.activate(purchase.code)
  f.advance(10 * 60000)
  client.status()
  f.advance(-8 * 60000)
  const restarted = new OnlineLicense(
    resolve(client.path, '..'),
    f.pub,
    f.protector,
    () => Promise.reject(new Error('Offline')),
    f.now,
  )
  expect(restarted.status().readOnly).toBe(true)
  expect(restarted.status().clockRollback).toBe(true)
  const raw = readFileSync(client.path)
  raw[raw.length - 1] = (raw[raw.length - 1] ?? 0) ^ 1
  writeFileSync(client.path, raw)
  expect(
    () => new OnlineLicense(resolve(client.path, '..'), f.pub, f.protector, null, f.now),
  ).toThrow()
})
it('caps grace at purchase expiry and renews an expired grace only while the purchase is active', async () => {
  const f = fixture(),
    purchase = f.authority.issue('Term test', f.now() + 2 * 86400000),
    client = f.client()
  await client.activate(purchase.code)
  expect(client.status().expiresAt).toBe(f.now() + 2 * 86400000)
  f.advance(3 * 86400000)
  await expect(client.renew()).rejects.toThrow()
  const perpetual = f.authority.issue('Perpetual paid purchase'),
    second = f.client()
  await second.activate(perpetual.code)
  f.advance(8 * 86400000)
  expect(second.status().readOnly).toBe(true)
  await second.renew()
  expect(second.status().readOnly).toBe(false)
})
it('publisher transport rejects HTTP, credentials, paths and user-controlled redirect origins', () => {
  for (const origin of [
    'http://example.com',
    'https://u:p@example.com',
    'https://example.com/other',
    'https://example.com/?secret=x',
    'https://example.com/#other',
  ])
    expect(() => httpsTransport(origin)).toThrow()
})
it('fresh signed renewal repairs an accidental forward clock jump after the user corrects Windows time', async () => {
  const f = fixture(),
    purchase = f.authority.issue('Clock recovery test'),
    client = f.client()
  const started = f.now()
  await client.activate(purchase.code)
  f.advance(30 * 86400000)
  expect(client.status().readOnly).toBe(true)
  f.advance(-30 * 86400000)
  expect(client.status().clockRollback).toBe(true)
  await client.renew()
  expect(client.status().clockRollback).toBe(false)
  expect(client.status().readOnly).toBe(false)
  expect(client.status().expiresAt).toBe(started + 7 * 86400000)
})
