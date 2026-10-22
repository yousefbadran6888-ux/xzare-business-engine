/**
 * ULID — lexicographically sortable, offline-generatable identifiers (ARCHITECTURE.md D4).
 *
 * 26 characters: 10 of millisecond timestamp + 16 of randomness, Crockford base32.
 * Sorting by id approximates sorting by creation time, which gives good index locality for
 * append-heavy tables like `sale_lines` and `stock_movements`, and no coordination is needed
 * to generate one — a prerequisite for offline operation and future multi-branch sync.
 */

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // Crockford base32: no I, L, O, U
const ENCODING_LEN = 32
const TIME_LEN = 10
const RANDOM_LEN = 16
export const ULID_LENGTH = TIME_LEN + RANDOM_LEN
const MAX_TIME = 0xffffffffffff // 2 ** 48 - 1

const ULID_PATTERN = /^[0-7][0-9ABCDEFGHJKMNPQRSTVWXYZ]{25}$/

export type Ulid = string

function encodeTime(timestamp: number): string {
  if (!Number.isInteger(timestamp) || timestamp < 0 || timestamp > MAX_TIME) {
    throw new RangeError(`ulid: timestamp ${String(timestamp)} is out of range`)
  }
  let remaining = timestamp
  let out = ''
  for (let index = 0; index < TIME_LEN; index += 1) {
    out = (ENCODING[remaining % ENCODING_LEN] as string) + out
    remaining = Math.floor(remaining / ENCODING_LEN)
  }
  return out
}

const randomBuffer = new Uint8Array(RANDOM_LEN)

function encodeRandom(): string {
  // Web Crypto is available in Node >=22 and isolated browser renderers.
  // Fail closed if unavailable; never fall back to Math.random.
  globalThis.crypto.getRandomValues(randomBuffer)
  let out = ''
  for (let index = 0; index < RANDOM_LEN; index += 1) {
    // Masking to 5 bits keeps the distribution uniform across the 32-char alphabet.
    out += ENCODING[(randomBuffer[index] as number) & 0x1f] as string
  }
  return out
}

/** Generates a ULID for the given time (defaults to now). */
export function ulid(timestamp: number = Date.now()): Ulid {
  return encodeTime(timestamp) + encodeRandom()
}

/** True when `value` is a syntactically valid ULID. */
export function isUlid(value: unknown): value is Ulid {
  return typeof value === 'string' && value.length === ULID_LENGTH && ULID_PATTERN.test(value)
}

/** Extracts the creation timestamp (Unix ms) encoded in a ULID. */
export function ulidTimestamp(value: Ulid): number {
  if (!isUlid(value)) {
    throw new RangeError(`ulid: ${String(value).slice(0, 32)} is not a valid ULID`)
  }
  let timestamp = 0
  for (let index = 0; index < TIME_LEN; index += 1) {
    timestamp = timestamp * ENCODING_LEN + ENCODING.indexOf(value[index] as string)
  }
  return timestamp
}
