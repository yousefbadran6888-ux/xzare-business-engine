import { createRequire } from 'node:module'
import { resolve, join } from 'node:path'
import { readFileSync } from 'node:fs'
const require = createRequire(import.meta.url),
  asar = require(
    resolve('node_modules/.pnpm/@electron+asar@3.4.1/node_modules/@electron/asar/lib/asar.js'),
  )
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
                                  : 'pos',
  output = process.argv[3] ?? (product !== 'pos' ? 'artifacts/' + product : 'artifacts')
const archive = resolve(output, 'win-unpacked/resources/app.asar'),
  files = asar.listPackage(archive)
console.log('PACKAGED ENTRIES', files.length)
const normalized = files.map((path) => path.replaceAll('\\', '/'))
const forbidden = normalized.filter((path) =>
  /private-key|license-authority|device-license|\.test\.|tsbuildinfo|\.sqlite|\.xzbak|\.vendor|\/\.cache\//.test(
    path,
  ),
)
if (forbidden.length) throw new Error('Unexpected private/test/data files in customer build')
for (const required of [
  '/license-public-key.pem',
  '/licensing.json',
  '/build/icon.ico',
  '/dist/icon.svg',
  '/THIRD_PARTY_NOTICES.txt',
  '/node_modules/@node-rs/argon2-win32-x64-msvc/argon2.win32-x64-msvc.node',
  '/node_modules/better-sqlite3/prebuilds/win32-x64.node',
])
  if (!normalized.includes(required)) throw new Error('Missing required runtime file: ' + required)
for (const file of [
  'identity.js',
  'service.js',
  'runtime.js',
  ...(product === 'real-estate'
    ? ['real-estate.js', 'real-estate-validation.js', 'clinic-time.js']
    : product === 'hotel'
      ? ['hotel.js', 'hotel-validation.js', 'clinic-time.js']
      : product === 'salon'
        ? ['salon.js', 'salon-validation.js', 'clinic-time.js']
        : product === 'gym'
          ? ['gym.js', 'gym-validation.js', 'clinic-time.js']
          : product === 'education'
            ? ['education.js', 'education-validation.js', 'clinic-time.js']
            : product === 'crm'
              ? ['crm.js', 'crm-validation.js', 'clinic-time.js']
              : product === 'hr'
                ? ['hr.js', 'hr-validation.js', 'clinic-time.js']
                : product === 'pharmacy'
                  ? ['pharmacy.js', 'pharmacy-validation.js', 'clinic-time.js']
                  : product === 'laboratory'
                    ? ['laboratory.js', 'laboratory-validation.js', 'clinic-time.js']
                    : product === 'clinic'
                      ? ['clinic.js', 'clinic-validation.js', 'clinic-time.js']
                      : product === 'service-center'
                        ? [
                            'inventory.js',
                            'inventory-validation.js',
                            'service-center.js',
                            'service-center-validation.js',
                          ]
                        : product === 'workshop'
                          ? [
                              'inventory.js',
                              'inventory-validation.js',
                              'workshop.js',
                              'workshop-validation.js',
                            ]
                          : product === 'manufacturing'
                            ? [
                                'inventory.js',
                                'inventory-validation.js',
                                'manufacturing.js',
                                'manufacturing-validation.js',
                              ]
                            : product === 'inventory'
                              ? ['inventory.js', 'inventory-validation.js']
                              : product === 'accounting'
                                ? ['accounting.js', 'accounting-validation.js']
                                : []),
]) {
  if (
    !asar
      .extractFile(archive, join('node_modules', '@xzare', 'engine', 'dist', file))
      .equals(readFileSync(resolve('packages/engine/dist', file)))
  )
    throw new Error('Packaged engine differs from verified build: ' + file)
}
const entry = asar.extractFile(archive, 'main.cjs').toString()
if (!entry.includes("__dirname, '" + product + "'")) throw new Error('Wrong product entry')
const main = asar.extractFile(archive, 'desktop-main.cjs').toString()
if (
  main.includes('--no-sandbox') ||
  !main.includes('sandbox: true') ||
  !main.includes('contextIsolation: true') ||
  !main.includes('nodeIntegration: false')
)
  throw new Error('Desktop security configuration differs from the verified source')
if (
  !main.includes('safeStorage.encryptString') ||
  !main.includes('!app.isPackaged') ||
  !main.includes('PSModuleAutoLoadingPreference')
)
  throw new Error('Missing protected licensing or production/environment safeguards')
const fuses = require(
  resolve('node_modules/.pnpm/@electron+fuses@1.8.0/node_modules/@electron/fuses'),
)
const { FuseState } = require(
  resolve(
    'node_modules/.pnpm/@electron+fuses@1.8.0/node_modules/@electron/fuses/dist/constants.js',
  ),
)
const wire = await fuses.getCurrentFuseWire(
  resolve(
    output,
    'win-unpacked',
    product === 'real-estate'
      ? 'Xzare Real Estate.exe'
      : product === 'hotel'
        ? 'Xzare Hotel.exe'
        : product === 'salon'
          ? 'Xzare Salon.exe'
          : product === 'gym'
            ? 'Xzare Gym.exe'
            : product === 'education'
              ? 'Xzare Education.exe'
              : product === 'crm'
                ? 'Xzare CRM.exe'
                : product === 'hr'
                  ? 'Xzare HR.exe'
                  : product === 'pharmacy'
                    ? 'Xzare Pharmacy.exe'
                    : product === 'laboratory'
                      ? 'Xzare Laboratory.exe'
                      : product === 'clinic'
                        ? 'Xzare Clinic.exe'
                        : product === 'service-center'
                          ? 'Xzare Service Center.exe'
                          : product === 'workshop'
                            ? 'Xzare Workshop.exe'
                            : product === 'manufacturing'
                              ? 'Xzare Manufacturing.exe'
                              : product === 'inventory'
                                ? 'Xzare Inventory.exe'
                                : product === 'accounting'
                                  ? 'Xzare Accounting.exe'
                                  : product === 'restaurant'
                                    ? 'Xzare Restaurant.exe'
                                    : 'Xzare POS.exe',
  ),
)
for (const [name, state] of [
  ['RunAsNode', FuseState.DISABLE],
  ['EnableNodeOptionsEnvironmentVariable', FuseState.DISABLE],
  ['EnableNodeCliInspectArguments', FuseState.DISABLE],
  ['EnableEmbeddedAsarIntegrityValidation', FuseState.ENABLE],
  ['OnlyLoadAppFromAsar', FuseState.ENABLE],
]) {
  if (wire[fuses.FuseV1Options[name]] !== state)
    throw new Error('Unexpected production fuse: ' + name)
}
const licensing = JSON.parse(asar.extractFile(archive, 'licensing.json').toString())
if (licensing.requireOnlineAfterReboot !== true) throw new Error('Unexpected offline reboot policy')
console.log(
  'PASS: actual production fuses, protected device storage, online reboot policy. Activation host:',
  licensing.origin
    ? 'configured (deployment still requires live verification)'
    : 'not configured; review build only',
)
console.log(
  'PASS: required native modules/public key/notices, no private key/database/test files, sandbox/isolation configured',
)
console.log(
  'NATIVE',
  files.filter((f) => /\.node$/.test(f)),
)
console.log(
  'UNEXPECTED',
  files.filter((f) => /private-key|\.test\.|tsbuildinfo|[/\\]src[/\\]/.test(f)).slice(0, 8),
)
