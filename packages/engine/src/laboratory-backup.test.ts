import { it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ulid } from '@xzare/core'
import { Runtime } from './runtime.js'
import { validateBackup } from './backup.js'
import { openDatabase } from '@xzare/db'
it('binds Laboratory database and backups, restores patients and revokes sessions', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'xzare-laboratory-backup-')),
    r = new Runtime(
      join(dir, 'laboratory'),
      'unused',
      'a'.repeat(64),
      undefined,
      'laboratory' as any,
    )
  try {
    const password = 'Laboratory-restore-secure-123!',
      { token } = (await r.call('setup', {
        businessName: 'QA Laboratory',
        name: 'QA',
        username: 'owner',
        password,
      })) as any
    for (const a of ['invoice.post', 'restaurant.table.save', 'stock.adjust', 'state'])
      await expect(r.call(a, {}, token)).rejects.toThrow()
    const save = (name: string) =>
      r.call(
        'laboratory.patient.save',
        {
          name,
          phone: '',
          birthDate: null,
          sex: 'unknown',
          address: '',
          active: true,
          clientTxnId: ulid(),
        },
        token,
      )
    await save('QA first')
    const file = join(dir, 'laboratory.xzbak')
    await r.backup(token, file)
    for (const p of ['pos', 'service-center', 'accounting'] as const)
      expect(() => validateBackup(file, dir, p)).toThrow()
    await save('QA second')
    await r.restore(token, password, file)
    await expect(r.call('laboratory.state', {}, token)).rejects.toThrow()
    const login = (await r.call('login', { username: 'owner', password })) as any
    expect(
      ((await r.call('laboratory.state', {}, login.token)) as any).patients.map((p: any) => p.name),
    ).toEqual(['QA first'])
    r.close()
    expect(() => openDatabase(join(dir, 'laboratory', 'xzare.sqlite'), 'pos')).toThrow('foreign')
  } finally {
    r.close()
    if (!dir.startsWith(join(tmpdir(), 'xzare-laboratory-backup-')))
      throw new Error('unsafe cleanup')
    rmSync(dir, { recursive: true, force: true })
  }
})
