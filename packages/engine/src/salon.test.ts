import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { openDatabase, type XzareDatabase } from '@xzare/db'
import { BusinessEngine } from './service.js'
import { ulid } from '@xzare/core'
let db: XzareDatabase,
  e: BusinessEngine,
  owner: string,
  front: string,
  stylist: string,
  other: string,
  stylistUid: string,
  cid: string,
  sid: string,
  tid: string,
  pid: string
const password = 'Salon-QA-password-123!',
  day = '2026-10-08'
const rpc = (a: string, p: unknown = {}, t = owner): Promise<any> =>
  e.call('sal.' + a, p, t)
const cmd = (a: string, p: Record<string, unknown> = {}, t = owner) =>
  rpc(a, { ...p, clientTxnId: ulid() }, t)
const state = () => rpc('state')
const customer = (p: Record<string, unknown> = {}, t = owner) =>
  cmd(
    'customer.save',
    {
      code: 'C01',
      name: 'QA Customer',
      phone: 'PRIVATE phone QA',
      note: 'PRIVATE customer note QA',
      active: true,
      ...p,
    },
    t,
  )
const service = (p: Record<string, unknown> = {}, t = owner) =>
  cmd(
    'service.save',
    {
      code: 'S01',
      name: 'QA Service',
      category: 'QA Category',
      duration: 30,
      fee: 10001,
      active: true,
      ...p,
    },
    t,
  )
const employee = (p: Record<string, unknown> = {}) =>
  cmd('staff.save', {
    code: 'E01',
    name: 'QA Stylist',
    phone: 'PRIVATE employee phone',
    note: 'PRIVATE staff note',
    userId: stylistUid,
    commissionBps: 3333,
    active: true,
    ...p,
  })
const plan = (p: Record<string, unknown> = {}) =>
  cmd('plan.save', {
    code: 'P01',
    name: 'QA Package',
    serviceId: sid,
    credits: 3,
    days: 30,
    fee: 10001,
    description: 'QA description',
    active: true,
    ...p,
  })
async function booking(p: Record<string, unknown> = {}, t = owner) {
  const s = await state(),
    c = s.customers.find((x: any) => x.id === cid),
    v = s.services.find((x: any) => x.id === sid),
    f = s.staff.find((x: any) => x.id === tid)
  return cmd(
    'booking.add',
    {
      customerId: cid,
      customerVersion: c.version,
      serviceId: sid,
      serviceVersion: v.version,
      staffId: tid,
      staffVersion: f.version,
      day,
      startMinute: 60,
      discount: 0,
      packageId: null,
      packageVersion: null,
      note: 'PRIVATE booking note',
      ...p,
    },
    t,
  )
}
async function complete(id: string, t = owner) {
  let b = (await state()).bookings.find((x: any) => x.id === id)
  await cmd('booking.arrive', { id, version: b.version })
  b = (await state()).bookings.find((x: any) => x.id === id)
  await cmd('booking.complete', { id, version: b.version }, t)
  return rpc('booking.get', { id })
}
async function sell(p: Record<string, unknown> = {}) {
  const s = await state(),
    c = s.customers.find((x: any) => x.id === cid),
    v = s.plans.find((x: any) => x.id === pid)
  const { id } = await cmd('package.sell', {
    customerId: cid,
    customerVersion: c.version,
    planId: pid,
    planVersion: v.version,
    startDay: day,
    discount: 0,
    ...p,
  })
  return (await state()).packages.find((x: any) => x.id === id)
}
async function pay(id: string, amount?: number) {
  const inv = (await state()).invoices.find((x: any) => x.id === id)
  return cmd('payment.post', {
    invoiceId: id,
    version: inv.version,
    amount: amount ?? inv.balance,
    method: 'cash',
    reference: 'QA reference',
  })
}
async function packageBooking(id: string, startMinute: number) {
  const p = (await state()).packages.find((x: any) => x.id === id)
  return booking({ packageId: id, packageVersion: p.version, startMinute })
}
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-08T12:00:00'))
  db = openDatabase(':memory:', 'salon' as any)
  e = new BusinessEngine(db, 'salon' as any)
  owner = (
    (await e.call('setup', {
      businessName: 'QA Salon',
      name: 'QA Owner',
      username: 'ownerqa',
      password,
    })) as any
  ).token
  stylistUid = (
    (await e.call(
      'user.save',
      {
        username: 'stylistqa',
        name: 'QA stylist account',
        role: 'stylist',
        password,
      },
      owner,
    )) as any
  ).id
  await e.call(
    'user.save',
    { username: 'otherqa', name: 'QA other', role: 'stylist', password },
    owner,
  )
  await e.call(
    'user.save',
    { username: 'frontqa', name: 'QA front', role: 'cashier', password },
    owner,
  )
  stylist = (
    (await e.call('login', { username: 'stylistqa', password })) as any
  ).token
  other = ((await e.call('login', { username: 'otherqa', password })) as any)
    .token
  front = ((await e.call('login', { username: 'frontqa', password })) as any)
    .token
  cid = (await customer()).id
  sid = (await service()).id
  tid = (await employee()).id
  pid = (await plan()).id
})
afterEach(() => {
  db?.close()
  vi.useRealTimers()
})
it('starts with no invented business records, its own product identity and blocked POS/Gym endpoints', async () => {
  const empty = openDatabase(':memory:', 'salon' as any)
  const core = new BusinessEngine(empty, 'salon' as any)
  const t = (
    (await core.call('setup', {
      businessName: 'Empty QA',
      name: 'QA Owner',
      username: 'emptyqa',
      password,
    })) as any
  ).token
  const s = (await core.call('sal.state', {}, t)) as any
  expect(s.customers).toEqual([])
  expect(s.bookings).toEqual([])
  expect(empty.pragma('application_id', { simple: true })).not.toBe(
    db.pragma('application_id', { simple: true }) === 0 ? 0 : 0x585a4759,
  )
  await expect(core.call('state', {}, t)).rejects.toThrow()
  await expect(core.call('gym.state', {}, t)).rejects.toThrow()
  empty.close()
  await expect(
    e.call(
      'user.save',
      { username: 'teacherqa', name: 'QA', role: 'teacher', password },
      owner,
    ),
  ).rejects.toThrow()
})
it('enforces master uniqueness, versions, manager catalog access and strict real dates', async () => {
  await expect(customer()).rejects.toThrow()
  await expect(service({ code: 'S02', fee: -1 })).rejects.toThrow()
  await expect(service({ code: 'S02' }, front)).rejects.toThrow()
  await expect(employee({ code: 'E02', userId: stylistUid })).rejects.toThrow()
  await expect(customer({ id: cid, version: 5 })).rejects.toThrow()
  await expect(booking({ day: '2026-02-30' })).rejects.toThrow()
  await expect(booking({ fee: 1 })).rejects.toThrow()
  await expect(booking({ startMinute: 1430 })).rejects.toThrow()
  await expect(booking({ day: '2026-10-07' })).rejects.toThrow()
})
it('prevents overlapping staff and customer appointments, allows adjacent time and distinct resources', async () => {
  await booking()
  await expect(booking({ startMinute: 75 })).rejects.toThrow(/تداخل/)
  const staff2 = (
    await employee({ code: 'E02', name: 'QA second', userId: null })
  ).id
  await expect(
    booking({ staffId: staff2, staffVersion: 0, startMinute: 75 }),
  ).rejects.toThrow(/تداخل/)
  const c2 = (await customer({ code: 'C02', name: 'QA second customer' })).id
  await expect(
    booking({ customerId: c2, customerVersion: 0, startMinute: 75 }),
  ).rejects.toThrow(/تداخل/)
  await booking({ startMinute: 90 })
  await booking({
    customerId: c2,
    customerVersion: 0,
    staffId: staff2,
    staffVersion: 0,
    startMinute: 60,
  })
})
it('keeps reviewed service duration price discount and commission rate snapshots through catalog changes', async () => {
  const { id } = await booking({ discount: 1 })
  const s = await state()
  await service({
    id: sid,
    version: s.services[0].version,
    name: 'Updated',
    duration: 60,
    fee: 20000,
  })
  await employee({ id: tid, version: s.staff[0].version, commissionBps: 9000 })
  const d = await complete(id)
  expect(d.booking.duration).toBe(30)
  expect(d.invoice.total).toBe(10000)
  expect(d.booking.serviceName).toBe('QA Service')
  expect(d.completion.commission).toBe(3333)
  expect(d.completion.rateBps).toBe(3333)
  await expect(booking({ discount: 1 }, front)).rejects.toThrow(/الخصم/)
  await expect(booking({ discount: 30000 })).rejects.toThrow()
})
it('moving booked appointment requires versions, prevents conflicts and preserves original service facts', async () => {
  const a = (await booking()).id
  await booking({ startMinute: 120 })
  await expect(
    cmd('booking.move', {
      id: a,
      version: 0,
      staffId: tid,
      staffVersion: 0,
      day,
      startMinute: 130,
      reason: 'QA move',
    }),
  ).rejects.toThrow(/تداخل/)
  await cmd('booking.move', {
    id: a,
    version: 0,
    staffId: tid,
    staffVersion: 0,
    day,
    startMinute: 180,
    reason: 'QA move',
  })
  await expect(
    cmd('booking.move', {
      id: a,
      version: 0,
      staffId: tid,
      staffVersion: 0,
      day,
      startMinute: 240,
      reason: 'QA move',
    }),
  ).rejects.toThrow(/تغيرت/)
  const d = await rpc('booking.get', { id: a })
  expect(d.booking.startMinute).toBe(180)
  expect(d.events.some((x: any) => x.action === 'sal.booking.move')).toBe(true)
})
it('checks arrival, completion actor/start/status and terminal no-show/cancel transitions', async () => {
  const a = (await booking({ startMinute: 780 })).id
  await cmd('booking.arrive', { id: a, version: 0 })
  await expect(
    cmd('booking.complete', { id: a, version: 1 }, stylist),
  ).rejects.toThrow(/الموعد/)
  await expect(
    cmd('booking.complete', { id: a, version: 1 }, front),
  ).rejects.toThrow()
  const b = (await booking({ startMinute: 120 })).id
  await expect(cmd('booking.complete', { id: b, version: 0 })).rejects.toThrow(
    /الحضور/,
  )
  await cmd('booking.no-show', { id: b, version: 0, reason: 'QA absent' })
  await expect(cmd('booking.arrive', { id: b, version: 1 })).rejects.toThrow()
  const c = (await booking({ startMinute: 180 })).id
  await cmd('booking.cancel', { id: c, version: 0, reason: 'QA cancel' })
  await expect(cmd('booking.arrive', { id: c, version: 1 })).rejects.toThrow()
  const f = (await booking({ day: '2026-10-09', startMinute: 0 })).id
  await expect(cmd('booking.arrive', { id: f, version: 0 })).rejects.toThrow()
  await expect(
    cmd('booking.no-show', { id: f, version: 0, reason: 'QA' }),
  ).rejects.toThrow()
})
it('assigned stylist completes once, creates immutable invoice and commission with exact rounding', async () => {
  const a = (await booking()).id
  const d = await complete(a, stylist)
  expect(d.invoice.total).toBe(10001)
  expect(d.invoice.balance).toBe(10001)
  expect(d.completion.commission).toBe(3333)
  expect(d.invoice.number).toMatch(/^SAL-I-/)
  await expect(
    cmd('booking.complete', { id: a, version: d.booking.version }, stylist),
  ).rejects.toThrow()
  expect((await state()).invoices).toHaveLength(1)
  expect((await rpc('commissions', {}, stylist)).summary[0].due).toBe(3333)
})
it('partial collections cap due, preserve receipts and void once without deleting history', async () => {
  const a = (await booking()).id,
    done = await complete(a)
  const p = await pay(done.invoice.id, 3001)
  let inv = (await state()).invoices[0]
  expect(inv.balance).toBe(7000)
  await expect(pay(inv.id, 7001)).rejects.toThrow(/المستحق/)
  await expect(
    cmd('payment.void', { id: p.id, reason: 'QA' }, front),
  ).rejects.toThrow()
  await cmd('payment.void', { id: p.id, reason: 'QA void' })
  inv = (await state()).invoices[0]
  expect(inv.balance).toBe(10001)
  expect((await state()).payments[0].voidReason).toBe('QA void')
  await expect(
    cmd('payment.void', { id: p.id, reason: 'QA twice' }),
  ).rejects.toThrow()
  await customer({ id: cid, version: 0, name: 'Renamed' })
  expect((await state()).payments[0].customer.name).toBe('QA Customer')
})
it('manager payouts cannot exceed earned commission, cashier/stylist cannot pay, void restores once', async () => {
  await complete((await booking()).id)
  await expect(
    cmd('commission.pay', {
      staffId: tid,
      amount: 3334,
      method: 'cash',
      reference: 'QA',
    }),
  ).rejects.toThrow(/العمولة/)
  await expect(
    cmd(
      'commission.pay',
      { staffId: tid, amount: 1, method: 'cash', reference: 'QA' },
      front,
    ),
  ).rejects.toThrow()
  await expect(
    cmd(
      'commission.pay',
      { staffId: tid, amount: 1, method: 'cash', reference: 'QA' },
      stylist,
    ),
  ).rejects.toThrow()
  const p = await cmd('commission.pay', {
    staffId: tid,
    amount: 3000,
    method: 'cash',
    reference: 'QA',
  })
  expect((await rpc('commissions')).summary[0].due).toBe(333)
  await cmd('commission.void', { id: p.id, reason: 'QA void payout' })
  expect((await rpc('commissions')).summary[0].due).toBe(3333)
  await expect(
    cmd('commission.void', { id: p.id, reason: 'QA' }),
  ).rejects.toThrow()
})
it('prepaid package must be paid and match customer/service/date; reservations cannot oversell credits', async () => {
  let p = await sell()
  await expect(packageBooking(p.id, 60)).rejects.toThrow(/سداد/)
  await pay(p.invoiceId)
  p = (await state()).packages[0]
  await expect(
    booking({ packageId: p.id, packageVersion: p.version, day: '2026-11-07' }),
  ).rejects.toThrow()
  const c2 = (await customer({ code: 'C02' })).id
  await expect(
    booking({
      customerId: c2,
      customerVersion: 0,
      packageId: p.id,
      packageVersion: p.version,
    }),
  ).rejects.toThrow()
  const svc2 = (await service({ code: 'S02' })).id
  await expect(
    booking({
      serviceId: svc2,
      serviceVersion: 0,
      packageId: p.id,
      packageVersion: p.version,
    }),
  ).rejects.toThrow()
  await packageBooking(p.id, 60)
  await packageBooking(p.id, 90)
  await packageBooking(p.id, 120)
  await expect(packageBooking(p.id, 150)).rejects.toThrow(/الجلسات/)
  expect((await state()).packages[0].reserved).toBe(3)
})
it('package completion allocates exact prepaid value and never charges twice', async () => {
  const p = await sell()
  await pay(p.invoiceId)
  const bases = []
  for (const minute of [60, 90, 120]) {
    const b = (await packageBooking(p.id, minute)).id,
      d = await complete(b)
    bases.push(d.completion.basis)
    expect(d.invoice.total).toBe(0)
    expect(d.invoice.balance).toBe(0)
  }
  expect(bases).toEqual([3334, 3334, 3333])
  expect(bases.reduce((a, b) => a + b, 0)).toBe(10001)
  const s = await state()
  expect(s.packages[0].used).toBe(3)
  expect(s.packages[0].reserved).toBe(0)
  expect(s.invoices.reduce((n: number, i: any) => n + i.total, 0)).toBe(10001)
  await expect(packageBooking(p.id, 180)).rejects.toThrow()
})
it('cancel/no-show releases reserved package credit and stale package versions cannot claim a credit', async () => {
  const p = await sell()
  await pay(p.invoiceId)
  const v = (await state()).packages[0].version,
    a = (await packageBooking(p.id, 60)).id
  await expect(
    booking({ packageId: p.id, packageVersion: v, startMinute: 90 }),
  ).rejects.toThrow(/تغيرت/)
  await cmd('booking.cancel', { id: a, version: 0, reason: 'QA cancel' })
  const b = (await packageBooking(p.id, 90)).id
  await cmd('booking.no-show', { id: b, version: 0, reason: 'QA no show' })
  expect((await state()).packages[0].reserved).toBe(0)
  await packageBooking(p.id, 120)
})
it('void completion reverses charge and commission and returns package credit without changing original use', async () => {
  const p = await sell()
  await pay(p.invoiceId)
  const b = (await packageBooking(p.id, 60)).id,
    d = await complete(b)
  await cmd('booking.void', {
    id: b,
    version: d.booking.version,
    reason: 'QA wrong completion',
  })
  let s = await state()
  expect(s.packages[0].used).toBe(0)
  expect(s.invoices.find((i: any) => i.id === d.invoice.id).status).toBe('void')
  expect((await rpc('commissions')).summary[0].due).toBe(0)
  await expect(
    cmd('booking.void', { id: b, version: 3, reason: 'QA twice' }),
  ).rejects.toThrow()
  const a = (await packageBooking(p.id, 90)).id,
    d2 = await complete(a)
  expect(d2.completion.basis).toBe(3334)
  expect(s.bookings.find((i: any) => i.id === b).status).toBe('void')
})
it('forbids completion reversal after service collection or commission payout, package receipt void after use', async () => {
  const a = (await booking()).id,
    d = await complete(a)
  await pay(d.invoice.id, 1)
  await expect(
    cmd('booking.void', { id: a, version: d.booking.version, reason: 'QA' }),
  ).rejects.toThrow()
  const b = (await booking({ startMinute: 90 })).id,
    d2 = await complete(b)
  await cmd('commission.pay', {
    staffId: tid,
    amount: 6666,
    method: 'cash',
    reference: 'QA',
  })
  await expect(
    cmd('booking.void', { id: b, version: d2.booking.version, reason: 'QA' }),
  ).rejects.toThrow(/العمولة/)
  const p = await sell(),
    payId = (await pay(p.invoiceId)).id
  await complete((await packageBooking(p.id, 120)).id)
  await expect(
    cmd('payment.void', { id: payId, reason: 'QA' }),
  ).rejects.toThrow(/الباقة/)
  await expect(
    cmd('package.cancel', {
      id: p.id,
      version: (await state()).packages[0].version,
      reason: 'QA',
    }),
  ).rejects.toThrow()
})
it('package plan snapshots survive editing, only uncollected unused package can be cancelled', async () => {
  const p = await sell({ discount: 1 })
  await plan({
    id: pid,
    version: 0,
    credits: 6,
    fee: 30000,
    days: 60,
    name: 'Updated',
  })
  let s = await state()
  expect(s.packages[0].credits).toBe(3)
  expect(s.packages[0].endDay).toBe('2026-11-06')
  expect(s.packages[0].net).toBe(10000)
  await cmd('package.cancel', {
    id: p.id,
    version: p.version,
    reason: 'QA uncollected cancel',
  })
  s = await state()
  expect(s.packages[0].status).toBe('cancelled')
  expect(s.invoices[0].balance).toBe(0)
  expect(s.invoices[0].status).toBe('void')
})
it('stylist projections exclude all customer contact/admin notes/financial records through every read', async () => {
  const b = (await booking()).id
  const own = await rpc('state', {}, stylist)
  expect(own.bookings).toHaveLength(1)
  expect(own.customers).toHaveLength(1)
  expect(own.invoices).toEqual([])
  expect(own.payments).toEqual([])
  expect(own.packages).toEqual([])
  expect(JSON.stringify(own)).not.toContain('PRIVATE')
  const bd = await rpc('booking.get', { id: b }, stylist),
    cd = await rpc('customer.get', { id: cid }, stylist)
  expect(JSON.stringify([bd, cd])).not.toContain('PRIVATE')
  expect(bd.invoice).toBeNull()
  expect(bd.events).toEqual([])
  expect((await rpc('state', {}, other)).customers).toEqual([])
  await expect(rpc('booking.get', { id: b }, other)).rejects.toThrow()
  await expect(customer({ code: 'C02' }, stylist)).rejects.toThrow()
  await expect(booking({}, stylist)).rejects.toThrow()
  expect(
    (await rpc('report', { from: day, to: day }, stylist)).finance,
  ).toBeNull()
})
it('reassignment revokes former stylist access including pending details and historical commission stays separate', async () => {
  const b = (await booking()).id
  const altUid = (
    (await e.call(
      'user.save',
      { username: 'nextqa', name: 'QA next', role: 'stylist', password },
      owner,
    )) as any
  ).id
  const alt = (
    await employee({ code: 'E02', name: 'QA next staff', userId: altUid })
  ).id
  await cmd('booking.move', {
    id: b,
    version: 0,
    staffId: alt,
    staffVersion: 0,
    day,
    startMinute: 120,
    reason: 'QA reassign',
  })
  expect((await rpc('state', {}, stylist)).bookings).toEqual([])
  await expect(rpc('booking.get', { id: b }, stylist)).rejects.toThrow()
  await expect(rpc('customer.get', { id: cid }, stylist)).rejects.toThrow()
  await expect(
    cmd('booking.complete', { id: b, version: 1 }, stylist),
  ).rejects.toThrow()
})
it('actor/action/payload idempotency binds every command, does not cache private records and rolls back rejected mutations', async () => {
  const s = await state(),
    payload = {
      clientTxnId: ulid(),
      customerId: cid,
      customerVersion: 0,
      serviceId: sid,
      serviceVersion: 0,
      staffId: tid,
      staffVersion: 0,
      day,
      startMinute: 60,
      discount: 0,
      packageId: null,
      packageVersion: null,
      note: 'PRIVATE booking note',
    }
  const a = await rpc('booking.add', payload)
  expect(await rpc('booking.add', payload)).toEqual(a)
  await expect(
    rpc('booking.add', { ...payload, startMinute: 90 }),
  ).rejects.toThrow()
  await expect(rpc('booking.add', payload, front)).rejects.toThrow()
  expect((await state()).bookings).toHaveLength(1)
  expect(
    db
      .prepare('SELECT result FROM commands WHERE client_txn_id=?')
      .get(payload.clientTxnId),
  ).toEqual({ result: JSON.stringify(a) })
  expect(s.bookings).toEqual([])
})
it('immutable invoices/completions/ledger/receipts/package uses/commission/events reject update delete and replacement', async () => {
  const p = await sell()
  await pay(p.invoiceId)
  await complete((await packageBooking(p.id, 60)).id)
  for (const t of [
    'sal_invoice_snapshots',
    'sal_completions',
    'sal_ledger',
    'sal_payments',
    'sal_package_uses',
    'sal_commission_ledger',
    'sal_events',
  ]) {
    const row = db.prepare('SELECT * FROM ' + t + ' LIMIT 1').get() as Record<
      string,
      unknown
    >
    expect(row).toBeTruthy()
    expect(() => db.prepare('UPDATE ' + t + ' SET id=id').run()).toThrow()
    expect(() => db.prepare('DELETE FROM ' + t).run()).toThrow()
    const keys = Object.keys(row)
    expect(() =>
      db
        .prepare(
          'INSERT OR REPLACE INTO ' +
            t +
            '(' +
            keys.join(',') +
            ') VALUES(' +
            keys.map(() => '?').join(',') +
            ')',
        )
        .run(...Object.values(row)),
    ).toThrow()
  }
})
it('reports reconcile full service/package sales collections/voids and own scoped commissions for period', async () => {
  const d = await complete((await booking()).id),
    p = await pay(d.invoice.id, 3001)
  await cmd('payment.void', { id: p.id, reason: 'QA reversal' })
  await pay(d.invoice.id, 10001)
  const pack = await sell()
  await pay(pack.invoiceId)
  const r = await rpc('report', { from: day, to: day })
  expect(r.finance.charges).toBe(20002)
  expect(r.finance.netCollected).toBe(20002)
  expect(r.finance.voided).toBe(3001)
  expect(r.finance.outstanding).toBe(0)
  expect(r.bookings).toHaveLength(1)
  expect(r.commissions.summary[0].due).toBe(3333)
  const own = await rpc('report', { from: day, to: day }, stylist)
  expect(own.finance).toBeNull()
  expect(own.payments).toEqual([])
  expect(JSON.stringify(own)).not.toContain('PRIVATE')
  await expect(
    rpc('report', { from: '2026-01-01', to: '2027-02-01' }),
  ).rejects.toThrow()
})

it('multiple legal large completions remain readable and commission can be paid in bounded installments', async () => {
  await service({ id: sid, version: 0, fee: 1e12 })
  await employee({ id: tid, version: 0, commissionBps: 10000 })
  await complete((await booking()).id)
  await complete((await booking({ startMinute: 90 })).id)
  expect((await rpc('commissions')).summary[0].due).toBe(2e12)
  expect(
    (await rpc('report', { from: day, to: day })).finance.outstanding,
  ).toBe(2e12)
  await cmd('commission.pay', {
    staffId: tid,
    amount: 1e12,
    method: 'cash',
    reference: 'QA first',
  })
  await cmd('commission.pay', {
    staffId: tid,
    amount: 1e12,
    method: 'cash',
    reference: 'QA second',
  })
  expect((await rpc('commissions')).summary[0].due).toBe(0)
})
it('move history contains immutable before and after slot staff and original price facts', async () => {
  const a = (await booking()).id
  const t2 = (
    await employee({ code: 'E02', userId: null, commissionBps: 5000 })
  ).id
  await cmd('booking.move', {
    id: a,
    version: 0,
    staffId: t2,
    staffVersion: 0,
    day,
    startMinute: 180,
    reason: 'QA move history',
  })
  const d = await rpc('booking.get', { id: a }),
    ev = d.events.find((x: any) => x.action === 'sal.booking.move'),
    snap = JSON.parse(ev.snapshot)
  expect(snap.before.staffId).toBe(tid)
  expect(snap.before.startMinute).toBe(60)
  expect(snap.before.rateBps).toBe(3333)
  expect(snap.after.staffId).toBe(t2)
  expect(snap.after.startMinute).toBe(180)
  expect(snap.after.rateBps).toBe(5000)
  expect(snap.after.fee).toBe(10001)
})
