import { it, expect } from 'vitest'
import { passwordValue } from './model'
it('password fields preserve exact spaces used during setup and login', () => {
  const f = new FormData()
  f.set('current', '  exact password  ')
  f.set('password', '  new secret pass  ')
  f.set('confirm', 'new secret pass')
  expect(passwordValue(f, 'current')).toBe('  exact password  ')
  expect(passwordValue(f, 'password')).not.toBe(passwordValue(f, 'confirm'))
  expect(passwordValue(f, 'missing')).toBe('')
})
