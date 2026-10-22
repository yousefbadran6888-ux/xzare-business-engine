import { it, expect } from 'vitest'
import { passwordForm } from './Forms'
it('changes password using the server contract and preserves spaces', () => {
  const f = new FormData()
  f.set('current', ' old password ')
  f.set('next', ' new password 42 ')
  f.set('confirm', ' new password 42 ')
  expect(passwordForm().payload(f)).toEqual({
    current: ' old password ',
    password: ' new password 42 ',
  })
  f.set('confirm', 'mismatch')
  expect(() => passwordForm().payload(f)).toThrow()
})

import { userForm, guestForm } from './Forms'
import { schemas } from '../../../packages/engine/src/validation'
it('existing user edits include required username and preserve optional password', () => {
  const f = new FormData()
  f.set('name', 'QA Reception')
  f.set('role', 'cashier')
  f.set('active', 'on')
  const payload = userForm({
    id: '0'.repeat(26),
    name: 'QA',
    username: 'frontqa',
    role: 'cashier',
    active: 1,
  }).payload(f)
  expect(payload.username).toBe('frontqa')
  expect(schemas['user.save'].safeParse(payload).success).toBe(true)
})
it('reception cannot send a hidden guest identity document when editing a guest', () => {
  const f = new FormData()
  for (const [k, v] of Object.entries({
    code: 'G1',
    name: 'QA Guest',
    phone: '1',
    document: 'forged',
    note: '',
    active: 'on',
  }))
    f.set(k, v)
  expect(guestForm(false).payload(f).document).toBe('')
})
