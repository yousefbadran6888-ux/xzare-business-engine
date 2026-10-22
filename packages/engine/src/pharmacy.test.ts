import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { openDatabase, type XzareDatabase } from '@xzare/db'
import { BusinessEngine } from './service.js'
import { ulid } from '@xzare/core'
let db: XzareDatabase, e: BusinessEngine, t: string, med: string, supplier: string
const pass = 'Pharmacy-QA-password-123!'
const rpc = (a: string, p: unknown = {}, token = t): Promise<any> =>
  e.call('pharmacy.' + a, p, token)
const cmd = (a: string, p: Record<string, unknown> = {}, token = t) =>
  rpc(a, { clientTxnId: ulid(), ...p }, token)
const medicine = (extra: Record<string, unknown> = {}) =>
  cmd('medicine.save', {
    code: 'QA1',
    name: 'Entered QA medicine',
    ingredient: 'Entered ingredient',
    strength: 'Entered strength',
    form: 'Entered form',
    unit: 'علبة',
    manufacturer: '',
    price: 10000,
    reorderQty: 5,
    barcode: 'QA-MED-01',
    format: 'CODE128',
    active: true,
    alternativeIds: [],
    ...extra,
  })
const receipt = (batch = 'B1', expiry = '2030-06-01', qty = 10, cost = 50000) =>
  cmd('receipt.post', {
    supplierId: supplier,
    reference: 'QA purchase',
    note: 'QA receipt',
    lines: [{ medicineId: med, batch, expiry, qty, cost }],
  })
const sale = (qty = 1, extra: Record<string, unknown> = {}, token = t) =>
  cmd(
    'sale.post',
    {
      customer: '',
      note: '',
      lines: [{ medicineId: med, qty }],
      discount: 0,
      taxBps: 0,
      paid: 0,
      method: 'cash',
      reference: 'QA payment',
      ...extra,
    },
    token,
  )
const get = (id: string, token = t) => rpc('sale.get', { id }, token)
const operator = async () => {
  await e.call(
    'user.save',
    { username: 'cashqa', name: 'QA operator', role: 'cashier', password: pass, active: true },
    t,
  )
  return ((await e.call('login', { username: 'cashqa', password: pass })) as any).token
}
beforeEach(async () => {
  vi.setSystemTime(new Date(2030, 0, 1, 10))
  db = openDatabase(':memory:', 'pharmacy' as any)
  e = new BusinessEngine(db, 'pharmacy' as any)
  t = (
    (await e.call('setup', {
      businessName: 'QA pharmacy',
      name: 'QA owner',
      username: 'owner',
      password: pass,
    })) as any
  ).token
  supplier = (
    await cmd('supplier.save', { name: 'QA supplier', phone: '', address: '', active: true })
  ).id
  med = (await medicine()).id
})
afterEach(() => {
  db?.close()
  vi.useRealTimers()
})
it('starts with no seeded sales or batches and exposes no license settings', async () => {
  const s = await rpc('state')
  expect(s.sales).toEqual([])
  expect(s.lots).toEqual([])
  expect(s.reconciled).toBe(true)
  expect(s.settings.license).toBeUndefined()
})
it('enforces unique validated barcode, catalog versions and explicit alternative links', async () => {
  await expect(medicine({ code: 'QA2' })).rejects.toThrow()
  await expect(medicine({ code: 'QA2', barcode: '123', format: 'EAN13' })).rejects.toThrow()
  const other = (await medicine({ code: 'QA2', barcode: 'QA2' })).id
  await medicine({ id: med, version: 0, alternativeIds: [other] })
  await expect(medicine({ id: med, version: 0 })).rejects.toThrow(/تغير/)
  await expect(medicine({ id: med, version: 1, alternativeIds: [med] })).rejects.toThrow()
  expect((await rpc('barcode.lookup', { code: 'QA-MED-01' })).medicine.alternativeIds).toEqual([
    other,
  ])
})
it('requires supplier, actual future day, lot code and whole positive units', async () => {
  for (const expiry of ['2030-01-01', '2029-12-31', '2030-02-30'])
    await expect(receipt('BAD', expiry)).rejects.toThrow()
  await expect(receipt('', '2030-06-01')).rejects.toThrow()
  await expect(receipt('B', '2030-06-01', 0)).rejects.toThrow()
  await expect(receipt('B', '2030-06-01', 1.5)).rejects.toThrow()
  expect((await rpc('state')).lots).toHaveLength(0)
})
it('locks lot expiry and medicine unit after stock exists', async () => {
  await receipt()
  await expect(receipt('B1', '2030-07-01')).rejects.toThrow(/صلاحية/)
  await expect(medicine({ id: med, version: 0, unit: 'شريط' })).rejects.toThrow(/وحدة/)
  expect((await rpc('state')).lots[0].qty).toBe(10)
})
it('dispenses FEFO across batches and conserves exact cost and stock', async () => {
  await receipt('LATE', '2030-09-01', 5, 25001)
  await receipt('EARLY', '2030-02-01', 3, 12001)
  const a = await sale(5)
  const d = await get(a.id)
  expect(d.allocations.map((x: any) => [x.batch, x.qty])).toEqual([
    ['EARLY', 3],
    ['LATE', 2],
  ])
  expect(d.sale.total).toBe(50000)
  expect(d.allocations.reduce((n: number, x: any) => n + x.cost, 0)).toBe(22001)
  const s = await rpc('state')
  expect(s.lots.find((x: any) => x.batch === 'LATE').qty).toBe(3)
  expect(s.reconciled).toBe(true)
})
it('blocks expiry day, quarantined/recall batches and insufficient total stock atomically', async () => {
  await receipt('A', '2030-01-02', 5, 20000)
  await receipt('B', '2030-09-01', 2, 10000)
  let s = await rpc('state')
  const b = s.lots.find((x: any) => x.batch === 'B')
  await cmd('lot.status', { id: b.id, version: b.version, status: 'recalled', reason: 'QA recall' })
  vi.setSystemTime(new Date(2030, 0, 2, 10))
  t = ((await e.call('login', { username: 'owner', password: pass })) as any).token
  await expect(sale()).rejects.toThrow(/المتاح/)
  expect((await rpc('state')).sales).toHaveLength(0)
})
it('requires lot version/reason and protects held lots from cashier mutations', async () => {
  await receipt()
  const b = (await rpc('state')).lots[0]
  await cmd('lot.status', { id: b.id, version: 0, status: 'quarantine', reason: 'QA hold' })
  await expect(
    cmd('lot.status', { id: b.id, version: 0, status: 'available', reason: 'QA release' }),
  ).rejects.toThrow(/تغير/)
  await expect(
    cmd(
      'lot.status',
      { id: b.id, version: 1, status: 'available', reason: 'QA release' },
      await operator(),
    ),
  ).rejects.toThrow(/صلاحية/)
})
it('freezes sale/receipt descriptions and barcode lookup does not leak cost', async () => {
  await receipt()
  const a = await sale()
  await medicine({ id: med, version: 0, name: 'Changed QA', price: 1 })
  const d = await get(a.id)
  expect(d.lines[0].name).toBe('Entered QA medicine')
  expect(d.sale.total).toBe(10000)
  const c = await operator()
  expect((await get(a.id, c)).allocations[0].cost).toBe(0)
  expect((await rpc('state', {}, c)).lots[0].cost).toBe(0)
  expect(JSON.stringify(await rpc('barcode.lookup', { code: 'QA-MED-01' }, c))).not.toContain(
    '50000',
  )
})
it('computes discounts/tax with integer rounding and apportions all revenue', async () => {
  await receipt()
  const a = await sale(3, { discount: 1001, taxBps: 1400 })
  const d = await get(a.id)
  expect(d.sale.total).toBe(33059)
  expect(d.allocations.reduce((n: number, x: any) => n + x.value, 0)).toBe(d.sale.total)
  await expect(sale(1, { discount: 10001 })).rejects.toThrow()
})
it('binds retries to actor/action/payload and does not sell twice', async () => {
  await receipt()
  const clientTxnId = ulid(),
    p = {
      clientTxnId,
      customer: '',
      note: '',
      lines: [{ medicineId: med, qty: 2 }],
      discount: 0,
      taxBps: 0,
      paid: 0,
      method: 'cash',
      reference: 'QA',
    }
  const a = await rpc('sale.post', p)
  expect(await rpc('sale.post', p)).toEqual(a)
  await expect(rpc('sale.post', { ...p, paid: 1 })).rejects.toThrow(/معرف/)
  await expect(rpc('sale.post', p, await operator())).rejects.toThrow(/معرف/)
  expect((await rpc('state')).lots[0].qty).toBe(8)
})
it('rejects payments exceeding current debt and duplicate retries conserve money', async () => {
  await receipt()
  const a = await sale(2, { paid: 5000 })
  const p = {
    id: a.id,
    amount: 15000,
    method: 'bank',
    reference: 'QA transfer',
    clientTxnId: ulid(),
  }
  await rpc('sale.pay', p)
  await rpc('sale.pay', p)
  expect((await get(a.id)).sale.balance).toBe(0)
  await expect(cmd('sale.pay', { ...p, clientTxnId: ulid(), amount: 1 })).rejects.toThrow(/المتبقي/)
})
it('returns against original allocation only, quarantines stock and refunds paid excess', async () => {
  await receipt()
  const a = await sale(3, { paid: 25000 })
  const d = await get(a.id)
  await cmd('sale.return', {
    id: a.id,
    allocations: [{ id: d.allocations[0].id, qty: 2 }],
    reason: 'QA returned packages',
    method: 'cash',
    reference: 'QA refund',
  })
  const r = await get(a.id)
  expect(r.sale.credit).toBe(20000)
  expect(r.sale.paid).toBe(10000)
  expect(r.sale.balance).toBe(0)
  const b = (await rpc('state')).lots[0]
  expect(b.qty).toBe(7)
  expect(b.quarantineQty).toBe(2)
  expect(r.payments.at(-1).amount).toBe(-15000)
  await expect(
    cmd('sale.return', {
      id: a.id,
      allocations: [{ id: d.allocations[0].id, qty: 2 }],
      reason: 'QA extra',
      method: 'cash',
      reference: 'QA',
    }),
  ).rejects.toThrow()
  expect((await rpc('state')).reconciled).toBe(true)
})
it('full cumulative partial returns exactly reverse odd discount/tax totals', async () => {
  await receipt()
  const a = await sale(3, { discount: 1001, taxBps: 1400, paid: 33059 })
  const d = await get(a.id)
  for (let i = 0; i < 3; i++)
    await cmd('sale.return', {
      id: a.id,
      allocations: [{ id: d.allocations[0].id, qty: 1 }],
      reason: 'QA return ' + i,
      method: 'card',
      reference: 'QA refund',
    })
  const v = await get(a.id)
  expect(v.sale.credit).toBe(v.sale.total)
  expect(v.sale.paid).toBe(0)
  expect(v.sale.balance).toBe(0)
})
it('does not resell returned quarantine stock and records stale-safe disposal', async () => {
  await receipt('B1', '2030-06-01', 1, 5000)
  const a = await sale()
  const d = await get(a.id)
  await cmd('sale.return', {
    id: a.id,
    allocations: [{ id: d.allocations[0].id, qty: 1 }],
    reason: 'QA',
    method: 'cash',
    reference: 'QA',
  })
  await expect(sale()).rejects.toThrow(/المتاح/)
  const b = (await rpc('state')).lots[0]
  await expect(
    cmd('lot.dispose', {
      id: b.id,
      bucket: 'quarantine',
      qty: 1,
      expectedQty: 0,
      expectedCost: 0,
      reason: 'QA',
    }),
  ).rejects.toThrow(/تغير/)
  await cmd('lot.dispose', {
    id: b.id,
    bucket: 'quarantine',
    qty: 1,
    expectedQty: 1,
    expectedCost: 5000,
    reason: 'QA damaged',
  })
  expect((await rpc('state')).reconciled).toBe(true)
  expect((await rpc('state')).lots[0].quarantineQty).toBe(0)
})
it('immutable identity and ledgers reject UPDATE DELETE and INSERT OR REPLACE', async () => {
  await receipt()
  await sale()
  for (const table of [
    'pharmacy_lots',
    'pharmacy_documents',
    'pharmacy_entries',
    'pharmacy_sales',
    'pharmacy_sale_lines',
    'pharmacy_allocations',
    'pharmacy_payments',
  ]) {
    const row = db.prepare('SELECT * FROM ' + table + ' LIMIT 1').get() as Record<string, unknown>
    expect(() => db.prepare('DELETE FROM ' + table + ' WHERE id=?').run(row.id)).toThrow()
    expect(() => db.prepare('UPDATE ' + table + ' SET id=id WHERE id=?').run(row.id)).toThrow()
    expect(() =>
      db
        .prepare(
          'INSERT OR REPLACE INTO ' +
            table +
            ' (' +
            Object.keys(row).join(',') +
            ') VALUES(' +
            Object.keys(row)
              .map(() => '?')
              .join(',') +
            ')',
        )
        .run(...Object.values(row)),
    ).toThrow()
  }
})
it('fails closed on ledger drift and rolls back every stock/payment write', async () => {
  await receipt()
  db.prepare('UPDATE pharmacy_balances SET qty=qty+1').run()
  await expect(sale()).rejects.toThrow(/تطابق/)
  expect((await rpc('state')).sales).toHaveLength(0)
  expect((await rpc('state')).reconciled).toBe(false)
})
it('denies generic POS/inventory bypasses and manager master/return actions for cashier', async () => {
  const c = await operator()
  for (const a of [
    'state',
    'invoice.post',
    'stock.adjust',
    'inventory.document.post',
    'product.save',
  ])
    await expect(e.call(a, {}, t)).rejects.toThrow(/غير متاحة/)
  await expect(
    cmd(
      'medicine.save',
      {
        code: 'Q3',
        name: 'QA',
        ingredient: '',
        strength: '',
        form: '',
        unit: 'علبة',
        manufacturer: '',
        price: 1,
        reorderQty: 1,
        barcode: '',
        format: 'CODE128',
        active: true,
        alternativeIds: [],
      },
      c,
    ),
  ).rejects.toThrow(/صلاحية/)
})
it('includes local end day and rejects malformed reporting bounds', async () => {
  await receipt()
  await sale()
  const r = await rpc('report', { from: '2030-01-01', to: '2030-01-01' })
  expect(r.sales).toHaveLength(1)
  await expect(rpc('report', { from: '2030-01-02', to: '2030-01-01' })).rejects.toThrow()
  await expect(rpc('sale.post', { extra: 'forbidden' })).rejects.toThrow()
})
