import { generateKeyPairSync, sign, createPrivateKey } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
const root = resolve(import.meta.dirname, '..'),
  secret = join(root, '.vendor', 'license-private-key.pem'),
  publicPath = join(root, 'apps', 'pos', 'license-public-key.pem')
if (process.argv[2] === 'init') {
  if (existsSync(secret) || existsSync(publicPath))
    throw new Error('Keys already exist; refusing to replace commercial identity')
  mkdirSync(join(root, '.vendor'), { recursive: true })
  const keys = generateKeyPairSync('ed25519')
  writeFileSync(secret, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }), {
    mode: 0o600,
    flag: 'wx',
  })
  writeFileSync(publicPath, keys.publicKey.export({ type: 'spki', format: 'pem' }), { flag: 'wx' })
  if (process.platform === 'win32') {
    const secure = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-File', join(root, 'tools', 'secure-vendor-key.ps1')],
      { windowsHide: true, stdio: 'inherit' },
    )
    if (secure.status !== 0)
      throw new Error('Restrict Windows private-key ACL before using vendor signing')
  }
  console.log(
    'Created vendor private key and distributable public key. Keep .vendor offline and private.',
  )
} else if (process.argv[2] === 'issue') {
  const [device, customer, output, expires] = process.argv.slice(3)
  if (!/^[a-f0-9]{64}$/.test(device ?? '') || !customer || customer.length > 160 || !output)
    throw new Error('Usage: node tools/license-keys.mjs issue DEVICE CUSTOMER OUTPUT [EXPIRES_ISO]')
  const expiresAt = expires ? Date.parse(expires) : null
  if (expiresAt !== null && (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()))
    throw new Error('Invalid expiry')
  const payload = Buffer.from(
    JSON.stringify({
      product: 'xzare-pos',
      version: 1,
      licenseId: crypto.randomUUID(),
      customer,
      device,
      issuedAt: Date.now(),
      expiresAt,
    }),
  )
  writeFileSync(
    resolve(output),
    JSON.stringify({
      payload: payload.toString('base64url'),
      signature: sign(null, payload, createPrivateKey(readFileSync(secret))).toString('base64url'),
    }),
    { mode: 0o600, flag: 'wx' },
  )
  console.log('Signed license written.')
} else throw new Error('Use init or issue. Private key is never bundled into customer builds.')
