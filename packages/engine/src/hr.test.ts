import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { openDatabase, type XzareDatabase } from '@xzare/db'
import { BusinessEngine } from './service.js'
import { ulid } from '@xzare/core'
let db: XzareDatabase, e: BusinessEngine, t: string, employee: string, shift: string
const password = 'HR-QA-strong-password-123!'
const rpc = (a: string, p: unknown = {}, token = t): Promise<any> => e.call('hr.' + a, p, token)
const cmd = (a: string, p: Record<string, unknown> = {}, token = t) =>
  rpc(a, { clientTxnId: ulid(), ...p }, token)
const addEmployee = (p: Record<string, unknown> = {}, token = t) =>
  cmd(
    'employee.save',
    {
      code: 'E01',
      name: 'QA employee',
      department: 'QA dept',
      job: 'QA job',
      phone: '',
      email: '',
      hired: '2030-01-01',
      ended: '',
      active: true,
      note: 'QA private personnel note',
      ...p,
    },
    token,
  )
const roster = (day = '2030-01-07', p: Record<string, unknown> = {}) =>
  cmd('roster.save', {
    employeeId: employee,
    day,
    shiftId: shift,
    off: false,
    reason: 'QA planned shift',
    ...p,
  })
const attendance = (p: Record<string, unknown> = {}) =>
  cmd('attendance.save', {
    employeeId: employee,
    day: '2030-01-07',
    status: 'present',
    inMinute: 550,
    outMinute: 1030,
    breakMinutes: 30,
    reason: 'QA entered attendance',
    ...p,
  })
const credit = (days = 10) =>
  cmd('leave.credit', { employeeId: employee, year: 2030, days, reason: 'QA explicit grant' })
const leave = (p: Record<string, unknown> = {}) =>
  cmd('leave.request', {
    employeeId: employee,
    from: '2030-01-08',
    to: '2030-01-08',
    kind: 'paid',
    reason: 'QA leave request',
    ...p,
  })
const salary = (amount = 500001) =>
  cmd('salary.save', { employeeId: employee, base: amount, version: 0, reason: 'QA contract base' })
const submit = (p: Record<string, unknown> = {}) =>
  cmd('payroll.submit', {
    month: '2030-01',
    note: 'QA run',
    items: [
      {
        employeeId: employee,
        salaryVersion: 1,
        allowance: 101,
        overtime: 0,
        deduction: 50,
        tax: 0,
        insurance: 0,
        note: 'QA amounts',
      },
    ],
    ...p,
  })
const user = async (role: string, name = role + 'qa') => {
  await e.call('user.save', { username: name, name: 'QA ' + name, role, password, active: true }, t)
  return ((await e.call('login', { username: name, password })) as any).token
}
beforeEach(async () => {
  vi.setSystemTime(new Date(2030, 0, 20, 10))
  db = openDatabase(':memory:', 'hr' as any)
  e = new BusinessEngine(db, 'hr' as any)
  t = (
    (await e.call('setup', {
      businessName: 'QA HR',
      name: 'QA owner',
      username: 'owner',
      password,
    })) as any
  ).token
  employee = (await addEmployee()).id
  shift = (
    await cmd('shift.save', {
      name: 'QA morning',
      start: 540,
      end: 1020,
      breakMinutes: 30,
      graceMinutes: 5,
      active: true,
    })
  ).id
})
afterEach(() => {
  db?.close()
  vi.useRealTimers()
})
it('starts empty and isolates HR routes, credentials and product roles', async () => {
  const s = await rpc('state')
  expect(s.payrolls).toEqual([])
  expect(s.attendance).toEqual([])
  expect(s.settings.license).toBeUndefined()
  for (const a of ['state', 'invoice.post', 'stock.adjust', 'pharmacy.state'])
    await expect(e.call(a, {}, t)).rejects.toThrow()
  await expect(user('cashier')).rejects.toThrow()
  const other = new BusinessEngine(openDatabase(':memory:'), 'pos')
  try {
    const a: any = await other.call('setup', {
      businessName: 'QA',
      name: 'QA',
      username: 'owner',
      password,
    })
    await expect(
      other.call(
        'user.save',
        { username: 'hrqa', name: 'QA', role: 'hr', password, active: true },
        a.token,
      ),
    ).rejects.toThrow()
  } finally {
    other.db.close()
  }
})
it('validates employee dates and stale versions and unique codes', async () => {
  await expect(addEmployee({ code: 'E01' })).rejects.toThrow()
  await expect(addEmployee({ code: 'E02', hired: '2030-02-30' })).rejects.toThrow()
  await expect(addEmployee({ id: employee, version: 0, ended: '2029-01-01' })).rejects.toThrow()
  await addEmployee({ id: employee, version: 0, name: 'QA changed' })
  await expect(addEmployee({ id: employee, version: 0 })).rejects.toThrow(/تغير/)
})
it('does not expose salary to HR or private notes/evaluations to payroll', async () => {
  await salary()
  await cmd('evaluation.save', {
    employeeId: employee,
    period: '2030-Q1',
    quality: 5,
    reliability: 4,
    teamwork: 3,
    goals: 'QA sensitive goals',
    note: 'QA evaluation',
  })
  const h = await user('hr'),
    p = await user('payroll')
  const hs = await rpc('state', {}, h),
    ps = await rpc('state', {}, p)
  expect(hs.salaries).toEqual([])
  expect(hs.payrolls).toEqual([])
  expect(JSON.stringify(hs)).not.toContain('500001')
  expect(ps.evaluations).toEqual([])
  expect(ps.employees[0]).not.toHaveProperty('note')
  for (const a of ['payroll.get', 'salary.save', 'payroll.submit', 'payroll.pay'])
    await expect(rpc(a, {}, h)).rejects.toThrow()
  await expect(addEmployee({}, p)).rejects.toThrow()
})
it('snapshots shift template on roster and handles night spans and rest days', async () => {
  await roster()
  await cmd('shift.save', {
    id: shift,
    version: 0,
    name: 'QA changed',
    start: 600,
    end: 1080,
    breakMinutes: 60,
    graceMinutes: 0,
    active: true,
  })
  let s = await rpc('period', { from: '2030-01-01', to: '2030-01-31' })
  expect(s.roster[0].start).toBe(540)
  const n = await cmd('shift.save', {
    name: 'QA night',
    start: 1320,
    end: 360,
    breakMinutes: 30,
    graceMinutes: 0,
    active: true,
  })
  await roster('2030-01-09', { shiftId: n.id })
  await roster('2030-01-10', { shiftId: null, off: true })
  s = await rpc('period', { from: '2030-01-01', to: '2030-01-31' })
  expect(s.roster.find((x: any) => x.day === '2030-01-09').end).toBe(1800)
  await expect(attendance({ day: '2030-01-10' })).rejects.toThrow()
})
it('computes attendance minutes, overtime and late grace without money conversion', async () => {
  await roster()
  await attendance()
  const s = await rpc('period', { from: '2030-01-07', to: '2030-01-07' })
  expect(s.attendance[0]).toMatchObject({ worked: 450, late: 5, overtime: 0 })
  await expect(attendance({ inMinute: 1020, outMinute: 550, version: 0 })).rejects.toThrow()
  await attendance({ version: 0, inMinute: 540, outMinute: 1080 })
  expect(
    (await rpc('period', { from: '2030-01-07', to: '2030-01-07' })).attendance[0],
  ).toMatchObject({ worked: 510, overtime: 60 })
  await expect(attendance({ version: 0 })).rejects.toThrow(/تغير/)
})
it('blocks attendance before hire, after end, future days and unplanned days', async () => {
  await expect(roster('2029-12-31')).rejects.toThrow()
  await expect(attendance({ day: '2030-01-21' })).rejects.toThrow()
  await expect(attendance()).rejects.toThrow()
  await addEmployee({ id: employee, version: 0, ended: '2030-01-06' })
  await expect(roster()).rejects.toThrow()
})
it('requires all leave dates to be explicitly planned, counts workdays and reserves no default credit', async () => {
  await expect(leave()).rejects.toThrow(/وردية|جدول/)
  await roster('2030-01-08')
  await roster('2030-01-09', { off: true, shiftId: null })
  const l = await leave({ to: '2030-01-09' })
  await expect(
    cmd('leave.decide', { id: l.id, version: 0, status: 'approved', reason: 'QA approve' }),
  ).rejects.toThrow(/رصيد/)
  await credit(1)
  await cmd('leave.decide', { id: l.id, version: 0, status: 'approved', reason: 'QA approve' })
  const s = await rpc('state')
  expect(s.leaves[0]).toMatchObject({ days: 1, status: 'approved' })
  expect(s.leaveBalances[0]).toMatchObject({ granted: 1, used: 1, available: 0 })
})
it('prevents overlapping leave, attendance conflicts and roster rewrite of reserved leave', async () => {
  await roster('2030-01-08')
  const l = await leave()
  await expect(leave()).rejects.toThrow(/متداخل/)
  await expect(roster('2030-01-08', { version: 0 })).rejects.toThrow()
  await credit()
  await cmd('leave.decide', { id: l.id, version: 0, status: 'approved', reason: 'QA approve' })
  await expect(attendance({ day: '2030-01-08' })).rejects.toThrow()
  await cmd('leave.decide', { id: l.id, version: 1, status: 'cancelled', reason: 'QA cancel' })
  await attendance({ day: '2030-01-08' })
  expect((await rpc('state')).leaveBalances[0].available).toBe(10)
  const a = await leave()
  await expect(
    cmd('leave.decide', { id: a.id, version: 0, status: 'approved', reason: 'QA approve' }),
  ).rejects.toThrow(/حضور/)
})
it('guards annual credit reduction, invalid transitions and cross-year leave', async () => {
  await roster('2030-01-08')
  await credit(2)
  const l = await leave()
  await cmd('leave.decide', { id: l.id, version: 0, status: 'approved', reason: 'QA approval' })
  await expect(credit(-2)).rejects.toThrow()
  await expect(
    cmd('leave.decide', { id: l.id, version: 1, status: 'rejected', reason: 'QA invalid' }),
  ).rejects.toThrow()
  await expect(leave({ from: '2030-12-31', to: '2031-01-01' })).rejects.toThrow()
})
it('freezes exact payroll employee/salary/attendance snapshots and rejects stale salary', async () => {
  await salary()
  await roster()
  await attendance()
  await expect(
    submit({
      items: [
        {
          employeeId: employee,
          salaryVersion: 0,
          allowance: 0,
          overtime: 0,
          deduction: 0,
          tax: 0,
          insurance: 0,
          note: '',
        },
      ],
    }),
  ).rejects.toThrow()
  const r = await submit()
  await cmd('salary.save', {
    employeeId: employee,
    base: 900000,
    version: 1,
    reason: 'QA new salary',
  })
  await addEmployee({ id: employee, version: 0, name: 'QA changed' })
  const d = await rpc('payroll.get', { id: r.id })
  expect(d.items[0]).toMatchObject({ base: 500001, net: 500052, employeeName: 'QA employee' })
  expect(d.items[0].source.attendance[0].worked).toBe(450)
  expect(d.run.total).toBe(500052)
})
it('rejects duplicate month/employees, negative net and unknown or non-overlapping employees', async () => {
  await salary()
  await submit()
  await expect(submit()).rejects.toThrow(/مسير/)
  const row = {
    employeeId: employee,
    salaryVersion: 1,
    allowance: 0,
    overtime: 0,
    deduction: 0,
    tax: 0,
    insurance: 0,
    note: '',
  }
  await expect(submit({ month: '2030-02', items: [row, row] })).rejects.toThrow()
  await expect(
    submit({ month: '2030-02', items: [{ ...row, deduction: 600000 }] }),
  ).rejects.toThrow()
  await expect(submit({ month: '2029-12' })).rejects.toThrow()
})
it('requires a different approver, forbids unapproved pay and permits bounded partial settlement', async () => {
  await salary()
  const r = await submit(),
    d = await rpc('payroll.get', { id: r.id }),
    item = d.items[0]
  await expect(
    cmd('payroll.approve', { id: r.id, version: 0, reason: 'QA self approval' }),
  ).rejects.toThrow(/آخر/)
  await expect(
    cmd('payroll.pay', { id: item.id, amount: 1, method: 'cash', reference: 'QA payment' }),
  ).rejects.toThrow(/اعتماد/)
  const other = await user('manager', 'approver')
  await cmd('payroll.approve', { id: r.id, version: 0, reason: 'QA independent approval' }, other)
  await cmd('payroll.pay', {
    id: item.id,
    amount: 200000,
    method: 'bank',
    reference: 'QA transfer',
  })
  await expect(
    cmd('payroll.pay', { id: item.id, amount: 300053, method: 'bank', reference: 'QA overpay' }),
  ).rejects.toThrow()
  await cmd('payroll.pay', { id: item.id, amount: 300052, method: 'bank', reference: 'QA final' })
  const x = await rpc('payroll.get', { id: r.id })
  expect(x.items[0].balance).toBe(0)
  expect(x.items[0].paid).toBe(500052)
  await expect(
    cmd('payroll.void', { id: r.id, version: 1, reason: 'QA void paid' }),
  ).rejects.toThrow()
})
it('allows unpaid void with reason and replacement month while preserving old immutable snapshots', async () => {
  await salary()
  const r = await submit()
  await cmd('payroll.void', { id: r.id, version: 0, reason: 'QA replacement' })
  await submit()
  expect((await rpc('state')).payrolls).toHaveLength(2)
  expect((await rpc('payroll.get', { id: r.id })).run.status).toBe('void')
})
it('idempotently binds actor, action and payload without duplicating credits/payrolls', async () => {
  const c = ulid(),
    p = { employeeId: employee, year: 2030, days: 2, reason: 'QA grant', clientTxnId: c }
  const a = await rpc('leave.credit', p)
  expect(await rpc('leave.credit', p)).toEqual(a)
  expect((await rpc('state')).leaveBalances[0].granted).toBe(2)
  await expect(rpc('leave.credit', { ...p, days: 3 })).rejects.toThrow(/معرف/)
  const h = await user('hr')
  await expect(rpc('leave.credit', p, h)).rejects.toThrow(/معرف/)
})
it('records required correction reasons and immutable event/payroll/payment records including REPLACE', async () => {
  await roster()
  await attendance()
  await attendance({ version: 0, inMinute: 540, reason: 'QA correction' })
  expect(db.prepare('SELECT reason FROM hr_events ORDER BY rowid DESC').get()).toMatchObject({
    reason: 'QA correction',
  })
  await salary()
  await submit()
  for (const table of ['hr_events', 'hr_payroll_runs', 'hr_payroll_items']) {
    const x: any = db.prepare('SELECT * FROM ' + table + ' LIMIT 1').get()
    expect(() => db.prepare('DELETE FROM ' + table + ' WHERE id=?').run(x.id)).toThrow('Immutable')
    const keys = Object.keys(x)
    expect(() =>
      db
        .prepare(
          'INSERT OR REPLACE INTO ' +
            table +
            '(' +
            keys.join(',') +
            ') VALUES(' +
            keys.map(() => '?').join(',') +
            ')',
        )
        .run(...Object.values(x)),
    ).toThrow('Immutable')
  }
  await expect(attendance({ version: 1, reason: '' })).rejects.toThrow()
})
it('keeps evaluations versioned, employee-bound and out of exported operational reports for payroll', async () => {
  const r = await cmd('evaluation.save', {
    employeeId: employee,
    period: '2030 Q1',
    quality: 4,
    reliability: 3,
    teamwork: 5,
    goals: 'QA goals',
    note: 'QA note',
  })
  await expect(
    cmd('evaluation.save', {
      id: r.id,
      version: 0,
      employeeId: ulid(),
      period: '2030 Q1',
      quality: 4,
      reliability: 3,
      teamwork: 5,
      goals: '',
      note: '',
    }),
  ).rejects.toThrow()
  await cmd('evaluation.save', {
    id: r.id,
    version: 0,
    employeeId: employee,
    period: '2030 Q1',
    quality: 5,
    reliability: 4,
    teamwork: 5,
    goals: 'QA changed',
    note: '',
  })
  await expect(
    cmd('evaluation.save', {
      id: r.id,
      version: 0,
      employeeId: employee,
      period: '2030 Q1',
      quality: 5,
      reliability: 4,
      teamwork: 5,
      goals: '',
      note: '',
    }),
  ).rejects.toThrow(/تغير/)
  const p = await user('payroll')
  await expect(rpc('period', { from: '2030-01-01', to: '2030-01-31' }, p)).rejects.toThrow()
})
it('limits period ranges and invalid dates without leaking arbitrary tables', async () => {
  await expect(rpc('period', { from: '2030-01-01', to: '2031-01-01' })).rejects.toThrow()
  await expect(rpc('period', { from: '2030-02-30', to: '2030-03-01' })).rejects.toThrow()
  await expect(rpc('state', { sql: 'SELECT * FROM users' })).rejects.toThrow()
})

it('rejects overlapping overnight rosters and actual attendance including corrections', async () => {
  const night = (
    await cmd('shift.save', {
      name: 'QA night',
      start: 1320,
      end: 360,
      breakMinutes: 0,
      graceMinutes: 0,
      active: true,
    })
  ).id
  await roster('2030-01-07', { shiftId: night })
  const early = (
    await cmd('shift.save', {
      name: 'QA early',
      start: 300,
      end: 780,
      breakMinutes: 0,
      graceMinutes: 0,
      active: true,
    })
  ).id
  await expect(roster('2030-01-08', { shiftId: early })).rejects.toThrow(/تداخل/)
  await roster('2030-01-08')
  await attendance({ inMinute: 1320, outMinute: 1800, breakMinutes: 0 })
  await attendance({ day: '2030-01-08' })
  await expect(
    attendance({ day: '2030-01-08', version: 0, inMinute: 300, outMinute: 780, breakMinutes: 0 }),
  ).rejects.toThrow(/تداخل/)
})
it('validates actual end date/time so next-day offsets cannot fabricate future attendance', async () => {
  await roster('2030-01-20')
  await expect(
    attendance({ day: '2030-01-20', inMinute: 1440, outMinute: 2880, breakMinutes: 0 }),
  ).rejects.toThrow(/مستقبلي/)
  await expect(
    attendance({ day: '2030-01-20', inMinute: 540, outMinute: 1020, breakMinutes: 30 }),
  ).rejects.toThrow(/مستقبلي/)
})
it('does not duplicate sensitive leave reasons into payroll source snapshots', async () => {
  await roster('2030-01-08')
  await credit()
  const l = await leave({ reason: 'QA confidential medical diagnosis' })
  await cmd('leave.decide', { id: l.id, version: 0, status: 'approved', reason: 'QA approval' })
  await salary()
  const r = await submit()
  const p = await user('payroll')
  expect(JSON.stringify(await rpc('payroll.get', { id: r.id }, p))).not.toContain(
    'QA confidential medical diagnosis',
  )
})

it('reads future/past leave periods and year-specific credits without losing decisions', async () => {
  await roster('2030-02-05')
  await credit(4)
  const l = await leave({ from: '2030-02-05', to: '2030-02-05' })
  expect((await rpc('state')).leaves).toHaveLength(0)
  expect((await rpc('period', { from: '2030-02-01', to: '2030-02-28' })).leaves[0].id).toBe(l.id)
  await cmd('leave.decide', {
    id: l.id,
    version: 0,
    status: 'approved',
    reason: 'QA future approval',
  })
  expect((await rpc('leave.balances', { year: 2030 }))[0]).toMatchObject({ available: 3, used: 1 })
  await expect(rpc('leave.balances', { year: 2030 }, await user('payroll'))).rejects.toThrow()
})
