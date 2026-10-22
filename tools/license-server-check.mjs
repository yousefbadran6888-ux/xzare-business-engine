import assert from 'node:assert/strict'
import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { openDatabase } from '../packages/db/dist/index.js'
import { OnlineLicense } from '../packages/engine/dist/index.js'
import { LicenseAuthority } from '../packages/engine/dist/license-authority.js'
import { createLicenseServer } from './license-server.mjs'

const cache = resolve('.cache')
mkdirSync(cache, { recursive: true })
const directory = mkdtempSync(join(cache, 'licensing-check-'))
const keys = generateKeyPairSync('ed25519'),
  pub = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  priv = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const db = openDatabase(':memory:'),
  authority = new LicenseAuthority(db, priv),
  proxyToken = randomBytes(32).toString('hex')
const server = createLicenseServer(authority, { proxyToken })
const protector = { seal: (value) => Buffer.from(value), open: (value) => value.toString() } // HTTP fixture only; never used in production.
try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const client = new OnlineLicense(directory, pub, protector, null)
  const purchase = authority.issue('Isolated HTTP test')
  const send = (request, ip = '192.0.2.1', token = proxyToken) =>
    fetch(origin + '/v1/license', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Xzare-Proxy-Token': token,
        'X-Xzare-Client-IP': ip,
      },
      body: JSON.stringify(request),
    })
  // Invalid routes cannot consume the renewal budget for paying customers.
  for (let i = 0; i < 70; i++) {
    const r = await fetch(origin + '/wrong-route')
    assert.equal(r.status, 404)
    await r.arrayBuffer()
  }
  const request = client.request('activate', purchase.code),
    activated = await send(request)
  assert.equal(activated.status, 200)
  const result = await activated.json()
  assert.equal(typeof result.lease, 'string')
  const replay = await send(request)
  assert.equal(replay.status, 400)
  await replay.arrayBuffer()
  const proxyFault = await send(client.request('renew', purchase.id), '192.0.2.1', 'incorrect')
  assert.equal(proxyFault.status, 503)
  await proxyFault.arrayBuffer()
  // One abusive source cannot use another source's budget.
  for (let i = 0; i < 61; i++) {
    const r = await send({}, '192.0.2.2')
    await r.arrayBuffer()
    if (i === 60) assert.equal(r.status, 429)
  }
  const healthy = await send(client.request('renew', purchase.id), '192.0.2.3')
  assert.equal(healthy.status, 200)
  await healthy.arrayBuffer()
  authority.revoke(purchase.id)
  const revoked = await send(client.request('renew', purchase.id), '192.0.2.3')
  assert.equal(revoked.status, 403)
  await revoked.arrayBuffer()
  db.exec('DROP TABLE license_events')
  const second = authority.issue('Transient database failure test')
  const failure = await send(client.request('activate', second.code), '192.0.2.3')
  assert.equal(failure.status, 503)
  await failure.arrayBuffer()
  // Issuance output failure must roll back the purchase transaction.
  const keyPath = join(directory, 'synthetic-private.pem'),
    configPath = join(directory, 'config.json'),
    databasePath = join(directory, 'authority.sqlite'),
    outputPath = join(directory, 'occupied.json')
  writeFileSync(keyPath, priv, { mode: 0o600 })
  writeFileSync(outputPath, 'keep-existing')
  writeFileSync(configPath, JSON.stringify({ database: databasePath, privateKey: keyPath }))
  const issue = spawnSync(
    process.execPath,
    ['tools/license-server.mjs', 'issue', configPath, 'Output failure test', outputPath],
    { windowsHide: true, encoding: 'utf8' },
  )
  assert.notEqual(issue.status, 0)
  assert.equal(readFileSync(outputPath, 'utf8'), 'keep-existing')
  const check = openDatabase(databasePath)
  try {
    assert.equal(check.prepare('SELECT count(*) AS n FROM license_accounts').get().n, 0)
  } finally {
    check.close()
  }
  console.log(
    'PASS licensing HTTP: one-device proof, replay rejection, revocation, isolated rate limits, retryable proxy/database errors, atomic issuance delivery. Synthetic test keys only.',
  )
} finally {
  await new Promise((resolve) => server.close(resolve))
  db.close()
  const target = resolve(directory)
  if (!target.startsWith(cache + '\\licensing-check-')) throw new Error('Unexpected cleanup path')
  rmSync(target, { recursive: true, force: true })
}
