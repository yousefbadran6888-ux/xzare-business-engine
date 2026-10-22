/**
 * `@xzare/core` — primitives shared by every layer of the Xzare Business Engine.
 *
 * This package uses platform APIs only: no Node imports, database, Electron or React.
 * The same entry point runs in isolated browser renderers and Node >=22, and business rules
 * can be unit-tested in
 * milliseconds (ARCHITECTURE.md §3).
 */

export {
  ErrorCode,
  XzareError,
  businessRuleError,
  conflictError,
  infrastructureError,
  integrityError,
  licenseError,
  notFoundError,
  permissionDeniedError,
  unexpectedError,
  validationError,
  type ErrorParams,
  type SerialisedError,
  type XzareErrorOptions,
} from './errors.js'

export {
  andThen,
  attempt,
  collect,
  err,
  isErr,
  isOk,
  map,
  mapErr,
  ok,
  unwrap,
  unwrapOr,
  type Err,
  type Ok,
  type Result,
} from './result.js'

export {
  DEFAULT_ROUNDING,
  RoundingMode,
  assertSafeInteger,
  divideRounded,
  toSafeInteger,
} from './rounding.js'

export { formatScaled, normaliseNumerals, parseScaled, type ParseScaledOptions } from './decimal.js'

export {
  BASIS_POINTS_SCALE,
  MONEY_SCALE,
  Money,
  PIASTRES_PER_POUND,
  basisPoints,
  percent,
  type BasisPoints,
} from './money.js'

export { MILLI_UNITS_PER_UNIT, QUANTITY_SCALE, Quantity } from './quantity.js'

export { lineTotal, netFromInclusive, taxFromInclusive, unitPriceFromTotal } from './pricing.js'
export { CostBasis } from './cost-basis.js'

export { ULID_LENGTH, isUlid, ulid, ulidTimestamp, type Ulid } from './ulid.js'

export { FixedClock, systemClock, type Clock, type Timestamp } from './clock.js'

export {
  LOG_LEVEL_SEVERITY,
  LogLevel,
  MemoryLogSink,
  createLogger,
  nullLogger,
  redact,
  type LogContext,
  type LogRecord,
  type LogSink,
  type Logger,
  type LoggerOptions,
} from './logging.js'
