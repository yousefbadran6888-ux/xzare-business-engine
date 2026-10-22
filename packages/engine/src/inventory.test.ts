import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { openDatabase, type XzareDatabase } from '@xzare/db'
import { BusinessEngine } from './service.js'
import { ulid } from '@xzare/core'
let db: XzareDatabase, e: BusinessEngine, t: string, w: string, w2: string, v: string
const rpc = (a: string, p: unknown = {}): Promise<any> => e.call('inventory.' + a, p, t)
const document = (kind: string, lines: any[], extra = {}) =>
  rpc('document.post', {
    kind,
    warehouseId: w,
    note: 'Test operation',
    clientTxnId: ulid(),
    lines,
    ...extra,
  })
const line = (qty: number, extra = {}) => ({ variantId: v, qty, batch: '', serial: '', ...extra })
beforeEach(async () => {
  db = openDatabase(':memory:', 'inventory' as any)
  e = new BusinessEngine(db, 'inventory' as any)
  t = (
    (await e.call('setup', {
      businessName: 'Warehouse QA',
      name: 'Owner',
      username: 'owner',
      password: 'Inventory-test-password-123!',
    })) as any
  ).token
  w = (await rpc('state')).warehouses[0].id
  w2 = (await rpc('warehouse.save', { name: 'Second', clientTxnId: ulid() })).id
  v = (
    (await e.call(
      'product.save',
      {
        name: 'Item',
        sku: 'QA-01',
        unit: 'piece',
        price: 1000,
        reorderQty: 2000,
        barcode: 'INV-QA-001',
        format: 'CODE128',
      },
      t,
    )) as any
  ).id
})
afterEach(() => db?.close())
it('starts without fake stock, supports warehouse-specific conserved transfers and issues', async () => {
  expect((await rpc('state')).balances).toHaveLength(0)
  await document('receipt', [line(10000, { cost: 10001 })])
  await document('issue', [line(3000)])
  await document('transfer', [line(2000)], { destinationId: w2 })
  let s = await rpc('state')
  expect(s.balances.find((b: any) => b.warehouseId === w).qty).toBe(5000)
  expect(s.balances.find((b: any) => b.warehouseId === w2).qty).toBe(2000)
  expect(s.balances.reduce((n: number, b: any) => n + b.cost, 0)).toBe(7001)
  expect(s.reconciled).toBe(true)
  await document('issue', [line(5000)])
  expect((await rpc('state')).balances.find((b: any) => b.warehouseId === w).cost).toBe(0)
})
it('commits atomically and replays an actor-bound operation once', async () => {
  let p = {
    kind: 'receipt',
    warehouseId: w,
    note: 'receipt',
    clientTxnId: ulid(),
    lines: [line(1000, { cost: 100 })],
  }
  let a = await rpc('document.post', p)
  expect(await rpc('document.post', p)).toEqual(a)
  await expect(rpc('document.post', { ...p, note: 'changed' })).rejects.toThrow()
  await expect(document('issue', [line(1000), line(1000, { batch: 'missing' })])).rejects.toThrow()
  expect((await rpc('state')).balances[0].qty).toBe(1000)
  expect(db.prepare('SELECT count(*) n FROM inventory_documents').get()).toEqual({ n: 1 })
  expect(() => db.prepare('UPDATE inventory_entries SET qty=0').run()).toThrow()
})
it('rejects negative/fractional quantities, transfer to self and insufficient stock', async () => {
  await expect(document('receipt', [line(-1000, { cost: 100 })])).rejects.toThrow()
  await expect(document('receipt', [line(0.5, { cost: 100 })])).rejects.toThrow()
  await document('receipt', [line(1000, { cost: 100 })])
  await expect(document('transfer', [line(1000)], { destinationId: w })).rejects.toThrow()
  await expect(document('issue', [line(2000)])).rejects.toThrow()
})
it('tracks batches and rejects expired issues while allowing relocation', async () => {
  await document('receipt', [line(2000, { cost: 500, batch: 'OLD', expiry: '2020-01-01' })])
  await expect(document('issue', [line(1000, { batch: 'OLD' })])).rejects.toThrow()
  await document('transfer', [line(1000, { batch: 'OLD' })], { destinationId: w2 })
  expect((await rpc('state')).balances.filter((b: any) => b.batch === 'OLD')).toHaveLength(2)
  await expect(
    document('receipt', [line(1000, { cost: 100, batch: 'OLD', expiry: '2030-01-01' })]),
  ).rejects.toThrow()
})
it('serials represent one physical unit and cannot be duplicated or silently reused', async () => {
  await document('receipt', [line(1000, { cost: 500, serial: 'SN-1' })])
  await expect(document('receipt', [line(1000, { cost: 500, serial: 'SN-1' })])).rejects.toThrow()
  await expect(document('receipt', [line(2000, { cost: 500, serial: 'SN-2' })])).rejects.toThrow()
  await document('transfer', [line(1000, { serial: 'SN-1' })], { destinationId: w2 })
  await expect(document('issue', [line(1000, { serial: 'SN-1' })])).rejects.toThrow()
  await document('issue', [line(1000, { serial: 'SN-1' })], { warehouseId: w2 })
  await expect(document('receipt', [line(1000, { cost: 500, serial: 'SN-1' })])).rejects.toThrow()
})
it('count checks expected quantity and expected cost to prevent stale overwrite', async () => {
  await document('receipt', [line(5000, { cost: 1000 })])
  await expect(
    document('count', [line(4000, { expectedQty: 4000, expectedCost: 1000 })]),
  ).rejects.toThrow()
  await document('count', [line(4000, { expectedQty: 5000, expectedCost: 1000 })])
  expect((await rpc('state')).balances[0]).toMatchObject({ qty: 4000, cost: 800 })
  await document('count', [line(6000, { expectedQty: 4000, expectedCost: 800, cost: 400 })])
  expect((await rpc('state')).balances[0]).toMatchObject({ qty: 6000, cost: 1200 })
})
it('catalog reads aggregate warehouses and blocks legacy stock/sales bypass', async () => {
  await document('receipt', [line(1000, { cost: 100 })])
  await document('transfer', [line(1000)], { destinationId: w2 })
  const s = await rpc('state')
  expect(s.products[0].qty).toBe(1000)
  expect(s.products).toHaveLength(1)
  await expect(e.call('stock.adjust', {}, t)).rejects.toThrow()
  await expect(e.call('invoice.post', {}, t)).rejects.toThrow()
  await expect(e.call('state', {}, t)).rejects.toThrow()
})
it('view-only clerk cannot mutate or see license secrets', async () => {
  await e.call(
    'user.save',
    {
      name: 'Viewer',
      username: 'viewer',
      password: 'Viewer-test-password-123!',
      role: 'cashier',
      active: true,
    },
    t,
  )
  t = (
    (await e.call('login', { username: 'viewer', password: 'Viewer-test-password-123!' })) as any
  ).token
  expect((await rpc('state')).users).toHaveLength(0)
  await expect(document('receipt', [line(1000, { cost: 100 })])).rejects.toThrow()
  await expect(rpc('warehouse.save', { name: 'Bad', clientTxnId: ulid() })).rejects.toThrow()
  await expect(
    e.call('product.save', { name: 'Bad', sku: 'bad', unit: 'piece', price: 0 }, t),
  ).rejects.toThrow()
})

it('reports return filtered actual movements through the full calendar end date', async () => {
  await document('receipt', [line(5000, { cost: 1000 })])
  await document('transfer', [line(2000)], { destinationId: w2 })
  const r = await rpc('report', { from: '2020-01-01', to: '2099-01-01', warehouseId: w2 })
  expect(r.rows).toHaveLength(1)
  expect(r.rows[0]).toMatchObject({ qty: 2000, cost: 400, kind: 'transfer' })
  await expect(rpc('report', { from: '2026-11-01', to: '2026-10-01' })).rejects.toThrow()
})
it('persists a count observation even when the actual quantity equals the expected balance', async () => {
  await document('receipt', [line(5000, { cost: 1000 })])
  const counted = await document('count', [line(5000, { expectedQty: 5000, expectedCost: 1000 })])
  expect(counted.observations).toHaveLength(1)
  expect(counted.observations[0]).toMatchObject({
    actualQty: 5000,
    expectedQty: 5000,
    expectedCost: 1000,
    difference: 0,
  })
  expect(counted.entries).toHaveLength(0)
  expect((await rpc('document.get', { id: counted.document.id })).observations).toEqual(
    counted.observations,
  )
})

it('reconciliation detects missing balances and inconsistent catalog aggregates', async () => {
  await document('receipt', [line(1000, { cost: 100 })])
  db.prepare('UPDATE stock_levels SET qty=2000').run()
  expect((await rpc('state')).reconciled).toBe(false)
  db.prepare('UPDATE stock_levels SET qty=1000').run()
  db.prepare('DELETE FROM inventory_balances').run()
  expect((await rpc('state')).reconciled).toBe(false)
})

it('calendar report excludes next day first hour and includes repeated Cairo DST hour', async () => {
  db.prepare('UPDATE sessions SET expires_at=?').run(new Date('2099-01-01').getTime())
  const clock = vi.spyOn(Date, 'now')
  try {
    clock.mockReturnValue(new Date('2026-04-25T00:30:00').getTime())
    await document('receipt', [line(1000, { cost: 100 })])
    expect((await rpc('report', { from: '2026-04-24', to: '2026-04-24' })).rows).toHaveLength(0)
    clock.mockReturnValue(new Date('2026-10-29T23:30:00+02:00').getTime())
    await document('receipt', [line(1000, { cost: 100 })])
    expect((await rpc('report', { from: '2026-10-29', to: '2026-10-29' })).rows).toHaveLength(1)
  } finally {
    clock.mockRestore()
  }
})
