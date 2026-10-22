import { chromium, expect } from '@playwright/test'
import { createRequire } from 'node:module'
import { resolve, join } from 'node:path'
import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
const product = process.argv.includes('accounting')
  ? 'accounting'
  : process.argv.includes('restaurant')
    ? 'restaurant'
    : 'pos'
const require = createRequire(import.meta.url),
  packaged = process.argv.includes('--packaged'),
  diagnostic = process.argv.includes('--diagnostic'),
  qa = resolve('.cache', `electron-cdp-${Date.now()}`),
  port = product === 'accounting' ? 5203 : product === 'restaurant' ? 5197 : 5192
if (packaged)
  throw new Error(
    'Production fuses disable debugging and diagnostic sandbox bypass. Use inspect-package.mjs for release verification; run CDP only against the development app.',
  )
// The outer Windows coding sandbox cannot create nested restricted renderer tokens (code 49).
// This explicit diagnostic flag tests native integration only. Customer builds retain sandbox:true.
const child = spawn(
  packaged ? resolve('artifacts/win-unpacked/Xzare POS.exe') : require('electron'),
  [
    `--remote-debugging-port=${port}`,
    ...(diagnostic ? ['--no-sandbox'] : []),
    ...(packaged ? [] : ['apps/' + product]),
  ],
  {
    windowsHide: true,
    env: { ...process.env, XZARE_DATA_DIR: qa, XZARE_TEST: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
)
child.stderr.on('data', (data) => console.log(String(data).trim()))
child.stdout.on('data', (data) => console.log(String(data).trim()))
let browser
try {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (r.ok) break
    } catch {}
    await new Promise((r) => setTimeout(r, 200))
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  const context = browser.contexts()[0]
  let page = context.pages()[0] ?? (await context.waitForEvent('page', { timeout: 10000 }))
  console.log('TARGETS', await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()))
  page.on('console', (message) => console.log('CONSOLE', message.type(), message.text()))
  page.on('pageerror', (error) => console.log('PAGE_ERROR', error.message))
  await page.waitForTimeout(1000)
  console.log('BODY', await page.locator('body').innerText())
  console.log(
    'BRIDGE',
    await page.evaluate(() => ({ bridge: typeof window.xzare, node: typeof window.require })),
  )
  await page.locator('[name="businessName"]').fill('اختبار Windows معزول', { timeout: 10000 })
  await page.locator('[name="name"]').fill('QA')
  await page.getByRole('button', { name: 'متابعة إلى الحساب', exact: true }).click()
  await page.locator('[name="username"]').fill('qa-owner')
  await page.locator('[name="password"]').fill('Electron-qa-password-123!')
  await page.locator('[name="confirmPassword"]').fill('Electron-qa-password-123!')
  await page
    .getByRole('button', {
      name:
        product === 'accounting'
          ? 'إنشاء الشركة'
          : product === 'restaurant'
            ? 'إنشاء المطعم'
            : 'إنشاء المتجر',
      exact: true,
    })
    .click()
  await expect(
    page.locator(
      product === 'accounting'
        ? '.a-sidebar'
        : product === 'restaurant'
          ? '.r-sidebar'
          : '.sidebar',
    ),
  ).toBeVisible()
  expect(await page.evaluate(() => typeof window.require)).toBe('undefined')
  const state = await page.evaluate(
    (p) => window.xzare.call(p === 'accounting' ? 'accounting.state' : 'state', {}),
    product,
  )
  expect(product === 'accounting' ? state.accounts : state.products).toHaveLength(0)
  expect(state.user.role).toBe('admin')
  const license = await page.evaluate(() => window.xzare.call('license.status', {}))
  expect(license.onlineConfigured).toBe(false)
  expect(license.readOnly).toBe(true)
  expect(
    readFileSync(join(qa, 'device-license.protected')).includes(Buffer.from('PRIVATE KEY')),
  ).toBe(false)
  const forbidden = await page.evaluate(async () => {
    try {
      await window.xzare.call('arbitrary.file', { path: 'C:/Windows' })
      return false
    } catch {
      return true
    }
  })
  expect(forbidden).toBe(true)
  // Hidden native window has no compositor surface in the outer sandbox; visual QA uses Chrome.
  console.log(
    `PASS development Electron: native SQLite, Argon2 setup, Windows DPAPI device state, initial activation gate, session IPC, no renderer Node, action allowlist. ${diagnostic ? 'Diagnostic integration only: renderer sandbox unverified in this environment.' : ''} QA=${qa}`,
  )
} finally {
  // Kill only this diagnostic browser's own protocol-reported processes; no WMI/taskkill dependency.
  if (browser) {
    try {
      const session = await browser.newBrowserCDPSession()
      const { processInfo } = await session.send('SystemInfo.getProcessInfo')
      for (const process of [
        ...processInfo.filter((p) => p.type !== 'browser'),
        ...processInfo.filter((p) => p.type === 'browser'),
      ]) {
        try {
          globalThis.process.kill(process.id)
        } catch {}
      }
    } catch {}
  }
  child.kill()
  await browser?.close().catch(() => {})
}
