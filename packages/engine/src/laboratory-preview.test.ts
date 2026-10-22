import { it, expect } from 'vitest'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ulid } from '@xzare/core'
it('saves contract-valid Arabic result drafts larger than 64KB through the actual preview transport', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'xzare-lab-transport-'))
  const reservation = createServer()
  await new Promise<void>((r) => reservation.listen(0, '127.0.0.1', r))
  const address = reservation.address()
  if (!address || typeof address === 'string') throw Error('port')
  const port = address.port
  await new Promise<void>((r) => reservation.close(() => r()))
  const origin = 'http://127.0.0.1:' + port
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL('../../../tools/preview.mjs', import.meta.url)), 'laboratory'],
    {
      cwd: fileURLToPath(new URL('../../../', import.meta.url)),
      windowsHide: true,
      env: { ...process.env, XZARE_PORT: String(port), XZARE_DATA_DIR: dir },
    },
  )
  const exited = new Promise<void>((r) => child.once('close', () => r()))
  let log = '',
    cookie = ''
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error(log || 'startup timeout')), 10000)
      child.on('error', reject)
      child.stdout.on('data', (b) => {
        log += b
        if (log.includes('preview:')) {
          clearTimeout(timer)
          resolve()
        }
      })
      child.stderr.on('data', (b) => (log += b))
    })
    const rpc = async (action: string, payload: unknown) => {
      const r = await fetch(origin + '/api/rpc', {
        method: 'POST',
        headers: {
          Origin: origin,
          'Content-Type': 'application/json',
          'X-Xzare-Request': '1',
          'Sec-Fetch-Site': 'same-origin',
          Cookie: cookie,
        },
        body: JSON.stringify({ action, payload }),
      })
      if (r.headers.get('set-cookie')) cookie = r.headers.get('set-cookie')!.split(';')[0]!
      const body = (await r.json()) as any
      if (!body.ok) throw Error(body.error)
      return body.value
    }
    const cmd = (a: string, p: Record<string, unknown>) =>
      rpc('laboratory.' + a, { ...p, clientTxnId: ulid() })
    await rpc('setup', {
      businessName: 'Transport QA',
      name: 'QA',
      username: 'owner',
      password: 'Laboratory-transport-QA-123!',
    })
    const patient = await cmd('patient.save', {
      name: 'QA',
      phone: '',
      birthDate: null,
      sex: 'unknown',
      address: '',
      active: true,
    })
    const ids: string[] = []
    for (let i = 0; i < 17; i++)
      ids.push(
        (
          await cmd('test.save', {
            code: 'QA' + i,
            name: 'QA ' + i,
            specimen: 'QA specimen',
            kind: 'text',
            unit: '',
            reference: '',
            min: null,
            max: null,
            price: 1,
            active: true,
          })
        ).id,
      )
    const order = await cmd('order.create', {
      patientId: patient.id,
      testIds: ids,
      referrer: '',
      dueAt: Date.now() + 86400000,
      discount: 0,
      taxBps: 0,
    })
    let d = await rpc('laboratory.order.get', { id: order.id })
    const sample = d.samples[0]
    await cmd('sample.status', { id: sample.id, version: 0, status: 'collected', note: 'QA' })
    await cmd('sample.status', { id: sample.id, version: 1, status: 'received', note: 'QA' })
    d = await rpc('laboratory.order.get', { id: order.id })
    const payload = {
      id: order.id,
      version: d.order.version,
      values: d.tests.map((x: any) => ({ id: x.id, value: 'ع'.repeat(2000), note: '' })),
      clientTxnId: ulid(),
    }
    expect(
      Buffer.byteLength(JSON.stringify({ action: 'laboratory.result.save', payload })),
    ).toBeGreaterThan(65536)
    await rpc('laboratory.result.save', payload)
    d = await rpc('laboratory.order.get', { id: order.id })
    expect(d.tests[0].value).toBe('ع'.repeat(2000))
  } finally {
    child.kill()
    await exited
    if (!dir.startsWith(join(tmpdir(), 'xzare-lab-transport-'))) throw Error('unsafe cleanup')
    rmSync(dir, { recursive: true, force: true })
  }
}, 30000)
