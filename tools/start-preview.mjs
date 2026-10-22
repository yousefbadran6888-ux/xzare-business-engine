import { spawn } from 'node:child_process'
import { mkdirSync, openSync, closeSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
const root = resolve(import.meta.dirname, '..')
const product =
  process.argv[2] === 'real-estate'
    ? 'real-estate'
    : process.argv[2] === 'hotel'
      ? 'hotel'
      : process.argv[2] === 'salon'
        ? 'salon'
        : process.argv[2] === 'gym'
          ? 'gym'
          : process.argv[2] === 'education'
            ? 'education'
            : process.argv[2] === 'crm'
              ? 'crm'
              : process.argv[2] === 'hr'
                ? 'hr'
                : process.argv[2] === 'pharmacy'
                  ? 'pharmacy'
                  : process.argv[2] === 'laboratory'
                    ? 'laboratory'
                    : process.argv[2] === 'clinic'
                      ? 'clinic'
                      : process.argv[2] === 'service-center'
                        ? 'service-center'
                        : process.argv[2] === 'workshop'
                          ? 'workshop'
                          : process.argv[2] === 'manufacturing'
                            ? 'manufacturing'
                            : process.argv[2] === 'inventory'
                              ? 'inventory'
                              : process.argv[2] === 'accounting'
                                ? 'accounting'
                                : process.argv[2] === 'restaurant'
                                  ? 'restaurant'
                                  : 'pos'
const port =
  product === 'real-estate'
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
                                  : 5191
const url = 'http://127.0.0.1:' + port
const version = JSON.parse(
  readFileSync(resolve(root, 'apps', product, 'package.json'), 'utf8'),
).version
async function health() {
  try {
    const response = await fetch(url + '/healthz', {
      signal: AbortSignal.timeout(1000),
    })
    if (!response.ok) throw new Error('occupied')
    const data = await response.json()
    if (data.product !== product || data.version !== version || data.preview !== true)
      throw new Error('occupied')
    return true
  } catch (error) {
    if (error.message === 'occupied')
      throw new Error('المنفذ مشغول بنسخة مختلفة؛ أغلقها قبل تشغيل هذه النسخة.')
    return false
  }
}
if (!(await health())) {
  mkdirSync(resolve(root, '.cache'), { recursive: true })
  const log = openSync(resolve(root, '.cache', product + '-preview.log'), 'a')
  const child = spawn(process.execPath, [resolve(root, 'tools/preview.mjs'), product], {
    cwd: root,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', log, log],
    env: {
      ...process.env,
      XZARE_PORT: String(port),
      XZARE_DATA_DIR: resolve(root, 'data', product !== 'pos' ? product + '-preview' : 'preview'),
    },
  })
  closeSync(log)
  let failure
  child.on('error', (error) => {
    failure = error
  })
  child.unref()
  let ready = false
  for (let attempt = 0; attempt < 100; attempt++) {
    if (failure) throw failure
    if (await health()) {
      ready = true
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  if (!ready) throw new Error('تعذر تشغيل المعاينة؛ راجع سجل التشغيل داخل .cache.')
}
console.log(url)
