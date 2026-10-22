import { afterEach, beforeEach, expect, it } from 'vitest'
import { openDatabase, type XzareDatabase } from '@xzare/db'
import { Identity } from './identity.js'
let db: XzareDatabase, identity: Identity, token: string, clock: number
beforeEach(async () => {
  clock = 0
  db = openDatabase(':memory:', 'restaurant')
  identity = new Identity(db, true, () => clock)
  token = (
    await identity.setup({
      businessName: 'Isolated security test',
      name: 'Owner',
      username: 'owner',
      password: 'Session-test-password-123!',
    })
  ).token
})
afterEach(() => db.close())
it('expires after ten minutes even when reads poll every minute', () => {
  for (let n = 1; n <= 9; n++) {
    clock = n * 60000
    expect(identity.require(token).role).toBe('admin')
  }
  clock = 600001
  expect(() => identity.require(token)).toThrow('انتهت الجلسة')
  expect(db.prepare('SELECT count(*) AS n FROM sessions').get()).toEqual({ n: 0 })
})
it('explicit user activity extends idle time without reviving expiry', () => {
  clock = 540000
  identity.activity(token)
  clock = 1080000
  expect(identity.require(token).role).toBe('admin')
  clock = 1140001
  expect(() => identity.activity(token)).toThrow('انتهت الجلسة')
  expect(() => identity.require(token)).toThrow('انتهت الجلسة')
})
it('rejects a stored session from a previous engine instance', () => {
  const restarted = new Identity(db, true, () => clock)
  expect(() => restarted.require(token)).toThrow('انتهت الجلسة')
})
it('activity cannot bypass absolute session expiry', () => {
  db.prepare('UPDATE sessions SET expires_at=?').run(Date.now() - 1)
  expect(() => identity.activity(token)).toThrow('انتهت الجلسة')
})
it('activity cannot bypass database session revocation', () => {
  db.prepare('DELETE FROM sessions').run()
  expect(() => identity.activity(token)).toThrow('انتهت الجلسة')
})
