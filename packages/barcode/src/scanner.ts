import { err, ok, validationError, type Result } from '@xzare/core'
import { Barcode } from './identity.js'
import { readData } from './data.js'

const flags = ['repeat', 'composing', 'ctrl', 'alt', 'meta'] as const

export interface ScanKeyEvent {
  readonly key: string
  readonly at: number
  readonly repeat?: boolean
  readonly composing?: boolean
  readonly ctrl?: boolean
  readonly alt?: boolean
  readonly meta?: boolean
}

export class KeyboardScanBuffer {
  readonly #timeoutMs: number
  #focused = false
  #buffer = ''
  #invalid = false
  #lastAt: number | null = null

  constructor(timeoutMs = 2000) {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000) {
      throw validationError('error.barcode.scanner_config', 'Scanner timeout must be 100–60000 ms')
    }
    this.#timeoutMs = timeoutMs
  }

  setFocused(focused: boolean): void {
    if (focused !== this.#focused) this.#reset()
    this.#focused = focused === true
  }

  #reset(): void {
    this.#buffer = ''
    this.#invalid = false
    this.#lastAt = null
  }

  /** Feed only events from the dedicated scan field. Timing is framing, never proof of device identity. */
  push(event: unknown): Result<string | null> {
    if (!this.#focused) return ok(null)
    const data = readData(event, ['key', 'at'], flags)
    if (
      !data ||
      typeof data.key !== 'string' ||
      typeof data.at !== 'number' ||
      flags.some((flag) => Object.hasOwn(data, flag) && typeof data[flag] !== 'boolean')
    ) {
      this.#invalid = true
      return ok(null)
    }
    const { key, at } = data
    if (
      typeof key !== 'string' ||
      !Number.isFinite(at) ||
      at < 0 ||
      (this.#lastAt !== null &&
        (at < this.#lastAt || (this.#buffer.length > 0 && at - this.#lastAt > this.#timeoutMs)))
    )
      this.#invalid = true
    if (Number.isFinite(at) && at >= 0) this.#lastAt = at
    if (flags.some((flag) => data[flag] === true)) {
      this.#invalid = true
      return ok(null)
    }
    if (key === 'Escape') {
      this.#reset()
      return ok(null)
    }
    if (key === 'Enter' || key === '\r' || key === '\n') {
      const text = this.#buffer
      const invalid = this.#invalid
      this.#reset()
      if (invalid)
        return err(
          validationError(
            'error.barcode.scan_frame',
            'Discarded incomplete or invalid scanner frame',
          ),
        )
      if (text.length === 0) return ok(null)
      const parsed = Barcode.parse(text, 'CODE128')
      return parsed.ok ? ok(parsed.value.value) : parsed
    }
    if (key === 'Shift' || key === 'CapsLock' || key === 'NumLock') return ok(null)
    if (this.#invalid) return ok(null)
    if (key === 'Backspace') {
      this.#buffer = this.#buffer.slice(0, -1)
      return ok(null)
    }
    if (key.length !== 1 || !/^[A-Za-z0-9._/-]$/.test(key) || this.#buffer.length >= 64) {
      this.#invalid = true
      return ok(null)
    }
    this.#buffer += key
    return ok(null)
  }
}
