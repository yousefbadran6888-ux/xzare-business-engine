import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
const root = new URL('../../../', import.meta.url)
const products = ['pos', 'restaurant', 'accounting', 'inventory', 'manufacturing', 'workshop', 'service-center', 'clinic', 'laboratory', 'pharmacy', 'hr', 'crm', 'education', 'gym', 'salon', 'hotel', 'real-estate']
it('gates all 17 commercial applications before mounting administrator setup', () => {
  for (const product of products) {
    const source = readFileSync(new URL(`apps/${product}/src/main.tsx`, root), 'utf8')
    expect(source, product).toContain('<ActivationGate>')
    expect(source, product).toContain('</ActivationGate>')
  }
})
it('shares renewal and offline controls with administrator license management', () => {
  const source = readFileSync(new URL('apps/pos/src/LicensePanel.tsx', root), 'utf8')
  expect(source).toContain('ActivationMethods')
  expect(source).not.toContain('maxLength={43}')
})
it('derives a salted hardware fingerprint without publishing raw registry identifiers', () => {
  const require = createRequire(import.meta.url)
  const { fingerprintMachineGuid } = require(fileURLToPath(new URL('tools/windows-identity.cjs', root)))
  const raw = 'abcdabcd-abcd-abcd-abcd-abcdabcdabcd'
  const actual = fingerprintMachineGuid(raw)
  expect(actual).toMatch(/^[a-f0-9]{64}$/)
  expect(actual).not.toContain(raw)
  expect(fingerprintMachineGuid(raw.toUpperCase())).toBe(actual)
  expect(fingerprintMachineGuid('ffffffff-ffff-ffff-ffff-ffffffffffff')).not.toBe(actual)
  expect(() => fingerprintMachineGuid('')).toThrow()
})
it('carries sanitized device quota failures across Electron IPC without keys', () => {
  const main = readFileSync(new URL('tools/desktop-main.cjs', root), 'utf8')
  const preload = readFileSync(new URL('apps/pos/preload.cjs', root), 'utf8')
  expect(main).toContain('DeviceQuotaExceeded')
  expect(main).toContain('windows-identity.cjs')
  expect(preload).toContain('devices')
})
