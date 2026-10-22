import { createServer } from 'node:http'
import { readFileSync, writeFileSync, unlinkSync, existsSync, statSync } from 'node:fs'
import { join, resolve, extname } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import os from 'node:os'
import { Runtime, publicError, DeviceQuotaExceeded } from '../packages/engine/dist/index.js'
const product = process.argv.includes('real-estate')
  ? 'real-estate'
  : process.argv.includes('hotel')
    ? 'hotel'
    : process.argv.includes('salon')
      ? 'salon'
      : process.argv.includes('gym')
        ? 'gym'
        : process.argv.includes('education')
          ? 'education'
          : process.argv.includes('crm')
            ? 'crm'
            : process.argv.includes('hr')
              ? 'hr'
              : process.argv.includes('pharmacy')
                ? 'pharmacy'
                : process.argv.includes('laboratory')
                  ? 'laboratory'
                  : process.argv.includes('clinic')
                    ? 'clinic'
                    : process.argv.includes('service-center')
                      ? 'service-center'
                      : process.argv.includes('workshop')
                        ? 'workshop'
                        : process.argv.includes('manufacturing')
                          ? 'manufacturing'
                          : process.argv.includes('inventory')
                            ? 'inventory'
                            : process.argv.includes('accounting')
                              ? 'accounting'
                              : process.argv.includes('restaurant')
                                ? 'restaurant'
                                : 'pos'
const root = resolve(import.meta.dirname, '..'),
  port = Number(
    process.env.XZARE_PORT ??
      (product === 'real-estate'
        ? 5234
        : product === 'hotel'
          ? 5232
          : product === 'salon'
            ? 5230
            : product === 'gym'
              ? 5228
              : product === 'education'
                ? 5226
                : product === 'crm'
                  ? 5224
                  : product === 'hr'
                    ? 5222
                    : product === 'pharmacy'
                      ? 5220
                      : product === 'laboratory'
                        ? 5218
                        : product === 'clinic'
                          ? 5216
                          : product === 'service-center'
                            ? 5214
                            : product === 'workshop'
                              ? 5212
                              : product === 'manufacturing'
                                ? 5209
                                : product === 'inventory'
                                  ? 5206
                                  : product === 'accounting'
                                    ? 5201
                                    : product === 'restaurant'
                                      ? 5196
                                      : 5191),
  ),
  host = `127.0.0.1:${port}`,
  origin = `http://${host}`,
  dist = join(root, 'apps', product, 'dist'),
  directory =
    process.env.XZARE_DATA_DIR ??
    join(root, 'data', product !== 'pos' ? product + '-preview' : 'preview')
const runtime = new Runtime(
  directory,
  readFileSync(join(root, 'apps', product, 'license-public-key.pem'), 'utf8'),
  createHash('sha256')
    .update('xzare-preview:' + os.hostname())
    .digest('hex'),
  undefined,
  product,
)
const security = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
}
const cookieName =
  product === 'real-estate'
    ? 'xzare_estate_session'
    : product === 'hotel'
      ? 'xzare_hotel_session'
      : product === 'salon'
        ? 'xzare_salon_session'
        : product === 'gym'
          ? 'xzare_gym_session'
          : product === 'education'
            ? 'xzare_education_session'
            : product === 'crm'
              ? 'xzare_crm_session'
              : product === 'hr'
                ? 'xzare_hr_session'
                : product === 'pharmacy'
                  ? 'xzare_pharmacy_session'
                  : product === 'laboratory'
                    ? 'xzare_laboratory_session'
                    : product === 'clinic'
                      ? 'xzare_clinic_session'
                      : product === 'service-center'
                        ? 'xzare_service_center_session'
                        : product === 'workshop'
                          ? 'xzare_workshop_session'
                          : product === 'manufacturing'
                            ? 'xzare_manufacturing_session'
                            : product === 'inventory'
                              ? 'xzare_inventory_session'
                              : product === 'accounting'
                                ? 'xzare_accounting_session'
                                : 'xzare_session'
const cookie = (token) =>
  `${cookieName}=${token ?? ''}; HttpOnly; SameSite=Strict; Path=/; ${token ? 'Max-Age=28800' : 'Max-Age=0'}`
const send = (res, status, value, headers = {}) => {
  res.writeHead(status, {
    ...security,
    'Content-Type': 'application/json; charset=utf-8',
    ...headers,
  })
  res.end(JSON.stringify(value))
}
async function body(req, limit) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('حجم الطلب غير مسموح')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}
const server = createServer(async (req, res) => {
  try {
    if (req.headers.host !== host) {
      send(res, 403, { ok: false, error: 'طلب غير مسموح' })
      return
    }
    const url = new URL(req.url, origin),
      token =
        new RegExp('(?:^|;\\s*)' + cookieName + '=([a-f0-9]{64})(?:;|$)').exec(
          req.headers.cookie ?? '',
        )?.[1] ?? null
    if (url.pathname.startsWith('/api/')) {
      if (
        req.method !== 'POST' ||
        req.headers.origin !== origin ||
        req.headers['x-xzare-request'] !== '1'
      ) {
        send(res, 403, { ok: false, error: 'طلب غير مسموح' })
        return
      }
      if (url.pathname === '/api/restore') {
        runtime.engine.identity.require(token, 'admin')
        const bytes = await body(req, 128 * 1024 * 1024),
          path = join(directory, `upload-${randomUUID()}.xzbak`)
        writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 })
        try {
          await runtime.restore(
            token,
            decodeURIComponent(String(req.headers['x-xzare-password'] ?? '')),
            path,
          )
          send(res, 200, { ok: true, value: { restored: true } }, { 'Set-Cookie': cookie(null) })
        } finally {
          unlinkSync(path)
        }
        return
      }
      if (
        url.pathname !== '/api/rpc' ||
        !req.headers['content-type']?.startsWith('application/json')
      ) {
        send(res, 400, { ok: false, error: 'طلب غير مسموح' })
        return
      }
      const input = JSON.parse(
        (
          await body(
            req,
            [
              'laboratory',
              'hr',
              'crm',
              'education',
              'gym',
              'salon',
              'real-estate',
              'hotel',
            ].includes(product)
              ? 1024 * 1024
              : 65536,
          )
        ).toString('utf8'),
      )
      if (
        !input ||
        typeof input.action !== 'string' ||
        Object.keys(input).some((k) => k !== 'action' && k !== 'payload')
      )
        throw new Error('بيانات غير صالحة')
      const { action, payload = {} } = input
      let value,
        headers = {}
      if (action === 'backup.create') {
        const name = `Xzare-${new Date().toISOString().slice(0, 10)}.xzbak`,
          path = join(directory, `download-${randomUUID()}.xzbak`)
        try {
          await runtime.backup(token, path)
          value = {
            download: readFileSync(path).toString('base64'),
            fileName: name,
          }
        } finally {
          if (existsSync(path)) unlinkSync(path)
        }
      } else {
        if (!runtime.actions.has(action)) throw new Error('العملية غير متاحة')
        value = await runtime.call(action, payload, token)
        if (action === 'setup' || action === 'login') {
          headers = { 'Set-Cookie': cookie(value.token) }
          value = { authenticated: true }
        }
        if (action === 'logout' || action === 'password.change')
          headers = { 'Set-Cookie': cookie(null) }
      }
      send(res, 200, { ok: true, value }, headers)
      return
    }
    if (req.method !== 'GET') {
      send(res, 405, { ok: false, error: 'طلب غير مسموح' })
      return
    }
    if (url.pathname === '/healthz') {
      send(res, 200, {
        product,
        version: JSON.parse(readFileSync(join(root, 'apps', product, 'package.json'), 'utf8'))
          .version,
        preview: true,
      })
      return
    }
    let path = resolve(dist, '.' + decodeURIComponent(url.pathname))
    if (!path.startsWith(dist + '\\') && path !== dist) {
      send(res, 403, { ok: false })
      return
    }
    if (!existsSync(path) || statSync(path).isDirectory()) path = join(dist, 'index.html')
    const mime =
      {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
      }[extname(path)] ?? 'application/octet-stream'
    res.writeHead(200, { ...security, 'Content-Type': mime })
    res.end(readFileSync(path))
  } catch (error) {
    if (!res.headersSent) send(res, error instanceof DeviceQuotaExceeded ? 409 : 400, { ok: false, error: publicError(error),
      ...(error instanceof DeviceQuotaExceeded ? { code: 'DEVICE_QUOTA_EXCEEDED', devices: error.devices } : {}) })
    else res.end()
  }
})
server.requestTimeout = 30000
server.headersTimeout = 10000
server.listen(port, '127.0.0.1', () =>
  console.log(
    `Xzare ${product === 'real-estate' ? 'Real Estate' : product === 'hotel' ? 'Hotel' : product === 'salon' ? 'Salon' : product === 'gym' ? 'Gym' : product === 'education' ? 'Education' : product === 'crm' ? 'CRM' : product === 'hr' ? 'HR' : product === 'pharmacy' ? 'Pharmacy' : product === 'laboratory' ? 'Laboratory' : product === 'clinic' ? 'Clinic' : product === 'service-center' ? 'Service Center' : product === 'workshop' ? 'Workshop' : product === 'manufacturing' ? 'Manufacturing' : product === 'inventory' ? 'Inventory' : product === 'accounting' ? 'Accounting' : product === 'restaurant' ? 'Restaurant' : 'POS'} preview: ${origin}`,
  ),
)
runtime.dailyBackup().catch(() => {})
const timer = setInterval(() => runtime.dailyBackup().catch(() => {}), 3600000)
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    clearInterval(timer)
    server.close()
    runtime.shutdown().finally(() => process.exit(0))
  })
