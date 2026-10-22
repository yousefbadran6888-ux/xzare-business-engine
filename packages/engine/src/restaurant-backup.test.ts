import { expect, it } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { openDatabase } from '@xzare/db'
import { Runtime } from './runtime.js'
import { validateBackup } from './backup.js'
it('persists restaurant records, restores them with revoked sessions, and refuses cross-product backup substitution', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'xzare-restaurant-')),
    runtime = new Runtime(
      join(dir, 'restaurant'),
      'unused',
      'a'.repeat(64),
      undefined,
      'restaurant',
    )
  const backup = join(dir, 'restaurant.xzbak')
  try {
    const { token } = (await runtime.call('setup', {
      businessName: 'QA Restaurant',
      name: 'QA',
      username: 'owner',
      password: 'Restore-restaurant-password-123!',
    })) as { token: string }
    await runtime.call(
      'restaurant.table.save',
      { name: 'QA persisted', zone: 'QA', seats: 4 },
      token,
    )
    await runtime.backup(token, backup)
    await expect(
      runtime.call('restaurant.table.save', { name: 'Second', zone: 'QA', seats: 2 }, token),
    ).resolves.toBeDefined()
    expect(() => validateBackup(backup, dir)).toThrow()
    const envelope = JSON.parse(readFileSync(backup, 'utf8'))
    envelope.format = 'xzare-pos-backup'
    envelope.applicationId = 0x585a5053
    const forged = join(dir, 'forged.xzbak')
    writeFileSync(forged, JSON.stringify(envelope))
    expect(() => validateBackup(forged, dir)).toThrow()
    await runtime.restore(token, 'Restore-restaurant-password-123!', backup)
    await expect(runtime.call('restaurant.state', {}, token)).rejects.toThrow()
    const login = (await runtime.call('login', {
      username: 'owner',
      password: 'Restore-restaurant-password-123!',
    })) as { token: string }
    expect(
      ((await runtime.call('restaurant.state', {}, login.token)) as any).tables.map(
        (t: any) => t.name,
      ),
    ).toEqual(['QA persisted'])
    runtime.close()
    const reopened = new Runtime(
      join(dir, 'restaurant'),
      'unused',
      'a'.repeat(64),
      undefined,
      'restaurant',
    )
    expect(reopened.db.prepare('SELECT count(*) AS n FROM restaurant_tables').get()).toEqual({
      n: 1,
    })
    reopened.close()
    expect(() => openDatabase(join(dir, 'restaurant', 'xzare.sqlite'))).toThrow('foreign')
    envelope.format = 'xzare-restaurant-backup'
    envelope.applicationId = 0x585a5253
    const payload = Buffer.from(envelope.payload, 'base64'),
      dbPath = join(dir, 'tampered.sqlite')
    writeFileSync(dbPath, payload)
    const db = openDatabase(dbPath, 'restaurant')
    db.exec('DROP TRIGGER restaurant_line_snapshot')
    db.close()
    const bytes = readFileSync(dbPath)
    envelope.payload = bytes.toString('base64')
    envelope.sha256 = createHash('sha256').update(bytes).digest('hex')
    writeFileSync(forged, JSON.stringify(envelope))
    expect(() => validateBackup(forged, dir, 'restaurant')).toThrow('مخطط')
  } finally {
    runtime.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
