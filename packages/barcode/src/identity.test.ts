import { describe, expect, it } from 'vitest'
import { unwrap } from '@xzare/core'
import { Barcode, gs1CheckDigit } from './identity.js'

describe('barcode identities', () => {
  it.each([
    ['EAN13', '6291041500213'],
    ['EAN8', '96385074'],
    ['UPCA', '036000291452'],
    ['GTIN14', '10012345000017'],
    ['CODE128', 'XZ-000001/BOX'],
  ])('validates %s and preserves the exact identity', (format, input) => {
    expect(unwrap(Barcode.parse(input, format))).toEqual({ value: input, format })
    expect(Object.isFrozen(unwrap(Barcode.parse(input, format)))).toBe(true)
  })
  it('calculates the standard modulo-10 digit', () => {
    expect(unwrap(gs1CheckDigit('629104150021'))).toBe('3')
    expect(unwrap(gs1CheckDigit('03600029145'))).toBe('2')
    expect(unwrap(gs1CheckDigit('0000000'))).toBe('0')
  })
  it.each([null, 123, '', '12a', ' 1234567', '1'.repeat(1024), '١٢٣٤٥٦٧'])(
    'rejects invalid check-digit payload %s',
    (input) => {
      expect(gs1CheckDigit(input).ok).toBe(false)
    },
  )
  it.each([
    [6291041500213, 'EAN13'],
    ['6291041500214', 'EAN13'],
    ['96385075', 'EAN8'],
    ['036000291453', 'UPCA'],
    ['10012345000018', 'GTIN14'],
    ['6291041500213\n', 'EAN13'],
    [' 6291041500213', 'EAN13'],
    ['٦٢٩١٠٤١٥٠٠٢١٣', 'EAN13'],
    ['https://example.com', 'CODE128'],
    ['<svg/onload=alert(1)>', 'CODE128'],
    ["x' OR 1=1--", 'CODE128'],
    ['a\u001db', 'CODE128'],
    ['X'.repeat(65), 'CODE128'],
    ['XYZ', 'AUTO'],
    ['', 'CODE128'],
    ['XZ-001\n', 'CODE128'],
    ['XZ-001\r', 'CODE128'],
    ['XZ-001\u2028', 'CODE128'],
  ])('rejects malformed input without echoing it in the error', (input, format) => {
    const result = Barcode.parse(input, format)
    expect(result.ok).toBe(false)
    if (!result.ok && String(input).length > 0)
      expect(JSON.stringify(result.error.toClientJSON())).not.toContain(String(input))
  })
  it('rejects newline-terminated numeric payloads instead of calculating a check digit', () => {
    expect(gs1CheckDigit('123456\n').ok).toBe(false)
  })
})
