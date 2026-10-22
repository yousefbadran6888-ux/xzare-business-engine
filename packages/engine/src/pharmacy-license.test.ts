import { expect, it } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '@xzare/db'
import { LicenseAuthority } from './license-authority.js'
import { OnlineLicense } from './online-license.js'
const protector = { seal: (raw: string) => Buffer.from(raw), open: (raw: Buffer) => raw.toString() }
it('cryptographically binds purchases, request proof and leases to the actual product', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'xzare-product-license-')),
    db = openDatabase(':memory:'),
    pair = generateKeyPairSync('ed25519')
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const authority = new LicenseAuthority(db, privateKey),
    now = () => 1800000000000
  try {
    const service = new LicenseAuthority(db, privateKey, now)
    const pos = service.issue('QA POS'),
      center = service.issue('QA Pharmacy', null, 'xzare-pharmacy')
    const client = new OnlineLicense(
      join(dir, 'pharmacy'),
      publicKey,
      protector,
      async (request) => service.handle(request),
      now,
      undefined,
      'xzare-pharmacy',
    )
    const other = service.issue('QA Restaurant', null, 'xzare-restaurant')
    await expect(client.activate(other.code)).rejects.toThrow()
    await expect(client.activate(pos.code)).rejects.toThrow()
    await expect(client.activate(center.code)).resolves.toMatchObject({ licensed: true })
    const r = client.request('renew', center.id)
    expect(() => service.handle({ ...r, product: 'xzare-pos' })).toThrow()
    const centerLease = service.handle(r).lease
    const wrongProduct = new OnlineLicense(
      join(dir, 'pos'),
      publicKey,
      protector,
      async () => ({ lease: centerLease }),
      now,
    )
    await expect(wrongProduct.activate(pos.code)).rejects.toThrow()
    expect(wrongProduct.status().readOnly).toBe(true)
    await expect(client.renew()).resolves.toMatchObject({ licensed: true })
    expect(() => service.issue('Unknown', null, 'foreign' as any)).toThrow()
  } finally {
    db.close()
    if (!dir.startsWith(join(tmpdir(), 'xzare-product-license-'))) throw new Error('unsafe cleanup')
    rmSync(dir, { recursive: true, force: true })
    void authority
  }
})
