import { chromium, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { mkdirSync } from 'node:fs'
import { ulid } from '../packages/core/dist/index.js'
const port = 5198,
  origin = `http://127.0.0.1:${port}`,
  directory = resolve('.cache', `restaurant-ui-${Date.now()}`)
const server = spawn(process.execPath, ['tools/preview.mjs', 'restaurant'], {
  windowsHide: true,
  env: { ...process.env, XZARE_PORT: String(port), XZARE_DATA_DIR: directory },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let browser
server.stderr.on('data', (d) => console.log(String(d)))
try {
  for (let i = 0; i < 60; i++) {
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
  page.on('pageerror', (e) => errors.push(e.message))
  const rpc = (action, payload = {}) =>
    page.evaluate(
      async ({ action, payload }) => {
        const r = await fetch('/api/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Xzare-Request': '1' },
          body: JSON.stringify({ action, payload }),
        })
        const d = await r.json()
        if (!d.ok) throw new Error(d.error)
        return d.value
      },
      { action, payload },
    )
  const nav = async (title) => {
    const target = page.locator('.r-sidebar nav button').filter({ hasText: title })
    if (!(await target.isVisible())) await page.locator('.r-management-nav summary').click()
    await target.click()
  }
  const save = async (name = 'حفظ') => {
    await page.getByRole('dialog').getByRole('button', { name, exact: true }).click()
    try {
      await expect(page.getByRole('dialog')).toHaveCount(0)
    } catch (e) {
      console.log('FORM FAILURE', await page.getByRole('dialog').innerText())
      throw e
    }
  }
  const fill = async (fields) => {
    for (const [name, value] of Object.entries(fields))
      await page.getByRole('dialog').locator(`[name="${name}"]`).fill(String(value))
  }
  mkdirSync('.cache/screenshots', { recursive: true })
  await page.goto(origin)
  await page.locator('[name="businessName"]').fill('اختبار مطعم معزول')
  await page.locator('[name="name"]').fill('QA')
  await page.getByRole('button', { name: 'متابعة إلى الحساب', exact: true }).click()
  await page.locator('[name="username"]').fill('owner')
  await page.locator('[name="password"]').fill('Restaurant-test-password-123!')
  await page.locator('[name="confirmPassword"]').fill('Restaurant-test-password-123!')
  await page.getByRole('button', { name: 'إنشاء المطعم', exact: true }).click()
  await expect(page.locator('.r-sidebar')).toBeVisible()
  expect((await rpc('restaurant.state')).tables).toHaveLength(0)
  expect((await rpc('state')).products).toHaveLength(0)
  await page.screenshot({ path: '.cache/screenshots/restaurant-empty.png', fullPage: true })
  await page.getByRole('button', { name: 'إضافة طاولة', exact: true }).click()
  await fill({ name: 'طاولة اختبار', zone: 'منطقة اختبار', seats: 4 })
  await save()
  // Shared catalog UI retains actual barcode flow and ingredient stock management.
  await nav('الخامات والباركود')
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
  await page.getByRole('button', { name: 'إضافة صنف', exact: true }).click()
  for (const [name, value] of Object.entries({
    name: 'خامة اختبار',
    sku: 'QA-RAW',
    unit: 'كجم',
    price: '0',
    barcode: '00123',
  }))
    await page.locator('.modal').locator(`[name="${name}"]`).fill(value)
  await page.locator('.modal').getByRole('button', { name: 'حفظ', exact: true }).click()
  await expect(page.locator('.modal')).toHaveCount(0)
  const raw = (await rpc('state')).products[0]
  await rpc('stock.adjust', {
    variantId: raw.id,
    quantity: 10000,
    unitCost: 1000,
    reason: 'QA only',
    clientTxnId: ulid(),
  })
  await nav('قائمة الطعام')
  await page.getByRole('button', { name: 'إضافة صنف الطعام', exact: true }).click()
  await fill({ name: 'وجبة اختبار', category: 'اختبار', price: '20', ['recipe:' + raw.id]: '0.25' })
  await save()
  await rpc('shift.open', { opening: 10000 })
  await nav('الطاولات')
  await page.locator('.r-table>button').first().click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.r-order-layout')).toBeVisible()
  await page.locator('.r-order-menu .r-menu-grid button').click()
  await fill({ qty: 2, note: 'ملاحظة تحضير للاختبار' })
  await save('إضافة للطلب')
  await page.getByRole('button', { name: 'إرسال للمطبخ', exact: true }).click()
  await expect(page.locator('.r-order-summary')).toContainText('بانتظار المطبخ')
  await nav('المطبخ')
  await page.screenshot({ path: '.cache/screenshots/restaurant-kitchen.png', fullPage: true })
  await page.getByRole('button', { name: 'بدء التحضير', exact: true }).click()
  await expect(page.getByRole('button', { name: 'جاهز', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'جاهز', exact: true }).click()
  await expect(page.getByRole('button', { name: 'جاهز', exact: true })).toHaveCount(0)
  expect((await rpc('state')).products[0]).toMatchObject({ qty: 9500, cost: 9500 })
  await nav('الطاولات')
  await page.locator('.r-table>button').first().click()
  await page.getByRole('button', { name: 'تم التقديم', exact: true }).click()
  await expect(page.locator('.r-order-summary')).toContainText('تم التقديم')
  await page.getByRole('button', { name: 'تحصيل وإغلاق الطلب', exact: true }).click()
  await fill({ cash: '50' })
  await save('تسجيل التحصيل')
  expect((await rpc('state')).invoices[0]).toMatchObject({ total: 4000, cost: 500, change: 1000 })
  await page.getByRole('button', { name: 'عرض وطباعة الفاتورة', exact: true }).click()
  await expect(page.locator('.r-receipt')).toContainText('وجبة اختبار')
  await page.getByRole('button', { name: 'إغلاق', exact: true }).click()
  await nav('الطاولات')
  await page.screenshot({ path: '.cache/screenshots/restaurant-tables.png', fullPage: true })
  expect((await rpc('restaurant.state')).tables[0].orderId).toBeNull()
  // Delivery workflow uses real configured fee and driver, no purchase-license fixture.
  await nav('التوصيل')
  await page.getByRole('button', { name: 'إضافة مندوب', exact: true }).click()
  await fill({ name: 'مندوب اختبار', phone: 'QA' })
  await save()
  await page.getByRole('button', { name: /رسوم التوصيل:/ }).click()
  await fill({ deliveryFee: '5' })
  await save()
  await page.getByRole('button', { name: 'طلب توصيل', exact: true }).click()
  await fill({ customerName: 'عميل اختبار', phone: 'QA', address: 'عنوان اختبار', note: '' })
  await save('إنشاء الطلب')
  await page.locator('.r-order-menu .r-menu-grid button').click()
  await save('إضافة للطلب')
  await page.getByRole('button', { name: 'إرسال للمطبخ', exact: true }).click()
  await nav('المطبخ')
  await page.getByRole('button', { name: 'بدء التحضير', exact: true }).click()
  await expect(page.getByRole('button', { name: 'جاهز', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'جاهز', exact: true }).click()
  await expect(page.getByRole('button', { name: 'جاهز', exact: true })).toHaveCount(0)
  await nav('التوصيل')
  await page.getByRole('button', { name: 'تعيين المندوب وإرسال', exact: true }).click()
  await save('إرسال مع المندوب')
  await page.getByRole('button', { name: 'تأكيد التسليم والتحصيل', exact: true }).click()
  await save('تسجيل التحصيل')
  expect(
    (await rpc('restaurant.state')).orders.find((o) => o.kind === 'delivery').invoice.total,
  ).toBe(2500)
  await nav('الحجوزات')
  await page.getByRole('button', { name: 'حجز طاولة', exact: true }).click()
  const local = (d) =>
    new Date(d - (Date.now() % 1000) - new Date().getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16)
  await fill({
    name: 'ضيف اختبار',
    phone: 'QA',
    guests: 2,
    startsAt: local(Date.now() + 3600000),
    endsAt: local(Date.now() + 7200000),
  })
  await save()
  await expect(page.locator('table')).toContainText('ضيف اختبار')
  // A committed creation must close its dialog even if the following refresh fails.
  await nav('الطلبات')
  const before = (await rpc('restaurant.state')).orders.length
  let failRefresh = false
  await page.route('**/api/rpc', async (route) => {
    const data = route.request().postDataJSON()
    if (data.action === 'restaurant.order.create') {
      const response = await route.fetch()
      failRefresh = true
      await route.fulfill({ response })
    } else if (data.action === 'restaurant.state' && failRefresh) {
      failRefresh = false
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'QA interrupted refresh' }),
      })
    } else await route.continue()
  })
  await page.getByRole('button', { name: 'طلب تيك أواي', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.r-main>.error')).toContainText('تم الحفظ')
  expect((await rpc('restaurant.state')).orders.length).toBe(before + 1)
  await page.unroute('**/api/rpc')
  await page.reload()
  await expect(page.locator('.r-sidebar')).toBeVisible()
  // Shared barcode label stays visible under print CSS despite its embedded ancestor.
  await nav('الخامات والباركود')
  await page.getByRole('button', { name: 'طباعة ملصق', exact: true }).click()
  await expect(page.locator('.barcode-label canvas')).toBeVisible()
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('.print-area')).toBeVisible()
  await page.emulateMedia({ media: 'screen' })
  await page.locator('.modal-header button').click()
  await page.setViewportSize({ width: 768, height: 1000 })
  await nav('الطاولات')
  await page.screenshot({ path: '.cache/screenshots/restaurant-small.png', fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  // Kitchen user sees no financial/customer data; browser state refresh survives reopening.
  await page.setViewportSize({ width: 1366, height: 900 })
  await rpc('user.save', {
    name: 'QA cook',
    username: 'cook',
    password: 'Kitchen-test-password-123!',
    role: 'kitchen',
    active: true,
  })
  await rpc('logout')
  await page.reload()
  await page.locator('[name="username"]').fill('cook')
  await page.locator('[name="password"]').fill('Kitchen-test-password-123!')
  await page.getByRole('button', { name: 'دخول إلى البرنامج', exact: true }).click()
  await expect(page.locator('.r-sidebar nav button')).toHaveCount(1)
  expect((await rpc('restaurant.state')).menu).toHaveLength(0)
  await page.getByRole('button', { name: 'كلمة المرور', exact: true }).click()
  await fill({
    currentPassword: 'Kitchen-test-password-123!',
    newPassword: 'Kitchen-new-password-456!',
  })
  await save()
  await expect(page.locator('.auth')).toBeVisible()
  expect(errors).toEqual([])
  console.log(
    'PASS Restaurant HTTP/UI: empty setup, shared barcode catalog, tables, recipe preparation, real costs, serving/settlement/change/receipt, driver/dispatch/fee/payment, reservation, kitchen account/password/session, responsive layout. QA=' +
      directory,
  )
} finally {
  if (browser) await browser.close()
  server.kill()
}
