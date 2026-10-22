import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname, basename } from 'node:path'
import { openDatabase, type XzareDatabase } from '@xzare/db'
import { createBackup, validateBackup } from './backup.js'
const folders: string[] = []
const connections: XzareDatabase[] = []
afterEach(() => {
  for (const db of connections.splice(0)) if (db.open) db.close()
  for (const p of folders.splice(0)) {
    if (
      dirname(resolve(p)) !== resolve(tmpdir()) ||
      !basename(resolve(p)).startsWith('xzare-backup-')
    )
      throw new Error('Unexpected temporary directory')
    rmSync(p, { recursive: true, force: true })
  }
})
describe('validated offline backups', () => {
  it('scrubs legacy license strings from snapshots without altering the live purchase', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xzare-backup-'))
    folders.push(dir)
    const db = openDatabase(join(dir, 'source.sqlite'))
    connections.push(db)
    const secret = 'SENSITIVE-LICENSE-NEVER-EXPORT-0123456789'
    db.prepare('INSERT INTO settings VALUES(?,?)').run('license', secret)
    const archive = join(dir, 'sanitized.xzbak')
    await createBackup(db, archive)
    const bytes = Buffer.from(JSON.parse(readFileSync(archive, 'utf8')).payload, 'base64')
    expect(bytes.includes(Buffer.from(secret))).toBe(false)
    expect(db.prepare("SELECT value FROM settings WHERE key='license'").get()).toEqual({
      value: secret,
    })
  })
  it('round trips a consistent snapshot and refuses tampered and foreign archives', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xzare-backup-'))
    folders.push(dir)
    const db = openDatabase(join(dir, 'source.sqlite'))
    connections.push(db)
    db.prepare('INSERT INTO settings VALUES(?,?)').run('businessName', 'Test backup business')
    const archive = join(dir, 'test.xzbak')
    await createBackup(db, archive)
    const candidate = validateBackup(archive, dir),
      restored = openDatabase(candidate.databasePath)
    expect(restored.prepare('SELECT value FROM settings WHERE key=?').get('businessName')).toEqual({
      value: 'Test backup business',
    })
    restored.close()
    db.close()
    const data = JSON.parse(readFileSync(archive, 'utf8')) as Record<string, unknown>
    data.sha256 = '0'.repeat(64)
    writeFileSync(archive, JSON.stringify(data))
    expect(() => validateBackup(archive, dir)).toThrow()
    data.format = 'foreign-app'
    writeFileSync(archive, JSON.stringify(data))
    expect(() => validateBackup(archive, dir)).toThrow()
    writeFileSync(archive, '{"format":')
    expect(() => validateBackup(archive, dir)).toThrow()
  })
})
