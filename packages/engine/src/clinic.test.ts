import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { openDatabase, type XzareDatabase } from '@xzare/db'
import { BusinessEngine } from './service.js'
import { ulid } from '@xzare/core'
let db: XzareDatabase,
  e: BusinessEngine,
  t: string,
  patient: string,
  doctor: string,
  service: string
const pass = 'Clinic-QA-secure-password-123!'
const rpc = (a: string, p: unknown = {}, token = t): Promise<any> => e.call('clinic.' + a, p, token)
const cmd = (a: string, p: Record<string, unknown> = {}, token = t) =>
  rpc(a, { clientTxnId: ulid(), ...p }, token)
const booking = (extra: Record<string, unknown> = {}) =>
  cmd('appointment.save', {
    patientId: patient,
    doctorId: doctor,
    start: Date.UTC(2030, 0, 1, 8),
    duration: 30,
    reason: 'Consultation QA',
    ...extra,
  })
const user = async (role: string, username: string) => {
  const u = (await e.call(
    'user.save',
    { name: username, username, role, password: pass, active: true },
    t,
  )) as any
  const s = (await e.call('login', { username, password: pass })) as any
  return { id: u.id, token: s.token }
}
beforeEach(async () => {
  vi.setSystemTime(new Date(Date.UTC(2030, 0, 1, 8)))
  db = openDatabase(':memory:', 'clinic' as any)
  e = new BusinessEngine(db, 'clinic' as any)
  t = (
    (await e.call('setup', {
      businessName: 'Clinic QA',
      name: 'QA owner',
      username: 'owner',
      password: pass,
    })) as any
  ).token
  patient = (
    await cmd('patient.save', {
      name: 'QA patient',
      phone: '01000000000',
      birthDate: '2000-01-01',
      sex: 'female',
      address: '',
      active: true,
    })
  ).id
  doctor = (
    await cmd('doctor.save', {
      name: 'QA doctor',
      specialty: 'QA specialty',
      userId: null,
      active: true,
    })
  ).id
  service = (await cmd('service.save', { name: 'QA consultation', price: 12345, active: true })).id
})
afterEach(() => {
  db?.close()
  vi.useRealTimers()
})
it('starts without fake data, generates a stable unique patient record and hides license', async () => {
  const s = await rpc('state')
  expect(s.appointments).toEqual([])
  expect(s.visits).toEqual([])
  expect(s.invoices).toEqual([])
  expect(s.patients[0].number).toBe('P-000001')
  expect(s.settings.license).toBeUndefined()
  expect(s.reconciled).toBe(true)
})
it('rejects doctor and patient overlapping appointments but allows boundary and cancellation reuse', async () => {
  const a = await booking()
  await expect(booking({ start: Date.UTC(2030, 0, 1, 8, 15) })).rejects.toThrow(/يتعارض/)
  const d = (
    await cmd('doctor.save', { name: 'Other QA', specialty: '', userId: null, active: true })
  ).id
  await expect(booking({ doctorId: d })).rejects.toThrow(/يتعارض/)
  await booking({ start: Date.UTC(2030, 0, 1, 8, 30) })
  await cmd('appointment.status', {
    id: a.id,
    version: 0,
    status: 'cancelled',
    note: 'Patient cancelled QA',
  })
  await booking()
})
it('reschedules with version control, retains events and rolls back conflicts', async () => {
  const a = await booking()
  await booking({ start: Date.UTC(2030, 0, 1, 9) })
  await expect(booking({ id: a.id, version: 0, start: Date.UTC(2030, 0, 1, 9) })).rejects.toThrow()
  await booking({ id: a.id, version: 0, start: Date.UTC(2030, 0, 1, 10) })
  await expect(booking({ id: a.id, version: 0, start: Date.UTC(2030, 0, 1, 11) })).rejects.toThrow(
    /تغير/,
  )
  expect((await rpc('appointment.get', { id: a.id })).events).toHaveLength(2)
})
it('blocks archival when appointments are open and validates dates and duration', async () => {
  await expect(
    cmd('patient.save', {
      name: 'Invalid QA',
      phone: '',
      birthDate: '2000-02-30',
      sex: 'unknown',
      address: '',
      active: true,
    }),
  ).rejects.toThrow()
  await expect(booking({ duration: 0 })).rejects.toThrow()
  await booking()
  await expect(
    cmd('patient.save', {
      id: patient,
      version: 0,
      name: 'QA',
      phone: '',
      birthDate: null,
      sex: 'unknown',
      address: '',
      active: false,
    }),
  ).rejects.toThrow(/موعد/)
  await expect(
    cmd('doctor.save', {
      id: doctor,
      version: 0,
      name: 'QA',
      specialty: '',
      userId: null,
      active: false,
    }),
  ).rejects.toThrow(/موعد/)
})
it('keeps visits private from reception and managers while assigned doctor can finalize and append', async () => {
  const d = await user('doctor', 'doctorqa')
  await cmd('doctor.save', {
    id: doctor,
    version: 0,
    name: 'QA doctor',
    specialty: 'QA',
    userId: d.id,
    active: true,
  })
  const a = await booking()
  await cmd('appointment.status', {
    id: a.id,
    version: 0,
    status: 'checked_in',
    note: 'Arrived QA',
  })
  const v = await cmd('visit.open', { appointmentId: a.id }, d.token)
  await cmd(
    'visit.save',
    {
      id: v.id,
      version: 0,
      complaint: 'Private symptom QA',
      assessment: 'Private assessment QA',
      plan: 'Private plan QA',
    },
    d.token,
  )
  const reception = await user('cashier', 'receptionqa'),
    manager = await user('manager', 'managerqa')
  for (const u of [reception, manager]) {
    expect(JSON.stringify(await rpc('state', {}, u.token))).not.toContain('Private')
    await expect(rpc('visit.get', { id: v.id }, u.token)).rejects.toThrow(/صلاحية/)
  }
  expect((await rpc('visit.get', { id: v.id }, d.token)).visit.assessment).toContain('Private')
  await cmd('visit.finalize', { id: v.id, version: 1 }, d.token)
  await expect(
    cmd(
      'visit.save',
      { id: v.id, version: 2, complaint: 'Edit', assessment: 'Edit', plan: 'Edit' },
      d.token,
    ),
  ).rejects.toThrow()
  await cmd(
    'visit.addendum',
    { id: v.id, note: 'Correction QA', reason: 'Clarification QA' },
    d.token,
  )
  expect((await rpc('visit.get', { id: v.id }, d.token)).addenda).toHaveLength(1)
  expect((await rpc('appointment.get', { id: a.id })).appointment.status).toBe('completed')
  expect(() => db.prepare('UPDATE clinic_visit_final SET assessment=?').run('tampered')).toThrow()
})
it('limits doctor to assigned appointments and blocks reception from clinical commands', async () => {
  const d = await user('doctor', 'otherdoctorqa')
  const a = await booking()
  await expect(rpc('appointment.get', { id: a.id }, d.token)).rejects.toThrow()
  expect((await rpc('state', {}, d.token)).patients).toEqual([])
  const r = await user('cashier', 'receptionqa')
  await cmd('appointment.status', { id: a.id, version: 0, status: 'checked_in', note: 'Arrived' })
  await expect(cmd('visit.open', { appointmentId: a.id }, r.token)).rejects.toThrow(/صلاحية/)
  await expect(e.call('state', {}, r.token)).rejects.toThrow()
})
it('finalization requires entered assessment and plan, no invented medical content', async () => {
  const a = await booking()
  await cmd('appointment.status', { id: a.id, version: 0, status: 'checked_in', note: 'Arrived' })
  const v = await cmd('visit.open', { appointmentId: a.id })
  await expect(cmd('visit.finalize', { id: v.id, version: 0 })).rejects.toThrow()
  expect((await rpc('visit.get', { id: v.id })).visit.assessment).toBe('')
})
it('posts immutable fee snapshots with exact tax, partial payments and refund reversal', async () => {
  const a = await booking()
  const i = await cmd('invoice.post', {
    appointmentId: a.id,
    lines: [{ serviceId: service, qty: 3, price: 12345 }],
    discount: 2,
    taxBps: 1400,
  })
  await cmd('service.save', { id: service, version: 0, name: 'Renamed QA', price: 1, active: true })
  let detail = await rpc('invoice.get', { id: i.id })
  expect(detail.invoice.total).toBe(42218)
  expect(detail.lines[0].name).toBe('QA consultation')
  await cmd('invoice.pay', { id: i.id, amount: 20000, method: 'cash', reference: 'Receipt QA' })
  await expect(
    cmd('invoice.pay', { id: i.id, amount: 22219, method: 'cash', reference: 'Overpay QA' }),
  ).rejects.toThrow()
  await cmd('invoice.pay', { id: i.id, amount: 22218, method: 'bank', reference: 'Transfer QA' })
  await cmd('invoice.void', {
    id: i.id,
    note: 'Cancellation QA',
    method: 'cash',
    reference: 'Refund QA',
  })
  detail = await rpc('invoice.get', { id: i.id })
  expect(detail.invoice.voided).toBe(1)
  expect(detail.invoice.balance).toBe(0)
  expect(detail.refund.amount).toBe(42218)
  expect(() => db.prepare('UPDATE clinic_invoices SET total=1').run()).toThrow()
  expect(() => db.prepare('DELETE FROM clinic_payments').run()).toThrow()
  const report = await rpc('report', { from: '2020-01-01', to: '2099-01-01' })
  expect(report.revenue).toBe(0)
  expect(report.collected).toBe(42218)
  expect(report.refunded).toBe(42218)
  expect(report.reconciled).toBe(true)
})
it('reconciles open balance, refuses a second invoice and invalid fees', async () => {
  const a = await booking()
  const p = {
    appointmentId: a.id,
    lines: [{ serviceId: service, qty: 1, price: 10000 }],
    discount: 0,
    taxBps: 0,
  }
  await expect(cmd('invoice.post', { ...p, discount: 10001 })).rejects.toThrow()
  await expect(
    cmd('invoice.post', { ...p, lines: [{ serviceId: service, qty: 100, price: 1e12 }] }),
  ).rejects.toThrow()
  const i = await cmd('invoice.post', p)
  await expect(cmd('invoice.post', p)).rejects.toThrow()
  await cmd('invoice.pay', { id: i.id, amount: 3000, method: 'card', reference: 'QA payment' })
  const s = await rpc('state')
  expect(s.invoices[0].balance).toBe(7000)
  expect((await rpc('report', { from: '2020-01-01', to: '2099-01-01' })).receivable).toBe(7000)
})
it('binds idempotency to actor and payload and does not cache medical text in responses', async () => {
  const p = {
    clientTxnId: ulid(),
    name: 'Patient 2 QA',
    phone: '',
    birthDate: null,
    sex: 'unknown',
    address: '',
    active: true,
  }
  const a = await rpc('patient.save', p)
  expect(await rpc('patient.save', p)).toEqual(a)
  await expect(rpc('patient.save', { ...p, name: 'Changed' })).rejects.toThrow()
  const r = await user('cashier', 'receptionqa')
  await expect(rpc('patient.save', p, r.token)).rejects.toThrow()
  expect((await rpc('state')).patients).toHaveLength(2)
})
it('requires manager for catalog and admin for refunds, denies legacy product endpoints', async () => {
  const r = await user('cashier', 'receptionqa')
  await expect(
    cmd('service.save', { name: 'Unauthorized', price: 1, active: true }, r.token),
  ).rejects.toThrow()
  await expect(
    cmd('invoice.void', { id: ulid(), note: 'QA', method: 'cash', reference: 'QA' }, r.token),
  ).rejects.toThrow()
  for (const a of [
    'invoice.post',
    'stock.adjust',
    'state',
    'inventory.state',
    'service-center.state',
  ])
    await expect(e.call(a, {}, t)).rejects.toThrow()
})
it('doctor role is accepted only in Clinic and admin role cannot be removed last', async () => {
  const other = openDatabase(':memory:')
  try {
    const b = new BusinessEngine(other)
    const token = (
      (await b.call('setup', {
        businessName: 'QA',
        name: 'QA',
        username: 'owner',
        password: pass,
      })) as any
    ).token
    await expect(
      b.call(
        'user.save',
        { name: 'QA doctor', username: 'doctorqa', role: 'doctor', active: true, password: pass },
        token,
      ),
    ).rejects.toThrow()
  } finally {
    other.close()
  }
  await user('doctor', 'doctorqa')
  const admin = (db.prepare("SELECT id FROM users WHERE role='admin'").get() as any).id
  await expect(
    e.call(
      'user.save',
      { id: admin, name: 'Owner', username: 'owner', role: 'doctor', active: true },
      t,
    ),
  ).rejects.toThrow()
})
it('no-show and cancellation are terminal and visit prevents inappropriate transitions', async () => {
  const a = await booking()
  vi.setSystemTime(new Date(Date.UTC(2030, 0, 1, 8, 31)))
  await cmd('appointment.status', { id: a.id, version: 0, status: 'no_show', note: 'Absent QA' })
  await expect(
    cmd('appointment.status', { id: a.id, version: 1, status: 'checked_in', note: 'Late QA' }),
  ).rejects.toThrow()
  const b = await booking()
  await cmd('appointment.status', { id: b.id, version: 0, status: 'checked_in', note: 'Arrived' })
  await cmd('visit.open', { appointmentId: b.id })
  await expect(
    cmd('appointment.status', { id: b.id, version: 1, status: 'cancelled', note: 'Cancel' }),
  ).rejects.toThrow()
})

it('uses local calendar midnight for reports rather than UTC midnight', async () => {
  vi.setSystemTime(new Date(2030, 0, 1, 0, 30))
  try {
    t = ((await e.call('login', { username: 'owner', password: pass })) as any).token
    const a = await booking({ start: new Date(2030, 0, 1, 0, 30).getTime() })
    await cmd('invoice.post', {
      appointmentId: a.id,
      lines: [{ serviceId: service, qty: 1, price: 100 }],
      discount: 0,
      taxBps: 0,
    })
    const r = await rpc('report', { from: '2030-01-01', to: '2030-01-01' })
    expect(r.revenue).toBe(100)
    expect(r.appointments).toEqual([{ status: 'scheduled', count: 1 }])
    expect((await rpc('report', { from: '2029-12-31', to: '2029-12-31' })).invoices).toEqual([])
  } finally {
    vi.useRealTimers()
  }
})
it('rejects replacement as well as update/delete of finalized clinical rows', async () => {
  const a = await booking()
  await cmd('appointment.status', { id: a.id, version: 0, status: 'checked_in', note: 'Arrived' })
  const v = await cmd('visit.open', { appointmentId: a.id })
  await cmd('visit.save', {
    id: v.id,
    version: 0,
    complaint: 'QA',
    assessment: 'QA assessment',
    plan: 'QA plan',
  })
  await cmd('visit.finalize', { id: v.id, version: 1 })
  expect(() =>
    db
      .prepare(
        "INSERT OR REPLACE INTO clinic_visit_final SELECT visit_id,user_id,at,patient_snapshot,doctor_snapshot,complaint,'tamper',plan FROM clinic_visit_final",
      )
      .run(),
  ).toThrow()
  expect((await rpc('visit.get', { id: v.id })).visit.assessment).toBe('QA assessment')
})

it('does not mark absent before the end or check in a distant future appointment', async () => {
  const a = await booking()
  await expect(
    cmd('appointment.status', { id: a.id, version: 0, status: 'no_show', note: 'Premature QA' }),
  ).rejects.toThrow(/انتهاء/)
  await cmd('appointment.status', { id: a.id, version: 0, status: 'cancelled', note: 'Cancel QA' })
  const b = await booking({ start: Date.UTC(2030, 0, 1, 9, 1) })
  await expect(
    cmd('appointment.status', { id: b.id, version: 0, status: 'checked_in', note: 'Premature QA' }),
  ).rejects.toThrow(/ساعة/)
  expect((await rpc('appointment.get', { id: b.id })).appointment.status).toBe('scheduled')
})
