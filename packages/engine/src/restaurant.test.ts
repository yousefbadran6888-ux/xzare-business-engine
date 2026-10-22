import { afterEach, beforeEach, expect, it } from 'vitest'
import { openDatabase, type XzareDatabase } from '@xzare/db'
import { BusinessEngine } from './service.js'
import { ulid } from '@xzare/core'
let db: XzareDatabase, engine: BusinessEngine, token: string
const call = (action: string, payload: unknown = {}, actor = token): Promise<any> =>
  engine.call(action, payload, actor)
const cmd = (action: string, payload: Record<string, unknown> = {}, actor = token) =>
  call(action, { ...payload, clientTxnId: ulid() }, actor)
beforeEach(async () => {
  db = openDatabase(':memory:', 'restaurant')
  engine = new BusinessEngine(db, 'restaurant')
  token = (
    (await engine.call('setup', {
      businessName: 'Isolated restaurant test',
      name: 'Owner',
      username: 'owner',
      password: 'Restaurant-test-password-123!',
    })) as { token: string }
  ).token
})
afterEach(() => db.close())
async function fixture() {
  const ingredient = await call('product.save', {
    name: 'Ingredient fixture',
    sku: 'RAW-001',
    unit: 'كجم',
    price: 0,
  })
  await call('stock.adjust', {
    variantId: ingredient.id,
    quantity: 10000,
    unitCost: 1000,
    reason: 'QA opening stock',
    clientTxnId: ulid(),
  })
  const meal = await call('restaurant.menu.save', {
    name: 'Meal fixture',
    category: 'QA',
    price: 2000,
    station: 'kitchen',
    kind: 'prepared',
    components: [{ variantId: ingredient.id, qty: 250 }],
    active: true,
  })
  const table = await call('restaurant.table.save', {
    name: 'Table fixture',
    zone: 'QA',
    seats: 4,
    active: true,
  })
  return { ingredient, meal, table }
}
async function order(mealId: string, tableId?: string, kind = 'dinein') {
  let result = await cmd('restaurant.order.create', {
    kind,
    ...(tableId ? { tableId } : {}),
    ...(kind === 'delivery'
      ? { customerName: 'QA customer', phone: '01000000000', address: 'QA address' }
      : {}),
  })
  result = await cmd('restaurant.order.add', {
    orderId: result.id,
    version: result.version,
    menuId: mealId,
    qty: 2000,
    note: 'QA no salt',
  })
  return result
}
async function ready(result: any) {
  result = await cmd('restaurant.order.send', { orderId: result.id, version: result.version })
  result = await cmd('restaurant.line.advance', {
    orderId: result.id,
    version: result.version,
    lineId: result.lines[0].id,
    status: 'preparing',
  })
  result = await cmd('restaurant.line.advance', {
    orderId: result.id,
    version: result.version,
    lineId: result.lines[0].id,
    status: 'ready',
  })
  return result
}
it('starts empty and persists genuine restaurant tables/menu separately from raw stock', async () => {
  const empty = await call('restaurant.state')
  expect(empty.tables).toEqual([])
  expect(empty.menu).toEqual([])
  expect(empty.orders).toEqual([])
  const { meal } = await fixture()
  expect((await call('restaurant.state')).menu[0].id).toBe(meal.id)
  expect((await call('state')).products).toHaveLength(1)
})
it('rejects generic POS sale/stock/catalog routes for restaurant menu items and keeps queued work visible beside drafts', async () => {
  const { meal, table } = await fixture()
  for (const [action, payload] of [
    [
      'stock.adjust',
      { variantId: meal.id, quantity: 1000, unitCost: 1, reason: 'Bypass', clientTxnId: ulid() },
    ],
    ['product.save', { id: meal.id, name: 'Bypass', sku: 'BYPASS', unit: 'حصة', price: 1 }],
    [
      'invoice.post',
      {
        kind: 'purchase',
        lines: [{ variantId: meal.id, qty: 1000, price: 1 }],
        clientTxnId: ulid(),
      },
    ],
    [
      'invoice.post',
      { kind: 'sale', lines: [{ variantId: meal.id, qty: 1000 }], clientTxnId: ulid() },
    ],
  ] as const)
    await expect(call(action, payload)).rejects.toThrow()
  let current = await order(meal.id, table.id)
  current = await cmd('restaurant.order.send', { orderId: current.id, version: current.version })
  current = await cmd('restaurant.order.add', {
    orderId: current.id,
    version: current.version,
    menuId: meal.id,
    qty: 1000,
  })
  await call('user.save', {
    name: 'Cook',
    username: 'cook',
    role: 'kitchen',
    password: 'Cook-test-password-123!',
    active: true,
  })
  const cook = (
    (await engine.call('login', { username: 'cook', password: 'Cook-test-password-123!' })) as {
      token: string
    }
  ).token
  const state = await call('restaurant.state', {}, cook)
  expect(state.orders[0].lines).toHaveLength(1)
  expect(state.orders[0].lines[0].status).toBe('queued')
})
it('freezes recipe and price, consumes once at preparation, and settles exactly once in the cash ledger', async () => {
  const { ingredient, meal, table } = await fixture()
  let current = await order(meal.id, table.id)
  await call('restaurant.menu.save', {
    id: meal.id,
    name: 'Changed meal',
    category: 'QA',
    price: 9000,
    station: 'kitchen',
    kind: 'prepared',
    components: [{ variantId: ingredient.id, qty: 900 }],
    active: true,
  })
  current = await cmd('restaurant.order.send', { orderId: current.id, version: current.version })
  const prepare = {
    orderId: current.id,
    version: current.version,
    lineId: current.lines[0].id,
    status: 'preparing',
    clientTxnId: ulid(),
  }
  const prepared = await call('restaurant.line.advance', prepare)
  await call('restaurant.line.advance', prepare)
  expect((await call('state')).products[0]).toMatchObject({ qty: 9500, cost: 9500 })
  expect(prepared.lines[0]).toMatchObject({ name: 'Meal fixture', price: 2000, cost: 500 })
  current = await cmd('restaurant.line.advance', {
    orderId: current.id,
    version: prepared.version,
    lineId: prepared.lines[0].id,
    status: 'ready',
  })
  await call('shift.open', { opening: 10000 })
  const settle = {
    orderId: current.id,
    version: current.version,
    cash: 5000,
    card: 0,
    transfer: 0,
    discount: 0,
    clientTxnId: ulid(),
  }
  const done = await call('restaurant.checkout', settle)
  await call('restaurant.checkout', settle)
  expect(done.invoice).toMatchObject({ total: 4000, cost: 500, paid: 4000, change: 1000 })
  const state = await call('state')
  expect(state.invoices).toHaveLength(1)
  expect(state.shift.expected).toBe(14000)
  expect((await call('restaurant.state')).tables[0].orderId).toBe(null)
})
it('rolls all ingredient movements back on shortage and rejects skipped kitchen states', async () => {
  const { ingredient, meal } = await fixture()
  const second = await call('product.save', {
    name: 'Missing fixture',
    sku: 'RAW-EMPTY',
    unit: 'قطعة',
    price: 0,
  })
  await call('restaurant.menu.save', {
    id: meal.id,
    name: 'Meal',
    price: 1000,
    components: [
      { variantId: ingredient.id, qty: 100 },
      { variantId: second.id, qty: 1000 },
    ],
  })
  let current = await order(meal.id, undefined, 'takeaway')
  current = await cmd('restaurant.order.send', { orderId: current.id, version: current.version })
  await expect(
    cmd('restaurant.line.advance', {
      orderId: current.id,
      version: current.version,
      lineId: current.lines[0].id,
      status: 'ready',
    }),
  ).rejects.toThrow()
  await expect(
    cmd('restaurant.line.advance', {
      orderId: current.id,
      version: current.version,
      lineId: current.lines[0].id,
      status: 'preparing',
    }),
  ).rejects.toThrow('المخزون')
  expect((await call('state')).products.find((p: any) => p.id === ingredient.id).qty).toBe(10000)
  expect(
    db.prepare("SELECT count(*) AS n FROM stock_movements WHERE kind='restaurant.prepare'").get(),
  ).toEqual({ n: 0 })
})
it('enforces table occupancy, transfer collision and optimistic versions without partial writes', async () => {
  const { meal, table } = await fixture()
  let current = await order(meal.id, table.id)
  await expect(
    cmd('restaurant.order.create', { kind: 'dinein', tableId: table.id }),
  ).rejects.toThrow()
  await expect(
    cmd('restaurant.order.add', { orderId: current.id, version: 0, menuId: meal.id, qty: 1000 }),
  ).rejects.toThrow('تغير')
  const other = await call('restaurant.table.save', { name: 'Other fixture', zone: 'QA', seats: 2 })
  current = await cmd('restaurant.order.move', {
    orderId: current.id,
    version: current.version,
    tableId: other.id,
  })
  expect(current.tableId).toBe(other.id)
  await expect(
    call('restaurant.table.save', {
      id: other.id,
      name: 'Other fixture',
      zone: 'QA',
      seats: 2,
      active: false,
    }),
  ).rejects.toThrow()
})
it('logs prepared cancellation as waste, never fabricates raw inventory restoration', async () => {
  const { ingredient, meal } = await fixture()
  let current = await order(meal.id, undefined, 'takeaway')
  current = await ready(current)
  current = await cmd('restaurant.line.cancel', {
    orderId: current.id,
    version: current.version,
    lineId: current.lines[0].id,
    reason: 'QA prepared cancellation',
  })
  expect(current.status).toBe('cancelled')
  expect((await call('state')).products.find((p: any) => p.id === ingredient.id).qty).toBe(9500)
  expect((await call('restaurant.state')).waste[0]).toMatchObject({
    cost: 500,
    reason: 'QA prepared cancellation',
  })
  expect(
    await call('report.get', { from: Date.now() - 60000, to: Date.now() + 60000 }),
  ).toMatchObject({ waste: 500, netProfit: -500, grossProfit: 0 })
})
it('isolates kitchen accounts from customer details, prices, stock, users and settlement', async () => {
  const { meal } = await fixture()
  let current = await order(meal.id, undefined, 'delivery')
  current = await cmd('restaurant.order.send', { orderId: current.id, version: current.version })
  await call('user.save', {
    name: 'QA cook',
    username: 'cook',
    role: 'kitchen',
    password: 'Cook-test-password-123!',
    active: true,
  })
  const cook = (
    (await engine.call('login', { username: 'cook', password: 'Cook-test-password-123!' })) as {
      token: string
    }
  ).token
  const state = await call('restaurant.state', {}, cook)
  expect(JSON.stringify(state)).not.toContain('QA address')
  expect(JSON.stringify(state)).not.toContain('01000000000')
  expect(state.menu).toEqual([])
  expect(state.orders[0].lines[0].price).toBe(0)
  for (const action of [
    'state',
    'stock.reconcile',
    'shift.open',
    'restaurant.menu.save',
    'restaurant.checkout',
  ])
    await expect(call(action, {}, cook)).rejects.toThrow()
  const prepared = await cmd(
    'restaurant.line.advance',
    {
      orderId: current.id,
      version: current.version,
      lineId: current.lines[0].id,
      status: 'preparing',
    },
    cook,
  )
  expect(prepared.lines[0].cost).toBe(0)
})
it('rejects overlapping bookings and seats an actual booking only once', async () => {
  const { table } = await fixture(),
    at = Date.now() + 300000
  const booking = await cmd('restaurant.reservation.save', {
    tableId: table.id,
    name: 'QA guest',
    phone: '',
    guests: 2,
    startsAt: at,
    endsAt: at + 3600000,
  })
  await expect(
    cmd('restaurant.reservation.save', {
      tableId: table.id,
      name: 'Conflict',
      phone: '',
      guests: 1,
      startsAt: at + 1000,
      endsAt: at + 200000,
    }),
  ).rejects.toThrow()
  const request = { reservationId: booking.id, clientTxnId: ulid() }
  const seated = await call('restaurant.reservation.seat', request)
  await call('restaurant.reservation.seat', request)
  expect(seated.tableId).toBe(table.id)
  await expect(cmd('restaurant.reservation.seat', { reservationId: booking.id })).rejects.toThrow()
})
it('requires active driver, keeps delivery out until confirmed collection, and retains food cost on refund', async () => {
  const { meal } = await fixture()
  let current = await ready(await order(meal.id, undefined, 'delivery'))
  await expect(
    cmd('restaurant.delivery.dispatch', {
      orderId: current.id,
      version: current.version,
      driverId: ulid(),
    }),
  ).rejects.toThrow()
  const driver = await call('restaurant.driver.save', {
    name: 'QA driver',
    phone: '01000000001',
    active: true,
  })
  current = await cmd('restaurant.delivery.dispatch', {
    orderId: current.id,
    version: current.version,
    driverId: driver.id,
  })
  expect(current.status).toBe('out')
  await expect(
    cmd('restaurant.checkout', { orderId: current.id, version: current.version, cash: 0 }),
  ).rejects.toThrow()
  await call('shift.open', { opening: 10000 })
  const paid = await cmd('restaurant.checkout', {
    orderId: current.id,
    version: current.version,
    cash: 4000,
  })
  expect(paid.status).toBe('completed')
  const request = { orderId: current.id, reason: 'QA refund', method: 'cash', clientTxnId: ulid() }
  await call('restaurant.refund', request)
  await call('restaurant.refund', request)
  const state = await call('state')
  expect(state.shift.expected).toBe(10000)
  expect(state.products[0].qty).toBe(9500)
  expect(state.invoices[0]).toMatchObject({
    total: 4000,
    returned: 4000,
    refunded: 4000,
    cost: 500,
    balance: 0,
  })
  await expect(
    cmd('invoice.return', {
      invoiceId: paid.invoice.id,
      lines: [],
      method: 'cash',
      note: 'wrong route',
    }),
  ).rejects.toThrow()
})
