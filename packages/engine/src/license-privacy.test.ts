import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Runtime } from './runtime.js'
let runtime: Runtime | undefined, dir: string | undefined
afterEach(() => {
  runtime?.close()
  if (dir && resolve(dir).startsWith(resolve(tmpdir()) + '\\xzare-privacy-'))
    rmSync(dir, { recursive: true, force: true })
})
it('only administrators receive licensing device and customer metadata', async () => {
  dir = mkdtempSync(join(tmpdir(), 'xzare-privacy-'))
  runtime = new Runtime(dir, 'unused-test-public-key', 'a'.repeat(64), undefined, 'restaurant')
  const owner = (await runtime.call('setup', {
    businessName: 'Isolated license privacy',
    name: 'Owner',
    username: 'owner',
    password: 'License-test-password-123!',
  })) as { token: string }
  await runtime.call(
    'user.save',
    {
      name: 'Cook',
      username: 'cook',
      role: 'kitchen',
      password: 'Kitchen-test-password-123!',
      active: true,
    },
    owner.token,
  )
  const cook = (await runtime.call('login', {
    username: 'cook',
    password: 'Kitchen-test-password-123!',
  })) as { token: string }
  expect(await runtime.call('license.status', {}, owner.token)).toMatchObject({
    device: 'a'.repeat(64),
  })
  expect(await runtime.call('license.status', {}, cook.token)).toMatchObject({
    device: '',
    customer: '',
  })
  await expect(runtime.call('session.activity', { extra: true }, cook.token)).rejects.toThrow()
  expect(await runtime.call('session.activity', {}, cook.token)).toEqual({ active: true })
  await runtime.call('logout', {}, cook.token)
  await expect(runtime.call('session.activity', {}, cook.token)).rejects.toThrow()
})
