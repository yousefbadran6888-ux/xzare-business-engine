import { beforeEach, afterEach, it, expect } from 'vitest'
import { openDatabase, type XzareDatabase } from '@xzare/db'
import { BusinessEngine } from './service.js'
import { ulid } from '@xzare/core'
import { clinicToday } from './clinic-time.js'
let db: XzareDatabase,
  e: BusinessEngine,
  owner: string,
  front: string,
  teacher: string,
  other: string,
  teacherUid: string,
  otherUid: string,
  sid: string,
  cid: string,
  tid: string,
  gid: string,
  eid: string
const pass = 'Education-QA-password-123!'
const today = clinicToday()
const rpc = (a: string, p: unknown = {}, t = owner): Promise<any> =>
  e.call('edu.' + a, p, t)
const cmd = (a: string, p: Record<string, unknown> = {}, t = owner) =>
  rpc(a, { ...p, clientTxnId: ulid() }, t)
const student = (p: Record<string, unknown> = {}) =>
  cmd('student.save', {
    code: 'S01',
    name: 'QA Student',
    phone: 'QA phone',
    guardian: 'QA guardian',
    guardianPhone: 'QA guardian phone',
    birthDay: null,
    level: 'QA Level',
    note: 'private family note',
    active: true,
    ...p,
  })
const group = (p: Record<string, unknown> = {}) =>
  cmd('group.save', {
    code: 'G01',
    name: 'QA Group',
    courseId: cid,
    teacherId: tid,
    startDay: today,
    endDay: '2030-12-31',
    fee: 10001,
    capacity: 2,
    note: 'private group admin note',
    active: true,
    ...p,
  })
const enroll = (p: Record<string, unknown> = {}) =>
  cmd('enrollment.add', {
    studentId: sid,
    studentVersion: 0,
    groupId: gid,
    groupVersion: 0,
    discount: 1,
    ...p,
  })
const session = (p: Record<string, unknown> = {}, t = owner) =>
  cmd(
    'session.save',
    {
      groupId: gid,
      day: today,
      startMinute: 600,
      duration: 60,
      title: 'QA Lesson',
      note: 'QA academic note',
      ...p,
    },
    t,
  )
const exam = (p: Record<string, unknown> = {}, t = owner) =>
  cmd(
    'exam.add',
    {
      groupId: gid,
      day: today,
      title: 'QA Exam',
      maxScore: 10000,
      note: 'QA exam',
      ...p,
    },
    t,
  )
it('accepts actual birth dates for adult trainees', async () => {
  await expect(
    student({ code: 'ADULT', birthDay: '1990-05-21' }),
  ).resolves.toBeTruthy()
})
beforeEach(async () => {
  db = openDatabase(':memory:', 'education' as any)
  e = new BusinessEngine(db, 'education' as any)
  owner = (
    (await e.call('setup', {
      businessName: 'QA Center',
      name: 'QA owner',
      username: 'ownerqa',
      password: pass,
    })) as any
  ).token
  for (const [username, role] of [
    ['frontqa', 'cashier'],
    ['teacherqa', 'teacher'],
    ['otherqa', 'teacher'],
  ])
    await e.call(
      'user.save',
      { username, name: username, password: pass, role, active: true },
      owner,
    )
  let u = db.prepare('select id,username from users').all() as any[]
  teacherUid = u.find((x) => x.username === 'teacherqa').id
  otherUid = u.find((x) => x.username === 'otherqa').id
  front = (
    (await e.call('login', { username: 'frontqa', password: pass })) as any
  ).token
  teacher = (
    (await e.call('login', { username: 'teacherqa', password: pass })) as any
  ).token
  other = (
    (await e.call('login', { username: 'otherqa', password: pass })) as any
  ).token
  sid = (await student()).id
  cid = (
    await cmd('course.save', {
      code: 'C01',
      name: 'QA Course',
      description: 'QA syllabus',
      active: true,
    })
  ).id
  tid = (
    await cmd('teacher.save', {
      code: 'T01',
      name: 'QA Teacher',
      phone: 'private staff phone',
      note: 'private staff note',
      userId: teacherUid,
      active: true,
    })
  ).id
  gid = (await group()).id
  eid = (await enroll()).id
})
afterEach(() => db.close())
it('starts empty with distinct identity and blocks legacy POS routes', async () => {
  const fresh = openDatabase(':memory:', 'education' as any),
    x = new BusinessEngine(fresh, 'education' as any)
  try {
    const t = (
      (await x.call('setup', {
        businessName: 'QA',
        name: 'QA',
        username: 'emptyqa',
        password: pass,
      })) as any
    ).token
    const s = (await x.call('edu.state', {}, t)) as any
    expect(s.students).toEqual([])
    expect(s.groups).toEqual([])
    expect(fresh.pragma('application_id', { simple: true })).toBe(0x585a4544)
    await expect(x.call('state', {}, t)).rejects.toThrow()
    await expect(x.call('invoice.post', {}, t)).rejects.toThrow()
  } finally {
    fresh.close()
  }
})
it('strictly validates real dates, unique codes, roles and stale student/group versions', async () => {
  await expect(
    student({ code: 'S02', birthDay: '2026-02-30' }),
  ).rejects.toThrow()
  await expect(student({ name: 'duplicate' })).rejects.toThrow()
  await student({ id: sid, version: 0, name: 'QA corrected' })
  await expect(
    student({ id: sid, version: 0, name: 'stale' }),
  ).rejects.toThrow()
  await expect(group({ startDay: '2031-01-01' })).rejects.toThrow()
  await expect(
    e.call(
      'user.save',
      {
        username: 'doctorqa',
        name: 'QA',
        role: 'doctor',
        password: pass,
        active: true,
      },
      owner,
    ),
  ).rejects.toThrow()
  await expect(
    cmd(
      'group.save',
      {
        code: 'BAD',
        name: 'Bad',
        courseId: cid,
        teacherId: tid,
        startDay: today,
        endDay: '2030-12-31',
        fee: 1,
        capacity: 2,
        note: '',
        active: true,
      },
      front,
    ),
  ).rejects.toThrow()
})
it('teacher sees assigned academic records only and every detail excludes contacts and money', async () => {
  const s = await rpc('state', {}, teacher)
  expect(s.groups).toHaveLength(1)
  expect(s.students).toHaveLength(1)
  expect(s.enrollments[0]).not.toHaveProperty('balance')
  expect(JSON.stringify(s)).not.toContain('private family')
  expect(JSON.stringify(s)).not.toContain('QA guardian')
  expect(JSON.stringify(s)).not.toContain('private staff')
  expect(s.groups[0]).not.toHaveProperty('fee')
  expect((await rpc('state', {}, other)).students).toEqual([])
  await expect(rpc('student.get', { id: sid }, other)).rejects.toThrow()
  await expect(rpc('enrollment.get', { id: eid }, teacher)).rejects.toThrow()
  expect(
    (await rpc('student.get', { id: sid }, teacher)).student,
  ).not.toHaveProperty('phone')
  await expect(student({ id: sid, version: 0 })).resolves.toBeTruthy()
})
it('teacher reassignment immediately removes prior access including old class/exam details', async () => {
  const l = await session(),
    q = await exam()
  const nt = (
    await cmd('teacher.save', {
      code: 'T02',
      name: 'QA other',
      phone: '',
      note: '',
      userId: otherUid,
      active: true,
    })
  ).id
  await group({ id: gid, version: 0, teacherId: nt })
  expect((await rpc('state', {}, teacher)).groups).toHaveLength(0)
  await expect(rpc('session.get', { id: l.id }, teacher)).rejects.toThrow()
  await expect(rpc('exam.get', { id: q.id }, teacher)).rejects.toThrow()
  expect((await rpc('state', {}, other)).groups).toHaveLength(1)
})
it('enrollment snapshots fees and enforces capacity duplicate active status and reviewed versions', async () => {
  await expect(enroll()).rejects.toThrow()
  let s2 = (await student({ code: 'S02', name: 'QA second' })).id
  await enroll({ studentId: s2 })
  let s3 = (await student({ code: 'S03', name: 'QA third' })).id
  await expect(enroll({ studentId: s3 })).rejects.toThrow()
  await group({ id: gid, version: 0, fee: 20000 })
  const d = await rpc('enrollment.get', { id: eid })
  expect(d.enrollment.fee).toBe(10001)
  expect(d.enrollment.balance).toBe(10000)
  await expect(enroll({ studentId: s3, groupVersion: 0 })).rejects.toThrow()
})
it('cancels enrollment only before academic roster and collection and releases capacity with immutable cancellation', async () => {
  await cmd('enrollment.cancel', {
    id: eid,
    version: 0,
    reason: 'QA entered wrong group',
  })
  const d = await rpc('enrollment.get', { id: eid })
  expect(d.enrollment.status).toBe('cancelled')
  expect(d.enrollment.balance).toBe(0)
  expect(d.ledger.map((x: any) => x.kind)).toContain('cancel')
  const x = await enroll()
  await session()
  await expect(
    cmd('enrollment.cancel', { id: x.id, version: 0, reason: 'QA reason' }),
  ).rejects.toThrow()
})
it('collection uses exact due amounts and immutable receipt identity, never overcollecting', async () => {
  const p = await cmd(
    'payment.post',
    {
      enrollmentId: eid,
      enrollmentVersion: 0,
      amount: 3333,
      method: 'cash',
      reference: 'QA cash count',
    },
    front,
  )
  await expect(
    cmd('payment.post', {
      enrollmentId: eid,
      enrollmentVersion: 1,
      amount: 6668,
      method: 'cash',
      reference: 'QA',
    }),
  ).rejects.toThrow()
  await cmd('payment.post', {
    enrollmentId: eid,
    enrollmentVersion: 1,
    amount: 6667,
    method: 'card',
    reference: 'QA terminal record',
  })
  const d = await rpc('enrollment.get', { id: eid })
  expect(d.enrollment.balance).toBe(0)
  expect(d.payments).toHaveLength(2)
  expect(d.payments[0].student.name).toBe('QA Student')
  await student({ id: sid, version: 0, name: 'QA changed' })
  expect(
    (await rpc('enrollment.get', { id: eid })).payments.find(
      (x: any) => x.id === p.id,
    ).student.name,
  ).toBe('QA Student')
})
it('manager-only receipt void happens once and reverses the original payment exactly', async () => {
  const p = await cmd('payment.post', {
    enrollmentId: eid,
    enrollmentVersion: 0,
    amount: 3001,
    method: 'cash',
    reference: 'QA',
  })
  await expect(
    cmd('payment.void', { id: p.id, reason: 'QA correction' }, front),
  ).rejects.toThrow()
  await cmd('payment.void', { id: p.id, reason: 'QA duplicate receipt' })
  expect((await rpc('enrollment.get', { id: eid })).enrollment.balance).toBe(
    10000,
  )
  await expect(
    cmd('payment.void', { id: p.id, reason: 'QA again' }),
  ).rejects.toThrow()
})
it('bounded manager credit has explicit reason and never creates negative receivables', async () => {
  await expect(
    cmd(
      'credit.post',
      { enrollmentId: eid, enrollmentVersion: 0, amount: 1, reason: 'QA' },
      front,
    ),
  ).rejects.toThrow()
  await expect(
    cmd('credit.post', {
      enrollmentId: eid,
      enrollmentVersion: 0,
      amount: 10001,
      reason: 'QA',
    }),
  ).rejects.toThrow()
  await cmd('credit.post', {
    enrollmentId: eid,
    enrollmentVersion: 0,
    amount: 1,
    reason: 'QA approved fee correction',
  })
  await cmd('payment.post', {
    enrollmentId: eid,
    enrollmentVersion: 1,
    amount: 9999,
    method: 'cash',
    reference: 'QA',
  })
  expect((await rpc('enrollment.get', { id: eid })).enrollment.balance).toBe(0)
})
it('session roster freezes enrollment/name and does not add later registrations silently', async () => {
  const l = await session({}, teacher)
  await student({ id: sid, version: 0, name: 'QA renamed' })
  const s2 = (await student({ code: 'S02', name: 'QA late join' })).id
  await enroll({ studentId: s2 })
  const d = await rpc('session.get', { id: l.id }, teacher)
  expect(d.roster).toHaveLength(1)
  expect(d.roster[0].studentName).toBe('QA Student')
  await expect(
    cmd(
      'attendance.save',
      {
        sessionId: l.id,
        version: 0,
        marks: [
          { enrollmentId: eid, status: 'present', note: '' },
          { enrollmentId: '0'.repeat(26), status: 'present', note: '' },
        ],
      },
      teacher,
    ),
  ).rejects.toThrow()
})
it('blocks teacher overlapping sessions and dates outside the actual group period', async () => {
  await session()
  await expect(session({ startMinute: 650 })).rejects.toThrow()
  await session({ startMinute: 660 })
  await expect(session({ day: '2031-01-01' })).rejects.toThrow()
  const l = await rpc('state')
  await cmd('session.cancel', {
    id: l.sessions[0].id,
    version: 0,
    reason: 'QA cancelled',
  })
  await expect(
    cmd('attendance.save', {
      sessionId: l.sessions[0].id,
      version: 1,
      marks: [{ enrollmentId: eid, status: 'present', note: '' }],
    }),
  ).rejects.toThrow()
})
it('attendance requires full reviewed roster, valid versions and preserves correction events', async () => {
  const l = await session()
  await expect(
    cmd('attendance.save', { sessionId: l.id, version: 0, marks: [] }, teacher),
  ).rejects.toThrow()
  await cmd(
    'attendance.save',
    {
      sessionId: l.id,
      version: 0,
      marks: [{ enrollmentId: eid, status: 'late', note: 'QA late arrival' }],
    },
    teacher,
  )
  await expect(
    cmd(
      'attendance.save',
      {
        sessionId: l.id,
        version: 0,
        marks: [{ enrollmentId: eid, status: 'present', note: '' }],
      },
      teacher,
    ),
  ).rejects.toThrow()
  await cmd(
    'attendance.save',
    {
      sessionId: l.id,
      version: 1,
      marks: [{ enrollmentId: eid, status: 'present', note: 'QA correction' }],
    },
    teacher,
  )
  expect((await rpc('session.get', { id: l.id })).roster[0].status).toBe(
    'present',
  )
  expect(
    db
      .prepare('select count(*) n from edu_events where action=?')
      .get('edu.attendance.save'),
  ).toMatchObject({ n: 2 })
})
it('exam grades are explicit capped marks with snapshot roster and protected published correction', async () => {
  const q = await exam({}, teacher)
  await expect(
    cmd(
      'grades.save',
      {
        examId: q.id,
        version: 0,
        grades: [{ enrollmentId: eid, score: 10001, note: '' }],
        publish: true,
        reason: 'QA entered marks',
      },
      teacher,
    ),
  ).rejects.toThrow()
  await cmd(
    'grades.save',
    {
      examId: q.id,
      version: 0,
      grades: [{ enrollmentId: eid, score: 7550, note: 'QA manual score' }],
      publish: true,
      reason: 'QA checked paper',
    },
    teacher,
  )
  await expect(
    cmd(
      'grades.save',
      {
        examId: q.id,
        version: 1,
        grades: [{ enrollmentId: eid, score: 8000, note: '' }],
        publish: true,
        reason: 'QA correction',
      },
      teacher,
    ),
  ).rejects.toThrow()
  await cmd('grades.save', {
    examId: q.id,
    version: 1,
    grades: [{ enrollmentId: eid, score: 8000, note: '' }],
    publish: true,
    reason: 'QA manager reviewed correction',
  })
  const d = await rpc('exam.get', { id: q.id }, teacher)
  expect(d.roster[0].score).toBe(8000)
  expect(d.exam.status).toBe('published')
  expect(d).not.toHaveProperty('passFail')
})
it('published grades require all rows explicitly present including absent null scores', async () => {
  const q = await exam()
  await expect(
    cmd('grades.save', {
      examId: q.id,
      version: 0,
      grades: [],
      publish: true,
      reason: 'QA',
    }),
  ).rejects.toThrow()
  await cmd('grades.save', {
    examId: q.id,
    version: 0,
    grades: [{ enrollmentId: eid, score: null, note: 'QA absent' }],
    publish: true,
    reason: 'QA recorded absence',
  })
  expect((await rpc('exam.get', { id: q.id })).roster[0].score).toBeNull()
})
it('actor action and payload bind uncertain write retries without caching family data', async () => {
  const p = {
    enrollmentId: eid,
    enrollmentVersion: 0,
    amount: 2001,
    method: 'cash',
    reference: 'QA',
    clientTxnId: ulid(),
  }
  const r = await rpc('payment.post', p, front)
  expect(await rpc('payment.post', p, front)).toEqual(r)
  await expect(rpc('payment.post', p, owner)).rejects.toThrow()
  await expect(
    rpc('payment.post', { ...p, amount: 2002 }, front),
  ).rejects.toThrow()
  expect(db.prepare('select count(*) n from edu_payments').get()).toMatchObject(
    { n: 1 },
  )
  expect(
    JSON.parse(
      (
        db
          .prepare('select result from commands where client_txn_id=?')
          .get(p.clientTxnId) as any
      ).result,
    ),
  ).toEqual({ id: r.id })
})
it('immutable fees receipts roster snapshots and event history reject UPDATE DELETE REPLACE', async () => {
  await session()
  await exam()
  await cmd('payment.post', {
    enrollmentId: eid,
    enrollmentVersion: 0,
    amount: 1,
    method: 'cash',
    reference: 'QA',
  })
  for (const table of [
    'edu_fee_ledger',
    'edu_payments',
    'edu_session_roster',
    'edu_exam_roster',
    'edu_events',
  ]) {
    const x = db.prepare('select * from ' + table + ' limit 1').get() as any
    expect(x).toBeTruthy()
    expect(() =>
      db.prepare('delete from ' + table + ' where id=?').run(x.id),
    ).toThrow()
    expect(() =>
      db.prepare('update ' + table + ' set id=id where id=?').run(x.id),
    ).toThrow()
    const keys = Object.keys(x)
    expect(() =>
      db
        .prepare(
          'insert or replace into ' +
            table +
            '(' +
            keys.join(',') +
            ') values(' +
            keys.map(() => '?').join(',') +
            ')',
        )
        .run(...Object.values(x)),
    ).toThrow()
  }
})
it('teacher reports omit finance and scope attendance/marks; daily financial report reconciles voids', async () => {
  const l = await session()
  await cmd(
    'attendance.save',
    {
      sessionId: l.id,
      version: 0,
      marks: [{ enrollmentId: eid, status: 'present', note: '' }],
    },
    teacher,
  )
  let p = await cmd('payment.post', {
    enrollmentId: eid,
    enrollmentVersion: 0,
    amount: 2222,
    method: 'cash',
    reference: 'QA',
  })
  await cmd('payment.void', { id: p.id, reason: 'QA' })
  await cmd('payment.post', {
    enrollmentId: eid,
    enrollmentVersion: 2,
    amount: 1000,
    method: 'cash',
    reference: 'QA',
  })
  const r = await rpc('report', { from: today, to: today })
  expect(r.finance.netCollected).toBe(1000)
  expect(r.finance.outstanding).toBe(9000)
  expect(
    (await rpc('report', { from: today, to: today }, teacher)).finance,
  ).toBeNull()
  expect(
    (await rpc('report', { from: today, to: today }, other)).attendance,
  ).toEqual([])
  await expect(
    rpc('report', { from: '2025-01-01', to: '2030-01-01' }),
  ).rejects.toThrow()
})
