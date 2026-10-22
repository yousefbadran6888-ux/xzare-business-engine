import { useState, type ReactNode } from 'react'
import type {
  HotelState,
  HotelRoom,
  HotelGuest,
  HotelReservation,
} from '@xzare/engine'
import { Field, decimal, today } from './ui'
import { readMoney, passwordValue, addDay, roles } from './model'
export type FormSpec = {
  title: string
  action: string
  content: ReactNode
  payload: (f: FormData) => Record<string, unknown>
  submit?: string
  file?: boolean
}
export const text = (f: FormData, n: string) => String(f.get(n) ?? '').trim()
const num = (f: FormData, n: string) => Number(text(f, n)),
  money = (f: FormData, n: string) => readMoney(text(f, n)),
  active = (f: FormData) => f.has('active')
const inp = (
  label: string,
  name: string,
  value = '',
  required = false,
  type = 'text',
  max = 160,
) => (
  <Field label={label}>
    <input
      name={name}
      defaultValue={value}
      required={required}
      type={type}
      maxLength={max}
    />
  </Field>
)
export const reasonField = () =>
  inp('سبب العملية', 'reason', '', true, 'text', 2000)
const edit = (x?: { id: string; version: number }) =>
  x ? { id: x.id, version: x.version } : {}
export function roomForm(r?: HotelRoom): FormSpec {
  return {
    title: r ? 'تعديل الغرفة' : 'إضافة غرفة',
    action: 'hotel.room.save',
    content: (
      <div className="form-grid">
        {inp('رقم الغرفة', 'code', r?.code, true)}
        {inp('اسم الغرفة', 'name', r?.name, true)}
        {inp('نوع الغرفة', 'category', r?.category)}
        {inp('الطابق', 'floor', r?.floor)}
        <Field label="السعة">
          <input
            name="capacity"
            type="number"
            min="1"
            max="20"
            step="1"
            defaultValue={r?.capacity ?? 2}
            required
          />
        </Field>
        {inp('سعر الليلة — ج.م', 'rate', decimal(r?.rate ?? 0), true)}
        <label className="check">
          <input
            name="active"
            type="checkbox"
            defaultChecked={r ? !!r.active : true}
          />
          غرفة نشطة
        </label>
      </div>
    ),
    payload: (f) => ({
      ...edit(r),
      code: text(f, 'code'),
      name: text(f, 'name'),
      category: text(f, 'category'),
      floor: text(f, 'floor'),
      capacity: num(f, 'capacity'),
      rate: money(f, 'rate'),
      active: active(f),
    }),
  }
}
export function guestForm(manager: boolean, g?: HotelGuest): FormSpec {
  return {
    title: g ? 'تعديل بيانات النزيل' : 'إضافة نزيل',
    action: 'hotel.guest.save',
    content: (
      <div className="form-grid">
        {inp('كود النزيل', 'code', g?.code, true)}
        {inp('اسم النزيل', 'name', g?.name, true)}
        {inp('رقم الهاتف', 'phone', g?.phone)}
        {manager && inp('رقم وثيقة الهوية', 'document', g?.document)}
        <Field label="ملاحظات">
          <textarea name="note" defaultValue={g?.note ?? ''} maxLength={2000} />
        </Field>
        <label className="check">
          <input
            name="active"
            type="checkbox"
            defaultChecked={g ? !!g.active : true}
          />
          نزيل نشط
        </label>
      </div>
    ),
    payload: (f) => ({
      ...edit(g),
      code: text(f, 'code'),
      name: text(f, 'name'),
      phone: text(f, 'phone'),
      document: manager ? text(f, 'document') : '',
      note: text(f, 'note'),
      active: active(f),
    }),
  }
}
export function reservationForm(
  s: HotelState,
  r?: HotelReservation,
  chosen?: HotelRoom,
  range?: { arrival: string; departure: string; adults: number },
): FormSpec {
  const rooms = s.rooms.filter((x) => x.active && !x.blocked),
    guests = s.guests.filter((x) => x.active)
  return {
    title: r ? 'تعديل الإقامة' : 'حجز إقامة',
    action: r ? 'hotel.reservation.change' : 'hotel.reservation.add',
    content: (
      <>
        <p className="muted">
          الليلة تحتسب بين الوصول والمغادرة. سعر الحجز يُحفظ مستقلًا عن تغييرات
          قائمة الأسعار.
        </p>
        <div className="form-grid">
          {!r && (
            <Field label="النزيل">
              <select name="guestId" required defaultValue="">
                <option value="" disabled>
                  اختر نزيلًا
                </option>
                {guests.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.code} · {g.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <RoomPriceFields rooms={rooms} reservation={r} chosen={chosen} />
          {inp(
            'تاريخ الوصول',
            'arrival',
            r?.arrival ?? range?.arrival ?? today(),
            true,
            'date',
          )}
          {inp(
            'تاريخ المغادرة',
            'departure',
            r?.departure ?? range?.departure ?? addDay(today(), 1),
            true,
            'date',
          )}
          <Field label="عدد النزلاء">
            <input
              name="adults"
              type="number"
              min="1"
              max="20"
              step="1"
              required
              defaultValue={r?.adults ?? range?.adults ?? 1}
            />
          </Field>
          {inp(
            'خصم الإقامة — ج.م',
            'discount',
            decimal(r?.discount ?? 0),
            true,
          )}
          {r ? (
            reasonField()
          ) : (
            <Field label="ملاحظات الحجز">
              <textarea name="note" maxLength={2000} />
            </Field>
          )}
        </div>
      </>
    ),
    payload: (f) => {
      const room = s.rooms.find((x) => x.id === text(f, 'roomId'))
      if (!room) throw Error('اختر غرفة')
      const stay = {
        roomId: room.id,
        roomVersion: room.version,
        arrival: text(f, 'arrival'),
        departure: text(f, 'departure'),
        adults: num(f, 'adults'),
        rate: money(f, 'rate'),
        discount: money(f, 'discount'),
      }
      if (r) return { ...edit(r), ...stay, reason: text(f, 'reason') }
      const g = s.guests.find((x) => x.id === text(f, 'guestId'))
      if (!g) throw Error('اختر نزيلًا')
      return {
        ...stay,
        guestId: g.id,
        guestVersion: g.version,
        note: text(f, 'note'),
      }
    },
  }
}
export function decision(
  title: string,
  action: string,
  r: { id: string; version: number },
  content: ReactNode,
  withReason = false,
  extra: Record<string, unknown> = {},
): FormSpec {
  return {
    title,
    action,
    content: (
      <>
        <div className="review">{content}</div>
        {withReason && reasonField()}
      </>
    ),
    payload: (f) => ({
      ...edit(r),
      ...extra,
      ...(withReason ? { reason: text(f, 'reason') } : {}),
    }),
    submit: 'تأكيد العملية',
  }
}
export function payForm(r: HotelReservation, refund = false): FormSpec {
  return {
    title: refund ? 'رد مبلغ للنزيل' : 'تحصيل حساب الإقامة',
    action: 'hotel.payment.post',
    content: (
      <>
        <div className="review">
          {r.number} · {r.guest.name}
          <br /> {refund ? 'صافي المحصل' : 'المستحق'}:{' '}
          {decimal(refund ? r.collected : r.balance)} ج.م
        </div>
        {inp(
          'المبلغ — ج.م',
          'amount',
          decimal(refund ? r.collected : r.balance),
          true,
        )}
        <Field label="طريقة الدفع">
          <select name="method">
            <option value="cash">نقدي</option>
            <option value="card">بطاقة</option>
            <option value="transfer">تحويل</option>
          </select>
        </Field>
        {inp('مرجع الدفع', 'reference')}
        {refund && reasonField()}
      </>
    ),
    payload: (f) => ({
      reservationId: r.id,
      version: r.version,
      kind: refund ? 'refund' : 'receipt',
      amount: money(f, 'amount'),
      method: text(f, 'method'),
      reference: text(f, 'reference'),
      reason: refund ? text(f, 'reason') : '',
    }),
    submit: refund ? 'تأكيد رد المبلغ' : 'تأكيد التحصيل',
  }
}
export function chargeForm(r: HotelReservation): FormSpec {
  return {
    title: 'إضافة خدمة لحساب الإقامة',
    action: 'hotel.charge.add',
    content: (
      <>
        {inp('اسم الخدمة', 'title', '', true)}
        {inp('قيمة الخدمة — ج.م', 'amount', '', true)}
      </>
    ),
    payload: (f) => ({
      ...edit(r),
      title: text(f, 'title'),
      amount: money(f, 'amount'),
    }),
  }
}
export function correction(
  title: string,
  action: string,
  id: string,
): FormSpec {
  return {
    title,
    action,
    content: (
      <>
        <p className="muted">يُحفظ الأصل ويضاف تصحيح في سجل الحساب.</p>
        {reasonField()}
      </>
    ),
    payload: (f) => ({ id, reason: text(f, 'reason') }),
    submit: 'تأكيد التصحيح',
  }
}
export function userForm(u?: HotelState['user']): FormSpec {
  return {
    title: u ? 'تعديل المستخدم' : 'إضافة مستخدم',
    action: 'user.save',
    content: (
      <>
        {!u && inp('اسم المستخدم', 'username', '', true)}
        {inp('اسم الموظف', 'name', u?.name, true)}
        <Field label="الدور">
          <select name="role" defaultValue={u?.role ?? 'cashier'}>
            {Object.entries(roles).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        {inp(
          u ? 'كلمة مرور جديدة — اختياري' : 'كلمة المرور — 12 حرفًا على الأقل',
          'password',
          '',
          !u,
          'password',
          128,
        )}
        {u && (
          <label className="check">
            <input name="active" type="checkbox" defaultChecked={!!u.active} />
            حساب نشط
          </label>
        )}
      </>
    ),
    payload: (f) => ({
      ...(u
        ? { id: u.id, username: u.username }
        : { username: text(f, 'username') }),
      name: text(f, 'name'),
      role: text(f, 'role'),
      password: passwordValue(f, 'password') || undefined,
      ...(u ? { active: f.has('active') } : {}),
    }),
  }
}
export function passwordForm(): FormSpec {
  return {
    title: 'تغيير كلمة المرور',
    action: 'password.change',
    content: (
      <>
        {inp('كلمة المرور الحالية', 'current', '', true, 'password', 128)}
        {inp('كلمة المرور الجديدة', 'next', '', true, 'password', 128)}
        {inp('تأكيد كلمة المرور', 'confirm', '', true, 'password', 128)}
      </>
    ),
    payload: (f) => {
      if (passwordValue(f, 'next') !== passwordValue(f, 'confirm'))
        throw Error('كلمتا المرور غير متطابقتين')
      return {
        current: passwordValue(f, 'current'),
        password: passwordValue(f, 'next'),
      }
    },
  }
}

function RoomPriceFields({
  rooms,
  reservation,
  chosen,
}: {
  rooms: HotelRoom[]
  reservation?: HotelReservation
  chosen?: HotelRoom
}) {
  const [roomId, setRoomId] = useState(reservation?.roomId ?? chosen?.id ?? ''),
    [rate, setRate] = useState(
      reservation
        ? decimal(reservation.rate)
        : chosen
          ? decimal(chosen.rate)
          : '',
    )
  return (
    <>
      <Field label="الغرفة">
        <select
          name="roomId"
          required
          value={roomId}
          onChange={(e) => {
            setRoomId(e.target.value)
            const room = rooms.find((r) => r.id === e.target.value)
            setRate(room ? decimal(room.rate) : '')
          }}
        >
          <option value="" disabled>
            اختر غرفة
          </option>
          {rooms.map((g) => (
            <option key={g.id} value={g.id}>
              {g.code} · {g.name} · {decimal(g.rate)} ج.م
            </option>
          ))}
        </select>
      </Field>
      <Field label="سعر الليلة المتفق عليه — ج.م">
        <input
          name="rate"
          required
          value={rate}
          onChange={(e) => setRate(e.target.value)}
        />
        <small>
          اختيار غرفة أخرى يضع سعرها الحالي. يمكن تعديل السعر المتفق عليه قبل
          الحفظ.
        </small>
      </Field>
    </>
  )
}
