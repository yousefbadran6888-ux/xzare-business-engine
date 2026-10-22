/**
 * Structured logging interface.
 *
 * `core` defines the contract only; the file-based, rotating implementation lives in
 * infrastructure, which keeps the domain free of I/O. Log records are structured so they can
 * be filtered when diagnosing a customer's problem from a support bundle.
 *
 * Redaction is built in rather than left to discipline: passwords, hashes, licence keys and
 * tokens must never reach a log file (ARCHITECTURE.md §7).
 */

export const LogLevel = {
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
} as const

export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel]

export const LOG_LEVEL_SEVERITY: Readonly<Record<LogLevel, number>> = {
  [LogLevel.DEBUG]: 10,
  [LogLevel.INFO]: 20,
  [LogLevel.WARN]: 30,
  [LogLevel.ERROR]: 40,
}

export type LogContext = Readonly<Record<string, unknown>>

export interface LogRecord {
  readonly level: LogLevel
  readonly message: string
  readonly timestamp: number
  /** Dot-separated origin, e.g. `engine.sales.createSale`. */
  readonly scope: string
  readonly context?: LogContext
  readonly error?: unknown
}

export interface Logger {
  debug(message: string, context?: LogContext): void
  info(message: string, context?: LogContext): void
  warn(message: string, context?: LogContext): void
  error(message: string, error?: unknown, context?: LogContext): void
  /** Derives a logger with a nested scope, e.g. `log.child('sales')`. */
  child(scope: string): Logger
}

export interface LogSink {
  write(record: LogRecord): void
}

/** Keys whose values are replaced with `[redacted]` wherever they appear in log context. */
const REDACTED_KEYS = new Set([
  'password',
  'passwordhash',
  'password_hash',
  'newpassword',
  'currentpassword',
  'confirmpassword',
  'pin',
  'secret',
  'token',
  'accesstoken',
  'refreshtoken',
  'apikey',
  'api_key',
  'privatekey',
  'private_key',
  'licensekey',
  'license_key',
  'licencekey',
  'activationcode',
  'signature',
  'sessiontoken',
  'session_token',
  'cardnumber',
  'card_number',
  'cvv',
  'authorization',
  'cookie',
  'setcookie',
  'credentials',
])

const REDACTED = '[redacted]'
const MAX_DEPTH = 6
const MAX_ENTRIES = 64
const MAX_NODES = 1000
const MAX_TEXT = 4096
const MAX_TOTAL_TEXT = 16384
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const sensitiveKey = (key: string) => REDACTED_KEYS.has(key.toLowerCase().replace(/[-_\s]/g, ''))

/** Best-effort defence for labelled secrets. Never log raw credentials in free-form text. */
function redactText(value: string): string {
  return value
    .slice(0, MAX_TEXT)
    .replace(/\b((?:Bearer|Basic)\s+)[^\s,;]+/gi, `$1${REDACTED}`)
    .replace(
      /\b((?:password|password_hash|secret|token|access_token|refresh_token|api_key|apikey|license_key|session_token|pin|cvv)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;]+)/gi,
      `$1${REDACTED}`,
    )
    .slice(0, MAX_TEXT)
}

/** Produces bounded, JSON-safe data without invoking getters, toJSON or custom iterators. */
export function redact(value: unknown, depth = 0): unknown {
  const seen = new WeakSet<object>()
  let remaining = MAX_NODES
  let remainingText = MAX_TOTAL_TEXT
  const visit = (input: unknown, currentDepth: number): unknown => {
    if (currentDepth > MAX_DEPTH || remaining-- <= 0) return '[truncated]'
    if (typeof input === 'string') {
      if (remainingText <= 0) return '[truncated]'
      const text = redactText(input.slice(0, remainingText)).slice(0, remainingText)
      remainingText -= text.length
      return text
    }
    if (typeof input === 'bigint')
      return input > 10n ** 64n || input < -(10n ** 64n) ? '[bigint truncated]' : input.toString()
    if (typeof input === 'function' || typeof input === 'symbol') return '[unsupported]'
    if (typeof input === 'number' && !Number.isFinite(input)) return '[non-finite]'
    if (input === null || typeof input !== 'object') return input
    try {
      if (seen.has(input)) return '[circular]'
      seen.add(input)
      if (input instanceof Date) {
        const time = Date.prototype.getTime.call(input)
        return Number.isFinite(time) ? new Date(time).toISOString() : '[invalid date]'
      }
      if (ArrayBuffer.isView(input) || input instanceof ArrayBuffer) return '[binary data]'
      if (Array.isArray(input)) {
        const length = Math.min(input.length, MAX_ENTRIES)
        const out: unknown[] = []
        for (let index = 0; index < length; index++) {
          const descriptor = Object.getOwnPropertyDescriptor(input, String(index))
          out.push(
            descriptor === undefined
              ? null
              : 'value' in descriptor
                ? visit(descriptor.value, currentDepth + 1)
                : '[accessor omitted]',
          )
        }
        if (input.length > MAX_ENTRIES) out.push('[truncated]')
        return out
      }
      const isError = input instanceof Error
      const prototype = Object.getPrototypeOf(input)
      if (!isError && prototype !== Object.prototype && prototype !== null)
        return '[unsupported object]'
      const out: Record<string, unknown> = {}
      if (isError) out.name = 'Error'
      let count = 0
      for (const key of Object.getOwnPropertyNames(input)) {
        if (count++ >= MAX_ENTRIES || remaining-- <= 0 || remainingText <= 0) {
          out.truncated = '[truncated]'
          break
        }
        if (UNSAFE_KEYS.has(key) || key.length > 128) continue
        const descriptor = Object.getOwnPropertyDescriptor(input, key)
        if (descriptor === undefined || (!isError && !descriptor.enumerable)) continue
        remainingText -= key.length
        out[key] = sensitiveKey(key)
          ? REDACTED
          : 'value' in descriptor
            ? visit(descriptor.value, currentDepth + 1)
            : '[accessor omitted]'
      }
      return out
    } catch {
      // Revoked proxies and objects with throwing traps cannot break application logging.
      return '[unserializable]'
    }
  }
  return visit(value, Math.max(0, depth))
}

export interface LoggerOptions {
  readonly scope?: string
  readonly minLevel?: LogLevel
  readonly now?: () => number
}

/** Creates a logger that forwards redacted records to `sink`. */
export function createLogger(sink: LogSink, options: LoggerOptions = {}): Logger {
  const scope = options.scope ?? 'app'
  const minLevel = options.minLevel ?? LogLevel.INFO
  const now = options.now ?? (() => Date.now())
  const threshold = LOG_LEVEL_SEVERITY[minLevel]

  const emit = (level: LogLevel, message: string, context?: LogContext, error?: unknown): void => {
    if (LOG_LEVEL_SEVERITY[level] < threshold) return
    sink.write({
      level,
      message: redactText(message),
      timestamp: now(),
      scope: redactText(scope),
      ...(context === undefined ? {} : { context: redact(context) as LogContext }),
      ...(error === undefined ? {} : { error: redact(error) }),
    })
  }

  return {
    debug: (message, context) => emit(LogLevel.DEBUG, message, context),
    info: (message, context) => emit(LogLevel.INFO, message, context),
    warn: (message, context) => emit(LogLevel.WARN, message, context),
    error: (message, error, context) => emit(LogLevel.ERROR, message, context, error),
    child: (childScope) =>
      createLogger(sink, { ...options, scope: `${scope}.${childScope}`, minLevel }),
  }
}

/** Collects records in memory — used by tests and by the in-app diagnostics viewer. */
export class MemoryLogSink implements LogSink {
  readonly records: LogRecord[] = []

  constructor(private readonly maxRecords = 200) {
    if (!Number.isSafeInteger(maxRecords) || maxRecords < 1 || maxRecords > 10000) {
      throw new RangeError('MemoryLogSink: maxRecords must be between 1 and 10000')
    }
  }

  write(record: LogRecord): void {
    if (this.records.length >= this.maxRecords) this.records.shift()
    this.records.push(record)
  }

  clear(): void {
    this.records.length = 0
  }
}

/** Discards everything. Useful as a default so code never has to null-check a logger. */
export const nullLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => nullLogger,
}
