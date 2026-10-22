import { it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ulid } from '@xzare/core'
import { Runtime } from './runtime.js'
import { validateBackup } from './backup.js'
import { openDatabase } from '@xzare/db'
it('binds HR database and backups, restores employee files and revokes sessions', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'xzare-hr-backup-')),
    r = new Runtime(join(dir, 'hr'), 'unused', 'a'.repeat(64), undefined, 'hr' as any)
  try {
    const password = 'HR-restore-secure-123!',
      { token } = (await r.call('setup', {
        businessName: 'QA HR',
        name: 'QA',
        username: 'owner',
        password,
      })) as any
    for (const a of ['invoice.post', 'restaurant.table.save', 'stock.adjust', 'state'])
      await expect(r.call(a, {}, token)).rejects.toThrow()
    const save = (name: string) =>
      r.call(
        'hr.employee.save',
        {
          code: name,
          name,
          department: '',
          job: '',
          phone: '',
          email: '',
          hired: '2026-01-01',
          ended: '',
          note: '',
          active: true,
          clientTxnId: ulid(),
        },
        token,
      )
    await save('QA first')
    const file = join(dir, 'hr.xzbak')
    await r.backup(token, file)
    for (const p of ['pos', 'service-center', 'accounting'] as const)
      expect(() => validateBackup(file, dir, p)).toThrow()
    await save('QA second')
    await r.restore(token, password, file)
    await expect(r.call('hr.state', {}, token)).rejects.toThrow()
    const login = (await r.call('login', { username: 'owner', password })) as any
    expect(
      ((await r.call('hr.state', {}, login.token)) as any).employees.map((p: any) => p.name),
    ).toEqual(['QA first'])
    r.close()
    expect(() => openDatabase(join(dir, 'hr', 'xzare.sqlite'), 'pos')).toThrow('foreign')
  } finally {
    r.close()
    if (!dir.startsWith(join(tmpdir(), 'xzare-hr-backup-'))) throw new Error('unsafe cleanup')
    rmSync(dir, { recursive: true, force: true })
  }
})
