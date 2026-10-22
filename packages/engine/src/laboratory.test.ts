import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { openDatabase, type XzareDatabase } from '@xzare/db'
import { BusinessEngine } from './service.js'
import { ulid } from '@xzare/core'
let db: XzareDatabase, e: BusinessEngine, t: string, patient: string, testId: string
const pass = 'Laboratory-QA-password-123!'
const rpc = (a: string, p: unknown = {}, token = t): Promise<any> =>
  e.call('laboratory.' + a, p, token)
const cmd = (a: string, p: Record<string, unknown> = {}, token = t) =>
  rpc(a, { clientTxnId: ulid(), ...p }, token)
const catalog = (extra: Record<string, unknown> = {}) =>
  cmd('test.save', {
    code: 'QA1',
    name: 'Entered QA test',
    specimen: 'QA specimen',
    kind: 'number',
    unit: 'QA-unit',
    reference: 'Entered QA range',
    min: 10,
    max: 20,
    price: 20000,
    active: true,
    ...extra,
  })
const order = (extra: Record<string, unknown> = {}) =>
  cmd('order.create', {
    patientId: patient,
    testIds: [testId],
    referrer: 'QA referrer',
    dueAt: Date.now() + 86400000,
    discount: 0,
    taxBps: 0,
    ...extra,
  })
const get = (id: string, token = t) => rpc('order.get', { id }, token)
const receive = async (id: string, token = t) => {
  let d = await get(id, token)
  for (const s of d.samples.filter((x: any) => !x.replacedBy)) {
    await cmd(
      'sample.status',
      { id: s.id, version: s.version, status: 'collected', note: 'QA collection' },
      token,
    )
    await cmd(
      'sample.status',
      { id: s.id, version: s.version + 1, status: 'received', note: 'QA receipt' },
      token,
    )
  }
}
const saveResults = async (id: string, value = '15', token = t) => {
  const d = await get(id, token)
  return cmd(
    'result.save',
    {
      id,
      version: d.order.version,
      values: d.tests.map((x: any) => ({ id: x.id, value, note: 'Private QA note' })),
    },
    token,
  )
}
const user = async (role: string, username: string) => {
  const u: any = await e.call(
    'user.save',
    { name: username, username, role, password: pass, active: true },
    t,
  )
  const s: any = await e.call('login', { username, password: pass })
  return { id: u.id, token: s.token }
}
beforeEach(async () => {
  vi.setSystemTime(new Date(2030, 0, 1, 10))
  db = openDatabase(':memory:', 'laboratory' as any)
  e = new BusinessEngine(db, 'laboratory' as any)
  t = (
    (await e.call('setup', {
      businessName: 'QA lab',
      name: 'QA owner',
      username: 'owner',
      password: pass,
    })) as any
  ).token
  patient = (
    await cmd('patient.save', {
      name: 'QA patient',
      phone: '',
      birthDate: '2000-01-01',
      sex: 'unknown',
      address: '',
      active: true,
    })
  ).id
  testId = (await catalog()).id
})
afterEach(() => {
  db?.close()
  vi.useRealTimers()
})
it('starts without fake orders or samples and generates stable patient codes', async () => {
  const s = await rpc('state')
  expect(s.orders).toEqual([])
  expect(s.samples).toEqual([])
  expect(s.patients[0].number).toBe('LP-000001')
  expect(s.settings.license).toBeUndefined()
  expect(s.reconciled).toBe(true)
})
it('requires unique test code, valid range and actual ordered active tests', async () => {
  await expect(catalog()).rejects.toThrow()
  await expect(catalog({ code: 'QA2', min: 30, max: 20 })).rejects.toThrow()
  await expect(order({ testIds: [testId, testId] })).rejects.toThrow()
  await expect(order({ testIds: [] })).rejects.toThrow()
  await expect(
    cmd('patient.save', {
      name: 'Invalid',
      phone: '',
      birthDate: '2000-02-30',
      sex: 'unknown',
      address: '',
      active: true,
    }),
  ).rejects.toThrow()
})
it('freezes catalog, references, patient and fees and groups samples by specimen', async () => {
  const second = (await catalog({ code: 'QA2', name: 'QA second' })).id
  const a = await order({ testIds: [testId, second], discount: 2000, taxBps: 1400 })
  await catalog({
    id: testId,
    version: 0,
    code: 'QA1',
    name: 'Changed QA',
    reference: 'Changed reference',
    price: 1,
  })
  await cmd('patient.save', {
    id: patient,
    version: 0,
    name: 'Changed patient',
    phone: '',
    birthDate: null,
    sex: 'female',
    address: '',
    active: true,
  })
  const d = await get(a.id)
  expect(d.order.patient.name).toBe('QA patient')
  expect(d.order.total).toBe(43320)
  expect(d.tests[0].definition.reference).toBe('Entered QA range')
  expect(d.tests.some((x: any) => x.definition.name === 'Changed QA')).toBe(false)
  expect(d.samples).toHaveLength(1)
  expect(d.samples[0].number).toBe('LS-000001')
})
it('enforces specimen transitions, unique recollection and preserves rejected samples', async () => {
  const a = await order()
  let d = await get(a.id)
  const s = d.samples[0]
  await expect(
    cmd('sample.status', { id: s.id, version: 0, status: 'received', note: 'QA' }),
  ).rejects.toThrow()
  await cmd('sample.status', { id: s.id, version: 0, status: 'collected', note: 'QA' })
  await cmd('sample.status', { id: s.id, version: 1, status: 'rejected', note: 'QA rejection' })
  await expect(saveResults(a.id)).rejects.toThrow(/عينة/)
  await cmd('sample.replace', { id: s.id, version: 2, note: 'QA recollection' })
  await expect(
    cmd('sample.replace', { id: s.id, version: 2, note: 'QA duplicate' }),
  ).rejects.toThrow()
  d = await get(a.id)
  expect(d.samples).toHaveLength(2)
  expect(d.samples[0].replacedBy || d.samples[1].replacedBy).toBeTruthy()
  expect(d.samples.map((x: any) => x.number).sort()).toEqual(['LS-000001', 'LS-000002'])
  await receive(a.id)
  await saveResults(a.id)
  expect((await get(a.id)).tests[0].value).toBe('15')
})
it('requires received samples and validates numeric drafts and stale versions', async () => {
  const a = await order()
  await expect(saveResults(a.id)).rejects.toThrow(/عينة/)
  await receive(a.id)
  await expect(saveResults(a.id, 'not a number')).rejects.toThrow()
  const d = await get(a.id)
  await saveResults(a.id)
  await expect(
    cmd('result.save', {
      id: a.id,
      version: d.order.version,
      values: d.tests.map((x: any) => ({ id: x.id, value: '16', note: '' })),
    }),
  ).rejects.toThrow(/تغير/)
  await saveResults(a.id, '<5')
  expect((await get(a.id)).tests[0].value).toBe('<5')
})
it('denies reception results and technical financial routes while auditing private reads', async () => {
  const a = await order()
  await receive(a.id)
  const tech = await user('technician', 'techqa')
  await saveResults(a.id, '15', tech.token)
  const reception = await user('cashier', 'receptionqa')
  const d = await get(a.id, reception.token)
  expect(JSON.stringify(d)).not.toContain('Private QA')
  expect(d.tests[0].value).toBeUndefined()
  expect(d.reports).toEqual([])
  await expect(saveResults(a.id, '15', reception.token)).rejects.toThrow(/صلاحية/)
  await expect(
    cmd('order.pay', { id: a.id, amount: 1, method: 'cash', reference: 'QA' }, tech.token),
  ).rejects.toThrow(/صلاحية/)
  await get(a.id, tech.token)
  expect(
    db.prepare("SELECT count(*) n FROM audit_log WHERE action='laboratory.result.read'").get(),
  ).toMatchObject({ n: expect.any(Number) })
})
it('requires a second reviewer and freezes approved reports against replacement', async () => {
  const a = await order()
  await receive(a.id)
  await saveResults(a.id)
  let d = await get(a.id)
  await expect(cmd('result.approve', { id: a.id, version: d.order.version })).rejects.toThrow(
    /مستخدم آخر/,
  )
  const reviewer = await user('manager', 'reviewqa')
  await cmd('result.approve', { id: a.id, version: d.order.version }, reviewer.token)
  d = await get(a.id)
  expect(d.order.status).toBe('released')
  expect(d.reports[0].revision).toBe(1)
  expect(d.reports[0].snapshot.tests[0].value).toBe('15')
  await expect(saveResults(a.id, '17')).rejects.toThrow()
  expect(() => db.prepare('UPDATE lab_reports SET snapshot=?').run('{}')).toThrow()
  expect(() =>
    db.prepare('INSERT OR REPLACE INTO lab_reports SELECT * FROM lab_reports').run(),
  ).toThrow()
})
it('creates independent immutable correction revisions without losing original report', async () => {
  const a = await order()
  await receive(a.id)
  const tech = await user('technician', 'techqa')
  await saveResults(a.id, '15', tech.token)
  let d = await get(a.id)
  await cmd('result.approve', { id: a.id, version: d.order.version })
  d = await get(a.id)
  await cmd('result.reopen', { id: a.id, version: d.order.version, reason: 'QA correction' })
  d = await get(a.id)
  await expect(cmd('result.approve', { id: a.id, version: d.order.version })).rejects.toThrow()
  await saveResults(a.id, '25', tech.token)
  d = await get(a.id)
  await cmd('result.approve', { id: a.id, version: d.order.version })
  d = await get(a.id)
  expect(d.reports.map((x: any) => x.revision)).toEqual([2, 1])
  expect(d.reports[1].snapshot.tests[0].value).toBe('15')
  expect(d.reports[0].snapshot.tests[0].value).toBe('25')
  expect(d.reports[0].snapshot.tests[0].flag).toBe('high')
  expect(d.reports[0].reason).toBe('QA correction')
})
it('blocks rejection or cancellation after release and requires reason for reopening', async () => {
  const a = await order()
  await receive(a.id)
  const tech = await user('technician', 'techqa')
  await saveResults(a.id, '15', tech.token)
  let d = await get(a.id)
  await cmd('result.approve', { id: a.id, version: d.order.version })
  d = await get(a.id)
  await expect(
    cmd('sample.status', {
      id: d.samples[0].id,
      version: d.samples[0].version,
      status: 'rejected',
      note: 'QA',
    }),
  ).rejects.toThrow()
  await expect(
    cmd('order.cancel', {
      id: a.id,
      version: d.order.version,
      note: 'QA cancel',
      method: 'cash',
      reference: 'QA refund',
    }),
  ).rejects.toThrow()
  await expect(
    cmd('result.reopen', { id: a.id, version: d.order.version, reason: '' }),
  ).rejects.toThrow()
})
it('posts exact money, partial payments and immutable cancellation refund', async () => {
  const a = await order({ discount: 2000, taxBps: 1400 })
  expect((await get(a.id)).order.total).toBe(20520)
  await cmd('order.pay', { id: a.id, amount: 10000, method: 'cash', reference: 'QA payment' })
  await expect(
    cmd('order.pay', { id: a.id, amount: 10521, method: 'cash', reference: 'QA overpay' }),
  ).rejects.toThrow()
  await cmd('order.pay', { id: a.id, amount: 10520, method: 'bank', reference: 'QA remainder' })
  let d = await get(a.id)
  await cmd('order.cancel', {
    id: a.id,
    version: d.order.version,
    note: 'QA cancellation',
    method: 'cash',
    reference: 'QA refund',
  })
  d = await get(a.id)
  expect(d.order.balance).toBe(0)
  expect(d.refund.amount).toBe(20520)
  expect(() => db.prepare('DELETE FROM lab_payments').run()).toThrow()
  const r = await rpc('report', { from: '2030-01-01', to: '2030-01-01' })
  expect(r.revenue).toBe(0)
  expect(r.collected).toBe(20520)
  expect(r.refunded).toBe(20520)
  expect(r.reconciled).toBe(true)
})
it('binds idempotency to payload and actor and returns ids without result content', async () => {
  const p = {
    clientTxnId: ulid(),
    patientId: patient,
    testIds: [testId],
    referrer: 'QA',
    dueAt: Date.now() + 3600000,
    discount: 0,
    taxBps: 0,
  }
  const a = await rpc('order.create', p)
  expect(await rpc('order.create', p)).toEqual(a)
  await expect(rpc('order.create', { ...p, discount: 1 })).rejects.toThrow()
  const r = await user('cashier', 'receptionqa')
  await expect(rpc('order.create', p, r.token)).rejects.toThrow()
  expect((await rpc('state')).orders).toHaveLength(1)
  expect(Object.keys(a)).toEqual(['id'])
})
it('denies legacy product routes and scopes technician accounts to laboratories', async () => {
  for (const a of ['clinic.state', 'state', 'invoice.post', 'stock.adjust', 'service-center.state'])
    await expect(e.call(a, {}, t)).rejects.toThrow()
  const cashier = await user('cashier', 'cashierqa')
  await expect(
    catalog({ code: 'QA2', clientTxnId: ulid(), ...{} }).then(async () =>
      cmd(
        'test.save',
        {
          code: 'QA3',
          name: 'QA',
          specimen: 'QA',
          kind: 'text',
          unit: '',
          reference: '',
          min: null,
          max: null,
          price: 1,
          active: true,
        },
        cashier.token,
      ),
    ),
  ).rejects.toThrow(/صلاحية/)
  const other = openDatabase(':memory:', 'clinic')
  try {
    const b = new BusinessEngine(other, 'clinic')
    const s: any = await b.call('setup', {
      businessName: 'QA',
      name: 'QA',
      username: 'owner',
      password: pass,
    })
    await expect(
      b.call(
        'user.save',
        { name: 'QA', username: 'techqa', role: 'technician', password: pass, active: true },
        s.token,
      ),
    ).rejects.toThrow()
  } finally {
    other.close()
  }
})
it('uses local calendar day boundaries and reconciles total outstanding amounts', async () => {
  vi.setSystemTime(new Date(2030, 0, 1, 0, 30))
  t = ((await e.call('login', { username: 'owner', password: pass })) as any).token
  const a = await order()
  await cmd('order.pay', { id: a.id, amount: 5000, method: 'card', reference: 'QA midnight' })
  const r = await rpc('report', { from: '2030-01-01', to: '2030-01-01' })
  expect(r.revenue).toBe(20000)
  expect(r.receivable).toBe(15000)
  expect((await rpc('report', { from: '2029-12-31', to: '2029-12-31' })).orders).toEqual([])
})
it('clears drafts when a received specimen is rejected and prevents stale approvals', async () => {
  const a = await order()
  await receive(a.id)
  const tech = await user('technician', 'techqa')
  await saveResults(a.id, '15', tech.token)
  const d = await get(a.id)
  const s = d.samples[0]
  await cmd('sample.status', {
    id: s.id,
    version: s.version,
    status: 'rejected',
    note: 'QA rejection',
  })
  await expect(cmd('result.approve', { id: a.id, version: d.order.version })).rejects.toThrow()
  expect((await get(a.id)).tests[0].value).toBe('')
})

it('redacts historical report fee snapshots for technical accounts', async () => {
  const a = await order()
  await receive(a.id)
  const tech = await user('technician', 'techqa')
  await saveResults(a.id, '15', tech.token)
  const d = await get(a.id)
  await cmd('result.approve', { id: a.id, version: d.order.version })
  const technical = await get(a.id, tech.token)
  expect(technical.reports[0].snapshot.tests[0].price).toBe(0)
  expect(technical.reports[0].snapshot.tests[0].definition.price).toBe(0)
  expect(technical.reports[0].snapshot.tests[0].value).toBe('15')
})

it('hides private correction reasons across all receptionist reads', async () => {
  const a = await order()
  await receive(a.id)
  const tech = await user('technician', 'techqa')
  await saveResults(a.id, '15', tech.token)
  let d = await get(a.id)
  await cmd('result.approve', { id: a.id, version: d.order.version })
  d = await get(a.id)
  await cmd('result.reopen', {
    id: a.id,
    version: d.order.version,
    reason: 'Private correction: result 75',
  })
  const reception = await user('cashier', 'receptionqa')
  for (const data of [
    await get(a.id, reception.token),
    await rpc('state', {}, reception.token),
    await rpc('patient.get', { id: patient }, reception.token),
    await rpc('report', { from: '2030-01-01', to: '2030-01-01' }, reception.token),
  ])
    expect(JSON.stringify(data)).not.toContain('Private correction')
})
it('freezes reviewer display identity when a report is approved', async () => {
  const a = await order()
  await receive(a.id)
  const tech = await user('technician', 'techqa')
  await saveResults(a.id, '15', tech.token)
  const d = await get(a.id)
  await cmd('result.approve', { id: a.id, version: d.order.version })
  const owner = (db.prepare("SELECT id FROM users WHERE username='owner'").get() as any).id
  await e.call(
    'user.save',
    { id: owner, username: 'owner', name: 'Renamed owner', role: 'admin', active: true },
    t,
  )
  t = ((await e.call('login', { username: 'owner', password: pass })) as any).token
  expect((await get(a.id)).reports[0].reviewerName).toBe('QA owner')
})
