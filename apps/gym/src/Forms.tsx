import { useState, type ReactNode } from 'react'
import type {
  GymState,
  GymMember,
  GymPlan,
  GymTrainer,
  GymMembership,
  GymSession,
} from '@xzare/engine'
import { Field, amount, decimal, today } from './ui'
import { readMoney, addDay, clock, minutes } from './model'
export type GymForm = {
  title: string
  action: string
  body: ReactNode
  payload: (f: FormData) => Record<string, unknown>
  submit?: string
}
export const text = (f: FormData, k: string) => String(f.get(k) ?? '').trim()
const codeInput = (v = '') => (
  <input
    name="code"
    defaultValue={v}
    required
    maxLength={64}
    pattern="[A-Za-z0-9][A-Za-z0-9._/\-]*"
    dir="ltr"
  />
)
const edit = (x?: { id: string; version: number }) =>
  x ? { id: x.id, version: x.version } : {}
export const memberForm = (m?: GymMember): GymForm => ({
  title: m ? 'تعديل العضو' : 'عضو جديد',
  action: 'gym.member.save',
  body: (
    <>
      <div className="gym-two">
        <Field label="كود العضوية / الباركود">{codeInput(m?.code)}</Field>
        <Field label="اسم العضو">
          <input
            name="name"
            defaultValue={m?.name ?? ''}
            required
            maxLength={160}
          />
        </Field>
        <Field label="رقم التواصل">
          <input
            name="phone"
            defaultValue={m?.phone ?? ''}
            maxLength={160}
            dir="ltr"
          />
        </Field>
      </div>
      <Field label="ملاحظة الاستقبال — لا تظهر للمدرب">
        <textarea name="note" defaultValue={m?.note ?? ''} maxLength={2000} />
      </Field>
      <label className="a-check">
        <input
          name="active"
          type="checkbox"
          defaultChecked={m ? !!m.active : true}
        />
        العضو نشط
      </label>
      <p className="muted">
        استخدم كودًا فريدًا من حروف إنجليزية وأرقام. الكود ثابت بعد إنشاء
        اشتراك، ويمكن طباعته ومسحه بقارئ USB.
      </p>
    </>
  ),
  payload: (f) => ({
    ...edit(m),
    code: text(f, 'code'),
    name: text(f, 'name'),
    phone: text(f, 'phone'),
    note: text(f, 'note'),
    active: f.has('active'),
  }),
})
export const planForm = (p?: GymPlan): GymForm => ({
  title: p ? 'تعديل باقة الاشتراك' : 'باقة جديدة',
  action: 'gym.plan.save',
  body: (
    <>
      <div className="gym-two">
        <Field label="كود الباقة">{codeInput(p?.code)}</Field>
        <Field label="اسم الباقة">
          <input
            name="name"
            defaultValue={p?.name ?? ''}
            required
            maxLength={160}
          />
        </Field>
        <Field label="المدة بالأيام">
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
        <Field label="السعر، ج.م">
          <input
            name="fee"
            type="number"
            min={0}
            step="0.01"
            defaultValue={p ? decimal(p.fee ?? 0) : ''}
            required
          />
        </Field>
        <Field label="حد الزيارات — فارغ يعني غير محدود">
          <input
            name="visits"
            type="number"
            min={1}
            max={10000}
            step={1}
            defaultValue={p?.visits ?? ''}
          />
        </Field>
        <Field label="أيام التجميد المسموحة">
          <input
            name="freezeDays"
            type="number"
            min={0}
            max={90}
            step={1}
            defaultValue={p?.freezeDays ?? 0}
            required
          />
        </Field>
      </div>
      <Field label="وصف الباقة">
        <textarea
          name="description"
          defaultValue={p?.description ?? ''}
          maxLength={2000}
        />
      </Field>
      <label className="a-check">
        <input
          name="active"
          type="checkbox"
          defaultChecked={p ? !!p.active : true}
        />
        الباقة متاحة للاشتراك
      </label>
      <p>
        تغيير الباقة يسري على الاشتراكات الجديدة؛ الاشتراكات السابقة تحفظ سعرها
        وحدودها وقت التسجيل.
      </p>
    </>
  ),
  payload: (f) => ({
    ...edit(p),
    code: text(f, 'code'),
    name: text(f, 'name'),
    days: Number(text(f, 'days')),
    fee: readMoney(text(f, 'fee')),
    visits: text(f, 'visits') ? Number(text(f, 'visits')) : null,
    freezeDays: Number(text(f, 'freezeDays')),
    description: text(f, 'description'),
    active: f.has('active'),
  }),
})
export const trainerForm = (s: GymState, t?: GymTrainer): GymForm => ({
  title: t ? 'تعديل مدرب' : 'مدرب جديد',
  action: 'gym.trainer.save',
  body: (
    <>
      <div className="gym-two">
        <Field label="كود المدرب">{codeInput(t?.code)}</Field>
        <Field label="اسم المدرب">
          <input
            name="name"
            defaultValue={t?.name ?? ''}
            required
            maxLength={160}
          />
        </Field>
        <Field label="رقم التواصل">
          <input
            name="phone"
            defaultValue={t?.phone ?? ''}
            maxLength={160}
            dir="ltr"
          />
        </Field>
        <Field label="حساب المدرب">
          <select name="userId" defaultValue={t?.userId ?? ''}>
            <option value="">بدون حساب مرتبط</option>
            {s.trainerAccounts
              .filter((u) => u.active)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} — {u.username}
                </option>
              ))}
          </select>
        </Field>
      </div>
      <Field label="ملاحظة الإدارة — لا تظهر للمدرب">
        <textarea name="note" defaultValue={t?.note ?? ''} maxLength={2000} />
      </Field>
      <label className="a-check">
        <input
          name="active"
          type="checkbox"
          defaultChecked={t ? !!t.active : true}
        />
        المدرب نشط
      </label>
      <p>
        أنشئ حسابًا بدور مدرب من المستخدمين ثم اربطه هنا. يرى المدرب الأعضاء
        المكلف بهم فقط.
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
    active: f.has('active'),
  }),
})
function MembershipFields({
  s,
  member,
  old,
}: {
  s: GymState
  member: GymMember
  old?: GymMembership
}) {
  const plans = s.plans.filter((p) => p.active),
    [planId, setPlan] = useState(plans[0]?.id ?? ''),
    [start, setStart] = useState(old?.renewalDay ?? today()),
    p = plans.find((x) => x.id === planId)
  return (
    <>
      <p className="gym-review">
        {member.name} <bdi>{member.code}</bdi>
      </p>
      <div className="gym-two">
        <Field label="باقة الاشتراك">
          <select
            name="planId"
            required
            value={planId}
            onChange={(e) => setPlan(e.target.value)}
          >
            <option value="">اختر الباقة</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="تاريخ البداية">
          <input
            name="startDay"
            type="date"
            required
            min={today()}
            value={start}
            readOnly={!!old}
            onChange={(e) => setStart(e.target.value)}
          />
        </Field>
        <Field label="المدرب المكلف، اختياري">
          <select name="trainerId" defaultValue={old?.trainerId ?? ''}>
            <option value="">بدون مدرب</option>
            {s.trainers
              .filter((t) => t.active)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="الخصم المعتمد، ج.م">
          <input
            name="discount"
            type="number"
            min={0}
            max={(p?.fee ?? 0) / 100}
            step="0.01"
            defaultValue="0.00"
            required
            readOnly={s.user.role === 'cashier'}
          />
        </Field>
      </div>
      {p && (
        <div className="gym-review">
          <span>السعر {amount(p.fee ?? 0)} ج.م</span>
          <span>
            {p.days} يومًا — آخر يوم{' '}
            {addDay(start, p.days - 1) || 'حدد تاريخ البداية'}
          </span>
          <span>
            {p.visits ?? 'غير محدود'} زيارة — تجميد حتى {p.freezeDays} يومًا
          </span>
        </div>
      )}
      <label className="a-check">
        <input type="checkbox" required />
        راجعت الباقة والفترة والسعر قبل تسجيل الرسوم
      </label>
      {old && (
        <p>
          التجديد يبدأ بعد آخر اشتراك قائم أو من اليوم إذا انتهى. لا يغير
          الاشتراك السابق.
        </p>
      )}
    </>
  )
}
export const membershipForm = (
  s: GymState,
  m: GymMember,
  old?: GymMembership,
): GymForm => ({
  title: old ? 'تجديد اشتراك — ' + m.name : 'اشتراك جديد — ' + m.name,
  action: old ? 'gym.membership.renew' : 'gym.membership.add',
  body: <MembershipFields s={s} member={m} old={old} />,
  submit: 'تسجيل الاشتراك والرسوم',
  payload: (f) => {
    const p = s.plans.find((x) => x.id === text(f, 'planId'))
    if (!p) throw Error('اختر باقة نشطة')
    return {
      ...(old
        ? { id: old.id, version: old.version }
        : { memberId: m.id, memberVersion: m.version }),
      planId: p.id,
      planVersion: p.version,
      trainerId: text(f, 'trainerId') || null,
      startDay: text(f, 'startDay'),
      discount: readMoney(text(f, 'discount')),
    }
  },
})
export const bookingForm = (m: GymMembership, b?: GymSession): GymForm => ({
  title: b ? 'تعديل موعد التدريب' : 'موعد تدريب — ' + m.memberName,
  action: 'gym.session.save',
  body: (
    <>
      <p>
        {m.trainerName ?? 'بدون مدرب'} — {m.planName}
      </p>
      <div className="gym-two">
        <Field label="اليوم">
          <input
            name="day"
            type="date"
            defaultValue={b?.day ?? today()}
            required
            min={today() > m.startDay ? today() : m.startDay}
            max={m.endDay}
          />
        </Field>
        <Field label="الوقت">
          <input
            name="start"
            type="time"
            required
            defaultValue={b ? clock(b.startMinute) : ''}
          />
        </Field>
        <Field label="المدة بالدقائق">
          <input
            name="duration"
            type="number"
            required
            min={5}
            max={480}
            step={1}
            defaultValue={b?.duration ?? 60}
          />
        </Field>
        <Field label="عنوان الحجز — للاستقبال">
          <input
            name="title"
            defaultValue={b?.title ?? ''}
            required
            maxLength={160}
          />
        </Field>
      </div>
      <Field label="ملاحظة الاستقبال — لا تظهر للمدرب">
        <textarea name="note" defaultValue={b?.note ?? ''} maxLength={2000} />
      </Field>
      <p>لا يقبل موعدًا متداخلًا للمدرب أو العضو أو واقعًا في فترة التجميد.</p>
    </>
  ),
  payload: (f) => ({
    ...(b && { id: b.id, sessionVersion: b.version }),
    membershipId: m.id,
    version: m.version,
    day: text(f, 'day'),
    startMinute: minutes(text(f, 'start')),
    duration: Number(text(f, 'duration')),
    title: text(f, 'title'),
    note: text(f, 'note'),
  }),
})
