import { it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ulid } from '@xzare/core'
import { Runtime } from './runtime.js'
import { validateBackup } from './backup.js'
import { openDatabase } from '@xzare/db'
it('binds CRM backups, restores client records and revokes sessions', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'xzare-crm-backup-')),
    r = new Runtime(join(dir, 'crm'), 'unused', 'a'.repeat(64), undefined, 'crm')
  try {
    const password = 'CRM-restore-secure-123!',
      { token } = (await r.call('setup', {
        businessName: 'QA CRM',
        name: 'QA',
        username: 'owner',
        password,
      })) as any
    const ownerId = r.engine.identity.require(token).id
    for (const a of ['invoice.post', 'stock.adjust', 'state', 'hr.state'])
      await expect(r.call(a, {}, token)).rejects.toThrow()
    const save = (name: string) =>
      r.call(
        'crm.contact.save',
        {
          code: name,
          name,
          company: '',
          phone: '',
          email: '',
          address: '',
          ownerId,
          note: '',
          active: true,
          clientTxnId: ulid(),
        },
        token,
      )
    await save('QA first')
    const file = join(dir, 'crm.xzbak')
    await r.backup(token, file)
    for (const p of ['pos', 'hr', 'pharmacy'] as const)
      expect(() => validateBackup(file, dir, p)).toThrow()
    await save('QA second')
    await r.restore(token, password, file)
    await expect(r.call('crm.state', {}, token)).rejects.toThrow()
    const login = (await r.call('login', { username: 'owner', password })) as any
    expect(
      ((await r.call('crm.state', {}, login.token)) as any).contacts.map((x: any) => x.name),
    ).toEqual(['QA first'])
    r.close()
    expect(() => openDatabase(join(dir, 'crm', 'xzare.sqlite'), 'pos')).toThrow('foreign')
  } finally {
    r.close()
    if (!dir.startsWith(join(tmpdir(), 'xzare-crm-backup-'))) throw new Error('unsafe cleanup')
    rmSync(dir, { recursive: true, force: true })
  }
})
