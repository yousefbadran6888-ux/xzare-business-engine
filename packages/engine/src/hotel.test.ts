import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { openDatabase, applicationId } from '@xzare/db'
import { BusinessEngine } from './service.js'
import { actionsFor } from './runtime.js'
import { ulid } from '@xzare/core'
let db: any,
  e: BusinessEngine,
  owner: string,
  front: string,
  rid: string,
  gid: string
const password = 'Hotel-QA-Only-Strong-42!'
const rpc = async (a: string, p: any = {}, t = owner) =>
  e.call('hotel.' + a, p, t) as Promise<any>
const cmd = async (a: string, p: any, t = owner) =>
  rpc(a, { clientTxnId: ulid(), ...p }, t)
const state = () => rpc('state')
const guest = (p: any = {}) =>
  cmd('guest.save', {
    code: 'G01',
    name: 'QA Guest',
    phone: 'PRIVATE phone',
    document: 'PRIVATE document',
    note: 'PRIVATE note',
    active: true,
    ...p,
  })
const room = (p: any = {}) =>
  cmd('room.save', {
    code: '101',
    name: 'QA Room',
    category: 'QA Suite',
    floor: '1',
    capacity: 2,
    rate: 10001,
    active: true,
    ...p,
  })
async function reserve(p: any = {}) {
  const s = await state()
  return cmd('reservation.add', {
    guestId: gid,
    guestVersion: s.guests.find((g: any) => g.id === gid).version,
    roomId: rid,
    roomVersion: s.rooms.find((r: any) => r.id === rid).version,
    arrival: '2026-10-08',
    departure: '2026-10-10',
    adults: 2,
    rate: 10001,
    discount: 0,
    note: 'QA stay',
    ...p,
  })
}
async function res(id: string) {
  return (await rpc('reservation.get', { id })).reservation
}
async function act(a: string, id: string, p: any = {}, t = owner) {
  return cmd(a, { id, version: (await res(id)).version, ...p }, t)
}
async function pay(id: string, amount?: number) {
  const r = await res(id)
  return cmd('payment.post', {
    reservationId: id,
    version: r.version,
    kind: 'receipt',
    amount: amount ?? r.balance,
    method: 'cash',
    reference: 'QA reference',
    reason: '',
  })
}
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-08T12:00:00'))
  db = openDatabase(':memory:', 'hotel' as any)
  e = new BusinessEngine(db, 'hotel' as any)
  owner = (
    (await e.call('setup', {
      businessName: 'QA Hotel',
      name: 'QA Owner',
      username: 'ownerqa',
      password,
    })) as any
  ).token
  await e.call(
    'user.save',
    { username: 'frontqa', name: 'QA Reception', role: 'cashier', password },
    owner,
  )
  front = ((await e.call('login', { username: 'frontqa', password })) as any)
    .token
  rid = (await room()).id
  gid = (await guest()).id
})
afterEach(() => {
  db?.close()
  vi.useRealTimers()
})
it('has own empty database, action boundary and no manufactured guest records', async () => {
  expect(applicationId('hotel' as any)).not.toBe(applicationId('salon'))
  const s = await state()
  expect(s.reservations).toEqual([])
  expect(s.payments).toEqual([])
  expect(s.guests).toHaveLength(1)
  expect(actionsFor('hotel' as any).has('hotel.reservation.add')).toBe(true)
  await expect(e.call('invoice.post', {}, owner)).rejects.toThrow()
  await expect(rpc('state', {}, null as any)).rejects.toThrow()
})
it('uses half-open room intervals and rejects overlapping reservations atomically', async () => {
  await reserve()
  await expect(
    reserve({ arrival: '2026-10-09', departure: '2026-10-11' }),
  ).rejects.toThrow()
  await reserve({ arrival: '2026-10-10', departure: '2026-10-11' })
  expect((await state()).reservations).toHaveLength(2)
  expect(
    (
      await rpc('availability', {
        arrival: '2026-10-09',
        departure: '2026-10-10',
        adults: 1,
      })
    ).rooms,
  ).toHaveLength(0)
})
it('validates dates, capacity, money, inactive data, strict contracts and stale versions', async () => {
  for (const p of [
    { arrival: '2026-02-30' },
    { departure: '2026-10-08' },
    { adults: 3 },
    { rate: 1.5 },
    { discount: 999999 },
    { guestVersion: 99 },
    { roomVersion: 99 },
    { evil: true },
  ])
    await expect(reserve(p)).rejects.toThrow()
  await cmd('guest.save', {
    id: gid,
    version: 0,
    code: 'G01',
    name: 'QA Guest',
    phone: '',
    document: '',
    note: '',
    active: false,
  })
  await expect(reserve()).rejects.toThrow()
  expect((await state()).reservations).toHaveLength(0)
})
it('snapshots rate and guest identity, computes cents and keeps moves in immutable history', async () => {
  const { id } = await reserve({ discount: 1 })
  expect((await res(id)).total).toBe(20001)
  await cmd('guest.save', {
    id: gid,
    version: 0,
    code: 'G01',
    name: 'Changed',
    phone: '',
    document: '',
    note: '',
    active: true,
  })
  await act('reservation.change', id, {
    roomId: rid,
    roomVersion: 0,
    arrival: '2026-10-08',
    departure: '2026-10-11',
    adults: 1,
    rate: 10001,
    discount: 0,
    reason: 'QA extension',
  })
  const d = await rpc('reservation.get', { id })
  expect(d.reservation.guest.name).toBe('QA Guest')
  expect(d.reservation.total).toBe(30003)
  const history = JSON.parse(
    d.events.find((e: any) => e.action === 'hotel.reservation.change').snapshot,
  )
  expect(history.before.departure).toBe('2026-10-10')
  expect(history.after.departure).toBe('2026-10-11')
  expect(d.ledger.reduce((n: number, l: any) => n + l.amount, 0)).toBe(30003)
})
it('blocks arrival for future, dirty, blocked or occupied rooms and check-out debt', async () => {
  const { id } = await reserve()
  await cmd('housekeeping.set', {
    id: rid,
    version: 0,
    cleanliness: 'dirty',
    reason: 'QA dirty',
  })
  await expect(act('reservation.checkin', id)).rejects.toThrow()
  await cmd('housekeeping.set', {
    id: rid,
    version: 1,
    cleanliness: 'ready',
    reason: 'QA inspected',
  })
  await act('reservation.checkin', id)
  await expect(act('reservation.checkout', id)).rejects.toThrow()
  await pay(id)
  await act('reservation.checkout', id)
  expect((await res(id)).status).toBe('checked-out')
  expect((await state()).rooms[0].cleanliness).toBe('dirty')
  const future = await reserve({
    arrival: '2026-10-10',
    departure: '2026-10-11',
  })
  await expect(act('reservation.checkin', future.id)).rejects.toThrow()
})
it('overdue in-house stays block physical arrival despite adjacent planned dates', async () => {
  const a = await reserve(),
    b = await reserve({ arrival: '2026-10-10', departure: '2026-10-11' })
  await act('reservation.checkin', a.id)
  vi.setSystemTime(new Date('2026-10-10T12:00:00'))
  owner = ((await e.call('login', { username: 'ownerqa', password })) as any)
    .token
  await expect(act('reservation.checkin', b.id)).rejects.toThrow()
})
it('posts extras, payment and refunds with bound versions, safe corrections and settlement', async () => {
  const { id } = await reserve()
  await act('reservation.checkin', id)
  await act('charge.add', id, { title: 'QA breakfast', amount: 501 })
  expect((await res(id)).balance).toBe(20503)
  const receipt = await pay(id)
  await expect(pay(id, 1)).rejects.toThrow()
  await expect(
    act('reservation.change', id, {
      roomId: rid,
      roomVersion: 0,
      arrival: '2026-10-08',
      departure: '2026-10-09',
      adults: 2,
      rate: 10001,
      discount: 0,
      reason: 'QA lower',
    }),
  ).rejects.toThrow()
  const r = await res(id)
  await cmd('payment.post', {
    reservationId: id,
    version: r.version,
    kind: 'refund',
    amount: 501,
    method: 'cash',
    reference: '',
    reason: 'QA refund',
  })
  await expect(
    cmd('payment.void', { id: receipt.id, reason: 'QA wrong receipt' }),
  ).rejects.toThrow()
  await pay(id)
  await act('reservation.checkout', id)
  await expect(
    cmd('payment.void', { id: receipt.id, reason: 'QA closed' }),
  ).rejects.toThrow()
})
it('cancels only refunded reservations, releases the room, retains original receipts and rejects forged terminal writes', async () => {
  const { id } = await reserve()
  const p = await pay(id, 1000)
  await expect(
    act('reservation.cancel', id, { reason: 'QA cancel' }),
  ).rejects.toThrow()
  await cmd('payment.post', {
    reservationId: id,
    version: (await res(id)).version,
    kind: 'refund',
    amount: 1000,
    method: 'cash',
    reference: '',
    reason: 'QA cancel refund',
  })
  await act('reservation.cancel', id, { reason: 'QA cancelled' })
  const d = await rpc('reservation.get', { id })
  expect(d.reservation.balance).toBe(0)
  expect(d.reservation.total).toBe(0)
  expect(d.payments).toHaveLength(2)
  expect(d.payments.find((x: any) => x.id === p.id).amount).toBe(1000)
  await expect(pay(id, 1)).rejects.toThrow()
  await reserve()
})
it('enforces management at the server and hides reports, account audit and guest documents from reception', async () => {
  await expect(
    cmd(
      'room.save',
      {
        code: '102',
        name: 'QA',
        category: '',
        floor: '',
        capacity: 2,
        rate: 100,
        active: true,
      },
      front,
    ),
  ).rejects.toThrow()
  await expect(
    rpc('report', { from: '2026-10-08', to: '2026-10-08' }, front),
  ).rejects.toThrow()
  const s = await rpc('state', {}, front)
  expect(s.audit).toEqual([])
  expect(s.users).toEqual([])
  expect(JSON.stringify(s)).not.toContain('PRIVATE document')
  await expect(
    cmd(
      'guest.save',
      {
        id: gid,
        version: 0,
        code: 'G01',
        name: 'QA',
        phone: '',
        document: 'changed',
        note: '',
        active: true,
      },
      front,
    ),
  ).rejects.toThrow()
})
it('requires idempotency with actor/action/payload binding without caching private data', async () => {
  const clientTxnId = ulid(),
    p = {
      clientTxnId,
      code: '102',
      name: 'QA2',
      category: '',
      floor: '',
      capacity: 1,
      rate: 1,
      active: true,
    }
  const a = await rpc('room.save', p)
  expect(await rpc('room.save', p)).toEqual(a)
  await expect(rpc('room.save', { ...p, name: 'Changed' })).rejects.toThrow()
  await expect(rpc('room.save', p, front)).rejects.toThrow()
  const commands = db.prepare('SELECT * FROM hotel_commands').all()
  expect(commands[0].result).toMatch(/^{"id":/)
  expect(JSON.stringify(commands)).not.toContain('PRIVATE')
})
it('protects immutable ledgers/events against update, delete and replace', async () => {
  const { id } = await reserve()
  await pay(id, 100)
  for (const table of ['hotel_ledger', 'hotel_events', 'hotel_payments']) {
    const row = db.prepare('SELECT * FROM ' + table + ' LIMIT 1').get()
    expect(() =>
      db.prepare('DELETE FROM ' + table + ' WHERE id=?').run(row.id),
    ).toThrow()
    expect(() =>
      db.prepare('UPDATE ' + table + ' SET id=id WHERE id=?').run(row.id),
    ).toThrow()
    expect(() =>
      db
        .prepare(
          'INSERT OR REPLACE INTO ' +
            table +
            ' SELECT * FROM ' +
            table +
            ' WHERE id=?',
        )
        .run(row.id),
    ).toThrow()
  }
})
it('room maintenance/deactivation cannot disrupt existing reservations', async () => {
  await reserve()
  await expect(
    cmd('room.block', {
      id: rid,
      version: 0,
      blocked: true,
      reason: 'QA maintenance',
    }),
  ).rejects.toThrow()
  await expect(room({ id: rid, version: 0, active: false })).rejects.toThrow()
})

it('early departure today can be repriced and refunded before checkout without losing original charge', async () => {
  const { id } = await reserve()
  await act('reservation.checkin', id)
  await pay(id)
  vi.setSystemTime(new Date('2026-10-09T12:00:00'))
  owner = ((await e.call('login', { username: 'ownerqa', password })) as any)
    .token
  const b = await res(id)
  await cmd('payment.post', {
    reservationId: id,
    version: b.version,
    kind: 'refund',
    amount: 10001,
    method: 'cash',
    reference: '',
    reason: 'QA early departure',
  })
  await act('reservation.change', id, {
    roomId: rid,
    roomVersion: 0,
    arrival: '2026-10-08',
    departure: '2026-10-09',
    adults: 2,
    rate: 10001,
    discount: 0,
    reason: 'QA early departure agreed',
  })
  expect((await res(id)).balance).toBe(0)
  await act('reservation.checkout', id)
  const d = await rpc('reservation.get', { id })
  expect(d.reservation.total).toBe(10001)
  expect(d.ledger.find((x: any) => x.kind === 'room').amount).toBe(20002)
  expect(d.ledger.find((x: any) => x.kind === 'adjustment').amount).toBe(-10001)
})
it('voids receipts and extra charges atomically, rejects repeated and unsafe reversal', async () => {
  const { id } = await reserve()
  await act('reservation.checkin', id)
  const c = await act('charge.add', id, { title: 'QA extra', amount: 501 })
  const p = await pay(id)
  await expect(
    cmd('charge.void', { id: c.id, reason: 'QA incorrect' }),
  ).rejects.toThrow()
  await cmd('payment.void', { id: p.id, reason: 'QA incorrect receipt' })
  expect((await res(id)).collected).toBe(0)
  await expect(
    cmd('payment.void', { id: p.id, reason: 'QA duplicate' }),
  ).rejects.toThrow()
  await cmd('charge.void', { id: c.id, reason: 'QA wrong extra' })
  expect((await res(id)).total).toBe(20002)
  await expect(
    cmd('charge.void', { id: c.id, reason: 'QA duplicate' }),
  ).rejects.toThrow()
  expect((await rpc('reservation.get', { id })).payments[0].voidReason).toBe(
    'QA incorrect receipt',
  )
})
it('report uses local posting dates, actual elapsed nights and totals beyond individual money limits', async () => {
  await reserve({ rate: 5e11, departure: '2026-10-10' })
  const { id } = await reserve({
    arrival: '2026-10-10',
    departure: '2026-10-12',
    rate: 5e11,
  })
  const report = await rpc('report', { from: '2026-10-08', to: '2026-10-08' })
  expect(report.charges).toBe(2e12)
  expect(report.outstanding).toBe(2e12)
  expect(report.roomNights).toBe(0)
  await expect(
    rpc('report', { from: '2026-10-10', to: '2026-10-08' }),
  ).rejects.toThrow()
  expect((await res(id)).total).toBe(1e12)
})

it('overdue occupied nights reconcile to the actual stay in the report rows and export', async () => {
  const { id } = await reserve()
  await act('reservation.checkin', id)
  vi.setSystemTime(new Date('2026-10-12T12:00:00'))
  owner = ((await e.call('login', { username: 'ownerqa', password })) as any)
    .token
  const r = await rpc('report', { from: '2026-10-11', to: '2026-10-11' })
  expect(r.roomNights).toBe(1)
  expect(r.reservations.map((b: any) => b.id)).toContain(id)
  expect(r.reservations[0].status).toBe('in-house')
})
