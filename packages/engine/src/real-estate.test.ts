import { clinicToday } from './clinic-time.js'
import { beforeEach, afterEach, it, expect } from 'vitest'
import { openDatabase, applicationId } from '@xzare/db'
import { BusinessEngine } from './service.js'
import { actionsFor } from './runtime.js'
import { ulid } from '@xzare/core'
let db: any, e: BusinessEngine, owner: string, desk: string
const password = 'Estate-QA-Only-Strong-42!'
const rpc = async (a: string, p: any = {}, t = owner) => e.call('re.' + a, p, t) as Promise<any>
const cmd = async (a: string, p: any, t = owner) => rpc(a, { clientTxnId: ulid(), ...p }, t)
const state = () => rpc('state')
beforeEach(async () => {
  db = openDatabase(':memory:', 'real-estate' as any)
  e = new BusinessEngine(db, 'real-estate' as any)
  owner = (
    (await e.call('setup', {
      businessName: 'QA Agency',
      name: 'QA Owner',
      username: 'ownerqa',
      password,
    })) as any
  ).token
  await e.call(
    'user.save',
    { username: 'deskqa', name: 'QA Agent', role: 'cashier', password },
    owner,
  )
  desk = ((await e.call('login', { username: 'deskqa', password })) as any).token
})
afterEach(() => db?.close())
it('exposes a separate brokerage boundary and initially empty real business records', async () => {
  expect(actionsFor('real-estate' as any).has('re.deal.add')).toBe(true)
  expect(applicationId('real-estate' as any)).not.toBe(applicationId('hotel'))
  expect(await state()).toMatchObject({
    units: [],
    contacts: [],
    deals: [],
    contracts: [],
    entries: [],
  })
  await expect(e.call('invoice.post', {}, owner)).rejects.toThrow()
  await expect(rpc('state', {}, null as any)).rejects.toThrow()
})

const contact = (kind = 'client', p: any = {}) =>
  cmd('contact.save', {
    kind,
    code: kind + '-' + ulid().slice(-6),
    name: 'QA ' + kind,
    phone: 'QA phone',
    document: 'PRIVATE DOCUMENT',
    note: 'QA note',
    active: true,
    reason: p.id ? 'QA update' : '',
    ...p,
  })
const unit = async (ownerId: string, p: any = {}) =>
  cmd('unit.save', {
    code: 'U-' + ulid().slice(-6),
    name: 'QA Unit',
    ownerId,
    ownerVersion: (await state()).contacts.find((x: any) => x.id === ownerId).version,
    category: 'apartment',
    location: 'QA location',
    area: 100,
    rooms: 3,
    offer: 'both',
    salePrice: 10000001,
    rentPrice: 100001,
    active: true,
    ...p,
  })
async function fixture() {
  const o = await contact('owner'),
    c = await contact(),
    b = await contact('broker'),
    u = await unit(o.id)
  return { o, c, b, u }
}
async function deal(f: any, p: any = {}) {
  const s = await state()
  return cmd('deal.add', {
    unitId: f.u.id,
    unitVersion: s.units.find((x: any) => x.id === f.u.id).version,
    clientId: f.c.id,
    clientVersion: s.contacts.find((x: any) => x.id === f.c.id).version,
    brokerId: f.b.id,
    brokerVersion: s.contacts.find((x: any) => x.id === f.b.id).version,
    kind: 'sale',
    price: 10000001,
    depositLimit: 100001,
    commission: 20001,
    brokerShare: 5001,
    leaseStart: '',
    leaseEnd: '',
    note: 'QA deal',
    ...p,
  })
}
const detail = (id: string) => rpc('deal.get', { id })
async function act(a: string, id: string, p: any = {}, t = owner) {
  return cmd(a, { id, version: (await detail(id)).deal.version, ...p }, t)
}
async function post(
  id: string,
  channel = 'deposit',
  kind = 'receipt',
  amount = 100001,
  p: any = {},
  t = owner,
) {
  return act(
    'entry.post',
    id,
    { channel, kind, amount, method: 'cash', reference: 'QA receipt', reason: 'QA movement', ...p },
    t,
  )
}
const sign = (id: string) =>
  act('contract.record', id, {
    reference: 'QA signed reference',
    signedDay: clinicToday(),
    terms: 'QA agreed terms',
  })
it('locks a unit against simultaneous open deals and releases only through a reasoned cancellation', async () => {
  const f = await fixture(),
    d = await deal(f)
  await expect(deal(f)).rejects.toThrow()
  await act('deal.cancel', d.id, { reason: 'QA cancellation' })
  const d2 = await deal(f)
  expect(d2.id).not.toBe(d.id)
  expect((await state()).deals).toHaveLength(2)
})
it('records immutable unit and party snapshots, rental dates and exact minor units', async () => {
  const f = await fixture(),
    d = await deal(f, {
      kind: 'lease',
      price: 100001,
      leaseStart: '2026-11-01',
      leaseEnd: '2027-11-01',
    })
  await contact('client', { id: f.c.id, version: 0, code: 'renamed', name: 'Renamed' })
  await sign(d.id)
  const x = await detail(d.id)
  expect(x.deal.client.name).toBe('QA client')
  expect(x.contract.snapshot.price).toBe(100001)
  expect(x.contract.snapshot.leaseEnd).toBe('2027-11-01')
  expect(x.contract.snapshot.client.name).toBe('QA client')
})
it('validates money, strict input, party kinds, versions, availability and lease boundaries', async () => {
  const f = await fixture()
  for (const p of [
    { price: 1.1 },
    { brokerShare: 99999 },
    { clientVersion: 99 },
    { unitVersion: 99 },
    { clientId: f.o.id },
    { kind: 'lease', leaseStart: '2026-02-30', leaseEnd: '2027-01-01' },
    { kind: 'lease', leaseStart: '2027-01-01', leaseEnd: '2026-01-01' },
    { price: 1e12 + 1 },
    { extra: 'forged' },
  ])
    await expect(deal(f, p)).rejects.toThrow()
  expect((await state()).deals).toEqual([])
})
it('separates escrow from earned fees and completes only after a signed contract and settlement', async () => {
  const f = await fixture(),
    d = await deal(f)
  await expect(act('deal.complete', d.id, { reason: 'QA done' })).rejects.toThrow()
  await post(d.id)
  await sign(d.id)
  await expect(act('deal.complete', d.id, { reason: 'QA done' })).rejects.toThrow()
  await post(d.id, 'deposit', 'handover', 100001)
  await act('deal.complete', d.id, { reason: 'QA completed' })
  const x = await detail(d.id)
  expect(x.deal.depositHeld).toBe(0)
  expect(x.deal.feeCollected).toBe(0)
  expect(x.deal.earned).toBe(20001)
  expect(x.deal.brokerDue).toBe(5001)
  expect((await state()).units[0].availability).toBe('sold')
  expect(
    x.entries.reduce((n: number, l: any) => n + (l.channel === 'deposit' ? l.amount : 0), 0),
  ).toBe(0)
})
it('bounds receipts, refunds and payout, requiring earned and fully collected agency fees', async () => {
  const f = await fixture(),
    d = await deal(f)
  await expect(post(d.id, 'fee', 'receipt', 20001)).rejects.toThrow()
  await expect(post(d.id, 'deposit', 'receipt', 100002)).rejects.toThrow()
  await expect(post(d.id, 'deposit', 'refund', 1)).rejects.toThrow()
  await sign(d.id)
  await act('deal.complete', d.id, { reason: 'QA done' })
  await expect(post(d.id, 'broker', 'payout', 1)).rejects.toThrow()
  await post(d.id, 'fee', 'receipt', 20001)
  await expect(post(d.id, 'broker', 'payout', 5002)).rejects.toThrow()
  await post(d.id, 'broker', 'payout', 5001)
  expect((await detail(d.id)).deal.brokerDue).toBe(0)
  await expect(post(d.id, 'fee', 'refund', 1)).rejects.toThrow()
  await expect(post(d.id, 'deposit', 'receipt', 1)).rejects.toThrow()
})
it('retains original entries with single bounded inverse and reasoned corrections', async () => {
  const f = await fixture(),
    d = await deal(f),
    a = await post(d.id)
  await act('entry.void', d.id, { entryId: a.id, reason: 'QA wrong receipt' })
  expect((await detail(d.id)).deal.depositHeld).toBe(0)
  await expect(act('entry.void', d.id, { entryId: a.id, reason: 'again' })).rejects.toThrow()
  const b = await post(d.id)
  await post(d.id, 'deposit', 'refund', 100001)
  await expect(
    act('entry.void', d.id, { entryId: b.id, reason: 'would go negative' }),
  ).rejects.toThrow()
  expect((await detail(d.id)).entries).toHaveLength(4)
})
it('requires refunded escrow before cancellation and preserves the signed contract cancellation', async () => {
  const f = await fixture(),
    d = await deal(f)
  await sign(d.id)
  await post(d.id)
  await expect(act('deal.cancel', d.id, { reason: 'QA cancelled' })).rejects.toThrow()
  await post(d.id, 'deposit', 'refund', 100001)
  await act('deal.cancel', d.id, { reason: 'QA cancelled' })
  const x = await detail(d.id)
  expect(x.contract.reference).toBe('QA signed reference')
  expect(x.contract.cancelReason).toBe('QA cancelled')
  expect(x.deal.status).toBe('cancelled')
  await expect(post(d.id)).rejects.toThrow()
})
it('enforces management in the engine and excludes confidential documents, audit and contracts from reception', async () => {
  const f = await fixture(),
    d = await deal(f)
  await sign(d.id)
  await expect(sign(d.id)).rejects.toThrow()
  await expect(act('deal.complete', d.id, { reason: 'forged' }, desk)).rejects.toThrow()
  await expect(rpc('report', { from: '2026-01-01', to: '2026-12-31' }, desk)).rejects.toThrow()
  const s = await rpc('state', {}, desk)
  expect(s.audit).toEqual([])
  expect(s.users).toEqual([])
  expect(s.contracts).toEqual([])
  expect(JSON.stringify(s)).not.toContain('PRIVATE DOCUMENT')
  expect((await rpc('deal.get', { id: d.id }, desk)).contract).toBeNull()
  await expect(contact('broker', { document: 'changed' })).resolves.toBeTruthy()
  await expect(
    cmd(
      'contact.save',
      {
        kind: 'client',
        code: 'desk',
        name: 'QA',
        phone: '',
        document: 'forged',
        note: '',
        active: true,
      },
      desk,
    ),
  ).rejects.toThrow()
})
it('binds retries to actor, action and payload without caching private records', async () => {
  const p = {
    clientTxnId: ulid(),
    kind: 'client',
    code: 'repeat',
    name: 'QA',
    phone: '',
    document: 'PRIVATE DOCUMENT',
    note: '',
    active: true,
  }
  const a = await rpc('contact.save', p)
  expect(await rpc('contact.save', p)).toEqual(a)
  await expect(rpc('contact.save', { ...p, name: 'changed' })).rejects.toThrow()
  await expect(rpc('contact.save', p, desk)).rejects.toThrow()
  expect(JSON.stringify(db.prepare('SELECT result FROM estate_commands').all())).not.toContain(
    'PRIVATE',
  )
})
it('protects contract and money history against update, delete and replace', async () => {
  const f = await fixture(),
    d = await deal(f)
  await sign(d.id)
  await post(d.id)
  for (const table of ['estate_contracts', 'estate_entries', 'estate_events', 'estate_commands']) {
    const r = db.prepare('SELECT id FROM ' + table + ' LIMIT 1').get()
    expect(() => db.prepare('UPDATE ' + table + ' SET id=id WHERE id=?').run(r.id)).toThrow()
    expect(() => db.prepare('DELETE FROM ' + table + ' WHERE id=?').run(r.id)).toThrow()
    expect(() =>
      db
        .prepare('INSERT OR REPLACE INTO ' + table + ' SELECT * FROM ' + table + ' WHERE id=?')
        .run(r.id),
    ).toThrow()
  }
})
it('relisting completed units needs management and preserves old sale snapshots', async () => {
  const f = await fixture(),
    d = await deal(f)
  await sign(d.id)
  await act('deal.complete', d.id, { reason: 'QA done' })
  await expect(deal(f)).rejects.toThrow()
  const u = (await state()).units[0]
  await cmd('unit.relist', { id: u.id, version: u.version, reason: 'QA new mandate' })
  await deal(f)
  expect((await detail(d.id)).contract.snapshot.unit.code).toBe(u.code)
  expect((await state()).deals).toHaveLength(2)
})
it('reports posting dates and distinguishes property value, escrow, fees and broker obligations', async () => {
  const f = await fixture(),
    d = await deal(f)
  await sign(d.id)
  await post(d.id)
  let day = clinicToday()
  let r = await rpc('report', { from: day, to: day })
  expect(r.depositHeld).toBe(100001)
  expect(r.earned).toBe(0)
  expect(r.feeCollected).toBe(0)
  await post(d.id, 'deposit', 'handover', 100001)
  await act('deal.complete', d.id, { reason: 'QA done' })
  await post(d.id, 'fee', 'receipt', 20001)
  r = await rpc('report', { from: day, to: day })
  expect(r.earned).toBe(20001)
  expect(r.feeCollected).toBe(20001)
  expect(r.brokerDue).toBe(5001)
  expect(r.completedValue).toBe(10000001)
  expect(r.agencyNetEarned).toBe(15000)
})

it('handover does not reset the agreed client deposit limit or permit cancellation with owner-held client funds',async()=>{const f=await fixture(),d=await deal(f);await sign(d.id);await post(d.id);await post(d.id,'deposit','handover',100001);await expect(post(d.id,'deposit','receipt',1)).rejects.toThrow();await expect(act('deal.cancel',d.id,{reason:'client funds already handed to owner'})).rejects.toThrow();const x=await detail(d.id);expect(x.deal.depositReceived).toBe(100001);expect(x.deal.depositHeld).toBe(0)})

it('allows reasoned recovery of an owner handover and refund before cancelling a signed deal',async()=>{const f=await fixture(),d=await deal(f);await sign(d.id);await post(d.id);const h=await post(d.id,'deposit','handover',100001);await act('entry.void',d.id,{entryId:h.id,reason:'QA owner returned the original handover'});await post(d.id,'deposit','refund',100001);await act('deal.cancel',d.id,{reason:'QA refunded cancellation'});const x=await detail(d.id);expect(x.deal.depositReceived).toBe(0);expect(x.deal.depositHeld).toBe(0);expect(x.contract.cancelReason).toBe('QA refunded cancellation');expect(x.entries).toHaveLength(4)})
