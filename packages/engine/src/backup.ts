import {
  openDatabase,
  openReadonlyDatabase,
  SCHEMA_VERSION,
  applicationId,
  type ProductKind,
  type XzareDatabase,
} from '@xzare/db'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { readFileSync, writeFileSync, renameSync, unlinkSync, statSync, mkdirSync } from 'node:fs'
import { z } from 'zod'
const maxSize = 128 * 1024 * 1024
const checksum = (data: Buffer | string) => createHash('sha256').update(data).digest('hex')
const schemaHash = (db: XzareDatabase) =>
  checksum(
    JSON.stringify(
      db
        .prepare(
          "SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type,name",
        )
        .all(),
    ),
  )
const expectedSchemas = new Map<ProductKind,string>()
const manifest = (product: ProductKind) => z
  .object({
    format: z.literal(`xzare-${product}-backup`),
    version: z.literal(1),
    applicationId: z.literal(applicationId(product)),
    schemaVersion: z.literal(SCHEMA_VERSION),
    databaseId: z.string().uuid(),
    businessName: z.string().max(160),
    createdAt: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    payload: z.string().min(1).max(maxSize),
  })
  .strict()
export async function createBackup(db: XzareDatabase, target: string, product: ProductKind = 'pos'): Promise<void> {
  if(db.pragma('application_id',{simple:true}) !== applicationId(product)) throw new Error('النسخة تخص برنامجًا آخر')
  mkdirSync(dirname(target), { recursive: true })
  const snapshot = join(dirname(target), `snapshot-${randomUUID()}.sqlite`),
    staging = target + '.' + randomUUID() + '.tmp'
  try {
    await db.backup(snapshot)
    // License secrets must never travel with business backups, including legacy records.
    const sanitized = openDatabase(snapshot, product)
    try {
      sanitized.pragma('secure_delete=ON')
      sanitized
        .prepare(
          "DELETE FROM settings WHERE key IN ('license','devicePrivateKey','activationCode')",
        )
        .run()
      sanitized.pragma('wal_checkpoint(TRUNCATE)')
      sanitized.exec('VACUUM')
      sanitized.pragma('wal_checkpoint(TRUNCATE)')
    } finally {
      sanitized.close()
    }
    const bytes = readFileSync(snapshot)
    if (bytes.length > 90 * 1024 * 1024)
      throw new Error('حجم النسخة أكبر من الحد الحالي؛ تواصل مع دعم Xzare لتصدير قاعدة البيانات')
    const settings = Object.fromEntries(
      (db.prepare('SELECT key,value FROM settings').all() as { key: string; value: string }[]).map(
        (r) => [r.key, r.value],
      ),
    )
    writeFileSync(
      staging,
      JSON.stringify({
        format: `xzare-${product}-backup`,
        version: 1,
        applicationId: applicationId(product),
        schemaVersion: SCHEMA_VERSION,
        databaseId: settings.database_id,
        businessName: settings.businessName ?? '',
        createdAt: Date.now(),
        sha256: checksum(bytes),
        payload: bytes.toString('base64'),
      }),
      { mode: 0o600, flag: 'wx' },
    )
    renameSync(staging, target)
  } finally {
    for (const path of [snapshot, staging]) {
      try {
        unlinkSync(path)
      } catch {}
    }
  }
}
export function validateBackup(
  source: string,
  directory: string,
  product: ProductKind = 'pos',
): { databasePath: string; businessName: string } {
  if (statSync(source).size > maxSize) throw new Error('ملف النسخة أكبر من الحد المسموح')
  const parsed = manifest(product).safeParse(JSON.parse(readFileSync(source, 'utf8')))
  if (!parsed.success) throw new Error('ملف النسخة غير صالح أو يخص برنامجًا آخر')
  const data = parsed.data,
    bytes = Buffer.from(data.payload, 'base64')
  if (bytes.toString('base64') !== data.payload || checksum(bytes) !== data.sha256)
    throw new Error('النسخة ناقصة أو تعرضت للتلف')
  mkdirSync(directory, { recursive: true })
  const candidate = join(directory, `restore-${randomUUID()}.sqlite`)
  writeFileSync(candidate, bytes, { mode: 0o600, flag: 'wx' })
  let db: XzareDatabase | undefined
  try {
    db = openReadonlyDatabase(candidate)
    if (
      db.pragma('application_id', { simple: true }) !== applicationId(product) ||
      db.pragma('user_version', { simple: true }) !== SCHEMA_VERSION ||
      db.pragma('integrity_check', { simple: true }) !== 'ok' ||
      (db.pragma('foreign_key_check') as unknown[]).length
    )
      throw new Error('فشل التحقق من سلامة قاعدة البيانات')
    if (!expectedSchemas.has(product)) {
      const template = openDatabase(':memory:',product)
      expectedSchemas.set(product,schemaHash(template))
      template.close()
    }
    if (schemaHash(db) !== expectedSchemas.get(product))
      throw new Error('مخطط قاعدة البيانات أو حماية السجلات لا يطابق Xzare')
    const identity = db.prepare('SELECT value FROM settings WHERE key=?').get('database_id') as
      { value: string } | undefined
    if (identity?.value !== data.databaseId) throw new Error('هوية قاعدة البيانات لا تطابق النسخة')
    if (
      !db.prepare("SELECT id FROM users WHERE role='admin' AND active=1 LIMIT 1").get() &&
      db.prepare('SELECT id FROM users LIMIT 1').get()
    )
      throw new Error('لا يوجد مسؤول نشط في النسخة')
    db.close()
    db = undefined
    return { databasePath: candidate, businessName: data.businessName }
  } catch (error) {
    db?.close()
    unlinkSync(candidate)
    throw error
  }
}
