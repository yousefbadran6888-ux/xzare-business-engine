import { mkdirSync, readFileSync, writeFileSync, cpSync, existsSync } from 'node:fs'
import { resolve, join, dirname, relative, sep } from 'node:path'
import { createRequire } from 'node:module'
const root = resolve(import.meta.dirname, '..'),
  target = join(root, 'apps', 'real-estate', 'node_modules'),
  seen = new Set()
function locate(from, name) {
  const require = createRequire(join(from, 'package.json'))
  let p = dirname(require.resolve(name))
  while (p !== dirname(p)) {
    const f = join(p, 'package.json')
    if (existsSync(f) && JSON.parse(readFileSync(f, 'utf8')).name === name) return p
    p = dirname(p)
  }
  throw Error('Dependency missing: ' + name)
}
function stage(from, name) {
  if (seen.has(name)) return
  seen.add(name)
  const workspace = name.startsWith('@xzare/'),
    source = workspace ? join(root, 'packages', name.split('/')[1]) : locate(from, name),
    meta = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')),
    dest = join(target, name)
  mkdirSync(dest, { recursive: true })
  if (workspace) {
    writeFileSync(join(dest, 'package.json'), JSON.stringify(meta, null, 2))
    cpSync(join(source, 'dist'), join(dest, 'dist'), { recursive: true, dereference: true })
  } else
    cpSync(source, dest, {
      recursive: true,
      dereference: true,
      filter: (p) => relative(source, p).split(sep)[0] !== 'node_modules',
    })
  for (const dependency of Object.keys(meta.dependencies ?? {})) stage(source, dependency)
  if (name === '@node-rs/argon2') stage(source, '@node-rs/argon2-win32-x64-msvc')
}
for (const name of ['@xzare/engine', '@xzare/core', '@xzare/barcode']) stage(root, name)
console.log('Staged Windows runtime dependencies: ' + [...seen].join(', '))
