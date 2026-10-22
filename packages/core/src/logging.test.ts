import { describe, expect, it } from 'vitest'
import {
  createLogger,
  LOG_LEVEL_SEVERITY,
  LogLevel,
  MemoryLogSink,
  nullLogger,
  redact,
} from './logging.js'

const fixedNow = () => 1_700_000_000_000

describe('createLogger', () => {
  it('writes structured records carrying level, scope and timestamp', () => {
    const sink = new MemoryLogSink()
    const log = createLogger(sink, { scope: 'engine', minLevel: LogLevel.DEBUG, now: fixedNow })

    log.info('sale completed', { saleId: '01J', total: 12_345 })

    expect(sink.records).toHaveLength(1)
    const record = sink.records[0]!
    expect(record.level).toBe(LogLevel.INFO)
    expect(record.message).toBe('sale completed')
    expect(record.scope).toBe('engine')
    expect(record.timestamp).toBe(fixedNow())
    expect(record.context).toEqual({ saleId: '01J', total: 12_345 })
  })

  it('suppresses records below the configured level', () => {
    const sink = new MemoryLogSink()
    const log = createLogger(sink, { minLevel: LogLevel.WARN, now: fixedNow })

    log.debug('noisy detail')
    log.info('routine event')
    log.warn('printer not found')
    log.error('save failed', new Error('disk full'))

    expect(sink.records.map((r) => r.level)).toEqual([LogLevel.WARN, LogLevel.ERROR])
  })

  it('defaults to info level', () => {
    const sink = new MemoryLogSink()
    const log = createLogger(sink, { now: fixedNow })
    log.debug('hidden')
    log.info('shown')
    expect(sink.records).toHaveLength(1)
  })

  it('attaches a safe error snapshot for error records', () => {
    const sink = new MemoryLogSink()
    const log = createLogger(sink, { now: fixedNow })
    const failure = new Error('SQLITE_CORRUPT')

    log.error('database check failed', failure, { path: 'C:/data/db.sqlite' })

    const record = sink.records[0]!
    expect(record.error).not.toBe(failure)
    expect(record.error).toMatchObject({ name: 'Error', message: 'SQLITE_CORRUPT' })
    expect(record.context).toEqual({ path: 'C:/data/db.sqlite' })
  })

  it('nests scopes through child loggers so the origin stays traceable', () => {
    const sink = new MemoryLogSink()
    const root = createLogger(sink, { scope: 'engine', now: fixedNow })
    const sales = root.child('sales')
    const returns = sales.child('returns')

    root.info('root')
    sales.info('sales')
    returns.info('returns')

    expect(sink.records.map((r) => r.scope)).toEqual([
      'engine',
      'engine.sales',
      'engine.sales.returns',
    ])
  })

  it('keeps the minimum level when deriving a child', () => {
    const sink = new MemoryLogSink()
    const child = createLogger(sink, { minLevel: LogLevel.ERROR, now: fixedNow }).child('db')
    child.warn('ignored')
    child.error('kept')
    expect(sink.records).toHaveLength(1)
  })

  it('orders severities so thresholds compare correctly', () => {
    expect(LOG_LEVEL_SEVERITY[LogLevel.DEBUG]).toBeLessThan(LOG_LEVEL_SEVERITY[LogLevel.INFO])
    expect(LOG_LEVEL_SEVERITY[LogLevel.INFO]).toBeLessThan(LOG_LEVEL_SEVERITY[LogLevel.WARN])
    expect(LOG_LEVEL_SEVERITY[LogLevel.WARN]).toBeLessThan(LOG_LEVEL_SEVERITY[LogLevel.ERROR])
  })
})

describe('redaction', () => {
  it('removes secrets before they can reach a log file', () => {
    const sink = new MemoryLogSink()
    const log = createLogger(sink, { now: fixedNow })

    log.info('login attempt', {
      username: 'ahmed',
      password: 'correct horse battery',
      passwordHash: '$argon2id$...',
      licenseKey: 'XZ-1234-5678',
      sessionToken: 'abc123',
    })

    const context = sink.records[0]!.context as Record<string, unknown>
    expect(context.username).toBe('ahmed')
    expect(context.password).toBe('[redacted]')
    expect(context.passwordHash).toBe('[redacted]')
    expect(context.licenseKey).toBe('[redacted]')
    expect(context.sessionToken).toBe('[redacted]')
    expect(JSON.stringify(context)).not.toContain('correct horse battery')
  })

  it('matches sensitive keys regardless of case or separators', () => {
    expect(redact({ PASSWORD: 'x' })).toEqual({ PASSWORD: '[redacted]' })
    expect(redact({ password_hash: 'x' })).toEqual({ password_hash: '[redacted]' })
    expect(redact({ 'private-key': 'x' })).toEqual({ 'private-key': '[redacted]' })
    expect(redact({ 'Api Key': 'x' })).toEqual({ 'Api Key': '[redacted]' })
  })

  it('reaches secrets nested inside objects and arrays', () => {
    const result = redact({
      user: { name: 'ahmed', password: 'secret' },
      attempts: [{ pin: '1234' }, { pin: '5678' }],
    }) as Record<string, Record<string, unknown>>

    expect(result.user!.name).toBe('ahmed')
    expect(result.user!.password).toBe('[redacted]')
    expect(JSON.stringify(result)).not.toContain('1234')
  })

  it('passes primitives through and normalises dates', () => {
    expect(redact(42)).toBe(42)
    expect(redact('plain')).toBe('plain')
    expect(redact(null)).toBe(null)
    expect(redact(undefined)).toBe(undefined)
    expect(redact(new Date(0))).toBe('1970-01-01T00:00:00.000Z')
  })

  it('truncates pathologically deep structures rather than recursing forever', () => {
    type Nested = { next?: Nested; password?: string }
    let deep: Nested = { password: 'secret' }
    for (let index = 0; index < 20; index += 1) deep = { next: deep }

    const serialised = JSON.stringify(redact(deep))
    expect(serialised).toContain('[truncated]')
    expect(serialised).not.toContain('secret')
  })

  it('survives a self-referential object', () => {
    const cyclic: Record<string, unknown> = { name: 'loop' }
    cyclic.self = cyclic
    expect(() => redact(cyclic)).not.toThrow()
  })
})

describe('nullLogger', () => {
  it('accepts every call without side effects', () => {
    expect(() => {
      nullLogger.debug('x')
      nullLogger.info('x')
      nullLogger.warn('x')
      nullLogger.error('x', new Error('y'))
      nullLogger.child('scope').info('x')
    }).not.toThrow()
  })
})

describe('MemoryLogSink', () => {
  it('clears collected records', () => {
    const sink = new MemoryLogSink()
    createLogger(sink, { now: fixedNow }).info('one')
    expect(sink.records).toHaveLength(1)
    sink.clear()
    expect(sink.records).toHaveLength(0)
  })
})
