import { afterEach, it, expect, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { generateKeyPairSync, sign } from 'node:crypto'
import { Runtime } from './runtime.js'
const folders: string[] = []
const runtimes: Runtime[] = []
vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>()
  return { ...original, renameSync: vi.fn(original.renameSync) }
})
afterEach(() => {
  runtimes.splice(0).forEach((r) => r.close())
  for (const dir of folders.splice(0)) {
    if (!resolve(dir).startsWith(resolve(tmpdir()) + '\\xzare-runtime-'))
      throw new Error('Unexpected cleanup path')
    rmSync(dir, { recursive: true, force: true })
  }
})
it('persists real records, validates restore, revokes sessions and preserves a recovery archive', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'xzare-runtime-'))
  folders.push(dir)
  const key = generateKeyPairSync('ed25519')
    .publicKey.export({ type: 'spki', format: 'pem' })
    .toString()
  const runtime = new Runtime(dir, key, 'a'.repeat(64))
  runtimes.push(runtime)
  const { token } = (await runtime.call('setup', {
    businessName: 'Runtime test',
    username: 'owner',
    name: 'Owner',
    password: 'Runtime-password-123!',
  })) as { token: string }
  const archive = join(dir, 'test.xzbak')
  await runtime.backup(token, archive)
  await runtime.call('party.save', { kind: 'customer', name: 'Created after backup' }, token)
  await expect(runtime.restore(token, 'wrong', archive)).rejects.toThrow()
  expect(((await runtime.call('state', {}, token)) as any).parties).toHaveLength(1)
  const restored = await runtime.restore(token, 'Runtime-password-123!', archive)
  expect(existsSync(restored.recovery)).toBe(true)
  await expect(runtime.call('state', {}, token)).rejects.toThrow()
  const logged = (await runtime.call('login', {
    username: 'owner',
    password: 'Runtime-password-123!',
  })) as { token: string }
  expect(((await runtime.call('state', {}, logged.token)) as any).parties).toHaveLength(0)
  runtime.close()
  const reopened = new Runtime(dir, key, 'a'.repeat(64))
  runtimes.push(reopened)
  expect(await reopened.call('auth.status', {})).toEqual({ configured: true })
})
it('keeps the live database available after rename failure and reports automatic backup failures', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'xzare-runtime-'))
  folders.push(dir)
  const keys = generateKeyPairSync('ed25519'),
    key = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const runtime = new Runtime(dir, key, 'a'.repeat(64))
  runtimes.push(runtime)
  const { token } = (await runtime.call('setup', {
    businessName: 'Failure test',
    username: 'owner',
    name: 'Owner',
    password: 'Runtime-password-123!',
  })) as { token: string }
  const archive = join(dir, 'test.xzbak')
  await runtime.backup(token, archive)
  const real = await vi.importActual<typeof import('node:fs')>('node:fs')
  vi.mocked(renameSync).mockImplementation((from, to) => {
    if (from === runtime.databasePath) throw new Error('EBUSY')
    real.renameSync(from, to)
  })
  await expect(runtime.restore(token, 'Runtime-password-123!', archive)).rejects.toThrow('EBUSY')
  expect(runtime.db.open).toBe(true)
  expect(((await runtime.call('state', {}, token)) as any).user.username).toBe('owner')
  vi.mocked(renameSync).mockImplementation(real.renameSync)
  const payload = Buffer.from(
    JSON.stringify({
      product: 'xzare-pos',
      version: 1,
      licenseId: 'test',
      customer: 'Actual test owner',
      device: 'a'.repeat(64),
      issuedAt: Date.now(),
      expiresAt: null,
    }),
  )
  await runtime.call(
    'license.activate',
    {
      license: JSON.stringify({
        payload: payload.toString('base64url'),
        signature: sign(null, payload, keys.privateKey).toString('base64url'),
      }),
    },
    token,
  )
  await runtime.restore(token, 'Runtime-password-123!', archive)
  expect(runtime.licenseStatus().licensed).toBe(true)
  // A separate healthy runtime with a blocked backup folder must stay usable.
  const blocked = mkdtempSync(join(tmpdir(), 'xzare-runtime-'))
  folders.push(blocked)
  const other = new Runtime(blocked, key, 'a'.repeat(64))
  runtimes.push(other)
  const logged = (await other.call('setup', {
    businessName: 'Backup test',
    username: 'owner',
    name: 'Owner',
    password: 'Runtime-password-123!',
  })) as { token: string }
  writeFileSync(join(blocked, 'backups'), 'blocked')
  await expect(other.dailyBackup()).resolves.toBeUndefined()
  expect(other.backupError).not.toBe('')
  expect(((await other.call('state', {}, logged.token)) as any).user.username).toBe('owner')
})
