import { it, expect } from 'vitest'
import { ScopeGate } from './scope'
it('rejects a pending student response from a removed group even if the student remains in another group', async () => {
  const gate = new ScopeGate(),
    before = {
      user: { role: 'teacher' },
      groups: [{ id: 'A' }, { id: 'B' }],
      students: [{ id: 'S' }],
    },
    after = { ...before, groups: [{ id: 'B' }] }
  gate.update(before as any)
  const ticket = gate.ticket()
  let resolve!: (x: string) => void
  const pending = new Promise<string>((r) => (resolve = r))
  const result = pending.then((data) =>
    gate.accept(ticket, 'student', 'S') ? data : null,
  )
  gate.update(after as any)
  resolve('previous response with A and B enrollment details')
  expect(await result).toBeNull()
  expect(gate.accept(gate.ticket(), 'student', 'S')).toBe(true)
})
it('rejects pending report and details after logout or a privilege contraction', () => {
  const gate = new ScopeGate()
  gate.update({ user: { role: 'admin' }, groups: [], students: [] } as any)
  const ticket = gate.ticket()
  gate.update({ user: { role: 'teacher' }, groups: [], students: [] } as any)
  expect(gate.current(ticket)).toBe(false)
  const next = gate.ticket()
  gate.clear()
  expect(gate.current(next)).toBe(false)
})
