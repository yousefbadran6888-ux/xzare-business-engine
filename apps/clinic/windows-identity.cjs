const { createHash } = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { join } = require('node:path')
function fingerprintMachineGuid(raw) {
  const canonical = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(canonical)) throw new Error('Windows hardware identity unavailable')
  return createHash('sha256').update('xzare-machine-guid-v1\0').update(canonical).digest('hex')
}
function windowsIdentity(deviceName) {
  if (process.platform !== 'win32') throw new Error('Windows hardware identity unavailable')
  const system = 'C:\\Windows'
  const raw = execFileSync(join(system, 'System32', 'reg.exe'), ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid', '/reg:64'], {
    windowsHide: true, encoding: 'utf8', timeout: 7000, stdio: ['ignore', 'pipe', 'ignore'],
    env: { SystemRoot: system, WINDIR: system, PATH: join(system, 'System32') },
  })
  const match = /MachineGuid\s+REG_SZ\s+([a-f0-9-]+)/i.exec(raw)
  const safeName = String(deviceName).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 80) || 'جهاز العمل'
  return { fingerprint: fingerprintMachineGuid(match?.[1]), deviceName: safeName }
}
module.exports = { fingerprintMachineGuid, windowsIdentity }
