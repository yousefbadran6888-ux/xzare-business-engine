/**
 * Error taxonomy for the Xzare Business Engine.
 *
 * Every error carries two audiences (see ARCHITECTURE.md §37):
 *   - `messageKey` + `params` — a translatable, understandable message for the user.
 *   - `details` + `cause`     — technical diagnostics for the structured log only.
 *
 * Errors must survive the IPC boundary, so they serialise losslessly via `toJSON`.
 */

import { redact } from './logging.js'

export const ErrorCode = {
  /** Input failed validation before any business rule ran. */
  VALIDATION: 'validation',
  /** A referenced entity does not exist. */
  NOT_FOUND: 'not_found',
  /** The actor lacks the required permission. */
  PERMISSION_DENIED: 'permission_denied',
  /** Uniqueness or idempotency conflict (duplicate barcode, replayed transaction). */
  CONFLICT: 'conflict',
  /** A domain invariant would be violated (negative stock, over-return). */
  BUSINESS_RULE: 'business_rule',
  /** Database integrity problem (corruption, failed foreign-key check). */
  INTEGRITY: 'integrity',
  /** Licence missing, expired, tampered with, or bound to another device. */
  LICENSE: 'license',
  /** Filesystem, printer, or other external-resource failure. */
  INFRASTRUCTURE: 'infrastructure',
  /** Anything unanticipated — always logged with full detail. */
  UNEXPECTED: 'unexpected',
} as const

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode]

export type ErrorParams = Readonly<Record<string, string | number>>

export interface SerialisedError {
  readonly __xzareError: true
  readonly code: ErrorCode
  readonly messageKey: string
  readonly message: string
  readonly params?: ErrorParams
  readonly details?: string
}

export interface XzareErrorOptions {
  /** i18n key, e.g. `error.inventory.insufficient_stock`. */
  readonly messageKey: string
  /** Developer-facing summary; never shown to users verbatim. */
  readonly message: string
  readonly params?: ErrorParams
  /** Technical diagnostics for the log. Must not contain secrets. */
  readonly details?: string
  readonly cause?: unknown
}

export class XzareError extends Error {
  readonly code: ErrorCode
  readonly messageKey: string
  readonly params?: ErrorParams
  readonly details?: string

  constructor(code: ErrorCode, options: XzareErrorOptions) {
    const validated = readSerialised({
      __xzareError: true,
      code,
      messageKey: options.messageKey,
      message: options.message,
      ...(options.params === undefined ? {} : { params: options.params }),
      ...(options.details === undefined ? {} : { details: options.details }),
    })
    if (validated === null) throw new TypeError('Invalid XzareError fields')
    super(validated.message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'XzareError'
    this.code = code
    this.messageKey = options.messageKey
    if (validated.params !== undefined) this.params = validated.params
    if (options.details !== undefined) this.details = options.details
  }

  /** The subset safe to display to an end user, once translated. */
  toUserFacing(): { messageKey: string; params?: ErrorParams } {
    const safe = this.toClientJSON()
    return safe.params === undefined
      ? { messageKey: safe.messageKey }
      : { messageKey: safe.messageKey, params: safe.params }
  }

  toJSON(): SerialisedError {
    return {
      __xzareError: true,
      code: this.code,
      messageKey: this.messageKey,
      message: this.message,
      ...(this.params === undefined ? {} : { params: this.params }),
      ...(this.details === undefined ? {} : { details: this.details }),
    }
  }

  /** IPC/client payload: technical messages, stacks and causes remain in main-process logs. */
  toClientJSON(): SerialisedError {
    const safe = readSerialised({
      __xzareError: true,
      code: this.code,
      messageKey: this.messageKey,
      message: this.messageKey,
      ...(this.params === undefined ? {} : { params: redact(this.params) }),
    })
    if (safe === null) throw new TypeError('Invalid client error fields')
    return safe
  }

  static isSerialised(value: unknown): value is SerialisedError {
    return readSerialised(value) !== null
  }

  static fromJSON(value: unknown): XzareError {
    const snapshot = readSerialised(value)
    if (snapshot === null) throw new TypeError('Invalid serialized XzareError')
    return new XzareError(snapshot.code, {
      messageKey: snapshot.messageKey,
      message: snapshot.message,
      ...(snapshot.params === undefined ? {} : { params: snapshot.params }),
      ...(snapshot.details === undefined ? {} : { details: snapshot.details }),
    })
  }

  /** Normalises any thrown value into an `XzareError`, preserving the original as `cause`. */
  static from(value: unknown): XzareError {
    let message = 'Unexpected failure'
    let details: string | undefined
    try {
      if (value instanceof XzareError) return value
      const serialized = readSerialised(value)
      if (serialized !== null) return XzareError.fromJSON(serialized)
      if (value instanceof Error) {
        const dataMessage = Object.getOwnPropertyDescriptor(value, 'message')
        if (typeof dataMessage?.value === 'string') message = dataMessage.value.slice(0, 4096)
        const dataStack = Object.getOwnPropertyDescriptor(value, 'stack')
        // V8 may expose stack as an accessor. Avoid invoking any accessor during normalization.
        if (typeof dataStack?.value === 'string') details = dataStack.value.slice(0, 16384)
        else {
          const name = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(value), 'name')?.value
          details = `${typeof name === 'string' ? name.slice(0, 128) : 'Error'}: ${message}`
        }
      } else if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
        message = typeof value === 'bigint' ? 'BigInt thrown value' : String(value).slice(0, 4096)
      }
    } catch {
      // A revoked proxy or hostile descriptor is represented by the generic failure.
    }
    return new XzareError(ErrorCode.UNEXPECTED, {
      messageKey: 'error.unexpected',
      message,
      ...(details === undefined ? {} : { details }),
      cause: value,
    })
  }
}

/** Only plain, own data fields cross a transport boundary. Accessors are never invoked. */
function transportFields(value: unknown, limit: number): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object') return null
  try {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return null
    const keys = Reflect.ownKeys(value)
    if (keys.length > limit) return null
    const out: Record<string, unknown> = {}
    for (const key of keys) {
      if (
        typeof key !== 'string' ||
        key === '__proto__' ||
        key === 'constructor' ||
        key === 'prototype'
      )
        return null
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (descriptor === undefined || !('value' in descriptor) || !descriptor.enumerable)
        return null
      out[key] = descriptor.value
    }
    return out
  } catch {
    return null
  }
}

function readSerialised(value: unknown): SerialisedError | null {
  const fields = transportFields(value, 6)
  if (fields === null) return null
  const allowed = new Set(['__xzareError', 'code', 'messageKey', 'message', 'params', 'details'])
  if (Object.keys(fields).some((key) => !allowed.has(key))) return null
  if (fields.__xzareError !== true || !Object.values(ErrorCode).includes(fields.code as ErrorCode))
    return null
  if (
    typeof fields.messageKey !== 'string' ||
    fields.messageKey.length === 0 ||
    fields.messageKey.length > 256
  )
    return null
  if (typeof fields.message !== 'string' || fields.message.length > 4096) return null
  if (
    fields.details !== undefined &&
    (typeof fields.details !== 'string' || fields.details.length > 16384)
  )
    return null
  const params: Record<string, string | number> = {}
  if (fields.params !== undefined) {
    const inputParams = transportFields(fields.params, 32)
    if (inputParams === null) return null
    for (const [key, entry] of Object.entries(inputParams)) {
      if (key.length > 128) return null
      if (
        (typeof entry === 'string' && entry.length <= 4096) ||
        (typeof entry === 'number' &&
          Number.isFinite(entry) &&
          Math.abs(entry) <= Number.MAX_SAFE_INTEGER)
      ) {
        params[key] = entry
      } else return null
    }
  }
  return {
    __xzareError: true,
    code: fields.code as ErrorCode,
    messageKey: fields.messageKey,
    message: fields.message,
    ...(fields.details === undefined ? {} : { details: fields.details as string }),
    ...(fields.params === undefined ? {} : { params: Object.freeze(params) }),
  }
}

const make =
  (code: ErrorCode) =>
  (
    messageKey: string,
    message: string,
    extra?: Omit<XzareErrorOptions, 'messageKey' | 'message'>,
  ) =>
    new XzareError(code, { messageKey, message, ...extra })

export const validationError = make(ErrorCode.VALIDATION)
export const notFoundError = make(ErrorCode.NOT_FOUND)
export const permissionDeniedError = make(ErrorCode.PERMISSION_DENIED)
export const conflictError = make(ErrorCode.CONFLICT)
export const businessRuleError = make(ErrorCode.BUSINESS_RULE)
export const integrityError = make(ErrorCode.INTEGRITY)
export const licenseError = make(ErrorCode.LICENSE)
export const infrastructureError = make(ErrorCode.INFRASTRUCTURE)
export const unexpectedError = make(ErrorCode.UNEXPECTED)
