import { useRef, useState } from 'react'
import type { HrState, HrPayrollDetail, HrPayrollItem } from '@xzare/engine'
import { Field, Modal, amount, decimal, csv } from './ui'
import { readMoney, stamp, payrollLabels, methods } from './model'
const keys = ['allowance', 'overtime', 'deduction', 'tax', 'insurance'] as const
const labels = {
  allowance: 'بدلات',
  overtime: 'إضافي معتمد',
  deduction: 'استقطاعات',
  tax: 'ضريبة مدخلة',
  insurance: 'تأمين مدخل',
}
export function PayrollEditor({
  s,
  busy,
  onClose,
  save,
}: {
  s: HrState
  busy: boolean
  onClose: () => void
  save: (a: string, p: Record<string, unknown>) => Promise<unknown>
}) {
  const [month, setMonth] = useState(s.today.slice(0, 7)),
    [error, setError] = useState(''),
    [selected, setSelected] = useState<string[]>([]),
    [values, setValues] = useState<Record<string, Record<string, string>>>({}),
    mutex = useRef(false)
  const rows = s.employees.filter(
    (e) => e.hired <= month + '-31' && (!e.ended || e.ended >= month + '-01'),
  )
  const build = () =>
    selected.map((id) => {
      const salary = s.salaries.find((x) => x.employeeId === id)
      if (!salary) throw new Error('سجل أساس الراتب لكل موظف مختار')
      const v = values[id] ?? {}
      return {
        employeeId: id,
        salaryVersion: salary.version,
        ...Object.fromEntries(keys.map((k) => [k, readMoney(v[k] ?? '0')])),
        note: v.note ?? '',
      }
    })
  let total = 0,
    valid = true
  try {
    for (const x of build()) {
      const b = s.salaries.find((y) => y.employeeId === x.employeeId)!.base
      const v = x as any
      const net = b + v.allowance + v.overtime - v.deduction - v.tax - v.insurance
      if (net < 0 || !Number.isSafeInteger(net) || net > 1e12) throw new Error()
      total += net
    }
    if (total > 1e12) throw new Error()
  } catch {
    valid = false
  }
  return (
    <Modal
      title="إعداد مسير راتب"
      busy={busy}
      error={error}
      disabled={!selected.length || selected.length > 200 || !valid}
      submit="إرسال للمراجعة"
      onClose={onClose}
      onSubmit={async (e) => {
        if (mutex.current || busy) return
        mutex.current = true
        setError('')
        try {
          await save('hr.payroll.submit', {
            month,
            note: String(new FormData(e.currentTarget).get('note') ?? ''),
            items: build(),
          })
          onClose()
        } catch (e) {
          setError(e instanceof Error ? e.message : 'تعذر إرسال المسير')
        } finally {
          mutex.current = false
        }
      }}
    >
      <div className="hr-callout">
        راجع الموظفين والمبالغ قبل الإرسال. الأساس الشهري لا يُقسّم تلقائيًا عند التعيين أو انتهاء
        العمل، والحضور لا يخصم مبالغ تلقائيًا. بعد الإرسال تُحفظ نسخة ثابتة ويعتمدها مستخدم آخر.
      </div>
      <Field label="شهر الراتب">
        <input
          type="month"
          required
          value={month}
          onChange={(e) => {
            setMonth(e.target.value)
            setSelected([])
            setValues({})
          }}
        />
      </Field>
      <div className="hr-payroll-editor">
        {rows.map((e) => {
          const salary = s.salaries.find((x) => x.employeeId === e.id),
            chosen = selected.includes(e.id)
          return (
            <section key={e.id} className={chosen ? 'chosen' : ''}>
              <label className="a-check">
                <input
                  type="checkbox"
                  disabled={!salary || busy}
                  checked={chosen}
                  onChange={(x) =>
                    setSelected((old) =>
                      x.target.checked ? [...old, e.id] : old.filter((id) => id !== e.id),
                    )
                  }
                />
                <strong>{e.name}</strong>
                <span>{e.department || e.code}</span>
                <b>{salary ? amount(salary.base) + ' ج.م' : 'سجل أساس الراتب أولًا'}</b>
              </label>
              {chosen && (
                <div className="hr-adjustments">
                  {keys.map((k) => (
                    <Field label={labels[k]} key={k}>
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        required
                        value={values[e.id]?.[k] ?? '0'}
                        onChange={(x) =>
                          setValues((old) => ({
                            ...old,
                            [e.id]: { ...old[e.id], [k]: x.target.value },
                          }))
                        }
                      />
                    </Field>
                  ))}
                  <Field label="ملاحظة البند">
                    <input
                      maxLength={1500}
                      value={values[e.id]?.note ?? ''}
                      onChange={(x) =>
                        setValues((old) => ({
                          ...old,
                          [e.id]: { ...old[e.id], note: x.target.value },
                        }))
                      }
                    />
                  </Field>
                </div>
              )}
            </section>
          )
        })}
      </div>
      <Field label="ملاحظة المسير">
        <textarea name="note" maxLength={1500} />
      </Field>
      <div className="hr-total">
        <span>{selected.length} موظف مختار · الصافي</span>
        <strong>{valid ? amount(total) : 'راجع المبالغ'} ج.م</strong>
      </div>
    </Modal>
  )
}
export function PayrollDetail({
  d,
  busy,
  userId,
  businessName,
  onClose,
  mutate,
}: {
  d: HrPayrollDetail
  busy: boolean
  userId: string
  businessName: string
  onClose: () => void
  mutate: (a: string, p: Record<string, unknown>) => Promise<unknown>
}) {
  const [form, setForm] = useState<{
      kind: 'approve' | 'void' | 'pay'
      item?: HrPayrollItem
    } | null>(null),
    [error, setError] = useState(''),
    [source, setSource] = useState<string | null>(null),
    mutex = useRef(false)
  const r = d.run
  return (
    <Modal title={'مسير ' + r.number} busy={busy} error={error} manual onClose={onClose}>
      <div className="hr-payroll-document print-area">
        <header>
          <span>{businessName}</span>
          <h2>مسير رواتب {r.month}</h2>
          <p>
            {r.number} · {payrollLabels[r.status]} · نسخة ثابتة
          </p>
        </header>
        <div className="hr-doc-meta">
          <span>إعداد: {r.creatorName}</span>
          <span>اعتماد: {r.approverName || 'بانتظار مستخدم آخر'}</span>
          <span>{stamp(r.at)}</span>
        </div>
        <p>{r.note}</p>
        <div className="hr-table-wrap">
          <table>
            <thead>
              <tr>
                <th>الموظف</th>
                <th>أساس</th>
                <th>بدلات + إضافي</th>
                <th>استقطاعات + ضريبة + تأمين</th>
                <th>صافي</th>
                <th>مصروف</th>
                <th>متبقي</th>
                <th className="no-print">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {d.items.map((i) => (
                <tr key={i.id}>
                  <td>
                    <strong>{i.employeeName}</strong>
                    <small>
                      {i.employeeCode} · {i.department}
                    </small>
                  </td>
                  <td>{amount(i.base)}</td>
                  <td>{amount(i.allowance + i.overtime)}</td>
                  <td>{amount(i.deduction + i.tax + i.insurance)}</td>
                  <td>{amount(i.net)}</td>
                  <td>{amount(i.paid)}</td>
                  <td>{amount(i.balance)}</td>
                  <td className="no-print">
                    <button
                      disabled={busy}
                      onClick={() => setSource(source === i.id ? null : i.id)}
                    >
                      التفاصيل
                    </button>
                    {r.status === 'approved' && i.balance > 0 && (
                      <button
                        disabled={busy}
                        onClick={() => {
                          setForm({ kind: 'pay', item: i })
                          setError('')
                        }}
                      >
                        تسجيل صرف
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="hr-total">
          <span>
            الصافي {amount(r.total)} · المصروف {amount(r.paid)}
          </span>
          <strong>المتبقي {amount(r.balance)} ج.م</strong>
        </div>
      </div>
      {d.items
        .filter((i) => i.id === source)
        .map((i) => (
          <section className="hr-callout" key={i.id}>
            <h3>{i.employeeName} — بيانات البند المحفوظة</h3>
            <p>
              البدلات {amount(i.allowance)} · الإضافي {amount(i.overtime)} · الاستقطاعات{' '}
              {amount(i.deduction)} · الضريبة {amount(i.tax)} · التأمين {amount(i.insurance)} ج.م
            </p>
            <p>{i.note}</p>
            <p>
              نسخة أساس الراتب {i.source.salaryVersion} · حضور {i.source.attendance.length} يوم ·{' '}
              {i.source.attendance.reduce((n, a) => n + a.worked, 0)} دقيقة عمل ·{' '}
              {i.source.attendance.reduce((n, a) => n + a.late, 0)} دقيقة تأخير ·{' '}
              {i.source.attendance.reduce((n, a) => n + a.overtime, 0)} دقيقة إضافية
            </p>
            <p>
              الإجازات المعتمدة:{' '}
              {i.source.leaves
                .map((l) => l.from + ' → ' + l.to + ' (' + l.days + ' أيام)')
                .join('، ') || 'لا توجد'}
            </p>
          </section>
        ))}
      <div className="hr-toolbar no-print">
        <button onClick={() => window.print()}>طباعة المسير</button>
        <button
          onClick={() =>
            csv('HR-payroll-' + r.month + '.csv', [
              [
                'رقم المسير',
                'الشهر',
                'كود الموظف',
                'الاسم',
                'أساس',
                'بدلات',
                'إضافي',
                'استقطاعات',
                'ضريبة',
                'تأمين',
                'صافي',
                'مصروف',
                'متبقي',
              ],
              ...d.items.map((i) => [
                r.number,
                r.month,
                i.employeeCode,
                i.employeeName,
                decimal(i.base),
                decimal(i.allowance),
                decimal(i.overtime),
                decimal(i.deduction),
                decimal(i.tax),
                decimal(i.insurance),
                decimal(i.net),
                decimal(i.paid),
                decimal(i.balance),
              ]),
            ])
          }
        >
          تصدير CSV
        </button>
        {r.status === 'submitted' && (
          <button
            className="primary"
            disabled={busy || r.creatorId === userId}
            onClick={() => setForm({ kind: 'approve' })}
          >
            اعتماد المسير
          </button>
        )}
        {r.status !== 'void' && r.paid === 0 && (
          <button disabled={busy} onClick={() => setForm({ kind: 'void' })}>
            إلغاء المسير
          </button>
        )}
      </div>
      {r.status === 'submitted' && r.creatorId === userId && (
        <p className="muted">سجّل الدخول بحساب مدير أو مسؤول رواتب آخر لاعتماد هذا المسير.</p>
      )}
      {d.payments.length > 0 && (
        <>
          <h3>سجل الصرف</h3>
          <table>
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>الموظف</th>
                <th>المبلغ</th>
                <th>الطريقة</th>
                <th>المرجع</th>
              </tr>
            </thead>
            <tbody>
              {d.payments.map((p) => (
                <tr key={p.id}>
                  <td>{stamp(p.at)}</td>
                  <td>{d.items.find((i) => i.id === p.itemId)?.employeeName}</td>
                  <td>{amount(p.amount)}</td>
                  <td>{methods[p.method as keyof typeof methods]}</td>
                  <td>{p.reference}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {form && (
        <form
          className="hr-inline-form no-print"
          onSubmit={async (e) => {
            e.preventDefault()
            if (busy || mutex.current) return
            const f = new FormData(e.currentTarget)
            mutex.current = true
            setError('')
            try {
              await mutate(
                'hr.payroll.' + form.kind,
                form.kind === 'pay'
                  ? {
                      id: form.item!.id,
                      amount: readMoney(f.get('amount')),
                      method: String(f.get('method')),
                      reference: String(f.get('reference')),
                    }
                  : { id: r.id, version: r.version, reason: String(f.get('reason')) },
              )
              setForm(null)
            } catch (e) {
              setError(e instanceof Error ? e.message : 'تعذر الحفظ')
            } finally {
              mutex.current = false
            }
          }}
        >
          <h3>
            {form.kind === 'pay'
              ? 'تسجيل صرف — ' + form.item!.employeeName
              : form.kind === 'approve'
                ? 'اعتماد نسخة المسير'
                : 'إلغاء المسير دون حذف سجله'}
          </h3>
          {form.kind === 'pay' ? (
            <>
              <Field label="مبلغ الصرف">
                <input
                  name="amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  max={decimal(form.item!.balance)}
                  defaultValue={decimal(form.item!.balance)}
                  required
                />
              </Field>
              <Field label="طريقة الصرف">
                <select name="method">
                  {Object.entries(methods).map(([v, n]) => (
                    <option value={v} key={v}>
                      {n}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="مرجع الصرف">
                <input name="reference" required maxLength={1500} />
              </Field>
              <p className="muted">سجل محاسبي لمبلغ صرفته بالفعل؛ لا ينفذ تحويلًا بنكيًا.</p>
            </>
          ) : (
            <Field label="سبب القرار">
              <textarea name="reason" required maxLength={1500} />
            </Field>
          )}
          <label className="a-check">
            <input type="checkbox" required />
            راجعت البيانات وأؤكد العملية
          </label>
          <button type="button" disabled={busy} onClick={() => setForm(null)}>
            رجوع
          </button>
          <button className="primary" disabled={busy}>
            حفظ القرار
          </button>
        </form>
      )}
    </Modal>
  )
}
