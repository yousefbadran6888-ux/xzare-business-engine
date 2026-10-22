import { beforeEach, afterEach, it, expect } from 'vitest'
import { openDatabase, type XzareDatabase } from '@xzare/db'
import { BusinessEngine } from './service.js'
import { ulid } from '@xzare/core'
import { clinicToday } from './clinic-time.js'
let db: XzareDatabase,
  e: BusinessEngine,
  owner: string,
  front: string,
  trainer: string,
  other: string,
  trainerUid: string,
  otherUid: string,
  mid: string,
  pid: string,
  tid: string,
  msid: string
const pass = 'Gym-QA-password-123!',
  today = clinicToday()
const rpc = (a: string, p: unknown = {}, t = owner): Promise<any> =>
  e.call('gym.' + a, p, t)
const cmd = (a: string, p: Record<string, unknown> = {}, t = owner) =>
  rpc(a, { ...p, clientTxnId: ulid() }, t)
const member = (p: Record<string, unknown> = {}, t = owner) =>
  cmd(
    'member.save',
    {
      code: 'M01',
      name: 'QA Member',
      phone: 'private phone',
      note: 'private office note',
      active: true,
      ...p,
    },
    t,
  )
const plan = (p: Record<string, unknown> = {}) =>
  cmd('plan.save', {
    code: 'P01',
    name: 'QA Monthly',
    days: 30,
    fee: 10001,
    visits: 2,
    freezeDays: 10,
    description: 'QA',
    active: true,
    ...p,
  })
const membership = (p: Record<string, unknown> = {}) =>
  cmd('membership.add', {
    memberId: mid,
    memberVersion: 0,
    planId: pid,
    planVersion: 0,
    trainerId: tid,
    startDay: today,
    discount: 1,
    ...p,
  })
const detail = () => rpc('membership.get', { id: msid })
const pay = async (amount = 10000, t = owner) =>
  cmd(
    'payment.post',
    {
      membershipId: msid,
      version: (await detail()).membership.version,
      amount,
      method: 'cash',
      reference: 'QA cash',
    },
    t,
  )
const enter = async (t = front) =>
  cmd(
    'attendance.in',
    {
      membershipId: msid,
      version: (await detail()).membership.version,
      memberVersion: 0,
    },
    t,
  )
const booking = (p: Record<string, unknown> = {}, t = owner) =>
  cmd(
    'session.save',
    {
      membershipId: msid,
      version: (
        db
          .prepare('select version from gym_memberships where id=?')
          .get(msid) as any
      ).version,
      day: today,
      startMinute: 600,
      duration: 60,
      title: 'QA Personal session',
      note: 'QA training',
      ...p,
    },
    t,
  )
const next = (day: string, n: number) =>
  new Date(Date.parse(day + 'T12:00:00Z') + n * 86400000)
    .toISOString()
    .slice(0, 10)
beforeEach(async () => {
  db = openDatabase(':memory:', 'gym' as any)
  e = new BusinessEngine(db, 'gym' as any)
  owner = (
    (await e.call('setup', {
      businessName: 'QA Gym',
      name: 'QA Owner',
      username: 'ownerqa',
      password: pass,
    })) as any
  ).token
  for (const [username, role] of [
    ['frontqa', 'cashier'],
    ['trainerqa', 'trainer'],
    ['otherqa', 'trainer'],
  ])
    await e.call(
      'user.save',
      { username, name: username, password: pass, role, active: true },
      owner,
    )
  let us = db.prepare('select id,username from users').all() as any[]
  trainerUid = us.find((x) => x.username === 'trainerqa').id
  otherUid = us.find((x) => x.username === 'otherqa').id
  front = (
    (await e.call('login', { username: 'frontqa', password: pass })) as any
  ).token
  trainer = (
    (await e.call('login', { username: 'trainerqa', password: pass })) as any
  ).token
  other = (
    (await e.call('login', { username: 'otherqa', password: pass })) as any
  ).token
  mid = (await member()).id
  pid = (await plan()).id
  tid = (
    await cmd('trainer.save', {
      code: 'T01',
      name: 'QA Trainer',
      phone: 'private trainer phone',
      note: 'private trainer memo',
      userId: trainerUid,
      active: true,
    })
  ).id
  msid = (await membership()).id
})
afterEach(() => db.close())
it('starts empty with unique database identity and unavailable legacy endpoints', async () => {
  expect(db.pragma('application_id', { simple: true })).toBe(0x585a4759)
  await expect(e.call('state', {}, owner)).rejects.toThrow()
  await expect(e.call('edu.state', {}, owner)).rejects.toThrow()
  await expect(e.call('invoice.post', {}, owner)).rejects.toThrow()
  const f = openDatabase(':memory:', 'gym' as any),
    b = new BusinessEngine(f, 'gym' as any)
  try {
    const t = (
      (await b.call('setup', {
        businessName: 'QA',
        name: 'QA',
        username: 'emptyqa',
        password: pass,
      })) as any
    ).token
    expect(((await b.call('gym.state', {}, t)) as any).members).toEqual([])
  } finally {
    f.close()
  }
})
it('validates unique codes strict values current reviewed versions and product role separation', async () => {
  await expect(member()).rejects.toThrow()
  await member({ id: mid, version: 0, name: 'QA corrected' })
  await expect(member({ id: mid, version: 0 })).rejects.toThrow()
  await expect(plan({ code: 'P02', days: 0 })).rejects.toThrow()
  await expect(membership({ startDay: '2026-02-30' })).rejects.toThrow()
  await expect(
    e.call(
      'user.save',
      {
        username: 'wrongqa',
        name: 'QA',
        password: pass,
        role: 'teacher',
        active: true,
      },
      owner,
    ),
  ).rejects.toThrow()
  await expect(member({ code: 'NO' }, trainer)).rejects.toThrow()
})
it('membership preserves inclusive plan dates fee and limits when plan changes', async () => {
  const a = (await detail()).membership
  expect(a.startDay).toBe(today)
  expect(a.endDay).toBe(next(today, 29))
  expect(a.balance).toBe(10000)
  await plan({
    id: pid,
    version: 0,
    fee: 20000,
    days: 60,
    visits: 4,
    freezeDays: 20,
  })
  const b = (await detail()).membership
  expect(b.fee).toBe(10001)
  expect(b.visits).toBe(2)
  expect(b.freezeDays).toBe(10)
  expect(b.endDay).toBe(a.endDay)
})
it('renewal uses reviewed next date and rejects every overlapping active membership', async () => {
  await expect(membership()).rejects.toThrow()
  const old = (await detail()).membership
  await expect(
    cmd('membership.renew', {
      id: msid,
      version: 0,
      planId: pid,
      planVersion: 0,
      startDay: today,
      discount: 0,
      trainerId: tid,
    }),
  ).rejects.toThrow()
  const n = await cmd('membership.renew', {
    id: msid,
    version: 0,
    planId: pid,
    planVersion: 0,
    startDay: next(old.endDay, 1),
    discount: 0,
    trainerId: tid,
  })
  expect((await rpc('membership.get', { id: n.id })).membership.startDay).toBe(
    next(old.endDay, 1),
  )
})
it('attendance blocks unpaid inactive frozen duplicate or exhausted memberships', async () => {
  await expect(enter()).rejects.toThrow()
  await pay()
  const a = await enter()
  expect((await detail()).membership.used).toBe(1)
  await expect(enter()).rejects.toThrow()
  await expect(enter(trainer)).rejects.toThrow()
  await cmd('attendance.out', { id: a.id })
  await expect(cmd('attendance.out', { id: a.id })).rejects.toThrow()
  await member({ id: mid, version: 0, active: false })
  await expect(enter()).rejects.toThrow()
})
it('scan access returns exact member code and never ambiguous partial matches', async () => {
  const a = await rpc('access.get', { code: 'M01' }, front)
  expect(a.member.id).toBe(mid)
  expect(a.membership.id).toBe(msid)
  expect(a.allowed).toBe(false)
  await pay()
  expect((await rpc('access.get', { code: 'M01' }, front)).allowed).toBe(true)
  await expect(rpc('access.get', { code: 'M' }, front)).rejects.toThrow()
  await expect(rpc('access.get', { code: 'M01' }, trainer)).rejects.toThrow()
})
it('manager-only void attendance records correction and restores visit allowance', async () => {
  await pay()
  const a = await enter()
  await expect(
    cmd('attendance.void', { id: a.id, reason: 'QA mistaken scan' }, front),
  ).rejects.toThrow()
  await cmd('attendance.void', { id: a.id, reason: 'QA mistaken scan' })
  expect((await detail()).membership.used).toBe(0)
  await expect(
    cmd('attendance.void', { id: a.id, reason: 'again' }),
  ).rejects.toThrow()
  await enter()
  expect((await detail()).membership.used).toBe(1)
})
it('freeze extends exact dates with budget and forbids admission while frozen', async () => {
  await pay()
  const d = await detail()
  await expect(
    cmd(
      'membership.freeze',
      {
        id: msid,
        version: d.membership.version,
        from: today,
        to: next(today, 2),
        reason: 'QA trip',
      },
      front,
    ),
  ).rejects.toThrow()
  await cmd('membership.freeze', {
    id: msid,
    version: d.membership.version,
    from: today,
    to: next(today, 2),
    reason: 'QA trip',
  })
  expect((await detail()).membership.endDay).toBe(next(d.membership.endDay, 3))
  expect((await detail()).membership.frozenDays).toBe(3)
  await expect(enter()).rejects.toThrow()
  await expect(
    cmd('membership.freeze', {
      id: msid,
      version: (await detail()).membership.version,
      from: today,
      to: next(today, 1),
      reason: 'overlap',
    }),
  ).rejects.toThrow()
  await expect(
    cmd('membership.freeze', {
      id: msid,
      version: (await detail()).membership.version,
      from: next(today, 3),
      to: next(today, 10),
      reason: 'over budget',
    }),
  ).rejects.toThrow()
})
it('freeze cannot collide with renewed membership or planned training', async () => {
  const a = (await detail()).membership
  await cmd('membership.renew', {
    id: msid,
    version: 0,
    planId: pid,
    planVersion: 0,
    startDay: next(a.endDay, 1),
    discount: 0,
    trainerId: tid,
  })
  await expect(
    cmd('membership.freeze', {
      id: msid,
      version: (await detail()).membership.version,
      from: today,
      to: today,
      reason: 'QA',
    }),
  ).rejects.toThrow()
})
it('payments cap exact due and void is immutable manager correction restoring due', async () => {
  await expect(pay(10001)).rejects.toThrow()
  const p = await pay(3001)
  expect((await detail()).membership.balance).toBe(6999)
  await expect(
    cmd('payment.void', { id: p.id, reason: 'QA' }, front),
  ).rejects.toThrow()
  await cmd('payment.void', { id: p.id, reason: 'QA corrected receipt' })
  expect((await detail()).membership.balance).toBe(10000)
  expect((await detail()).payments[0].voidReason).toBe('QA corrected receipt')
  await expect(
    cmd('payment.void', { id: p.id, reason: 'QA' }),
  ).rejects.toThrow()
  await pay()
  expect((await detail()).membership.balance).toBe(0)
})
it('bounded credit is manager-only and cancellation is only before any saved activity', async () => {
  await expect(
    cmd('credit.post', {
      membershipId: msid,
      version: 0,
      amount: 10001,
      reason: 'QA',
    }),
  ).rejects.toThrow()
  await expect(
    cmd(
      'credit.post',
      { membershipId: msid, version: 0, amount: 1, reason: 'QA' },
      front,
    ),
  ).rejects.toThrow()
  await cmd('membership.cancel', {
    id: msid,
    version: 0,
    reason: 'QA registration error',
  })
  expect((await detail()).membership.balance).toBe(0)
  expect((await detail()).membership.status).toBe('cancelled')
  await expect(enter()).rejects.toThrow()
})
it('stopping preserves charges receipt history and disables all later admission', async () => {
  await pay(3001)
  await cmd('membership.stop', {
    id: msid,
    version: (await detail()).membership.version,
    reason: 'QA stop',
  })
  const d = await detail()
  expect(d.membership.status).toBe('stopped')
  expect(d.membership.balance).toBe(6999)
  expect(d.payments).toHaveLength(1)
  await expect(enter()).rejects.toThrow()
  await expect(
    cmd('membership.cancel', {
      id: msid,
      version: d.membership.version,
      reason: 'QA',
    }),
  ).rejects.toThrow()
})
it('trainers see own names codes and attendance but no contacts money memo or receipt data', async () => {
  await pay()
  await enter()
  await booking()
  const s = await rpc('state', {}, trainer)
  expect(s.members.map((x: any) => x.id)).toEqual([mid])
  expect(s.memberships).toHaveLength(1)
  expect(s.payments).toEqual([])
  expect(JSON.stringify(s)).not.toContain('private')
  expect(JSON.stringify(s.memberships)).not.toContain('fee')
  const d = await rpc('membership.get', { id: msid }, trainer)
  expect(d.payments).toEqual([])
  expect(d.ledger).toEqual([])
  expect(d.events).toEqual([])
  expect(JSON.stringify(d)).not.toContain('10001')
  await expect(rpc('membership.get', { id: msid }, other)).rejects.toThrow()
  expect((await rpc('state', {}, other)).members).toEqual([])
})
it('reassigning immediately revokes old trainer details including existing sessions', async () => {
  const b = await booking()
  const nt = (
    await cmd('trainer.save', {
      code: 'T02',
      name: 'QA other',
      phone: '',
      note: '',
      userId: otherUid,
      active: true,
    })
  ).id
  await cmd('membership.assign', {
    id: msid,
    version: (await detail()).membership.version,
    trainerId: nt,
    reason: 'QA new trainer',
  })
  await expect(rpc('session.get', { id: b.id }, trainer)).rejects.toThrow()
  await expect(rpc('membership.get', { id: msid }, trainer)).rejects.toThrow()
  expect(
    (await rpc('session.get', { id: b.id }, other)).session.trainerId,
  ).toBe(nt)
})
it('training bookings reject overlapping member/trainer intervals, date bounds and cashier marking', async () => {
  const a = await booking()
  await expect(booking({ startMinute: 630 })).rejects.toThrow()
  await expect(booking({ day: next(today, 30) })).rejects.toThrow()
  await expect(
    cmd(
      'session.mark',
      { id: a.id, version: 0, status: 'done', note: 'QA' },
      front,
    ),
  ).rejects.toThrow()
  await cmd(
    'session.mark',
    { id: a.id, version: 0, status: 'done', note: 'QA completed' },
    trainer,
  )
  await expect(
    cmd(
      'session.mark',
      { id: a.id, version: 0, status: 'no-show', note: 'stale' },
      trainer,
    ),
  ).rejects.toThrow()
  await expect(
    cmd('session.cancel', { id: a.id, version: 1, reason: 'QA' }),
  ).rejects.toThrow()
})
it('actor payload and action bind retries without caching membership private data', async () => {
  const clientTxnId = ulid(),
    d = {
      membershipId: msid,
      version: 0,
      amount: 3001,
      method: 'cash',
      reference: 'QA',
      clientTxnId,
    }
  const r = await rpc('payment.post', d)
  expect(await rpc('payment.post', d)).toEqual(r)
  expect(db.prepare('select count(*) n from gym_payments').get()).toEqual({
    n: 1,
  })
  await expect(rpc('payment.post', { ...d, amount: 3002 })).rejects.toThrow()
  await expect(rpc('payment.post', d, front)).rejects.toThrow()
  const cache = JSON.stringify(db.prepare('select result from commands').all())
  expect(cache).not.toContain('private')
})
it('immutable receipts charges attendance freeze snapshots and history forbid alteration', async () => {
  await pay()
  await enter()
  for (const t of [
    'gym_ledger',
    'gym_payments',
    'gym_checkins',
    'gym_events',
  ]) {
    expect(() => db.prepare('update ' + t + ' set id=id').run()).toThrow(
      'Immutable',
    )
    expect(() => db.prepare('delete from ' + t).run()).toThrow('Immutable')
    expect(() =>
      db.prepare('insert or replace into ' + t + ' select * from ' + t).run(),
    ).toThrow('Immutable')
  }
})
it('reports reconcile amounts from full ledger and trainers receive no finance', async () => {
  const a = await pay(3001)
  await cmd('payment.void', { id: a.id, reason: 'QA' })
  await pay()
  await enter()
  const r = await rpc('report', { from: today, to: today })
  expect(r.finance.netCollected).toBe(10000)
  expect(r.finance.voided).toBe(3001)
  expect(r.finance.outstanding).toBe(0)
  expect(r.attendance).toHaveLength(1)
  expect(
    (await rpc('report', { from: today, to: today }, trainer)).finance,
  ).toBe(null)
})

it('trainer projections never disclose office session notes or titles through any read', async () => {
  const b = await booking({
    title: 'private office title',
    note: 'private office note',
  })
  for (const [a, p] of [
    ['state', {}],
    ['membership.get', { id: msid }],
    ['session.get', { id: b.id }],
    ['report', { from: today, to: today }],
  ] as const) {
    const text = JSON.stringify(await rpc(a, p, trainer))
    expect(text).not.toContain('private office')
  }
})
