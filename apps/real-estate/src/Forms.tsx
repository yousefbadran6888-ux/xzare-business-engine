import { useState, type ReactNode } from 'react'
import type { EstateState, EstateContact, EstateUnit, EstateDeal } from '@xzare/engine'
import { Field, decimal, today } from './ui'
import {
  readMoney,
  passwordValue,
  roles,
  categories,
  offers,
  kinds,
  channels,
  movements,
  methods,
} from './model'
export type FormSpec = {
  title: string
  action: string
  content: ReactNode
  payload: (f: FormData) => Record<string, unknown>
  submit?: string
}
export const text = (f: FormData, n: string) => String(f.get(n) ?? '').trim()
const money = (f: FormData, n: string) => readMoney(text(f, n)),
  num = (f: FormData, n: string) => Number(text(f, n)),
  edit = (x?: { id: string; version: number }) => (x ? { id: x.id, version: x.version } : {})
export const inp = (
  label: string,
  name: string,
  value = '',
  required = false,
  type = 'text',
  max = 160,
) => (
  <Field label={label}>
    <input name={name} defaultValue={value} required={required} type={type} maxLength={max} />
  </Field>
)
const select = (label: string, name: string, options: Record<string, string>, value = '') => (
  <Field label={label}>
    <select name={name} defaultValue={value} required>
      {Object.entries(options).map(([k, v]) => (
        <option key={k} value={k}>
          {v}
        </option>
      ))}
    </select>
  </Field>
)
export const reasonField = () => inp('سبب العملية', 'reason', '', true, 'text', 2000)
export function contactForm(
  kind: EstateContact['kind'],
  manager: boolean,
  c?: EstateContact,
): FormSpec {
  return {
    title: c ? 'تعديل ' + kinds[kind] : 'إضافة ' + kinds[kind],
    action: 're.contact.save',
    content: (
      <div className="form-grid">
        {inp('الكود', 'code', c?.code, true)}
        {inp('الاسم', 'name', c?.name, true)}
        {inp('رقم التواصل', 'phone', c?.phone)}
        {manager && inp('وثيقة الهوية — خاصة بالمدير', 'document', c?.document)}
        <Field label="ملاحظات">
          <textarea name="note" maxLength={2000} defaultValue={c?.note} />
        </Field>
        <label className="check">
          <input type="checkbox" name="active" defaultChecked={c ? !!c.active : true} />
          جهة اتصال نشطة
        </label>
        {c && reasonField()}
      </div>
    ),
    payload: (f) => ({
      ...edit(c),
      kind,
      code: text(f, 'code'),
      name: text(f, 'name'),
      phone: text(f, 'phone'),
      document: manager ? text(f, 'document') : '',
      note: text(f, 'note'),
      active: f.has('active'),
      reason: c ? text(f, 'reason') : '',
    }),
  }
}
export function unitForm(s: EstateState, u?: EstateUnit): FormSpec {
  return {
    title: u ? 'تعديل الوحدة' : 'إضافة وحدة',
    action: 're.unit.save',
    content: (
      <div className="form-grid">
        {inp('كود الوحدة', 'code', u?.code, true)}
        {inp('اسم الوحدة', 'name', u?.name, true)}
        <Field label="المالك">
          <select name="ownerId" required defaultValue={u?.ownerId ?? ''}>
            <option value="" disabled>
              اختر المالك
            </option>
            {s.contacts
              .filter((x) => x.kind === 'owner' && x.active)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name} · {x.code}
                </option>
              ))}
          </select>
        </Field>
        {select('نوع الوحدة', 'category', categories, u?.category ?? 'apartment')}
        {inp('الموقع أو العنوان', 'location', u?.location, true)}
        {inp('المساحة — م²', 'area', String(u?.area ?? ''), true)}
        {inp('عدد الغرف', 'rooms', String(u?.rooms ?? 0), true)}
        {select('نوع العرض', 'offer', offers, u?.offer ?? 'both')}
        {inp('سعر البيع — ج.م', 'salePrice', decimal(u?.salePrice ?? 0), true)}
        {inp('الإيجار الشهري — ج.م', 'rentPrice', decimal(u?.rentPrice ?? 0), true)}
        <label className="check">
          <input type="checkbox" name="active" defaultChecked={u ? !!u.active : true} />
          وحدة نشطة
        </label>
        {u && reasonField()}
      </div>
    ),
    payload: (f) => ({
      ...edit(u),
      code: text(f, 'code'),
      name: text(f, 'name'),
      ownerId: text(f, 'ownerId'),
      ownerVersion: s.contacts.find((x) => x.id === text(f, 'ownerId'))?.version,
      category: text(f, 'category'),
      location: text(f, 'location'),
      area: num(f, 'area'),
      rooms: num(f, 'rooms'),
      offer: text(f, 'offer'),
      salePrice: money(f, 'salePrice'),
      rentPrice: money(f, 'rentPrice'),
      active: f.has('active'),
      reason: u ? text(f, 'reason') : '',
    }),
  }
}
function DealFields({ s, chosen }: { s: EstateState; chosen?: EstateUnit }) {
  const available = s.units.filter(
      (x) => x.active && x.availability === 'available' && !x.openDealId,
    ),
    [uid, setUid] = useState(chosen?.id ?? ''),
    [kind, setKind] = useState(chosen?.offer === 'lease' ? 'lease' : 'sale'),
    [price, setPrice] = useState(
      chosen ? decimal(chosen.offer === 'lease' ? chosen.rentPrice : chosen.salePrice) : '',
    )
  function pick(u: string, k: string) {
    setUid(u)
    setKind(k)
    const unit = s.units.find((x) => x.id === u)
    setPrice(unit ? decimal(k === 'sale' ? unit.salePrice : unit.rentPrice) : '')
  }
  return (
    <div className="form-grid">
      <Field label="الوحدة">
        <select
          name="unitId"
          required
          value={uid}
          onChange={(e) => {
            const u = s.units.find((x) => x.id === e.target.value)
            pick(e.target.value, u?.offer === 'both' ? kind : (u?.offer ?? 'sale'))
          }}
        >
          <option value="" disabled>
            اختر وحدة متاحة
          </option>
          {available.map((x) => (
            <option key={x.id} value={x.id}>
              {x.code} · {x.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="نوع الصفقة">
        <select name="kind" value={kind} onChange={(e) => pick(uid, e.target.value)}>
          <option value="sale" disabled={s.units.find(x=>x.id===uid)?.offer==='lease'}>بيع</option>
          <option value="lease" disabled={s.units.find(x=>x.id===uid)?.offer==='sale'}>إيجار</option>
        </select>
      </Field>
      <Field label="العميل">
        <select name="clientId" required defaultValue="">
          <option value="" disabled>
            اختر العميل
          </option>
          {s.contacts
            .filter((x) => x.kind === 'client' && x.active)
            .map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} · {x.code}
              </option>
            ))}
        </select>
      </Field>
      <Field label="الوسيط">
        <select name="brokerId" required defaultValue="">
          <option value="" disabled>
            اختر الوسيط
          </option>
          {s.contacts
            .filter((x) => x.kind === 'broker' && x.active)
            .map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} · {x.code}
              </option>
            ))}
        </select>
      </Field>
      <Field
        label={
          kind === 'sale' ? 'قيمة البيع المتفق عليها — ج.م' : 'الإيجار الشهري المتفق عليه — ج.م'
        }
      >
        <input name="price" required value={price} onChange={(e) => setPrice(e.target.value)} />
      </Field>
      {inp('العربون المتفق عليه — ج.م', 'depositLimit', '0.00', true)}
      {inp('عمولة المكتب المتفق عليها — ج.م', 'commission', '0.00', true)}
      {inp('حصة الوسيط من العمولة — ج.م', 'brokerShare', '0.00', true)}
      {kind === 'lease' && (
        <>
          {inp('بداية الإيجار', 'leaseStart', today(), true, 'date')}
          {inp('نهاية الإيجار', 'leaseEnd', '', true, 'date')}
        </>
      )}
      <Field label="ملاحظات الاتفاق">
        <textarea name="note" maxLength={2000} />
      </Field>
      <p className="review span">
        راجع الاتفاق قبل الحفظ. يُثبت سعر الوحدة وحصة الوسيط عند الحجز؛ التسجيل التالي يحفظ مرجع
        العقد الموقع الفعلي.
      </p>
    </div>
  )
}
export function dealForm(s: EstateState, u?: EstateUnit): FormSpec {
  return {
    title: 'حجز صفقة جديدة',
    action: 're.deal.add',
    content: <DealFields s={s} chosen={u} />,
    payload: (f) => ({
      unitId: text(f, 'unitId'),
      unitVersion: s.units.find((x) => x.id === text(f, 'unitId'))?.version,
      clientId: text(f, 'clientId'),
      clientVersion: s.contacts.find((x) => x.id === text(f, 'clientId'))?.version,
      brokerId: text(f, 'brokerId'),
      brokerVersion: s.contacts.find((x) => x.id === text(f, 'brokerId'))?.version,
      kind: text(f, 'kind'),
      price: money(f, 'price'),
      depositLimit: money(f, 'depositLimit'),
      commission: money(f, 'commission'),
      brokerShare: money(f, 'brokerShare'),
      leaseStart: text(f, 'leaseStart'),
      leaseEnd: text(f, 'leaseEnd'),
      note: text(f, 'note'),
    }),
    submit: 'تأكيد الحجز',
  }
}
export function decision(
  title: string,
  action: string,
  d: { id: string; version: number },
  extra: Record<string, unknown> = {},
): FormSpec {
  return {
    title,
    action,
    content: (
      <>
        <p className="review">
          تُحفظ العملية وسببها في السجل. التصحيحات المالية تضيف حركة عكسية وتُبقي الأصل.
        </p>
        {reasonField()}
      </>
    ),
    payload: (f) => ({ ...edit(d), ...extra, reason: text(f, 'reason') }),
    submit: 'تأكيد العملية',
  }
}
export function contractForm(d: EstateDeal): FormSpec {
  return {
    title: 'تسجيل العقد الموقع',
    action: 're.contract.record',
    content: (
      <>
        <p className="review">
          سجل مرجع العقد الفعلي وشروطه. هذا سجل إداري للعقد الموقع، ولا يحل محل المستند القانوني.
        </p>
        {inp('رقم أو مرجع العقد الفعلي', 'reference', '', true)}
        {inp('تاريخ التوقيع', 'signedDay', today(), true, 'date')}
        <Field label="الشروط المتفق عليها">
          <textarea name="terms" required maxLength={10000} />
        </Field>
      </>
    ),
    payload: (f) => ({
      ...edit(d),
      reference: text(f, 'reference'),
      signedDay: text(f, 'signedDay'),
      terms: text(f, 'terms'),
    }),
    submit: 'تسجيل العقد',
  }
}
export function entryForm(
  d: EstateDeal,
  channel: 'deposit' | 'fee' | 'broker',
  kind: string,
): FormSpec {
  let balance =
    channel === 'deposit'
      ? kind === 'receipt'
        ? d.depositLimit - d.depositReceived
        : d.depositHeld
      : channel === 'fee'
        ? kind === 'receipt'
          ? d.earned - d.feeCollected
          : d.feeCollected
        : d.brokerDue
  return {
    title: movements[kind] + ' — ' + channels[channel],
    action: 're.entry.post',
    content: (
      <>
        <div className="review">الحد المتاح: {decimal(balance)} ج.م</div>
        {inp('المبلغ — ج.م', 'amount', decimal(balance), true)}
        {select('طريقة الدفع', 'method', methods, 'cash')}
        {inp(
          kind === 'handover' ? 'مرجع التسليم للمالك' : 'مرجع الدفع',
          'reference',
          '',
          kind === 'handover',
        )}
        {reasonField()}
      </>
    ),
    payload: (f) => ({
      ...edit(d),
      channel,
      kind,
      amount: money(f, 'amount'),
      method: text(f, 'method'),
      reference: text(f, 'reference'),
      reason: text(f, 'reason'),
    }),
    submit: 'تسجيل الحركة',
  }
}
export function userForm(u?: EstateState['user']): FormSpec {
  return {
    title: u ? 'تعديل المستخدم' : 'إضافة مستخدم',
    action: 'user.save',
    content: (
      <>
        {!u && inp('اسم المستخدم', 'username', '', true)}
        {inp('اسم الموظف', 'name', u?.name, true)}
        {select('الدور', 'role', roles, u?.role ?? 'cashier')}
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
            <input type="checkbox" name="active" defaultChecked={!!u.active} />
            حساب نشط
          </label>
        )}
      </>
    ),
    payload: (f) => ({
      ...(u
        ? { id: u.id, username: u.username, active: f.has('active') }
        : { username: text(f, 'username') }),
      name: text(f, 'name'),
      role: text(f, 'role'),
      password: passwordValue(f, 'password') || undefined,
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
      return { current: passwordValue(f, 'current'), password: passwordValue(f, 'next') }
    },
  }
}
