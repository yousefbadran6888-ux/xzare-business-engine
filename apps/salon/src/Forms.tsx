import { useState, type ReactNode } from 'react'
import type {
  SalonState,
  SalonCustomer,
  SalonService,
  SalonStaff,
  SalonPlan,
  SalonBooking,
  SalonPackage,
  SalonInvoice,
  User,
} from '@xzare/engine'
import { Field, amount, decimal } from './ui'
import {
  readMoney,
  minutes,
  clock,
  addDay,
  passwordValue,
  roles,
} from './model'
export type FormSpec = {
  title: string
  action: string
  body: ReactNode
  payload: (f: FormData) => Record<string, unknown>
  submit?: string
}
export const text = (f: FormData, k: string) => String(f.get(k) ?? '').trim()
const edit = (x?: { id: string; version: number }) =>
  x ? { id: x.id, version: x.version } : {}
const Code = ({ value = '' }: { value?: string }) => (
  <input
    name="code"
    defaultValue={value}
    required
    maxLength={64}
    pattern="[A-Za-z0-9][A-Za-z0-9._/\-]*"
    dir="ltr"
  />
)
const Active = ({
  checked = true,
  label = 'نشط',
}: {
  checked?: boolean
  label?: string
}) => (
  <label className="s-check">
    <input name="active" type="checkbox" defaultChecked={checked} />
    {label}
  </label>
)
export const customerForm = (c?: SalonCustomer): FormSpec => ({
  title: c ? 'تعديل العميل' : 'عميل جديد',
  action: 'sal.customer.save',
  body: (
    <>
      <div className="s-two">
        <Field label="كود العميل">
          <Code value={c?.code} />
        </Field>
        <Field label="اسم العميل">
          <input name="name" defaultValue={c?.name} required maxLength={160} />
        </Field>
      </div>
      <Field label="رقم التواصل">
        <input name="phone" defaultValue={c?.phone} maxLength={160} dir="ltr" />
      </Field>
      <Field label="ملاحظة الاستقبال — خاصة بالإدارة">
        <textarea name="note" defaultValue={c?.note} maxLength={2000} />
      </Field>
      <Active checked={c ? !!c.active : true} />
      <p className="muted">الكود فريد، ويظل ثابتًا بعد أول حجز أو باقة.</p>
    </>
  ),
  payload: (f) => ({
    ...edit(c),
    code: text(f, 'code'),
    name: text(f, 'name'),
    phone: text(f, 'phone'),
    note: text(f, 'note'),
    active: f.has('active'),
  }),
})
export const serviceForm = (v?: SalonService): FormSpec => ({
  title: v ? 'تعديل الخدمة' : 'خدمة جديدة',
  action: 'sal.service.save',
  body: (
    <>
      <div className="s-two">
        <Field label="كود الخدمة">
          <Code value={v?.code} />
        </Field>
        <Field label="اسم الخدمة">
          <input name="name" defaultValue={v?.name} required maxLength={160} />
        </Field>
        <Field label="التصنيف">
          <input name="category" defaultValue={v?.category} maxLength={160} />
        </Field>
        <Field label="مدة الخدمة، دقيقة">
          <input
            name="duration"
            type="number"
            min={5}
            max={480}
            step={1}
            defaultValue={v?.duration ?? 30}
            required
          />
        </Field>
        <Field label="سعر الخدمة، ج.م">
          <input
            name="fee"
            type="number"
            min={0}
            step="0.01"
            defaultValue={v?.fee === undefined ? '' : decimal(v.fee)}
            required
          />
        </Field>
      </div>
      <Active label="الخدمة متاحة" checked={v ? !!v.active : true} />
      <p className="muted">
        التعديل يخص الحجوزات الجديدة؛ الحجز السابق يحتفظ بمدته وسعره.
      </p>
    </>
  ),
  payload: (f) => ({
    ...edit(v),
    code: text(f, 'code'),
    name: text(f, 'name'),
    category: text(f, 'category'),
    duration: Number(text(f, 'duration')),
    fee: readMoney(text(f, 'fee')),
    active: f.has('active'),
  }),
})
export const staffForm = (s: SalonState, t?: SalonStaff): FormSpec => ({
  title: t ? 'تعديل الموظف' : 'موظف جديد',
  action: 'sal.staff.save',
  body: (
    <>
      <div className="s-two">
        <Field label="كود الموظف">
          <Code value={t?.code} />
        </Field>
        <Field label="اسم الموظف">
          <input name="name" defaultValue={t?.name} required maxLength={160} />
        </Field>
        <Field label="رقم التواصل">
          <input name="phone" defaultValue={t?.phone} maxLength={160} />
        </Field>
        <Field label="العمولة، %">
          <input
            name="commissionBps"
            type="number"
            min={0}
            max={100}
            step="0.01"
            defaultValue={decimal(t?.commissionBps ?? 0)}
            required
          />
        </Field>
      </div>
      <Field label="حساب الموظف">
        <select name="userId" defaultValue={t?.userId ?? ''}>
          <option value="">بدون حساب مرتبط</option>
          {s.staffAccounts
            .filter((u) => u.active || u.id === t?.userId)
            .map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} — {u.username}
              </option>
            ))}
        </select>
      </Field>
      <Field label="ملاحظة الإدارة — لا تظهر للموظف">
        <textarea name="note" defaultValue={t?.note} maxLength={2000} />
      </Field>
      <Active checked={t ? !!t.active : true} />
      <p className="muted">
        أنشئ حسابًا بدور موظف الخدمات ثم اربطه هنا. يرى الموظف حجوزاته وعمولاته
        فقط. نسبة العمولة تحفظ عند الحجز أو إعادة التكليف.
      </p>
    </>
  ),
  payload: (f) => ({
    ...edit(t),
    code: text(f, 'code'),
    name: text(f, 'name'),
    phone: text(f, 'phone'),
    note: text(f, 'note'),
    userId: text(f, 'userId') || null,
    commissionBps: readMoney(text(f, 'commissionBps')),
    active: f.has('active'),
  }),
})
export const planForm = (s: SalonState, p?: SalonPlan): FormSpec => ({
  title: p ? 'تعديل الباقة' : 'باقة جلسات جديدة',
  action: 'sal.plan.save',
  body: (
    <>
      <div className="s-two">
        <Field label="كود الباقة">
          <Code value={p?.code} />
        </Field>
        <Field label="اسم الباقة">
          <input name="name" defaultValue={p?.name} required maxLength={160} />
        </Field>
        <Field label="خدمة الباقة">
          <select name="serviceId" defaultValue={p?.serviceId ?? ''} required>
            <option value="">اختر الخدمة</option>
            {s.services
              .filter((v) => v.active || v.id === p?.serviceId)
              .map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="عدد الجلسات">
          <input
            name="credits"
            type="number"
            min={1}
            max={1000}
            step={1}
            defaultValue={p?.credits ?? 1}
            required
          />
        </Field>
        <Field label="صلاحية الباقة، يوم">
          <input
            name="days"
            type="number"
            min={1}
            max={366}
            step={1}
            defaultValue={p?.days ?? 30}
            required
          />
        </Field>
        <Field label="سعر الباقة، ج.م">
          <input
            name="fee"
            type="number"
            min={0}
            step="0.01"
            defaultValue={p ? decimal(p.fee) : ''}
            required
          />
        </Field>
      </div>
      <Field label="وصف الباقة">
        <textarea
          name="description"
          defaultValue={p?.description}
          maxLength={2000}
        />
      </Field>
      <Active label="الباقة متاحة" checked={p ? !!p.active : true} />
      <p className="muted">
        كل باقة تخص خدمة واحدة؛ عدد الجلسات والسعر والصلاحية يثبتون وقت البيع.
      </p>
    </>
  ),
  payload: (f) => ({
    ...edit(p),
    code: text(f, 'code'),
    name: text(f, 'name'),
    serviceId: text(f, 'serviceId'),
    credits: Number(text(f, 'credits')),
    days: Number(text(f, 'days')),
    fee: readMoney(text(f, 'fee')),
    description: text(f, 'description'),
    active: f.has('active'),
  }),
})
function BookingFields({
  s,
  day: initial,
  customerId = '',
  serviceId = '',
  pack,
}: {
  s: SalonState
  day: string
  customerId?: string
  serviceId?: string
  pack?: SalonPackage
}) {
  const [c, setC] = useState(pack?.customerId ?? customerId),
    [v, setV] = useState(pack?.serviceId ?? serviceId),
    [t, setT] = useState(s.staff.find((x) => x.active)?.id ?? ''),
    [day, setDay] = useState(initial),
    [p, setP] = useState(pack?.id ?? ''),
    [discount, setDiscount] = useState('0.00')
  const svc = s.services.find((x) => x.id === v),
    employee = s.staff.find((x) => x.id === t),
    packages = s.packages.filter(
      (x) => x.customerId === c && x.serviceId === v && x.status === 'active',
    ),
    chosen = s.packages.find((x) => x.id === p)
  return (
    <>
      <div className="s-two">
        <Field label="العميل">
          <select
            name="customerId"
            value={c}
            onChange={(e) => {
              setC(e.target.value)
              setP('')
            }}
            required
            disabled={!!pack}
          >
            {!c && <option value="">اختر العميل</option>}
            {s.customers
              .filter((x) => x.active || x.id === c)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name} — {x.code}
                </option>
              ))}
          </select>
        </Field>
        <Field label="الخدمة">
          <select
            name="serviceId"
            value={v}
            onChange={(e) => {
              setV(e.target.value)
              setP('')
            }}
            required
            disabled={!!pack}
          >
            <option value="">اختر الخدمة</option>
            {s.services
              .filter((x) => x.active)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="الموظف">
          <select
            name="staffId"
            value={t}
            onChange={(e) => setT(e.target.value)}
            required
          >
            <option value="">اختر الموظف</option>
            {s.staff
              .filter((x) => x.active)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="يوم الموعد">
          <input
            name="day"
            type="date"
            value={day}
            onChange={(e) => setDay(e.target.value)}
            required
          />
        </Field>
        <Field label="وقت البداية">
          <input name="time" type="time" required />
        </Field>
        <Field label="طريقة احتساب الخدمة">
          <select
            name="packageId"
            value={p}
            onChange={(e) => {
              setP(e.target.value)
              setDiscount('0.00')
            }}
            disabled={!!pack}
          >
            <option value="">خدمة منفردة</option>
            {packages.map((x) => (
              <option
                key={x.id}
                value={x.id}
                disabled={
                  x.balance !== 0 ||
                  x.used + x.reserved >= x.credits ||
                  day < x.startDay ||
                  day > x.endDay
                }
              >
                {x.planName} — متاح{x.credits - x.used - x.reserved} /{' '}
                {x.credits}
                {x.balance ? ' · غير مسددة' : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label="الخصم المعتمد، ج.م">
          <input
            name="discount"
            type="number"
            min={0}
            step="0.01"
            value={discount}
            onChange={(e) => setDiscount(e.target.value)}
            readOnly={s.user.role === 'cashier' || !!p}
            required
          />
        </Field>
      </div>
      {pack && (
        <>
          <input name="customerId" type="hidden" value={c} />
          <input name="serviceId" type="hidden" value={v} />
          <input name="packageId" type="hidden" value={p} />
        </>
      )}
      <Field label="ملاحظة الاستقبال — لا تظهر للموظف">
        <textarea name="note" maxLength={2000} />
      </Field>
      {svc && (
        <div className="s-review">
          <strong>{svc.name}</strong>
          <span>{svc.duration} دقيقة</span>
          <span>
            {chosen
              ? 'جلسة من ' + chosen.planName
              : amount(svc.fee ?? 0) + ' ج.م'}
          </span>
          <span>{employee?.name}</span>
        </div>
      )}
      <label className="s-check">
        <input type="checkbox" required />
        راجعت الموظف والخدمة والوقت والسعر قبل الحجز
      </label>
    </>
  )
}
export const bookingForm = (
  s: SalonState,
  day: string,
  customerId = '',
  serviceId = '',
  pack?: SalonPackage,
): FormSpec => ({
  title: 'حجز موعد جديد',
  action: 'sal.booking.add',
  body: (
    <BookingFields
      s={s}
      day={day}
      customerId={customerId}
      serviceId={serviceId}
      pack={pack}
    />
  ),
  submit: 'تأكيد الحجز',
  payload: (f) => {
    const c = s.customers.find((x) => x.id === text(f, 'customerId')),
      v = s.services.find((x) => x.id === text(f, 'serviceId')),
      t = s.staff.find((x) => x.id === text(f, 'staffId')),
      p = s.packages.find((x) => x.id === text(f, 'packageId'))
    if (!c || !v || !t) throw Error('اختر العميل والخدمة والموظف')
    return {
      customerId: c.id,
      customerVersion: c.version,
      serviceId: v.id,
      serviceVersion: v.version,
      staffId: t.id,
      staffVersion: t.version,
      day: text(f, 'day'),
      startMinute: minutes(text(f, 'time')),
      discount: p ? 0 : readMoney(text(f, 'discount')),
      packageId: p?.id ?? null,
      packageVersion: p?.version ?? null,
      note: text(f, 'note'),
    }
  },
})
export const moveForm = (s: SalonState, b: SalonBooking): FormSpec => ({
  title: 'نقل الموعد — ' + b.customerName,
  action: 'sal.booking.move',
  body: (
    <>
      <p>
        {b.serviceName} · {b.duration} دقيقة · السعر وشروط الباقة ثابتة.
      </p>
      <div className="s-two">
        <Field label="يوم الموعد">
          <input name="day" type="date" defaultValue={b.day} required />
        </Field>
        <Field label="وقت البداية">
          <input
            name="time"
            type="time"
            defaultValue={clock(b.startMinute)}
            required
          />
        </Field>
        <Field label="الموظف">
          <select name="staffId" defaultValue={b.staffId} required>
            {s.staff
              .filter((t) => t.active)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} — عمولة{decimal(t.commissionBps ?? 0)}%
                </option>
              ))}
          </select>
        </Field>
      </div>
      <Field label="سبب نقل الموعد">
        <textarea name="reason" required maxLength={2000} />
      </Field>
      <label className="s-check">
        <input type="checkbox" required />
        راجعت الموعد الجديد ونسبة الموظف المكلف
      </label>
    </>
  ),
  submit: 'حفظ الموعد الجديد',
  payload: (f) => {
    const t = s.staff.find((x) => x.id === text(f, 'staffId'))
    if (!t) throw Error('اختر الموظف')
    return {
      id: b.id,
      version: b.version,
      day: text(f, 'day'),
      startMinute: minutes(text(f, 'time')),
      staffId: t.id,
      staffVersion: t.version,
      reason: text(f, 'reason'),
    }
  },
})
function SaleFields({
  s,
  c,
  day: initial,
}: {
  s: SalonState
  c: SalonCustomer
  day: string
}) {
  const [id, setId] = useState(s.plans.find((x) => x.active)?.id ?? ''),
    [day, setDay] = useState(initial),
    p = s.plans.find((x) => x.id === id)
  return (
    <>
      <p>
        {c.name} · {c.code}
      </p>
      <Field label="الباقة">
        <select
          name="planId"
          value={id}
          onChange={(e) => setId(e.target.value)}
          required
        >
          <option value="">اختر الباقة</option>
          {s.plans
            .filter((x) => x.active)
            .map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
        </select>
      </Field>
      <div className="s-two">
        <Field label="تاريخ بداية الباقة">
          <input
            name="startDay"
            type="date"
            value={day}
            onChange={(e) => setDay(e.target.value)}
            required
          />
        </Field>
        <Field label="الخصم المعتمد، ج.م">
          <input
            name="discount"
            type="number"
            min={0}
            step="0.01"
            defaultValue="0.00"
            readOnly={s.user.role === 'cashier'}
            required
          />
        </Field>
      </div>
      {p && (
        <div className="s-review">
          <strong>{p.serviceName}</strong>
          <span>{p.credits} جلسات</span>
          <span>{amount(p.fee)} ج.م</span>
          <span>آخر يوم {addDay(day, p.days - 1) || 'حدد تاريخ البداية'}</span>
        </div>
      )}
      <label className="s-check">
        <input type="checkbox" required />
        راجعت شروط الباقة والفترة؛ السداد كاملًا مطلوب قبل الحجز
      </label>
    </>
  )
}
export const saleForm = (
  s: SalonState,
  c: SalonCustomer,
  day: string,
): FormSpec => ({
  title: 'بيع باقة — ' + c.name,
  action: 'sal.package.sell',
  body: <SaleFields s={s} c={c} day={day} />,
  submit: 'تسجيل الباقة والرسوم',
  payload: (f) => {
    const p = s.plans.find((x) => x.id === text(f, 'planId'))
    if (!p) throw Error('اختر الباقة')
    return {
      customerId: c.id,
      customerVersion: c.version,
      planId: p.id,
      planVersion: p.version,
      startDay: text(f, 'startDay'),
      discount: readMoney(text(f, 'discount')),
    }
  },
})
const PaymentFields = ({ max }: { max: number }) => (
  <>
    <Field label="المبلغ المستلم، ج.م">
      <input
        name="amount"
        type="number"
        min="0.01"
        max={decimal(Math.min(max, 1e12))}
        step="0.01"
        defaultValue={decimal(Math.min(max, 1e12))}
        required
      />
    </Field>
    <Field label="طريقة الدفع">
      <select name="method">
        <option value="cash">نقدي</option>
        <option value="card">بطاقة</option>
        <option value="transfer">تحويل</option>
      </select>
    </Field>
    <Field label="مرجع العملية، اختياري">
      <input name="reference" maxLength={160} />
    </Field>
    <p className="muted">
      يسجل مبلغًا تم تسليمه بالفعل؛ لا ينفذ تحويلًا أو خصمًا من بطاقة.
    </p>
    <label className="s-check">
      <input type="checkbox" required />
      أؤكد استلام أو تسليم المبلغ ومراجعته
    </label>
  </>
)
export const paymentForm = (i: SalonInvoice): FormSpec => ({
  title: 'تحصيل — ' + i.number,
  action: 'sal.payment.post',
  body: (
    <>
      <p>
        {i.customer.name} · {i.item.name} · المستحق{amount(i.balance)} ج.م
      </p>
      <PaymentFields max={i.balance} />
    </>
  ),
  submit: 'حفظ إيصال التحصيل',
  payload: (f) => ({
    invoiceId: i.id,
    version: i.version,
    amount: readMoney(text(f, 'amount')),
    method: text(f, 'method'),
    reference: text(f, 'reference'),
  }),
})
export const payoutForm = (
  id: string,
  name: string,
  due: number,
): FormSpec => ({
  title: 'صرف عمولة — ' + name,
  action: 'sal.commission.pay',
  body: (
    <>
      <p>المستحق الحالي {amount(due)} ج.م</p>
      <PaymentFields max={due} />
    </>
  ),
  submit: 'تسجيل صرف العمولة',
  payload: (f) => ({
    staffId: id,
    amount: readMoney(text(f, 'amount')),
    method: text(f, 'method'),
    reference: text(f, 'reference'),
  }),
})
export const userForm = (u?: User): FormSpec => ({
  title: u ? 'تعديل الحساب' : 'حساب جديد',
  action: 'user.save',
  body: (
    <>
      <div className="s-two">
        <Field label="اسم المستخدم">
          <input
            name="username"
            defaultValue={u?.username}
            required
            minLength={3}
            maxLength={40}
            pattern="[A-Za-z0-9._-]+"
            readOnly={!!u}
          />
        </Field>
        <Field label="اسم المستخدم الظاهر">
          <input name="name" defaultValue={u?.name} required maxLength={160} />
        </Field>
        <Field label="الصلاحية">
          <select name="role" defaultValue={u?.role ?? 'cashier'}>
            {Object.entries(roles).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label={u ? 'كلمة مرور جديدة، اختياري' : 'كلمة المرور'}>
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            required={!u}
          />
        </Field>
      </div>
      <Active checked={u ? !!u.active : true} />
      <p className="muted">
        الحفظ ينهي جلسات الحساب. اربط حساب موظف الخدمات بملف الموظف لعرض
        حجوزاته.
      </p>
    </>
  ),
  payload: (f) => ({
    ...(u && { id: u.id }),
    username: u?.username ?? text(f, 'username'),
    name: text(f, 'name'),
    role: text(f, 'role'),
    active: f.has('active'),
    ...(passwordValue(f, 'password') && {
      password: passwordValue(f, 'password'),
    }),
  }),
})
export const passwordForm = (): FormSpec => ({
  title: 'تغيير كلمة المرور',
  action: 'password.change',
  body: (
    <>
      <Field label="كلمة المرور الحالية">
        <input
          name="current"
          type="password"
          required
          maxLength={128}
          autoComplete="current-password"
        />
      </Field>
      <Field label="كلمة المرور الجديدة">
        <input
          name="password"
          type="password"
          required
          minLength={12}
          maxLength={128}
          autoComplete="new-password"
        />
      </Field>
      <Field label="تأكيد كلمة المرور">
        <input
          name="confirm"
          type="password"
          required
          minLength={12}
          maxLength={128}
          autoComplete="new-password"
        />
      </Field>
    </>
  ),
  payload: (f) => {
    if (passwordValue(f, 'password') !== passwordValue(f, 'confirm'))
      throw Error('كلمتا المرور غير متطابقتين')
    return {
      current: passwordValue(f, 'current'),
      password: passwordValue(f, 'password'),
    }
  },
})
