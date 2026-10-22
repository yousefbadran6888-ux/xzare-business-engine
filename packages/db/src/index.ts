import {
  realEstateSchema,
  realEstateImmutableTables,
  REAL_ESTATE_APPLICATION_ID,
} from './real-estate-schema.js'
export { REAL_ESTATE_APPLICATION_ID }
import { hotelSchema, hotelImmutableTables, HOTEL_APPLICATION_ID } from './hotel-schema.js'
export { HOTEL_APPLICATION_ID }
import { salonSchema, salonImmutableTables, SALON_APPLICATION_ID } from './salon-schema.js'
export { SALON_APPLICATION_ID }
import { gymSchema, gymImmutableTables, GYM_APPLICATION_ID } from './gym-schema.js'
export { GYM_APPLICATION_ID }
import {
  pharmacySchema,
  pharmacyImmutableTables,
  PHARMACY_APPLICATION_ID,
} from './pharmacy-schema.js'
export { PHARMACY_APPLICATION_ID }
import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { schema, APPLICATION_ID, SCHEMA_VERSION, immutableTables } from './schema.js'
import {
  restaurantSchema,
  restaurantImmutableTables,
  RESTAURANT_APPLICATION_ID,
} from './restaurant-schema.js'

import {
  accountingSchema,
  accountingImmutableTables,
  ACCOUNTING_APPLICATION_ID,
} from './accounting-schema.js'
export { APPLICATION_ID, SCHEMA_VERSION, ACCOUNTING_APPLICATION_ID }
export { RESTAURANT_APPLICATION_ID }
import {
  inventorySchema,
  inventoryImmutableTables,
  INVENTORY_APPLICATION_ID,
} from './inventory-schema.js'
import {
  manufacturingSchema,
  manufacturingImmutableTables,
  MANUFACTURING_APPLICATION_ID,
} from './manufacturing-schema.js'
import {
  workshopSchema,
  workshopImmutableTables,
  WORKSHOP_APPLICATION_ID,
} from './workshop-schema.js'
import {
  serviceCenterSchema,
  serviceCenterImmutableTables,
  SERVICE_CENTER_APPLICATION_ID,
} from './service-center-schema.js'
import {
  laboratorySchema,
  laboratoryImmutableTables,
  LABORATORY_APPLICATION_ID,
} from './laboratory-schema.js'
export { LABORATORY_APPLICATION_ID }
import { clinicSchema, clinicImmutableTables, CLINIC_APPLICATION_ID } from './clinic-schema.js'
export { CLINIC_APPLICATION_ID }
import { hrSchema, hrImmutableTables, HR_APPLICATION_ID } from './hr-schema.js'
export { HR_APPLICATION_ID }
import {
  educationSchema,
  educationImmutableTables,
  EDUCATION_APPLICATION_ID,
} from './education-schema.js'
export { EDUCATION_APPLICATION_ID }
import { crmSchema, crmImmutableTables, CRM_APPLICATION_ID } from './crm-schema.js'
export { CRM_APPLICATION_ID }
export type ProductKind =
  | 'pos'
  | 'restaurant'
  | 'accounting'
  | 'inventory'
  | 'manufacturing'
  | 'workshop'
  | 'service-center'
  | 'clinic'
  | 'laboratory'
  | 'pharmacy'
  | 'hr'
  | 'crm'
  | 'education'
  | 'gym'
  | 'salon'
  | 'hotel'
  | 'real-estate'
export function applicationId(product: ProductKind) {
  return product === 'real-estate'
    ? REAL_ESTATE_APPLICATION_ID
    : product === 'hotel'
      ? HOTEL_APPLICATION_ID
      : product === 'salon'
        ? SALON_APPLICATION_ID
        : product === 'gym'
          ? GYM_APPLICATION_ID
          : product === 'education'
            ? EDUCATION_APPLICATION_ID
            : product === 'crm'
              ? CRM_APPLICATION_ID
              : product === 'hr'
                ? HR_APPLICATION_ID
                : product === 'pharmacy'
                  ? PHARMACY_APPLICATION_ID
                  : product === 'laboratory'
                    ? LABORATORY_APPLICATION_ID
                    : product === 'clinic'
                      ? CLINIC_APPLICATION_ID
                      : product === 'service-center'
                        ? SERVICE_CENTER_APPLICATION_ID
                        : product === 'workshop'
                          ? WORKSHOP_APPLICATION_ID
                          : product === 'manufacturing'
                            ? MANUFACTURING_APPLICATION_ID
                            : product === 'inventory'
                              ? INVENTORY_APPLICATION_ID
                              : product === 'accounting'
                                ? ACCOUNTING_APPLICATION_ID
                                : product === 'restaurant'
                                  ? RESTAURANT_APPLICATION_ID
                                  : APPLICATION_ID
}
export function openDatabase(path: string, product: ProductKind = 'pos'): Database.Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
  try {
    db.pragma('foreign_keys = ON')
    db.pragma('recursive_triggers = ON')
    db.pragma('busy_timeout = 5000')
    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = FULL')
    db.pragma('trusted_schema = OFF')
    const tables = db
      .prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'")
      .get() as { n: number }
    if (tables.n === 0) {
      db.transaction(() => {
        db.exec(
          product === 'real-estate'
            ? schema + realEstateSchema
            : product === 'hotel'
              ? schema + hotelSchema
              : product === 'salon'
                ? schema.replace(
                    "('admin','manager','cashier')",
                    "('admin','manager','cashier','stylist')",
                  ) + salonSchema
                : product === 'gym'
                  ? schema.replace(
                      "('admin','manager','cashier')",
                      "('admin','manager','cashier','trainer')",
                    ) + gymSchema
                  : product === 'education'
                    ? schema.replace(
                        "('admin','manager','cashier')",
                        "('admin','manager','cashier','teacher')",
                      ) + educationSchema
                    : product === 'crm'
                      ? schema + crmSchema
                      : product === 'hr'
                        ? schema.replace(
                            "('admin','manager','cashier')",
                            "('admin','manager','hr','payroll')",
                          ) + hrSchema
                        : product === 'pharmacy'
                          ? schema + pharmacySchema
                          : product === 'laboratory'
                            ? schema.replace(
                                "('admin','manager','cashier')",
                                "('admin','manager','cashier','technician')",
                              ) + laboratorySchema
                            : product === 'clinic'
                              ? schema.replace(
                                  "('admin','manager','cashier')",
                                  "('admin','manager','cashier','doctor')",
                                ) + clinicSchema
                              : product === 'service-center'
                                ? schema + inventorySchema + serviceCenterSchema
                                : product === 'workshop'
                                  ? schema + inventorySchema + workshopSchema
                                  : product === 'manufacturing'
                                    ? schema + inventorySchema + manufacturingSchema
                                    : product === 'inventory'
                                      ? schema + inventorySchema
                                      : product === 'restaurant'
                                        ? schema.replace(
                                            "('admin','manager','cashier')",
                                            "('admin','manager','cashier','kitchen')",
                                          ) + restaurantSchema
                                        : product === 'accounting'
                                          ? schema + accountingSchema
                                          : schema,
        )
        for (const table of [
          ...immutableTables,
          ...(product === 'real-estate'
            ? realEstateImmutableTables
            : product === 'hotel'
              ? hotelImmutableTables
              : product === 'salon'
                ? salonImmutableTables
                : product === 'gym'
                  ? gymImmutableTables
                  : product === 'education'
                    ? educationImmutableTables
                    : product === 'crm'
                      ? crmImmutableTables
                      : product === 'hr'
                        ? hrImmutableTables
                        : product === 'pharmacy'
                          ? pharmacyImmutableTables
                          : product === 'laboratory'
                            ? laboratoryImmutableTables
                            : product === 'clinic'
                              ? clinicImmutableTables
                              : product === 'service-center'
                                ? [...inventoryImmutableTables, ...serviceCenterImmutableTables]
                                : product === 'workshop'
                                  ? [...inventoryImmutableTables, ...workshopImmutableTables]
                                  : product === 'manufacturing'
                                    ? [...inventoryImmutableTables, ...manufacturingImmutableTables]
                                    : product === 'inventory'
                                      ? inventoryImmutableTables
                                      : product === 'restaurant'
                                        ? restaurantImmutableTables
                                        : product === 'accounting'
                                          ? accountingImmutableTables
                                          : []),
        ]) {
          for (const action of ['UPDATE', 'DELETE']) {
            db.exec(
              `CREATE TRIGGER ${table}_${action.toLowerCase()} BEFORE ${action} ON ${table} BEGIN SELECT RAISE(ABORT,'Immutable ledger'); END`,
            )
          }
        }
        db.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(SCHEMA_VERSION, Date.now())
        db.prepare('INSERT INTO settings VALUES(?,?)').run('database_id', randomUUID())
        db.pragma(`application_id = ${applicationId(product)}`)
        db.pragma(`user_version = ${SCHEMA_VERSION}`)
      })()
    }
    if (
      db.pragma('application_id', { simple: true }) !== applicationId(product) ||
      db.pragma('user_version', { simple: true }) !== SCHEMA_VERSION
    )
      throw new Error('Unsupported or foreign database')
    if (
      db.pragma('integrity_check', { simple: true }) !== 'ok' ||
      (db.pragma('foreign_key_check') as unknown[]).length > 0
    )
      throw new Error('Database integrity check failed')
    return db
  } catch (error) {
    db.close()
    throw error
  }
}
export type XzareDatabase = Database.Database
export function openReadonlyDatabase(path: string): XzareDatabase {
  const db = new Database(path, { readonly: true, fileMustExist: true })
  db.pragma('trusted_schema=OFF')
  db.pragma('foreign_keys=ON')
  return db
}
