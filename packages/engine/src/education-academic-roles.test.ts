import { it, expect } from 'vitest'
import { openDatabase } from '@xzare/db'
import { BusinessEngine } from './service.js'
it('front desk cannot author classes exams or grades even with valid group IDs', async () => {
  const db = openDatabase(':memory:', 'education')
  try {
    const e = new BusinessEngine(db, 'education'),
      password = 'Education-roles-123!',
      t = (
        (await e.call('setup', {
          businessName: 'QA',
          name: 'QA',
          username: 'owner',
          password,
        })) as any
      ).token
    await e.call(
      'user.save',
      {
        username: 'front',
        name: 'QA',
        role: 'cashier',
        password,
        active: true,
      },
      t,
    )
    const f = ((await e.call('login', { username: 'front', password })) as any)
      .token
    for (const a of ['edu.session.save', 'edu.exam.add', 'edu.grades.save']) {
      await expect(e.call(a, {}, f)).rejects.toThrow('المدرس أو المدير')
    }
  } finally {
    db.close()
  }
})
