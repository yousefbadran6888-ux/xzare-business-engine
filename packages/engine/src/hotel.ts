import { ulid } from '@xzare/core'
import type { XzareDatabase } from '@xzare/db'
import { Identity } from './identity.js'
import { fingerprint } from './commerce.js'
import { clinicToday, clinicDayBounds } from './clinic-time.js'
import {
  hotelSchemas,
  type HotelState,
  type HotelReservation,
  type HotelReport,
} from './hotel-validation.js'
import type { User } from './types.js'
const manage = (u: User) => ['admin', 'manager'].includes(u.role)
const safe = (n: number) => {
  if (!Number.isSafeInteger(n) || Math.abs(n) > 1e12)
    throw Error('المبلغ تجاوز الحد الآمن')
  return n
}
const aggregate = (n: number) => {
  if (!Number.isSafeInteger(n)) throw Error('الإجمالي تجاوز الحد الآمن')
  return n === 0 ? 0 : n
}
export const hotelNights = (a: string, b: string) => {
  const n =
    (Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000
  if (!Number.isInteger(n) || n < 1 || n > 366)
    throw Error('مدة الإقامة من ليلة حتى 366 ليلة')
  return n
}
const rq =
  'SELECT id,code,name,category,floor,capacity,rate,active,blocked,cleanliness,at,version FROM hotel_rooms'
const gq =
  'SELECT id,code,name,phone,document,note,active,at,version FROM hotel_guests'
const bq = `SELECT r.id,r.number,r.guest_id AS guestId,r.room_id AS roomId,r.guest_json AS guest,r.room_json AS room,r.business_json AS business,r.arrival,r.departure,r.adults,r.rate,r.discount,r.note,r.status,r.checkin_at AS checkinAt,r.checkout_at AS checkoutAt,r.at,r.version FROM hotel_reservations r`
const pq = `SELECT p.id,p.number,p.reservation_id AS reservationId,p.kind,p.amount,p.method,p.reference,p.reason,p.guest_json AS guest,p.room_json AS room,p.business_json AS business,p.actor_name AS actorName,p.at,(SELECT v.reason FROM hotel_payment_voids v WHERE v.payment_id=p.id) AS voidReason FROM hotel_payments p`
const localDay = (n: number) => {
  const d = new Date(n)
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  )
}
export class Hotel {
  constructor(
    readonly db: XzareDatabase,
    readonly identity: Identity,
  ) {}
  private row(sql: string, ...a: any[]): any {
    return this.db.prepare(sql).get(...a)
  }
  private rows(sql: string, ...a: any[]): any[] {
    return this.db.prepare(sql).all(...a)
  }
  private manager(u: User) {
    if (!manage(u)) throw Error('هذه العملية تحتاج مدير الفندق')
  }
  private version(x: any, v: unknown) {
    if (x && x.version !== v)
      throw Error('البيانات تغيرت؛ حدّث العرض وأعد المحاولة')
    if (!x && v !== undefined) throw Error('الإصدار يخص التعديل')
  }
  private room(id: string) {
    const r = this.row(rq + ' WHERE id=?', id)
    if (!r) throw Error('الغرفة غير موجودة')
    return r
  }
  private guest(id: string, u: User) {
    const g = this.row(gq + ' WHERE id=?', id)
    if (!g) throw Error('النزيل غير موجود')
    if (!manage(u)) {
      delete g.document
    }
    return g
  }
  private business() {
    return Object.fromEntries(
      this.rows('SELECT key,value FROM settings')
        .filter((s) =>
          [
            'businessName',
            'phone',
            'address',
            'receiptFooter',
            'currency',
          ].includes(s.key),
        )
        .map((s) => [s.key, s.value]),
    )
  }
  private totals(id: string) {
    const l = this.rows(
      'SELECT kind,amount FROM hotel_ledger WHERE reservation_id=?',
      id,
    )
    const total = aggregate(
      l
        .filter((x) =>
          ['room', 'adjustment', 'extra', 'extra-void', 'cancel'].includes(
            x.kind,
          ),
        )
        .reduce((n, x) => n + x.amount, 0),
    )
    const collected = aggregate(
      -l
        .filter((x) => ['receipt', 'refund', 'payment-void'].includes(x.kind))
        .reduce((n, x) => n + x.amount, 0),
    )
    return { total, collected, balance: aggregate(total - collected) }
  }
  private decode(b: any): HotelReservation {
    const nights = hotelNights(b.arrival, b.departure)
    return {
      ...b,
      guest: JSON.parse(b.guest),
      room: JSON.parse(b.room),
      business: JSON.parse(b.business),
      nights,
      roomTotal: safe(nights * b.rate - b.discount),
      ...this.totals(b.id),
    }
  }
  private reservation(id: string) {
    const b = this.row(bq + ' WHERE r.id=?', id)
    if (!b) throw Error('الحجز غير موجود')
    return this.decode(b)
  }
  private reservations(where = '', ...a: any[]) {
    return this.rows(bq + where, ...a).map((b) => this.decode(b))
  }
  private payments(where = '', ...a: any[]) {
    return this.rows(pq + where, ...a).map((p) => ({
      ...p,
      guest: JSON.parse(p.guest),
      room: JSON.parse(p.room),
      business: JSON.parse(p.business),
    }))
  }
  private bump(id: string) {
    this.db
      .prepare('UPDATE hotel_reservations SET version=version+1 WHERE id=?')
      .run(id)
  }
  private number(
    table: 'hotel_reservations' | 'hotel_payments',
    prefix: string,
  ) {
    return (
      prefix +
      String(this.row('SELECT count(*)+1 AS n FROM ' + table).n).padStart(
        6,
        '0',
      )
    )
  }
  private event(
    type: string,
    id: string,
    action: string,
    reason: string,
    snapshot: unknown,
    u: User,
  ) {
    this.db
      .prepare('INSERT INTO hotel_events VALUES(?,?,?,?,?,?,?,?,?)')
      .run(
        ulid(),
        type,
        id,
        action,
        reason,
        JSON.stringify(snapshot),
        u.id,
        u.name,
        Date.now(),
      )
  }
  private events(type: string, id: string) {
    return this.rows(
      'SELECT id,action,reason,snapshot,actor_name AS actorName,at FROM hotel_events WHERE entity_type=? AND entity_id=? ORDER BY rowid DESC',
      type,
      id,
    )
  }
  private ledger(
    id: string,
    kind: string,
    amount: number,
    ref: string | null,
    reason: string,
    u: User,
  ) {
    this.db
      .prepare('INSERT INTO hotel_ledger VALUES(?,?,?,?,?,?,?,?,?)')
      .run(
        ulid(),
        id,
        kind,
        safe(amount),
        ref,
        reason,
        u.id,
        u.name,
        Date.now(),
      )
    const ts = this.totals(id)
    if (ts.total < 0 || ts.collected < 0 || ts.balance < 0)
      throw Error('التصحيح سيجعل الحساب غير متوازن')
    for (const group of [
      "'room','adjustment','extra','extra-void','cancel'",
      "'receipt','refund','payment-void'",
    ])
      aggregate(
        this.row(
          'SELECT COALESCE(sum(amount),0) AS n FROM hotel_ledger WHERE kind IN(' +
            group +
            ')',
        ).n,
      )
  }
  private open(b: HotelReservation) {
    if (!['reserved', 'in-house'].includes(b.status))
      throw Error('الحساب مغلق ولا يقبل تعديلًا')
  }
  private overlap(roomId: string, a: string, b: string, except = '') {
    const today = clinicToday(),
      next = new Date(Date.parse(today + 'T12:00:00Z') + 86400000)
        .toISOString()
        .slice(0, 10)
    return this.row(
      `SELECT id FROM hotel_reservations WHERE room_id=? AND id!=? AND status IN('reserved','in-house') AND arrival<? AND CASE WHEN status='in-house' AND departure<=? THEN ? ELSE departure END>? LIMIT 1`,
      roomId,
      except,
      b,
      today,
      next,
      a,
    )
  }
  private stay(room: any, p: any, except = '') {
    hotelNights(p.arrival, p.departure)
    if (!room.active || room.blocked) throw Error('الغرفة غير متاحة للحجز')
    if (p.adults > room.capacity) throw Error('عدد النزلاء يتجاوز سعة الغرفة')
    if (this.overlap(room.id, p.arrival, p.departure, except))
      throw Error('الغرفة محجوزة خلال الفترة المطلوبة')
    const total = safe(hotelNights(p.arrival, p.departure) * p.rate)
    if (p.discount > total) throw Error('الخصم يتجاوز قيمة الإقامة')
    return total - p.discount
  }
  state(u: User): HotelState {
    return {
      user: u,
      settings: { ...this.business(), language: 'ar' },
      rooms: this.rows(rq + ' ORDER BY floor,code'),
      guests: this.rows(gq + ' ORDER BY name').map((g) => {
        if (!manage(u)) delete g.document
        return g
      }),
      reservations: this.reservations(' ORDER BY r.arrival DESC,r.number DESC'),
      payments: this.payments(' ORDER BY p.at DESC,p.number DESC LIMIT 1000'),
      users:
        u.role === 'admin'
          ? this.rows(
              'SELECT id,username,name,role,active FROM users ORDER BY name',
            )
          : [],
      audit:
        u.role === 'admin'
          ? this.rows(
              'SELECT a.*,u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.at DESC LIMIT 300',
            )
          : [],
      housekeeping: this.rows(
        "SELECT id,action,reason,snapshot,actor_name AS actorName,at FROM hotel_events WHERE entity_type='room' AND action IN('hotel.housekeeping.set','hotel.room.block') ORDER BY at DESC,id DESC LIMIT 200",
      ),
    }
  }
  private detail(id: string) {
    return {
      reservation: this.reservation(id),
      charges: this.rows(
        'SELECT c.id,c.title,c.amount,c.actor_name AS actorName,c.at,(SELECT v.reason FROM hotel_charge_voids v WHERE v.charge_id=c.id) AS voidReason FROM hotel_charges c WHERE c.reservation_id=? ORDER BY c.at,c.id',
        id,
      ),
      payments: this.payments(
        ' WHERE p.reservation_id=? ORDER BY p.at,p.id',
        id,
      ),
      ledger: this.rows(
        'SELECT id,kind,amount,reference_id AS referenceId,reason,actor_name AS actorName,at FROM hotel_ledger WHERE reservation_id=? ORDER BY at,id',
        id,
      ),
      events: this.events('reservation', id),
    }
  }
  call(action: string, payload: unknown, u: User): unknown {
    if (!['admin', 'manager', 'cashier'].includes(u.role))
      throw Error('الدور غير متاح في الفندق')
    const schema = (
      hotelSchemas as Record<string, { parse: (p: unknown) => any }>
    )[action]
    if (!schema) throw Error('العملية غير متاحة')
    const p = schema.parse(payload)
    if (action === 'hotel.state') return this.state(u)
    if (action === 'hotel.reservation.get') return this.detail(p.id)
    if (action === 'hotel.guest.get')
      return {
        guest: this.guest(p.id, u),
        reservations: this.reservations(
          ' WHERE r.guest_id=? ORDER BY r.arrival DESC',
          p.id,
        ),
        events: this.events('guest', p.id).map((e) =>
          manage(u) ? e : { ...e, snapshot: '' },
        ),
      }
    if (action === 'hotel.availability') {
      hotelNights(p.arrival, p.departure)
      return {
        rooms: this.rows(
          rq + ' WHERE active=1 AND blocked=0 AND capacity>=?',
          p.adults,
        ).filter((r) => !this.overlap(r.id, p.arrival, p.departure)),
      }
    }
    if (action === 'hotel.report') {
      this.manager(u)
      const reservations = this.reservations(),
        payments = this.payments(
          ' WHERE p.at>=? AND p.at<?',
          clinicDayBounds(p.from, p.to).lo,
          clinicDayBounds(p.from, p.to).hi,
        )
      let roomNights = 0
      for (const b of reservations) {
        if (!b.checkinAt) continue
        const arrival =
          new Date(b.checkinAt).getFullYear() +
          '-' +
          String(new Date(b.checkinAt).getMonth() + 1).padStart(2, '0') +
          '-' +
          String(new Date(b.checkinAt).getDate()).padStart(2, '0')
        const actualEnd = b.checkoutAt ? new Date(b.checkoutAt) : null
        const end = actualEnd
          ? actualEnd.getFullYear() +
            '-' +
            String(actualEnd.getMonth() + 1).padStart(2, '0') +
            '-' +
            String(actualEnd.getDate()).padStart(2, '0')
          : clinicToday()
        const a = arrival > p.from ? arrival : p.from,
          to = new Date(Date.parse(p.to + 'T12:00:00Z') + 86400000)
            .toISOString()
            .slice(0, 10),
          z = end < to ? end : to
        if (z > a) roomNights += (Date.parse(z) - Date.parse(a)) / 86400000
      }
      const { lo: start, hi: end } = clinicDayBounds(p.from, p.to)
      const entries = this.rows(
        'SELECT kind,amount FROM hotel_ledger WHERE at>=? AND at<?',
        start,
        end,
      )
      const charges = aggregate(
          entries
            .filter((l) =>
              ['room', 'adjustment', 'extra', 'extra-void', 'cancel'].includes(
                l.kind,
              ),
            )
            .reduce((n, l) => n + l.amount, 0),
        ),
        collected = aggregate(
          -entries
            .filter((l) =>
              ['receipt', 'refund', 'payment-void'].includes(l.kind),
            )
            .reduce((n, l) => n + l.amount, 0),
        )
      return {
        from: p.from,
        to: p.to,
        roomNights,
        charges,
        collected,
        outstanding: aggregate(reservations.reduce((n, r) => n + r.balance, 0)),
        reservations: reservations.filter(
          (r) =>
            (r.arrival <= p.to && r.departure > p.from) ||
            (!!r.checkinAt &&
              localDay(r.checkinAt) <= p.to &&
              (r.checkoutAt ? localDay(r.checkoutAt) : clinicToday()) > p.from),
        ),
        payments,
      } satisfies HotelReport
    }
    return this.db.transaction(() => {
      const hash = fingerprint(p),
        previous = this.row(
          'SELECT * FROM hotel_commands WHERE id=?',
          p.clientTxnId,
        )
      if (previous) {
        if (
          previous.actor_id !== u.id ||
          previous.action !== action ||
          previous.fingerprint !== hash
        )
          throw Error('معرف العملية مستخدم لطلب مختلف')
        return JSON.parse(previous.result)
      }
      let id = p.id ?? ulid()
      if (action === 'hotel.room.save' || action === 'hotel.guest.save') {
        const room = action === 'hotel.room.save'
        if (room) this.manager(u)
        const old = p.id
          ? room
            ? this.room(p.id)
            : this.row(gq + ' WHERE id=?', p.id)
          : undefined
        if (p.id && !old) throw Error('السجل غير موجود')
        this.version(old, p.version)
        if (!room && !manage(u) && p.document)
          throw Error('حفظ وثيقة الهوية يحتاج مدير الفندق')
        if (room && old) {
          const active = this.row(
            "SELECT id FROM hotel_reservations WHERE room_id=? AND status IN('reserved','in-house') LIMIT 1",
            id,
          )
          if (active && (!p.active || p.capacity < old.capacity))
            throw Error('الغرفة مرتبطة بحجوزات؛ لا يمكن تعطيلها أو تقليل سعتها')
        }
        const values = room
          ? [p.code, p.name, p.category, p.floor, p.capacity, p.rate, +p.active]
          : [
              p.code,
              p.name,
              p.phone,
              manage(u) ? p.document : (old?.document ?? ''),
              p.note,
              +p.active,
            ]
        const table = room ? 'hotel_rooms' : 'hotel_guests',
          cols = room
            ? 'code=?,name=?,category=?,floor=?,capacity=?,rate=?,active=?'
            : 'code=?,name=?,phone=?,document=?,note=?,active=?'
        if (old)
          this.db
            .prepare(
              'UPDATE ' +
                table +
                ' SET ' +
                cols +
                ',version=version+1 WHERE id=?',
            )
            .run(...values, id)
        else if (room)
          this.db
            .prepare(
              'INSERT INTO hotel_rooms(id,code,name,category,floor,capacity,rate,active,at) VALUES(?,?,?,?,?,?,?,?,?)',
            )
            .run(id, ...values, Date.now())
        else
          this.db
            .prepare(
              'INSERT INTO hotel_guests(id,code,name,phone,document,note,active,at) VALUES(?,?,?,?,?,?,?,?)',
            )
            .run(id, ...values, Date.now())
        this.event(
          room ? 'room' : 'guest',
          id,
          action,
          '',
          {
            before: old ?? null,
            after: room ? this.room(id) : this.row(gq + ' WHERE id=?', id),
          },
          u,
        )
      } else if (
        action === 'hotel.room.block' ||
        action === 'hotel.housekeeping.set'
      ) {
        const old = this.room(id)
        this.version(old, p.version)
        if (action === 'hotel.room.block') {
          this.manager(u)
          if (
            p.blocked &&
            this.row(
              "SELECT id FROM hotel_reservations WHERE room_id=? AND status IN('reserved','in-house') LIMIT 1",
              id,
            )
          )
            throw Error('انقل أو أغلق الحجوزات قبل إيقاف الغرفة')
          this.db
            .prepare(
              'UPDATE hotel_rooms SET blocked=?,version=version+1 WHERE id=?',
            )
            .run(+p.blocked, id)
        } else
          this.db
            .prepare(
              'UPDATE hotel_rooms SET cleanliness=?,version=version+1 WHERE id=?',
            )
            .run(p.cleanliness, id)
        this.event(
          'room',
          id,
          action,
          p.reason,
          { before: old, after: this.room(id) },
          u,
        )
      } else if (action === 'hotel.reservation.add') {
        const guest = this.row(gq + ' WHERE id=?', p.guestId),
          room = this.room(p.roomId)
        if (!guest || !guest.active) throw Error('اختر نزيلًا نشطًا')
        this.version(guest, p.guestVersion)
        this.version(room, p.roomVersion)
        if (p.arrival < clinicToday())
          throw Error('الحجوزات الجديدة تبدأ اليوم أو بعده')
        const total = this.stay(room, p)
        this.db
          .prepare(
            'INSERT INTO hotel_reservations(id,number,guest_id,room_id,guest_json,room_json,business_json,arrival,departure,adults,rate,discount,note,status,at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          )
          .run(
            id,
            this.number('hotel_reservations', 'H-'),
            guest.id,
            room.id,
            JSON.stringify({
              code: guest.code,
              name: guest.name,
              phone: guest.phone,
            }),
            JSON.stringify({
              code: room.code,
              name: room.name,
              category: room.category,
            }),
            JSON.stringify(this.business()),
            p.arrival,
            p.departure,
            p.adults,
            p.rate,
            p.discount,
            p.note,
            'reserved',
            Date.now(),
          )
        this.ledger(id, 'room', total, id, 'قيمة الإقامة المحجوزة', u)
        this.event('reservation', id, action, '', this.reservation(id), u)
      } else if (action === 'hotel.reservation.change') {
        this.manager(u)
        const old = this.reservation(id)
        this.open(old)
        this.version(old, p.version)
        const room = this.room(p.roomId)
        this.version(room, p.roomVersion)
        if (
          old.status === 'in-house' &&
          (p.roomId !== old.roomId ||
            p.arrival !== old.arrival ||
            p.departure < clinicToday())
        )
          throw Error(
            'الإقامة الحالية تسمح بتعديل المغادرة اليوم أو بعده بنفس الغرفة وبحد أدنى ليلة',
          )
        if (old.status === 'reserved' && p.arrival < clinicToday())
          throw Error('تاريخ الوصول قبل اليوم')
        const total = this.stay(room, p, id),
          delta = safe(total - old.roomTotal)
        if (old.total + delta < old.collected)
          throw Error('رد الزيادة المحصلة قبل خفض قيمة الإقامة')
        this.db
          .prepare(
            'UPDATE hotel_reservations SET room_id=?,room_json=?,arrival=?,departure=?,adults=?,rate=?,discount=?,version=version+1 WHERE id=?',
          )
          .run(
            room.id,
            JSON.stringify({
              code: room.code,
              name: room.name,
              category: room.category,
            }),
            p.arrival,
            p.departure,
            p.adults,
            p.rate,
            p.discount,
            id,
          )
        this.ledger(id, 'adjustment', delta, id, p.reason, u)
        this.event(
          'reservation',
          id,
          action,
          p.reason,
          { before: old, after: this.reservation(id) },
          u,
        )
      } else if (action.startsWith('hotel.reservation.')) {
        const old = this.reservation(id)
        this.version(old, p.version)
        this.open(old)
        if (action === 'hotel.reservation.checkin') {
          if (
            old.status !== 'reserved' ||
            old.arrival > clinicToday() ||
            old.departure <= clinicToday()
          )
            throw Error('الدخول متاح داخل فترة الإقامة المحجوزة')
          const room = this.room(old.roomId)
          if (!room.active || room.blocked || room.cleanliness !== 'ready')
            throw Error('الغرفة تحتاج تجهيزًا قبل الدخول')
          if (
            this.row(
              "SELECT id FROM hotel_reservations WHERE room_id=? AND id!=? AND status='in-house'",
              room.id,
              id,
            )
          )
            throw Error('الغرفة ما زالت مشغولة بإقامة أخرى')
          this.db
            .prepare(
              "UPDATE hotel_reservations SET status='in-house',checkin_at=?,version=version+1 WHERE id=?",
            )
            .run(Date.now(), id)
        } else if (action === 'hotel.reservation.checkout') {
          if (old.status !== 'in-house') throw Error('الحجز لم يسجل دخولًا')
          if (old.balance !== 0) throw Error('سدّد حساب الإقامة قبل المغادرة')
          this.db
            .prepare(
              "UPDATE hotel_reservations SET status='checked-out',checkout_at=?,version=version+1 WHERE id=?",
            )
            .run(Date.now(), id)
          const room = this.room(old.roomId)
          this.db
            .prepare(
              "UPDATE hotel_rooms SET cleanliness='dirty',version=version+1 WHERE id=?",
            )
            .run(room.id)
          this.event(
            'room',
            room.id,
            'hotel.housekeeping.set',
            'مغادرة النزيل',
            { before: room, after: this.room(room.id) },
            u,
          )
        } else {
          this.manager(u)
          if (old.status !== 'reserved')
            throw Error('لا يمكن إلغاء إقامة بعد الدخول')
          if (
            action === 'hotel.reservation.no-show' &&
            old.arrival > clinicToday()
          )
            throw Error('عدم الحضور متاح بعد موعد الوصول')
          if (old.collected !== 0)
            throw Error('رد المبلغ المحصل قبل إلغاء الحجز')
          this.ledger(id, 'cancel', -old.total, id, p.reason, u)
          this.db
            .prepare(
              'UPDATE hotel_reservations SET status=?,version=version+1 WHERE id=?',
            )
            .run(action.endsWith('no-show') ? 'no-show' : 'cancelled', id)
        }
        this.event(
          'reservation',
          id,
          action,
          p.reason ?? '',
          { before: old, after: this.reservation(id) },
          u,
        )
      } else if (action === 'hotel.charge.add') {
        const old = this.reservation(id)
        this.version(old, p.version)
        if (old.status !== 'in-house')
          throw Error('الخدمات الإضافية تخص إقامة داخل الفندق')
        const chargeId = ulid()
        safe(old.total + p.amount)
        this.db
          .prepare('INSERT INTO hotel_charges VALUES(?,?,?,?,?,?,?)')
          .run(chargeId, id, p.title, p.amount, u.id, u.name, Date.now())
        this.ledger(id, 'extra', p.amount, chargeId, p.title, u)
        this.bump(id)
        this.event(
          'reservation',
          id,
          action,
          '',
          { id: chargeId, title: p.title, amount: p.amount },
          u,
        )
        id = chargeId
      } else if (action === 'hotel.charge.void') {
        this.manager(u)
        const charge = this.row('SELECT * FROM hotel_charges WHERE id=?', id)
        if (!charge) throw Error('الرسم غير موجود')
        const b = this.reservation(charge.reservation_id)
        this.open(b)
        if (this.row('SELECT id FROM hotel_charge_voids WHERE charge_id=?', id))
          throw Error('الرسم مصحح بالفعل')
        if (b.total - charge.amount < b.collected)
          throw Error('رد الزيادة المحصلة قبل تصحيح الرسم')
        this.db
          .prepare('INSERT INTO hotel_charge_voids VALUES(?,?,?,?,?,?)')
          .run(ulid(), id, p.reason, u.id, u.name, Date.now())
        this.ledger(b.id, 'extra-void', -charge.amount, id, p.reason, u)
        this.bump(b.id)
        this.event(
          'reservation',
          b.id,
          action,
          p.reason,
          { chargeId: id, amount: charge.amount },
          u,
        )
      } else if (action === 'hotel.payment.post') {
        const b = this.reservation(p.reservationId)
        this.version(b, p.version)
        this.open(b)
        if (p.kind === 'refund') {
          this.manager(u)
          if (p.amount > b.collected)
            throw Error('الرد يتجاوز صافي المبلغ المحصل')
        } else if (p.amount > b.balance)
          throw Error('التحصيل يتجاوز المبلغ المستحق')
        this.db
          .prepare(
            'INSERT INTO hotel_payments VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          )
          .run(
            id,
            this.number('hotel_payments', p.kind === 'receipt' ? 'RC-' : 'RF-'),
            b.id,
            p.kind,
            p.amount,
            p.method,
            p.reference,
            p.reason,
            JSON.stringify(b.guest),
            JSON.stringify(b.room),
            JSON.stringify(b.business),
            u.id,
            u.name,
            Date.now(),
          )
        this.ledger(
          b.id,
          p.kind,
          p.kind === 'receipt' ? -p.amount : p.amount,
          id,
          p.reason,
          u,
        )
        this.bump(b.id)
        this.event(
          'reservation',
          b.id,
          action,
          p.reason,
          { paymentId: id, kind: p.kind, amount: p.amount },
          u,
        )
      } else if (action === 'hotel.payment.void') {
        this.manager(u)
        const payment = this.row('SELECT * FROM hotel_payments WHERE id=?', id)
        if (!payment) throw Error('الإيصال غير موجود')
        const b = this.reservation(payment.reservation_id)
        this.open(b)
        if (
          this.row('SELECT id FROM hotel_payment_voids WHERE payment_id=?', id)
        )
          throw Error('الإيصال مصحح بالفعل')
        this.db
          .prepare('INSERT INTO hotel_payment_voids VALUES(?,?,?,?,?,?)')
          .run(ulid(), id, p.reason, u.id, u.name, Date.now())
        this.ledger(
          b.id,
          'payment-void',
          payment.kind === 'receipt' ? payment.amount : -payment.amount,
          id,
          p.reason,
          u,
        )
        this.bump(b.id)
        this.event(
          'reservation',
          b.id,
          action,
          p.reason,
          { paymentId: id, amount: payment.amount, kind: payment.kind },
          u,
        )
      } else throw Error('العملية غير متاحة')
      const result = { id }
      this.identity.audit(u.id, action, id)
      this.db
        .prepare('INSERT INTO hotel_commands VALUES(?,?,?,?,?,?)')
        .run(
          p.clientTxnId,
          u.id,
          action,
          hash,
          JSON.stringify(result),
          Date.now(),
        )
      return result
    })()
  }
}
