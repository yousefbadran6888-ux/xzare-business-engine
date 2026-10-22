import { it, expect } from 'vitest'
import { userForm, passwordForm } from './Forms'
import { readMoney } from './model'
import { EstateScope, freshCaptured } from './scope'
it('sends existing usernames and the password change server contract without trimming secrets', () => {
  const u = { id: 'user', username: 'owner', name: 'QA', role: 'admin', active: 1 } as any,
    f = new FormData()
  f.set('name', 'Changed')
  f.set('role', 'manager')
  f.set('active', 'on')
  f.set('password', '  Strong-secret-42!  ')
  expect(userForm(u).payload(f)).toMatchObject({
    id: 'user',
    username: 'owner',
    password: '  Strong-secret-42!  ',
    active: true,
  })
  f.set('current', '  original-secret  ')
  f.set('next', '  new-strong-secret  ')
  f.set('confirm', '  new-strong-secret  ')
  expect(passwordForm().payload(f)).toEqual({
    current: '  original-secret  ',
    password: '  new-strong-secret  ',
  })
})
it('rejects fractional minor units, negative values and unsafe amounts', () => {
  expect(readMoney('100.01')).toBe(10001)
  for (const value of ['-1', '1.001', 'NaN', '10000000000.01'])
    expect(() => readMoney(value)).toThrow()
})
it('invalidates private pending responses on role loss and never resurrects a closed document', () => {
  const scope = new EstateScope()
  scope.update({ id: 'u', role: 'admin' })
  const ticket = scope.ticket()
  expect(scope.update({ id: 'u', role: 'cashier' })).toBe(true)
  expect(scope.current(ticket)).toBe(false)
  expect(freshCaptured(null, { id: 'doc' }, { id: 'doc' })).toBeNull()
  expect(freshCaptured({ id: 'new' }, { id: 'doc' }, { id: 'doc' })).toEqual({ id: 'new' })
})
