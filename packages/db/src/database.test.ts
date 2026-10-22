import { describe, it, expect } from 'vitest'
import { openDatabase } from './index.js'

describe('durable POS database', () => {
  it('migrates an empty database, enforces foreign keys and schema identity', () => {
    const db = openDatabase(':memory:')
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok')
    expect(db.prepare('SELECT version FROM schema_migrations').get()).toEqual({ version: 1 })
    expect(db.prepare('SELECT count(*) AS n FROM users').get()).toEqual({ n: 0 })
    db.close()
  })
  it('makes audit and stock ledgers append only', () => {
    const db = openDatabase(':memory:')
    db.prepare('INSERT INTO audit_log(id,user_id,action,entity_id,at) VALUES(?,?,?,?,?)').run(
      'a',
      null,
      'test',
      'x',
      1,
    )
    expect(() => db.prepare('UPDATE audit_log SET action=?').run('tamper')).toThrow()
    expect(() => db.prepare('DELETE FROM audit_log WHERE id=?').run('a')).toThrow()
    db.close()
  })
  it('rolls back a partially written transaction', () => {
    const db = openDatabase(':memory:')
    expect(() =>
      db.transaction(() => {
        db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run('test', 'x')
        throw new Error('power interruption')
      })(),
    ).toThrow()
    expect(db.prepare('SELECT value FROM settings WHERE key=?').get('test')).toBeUndefined()
    db.close()
  })
})
