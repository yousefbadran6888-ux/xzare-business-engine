import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { copyFileSync } from 'node:fs'
const require = createRequire(import.meta.url),
  root = resolve(import.meta.dirname, '..'),
  task = process.argv[2]
const product = task?.endsWith(':real-estate')
  ? 'real-estate'
  : task?.endsWith(':hotel')
    ? 'hotel'
    : task?.endsWith(':salon')
      ? 'salon'
      : task?.endsWith(':gym')
        ? 'gym'
        : task?.endsWith(':education')
          ? 'education'
          : task?.endsWith(':crm')
            ? 'crm'
            : task?.endsWith(':hr')
              ? 'hr'
              : task?.endsWith(':pharmacy')
                ? 'pharmacy'
                : task?.endsWith(':laboratory')
                  ? 'laboratory'
                  : task?.endsWith(':clinic')
                    ? 'clinic'
                    : task?.endsWith(':service-center')
                      ? 'service-center'
                      : task?.endsWith(':workshop')
                        ? 'workshop'
                        : task?.endsWith(':manufacturing')
                          ? 'manufacturing'
                          : task?.endsWith(':inventory')
                            ? 'inventory'
                            : task?.endsWith(':accounting')
                              ? 'accounting'
                              : task?.endsWith(':restaurant')
                                ? 'restaurant'
                                : 'pos'
const run = (script, args = []) => {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
    env: {
      ...process.env,
      ELECTRON_BUILDER_CACHE: resolve(root, '.cache', 'electron-builder'),
      ELECTRON_CACHE: resolve(root, '.cache', 'electron'),
    },
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
const tsc = require.resolve('typescript/bin/tsc'),
  vite = resolve(root, 'node_modules/vite/bin/vite.js'),
  vitest = resolve(root, 'node_modules/vitest/vitest.mjs')
const build = () => {
  copyFileSync(resolve(root, 'tools/windows-identity.cjs'), resolve(root, 'apps', product, 'windows-identity.cjs'))
  copyFileSync(
    resolve(root, 'tools/desktop-main.cjs'),
    resolve(root, 'apps', product, 'desktop-main.cjs'),
  )
  run(tsc, ['--build'])
  if (product === 'real-estate') run(resolve(root, 'tools/stage-real-estate.mjs'))
  run(vite, [
    'build',
    `apps/${product}`,
    '--config',
    `apps/${product}/vite.config.ts`,
    '--configLoader',
    'runner',
  ])
}
if (task === 'build') run(tsc, ['--build'])
else if (task === 'typecheck') {
  run(tsc, ['--build'])
  run(tsc, ['-p', 'tsconfig.tests.json'])
} else if (task === 'test') run(vitest, ['run', '--configLoader', 'runner'])
else if (task === 'verify') {
  run(tsc, ['--build'])
  run(tsc, ['-p', 'tsconfig.tests.json'])
  run(vitest, ['run', '--configLoader', 'runner'])
} else if (
  task === 'build:real-estate' ||
  task === 'build:hotel' ||
  task === 'build:salon' ||
  task === 'build:gym' ||
  task === 'build:education' ||
  task === 'build:crm' ||
  task === 'build:hr' ||
  task === 'build:pharmacy' ||
  task === 'build:laboratory' ||
  task === 'build:clinic' ||
  task === 'build:pos' ||
  task === 'build:restaurant' ||
  task === 'build:accounting' ||
  task === 'build:inventory' ||
  task === 'build:manufacturing' ||
  task === 'build:service-center' ||
  task === 'build:workshop'
)
  build()
else if (
  task === 'dev:real-estate' ||
  task === 'dev:hotel' ||
  task === 'dev:salon' ||
  task === 'dev:gym' ||
  task === 'dev:education' ||
  task === 'dev:crm' ||
  task === 'dev:hr' ||
  task === 'dev:pharmacy' ||
  task === 'dev:laboratory' ||
  task === 'dev:clinic' ||
  task === 'dev:pos' ||
  task === 'dev:restaurant' ||
  task === 'dev:accounting' ||
  task === 'dev:inventory' ||
  task === 'dev:manufacturing' ||
  task === 'dev:service-center' ||
  task === 'dev:workshop'
) {
  build()
  run(resolve(root, 'tools/preview.mjs'), [product])
} else if (
  task === 'start:real-estate' ||
  task === 'start:hotel' ||
  task === 'start:salon' ||
  task === 'start:gym' ||
  task === 'start:education' ||
  task === 'start:crm' ||
  task === 'start:hr' ||
  task === 'start:pharmacy' ||
  task === 'start:laboratory' ||
  task === 'start:clinic' ||
  task === 'start:pos' ||
  task === 'start:restaurant' ||
  task === 'start:accounting' ||
  task === 'start:inventory' ||
  task === 'start:manufacturing' ||
  task === 'start:service-center' ||
  task === 'start:workshop'
) {
  build()
  const child = spawnSync(require('electron'), [`apps/${product}`], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
  })
  process.exit(child.status ?? 1)
} else if (
  task === 'package:real-estate' ||
  task === 'package:hotel' ||
  task === 'package:salon' ||
  task === 'package:gym' ||
  task === 'package:education' ||
  task === 'package:crm' ||
  task === 'package:hr' ||
  task === 'package:pharmacy' ||
  task === 'package:laboratory' ||
  task === 'package:clinic' ||
  task === 'package:pos' ||
  task === 'package:restaurant' ||
  task === 'package:accounting' ||
  task === 'package:inventory' ||
  task === 'package:manufacturing' ||
  task === 'package:service-center' ||
  task === 'package:workshop'
) {
  run(resolve(root, 'tools/collect-notices.mjs'), [product])
  build()
  run(resolve(root, 'node_modules/electron-builder/cli.js'), [
    '--projectDir',
    `apps/${product}`,
    '--config',
    'electron-builder.yml',
    `--config.electronDist=${resolve(root, 'node_modules/electron/dist')}`,
    `--config.directories.output=${resolve(root, 'artifacts', ...(product !== 'pos' ? [product] : []))}`,
    ...process.argv.slice(3),
  ])
} else throw new Error('Unknown build task')
