import { chromium, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { mkdirSync } from 'node:fs'
const port = 5193,
  origin = `http://127.0.0.1:${port}`,
  directory = resolve('.cache', `ui-workflows-${Date.now()}`)
const server = spawn(process.execPath, ['tools/preview.mjs'], {
  windowsHide: true,
  env: { ...process.env, XZARE_PORT: String(port), XZARE_DATA_DIR: directory },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let browser
try {
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch(origin)).ok) break
    } catch {}
    await new Promise((r) => setTimeout(r, 100))
  }
  browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
  })
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } }),
    errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('dialog', (dialog) => dialog.accept())
  const nav = async (title) =>
    page.locator('.sidebar nav button').filter({ hasText: title }).click()
  const save = async () => {
    await page.locator('.modal').getByRole('button', { name: 'حفظ', exact: true }).click()
    try {
      await expect(page.locator('.modal')).toHaveCount(0)
    } catch (error) {
      console.log('SAVE FAILED', await page.locator('.modal').innerText())
      mkdirSync('.cache/screenshots', { recursive: true })
      await page.screenshot({
        path: '.cache/screenshots/workflow-save-failure.png',
        fullPage: true,
      })
      throw error
    }
  }
  const close = async () => page.locator('.modal-header button').click()
  const rpc = (action, payload = {}) =>
    page.evaluate(
      async ({ action, payload }) => {
        const r = await fetch('/api/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Xzare-Request': '1' },
          body: JSON.stringify({ action, payload }),
        })
        const data = await r.json()
        if (!data.ok) throw new Error(data.error)
        return data.value
      },
      { action, payload },
    )
  await page.goto(origin)
  await page.locator('[name="businessName"]').fill('اختبار دورة بيع معزول')
  await page.locator('[name="name"]').fill('QA')
  await page.getByRole('button', { name: 'متابعة إلى الحساب', exact: true }).click()
  await page.locator('[name="username"]').fill('owner')
  await page.locator('[name="password"]').fill('Workflow-test-password-123!')
  await page.locator('[name="confirmPassword"]').fill('Workflow-test-password-123!')
  await page.getByRole('button', { name: 'إنشاء المتجر', exact: true }).click()
  await expect(page.locator('.sidebar')).toBeVisible()
  expect((await rpc('state')).products).toHaveLength(0)
  await nav('الأصناف')
  await page.getByRole('button', { name: 'إضافة صنف', exact: true }).click()
  for (const [name, value] of Object.entries({
    name: 'صنف وزن للاختبار',
    sku: 'QA-WEIGHT',
    unit: 'كجم',
    price: '12.50',
    barcode: '00123',
  }))
    await page.locator(`[name="${name}"]`).fill(value)
  await save()
  // Scanner Enter must inspect a barcode without submitting a fully completed catalog form.
  await page.getByRole('button', { name: 'إضافة صنف', exact: true }).click()
  await page.locator('[name="name"]').fill('صنف غير محفوظ للاختبار')
  await page.locator('[name="sku"]').fill('QA-UNSAVED')
  await page.locator('[name="price"]').fill('10')
  await page.locator('[name="barcode"]').fill('00123')
  await page.locator('[name="barcode"]').press('Enter')
  await expect(page.getByRole('button', { name: 'فتح الصنف المسجل', exact: true })).toBeVisible()
  expect((await rpc('state')).products).toHaveLength(1)
  await page.getByRole('button', { name: 'فتح الصنف المسجل', exact: true }).click()
  await expect(page.locator('[name="name"]')).toHaveValue('صنف وزن للاختبار')
  await expect(page.locator('[name="barcode"]')).toHaveValue('00123')
  await close()
  await page.getByRole('button', { name: 'إضافة صنف', exact: true }).click()
  await page.locator('[name="name"]').fill('صنف جديد غير محفوظ')
  await page.locator('[name="sku"]').fill('QA-UNSAVED')
  await page.locator('[name="price"]').fill('10')
  await page.locator('[name="barcode"]').fill('000456')
  await page.locator('[name="barcode"]').press('Enter')
  await expect(page.locator('.barcode-registration').getByRole('status')).toContainText(
    'الباركود صالح',
  )
  expect((await rpc('state')).products).toHaveLength(1)
  await close()
  await nav('المخزون')
  await page.getByRole('button', { name: 'إضافة مخزون', exact: true }).click()
  const product = (await rpc('state')).products[0]
  await page.locator('[name="variantId"]').selectOption(product.id)
  for (const [name, value] of Object.entries({
    quantity: '10',
    unitCost: '5',
    reason: 'رصيد QA معزول',
  }))
    await page.locator(`[name="${name}"]`).fill(value)
  await save()
  await nav('العملاء')
  await page.getByRole('button', { name: 'إضافة عميل', exact: true }).click()
  await page.locator('[name="name"]').fill('عميل QA معزول')
  await save()
  await nav('الورديات')
  await page.getByRole('button', { name: 'افتح وردية', exact: true }).click()
  await page.locator('[name="opening"]').fill('100')
  await save()
  await nav('نقطة البيع')
  await page.getByLabel('مسح الباركود').focus()
  await page.keyboard.type('00123', { delay: 5 })
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('كمية صنف وزن للاختبار')).toBeVisible()
  await page.getByLabel('كمية صنف وزن للاختبار').fill('2')
  await page.locator('.cart > .field select').selectOption((await rpc('state')).parties[0].id)
  await page.getByLabel('نقدي', { exact: true }).fill('10')
  await page.getByRole('button', { name: 'حفظ مؤقت', exact: true }).click()
  await page.locator('[name="title"]').fill('فاتورة QA معلقة')
  await save()
  expect((await rpc('state')).holds).toHaveLength(1)
  expect((await rpc('state')).products[0].qty).toBe(10000)
  await page.getByRole('button', { name: 'بدء فاتورة جديدة', exact: true }).click()
  await page.getByRole('button', { name: /الفواتير المعلقة/ }).click()
  console.log('HOLD', await page.locator('.modal').innerText())
  await page.getByRole('button', { name: 'استئناف', exact: true }).click()
  await page.getByRole('button', { name: 'حفظ الفاتورة' }).click()
  await expect(page.locator('.receipt')).toBeVisible()
  let state = await rpc('state')
  expect(state.invoices[0].total).toBe(2500)
  expect(state.invoices[0].balance).toBe(1500)
  expect(state.holds).toHaveLength(0)
  expect(state.products[0].qty).toBe(8000)
  await page.locator('.inline-form [name="amount"]').fill('5')
  await page.locator('.inline-form').getByRole('button', { name: 'حفظ', exact: true }).click()
  await expect(page.locator('.receipt')).toContainText('المتبقي')
  await expect.poll(async () => (await rpc('state')).invoices[0].balance).toBe(1000)
  await page.getByLabel('مرتجع صنف وزن للاختبار').fill('1')
  await page.locator('.return-section [name="reason"]').fill('مرتجع QA')
  await page.getByRole('button', { name: 'تسجيل المرتجع', exact: true }).click()
  await expect.poll(async () => (await rpc('state')).invoices[0].returned).toBe(1250)
  state = await rpc('state')
  expect(state.invoices[0].refunded).toBe(250)
  expect(state.products[0].qty).toBe(9000)
  expect(state.products[0].cost).toBe(4500)
  expect(state.parties[0].balance).toBe(0)
  expect(state.shift.expected).toBe(11250)
  mkdirSync('.cache/screenshots', { recursive: true })
  await page.screenshot({ path: '.cache/screenshots/partial-return.png', fullPage: true })
  await close()
  await nav('المخزون')
  await page.getByRole('button', { name: 'طباعة ملصق', exact: true }).click()
  await expect
    .poll(() =>
      page.locator('.barcode-label canvas').evaluate((canvas) => {
        const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
        return Array.from(data).some((value, i) => i % 4 === 3 && value > 0)
      }),
    )
    .toBe(true)
  await page.screenshot({ path: '.cache/screenshots/barcode-label.png', fullPage: true })
  await close()
  await nav('الإعدادات')
  await page.locator('[name="scaleEnabled"]').check()
  for (const [name, value] of Object.entries({
    scalePrefix: '29',
    scaleProductDigits: '5',
    scaleValueDigits: '5',
    scaleDecimals: '3',
  }))
    await page.locator(`[name="${name}"]`).fill(value)
  await page.getByRole('button', { name: 'حفظ', exact: true }).click()
  await expect
    .poll(async () => JSON.parse((await rpc('state')).settings.scaleProfiles).length)
    .toBe(1)
  // Configured label: prefix29, PLU00123, weight01250 (1.250kg), GS1 check digit.
  const { gs1CheckDigit } = await import('../packages/barcode/dist/index.js')
  const base = '290012301250',
    check = gs1CheckDigit(base)
  const code = base + (check.ok ? check.value : check)
  await nav('نقطة البيع')
  await page.getByLabel('مسح الباركود').focus()
  await page.keyboard.type(code, { delay: 5 })
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('كمية صنف وزن للاختبار')).toHaveValue('1.25')
  await page.screenshot({ path: '.cache/screenshots/cashier.png', fullPage: true })
  const backup = await rpc('backup.create')
  expect(backup.download.length).toBeGreaterThan(1000)
  await nav('الورديات')
  await page.getByRole('button', { name: 'إغلاق وعد الخزينة', exact: true }).click()
  await page.locator('[name="actual"]').fill('112.50')
  await save()
  expect((await rpc('state')).shift).toBeNull()
  await nav('الإعدادات')
  await expect(page.locator('[name="license"]')).toHaveAttribute('type', 'password')
  await expect(page.locator('[name="license"]')).toBeDisabled()
  await nav('نظرة عامة')
  // UI-only transport fixture verifies clearing a masked code after rejected activation.
  // It is not evidence of a deployed authority and does not insert a business/license record.
  await page.route('**/api/rpc', async (route) => {
    const input = route.request().postDataJSON()
    if (input.action === 'license.status')
      return route.fulfill({
        json: {
          ok: true,
          value: {
            device: 'a'.repeat(64),
            licensed: false,
            customer: '',
            days: 0,
            readOnly: true,
            clockRollback: false,
            backupError: '',
            onlineConfigured: true,
          },
        },
      })
    if (input.action === 'license.activate') {
      expect(input.payload.license).toBe('A'.repeat(43))
      return route.fulfill({ json: { ok: false, error: 'رفض تفعيل اختباري معزول' } })
    }
    await route.continue()
  })
  await nav('الإعدادات')
  await expect(page.locator('[name="license"]')).toBeEnabled()
  await page.locator('[name="license"]').fill('A'.repeat(43))
  await page.getByRole('button', { name: 'تفعيل الترخيص', exact: true }).click()
  await expect(page.locator('[name="license"]')).toHaveValue('')
  await expect(page.getByText('رفض تفعيل اختباري معزول')).toBeVisible()
  await page.unroute('**/api/rpc')
  expect(errors).toEqual([])
  console.log(
    `PASS: empty setup, catalog barcode Enter/leading zeroes/existing item, stock, customer, shift, sale scanner, hold/resume, credit/partial pay/return, cost/cash/debt, label, scale, backup, shift close, masked activation field and UI-only rejected-code clearing. QA=${directory}`,
  )
} finally {
  await browser?.close()
  server.kill()
}
