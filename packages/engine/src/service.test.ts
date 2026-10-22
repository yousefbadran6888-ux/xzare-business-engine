import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { openDatabase, type XzareDatabase } from '@xzare/db'
import { BusinessEngine } from './service.js'
import { ulid } from '@xzare/core'

let db: XzareDatabase, engine: BusinessEngine, token: string
async function command(action: string, payload: unknown = {}) {
  return engine.call(action, payload, token) as Promise<any>
}
beforeEach(async () => {
  db = openDatabase(':memory:')
  engine = new BusinessEngine(db)
  const result = (await engine.call('setup', {
    businessName: 'Integration test store',
    username: 'owner',
    name: 'Test owner',
    password: 'Unique-test-password-123!',
  })) as { token: string }
  token = result.token
})
afterEach(() => db.close())
it('catalog barcode checks preserve leading zeroes, find archived products and prevent duplicate writes atomically', async () => {
  const payload = {
    name: 'Barcode fixture',
    sku: 'BARCODE-TEST',
    unit: 'قطعة',
    price: 250,
    barcode: '001234',
    format: 'CODE128',
  }
  const first = await command('product.save', payload)
  expect((await command('product.barcodeCheck', { code: '001234' })).product.id).toBe(first.id)
  expect((await command('product.barcodeCheck', { code: '1234' })).product).toBe(null)
  await expect(command('product.save', { ...payload, sku: 'SECOND' })).rejects.toThrow(
    'الباركود مسجل',
  )
  expect((await command('state')).products).toHaveLength(1)
  await command('product.archive', { id: first.id })
  expect((await command('product.barcodeCheck', { code: '001234' })).product.active).toBe(0)
})
it('renderer settings expose only business settings, never arbitrary secret state', async () => {
  db.prepare('INSERT INTO settings VALUES(?,?)').run('devicePrivateKey', 'must-never-leak')
  db.prepare('INSERT INTO settings VALUES(?,?)').run('license', 'must-never-leak')
  const state = await command('state')
  expect(JSON.stringify(state.settings)).not.toContain('must-never-leak')
  expect(state.settings.businessName).toBe('Integration test store')
})
async function stock(qty = 10000, cost = 123) {
  const p = await command('product.save', {
    name: 'Test item',
    sku: 'XZ-001',
    unit: 'قطعة',
    price: 250,
    category: '',
    reorderQty: 1000,
    barcode: 'XZ-001',
    format: 'CODE128',
  })
  await command('stock.adjust', {
    clientTxnId: ulid(),
    variantId: p.id,
    quantity: qty,
    unitCost: cost,
    reason: 'Test opening stock',
  })
  return p.id as string
}
async function shift() {
  return command('shift.open', { opening: 10000 })
}
const sale = (variantId: string, qty = 1000) => ({
  kind: 'sale',
  lines: [{ variantId, qty }],
  discount: 0,
  taxBps: 0,
  cash: 250,
  card: 0,
  transfer: 0,
  note: '',
  clientTxnId: ulid(),
})

describe('complete POS workflows', () => {
  it('returns an archived product at its original invoice value and rolls back missing holds', async () => {
    const id = await stock(1000)
    await shift()
    await expect(command('invoice.post', { ...sale(id), holdId: ulid() })).rejects.toThrow()
    expect((await command('state')).invoices).toHaveLength(0)
    expect((await command('state')).products[0].qty).toBe(1000)
    const invoice = await command('invoice.post', sale(id))
    await command('product.save', {
      id,
      name: 'Changed name',
      sku: 'XZ-001',
      unit: 'قطعة',
      price: 9999,
      active: false,
    })
    const original = await command('invoice.get', { id: invoice.id })
    const returned = await command('invoice.return', {
      invoiceId: invoice.id,
      lines: [{ lineId: original.lines[0].id, qty: 1000 }],
      method: 'cash',
      note: 'Original-price return',
      clientTxnId: ulid(),
    })
    expect(returned.total).toBe(250)
    expect((await command('state')).products[0].cost).toBe(123)
    expect(await command('stock.reconcile')).toEqual([])
  })
  it('starts without fake business records and blocks unauthenticated reads', async () => {
    await expect(engine.call('state', {}, null)).rejects.toThrow()
    const state = await command('state')
    expect(state.products).toHaveLength(0)
    expect(state.invoices).toHaveLength(0)
    await expect(
      engine.call('setup', {
        businessName: 'x',
        username: 'owner',
        name: 'x',
        password: 'Unique-test-password-123!',
      }),
    ).rejects.toThrow()
  })
  it('posts a sale and stock cost atomically and makes retries idempotent', async () => {
    const id = await stock()
    await shift()
    const payload = sale(id)
    const first = await command('invoice.post', payload)
    const retry = await command('invoice.post', payload)
    expect(retry.id).toBe(first.id)
    const state = await command('state')
    expect(state.products[0].qty).toBe(9000)
    expect(state.invoices).toHaveLength(1)
    expect(state.invoices[0].total).toBe(250)
    expect(state.invoices[0].cost).toBe(123)
    await expect(command('invoice.post', { ...payload, discount: 1 })).rejects.toThrow()
  })
  it('rolls back all rows and numbering if any line has insufficient stock', async () => {
    const id = await stock(1000)
    await shift()
    const payload = { ...sale(id), lines: [{ variantId: id, qty: 2000 }] }
    await expect(command('invoice.post', payload)).rejects.toThrow()
    expect((await command('state')).products[0].qty).toBe(1000)
    expect((await command('state')).invoices).toHaveLength(0)
  })
  it('requires a shift and a real customer for credit and rejects duplicate codes', async () => {
    const id = await stock()
    await expect(command('invoice.post', sale(id))).rejects.toThrow()
    await shift()
    await expect(command('invoice.post', { ...sale(id), cash: 0 })).rejects.toThrow()
    await expect(
      command('product.save', {
        name: 'Other',
        sku: 'XZ-002',
        unit: 'قطعة',
        price: 1,
        category: '',
        reorderQty: 0,
        barcode: 'XZ-001',
        format: 'CODE128',
      }),
    ).rejects.toThrow()
  })
  it('handles credit, payments and partial returns without over-return or changing historical price', async () => {
    const id = await stock()
    await shift()
    const customer = await command('party.save', {
      kind: 'customer',
      name: 'Test customer',
      phone: '',
      address: '',
    })
    const invoice = await command('invoice.post', {
      ...sale(id, 2000),
      partyId: customer.id,
      cash: 200,
    })
    await command('invoice.pay', {
      invoiceId: invoice.id,
      amount: 100,
      method: 'cash',
      clientTxnId: ulid(),
    })
    const detail = await command('invoice.get', { id: invoice.id })
    const result = await command('invoice.return', {
      invoiceId: invoice.id,
      lines: [{ lineId: detail.lines[0].id, qty: 1000 }],
      method: 'cash',
      note: 'Test return',
      clientTxnId: ulid(),
    })
    expect(result.total).toBe(250)
    expect(result.refunded).toBe(50)
    const state = await command('state')
    expect(state.products[0].qty).toBe(9000)
    expect(state.parties[0].balance).toBe(0)
    await expect(
      command('invoice.return', {
        invoiceId: invoice.id,
        lines: [{ lineId: detail.lines[0].id, qty: 2000 }],
        method: 'cash',
        note: 'Overreturn',
        clientTxnId: ulid(),
      }),
    ).rejects.toThrow()
  })
  it('enforces cashier permissions even when invoked outside the UI', async () => {
    await command('user.save', {
      username: 'cashier',
      name: 'Cashier',
      role: 'cashier',
      password: 'Unique-cashier-pass-123!',
    })
    const login = (await engine.call('login', {
      username: 'cashier',
      password: 'Unique-cashier-pass-123!',
    })) as { token: string }
    await expect(
      engine.call('product.save', { name: 'Unauthorized' }, login.token),
    ).rejects.toThrow()
    await expect(
      engine.call('settings.save', { businessName: 'Stolen' }, login.token),
    ).rejects.toThrow()
    expect(((await engine.call('state', {}, login.token)) as any).users).toHaveLength(0)
  })
  it('purchases update supplier debt, expenses affect cash and shifts close with variance', async () => {
    const id = await stock()
    await shift()
    const supplier = await command('party.save', {
      kind: 'supplier',
      name: 'Test supplier',
      phone: '',
      address: '',
    })
    await command('invoice.post', {
      ...sale(id, 1000),
      kind: 'purchase',
      lines: [{ variantId: id, qty: 1000, price: 100 }],
      cash: 0,
      partyId: supplier.id,
    })
    await command('expense.add', {
      amount: 500,
      category: 'Test expense',
      note: '',
      clientTxnId: ulid(),
    })
    const state = await command('state')
    expect(state.products[0].qty).toBe(11000)
    expect(state.parties[0].balance).toBe(100)
    expect(state.shift.expected).toBe(9500)
    const closed = await command('shift.close', { actual: 9400 })
    expect(closed.variance).toBe(-100)
  })
  it('returns fully discounted stock without moving cash', async () => {
    const id = await stock(1000)
    await shift()
    const inv = await command('invoice.post', { ...sale(id), discount: 250, cash: 0 })
    const detail = await command('invoice.get', { id: inv.id })
    const returned = await command('invoice.return', {
      invoiceId: inv.id,
      lines: [{ lineId: detail.lines[0].id, qty: 1000 }],
      method: 'cash',
      note: 'Inventory-only return',
      clientTxnId: ulid(),
    })
    expect(returned.total).toBe(0)
    const state = await command('state')
    expect(state.products[0].qty).toBe(1000)
    expect(state.products[0].cost).toBe(123)
    expect(state.shift.expected).toBe(10000)
  })
  it('redacts cashier mutation costs and enforces configured tax', async () => {
    const id = await stock()
    await command('user.save', {
      username: 'cashier',
      name: 'Cashier',
      role: 'cashier',
      password: 'Unique-cashier-pass-123!',
    })
    const login = (await engine.call('login', {
      username: 'cashier',
      password: 'Unique-cashier-pass-123!',
    })) as { token: string }
    await engine.call('shift.open', { opening: 0 }, login.token)
    const inv = (await engine.call('invoice.post', sale(id), login.token)) as any
    expect(inv.cost).toBe(0)
    db.prepare("UPDATE settings SET value='1400' WHERE key='taxBps'").run()
    await expect(engine.call('invoice.post', sale(id), login.token)).rejects.toThrow()
  })
  it('does not issue a session using a password reset while login is hashing', async () => {
    const owner = (await command('state')).user
    const reset = command('user.save', {
      id: owner.id,
      username: 'owner',
      name: 'Owner',
      role: 'admin',
      password: 'New-owner-password-123!',
      active: true,
    })
    const login = engine.call('login', { username: 'owner', password: 'Unique-test-password-123!' })
    const results = await Promise.allSettled([reset, login])
    expect(results[0].status).toBe('fulfilled')
    if (results[1].status === 'fulfilled') {
      const stale = results[1].value as { token: string }
      await expect(engine.call('state', {}, stale.token)).rejects.toThrow()
    }
  })
  it('rejects cash overdrafts and deduplicates financial adjustments', async () => {
    await command('shift.open', { opening: 100 })
    await expect(
      command('expense.add', { amount: 101, category: 'Expense', note: '', clientTxnId: ulid() }),
    ).rejects.toThrow()
    const payload = { amount: 50, category: 'Expense', note: '', clientTxnId: ulid() }
    const first = await command('expense.add', payload)
    const retry = await command('expense.add', payload)
    expect(retry.id).toBe(first.id)
    expect((await command('state')).shift.expected).toBe(50)
    expect(db.prepare('SELECT count(*) AS n FROM expenses').get()).toEqual({ n: 1 })
  })
})
