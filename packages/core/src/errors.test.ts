import { describe, expect, it } from 'vitest'
import {
  businessRuleError,
  conflictError,
  ErrorCode,
  infrastructureError,
  integrityError,
  licenseError,
  notFoundError,
  permissionDeniedError,
  unexpectedError,
  validationError,
  XzareError,
} from './errors.js'

describe('XzareError', () => {
  it('carries a user-facing key alongside a developer message', () => {
    const error = validationError('error.validation.invalid_amount', 'amount failed to parse', {
      params: { field: 'total' },
      details: 'raw input: "abc"',
    })
    expect(error).toBeInstanceOf(Error)
    expect(error.code).toBe(ErrorCode.VALIDATION)
    expect(error.messageKey).toBe('error.validation.invalid_amount')
    expect(error.message).toBe('amount failed to parse')
    expect(error.params).toEqual({ field: 'total' })
    expect(error.details).toBe('raw input: "abc"')
  })

  it('exposes only translatable data to the user', () => {
    const error = businessRuleError('error.stock.insufficient', 'stock would go negative', {
      params: { product: 'Shampoo', available: 2 },
      details: 'variant 01J... warehouse 01K...',
    })
    const userFacing = error.toUserFacing()
    expect(userFacing).toEqual({
      messageKey: 'error.stock.insufficient',
      params: { product: 'Shampoo', available: 2 },
    })
    // Technical detail must not leak into what is rendered to a cashier.
    expect(JSON.stringify(userFacing)).not.toContain('warehouse')
  })

  it('omits absent optional fields rather than emitting undefined', () => {
    const error = notFoundError('error.not_found', 'missing')
    expect(error.toUserFacing()).toEqual({ messageKey: 'error.not_found' })
    expect(Object.keys(error.toJSON())).not.toContain('params')
    expect(Object.keys(error.toJSON())).not.toContain('details')
  })

  it('retains the original cause for diagnostics', () => {
    const cause = new Error('SQLITE_BUSY')
    const error = infrastructureError('error.db.busy', 'database is locked', { cause })
    expect(error.cause).toBe(cause)
  })
})

describe('IPC serialisation', () => {
  it('survives a round trip across the process boundary', () => {
    const original = conflictError('error.barcode.duplicate', 'barcode already exists', {
      params: { barcode: '6221234567890' },
      details: 'UNIQUE constraint failed: barcodes.code',
    })

    // structuredClone models what Electron IPC actually does to the payload.
    const transported = structuredClone(original.toJSON())
    expect(XzareError.isSerialised(transported)).toBe(true)

    const restored = XzareError.fromJSON(transported)
    expect(restored).toBeInstanceOf(XzareError)
    expect(restored.code).toBe(ErrorCode.CONFLICT)
    expect(restored.messageKey).toBe('error.barcode.duplicate')
    expect(restored.message).toBe('barcode already exists')
    expect(restored.params).toEqual({ barcode: '6221234567890' })
    expect(restored.details).toBe('UNIQUE constraint failed: barcodes.code')
  })

  it('recognises only genuinely serialised errors', () => {
    expect(XzareError.isSerialised({ code: 'validation' })).toBe(false)
    expect(XzareError.isSerialised(null)).toBe(false)
    expect(XzareError.isSerialised('error')).toBe(false)
    expect(XzareError.isSerialised(undefined)).toBe(false)
  })
})

describe('XzareError.from', () => {
  it('returns an XzareError unchanged', () => {
    const original = licenseError('error.license.invalid', 'signature mismatch')
    expect(XzareError.from(original)).toBe(original)
  })

  it('rebuilds a serialised error received over IPC', () => {
    const serialised = integrityError('error.db.corrupt', 'integrity_check failed').toJSON()
    const restored = XzareError.from(structuredClone(serialised))
    expect(restored.code).toBe(ErrorCode.INTEGRITY)
    expect(restored.messageKey).toBe('error.db.corrupt')
  })

  it('wraps a native Error, keeping safe diagnostics and the original cause', () => {
    const native = new TypeError('cannot read property of undefined')
    const wrapped = XzareError.from(native)
    expect(wrapped.code).toBe(ErrorCode.UNEXPECTED)
    expect(wrapped.messageKey).toBe('error.unexpected')
    expect(wrapped.message).toBe('cannot read property of undefined')
    expect(wrapped.details).toContain('TypeError')
    expect(wrapped.cause).toBe(native)
  })

  it('wraps a thrown non-Error value', () => {
    const wrapped = XzareError.from('something odd')
    expect(wrapped.code).toBe(ErrorCode.UNEXPECTED)
    expect(wrapped.message).toBe('something odd')
  })
})

describe('error constructors', () => {
  it('each tags its own code', () => {
    const cases: readonly [XzareError, string][] = [
      [validationError('k', 'm'), ErrorCode.VALIDATION],
      [notFoundError('k', 'm'), ErrorCode.NOT_FOUND],
      [permissionDeniedError('k', 'm'), ErrorCode.PERMISSION_DENIED],
      [conflictError('k', 'm'), ErrorCode.CONFLICT],
      [businessRuleError('k', 'm'), ErrorCode.BUSINESS_RULE],
      [integrityError('k', 'm'), ErrorCode.INTEGRITY],
      [licenseError('k', 'm'), ErrorCode.LICENSE],
      [infrastructureError('k', 'm'), ErrorCode.INFRASTRUCTURE],
      [unexpectedError('k', 'm'), ErrorCode.UNEXPECTED],
    ]
    for (const [error, expectedCode] of cases) {
      expect(error.code).toBe(expectedCode)
    }
  })
})
