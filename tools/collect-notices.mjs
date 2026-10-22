import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url),
  base = resolve(import.meta.dirname, '..')
const scheduler = dirname(
  createRequire(require.resolve('react-dom')).resolve('scheduler/package.json'),
)
const packages = [
  ['React', 'node_modules/react', ['LICENSE']],
  ['React DOM', 'node_modules/react-dom', ['LICENSE']],
  ['Scheduler', scheduler, ['LICENSE']],
  [
    'bwip-js and embedded fonts/helpers',
    'node_modules/bwip-js',
    ['LICENSE', 'LICENSE.INCONSOLATA', 'LICENSE.CANVASTOBLOB', 'LICENSE.FILESAVER'],
  ],
  ['Zod', 'packages/engine/node_modules/zod', ['LICENSE']],
  ['Argon2 Node binding', 'packages/engine/node_modules/@node-rs/argon2', ['LICENSE']],
  ['better-sqlite3', 'packages/db/node_modules/better-sqlite3', ['LICENSE']],
]
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
let output =
  'XZARE BUSINESS SOFTWARE — THIRD-PARTY NOTICES\n\nElectron and Chromium notices are distributed separately as LICENSE.electron.txt and LICENSES.chromium.html. Runtime modules also retain their license files.\n'
for (const [name, path, licenses] of packages) {
  const directory = resolve(base, path),
    metadata = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
  output += `\n${'='.repeat(72)}\n${name} (${metadata.version})\n`
  for (const file of licenses) {
    const target = join(directory, file)
    if (!existsSync(target)) throw new Error(`Missing required notice: ${name}/${file}`)
    output += `\n--- ${file} ---\n${readFileSync(target, 'utf8')}\n`
  }
}
writeFileSync(join(base, 'apps', product, 'THIRD_PARTY_NOTICES.txt'), output)
console.log('Collected bundled frontend/font and runtime third-party notices')
