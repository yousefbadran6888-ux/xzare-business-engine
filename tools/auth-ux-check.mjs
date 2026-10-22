import { chromium, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
const port = 5195,
  origin = `http://127.0.0.1:${port}`,
  directory = resolve('.cache', `auth-ux-${Date.now()}`)
const server = spawn(process.execPath, ['tools/preview.mjs'], {
  windowsHide: true,
  env: { ...process.env, XZARE_PORT: String(port), XZARE_DATA_DIR: directory },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let browser
try {
  for (let n = 0; n < 50; n++) {
    try {
      if ((await fetch(origin)).ok) break
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
  })
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(origin)
  await expect(page.getByText('الخطوة 1 من 2', { exact: true })).toBeVisible()
  mkdirSync('.cache/screenshots', { recursive: true })
  await page.screenshot({ path: '.cache/screenshots/auth-setup.png', fullPage: true })
  await page.locator('[name="businessName"]').fill('متجر اختبار تجربة الاستخدام')
  await page.locator('[name="name"]').fill('مسؤول الاختبار')
  await page.getByRole('button', { name: 'متابعة إلى الحساب', exact: true }).click()
  await expect(page.getByText('الخطوة 2 من 2', { exact: true })).toBeVisible()
  await page.locator('[name="username"]').fill('ux-owner')
  await page.locator('[name="password"]').fill('UX-test-password-123!')
  await page.locator('[name="confirmPassword"]').fill('Different-password-123!')
  await page.getByRole('button', { name: 'إنشاء المتجر', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('كلمتا المرور غير متطابقتين')
  await expect(page.locator('.sidebar')).toHaveCount(0)
  await page.getByRole('button', { name: 'إظهار كلمة المرور', exact: true }).click()
  await expect(page.locator('[name="password"]')).toHaveAttribute('type', 'text')
  await page.getByRole('button', { name: 'إخفاء كلمة المرور', exact: true }).click()
  await page.getByRole('button', { name: 'العودة لبيانات المتجر', exact: true }).click()
  await expect(page.locator('[name="businessName"]')).toHaveValue('متجر اختبار تجربة الاستخدام')
  await page.getByRole('button', { name: 'متابعة إلى الحساب', exact: true }).click()
  await page.locator('[name="confirmPassword"]').fill('UX-test-password-123!')
  await page.getByRole('button', { name: 'إنشاء المتجر', exact: true }).click()
  await expect(page.locator('.sidebar')).toBeVisible()
  await page.screenshot({ path: '.cache/screenshots/dashboard-fresh.png', fullPage: true })
  await page.getByRole('button', { name: 'تصغير القائمة', exact: true }).click()
  await page.getByRole('button', { name: 'نقطة البيع', exact: true }).click()
  await expect(page.locator('.page-heading h1')).toHaveText('نقطة البيع')
  await page.getByRole('button', { name: 'توسيع القائمة', exact: true }).click()
  await page.getByRole('button', { name: 'نظرة عامة', exact: true }).click()
  await page.getByRole('button', { name: 'مساعدة الاستخدام', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Shift+Tab')
  expect(await page.getByRole('dialog').evaluate((el) => el.contains(document.activeElement))).toBe(
    true,
  )
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.keyboard.press('Alt+n')
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.locator('[name="name"]').fill('اسم داخل نموذج')
  await page.keyboard.press('F2')
  await expect(page.locator('.page-heading h1')).toHaveText('نظرة عامة')
  await page.locator('[name="sku"]').fill('QA-FOCUS')
  await page.locator('[name="price"]').fill('10')
  const rejectSave = async (route) => {
    if (route.request().postDataJSON().action !== 'product.save') return route.continue()
    await new Promise((resolve) => setTimeout(resolve, 400))
    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: 'تعذر الحفظ في اختبار التركيز' }),
    })
  }
  await page.route('**/api/rpc', rejectSave)
  await page.locator('[name="price"]').press('Enter')
  await expect(page.getByRole('button', { name: 'إغلاق النافذة', exact: true })).toBeDisabled()
  await expect(page.locator('[name="price"]')).toBeFocused()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
    'تعذر الحفظ في اختبار التركيز',
  )
  await expect(page.locator('[name="price"]')).toBeFocused()
  await page.unroute('**/api/rpc', rejectSave)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'إغلاق التنبيه', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('.sidebar')).not.toBeVisible()
  await page.getByRole('button', { name: 'فتح القائمة', exact: true }).click()
  await expect(page.locator('.sidebar')).toBeVisible()
  await expect(page.getByRole('button', { name: 'نظرة عامة', exact: true })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  expect(await page.locator('.sidebar').evaluate((el) => el.contains(document.activeElement))).toBe(
    true,
  )
  await page.getByRole('button', { name: 'العملاء', exact: true }).click()
  await expect(page.locator('.sidebar')).not.toBeVisible()
  await expect(page.locator('.page-heading h1')).toHaveText('العملاء')
  await page.setViewportSize({ width: 1366, height: 900 })
  await page.getByRole('button', { name: 'نقطة البيع', exact: true }).click()
  for (const width of [1366, 1024]) {
    await page.setViewportSize({ width, height: 768 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `.cache/screenshots/cashier-${width}.png`, fullPage: true })
  }
  await page.getByRole('button', { name: 'قفل البرنامج', exact: true }).click()
  await expect(page.locator('[name="username"]')).toBeVisible()
  await page.locator('[name="username"]').fill('ux-owner')
  await page.locator('[name="password"]').fill('Wrong-password-123!')
  await page.getByRole('button', { name: 'دخول إلى البرنامج', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.locator('[name="password"]')).toHaveValue('')
  await page.locator('[name="password"]').fill('UX-test-password-123!')
  await page.getByRole('button', { name: 'دخول إلى البرنامج', exact: true }).click()
  await expect(page.locator('.sidebar')).toBeVisible()
  await page.getByRole('button', { name: 'قفل البرنامج', exact: true }).click()
  for (const width of [1366, 1024, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 768 })
    await expect(page.getByRole('button', { name: 'دخول إلى البرنامج', exact: true })).toBeVisible()
    await page.screenshot({ path: `.cache/screenshots/login-${width}.png`, fullPage: true })
    const overflow = await page.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
      elements: [...document.querySelectorAll('*')]
        .filter(
          (el) =>
            el.getBoundingClientRect().right > innerWidth + 1 ||
            el.getBoundingClientRect().left < -1,
        )
        .map((el) => ({
          tag: el.tagName,
          class: el.className,
          width: el.getBoundingClientRect().width,
        })),
    }))
    if (overflow.scroll > overflow.width) console.log(overflow)
    expect(overflow.scroll <= overflow.width).toBe(true)
  }
  expect(errors).toEqual([])
  console.log(
    'PASS: two-step setup, confirmation, password visibility/clearing, valid re-login, collapsed navigation, dialog keyboard trap/Escape, save failure preserves field focus, shortcuts ignore input, mobile drawer focus, responsive auth/cashier. Isolated QA only; rejected save uses a UI transport fixture.',
  )
} finally {
  await browser?.close()
  server.kill()
}
