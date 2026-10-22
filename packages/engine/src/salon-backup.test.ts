import { it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ulid } from '@xzare/core'
import { Runtime } from './runtime.js'
import { validateBackup } from './backup.js'
import { openDatabase } from '@xzare/db'
it('Salon backups restore actual members, revoke sessions and reject other product files', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'xzare-salon-backup-')),
    r = new Runtime(
      join(dir, 'salon'),
      'unused',
      'a'.repeat(64),
      undefined,
      'salon',
    )
  try {
    const password = 'Salon-restore-123!',
      { token } = (await r.call('setup', {
        businessName: 'QA Center',
        name: 'QA',
        username: 'owner',
        password,
      })) as any
    for (const a of ['state', 'crm.state', 'hr.state', 'invoice.post'])
      await expect(r.call(a, {}, token)).rejects.toThrow()
    const save = (code: string) =>
      r.call(
        'sal.customer.save',
        {
          code,
          name: code,
          phone: '',

          note: '',
          active: true,
          clientTxnId: ulid(),
        },
        token,
      )
    await save('S01')
    const file = join(dir, 'salon.xzbak')
    await r.backup(token, file)
    for (const p of ['pos', 'education', 'hr'] as const)
      expect(() => validateBackup(file, dir, p)).toThrow()
    await save('S02')
    await r.restore(token, password, file)
    await expect(r.call('sal.state', {}, token)).rejects.toThrow()
    const login = (await r.call('login', {
      username: 'owner',
      password,
    })) as any
    expect(
      ((await r.call('sal.state', {}, login.token)) as any).customers.map(
        (x: any) => x.code,
      ),
    ).toEqual(['S01'])
    r.close()
    expect(() => openDatabase(join(dir, 'salon', 'xzare.sqlite'), 'crm')).toThrow(
      'foreign',
    )
  } finally {
    r.close()
    if (!dir.startsWith(join(tmpdir(), 'xzare-salon-backup-')))
      throw new Error('unsafe cleanup')
    rmSync(dir, { recursive: true, force: true })
  }
})
