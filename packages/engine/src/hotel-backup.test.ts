import { it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ulid } from '@xzare/core'
import { Runtime } from './runtime.js'
import { validateBackup } from './backup.js'
import { openDatabase } from '@xzare/db'
it('Hotel backups restore actual members, revoke sessions and reject other product files', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'xzare-hotel-backup-')),
    r = new Runtime(
      join(dir, 'hotel'),
      'unused',
      'a'.repeat(64),
      undefined,
      'hotel',
    )
  try {
    const password = 'Hotel-restore-123!',
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
        'hotel.guest.save',
        {
          code,
          name: code,
          phone: '',
          document: '',

          note: '',
          active: true,
          clientTxnId: ulid(),
        },
        token,
      )
    await save('S01')
    const file = join(dir, 'hotel.xzbak')
    await r.backup(token, file)
    for (const p of ['pos', 'education', 'hr'] as const)
      expect(() => validateBackup(file, dir, p)).toThrow()
    await save('S02')
    await r.restore(token, password, file)
    await expect(r.call('hotel.state', {}, token)).rejects.toThrow()
    const login = (await r.call('login', {
      username: 'owner',
      password,
    })) as any
    expect(
      ((await r.call('hotel.state', {}, login.token)) as any).guests.map(
        (x: any) => x.code,
      ),
    ).toEqual(['S01'])
    r.close()
    expect(() =>
      openDatabase(join(dir, 'hotel', 'xzare.sqlite'), 'crm'),
    ).toThrow('foreign')
  } finally {
    r.close()
    if (!dir.startsWith(join(tmpdir(), 'xzare-hotel-backup-')))
      throw new Error('unsafe cleanup')
    rmSync(dir, { recursive: true, force: true })
  }
})
