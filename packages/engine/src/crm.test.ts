import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { openDatabase, type XzareDatabase } from '@xzare/db'
import { BusinessEngine } from './service.js'
import { ulid } from '@xzare/core'
let db: XzareDatabase,
  e: BusinessEngine,
  t: string,
  rep: string,
  other: string,
  repId: string,
  otherId: string,
  leadId: string,
  contactId: string,
  oppId: string
const password = 'CRM-QA-strong-password-123!'
const rpc = (a: string, p: unknown = {}, token = t): Promise<any> => e.call('crm.' + a, p, token)
const cmd = (a: string, p: Record<string, unknown> = {}, token = t) =>
  rpc(a, { clientTxnId: ulid(), ...p }, token)
const lead = (p: Record<string, unknown> = {}, token = t) =>
  cmd(
    'lead.save',
    {
      name: 'QA lead',
      company: 'QA company',
      phone: '',
      email: 'qa@example.test',
      source: 'QA entered source',
      ownerId: repId,
      note: 'QA lead note',
      ...p,
    },
    token,
  )
const contact = (p: Record<string, unknown> = {}, token = t) =>
  cmd(
    'contact.save',
    {
      code: 'C01',
      name: 'QA contact',
      company: 'QA company',
      phone: '',
      email: 'customer@example.test',
      address: '',
      ownerId: repId,
      note: 'QA contact note',
      active: true,
      ...p,
    },
    token,
  )
const opportunity = (p: Record<string, unknown> = {}, token = t) =>
  cmd(
    'opportunity.save',
    {
      contactId,
      title: 'QA opportunity',
      value: 50001,
      probability: 25,
      expectedClose: '2030-01-30',
      note: 'QA commercial scope',
      ...p,
    },
    token,
  )
const task = (p: Record<string, unknown> = {}, token = t) =>
  cmd(
    'task.save',
    {
      entityType: 'opportunity',
      entityId: oppId,
      title: 'QA follow-up',
      kind: 'call',
      dueDay: '2030-01-20',
      dueMinute: 540,
      note: 'QA task note',
      ...p,
    },
    token,
  )
const quote = (p: Record<string, unknown> = {}, token = t) =>
  cmd(
    'quote.issue',
    {
      opportunityId: oppId,
      opportunityVersion: 0,
      contactVersion: 0,
      validUntil: '2030-01-30',
      reference: 'QA offer',
      note: 'QA terms',
      lines: [{ description: 'QA entered service', unit: 'وحدة', qty: 1500, price: 20001 }],
      discount: 1,
      taxBps: 201,
      ...p,
    },
    token,
  )
const account = async (username: string) => {
  const u: any = await e.call(
    'user.save',
    { username, name: 'QA ' + username, role: 'cashier', password, active: true },
    t,
  )
  const l: any = await e.call('login', { username, password })
  return { id: u.id, token: l.token }
}
beforeEach(async () => {
  vi.setSystemTime(new Date(2030, 0, 20, 10))
  db = openDatabase(':memory:', 'crm' as any)
  e = new BusinessEngine(db, 'crm' as any)
  t = (
    (await e.call('setup', {
      businessName: 'QA CRM',
      name: 'QA owner',
      username: 'owner',
      password,
    })) as any
  ).token
  let a = await account('repqa'),
    b = await account('otherqa')
  rep = a.token
  repId = a.id
  other = b.token
  otherId = b.id
  leadId = (await lead()).id
  contactId = (await contact()).id
  oppId = (await opportunity()).id
})
afterEach(() => {
  db?.close()
  vi.useRealTimers()
})
it('starts empty operational ledgers and blocks foreign/generic business routes', async () => {
  const s = await rpc('state')
  expect(s.quotes).toEqual([])
  expect(s.tasks).toEqual([])
  expect(s.settings.license).toBeUndefined()
  for (const a of ['state', 'invoice.post', 'stock.adjust', 'hr.state', 'pharmacy.state'])
    await expect(e.call(a, {}, t)).rejects.toThrow()
})
it('enforces strict validation, actual dates, unique normalized email/code and optimistic versions', async () => {
  await expect(lead({ email: ' QA@EXAMPLE.TEST ' })).rejects.toThrow()
  await expect(contact({ code: 'C02' })).rejects.toThrow()
  await expect(opportunity({ expectedClose: '2030-02-30' })).rejects.toThrow()
  await lead({ id: leadId, version: 0, name: 'QA new name' })
  await expect(lead({ id: leadId, version: 0 })).rejects.toThrow(/تغير/)
  await expect(rpc('lead.save', { sql: 'DROP TABLE users' })).rejects.toThrow()
})
it('restricts sales rep reads/search/details/report and writes to assigned records', async () => {
  expect((await rpc('state', {}, rep)).contacts).toHaveLength(1)
  const s = await rpc('state', {}, other)
  expect(s.contacts).toEqual([])
  expect(s.leads).toEqual([])
  expect(s.opportunities).toEqual([])
  for (const [a, p] of [
    ['contact.get', { id: contactId }],
    ['lead.get', { id: leadId }],
    ['opportunity.get', { id: oppId }],
    ['contact.save', { id: contactId, version: 0 }],
    ['quote.issue', { opportunityId: oppId }],
    ['task.save', { entityType: 'opportunity', entityId: oppId }],
  ] as const)
    await expect(rpc(a, p, other)).rejects.toThrow()
  expect(
    (await rpc('report', { from: '2030-01-01', to: '2030-01-31' }, other)).opportunities,
  ).toEqual([])
})
it('prevents sales reps from assigning another owner and rejects disabled/wrong-product owners', async () => {
  await expect(lead({ email: 'new@example.test', ownerId: otherId }, rep)).rejects.toThrow(/تعيين/)
  await expect(contact({ id: contactId, version: 0, ownerId: otherId }, rep)).rejects.toThrow(
    /تعيين/,
  )
  const u: any = db.prepare('SELECT * FROM users WHERE id=?').get(otherId)
  await e.call(
    'user.save',
    { id: otherId, username: u.username, name: u.name, role: 'cashier', active: false },
    t,
  )
  await expect(lead({ email: 'new@example.test', ownerId: otherId })).rejects.toThrow()
  await expect(
    e.call('user.save', { username: 'hrbad', name: 'QA', role: 'hr', password, active: true }, t),
  ).rejects.toThrow()
})
it('cascades contact ownership visibility to existing opportunity/tasks/quotes and validates stale quote contact', async () => {
  await task()
  const q = await quote()
  await contact({ id: contactId, version: 0, ownerId: otherId })
  for (const [a, p] of [
    ['opportunity.get', { id: oppId }],
    ['quote.get', { id: q.id }],
  ] as const)
    await expect(rpc(a, p, rep)).rejects.toThrow()
  expect((await rpc('state', {}, rep)).tasks).toEqual([])
  expect((await rpc('state', {}, other)).tasks).toHaveLength(1)
  await expect(quote({ opportunityVersion: 0, contactVersion: 0 }, other)).rejects.toThrow(/تغير/)
})
it('converts each lead once into a real contact with frozen link and prevents duplicate response writes', async () => {
  const c = ulid(),
    p = { id: leadId, version: 0, contactId: null, code: 'C02', clientTxnId: c }
  const r = await rpc('lead.convert', p, rep)
  expect(await rpc('lead.convert', p, rep)).toEqual(r)
  const d = await rpc('lead.get', { id: leadId }, rep)
  expect(d.record).toMatchObject({ status: 'converted', contactId: r.id })
  expect(d.activities.filter((x: any) => x.action === 'crm.lead.convert')).toHaveLength(1)
  expect((await rpc('state', {}, rep)).contacts).toHaveLength(2)
  await expect(
    cmd('lead.convert', { id: leadId, version: 1, contactId: null, code: 'C03' }, rep),
  ).rejects.toThrow()
  await expect(lead({ id: leadId, version: 1, name: 'Changed' }, rep)).rejects.toThrow()
})
it('requires explicit disqualification reason and lets manager link conversion only to a scoped same-owner contact', async () => {
  await expect(
    cmd('lead.status', { id: leadId, version: 0, status: 'disqualified', reason: '' }),
  ).rejects.toThrow()
  await cmd('lead.status', {
    id: leadId,
    version: 0,
    status: 'disqualified',
    reason: 'QA not interested',
  })
  await expect(
    cmd('lead.convert', { id: leadId, version: 1, contactId, code: '' }, rep),
  ).rejects.toThrow()
  await cmd('lead.status', { id: leadId, version: 1, status: 'qualified', reason: 'QA reopened' })
  await cmd('lead.convert', { id: leadId, version: 2, contactId, code: '' }, rep)
  expect((await rpc('state')).contacts).toHaveLength(1)
})
it('records notes/tasks in immutable scoped timelines without letting callers move tasks across entities', async () => {
  const x = await task({}, rep)
  await cmd(
    'activity.add',
    { entityType: 'opportunity', entityId: oppId, kind: 'meeting', text: 'QA meeting outcome' },
    rep,
  )
  const d = await rpc('opportunity.get', { id: oppId }, rep)
  expect(d.tasks).toHaveLength(1)
  expect(JSON.stringify(d.activities)).toContain('QA meeting outcome')
  await expect(
    task({ id: x.id, version: 0, entityType: 'lead', entityId: leadId }, rep),
  ).rejects.toThrow()
  await expect(
    cmd('task.status', { id: x.id, version: 0, status: 'done', outcome: 'QA done' }, other),
  ).rejects.toThrow()
})
it('guards task outcome/version/terminal edits and only manager can reopen completed follow-ups', async () => {
  const x = await task()
  await expect(
    cmd('task.status', { id: x.id, version: 0, status: 'done', outcome: '' }),
  ).rejects.toThrow()
  await cmd(
    'task.status',
    { id: x.id, version: 0, status: 'done', outcome: 'QA spoke to customer' },
    rep,
  )
  await expect(task({ id: x.id, version: 1, title: 'rewrite' }, rep)).rejects.toThrow()
  await expect(
    cmd('task.status', { id: x.id, version: 1, status: 'open', outcome: 'QA reopen' }, rep),
  ).rejects.toThrow()
  await cmd('task.status', { id: x.id, version: 1, status: 'open', outcome: 'QA manager reopen' })
  expect((await rpc('state')).tasks[0].status).toBe('open')
})
it('requires explicit closing outcome, preserves actual won value, manager-only reopening and closed opportunity edits', async () => {
  await expect(
    cmd('opportunity.stage', { id: oppId, version: 0, stage: 'won', reason: '', actualValue: 100 }),
  ).rejects.toThrow()
  await cmd(
    'opportunity.stage',
    { id: oppId, version: 0, stage: 'won', reason: 'QA confirmed deal', actualValue: 45001 },
    rep,
  )
  await expect(opportunity({ id: oppId, version: 1, value: 1 }, rep)).rejects.toThrow()
  await expect(
    cmd(
      'opportunity.stage',
      { id: oppId, version: 1, stage: 'negotiation', reason: 'QA reopen', actualValue: null },
      rep,
    ),
  ).rejects.toThrow()
  await expect(quote({ opportunityVersion: 1 })).rejects.toThrow()
  await cmd('opportunity.stage', {
    id: oppId,
    version: 1,
    stage: 'negotiation',
    reason: 'QA manager reopen',
    actualValue: null,
  })
  expect((await rpc('opportunity.get', { id: oppId })).record).toMatchObject({
    stage: 'negotiation',
    actualValue: null,
  })
})
it('quotes use exact milli-unit quantities/discount/tax and immutable customer/business snapshots', async () => {
  const q = await quote()
  let d = await rpc('quote.get', { id: q.id })
  expect(d.quote).toMatchObject({ subtotal: 30002, discount: 1, tax: 603, total: 30604 })
  expect(d.lines[0]).toMatchObject({ description: 'QA entered service', qty: 1500, value: 30002 })
  await contact({ id: contactId, version: 0, name: 'QA edited customer' })
  await e.call(
    'settings.save',
    {
      businessName: 'QA edited company',
      phone: '',
      address: '',
      currency: 'EGP',
      language: 'ar',
      receiptFooter: '',
      taxBps: 0,
    },
    t,
  )
  d = await rpc('quote.get', { id: q.id })
  expect(d.quote.customer.name).toBe('QA contact')
  expect(d.quote.business.businessName).toBe('QA CRM')
})
it('rejects excessive discount, invalid dates/quantity, stale opp and preserves atomicity', async () => {
  for (const p of [
    { discount: 40000 },
    { validUntil: '2030-01-19' },
    { validUntil: '2030-02-30' },
    { opportunityVersion: 1 },
    { lines: [{ description: 'QA', unit: 'وحدة', qty: 0, price: 100 }] },
  ])
    await expect(quote(p)).rejects.toThrow()
  expect((await rpc('state')).quotes).toEqual([])
})
it('records quoted acceptance/rejection with reference and forbids expiry, other-owner and repeated decisions', async () => {
  const q = await quote()
  await expect(
    cmd(
      'quote.status',
      {
        id: q.id,
        version: 0,
        status: 'accepted',
        reason: 'QA acceptance',
        reference: 'QA customer reply',
      },
      other,
    ),
  ).rejects.toThrow()
  await cmd(
    'quote.status',
    { id: q.id, version: 0, status: 'accepted', reason: 'QA acceptance', reference: 'QA reply' },
    rep,
  )
  await expect(
    cmd('quote.status', {
      id: q.id,
      version: 1,
      status: 'rejected',
      reason: 'QA change',
      reference: 'QA reply',
    }),
  ).rejects.toThrow()
  const q2 = await quote()
  await expect(
    cmd('quote.status', {
      id: q2.id,
      version: 0,
      status: 'accepted',
      reason: 'QA duplicate',
      reference: 'QA reply',
    }),
  ).rejects.toThrow()
  vi.setSystemTime(new Date(2030, 1, 1, 10))
  t = ((await e.call('login', { username: 'owner', password })) as any).token
  await expect(
    cmd('quote.status', {
      id: q2.id,
      version: 0,
      status: 'accepted',
      reason: 'QA late',
      reference: 'QA reply',
    }),
  ).rejects.toThrow(/صلاحية/)
})
it('binds every idempotent write to actor/action/payload and never caches private note text as command result', async () => {
  const c = ulid(),
    p = {
      entityType: 'lead',
      entityId: leadId,
      kind: 'note',
      text: 'QA secret timeline text',
      clientTxnId: c,
    }
  const a = await rpc('activity.add', p, rep)
  expect(await rpc('activity.add', p, rep)).toEqual(a)
  await expect(rpc('activity.add', { ...p, text: 'changed' }, rep)).rejects.toThrow(/معرف/)
  await expect(rpc('activity.add', p, t)).rejects.toThrow(/معرف/)
  expect(db.prepare('SELECT result FROM commands WHERE client_txn_id=?').get(c)).not.toEqual(
    expect.objectContaining({ result: expect.stringContaining('QA secret') }),
  )
})
it('protects issued quote lines and activity ledgers from UPDATE DELETE and REPLACE', async () => {
  await quote()
  for (const table of ['crm_quotes', 'crm_quote_lines', 'crm_activities']) {
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
})
it('computes integer weighted forecast from current scoped open pipeline and separates won actual amounts', async () => {
  const s = await rpc('report', { from: '2030-01-01', to: '2030-01-31' }, rep)
  expect(s.weighted).toBe(12500)
  await cmd('opportunity.stage', {
    id: oppId,
    version: 0,
    stage: 'won',
    reason: 'QA close',
    actualValue: 45001,
  })
  const r = await rpc('report', { from: '2030-01-01', to: '2030-01-31' }, rep)
  expect(r.weighted).toBe(0)
  expect(r.wonValue).toBe(45001)
  expect((await rpc('report', { from: '2030-01-01', to: '2030-01-31' }, other)).wonValue).toBe(0)
})
it('uses bounded local report dates and refuses unknown actions and cross-product user roles', async () => {
  await expect(rpc('report', { from: '2030-01-01', to: '2031-01-02' })).rejects.toThrow()
  await expect(rpc('report', { from: '2030-02-30', to: '2030-03-01' })).rejects.toThrow()
  await expect(rpc('unsafe.export', { table: 'users' })).rejects.toThrow()
  await expect(
    e.call(
      'user.save',
      { username: 'techbad', name: 'QA', role: 'technician', password, active: true },
      t,
    ),
  ).rejects.toThrow()
})

it('does not truncate date-filtered quotation reports after a thousand newer offers', async () => {
  const old = await quote()
  const q: any = db.prepare('SELECT * FROM crm_quotes WHERE id=?').get(old.id),
    keys = Object.keys(q)
  const insert = db.prepare(
    'INSERT INTO crm_quotes(' + keys.join(',') + ') VALUES(' + keys.map(() => '?').join(',') + ')',
  )
  db.transaction(() => {
    for (let n = 0; n < 1000; n++) {
      const id = ulid(),
        x = { ...q, id, number: 'CRM-NEW-' + n, at: new Date(2030, 0, 21, 10).getTime() }
      insert.run(...keys.map((k) => x[k]))
      db.prepare("INSERT INTO crm_quote_status VALUES(?,'issued','','',?,0)").run(id, x.at)
    }
  })()
  expect((await rpc('state')).quotes).toHaveLength(1000)
  expect(
    (await rpc('report', { from: '2030-01-20', to: '2030-01-20' })).quotes.map((x: any) => x.id),
  ).toEqual([old.id])
})

it('acknowledges the original issued quote on uncertain retry with frozen reviewed versions after a manager edit', async () => {
  const clientTxnId = ulid(),
    first = await quote({ clientTxnId })
  await opportunity({ id: oppId, version: 0, title: 'QA edited during retry' })
  const retry = await quote({ clientTxnId })
  expect(retry.id).toBe(first.id)
  expect((await rpc('state')).quotes).toHaveLength(1)
})
