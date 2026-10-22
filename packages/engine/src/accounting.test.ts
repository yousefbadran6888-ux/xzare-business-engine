import { afterEach, beforeEach, expect, it } from 'vitest'
import { openDatabase, type XzareDatabase } from '@xzare/db'
import { BusinessEngine } from './service.js'
import { ulid } from '@xzare/core'
let db: XzareDatabase, e: BusinessEngine, t: string
const rpc = async (a: string, p: unknown = {}): Promise<any> => e.call('accounting.' + a, p, t)
let bank: string, capital: string, revenue: string, expense: string, period: string
beforeEach(async () => {
  db = openDatabase(':memory:', 'accounting')
  e = new BusinessEngine(db, 'accounting')
  t = (
    (await e.call('setup', {
      businessName: 'QA accounting',
      name: 'Owner',
      username: 'owner',
      password: 'Accounting-test-password-123!',
    })) as { token: string }
  ).token
  period = (await rpc('period.save', { name: '2026', from: '2026-01-01', to: '2026-12-31' })).id
  bank = (await rpc('account.save', { code: '100', name: 'Bank', kind: 'asset' })).id
  capital = (await rpc('account.save', { code: '300', name: 'Capital', kind: 'equity' })).id
  revenue = (await rpc('account.save', { code: '400', name: 'Revenue', kind: 'income' })).id
  expense = (await rpc('account.save', { code: '500', name: 'Expense', kind: 'expense' })).id
})
afterEach(() => db?.close())
const draft = (lines: any[], extra = {}) =>
  rpc('journal.save', { date: '2026-10-04', memo: 'QA real entry', lines, ...extra })
const post = (d: any, extra = {}) =>
  rpc('journal.post', { id: d.id, version: d.version, clientTxnId: ulid(), ...extra })
it('starts empty, rejects imbalance without persisting journal', async () => {
  expect((await rpc('state')).journals).toHaveLength(0)
  await expect(
    draft([
      { accountId: bank, debit: 100, credit: 0 },
      { accountId: capital, debit: 0, credit: 90 },
    ]),
  ).rejects.toThrow()
  expect(db.prepare('SELECT count(*) n FROM accounting_journals').get()).toEqual({ n: 0 })
})
it('posts atomically once; journal and ledger balances reconcile', async () => {
  const d = await draft([
    { accountId: bank, debit: 10000, credit: 0 },
    { accountId: capital, debit: 0, credit: 10000 },
  ])
  const clientTxnId = ulid()
  const p = await post(d, { clientTxnId })
  expect(await post(d, { clientTxnId })).toEqual(p)
  const r = await rpc('report', { from: '2026-01-01', to: '2026-12-31' })
  expect(r.reconciled).toBe(true)
  expect(r.assets).toBe(10000)
  expect(r.equity).toBe(10000)
  expect(r.trial.debit).toBe(r.trial.credit)
  expect(db.prepare('SELECT count(*) n FROM accounting_entries').get()).toEqual({ n: 2 })
  await expect(post(d, { clientTxnId, id: ulid() })).rejects.toThrow()
  expect(() => db.prepare('UPDATE accounting_entries SET debit=0').run()).toThrow()
})
it('reversal preserves original, links correction once and restores balances', async () => {
  const p = await post(
    await draft([
      { accountId: bank, debit: 10000, credit: 0 },
      { accountId: capital, debit: 0, credit: 10000 },
    ]),
  )
  await rpc('journal.reverse', {
    id: p.id,
    date: '2026-10-05',
    memo: 'correction',
    clientTxnId: ulid(),
  })
  expect((await rpc('report', { from: '2026-01-01', to: '2026-12-31' })).assets).toBe(0)
  await expect(
    rpc('journal.reverse', { id: p.id, date: '2026-10-06', memo: 'again', clientTxnId: ulid() }),
  ).rejects.toThrow()
  expect(
    db.prepare("SELECT count(*) n FROM accounting_journals WHERE status='posted'").get(),
  ).toEqual({ n: 2 })
})
it('income and balance sheet include current profit; ledger has opening and running balances', async () => {
  for (const lines of [
    [
      { accountId: bank, debit: 20000, credit: 0 },
      { accountId: capital, debit: 0, credit: 20000 },
    ],
    [
      { accountId: bank, debit: 5000, credit: 0 },
      { accountId: revenue, debit: 0, credit: 5000 },
    ],
    [
      { accountId: expense, debit: 2000, credit: 0 },
      { accountId: bank, debit: 0, credit: 2000 },
    ],
  ])
    await post(await draft(lines))
  const r = await rpc('report', { from: '2026-01-01', to: '2026-12-31' })
  expect(r).toMatchObject({
    assets: 23000,
    equity: 20000,
    profit: 3000,
    accumulatedProfit: 3000,
    reconciled: true,
  })
  const l = await rpc('ledger', { accountId: bank, from: '2026-10-05', to: '2026-12-31' })
  expect(l.opening).toBe(23000)
  expect(l.closing).toBe(23000)
})
it('rejects bad dates, overlapping periods, closed period writes and stale drafts', async () => {
  await expect(
    rpc('period.save', { name: 'overlap', from: '2026-06-01', to: '2027-06-01' }),
  ).rejects.toThrow()
  await expect(
    draft(
      [
        { accountId: bank, debit: 100, credit: 0 },
        { accountId: capital, debit: 0, credit: 100 },
      ],
      { date: '2026-02-30' },
    ),
  ).rejects.toThrow()
  const d = await draft([
    { accountId: bank, debit: 100, credit: 0 },
    { accountId: capital, debit: 0, credit: 100 },
  ])
  await expect(post({ ...d, version: 99 })).rejects.toThrow()
  await expect(rpc('period.close', { id: period, clientTxnId: ulid() })).rejects.toThrow()
  await post(d)
  await rpc('period.close', { id: period, clientTxnId: ulid() })
  await expect(
    draft([
      { accountId: bank, debit: 100, credit: 0 },
      { accountId: capital, debit: 0, credit: 100 },
    ]),
  ).rejects.toThrow()
})
it('rejects group postings and account type mutation after use', async () => {
  const child = await rpc('account.save', {
    code: '101',
    name: 'Cash child',
    kind: 'asset',
    parentId: bank,
  })
  await expect(
    draft([
      { accountId: bank, debit: 100, credit: 0 },
      { accountId: capital, debit: 0, credit: 100 },
    ]),
  ).rejects.toThrow()
  await post(
    await draft([
      { accountId: child.id, debit: 100, credit: 0 },
      { accountId: capital, debit: 0, credit: 100 },
    ]),
  )
  await expect(
    rpc('account.save', { id: child.id, code: '101', name: 'Bad kind', kind: 'income' }),
  ).rejects.toThrow()
})
it('clerk can prepare drafts but cannot post, close periods or change chart', async () => {
  await e.call(
    'user.save',
    {
      name: 'Clerk',
      username: 'clerk',
      password: 'Clerk-test-password-123!',
      role: 'cashier',
      active: true,
    },
    t,
  )
  t = (
    (await e.call('login', { username: 'clerk', password: 'Clerk-test-password-123!' })) as {
      token: string
    }
  ).token
  const d = await draft([
    { accountId: bank, debit: 100, credit: 0 },
    { accountId: capital, debit: 0, credit: 100 },
  ])
  await expect(post(d)).rejects.toThrow()
  await expect(rpc('account.save', { code: '110', name: 'New', kind: 'asset' })).rejects.toThrow()
  await expect(e.call('invoice.post', {}, t)).rejects.toThrow()
})

it('replays draft creates and edits exactly once after a lost response', async () => {
  const lines = [
      { accountId: bank, debit: 100, credit: 0 },
      { accountId: capital, debit: 0, credit: 100 },
    ],
    clientTxnId = ulid(),
    d = await draft(lines, { clientTxnId })
  expect(await draft(lines, { clientTxnId })).toEqual(d)
  expect(db.prepare('SELECT count(*) n FROM accounting_journals').get()).toEqual({ n: 1 })
  const payload = { id: d.id, version: d.version, clientTxnId: ulid(), memo: 'Updated' }
  const edited = await draft(lines, payload)
  expect(await draft(lines, payload)).toEqual(edited)
  await expect(draft(lines, { ...payload, memo: 'Different' })).rejects.toThrow()
})
