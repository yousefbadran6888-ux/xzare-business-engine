import { beforeEach, afterEach, it, expect } from 'vitest'
import { openDatabase, type XzareDatabase } from '@xzare/db'
import { BusinessEngine } from './service.js'
import { ulid } from '@xzare/core'
let db: XzareDatabase, e: BusinessEngine, t: string, w: string, raw: string, finished: string
const rpc = (action: string, p: unknown = {}): Promise<any> =>
  e.call('manufacturing.' + action, p, t)
const cmd = (action: string, p: Record<string, unknown> = {}) =>
  rpc(action, { clientTxnId: ulid(), ...p })
const receive = (qty: number, cost: number, extra: Record<string, unknown> = {}) =>
  e.call(
    'inventory.document.post',
    {
      clientTxnId: ulid(),
      kind: 'receipt',
      warehouseId: w,
      note: 'QA receive',
      lines: [{ variantId: raw, qty, cost, batch: '', serial: '', ...extra }],
    },
    t,
  )
const bom = (extra: Record<string, unknown> = {}) =>
  cmd('bom.create', {
    outputVariantId: finished,
    yieldQty: 1000,
    name: 'QA recipe',
    components: [{ variantId: raw, qty: 2000, wasteBps: 0 }],
    ...extra,
  })
const order = (bomId: string, qty = 5000, extra: Record<string, unknown> = {}) =>
  cmd('order.create', {
    bomId,
    qty,
    warehouseId: w,
    destinationId: w,
    dueDate: '2030-01-01',
    note: 'QA order',
    ...extra,
  })
beforeEach(async () => {
  db = openDatabase(':memory:', 'manufacturing' as any)
  e = new BusinessEngine(db, 'manufacturing' as any)
  t = (
    (await e.call('setup', {
      businessName: 'Manufacturing QA',
      name: 'QA owner',
      username: 'owner',
      password: 'Manufacturing-qa-password-123!',
    })) as any
  ).token
  w = (db.prepare('SELECT id FROM warehouses LIMIT 1').get() as any).id
  const item = async (name: string, sku: string) =>
    (
      (await e.call(
        'product.save',
        { name, sku, unit: 'piece', price: 0, reorderQty: 0, barcode: sku, format: 'CODE128' },
        t,
      )) as any
    ).id
  raw = await item('QA material', 'MFG-RAW')
  finished = await item('QA finished', 'MFG-OUTPUT')
})
afterEach(() => db?.close())
it('starts empty and freezes BOM revisions, rejects duplicate/self/cyclic recipes', async () => {
  expect((await rpc('state')).boms).toEqual([])
  const b = await bom(),
    o = await order(b.id)
  const b2 = await bom({ components: [{ variantId: raw, qty: 3000, wasteBps: 1000 }] })
  expect(b2.revision).toBe(2)
  expect((await rpc('order.get', { id: o.id })).requirements[0].qty).toBe(10000)
  await expect(
    bom({ components: [{ variantId: finished, qty: 1000, wasteBps: 0 }] }),
  ).rejects.toThrow()
  await expect(
    bom({
      components: [
        { variantId: raw, qty: 1000, wasteBps: 0 },
        { variantId: raw, qty: 2000, wasteBps: 0 },
      ],
    }),
  ).rejects.toThrow()
  await expect(
    bom({ outputVariantId: raw, components: [{ variantId: finished, qty: 1000, wasteBps: 0 }] }),
  ).rejects.toThrow()
  expect(() => db.prepare('UPDATE manufacturing_bom_lines SET qty=1').run()).toThrow()
})
it('consumes once into WIP and conserves actual cost through good output and scrap', async () => {
  const b = await bom()
  await receive(10000, 10001)
  const o = await order(b.id)
  const start = { id: o.id, clientTxnId: ulid() }
  const started = await rpc('order.start', start)
  expect(started.order).toMatchObject({ status: 'started', materialCost: 10001 })
  expect(await rpc('order.start', start)).toEqual(started)
  expect((await rpc('state')).wipValue).toBe(10001)
  const payload = {
    id: o.id,
    goodQty: 4000,
    scrapQty: 1000,
    laborCost: 200,
    overheadCost: 100,
    batch: 'PROD-1',
    serials: [],
    note: 'QA close',
    clientTxnId: ulid(),
  }
  const closed = await rpc('order.complete', payload)
  expect(closed.order).toMatchObject({
    status: 'completed',
    goodQty: 4000,
    scrapQty: 1000,
    totalCost: 10301,
    writeoffCost: 0,
  })
  expect(await rpc('order.complete', payload)).toEqual(closed)
  const s = await rpc('state')
  expect(s.wipValue).toBe(0)
  expect(s.reconciled).toBe(true)
  expect(s.balances.filter((x: any) => x.variantId === finished)).toMatchObject([
    { qty: 4000, cost: 10301 },
  ])
  expect(s.balances.find((x: any) => x.variantId === raw).qty).toBe(0)
  expect(closed.events.map((x: any) => x.status)).toEqual(['planned', 'started', 'completed'])
})
it('rejects shortages atomically and only consumes usable FEFO lots', async () => {
  const b = await bom()
  await receive(4000, 400, { batch: 'EXPIRED', expiry: '2020-01-01' })
  await receive(1000, 100, { batch: 'FRESH', expiry: '2099-01-01' })
  const o = await order(b.id, 1000)
  const before = (await rpc('state')).documents.length
  await expect(cmd('order.start', { id: o.id })).rejects.toThrow()
  expect((await rpc('order.get', { id: o.id })).order.status).toBe('planned')
  expect((await rpc('state')).documents.length).toBe(before)
  await receive(1000, 200, { batch: 'EARLY', expiry: '2090-01-01' })
  const result = await cmd('order.start', { id: o.id })
  expect(result.allocations.map((a: any) => a.batch)).toEqual(['EARLY', 'FRESH'])
  expect(result.order.materialCost).toBe(300)
  expect((await rpc('state')).balances.find((x: any) => x.batch === 'EXPIRED').qty).toBe(4000)
})
it('MRP aggregates planned gross requirements by actual source warehouse', async () => {
  const b = await bom()
  await receive(5000, 500)
  const a = await order(b.id),
    z = await order(b.id)
  let r = await rpc('mrp')
  expect(r.rows).toMatchObject([
    { variantId: raw, warehouseId: w, requiredQty: 20000, availableQty: 5000, shortageQty: 15000 },
  ])
  await cmd('order.cancel', { id: z.id, note: 'QA cancelled' })
  r = await rpc('mrp')
  expect(r.rows[0].shortageQty).toBe(5000)
  expect((await rpc('order.get', { id: a.id })).order.status).toBe('planned')
})
it('ceil rounds material allowance exactly and rejects unsafe quantities', async () => {
  const b = await bom({
    yieldQty: 3000,
    components: [{ variantId: raw, qty: 1001, wasteBps: 1000 }],
  })
  const o = await order(b.id, 1000)
  expect((await rpc('order.get', { id: o.id })).requirements[0].qty).toBe(368)
  await expect(order(b.id, 1000000000001)).rejects.toThrow()
  await expect(bom({ yieldQty: 0 })).rejects.toThrow()
})
it('requires valid transitions and explicit good plus scrap, all-scrap writes off cost', async () => {
  const b = await bom()
  await receive(2000, 500)
  const o = await order(b.id, 1000)
  const close = {
    id: o.id,
    goodQty: 1000,
    scrapQty: 0,
    laborCost: 0,
    overheadCost: 0,
    batch: 'X',
    serials: [],
    note: 'QA',
  }
  await expect(cmd('order.complete', close)).rejects.toThrow()
  await cmd('order.start', { id: o.id })
  await expect(
    cmd('order.cancel', { id: o.id, note: 'cannot undo consumed material' }),
  ).rejects.toThrow()
  await expect(cmd('order.complete', { ...close, goodQty: 500 })).rejects.toThrow()
  const done = await cmd('order.complete', { ...close, goodQty: 0, scrapQty: 1000, laborCost: 50 })
  expect(done.order).toMatchObject({ totalCost: 550, writeoffCost: 550, goodQty: 0 })
  expect((await rpc('state')).balances.filter((x: any) => x.variantId === finished)).toHaveLength(0)
  expect(() => db.prepare("UPDATE manufacturing_events SET status='planned'").run()).toThrow()
})
it('serial components cannot be fractionally consumed and completion rolls back duplicate serial output', async () => {
  const b = await bom({ components: [{ variantId: raw, qty: 1000, wasteBps: 0 }] })
  await receive(1000, 100, { serial: 'MAT-S1' })
  await receive(1000, 100, { serial: 'MAT-S2' })
  const o = await order(b.id, 1500)
  await expect(cmd('order.start', { id: o.id })).rejects.toThrow()
  expect((await rpc('state')).balances.reduce((n: number, x: any) => n + x.qty, 0)).toBe(2000)
  const good = await order(b.id, 2000)
  await cmd('order.start', { id: good.id })
  await expect(
    cmd('order.complete', {
      id: good.id,
      goodQty: 2000,
      scrapQty: 0,
      laborCost: 0,
      overheadCost: 0,
      batch: '',
      serials: ['NEW', 'MAT-S1'],
      note: 'QA conflict',
    }),
  ).rejects.toThrow()
  expect((await rpc('order.get', { id: good.id })).order.status).toBe('started')
  expect((await rpc('state')).balances.filter((x: any) => x.variantId === finished)).toHaveLength(0)
  const done = await cmd('order.complete', {
    id: good.id,
    goodQty: 2000,
    scrapQty: 0,
    laborCost: 0,
    overheadCost: 0,
    batch: '',
    serials: ['NEW-1', 'NEW-2'],
    note: 'QA',
  })
  expect(done.order.totalCost).toBe(200)
  expect(
    (await rpc('state')).balances
      .filter((x: any) => x.variantId === finished)
      .reduce((n: number, x: any) => n + x.cost, 0),
  ).toBe(200)
})
it('view-only users cannot write or see private license/identity metadata', async () => {
  const b = await bom()
  await e.call(
    'user.save',
    {
      name: 'QA viewer',
      username: 'viewer',
      password: 'Viewer-manufacturing-123!',
      role: 'cashier',
      active: true,
    },
    t,
  )
  t = (
    (await e.call('login', { username: 'viewer', password: 'Viewer-manufacturing-123!' })) as any
  ).token
  const s = await rpc('state')
  expect(s.users).toHaveLength(0)
  expect(s.settings.license).toBeUndefined()
  await expect(order(b.id)).rejects.toThrow()
  await expect(bom()).rejects.toThrow()
  await expect(
    e.call('inventory.warehouse.save', { name: 'unauthorized', clientTxnId: ulid() }, t),
  ).rejects.toThrow()
})
it('blocks unrelated sales/accounting routes and detects stale stock reconciliation', async () => {
  await expect(e.call('invoice.post', {}, t)).rejects.toThrow()
  await expect(e.call('stock.adjust', {}, t)).rejects.toThrow()
  await expect(e.call('accounting.state', {}, t)).rejects.toThrow()
  await expect(e.call('state', {}, t)).rejects.toThrow()
  const b = await bom()
  await receive(2000, 100)
  const o = await order(b.id, 1000)
  db.prepare('UPDATE stock_levels SET qty=9999').run()
  await expect(cmd('order.start', { id: o.id })).rejects.toThrow()
  expect((await rpc('order.get', { id: o.id })).order.status).toBe('planned')
})
it('full cost report filters dates and retains history beyond current stock', async () => {
  const b = await bom()
  await receive(2000, 100)
  const o = await order(b.id, 1000)
  await cmd('order.start', { id: o.id })
  await cmd('order.complete', {
    id: o.id,
    goodQty: 1000,
    scrapQty: 0,
    laborCost: 20,
    overheadCost: 30,
    batch: 'REPORT',
    serials: [],
    note: 'QA',
  })
  const r = await rpc('report', { from: '2020-01-01', to: '2099-01-01' })
  expect(r.rows).toHaveLength(1)
  expect(r.rows[0]).toMatchObject({
    totalCost: 150,
    materialCost: 100,
    laborCost: 20,
    overheadCost: 30,
  })
  expect((await rpc('report', { from: '2020-01-01', to: '2020-01-02' })).rows).toHaveLength(0)
})

it('prevents unit reinterpretation after a BOM or material movement uses the variant', async () => {
  await bom()
  await expect(
    e.call(
      'product.save',
      {
        id: raw,
        name: 'QA material',
        sku: 'MFG-RAW',
        unit: 'kg',
        price: 0,
        reorderQty: 0,
        barcode: 'MFG-RAW',
        format: 'CODE128',
      },
      t,
    ),
  ).rejects.toThrow()
  expect((await rpc('state')).products.find((p: any) => p.id === raw).unit).toBe('piece')
})
it('binds a replay to identical data and the original authorized actor', async () => {
  const payload = {
    outputVariantId: finished,
    yieldQty: 1000,
    name: 'Replay QA',
    components: [{ variantId: raw, qty: 1000, wasteBps: 0 }],
    clientTxnId: ulid(),
  }
  await rpc('bom.create', payload)
  await expect(rpc('bom.create', { ...payload, name: 'Changed' })).rejects.toThrow()
  await e.call(
    'user.save',
    {
      name: 'Other manager',
      username: 'manager',
      password: 'Manager-manufacturing-123!',
      role: 'manager',
      active: true,
    },
    t,
  )
  t = (
    (await e.call('login', { username: 'manager', password: 'Manager-manufacturing-123!' })) as any
  ).token
  await expect(rpc('bom.create', payload)).rejects.toThrow()
  expect((await rpc('state')).boms).toHaveLength(1)
})

it('checks every still-selectable historical BOM revision for cycles', async () => {
  await bom()
  const third = (
    (await e.call(
      'product.save',
      {
        name: 'Third QA',
        sku: 'MFG-THIRD',
        unit: 'piece',
        price: 0,
        reorderQty: 0,
        barcode: 'MFG-THIRD',
        format: 'CODE128',
      },
      t,
    )) as any
  ).id
  await bom({ components: [{ variantId: third, qty: 1000, wasteBps: 0 }] })
  await expect(
    bom({ outputVariantId: raw, components: [{ variantId: finished, qty: 1000, wasteBps: 0 }] }),
  ).rejects.toThrow(/دورة/)
  expect((await rpc('state')).boms).toHaveLength(2)
})
