import { beforeEach, afterEach, it, expect } from 'vitest'
import { openDatabase, type XzareDatabase } from '@xzare/db'
import { BusinessEngine } from './service.js'
import { ulid } from '@xzare/core'
let db: XzareDatabase,
  e: BusinessEngine,
  t: string,
  w: string,
  part: string,
  device: string,
  tech: string
const rpc = (action: string, p: unknown = {}): Promise<any> =>
  e.call('service-center.' + action, p, t)
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
    deviceId: device,
    warehouseId: w,
    condition: 'QA external condition',
    accessories: 'QA charger',
    complaint: 'Noise QA',
    dueDate: '2030-01-01',
    ...extra,
  })
const estimate = (id: string, extra: Record<string, unknown> = {}) =>
  cmd('estimate.create', {
    id,
    diagnosis: 'QA repair',
    warrantyDays: 30,
    warrantyTerms: 'Repaired fault only',
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
const ready = (id: string) => cmd('order.ready', { id, laborCost: 5000, note: 'QA inspected' })
beforeEach(async () => {
  db = openDatabase(':memory:', 'service-center' as any)
  e = new BusinessEngine(db, 'service-center' as any)
  t = (
    (await e.call('setup', {
      businessName: 'ServiceCenter QA',
      name: 'QA owner',
      username: 'owner',
      password: 'ServiceCenter-qa-password-123!',
    })) as any
  ).token
  w = (db.prepare('SELECT id FROM warehouses LIMIT 1').get() as any).id
  part = (
    (await e.call(
      'product.save',
      {
        name: 'QA part',
        sku: 'SC-PART',
        unit: 'piece',
        price: 20000,
        reorderQty: 0,
        barcode: 'SC-PART',
        format: 'CODE128',
      },
      t,
    )) as any
  ).id
  device = (
    await cmd('device.save', {
      customer: 'QA customer',
      phone: '01000000000',
      serial: 'QA-001',
      type: 'phone',
      brand: 'QA brand',
      model: 'QA model',
    })
  ).id
  tech = (await cmd('technician.save', { name: 'QA tech', phone: '', active: true })).id
})
afterEach(() => db?.close())
it('starts empty, stores real devices and technicians, prevents duplicate normalized serial', async () => {
  const s = await rpc('state')
  expect(s.orders).toEqual([])
  expect(s.devices).toHaveLength(1)
  await expect(
    cmd('device.save', {
      customer: 'Duplicate',
      phone: '',
      serial: 'qa-001',
      type: 'phone',
      brand: '',
      model: '',
    }),
  ).rejects.toThrow()
  expect(s.settings.license).toBeUndefined()
  expect(s.reconciled).toBe(true)
})
it('preserves device and estimate snapshots and accepts latest revision only', async () => {
  const o = await order()
  const a = await estimate(o.id)
  await estimate(o.id, { services: [{ description: 'Changed', qty: 1000, price: 20000 }] })
  const accepted = await approve(o.id)
  expect(accepted.order.estimateId).not.toBe(a.id)
  expect(accepted.order.total).toBe(60000)
  await cmd('device.save', {
    id: device,
    customer: 'Changed customer',
    phone: '',
    serial: 'QA-001',
    type: 'phone',
    brand: '',
    model: '',
  })
  expect((await rpc('order.get', { id: o.id })).order.device.customer).toBe('QA customer')
  await expect(estimate(o.id)).rejects.toThrow()
  expect(() => db.prepare('UPDATE service_center_estimates SET total=1').run()).toThrow()
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
it('guards transitions, active technicians and single open device job', async () => {
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
  await expect(cmd('order.cancel', { id: o.id, note: 'Cannot undo stock' })).rejects.toThrow()
  await ready(o.id)
  await cmd('order.pay', { id: o.id, amount: 50000, method: 'cash', reference: 'QA full' })
  await cmd('order.deliver', { id: o.id, note: 'QA done' })
  expect(() => db.prepare('DELETE FROM service_center_orders').run()).toThrow()
  expect(() => db.prepare('UPDATE service_center_payments SET amount=0').run()).toThrow()
})
it('binds all writes to actor and payload and rejects legacy foreign operations', async () => {
  const payload = {
    deviceId: device,
    warehouseId: w,
    condition: 'QA external condition',
    accessories: 'QA charger',
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
      password: 'Manager-service-center-123!',
      role: 'manager',
      active: true,
    },
    t,
  )
  t = (
    (await e.call('login', { username: 'manager', password: 'Manager-service-center-123!' })) as any
  ).token
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
      password: 'Viewer-service-center-123!',
      role: 'cashier',
      active: true,
    },
    t,
  )
  t = (
    (await e.call('login', { username: 'viewer', password: 'Viewer-service-center-123!' })) as any
  ).token
  expect((await rpc('state')).users).toEqual([])
  await expect(order()).rejects.toThrow()
  await expect(
    cmd('device.save', {
      customer: 'No',
      phone: '',
      serial: 'QA-2',
      type: 'phone',
      brand: '',
      model: '',
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
        sku: 'SC-PART',
        unit: 'kg',
        price: 20000,
        reorderQty: 0,
        barcode: 'SC-PART',
        format: 'CODE128',
      },
      t,
    ),
  ).rejects.toThrow()
})

it('returns the full selected device history and guards anonymous history access', async () => {
  const o = await order()
  await cmd('order.cancel', { id: o.id, note: 'QA cancelled' })
  await order()
  expect((await rpc('device.history', { id: device })).orders).toHaveLength(2)
  await expect(e.call('service-center.device.history', { id: device }, null)).rejects.toThrow()
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

const completed = async () => {
  await receive(4000, 40000)
  const o = await order()
  await estimate(o.id)
  await approve(o.id)
  await cmd('order.start', { id: o.id })
  await ready(o.id)
  await cmd('order.pay', { id: o.id, amount: 50000, method: 'cash', reference: 'QA full' })
  return (await cmd('order.deliver', { id: o.id, note: 'QA handover' })).order
}
const claim = (parentId: string, extra: Record<string, unknown> = {}) =>
  cmd('warranty.create', {
    parentId,
    warehouseId: w,
    complaint: 'Same repaired fault returned',
    condition: 'QA no damage',
    accessories: 'QA charger',
    dueDate: '2030-01-01',
    coverageNote: 'Manager accepted the original covered defect',
    ...extra,
  })
it('keeps serial identity fixed once intake exists while freezing customer and intake facts', async () => {
  const o = await order()
  await expect(
    cmd('device.save', {
      id: device,
      customer: 'QA customer',
      phone: '',
      serial: 'DIFFERENT',
      type: 'phone',
      brand: 'QA',
      model: 'QA',
    }),
  ).rejects.toThrow(/السيريال/)
  await cmd('device.save', {
    id: device,
    customer: 'Updated owner',
    phone: '',
    serial: 'QA-001',
    type: 'phone',
    brand: 'QA',
    model: 'Updated',
  })
  const d = await rpc('order.get', { id: o.id })
  expect(d.order.device.customer).toBe('QA customer')
  expect(d.order.condition).toBe('QA external condition')
  expect(d.order.accessories).toBe('QA charger')
})
it('creates linked zero-charge covered repair, tracks actual costs without renewing warranty and replays once', async () => {
  const original = await completed()
  const p = {
    parentId: original.id,
    warehouseId: w,
    complaint: 'Same covered fault',
    condition: 'No damage',
    accessories: 'Charger',
    dueDate: '2030-01-01',
    coverageNote: 'Accepted defect',
    clientTxnId: ulid(),
  }
  const o = await rpc('warranty.create', p)
  expect(await rpc('warranty.create', p)).toEqual(o)
  expect(o).toMatchObject({ parentId: original.id, kind: 'warranty', deviceId: device })
  await expect(claim(original.id)).rejects.toThrow()
  await expect(estimate(o.id)).rejects.toThrow(/ضمان/)
  await estimate(o.id, {
    warrantyDays: 0,
    warrantyTerms: '',
    parts: [{ variantId: part, qty: 1000, price: 0 }],
    services: [{ description: 'Covered labor', qty: 1000, price: 0 }],
  })
  await approve(o.id)
  await cmd('order.start', { id: o.id })
  await cmd('order.ready', { id: o.id, laborCost: 1000, note: 'QA inspected covered repair' })
  await expect(
    cmd('order.pay', { id: o.id, amount: 1, method: 'cash', reference: 'No charge' }),
  ).rejects.toThrow()
  const done = (await cmd('order.deliver', { id: o.id, note: 'Covered handover' })).order
  expect(done).toMatchObject({ total: 0, paid: 0, partsCost: 10000, laborCost: 1000 })
  expect((await rpc('order.get', { id: original.id })).order.deliveredAt).toBe(original.deliveredAt)
  await expect(claim(done.id)).rejects.toThrow(/ضمان/)
  const report = await rpc('report', { from: '2020-01-01', to: '2099-01-01' })
  expect(report.warrantyCost).toBe(11000)
  expect(report.revenue).toBe(50000)
  expect(report.cost).toBe(36000)
  expect((await rpc('device.history', { id: device })).orders).toHaveLength(2)
})
it('rejects unapproved, expired and absent warranty plus malformed warranty terms', async () => {
  const o = await order()
  await expect(claim(o.id)).rejects.toThrow()
  await expect(estimate(o.id, { warrantyDays: 30, warrantyTerms: '' })).rejects.toThrow()
  await estimate(o.id, { parts: [], warrantyDays: 0, warrantyTerms: '' })
  await approve(o.id)
  await cmd('order.start', { id: o.id })
  await ready(o.id)
  await cmd('order.pay', { id: o.id, amount: 10000, method: 'cash', reference: 'QA full' })
  await cmd('order.deliver', { id: o.id, note: 'QA done' })
  await expect(claim(o.id)).rejects.toThrow(/ضمان/)
  const original = await completed()
  const at = original.deliveredAt
  const realNow = Date.now
  try {
    Date.now = () => at + 30 * 86400000 + 1
    await expect(claim(original.id)).rejects.toThrow(/انته/)
  } finally {
    Date.now = realNow
  }
})

it('keeps older open repair visible beyond the latest thousand closed orders', async () => {
  const old = await order()
  const insert = db.prepare(
    "INSERT INTO service_center_orders(id,number,device_id,device_snapshot,warehouse_id,condition,accessories,kind,parent_id,coverage_note,complaint,due_date,status,user_id,at) SELECT ?,?,device_id,device_snapshot,warehouse_id,condition,accessories,'repair',NULL,'',complaint,due_date,'cancelled',user_id,? FROM service_center_orders WHERE id=?",
  )
  db.transaction(() => {
    for (let i = 0; i < 1001; i++)
      insert.run(ulid(), 'SC-ARCHIVE-' + i, Date.now() + i + 1000, old.id)
  })()
  const state = await rpc('state')
  expect(state.orderCount).toBe(1002)
  expect(state.orders.filter((o: any) => o.status === 'received').map((o: any) => o.id)).toEqual([
    old.id,
  ])
})
