import { createServer } from 'node:http'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { openDatabase } from '../packages/db/dist/index.js'
import { LicenseAuthority } from '../packages/engine/dist/license-authority.js'
import { createHash, timingSafeEqual } from 'node:crypto'
import {
  AuthorityDenied,
  DeviceQuotaExceeded,
  InvalidLicenseRequest,
} from '../packages/engine/dist/license-protocol.js'

/** HTTPS terminates at an operator-managed reverse proxy. The service never binds publicly. */
export function createLicenseServer(authority, options = {}) {
  let active = 0
  const peers = new Map()
  const hash = (raw) => createHash('sha256').update(raw).digest()
  const server = createServer(async (req, res) => {
    const reply = (status, value) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      res.end(JSON.stringify(value))
    }
    if (
      req.url !== '/v1/license' ||
      req.method !== 'POST' ||
      !/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')
    ) {
      reply(404, { error: 'Unavailable' })
      req.resume()
      return
    }
    let peer = req.socket.remoteAddress ?? 'unknown'
    if (options.proxyToken) {
      const token = req.headers['x-xzare-proxy-token'],
        ip = req.headers['x-xzare-client-ip']
      if (
        typeof token !== 'string' ||
        !timingSafeEqual(hash(token), hash(options.proxyToken)) ||
        typeof ip !== 'string' ||
        ip.length > 64
      ) {
        reply(503, { error: 'Unavailable' })
        req.resume()
        return
      }
      peer = ip
    }
    const now = Date.now()
    for (const [key, bucket] of peers)
      if (bucket.active === 0 && now - bucket.start > 60000) peers.delete(key)
    const bucket = peers.get(peer) ?? { start: now, attempts: 0, active: 0 }
    if (!peers.has(peer) && peers.size >= 10000) {
      reply(429, { error: 'Retry later' })
      req.resume()
      return
    }
    peers.set(peer, bucket)
    if (++bucket.attempts > 60 || bucket.active >= 4 || active >= 16) {
      reply(429, { error: 'Retry later' })
      req.resume()
      return
    }
    bucket.active++
    active++
    const timeout = setTimeout(() => req.destroy(), 10000)
    try {
      const chunks = []
      let size = 0
      for await (const chunk of req) {
        size += chunk.length
        if (size > 8192) {
          reply(413, { error: 'Too large' })
          req.destroy()
          return
        }
        chunks.push(chunk)
      }
      const input = JSON.parse(Buffer.concat(chunks).toString())
      reply(200, authority.handle(input))
    } catch (error) {
      if (error instanceof DeviceQuotaExceeded && !res.headersSent && !res.destroyed) {
        reply(409, { error: error.message, devices: error.devices })
        return
      }
      if (!res.headersSent && !res.destroyed)
        reply(
          error instanceof AuthorityDenied
            ? 403
            : error instanceof InvalidLicenseRequest ||
                error instanceof SyntaxError
              ? 400
              : 503,
          { error: 'License verification unavailable' },
        )
    } finally {
      clearTimeout(timeout)
      active--
      bucket.active--
    }
  })
  server.requestTimeout = 10000
  server.headersTimeout = 5000
  server.keepAliveTimeout = 5000
  server.maxConnections = 100
  return server
}
async function main() {
  const [mode, configPath, ...args] = process.argv.slice(2)
    if (!['serve', 'issue', 'revoke', 'devices', 'deactivate', 'offline'].includes(mode) || !configPath)
    throw new Error(
      'Usage: node tools/license-server.mjs serve|issue|revoke config.json [customer output.json expiresISO|perpetual xzare-pos|xzare-restaurant|xzare-accounting|xzare-inventory|xzare-manufacturing|xzare-workshop|xzare-service-center | licenseId]',
    )
  const config = JSON.parse(readFileSync(resolve(configPath), 'utf8'))
  if (
    typeof config.database !== 'string' ||
    typeof config.privateKey !== 'string'
  )
    throw new Error('Database and privateKey paths are required')
  mkdirSync(dirname(resolve(config.database)), { recursive: true })
  const db = openDatabase(resolve(config.database)),
    authority = new LicenseAuthority(
      db,
      readFileSync(resolve(config.privateKey), 'utf8'),
    )
  if (mode === 'issue') {
    if (!args[0] || !args[1])
      throw new Error('Customer and private output file are required')
    const expiresAt =
      args[2] && args[2] !== 'perpetual' ? Date.parse(args[2]) : null
    // No code on stdout/logs; output is delivered privately by the operator.
    db.transaction(() => {
      const product = args[3] ?? 'xzare-pos'
      if (
        ![
          'xzare-pos',
          'xzare-restaurant',
          'xzare-accounting',
          'xzare-inventory',
          'xzare-manufacturing',
          'xzare-workshop',
          'xzare-service-center',
          'xzare-clinic',
          'xzare-laboratory',
          'xzare-pharmacy',
          'xzare-hr',
          'xzare-crm',
          'xzare-education',
          'xzare-gym',
          'xzare-salon',
          'xzare-hotel',
          'xzare-real-estate',
        ].includes(product)
      )
        throw new Error('Unsupported product')
      const purchase = authority.issue(args[0], expiresAt, product, args[4] ? { customerId: args[4], maxDevices: Number(args[5] ?? 1) } : undefined)
      writeFileSync(resolve(args[1]), JSON.stringify(purchase, null, 2), {
        flag: 'wx',
        mode: 0o600,
        flush: true,
      })
    })()
    console.log('Purchase created; keep the output file private.')
    db.close()
  } else if (mode === 'revoke') {
    if (!args[0]) throw new Error('License ID required')
    authority.revoke(args[0])
    db.close()
    console.log('License revoked; offline leases expire within seven days.')
  } else if (mode === 'devices') {
    if (!args[0]) throw new Error('License ID required')
    console.log(JSON.stringify(authority.listDevices(args[0]), null, 2)); db.close()
  } else if (mode === 'deactivate') {
    if (!args[0] || !args[1]) throw new Error('License ID and device ID required')
    authority.deactivateDevice(args[0], args[1]); db.close()
    console.log('Device deactivated; outstanding offline leases expire within seven days.')
  } else if (mode === 'offline') {
    if (!args[0] || !args[1]) throw new Error('Challenge and private response paths required')
    const challenge = readFileSync(resolve(args[0]), 'utf8')
    if (Buffer.byteLength(challenge) > 8192) throw new Error('Challenge too large')
    db.transaction(() => {
      const response = authority.handle(JSON.parse(challenge), { offline: true })
      writeFileSync(resolve(args[1]), JSON.stringify(response), { flag: 'wx', mode: 0o600, flush: true })
    })()
    db.close(); console.log('Private offline response created.')
  } else {
    const port = config.port ?? 5291
    if (!Number.isInteger(port) || port < 1024 || port > 65535)
      throw new Error('Invalid port')
    if (
      typeof config.proxyToken !== 'string' ||
      !/^[a-f0-9]{64}$/.test(config.proxyToken)
    )
      throw new Error('A private reverse proxy token is required')
    const server = createLicenseServer(authority, {
      proxyToken: config.proxyToken,
    })
    server.listen(port, '127.0.0.1', () =>
      console.log(
        `Licensing backend listening on loopback port ${port}; configure HTTPS reverse proxy before customer use.`,
      ),
    )
    for (const signal of ['SIGINT', 'SIGTERM'])
      process.on(signal, () =>
        server.close(() => {
          db.close()
          process.exit(0)
        }),
      )
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch(() => {
    console.error(
      'Licensing command failed. Check configuration, permissions and arguments. No secret data was logged.',
    )
    process.exitCode = 1
  })
