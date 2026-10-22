import { describe, expect, it } from 'vitest'
import { generateKeyPairSync, sign } from 'node:crypto'
import { verifyLicense } from './license.js'
describe('offline license verification', () => {
  it('accepts signed matching licenses and rejects tampering, expiry and wrong devices', () => {
    const keys = generateKeyPairSync('ed25519'),
      pub = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()
    const payload = JSON.stringify({
      product: 'xzare-pos',
      version: 1,
      licenseId: 'test-license',
      customer: 'Test customer',
      device: 'a'.repeat(64),
      issuedAt: 1000,
      expiresAt: 3000,
    })
    const raw = JSON.stringify({
      payload: Buffer.from(payload).toString('base64url'),
      signature: sign(null, Buffer.from(payload), keys.privateKey).toString('base64url'),
    })
    expect(verifyLicense(raw, pub, 'a'.repeat(64), 2000).customer).toBe('Test customer')
    expect(() => verifyLicense(raw, pub, 'b'.repeat(64), 2000)).toThrow()
    expect(() => verifyLicense(raw, pub, 'a'.repeat(64), 4000)).toThrow()
    const changed = JSON.parse(raw)
    changed.payload = Buffer.from(payload.replace('Test customer', 'Attacker')).toString(
      'base64url',
    )
    expect(() => verifyLicense(JSON.stringify(changed), pub, 'a'.repeat(64), 2000)).toThrow()
  })
})
