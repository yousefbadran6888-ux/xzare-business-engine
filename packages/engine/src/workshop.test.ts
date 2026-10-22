import { beforeEach, afterEach, it, expect } from 'vitest'
import { openDatabase, type XzareDatabase } from '@xzare/db'
import { BusinessEngine } from './service.js'
import { ulid } from '@xzare/core'
let db: XzareDatabase,
  e: BusinessEngine,
  t: string,
  w: string,
  part: string,
  vehicle: string,
  tech: string
const rpc = (action: string, p: unknown = {}): Promise<any> => e.call('workshop.' + action, p, t)
const cmd = (action: string, p: Record<string, unknown> = {}) =>
  rpc(action, { clientTxnId: ulid(), ...p })
const receive = (qty = 2000, cost = 20000, extra: Record<string, unknown> = {}) =>
  e.call(
    'inventory.document.post',
    {
      clientTxnId: ulid(),
      kind: 'receipt',
      warehouseId: w,
      note: 'QA receive',
      lines: [{ variantId: part, qty, cost, batch: '', serial: '', ...extra }],
    },
    t,
  )
const order = (extra: Record<string, unknown> = {}) =>
  cmd('order.create', {
    vehicleId: vehicle,
    warehouseId: w,
    mileage: 1000,
    complaint: 'Noise QA',
    dueDate: '2030-01-01',
    ...extra,
  })
const estimate = (id: string, extra: Record<string, unknown> = {}) =>
  cmd('estimate.create', {
    id,
    diagnosis: 'QA repair',
    parts: [{ variantId: part, qty: 2000, price: 20000 }],
    services: [{ description: 'QA labor', qty: 1000, price: 10000 }],
    discount: 0,
    taxBps: 0,
    ...extra,
  })
const approve = async (id: string) =>
  cmd('order.approve', {
    id,
    estimateId: (await rpc('order.get', { id })).order.estimateId,
    technicianId: tech,
    note: 'Customer QA approval',
  })
const ready = (id: string) =>
  cmd('order.ready', { id, mileageOut: 1100, laborCost: 5000, note: 'QA inspected' })
beforeEach(async () => {
  db = openDatabase(':memory:', 'workshop' as any)
  e = new BusinessEngine(db, 'workshop' as any)
  t = (
    (await e.call('setup', {
      businessName: 'Workshop QA',
      name: 'QA owner',
      username: 'owner',
      password: 'Workshop-qa-password-123!',
    })) as any
  ).token
  w = (db.prepare('SELECT id FROM warehouses LIMIT 1').get() as any).id
  part = (
    (await e.call(
      'product.save',
      {
        name: 'QA part',
        sku: 'WS-PART',
        unit: 'piece',
        price: 20000,
        reorderQty: 0,
        barcode: 'WS-PART',
        format: 'CODE128',
      },
      t,
    )) as any
  ).id
  vehicle = (
    await cmd('vehicle.save', {
      customer: 'QA customer',
      phone: '01000000000',
      plate: 'QA-001',
      vin: '',
      make: 'QA make',
      model: 'QA model',
      year: 2020,
      mileage: 1000,
    })
  ).id
  tech = (await cmd('technician.save', { name: 'QA tech', phone: '', active: true })).id
})
afterEach(() => db?.close())
it('starts empty, stores real vehicles and technicians, prevents duplicate plate or VIN', async () => {
  const s = await rpc('state')
  expect(s.orders).toEqual([])
  expect(s.vehicles).toHaveLength(1)
  await expect(
    cmd('vehicle.save', {
      customer: 'Duplicate',
      phone: '',
      plate: 'qa-001',
      vin: '',
      make: '',
      model: '',
      year: 2020,
      mileage: 0,
    }),
  ).rejects.toThrow()
  expect(s.settings.license).toBeUndefined()
  expect(s.reconciled).toBe(true)
})
it('preserves vehicle and estimate snapshots and accepts latest revision only', async () => {
  const o = await order()
  const a = await estimate(o.id)
  await estimate(o.id, { services: [{ description: 'Changed', qty: 1000, price: 20000 }] })
  const accepted = await approve(o.id)
  expect(accepted.order.estimateId).not.toBe(a.id)
  expect(accepted.order.total).toBe(60000)
  await cmd('vehicle.save', {
    id: vehicle,
    customer: 'Changed customer',
    phone: '',
    plate: 'QA-001',
    vin: '',
    make: '',
    model: '',
    year: 2020,
    mileage: 1000,
  })
  expect((await rpc('order.get', { id: o.id })).order.vehicle.customer).toBe('QA customer')
  await expect(estimate(o.id)).rejects.toThrow()
  expect(() => db.prepare('UPDATE workshop_estimates SET total=1').run()).toThrow()
})
it('posts stock once, preserves cost, accepts payments once and delivers only after full payment', async () => {
  await receive()
  const o = await order()
  await estimate(o.id)
  await approve(o.id)
  const p = { id: o.id, clientTxnId: ulid() }
  const a = await rpc('order.start', p)
  expect(a.order.partsCost).toBe(20000)
  expect(await rpc('order.start', p)).toEqual(a)
  expect((await rpc('state')).balances[0].qty).toBe(0)
  await ready(o.id)
  await expect(cmd('order.deliver', { id: o.id, note: 'QA handover' })).rejects.toThrow(/تحصيل/)
  const payment = {
    id: o.id,
    amount: 20000,
    method: 'cash',
    reference: 'Receipt QA',
    clientTxnId: ulid(),
  }
  await rpc('order.pay', payment)
  await rpc('order.pay', payment)
  await expect(
    cmd('order.pay', { id: o.id, amount: 40000, method: 'cash', reference: 'Overpay QA' }),
  ).rejects.toThrow()
  await cmd('order.pay', { id: o.id, amount: 30000, method: 'bank', reference: 'Transfer QA' })
  const done = await cmd('order.deliver', { id: o.id, note: 'Customer received QA' })
  expect(done.order).toMatchObject({
    status: 'delivered',
    total: 50000,
    paid: 50000,
    partsCost: 20000,
    laborCost: 5000,
  })
  expect(done.payments).toHaveLength(2)
  expect(done.events.map((x: any) => x.status)).toEqual([
    'received',
    'estimated',
    'approved',
    'in_progress',
    'ready',
    'delivered',
  ])
  const report = await rpc('report', { from: '2020-01-01', to: '2099-01-01' })
  expect(report.revenue).toBe(50000)
  expect(report.collected).toBe(50000)
  expect(report.cost).toBe(25000)
  expect(report.margin).toBe(25000)
  expect(report.receivable).toBe(0)
})
it('shortage and stale reconciliation roll back order and stock atomically; FEFO excludes expired', async () => {
  await receive(1000, 100, { batch: 'EXPIRED', expiry: '2020-01-01' })
  await receive(1000, 200, { batch: 'FRESH', expiry: '2099-01-01' })
  const o = await order()
  await estimate(o.id)
  await approve(o.id)
  const before = (await rpc('state')).documents.length
  await expect(cmd('order.start', { id: o.id })).rejects.toThrow()
  expect((await rpc('order.get', { id: o.id })).order.status).toBe('approved')
  expect((await rpc('state')).documents.length).toBe(before)
  await receive(1000, 300, { batch: 'EARLY', expiry: '2090-01-01' })
  db.prepare('UPDATE stock_levels SET qty=9999').run()
  await expect(cmd('order.start', { id: o.id })).rejects.toThrow()
  db.prepare('UPDATE stock_levels SET qty=3000').run()
  const started = await cmd('order.start', { id: o.id })
  expect(started.allocations.map((x: any) => x.batch)).toEqual(['EARLY', 'FRESH'])
  expect(started.order.partsCost).toBe(500)
})
it('serial parts cannot be consumed fractionally; service only work has no inventory issue', async () => {
  await receive(1000, 100, { serial: 'QA-SERIAL' })
  const o = await order()
  await estimate(o.id, { parts: [{ variantId: part, qty: 500, price: 100 }] })
  await approve(o.id)
  await expect(cmd('order.start', { id: o.id })).rejects.toThrow()
  await cmd('order.cancel', { id: o.id, note: 'QA cancel' })
  const second = await order()
  await estimate(second.id, { parts: [] })
  await approve(second.id)
  const started = await cmd('order.start', { id: second.id })
  expect(started.order.issueId).toBeNull()
  expect(started.allocations).toEqual([])
})
it('rounds milli quantities and taxes exactly and rejects discount, overflow and malformed input', async () => {
  const o = await order()
  const x = await estimate(o.id, {
    parts: [],
    services: [{ description: 'Fraction QA', qty: 1500, price: 101 }],
    discount: 2,
    taxBps: 1400,
  })
  expect(x).toMatchObject({ subtotal: 152, discount: 2, tax: 21, total: 171 })
  await expect(estimate(o.id, { discount: 60000 })).rejects.toThrow()
  await expect(estimate(o.id, { parts: [], services: [] })).rejects.toThrow()
  await expect(
    estimate(o.id, { parts: [], services: [{ description: 'Too big', qty: 1e12, price: 1e12 }] }),
  ).rejects.toThrow()
  await expect(order({ dueDate: '2030-02-30' })).rejects.toThrow()
})
it('guards transitions, active technicians, vehicle mileage and single open job', async () => {
  const o = await order()
  await expect(order()).rejects.toThrow()
  await expect(ready(o.id)).rejects.toThrow()
  await expect(cmd('order.start', { id: o.id })).rejects.toThrow()
  await estimate(o.id)
  await approve(o.id)
  await cmd('technician.save', { id: tech, name: 'QA tech', phone: '', active: false })
  await expect(cmd('order.start', { id: o.id })).rejects.toThrow()
  await cmd('technician.save', { id: tech, name: 'QA tech', phone: '', active: true })
  await receive()
  await cmd('order.start', { id: o.id })
  await expect(cmd('order.cancel', { id: o.id, note: 'Cannot undo' })).rejects.toThrow()
  await expect(
    cmd('order.ready', { id: o.id, mileageOut: 999, laborCost: 0, note: 'Wrong mileage' }),
  ).rejects.toThrow()
  await ready(o.id)
  await cmd('order.pay', { id: o.id, amount: 50000, method: 'cash', reference: 'QA full' })
  await cmd('order.deliver', { id: o.id, note: 'QA done' })
  await expect(order({ mileage: 1000 })).rejects.toThrow()
  expect(() => db.prepare('DELETE FROM workshop_orders').run()).toThrow()
  expect(() => db.prepare('UPDATE workshop_payments SET amount=0').run()).toThrow()
})
it('binds all writes to actor and payload and rejects legacy foreign operations', async () => {
  const payload = {
    vehicleId: vehicle,
    warehouseId: w,
    mileage: 1000,
    complaint: 'QA',
    dueDate: '2030-01-01',
    clientTxnId: ulid(),
  }
  const o = await rpc('order.create', payload)
  expect(await rpc('order.create', payload)).toEqual(o)
  await expect(rpc('order.create', { ...payload, complaint: 'Changed' })).rejects.toThrow()
  await e.call(
    'user.save',
    {
      name: 'Other manager',
      username: 'manager',
      password: 'Manager-workshop-123!',
      role: 'manager',
      active: true,
    },
    t,
  )
  t = ((await e.call('login', { username: 'manager', password: 'Manager-workshop-123!' })) as any)
    .token
  await expect(rpc('order.create', payload)).rejects.toThrow()
  for (const action of [
    'invoice.post',
    'stock.adjust',
    'state',
    'manufacturing.state',
    'accounting.state',
    'restaurant.state',
  ])
    await expect(e.call(action, {}, t)).rejects.toThrow()
})
it('view-only users cannot write or get private users/license secrets', async () => {
  await e.call(
    'user.save',
    {
      name: 'Viewer',
      username: 'viewer',
      password: 'Viewer-workshop-123!',
      role: 'cashier',
      active: true,
    },
    t,
  )
  t = ((await e.call('login', { username: 'viewer', password: 'Viewer-workshop-123!' })) as any)
    .token
  expect((await rpc('state')).users).toEqual([])
  await expect(order()).rejects.toThrow()
  await expect(
    cmd('vehicle.save', {
      customer: 'No',
      phone: '',
      plate: 'QA-2',
      vin: '',
      make: '',
      model: '',
      year: 2020,
      mileage: 0,
    }),
  ).rejects.toThrow()
})
it('does not allow changing the unit of a quoted or stocked part', async () => {
  const o = await order()
  await estimate(o.id)
  await expect(
    e.call(
      'product.save',
      {
        id: part,
        name: 'QA part',
        sku: 'WS-PART',
        unit: 'kg',
        price: 20000,
        reorderQty: 0,
        barcode: 'WS-PART',
        format: 'CODE128',
      },
      t,
    ),
  ).rejects.toThrow()
})

it('returns the full selected vehicle history and guards anonymous history access', async () => {
  const o = await order()
  await cmd('order.cancel', { id: o.id, note: 'QA cancelled' })
  await order()
  expect((await rpc('vehicle.history', { id: vehicle })).orders).toHaveLength(2)
  await expect(e.call('workshop.vehicle.history', { id: vehicle }, null)).rejects.toThrow()
})

it('rejects approval when the displayed estimate changed before customer acceptance', async () => {
  const o = await order()
  const displayed = await estimate(o.id)
  await estimate(o.id, { services: [{ description: 'Changed terms', qty: 1000, price: 99900 }] })
  await expect(
    cmd('order.approve', {
      id: o.id,
      estimateId: displayed.id,
      technicianId: tech,
      note: 'Customer accepted displayed terms',
    }),
  ).rejects.toThrow(/عرض/)
  expect((await rpc('order.get', { id: o.id })).order.status).toBe('estimated')
})
