import { it, expect } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Runtime } from './runtime.js'
import { validateBackup } from './backup.js'
import { openDatabase } from '@xzare/db'
it('isolates accounting actions and backup identity; restores actual accounts and revokes sessions', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'xzare-accounting-backup-')),
    r = new Runtime(join(dir, 'accounting'), 'unused', 'a'.repeat(64), undefined, 'accounting')
  try {
    const password = 'Accounting-restore-secure-123!',
      { token } = (await r.call('setup', {
        businessName: 'QA Accounting',
        name: 'QA',
        username: 'owner',
        password,
      })) as { token: string }
    for (const action of ['invoice.post', 'restaurant.table.save', 'stock.adjust', 'state'])
      await expect(r.call(action, {}, token)).rejects.toThrow()
    await r.call(
      'accounting.account.save',
      { code: '100', name: 'QA actual', kind: 'asset' },
      token,
    )
    const file = join(dir, 'accounting.xzbak')
    await r.backup(token, file)
    for (const product of ['pos', 'restaurant'] as const)
      expect(() => validateBackup(file, dir, product)).toThrow()
    const forged = JSON.parse(readFileSync(file, 'utf8'))
    forged.format = 'xzare-pos-backup'
    forged.applicationId = 0x585a5053
    const bad = join(dir, 'forged.xzbak')
    writeFileSync(bad, JSON.stringify(forged))
    expect(() => validateBackup(bad, dir)).toThrow()
    await r.call('accounting.account.save', { code: '101', name: 'Second', kind: 'asset' }, token)
    await r.restore(token, password, file)
    await expect(r.call('accounting.state', {}, token)).rejects.toThrow()
    const login = (await r.call('login', { username: 'owner', password })) as { token: string }
    expect(
      ((await r.call('accounting.state', {}, login.token)) as any).accounts.map((a: any) => a.code),
    ).toEqual(['100'])
    r.close()
    expect(() => openDatabase(join(dir, 'accounting', 'xzare.sqlite'), 'restaurant')).toThrow(
      'foreign',
    )
  } finally {
    r.close()
    if (!dir.startsWith(join(tmpdir(), 'xzare-accounting-backup-')))
      throw new Error('unsafe cleanup')
    rmSync(dir, { recursive: true, force: true })
  }
})
