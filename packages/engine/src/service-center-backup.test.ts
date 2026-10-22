import { it, expect } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ulid } from '@xzare/core'
import { Runtime } from './runtime.js'
import { validateBackup } from './backup.js'
import { openDatabase } from '@xzare/db'
it('isolates service-center actions and backup identity; restores actual warehouses and revokes sessions', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'xzare-service-center-backup-')),
    r = new Runtime(
      join(dir, 'service-center'),
      'unused',
      'a'.repeat(64),
      undefined,
      'service-center',
    )
  try {
    const password = 'Service Center-restore-secure-123!',
      { token } = (await r.call('setup', {
        businessName: 'QA Service Center',
        name: 'QA',
        username: 'owner',
        password,
      })) as { token: string }
    for (const action of ['invoice.post', 'restaurant.table.save', 'stock.adjust', 'state'])
      await expect(r.call(action, {}, token)).rejects.toThrow()
    await r.call('inventory.warehouse.save', { name: 'QA actual', clientTxnId: ulid() }, token)
    const file = join(dir, 'service-center.xzbak')
    await r.backup(token, file)
    for (const product of ['pos', 'restaurant', 'workshop'] as const)
      expect(() => validateBackup(file, dir, product)).toThrow()
    const forged = JSON.parse(readFileSync(file, 'utf8'))
    forged.format = 'xzare-pos-backup'
    forged.applicationId = 0x585a5053
    const bad = join(dir, 'forged.xzbak')
    writeFileSync(bad, JSON.stringify(forged))
    expect(() => validateBackup(bad, dir)).toThrow()
    await r.call('inventory.warehouse.save', { name: 'Second', clientTxnId: ulid() }, token)
    await r.restore(token, password, file)
    await expect(r.call('service-center.state', {}, token)).rejects.toThrow()
    const login = (await r.call('login', { username: 'owner', password })) as { token: string }
    expect(
      ((await r.call('service-center.state', {}, login.token)) as any).warehouses.map(
        (a: any) => a.name,
      ),
    ).toEqual(['QA actual', 'المخزن الرئيسي'])
    r.close()
    expect(() => openDatabase(join(dir, 'service-center', 'xzare.sqlite'), 'restaurant')).toThrow(
      'foreign',
    )
  } finally {
    r.close()
    if (!dir.startsWith(join(tmpdir(), 'xzare-service-center-backup-')))
      throw new Error('unsafe cleanup')
    rmSync(dir, { recursive: true, force: true })
  }
})
