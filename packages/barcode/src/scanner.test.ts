import { describe, expect, it } from 'vitest'
import { unwrap } from '@xzare/core'
import { KeyboardScanBuffer, type ScanKeyEvent } from './scanner.js'

function feed(scanner: KeyboardScanBuffer, text: string, at = 0) {
  for (const key of text) expect(unwrap(scanner.push({ key, at: at++ }))).toBeNull()
  return scanner.push({ key: 'Enter', at })
}

describe('focused keyboard scanner', () => {
  it('fails closed on malformed event data without leaving a committable old frame', () => {
    let calls = 0
    const proxy = Proxy.revocable({}, {})
    proxy.revoke()
    const getter = {
      at: 2,
      get key() {
        calls++
        throw new Error('Getter executed')
      },
    }
    for (const event of [null, {}, { key: 'A', at: 2, repeat: 'no' }, getter, proxy.proxy]) {
      const scanner = new KeyboardScanBuffer()
      scanner.setFocused(true)
      scanner.push({ key: 'A', at: 1 })
      expect(scanner.push(event as ScanKeyEvent).ok).toBe(true)
      expect(scanner.push({ key: 'Enter', at: 3 }).ok).toBe(false)
    }
    expect(calls).toBe(0)
  })
  it('captures only the dedicated focused scan field', () => {
    const scanner = new KeyboardScanBuffer()
    expect(unwrap(feed(scanner, '036000291452'))).toBeNull()
    scanner.setFocused(true)
    expect(unwrap(feed(scanner, '036000291452'))).toBe('036000291452')
    expect(unwrap(scanner.push({ key: 'Enter', at: 20 }))).toBeNull()
  })
  it('permits separate scans of the same item', () => {
    const scanner = new KeyboardScanBuffer()
    scanner.setFocused(true)
    expect(unwrap(feed(scanner, 'XZ-001', 0))).toBe('XZ-001')
    expect(unwrap(feed(scanner, 'XZ-001', 100))).toBe('XZ-001')
  })
  it('resets on blur or modal transition', () => {
    const scanner = new KeyboardScanBuffer()
    scanner.setFocused(true)
    scanner.push({ key: 'A', at: 1 })
    scanner.setFocused(false)
    scanner.setFocused(true)
    expect(unwrap(scanner.push({ key: 'Enter', at: 2 }))).toBeNull()
  })
  it.each(['\r', '\n', 'Enter'])('supports scanner terminator %s', (key) => {
    const scanner = new KeyboardScanBuffer()
    scanner.setFocused(true)
    scanner.push({ key: 'A', at: 1 })
    expect(unwrap(scanner.push({ key, at: 2 }))).toBe('A')
    expect(unwrap(scanner.push({ key: '\n', at: 3 }))).toBeNull()
  })
  it('discards the entire overflowing frame, including its valid suffix', () => {
    const scanner = new KeyboardScanBuffer()
    scanner.setFocused(true)
    expect(feed(scanner, 'X'.repeat(65) + 'VALID').ok).toBe(false)
    expect(unwrap(feed(scanner, 'OK', 100))).toBe('OK')
  })
  it('discards incomplete frames after timeout rather than accepting their suffix', () => {
    const scanner = new KeyboardScanBuffer(1000)
    scanner.setFocused(true)
    scanner.push({ key: 'A', at: 0 })
    scanner.push({ key: 'B', at: 1001 })
    expect(scanner.push({ key: 'Enter', at: 1002 }).ok).toBe(false)
    expect(unwrap(feed(scanner, 'OK', 2000))).toBe('OK')
  })
  it.each([{ ctrl: true }, { alt: true }, { meta: true }, { composing: true }, { repeat: true }])(
    'never commits an altered or repeated frame',
    (flags) => {
      const scanner = new KeyboardScanBuffer()
      scanner.setFocused(true)
      scanner.push({ key: 'A', at: 1 })
      scanner.push({ key: 'B', at: 2, ...flags })
      expect(scanner.push({ key: 'Enter', at: 3 }).ok).toBe(false)
    },
  )
  it('discards control payloads and invalid or backwards timestamps', () => {
    for (const event of [
      { key: '<', at: 2 },
      { key: 'A', at: NaN },
      { key: 'A', at: -1 },
      { key: 'A', at: 0 },
    ]) {
      const scanner = new KeyboardScanBuffer()
      scanner.setFocused(true)
      scanner.push({ key: 'X', at: 1 })
      scanner.push(event)
      expect(scanner.push({ key: 'Enter', at: 3 }).ok).toBe(false)
    }
  })
  it('supports explicit backspace and escape while focused', () => {
    const scanner = new KeyboardScanBuffer()
    scanner.setFocused(true)
    scanner.push({ key: 'A', at: 1 })
    scanner.push({ key: 'B', at: 2 })
    scanner.push({ key: 'Backspace', at: 3 })
    expect(unwrap(scanner.push({ key: 'Enter', at: 4 }))).toBe('A')
    scanner.push({ key: 'B', at: 5 })
    scanner.push({ key: 'Escape', at: 6 })
    expect(unwrap(scanner.push({ key: 'Enter', at: 7 }))).toBeNull()
  })
})
