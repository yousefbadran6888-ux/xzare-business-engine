import { it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ulid } from '@xzare/core'
import { Runtime } from './runtime.js'
import { validateBackup } from './backup.js'
import { openDatabase } from '@xzare/db'
it('restores actual estate records, revokes sessions and rejects foreign product files', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'xzare-estate-backup-')),
    r = new Runtime(join(dir, 'estate'), 'unused', 'a'.repeat(64), undefined, 'real-estate')
  try {
    const password = 'Estate-restore-Strong-123!',
      { token } = (await r.call('setup', {
        businessName: 'QA Office',
        name: 'QA Owner',
        username: 'owner',
        password,
      })) as any
    const save = (code: string) =>
      r.call(
        're.contact.save',
        {
          clientTxnId: ulid(),
          kind: 'client',
          code,
          name: code,
          phone: '',
          document: '',
          note: '',
          active: true,
        },
        token,
      )
    await save('A01')
    const file = join(dir, 'estate.xzbak')
    await r.backup(token, file)
    for (const p of ['pos', 'hotel', 'salon', 'crm'] as const)
      expect(() => validateBackup(file, dir, p)).toThrow()
    await save('A02')
    await r.restore(token, password, file)
    await expect(r.call('re.state', {}, token)).rejects.toThrow()
    const login = (await r.call('login', { username: 'owner', password })) as any
    expect(
      ((await r.call('re.state', {}, login.token)) as any).contacts.map((c: any) => c.code),
    ).toEqual(['A01'])
    r.close()
    expect(() => openDatabase(join(dir, 'estate', 'xzare.sqlite'), 'hotel')).toThrow('foreign')
  } finally {
    r.close()
    if (!dir.startsWith(join(tmpdir(), 'xzare-estate-backup-'))) throw Error('unsafe cleanup')
    rmSync(dir, { recursive: true, force: true })
  }
})
