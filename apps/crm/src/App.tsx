import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ulid } from '@xzare/core'
import type {
  CrmState,
  CrmLead,
  CrmContact,
  CrmOpportunity,
  CrmTask,
  CrmEntity,
  CrmRecordDetail,
  CrmQuoteDetail,
  CrmReport,
  User,
} from '@xzare/engine'
import { call } from '../../pos/src/bridge'
import { useSessionActivity } from '../../pos/src/useSessionActivity'
import { LicensePanel } from '../../pos/src/LicensePanel'
import { WorkspaceClock } from '../../pos/src/WorkspaceClock'
import { AuthScreen, type AuthValues } from './AuthScreen'
import { Modal, Field, Empty, amount, decimal, today, csv, download } from './ui'
import {
  roles,
  stages,
  leadStatuses,
  quoteStatuses,
  taskKinds,
  stamp,
  clock,
  minutes,
  readMoney,
} from './model'
import { QuoteEditor, QuoteDetail } from './Quotes'
import { commitThenRefresh } from './commit-refresh'
import { exclusive } from './exclusive'
import { hasRecord, scopeRevoked } from './visibility'
import { canMoveOpportunity } from './board-move'
const pages = {
  today: 'المتابعات اليوم',
  pipeline: 'مسار البيع',
  leads: 'العملاء المحتملون',
  contacts: 'دليل العملاء',
  tasks: 'كل المتابعات',
  quotes: 'عروض الأسعار',
  reports: 'التقارير',
  users: 'المستخدمون',
  audit: 'سجل التدقيق',
  settings: 'الإعدادات والترخيص',
}
type View = keyof typeof pages
type Form = {
  title: string
  body: ReactNode
  action: string
  payload: (f: FormData) => Record<string, unknown>
  submit?: string
}
const text = (f: FormData, k: string) => String(f.get(k) ?? '')
const actions: Record<string, string> = {
  'crm.lead.save': 'تسجيل أو تحديث عميل محتمل',
  'crm.lead.status': 'تغيير تأهيل العميل',
  'crm.lead.convert': 'تحويل إلى ملف عميل',
  'crm.contact.save': 'تسجيل أو تحديث العميل',
  'crm.opportunity.save': 'تسجيل أو تحديث فرصة',
  'crm.opportunity.stage': 'تغيير مرحلة الفرصة',
  'crm.task.save': 'تسجيل أو تعديل متابعة',
  'crm.task.status': 'قرار متابعة',
  'crm.quote.issue': 'إصدار عرض سعر',
  'crm.quote.status': 'تسجيل قرار العرض',
  'crm.activity.add': 'تواصل مسجل',
}
const entityLabels = { lead: 'عميل محتمل', contact: 'عميل', opportunity: 'فرصة' }
export function App() {
  const [configured, setConfigured] = useState<boolean | null>(null),
    [s, setState] = useState<CrmState | null>(null),
    [view, setView] = useState<View>('today'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [query, setQuery] = useState(''),
    [form, setForm] = useState<Form | null>(null),
    [detail, setDetail] = useState<CrmRecordDetail | null>(null),
    [quoteDetail, setQuoteDetail] = useState<CrmQuoteDetail | null>(null),
    [quoteEditor, setQuoteEditor] = useState<string | null>(null),
    [quoteChoice, setQuoteChoice] = useState(''),
    [taskFilter, setTaskFilter] = useState('open'),
    [from, setFrom] = useState(today().slice(0, 7) + '-01'),
    [to, setTo] = useState(today()),
    [report, setReport] = useState<CrmReport | null>(null)
  const currentScope = useRef<CrmState | null>(null),
    mutex = useRef(false),
    generation = useRef(0),
    loadSeq = useRef(0),
    requests = useRef(new Map<string, string>())
  const end = () => {
    currentScope.current = null
    generation.current++
    setState(null)
    setForm(null)
    setDetail(null)
    setQuoteDetail(null)
    setQuoteEditor(null)
    setQuoteChoice('')
    setReport(null)
    setView('today')
    setQuery('')
    setError('')
    setNotice('')
    requests.current.clear()
  }
  const authError = (m: string) => {
    if (/انتهت الجلسة|سجّل الدخول/.test(m)) {
      end()
      setError(m)
    }
  }
  useSessionActivity(!!s, end)
  async function load() {
    const g = generation.current,
      n = ++loadSeq.current,
      v = await call<CrmState>('crm.state')
    if (g === generation.current && n === loadSeq.current) {
      if (currentScope.current && scopeRevoked(currentScope.current, v)) setForm(null)
      currentScope.current = v
      setState(v)
      setDetail((old) => (old && hasRecord(v, old.entityType, old.record.id) ? old : null))
      setQuoteDetail((old) =>
        old && hasRecord(v, 'opportunity', old.quote.opportunityId) ? old : null,
      )
      setQuoteEditor((old) => (old && hasRecord(v, 'opportunity', old) ? old : null))
    }
  }
  useEffect(() => {
    void call<{ configured: boolean }>('auth.status')
      .then((r) => {
        setConfigured(r.configured)
        if (r.configured) void load().catch(() => {})
      })
      .catch((e) => setError(e.message))
  }, [])
  useEffect(() => {
    if (!s) return
    const id = setInterval(() => {
      if (!mutex.current)
        void load().catch((e) => {
          setError(e.message)
          authError(e.message)
        })
    }, 15000)
    return () => clearInterval(id)
  }, [s?.user.id])
  useEffect(() => {
    if (!s || view !== 'reports') return
    let live = true
    setReport(null)
    void call<CrmReport>('crm.report', { from, to })
      .then((r) => {
        if (live) setReport(r)
      })
      .catch((e) => {
        if (live) {
          setError(e.message)
          authError(e.message)
        }
      })
    return () => {
      live = false
    }
  }, [view, from, to, s])
  const invoke = (f: () => Promise<unknown>) => {
    void f().catch((e) => {
      const m = e instanceof Error ? e.message : 'تعذر إتمام العملية'
      setError(m)
      authError(m)
    })
  }
  async function run(a: string, p: Record<string, unknown> = {}) {
    if (mutex.current) throw new Error('انتظر انتهاء العملية')
    const g = generation.current,
      key = JSON.stringify([a, p]),
      command = a.startsWith('crm.')
    mutex.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      if (command && !requests.current.has(key)) requests.current.set(key, ulid())
      const r = await call<{ id: string }>(
        a,
        command ? { ...p, clientTxnId: requests.current.get(key) } : p,
      )
      if (g !== generation.current) throw new Error('انتهت الجلسة؛ سجّل الدخول مرة أخرى')
      requests.current.delete(key)
      setNotice('تم حفظ العملية')
      try {
        await load()
      } catch (e) {
        authError(e instanceof Error ? e.message : '')
        setError('تم الحفظ؛ حدّث العرض لقراءة البيانات الجديدة')
      }
      return r
    } catch (e) {
      const m = e instanceof Error ? e.message : 'تعذر الحفظ'
      setError(m)
      authError(m)
      throw e
    } finally {
      mutex.current = false
      setBusy(false)
    }
  }
  const saveForm = (
    title: string,
    body: ReactNode,
    action: string,
    payload: Form['payload'],
    submit?: string,
  ) => {
    setDetail(null)
    setQuoteDetail(null)
    setError('')
    setForm({ title, body, action, payload, submit })
  }
  async function openRecord(type: CrmEntity, id: string) {
    const g = generation.current,
      v = await call<CrmRecordDetail>('crm.' + type + '.get', { id })
    if (
      g === generation.current &&
      currentScope.current &&
      hasRecord(currentScope.current, type, id)
    ) {
      setQuoteDetail(null)
      setDetail(v)
      setError('')
    }
  }
  async function openQuote(id: string) {
    const g = generation.current,
      v = await call<CrmQuoteDetail>('crm.quote.get', { id })
    if (
      g === generation.current &&
      currentScope.current &&
      hasRecord(currentScope.current, 'opportunity', v.quote.opportunityId)
    ) {
      setDetail(null)
      setQuoteDetail(v)
      setError('')
    }
  }
  async function authenticate(v: AuthValues) {
    await exclusive(mutex, setBusy, async () => {
      setError('')
      try {
        await call(
          configured ? 'login' : 'setup',
          configured ? { username: v.username, password: v.password } : v,
        )
        setConfigured(true)
        await load()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'تعذر الدخول')
        throw e
      }
    })
  }
  if (!s)
    return (
      <AuthScreen configured={configured} busy={busy} error={error} onAuthenticate={authenticate} />
    )
  const manager = ['admin', 'manager'].includes(s.user.role),
    admin = s.user.role === 'admin',
    ownerName = (id: string) => s.assignees.find((x) => x.id === id)?.name ?? 'مستخدم مكلف',
    ownerOptions = (id?: string) => (
      <Field label="المستخدم المكلف">
        <select name="ownerId" required defaultValue={id ?? s.user.id}>
          {id && !s.assignees.some((u) => u.id === id) && (
            <option value={id}>المكلف غير نشط؛ اختر مستخدمًا جديدًا</option>
          )}
          {s.assignees.map((u) => (
            <option value={u.id} key={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </Field>
    )
  const records = [
      ...s.leads.map((x) => ({ type: 'lead' as CrmEntity, id: x.id, name: x.name })),
      ...s.contacts.map((x) => ({ type: 'contact' as CrmEntity, id: x.id, name: x.name })),
      ...s.opportunities.map((x) => ({
        type: 'opportunity' as CrmEntity,
        id: x.id,
        name: x.title,
      })),
    ],
    recordName = (type: CrmEntity, id: string) =>
      records.find((x) => x.type === type && x.id === id)?.name ?? 'سجل',
    overdue = (t: CrmTask) =>
      t.status === 'open' &&
      (t.dueDay < s.today || (t.dueDay === s.today && t.dueMinute < s.nowMinute)),
    due = s.tasks.filter((t) => t.status === 'open' && t.dueDay <= s.today),
    visibleTasks = s.tasks.filter((t) =>
      taskFilter === 'all' || taskFilter === 'overdue'
        ? taskFilter === 'all' || overdue(t)
        : t.status === taskFilter,
    ),
    matching = (v: string) => v.toLowerCase().includes(query.toLowerCase())
  function personEditor(type: 'lead' | 'contact', v?: CrmLead | CrmContact) {
    saveForm(
      v ? 'تعديل ' + entityLabels[type] : 'إضافة ' + entityLabels[type],
      <>
        <div className="a-form-row">
          <Field label="اسم الشخص">
            <input name="name" required maxLength={160} defaultValue={v?.name} />
          </Field>
          <Field label="الشركة">
            <input name="company" maxLength={160} defaultValue={v?.company} />
          </Field>
        </div>
        <div className="a-form-row">
          <Field label="الهاتف">
            <input name="phone" maxLength={40} dir="ltr" defaultValue={v?.phone} />
          </Field>
          <Field label="البريد الإلكتروني">
            <input name="email" type="email" maxLength={200} dir="ltr" defaultValue={v?.email} />
          </Field>
        </div>
        {ownerOptions(v?.ownerId)}
        {type === 'lead' ? (
          <Field label="مصدر العميل المحتمل">
            <input
              name="source"
              maxLength={160}
              defaultValue={(v as CrmLead | undefined)?.source}
            />
          </Field>
        ) : (
          <>
            <Field label="كود العميل">
              <input
                name="code"
                required
                maxLength={160}
                defaultValue={(v as CrmContact | undefined)?.code}
              />
            </Field>
            <Field label="العنوان">
              <input
                name="address"
                maxLength={300}
                defaultValue={(v as CrmContact | undefined)?.address}
              />
            </Field>
            <label className="a-check">
              <input
                name="active"
                type="checkbox"
                defaultChecked={v ? !!(v as CrmContact).active : true}
              />
              عميل نشط
            </label>
          </>
        )}
        <Field label="ملاحظات العلاقة">
          <textarea name="note" maxLength={2000} defaultValue={v?.note} />
        </Field>
      </>,
      'crm.' + type + '.save',
      (f) => ({
        ...(v ? { id: v.id, version: v.version } : {}),
        name: text(f, 'name'),
        company: text(f, 'company'),
        phone: text(f, 'phone'),
        email: text(f, 'email'),
        ownerId: text(f, 'ownerId'),
        note: text(f, 'note'),
        ...(type === 'lead'
          ? { source: text(f, 'source') }
          : {
              code: text(f, 'code'),
              address: text(f, 'address'),
              active: f.get('active') === 'on',
            }),
      }),
    )
  }
  function leadStatus(l: CrmLead) {
    saveForm(
      'تأهيل ' + l.name,
      <>
        <Field label="الحالة الجديدة">
          <select name="status" defaultValue={l.status === 'converted' ? 'qualified' : l.status}>
            {(['new', 'qualified', 'disqualified'] as const).map((k) => (
              <option key={k} value={k}>
                {leadStatuses[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="سبب التغيير">
          <textarea name="reason" required maxLength={2000} />
        </Field>
      </>,
      'crm.lead.status',
      (f) => ({
        id: l.id,
        version: l.version,
        status: text(f, 'status'),
        reason: text(f, 'reason'),
      }),
    )
  }
  function convert(l: CrmLead) {
    saveForm(
      'تحويل ' + l.name + ' إلى عميل',
      <>
        <p>يربط المصدر بملف عميل مرة واحدة. بيانات العميل المحتمل الأصلية تبقى محفوظة.</p>
        <Field label="الملف المستهدف">
          <select name="contactId">
            <option value="">إنشاء عميل جديد</option>
            {s!.contacts
              .filter((c) => c.active && c.ownerId === l.ownerId)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.code}
                </option>
              ))}
          </select>
        </Field>
        <Field label="كود العميل الجديد">
          <input name="code" maxLength={160} />
        </Field>
        <p className="muted">
          الكود مطلوب عند إنشاء ملف جديد. عند اختيار ملف قائم يمكن تركه فارغًا.
        </p>
      </>,
      'crm.lead.convert',
      (f) => ({
        id: l.id,
        version: l.version,
        contactId: text(f, 'contactId') || null,
        code: text(f, 'code'),
      }),
      'تحويل إلى عميل',
    )
  }
  function opportunityEditor(o?: CrmOpportunity, contactId?: string) {
    saveForm(
      o ? 'تعديل الفرصة' : 'فرصة بيع جديدة',
      <>
        {o ? (
          <p>العميل: {o.contactName}</p>
        ) : (
          <Field label="العميل">
            <select name="contactId" required defaultValue={contactId ?? ''}>
              <option value="">اختر عميلًا نشطًا</option>
              {s!.contacts
                .filter((c) => c.active)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.company || c.code}
                  </option>
                ))}
            </select>
          </Field>
        )}
        <Field label="اسم الفرصة">
          <input name="title" required maxLength={160} defaultValue={o?.title} />
        </Field>
        <div className="a-form-row">
          <Field label="القيمة المتوقعة، ج.م">
            <input
              name="value"
              type="number"
              required
              min="0"
              step="0.01"
              defaultValue={o ? decimal(o.value) : ''}
            />
          </Field>
          <Field label="احتمال الإغلاق، %">
            <input
              name="probability"
              type="number"
              required
              min="0"
              max="100"
              defaultValue={o?.probability ?? 0}
            />
          </Field>
        </div>
        <Field label="تاريخ الإغلاق المتوقع">
          <input
            name="expectedClose"
            type="date"
            required
            defaultValue={o?.expectedClose ?? s!.today}
          />
        </Field>
        <Field label="نطاق الفرصة وملاحظاتها">
          <textarea name="note" maxLength={2000} defaultValue={o?.note} />
        </Field>
      </>,
      'crm.opportunity.save',
      (f) => ({
        ...(o ? { id: o.id, version: o.version } : {}),
        contactId: o?.contactId ?? text(f, 'contactId'),
        title: text(f, 'title'),
        value: readMoney(f.get('value')),
        probability: Number(f.get('probability')),
        expectedClose: text(f, 'expectedClose'),
        note: text(f, 'note'),
      }),
    )
  }
  function stageEditor(o: CrmOpportunity, target?: string) {
    const closed = ['won', 'lost'].includes(o.stage)
    saveForm(
      'مرحلة ' + o.title,
      <>
        <Field label="المرحلة الجديدة">
          <select name="stage" defaultValue={target ?? (closed ? 'negotiation' : o.stage)}>
            {Object.entries(stages)
              .filter(([k]) => !closed || !['won', 'lost'].includes(k))
              .map(([k, n]) => (
                <option key={k} value={k}>
                  {n}
                </option>
              ))}
          </select>
        </Field>
        <Field label="القيمة المؤكدة عند اختيار فائزة، ج.م">
          <input
            name="actualValue"
            type="number"
            min="0"
            step="0.01"
            defaultValue={o.actualValue !== null ? decimal(o.actualValue) : ''}
          />
        </Field>
        <Field label="سبب المرحلة أو نتيجة الإغلاق">
          <textarea name="reason" required maxLength={2000} />
        </Field>
        <p className="muted">
          الفوز يسجل قيمة أكدتها. الفرص المغلقة لا تُعدل حتى يعيد المدير فتحها.
        </p>
      </>,
      'crm.opportunity.stage',
      (f) => ({
        id: o.id,
        version: o.version,
        stage: text(f, 'stage'),
        actualValue: text(f, 'stage') === 'won' ? readMoney(f.get('actualValue')) : null,
        reason: text(f, 'reason'),
      }),
    )
  }
  function taskEditor(t?: CrmTask, context?: { type: CrmEntity; id: string }) {
    const target = context ?? (t ? { type: t.entityType, id: t.entityId } : undefined)
    saveForm(
      t ? 'تعديل متابعة' : 'متابعة جديدة',
      <>
        {target ? (
          <p>
            {entityLabels[target.type]}: {recordName(target.type, target.id)}
          </p>
        ) : (
          <Field label="السجل المرتبط">
            <select name="entity" required>
              <option value="">اختر عميلًا أو فرصة</option>
              {records.map((r) => (
                <option value={r.type + ':' + r.id} key={r.type + r.id}>
                  {entityLabels[r.type]} · {r.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="عنوان المتابعة">
          <input name="title" required maxLength={160} defaultValue={t?.title} />
        </Field>
        <Field label="نوع المتابعة">
          <select name="kind" defaultValue={t?.kind ?? 'call'}>
            {Object.entries(taskKinds).map(([k, n]) => (
              <option key={k} value={k}>
                {n}
              </option>
            ))}
          </select>
        </Field>
        <div className="a-form-row">
          <Field label="تاريخ المتابعة">
            <input name="dueDay" type="date" required defaultValue={t?.dueDay ?? s!.today} />
          </Field>
          <Field label="وقت المتابعة">
            <input
              name="dueMinute"
              type="time"
              required
              defaultValue={clock(t?.dueMinute ?? 540)}
            />
          </Field>
        </div>
        <Field label="ملاحظات المتابعة">
          <textarea name="note" maxLength={2000} defaultValue={t?.note} />
        </Field>
      </>,
      'crm.task.save',
      (f) => {
        const [type, id] = text(f, 'entity').split(':')
        return {
          ...(t ? { id: t.id, version: t.version } : {}),
          entityType: target?.type ?? type,
          entityId: target?.id ?? id,
          title: text(f, 'title'),
          kind: text(f, 'kind'),
          dueDay: text(f, 'dueDay'),
          dueMinute: minutes(f.get('dueMinute')),
          note: text(f, 'note'),
        }
      },
    )
  }
  function taskStatus(t: CrmTask, status: string) {
    saveForm(
      status === 'done'
        ? 'إتمام المتابعة'
        : status === 'cancelled'
          ? 'إلغاء المتابعة'
          : 'إعادة فتح المتابعة',
      <>
        <p>
          {t.title} · {recordName(t.entityType, t.entityId)}
        </p>
        <Field label="نتيجة المتابعة أو سبب القرار">
          <textarea name="outcome" required maxLength={2000} />
        </Field>
      </>,
      'crm.task.status',
      (f) => ({ id: t.id, version: t.version, status, outcome: text(f, 'outcome') }),
    )
  }
  function addActivity(type: CrmEntity, id: string) {
    saveForm(
      'تسجيل تواصل',
      <>
        <p>{recordName(type, id)}</p>
        <Field label="نوع التواصل">
          <select name="kind">
            <option value="call">اتصال</option>
            <option value="meeting">اجتماع</option>
            <option value="email">بريد تلقيته أو أرسلته</option>
            <option value="note">ملاحظة</option>
          </select>
        </Field>
        <Field label="ملخص التواصل والخطوة التالية">
          <textarea name="text" required maxLength={2000} />
        </Field>
        <p className="muted">توثيق تواصل حدث بالفعل؛ لا يرسل رسائل أو بريدًا من البرنامج.</p>
      </>,
      'crm.activity.add',
      (f) => ({ entityType: type, entityId: id, kind: text(f, 'kind'), text: text(f, 'text') }),
    )
  }
  function userEditor(u?: User) {
    saveForm(
      u ? 'تعديل المستخدم' : 'مستخدم جديد',
      <>
        <Field label="الاسم">
          <input name="name" required maxLength={160} defaultValue={u?.name} />
        </Field>
        <Field label="اسم المستخدم">
          <input
            name="username"
            required
            pattern="[A-Za-z0-9_.\-]{3,40}"
            dir="ltr"
            defaultValue={u?.username}
          />
        </Field>
        <Field label="الصلاحية">
          <select name="role" defaultValue={u?.role ?? 'cashier'}>
            {(['admin', 'manager', 'cashier'] as const).map((k) => (
              <option value={k} key={k}>
                {roles[k]}
              </option>
            ))}
          </select>
        </Field>
        <p>
          المندوب يرى السجلات المعيّنة له. المدير يرى الفريق كله. المسؤول يدير الحسابات والنسخ
          والإعدادات.
        </p>
        <Field label={u ? 'كلمة مرور جديدة، اختيارية' : 'كلمة المرور'}>
          <input
            name="password"
            type="password"
            required={!u}
            minLength={12}
            maxLength={128}
            autoComplete="new-password"
          />
        </Field>
        <label className="a-check">
          <input name="active" type="checkbox" defaultChecked={u ? !!u.active : true} />
          نشط
        </label>
      </>,
      'user.save',
      (f) => ({
        ...(u ? { id: u.id } : {}),
        name: text(f, 'name'),
        username: text(f, 'username'),
        role: text(f, 'role'),
        active: f.get('active') === 'on',
        ...(text(f, 'password') ? { password: text(f, 'password') } : {}),
      }),
    )
  }
  const taskRows = (xs: CrmTask[]) =>
    xs.length ? (
      <div className="crm-task-list">
        {xs.map((t) => (
          <article key={t.id} className={overdue(t) ? 'late' : ''}>
            <span className="crm-task-kind">{taskKinds[t.kind]}</span>
            <div className="crm-task-text">
              <button
                className="crm-text-button"
                onClick={() => invoke(() => openRecord(t.entityType, t.entityId))}
              >
                {recordName(t.entityType, t.entityId)}
              </button>
              <h3>{t.title}</h3>
              <p>{t.note}</p>
              <small>
                {t.dueDay} · {clock(t.dueMinute)} ·{' '}
                {t.status === 'open'
                  ? overdue(t)
                    ? 'متأخرة'
                    : 'مجدولة'
                  : t.status === 'done'
                    ? 'مكتملة'
                    : 'ملغاة'}
              </small>
              {t.outcome && <p>{t.outcome}</p>}
            </div>
            <div className="crm-task-actions">
              {t.status === 'open' ? (
                <>
                  <button className="primary" disabled={busy} onClick={() => taskStatus(t, 'done')}>
                    تمت المتابعة
                  </button>
                  <button disabled={busy} onClick={() => taskEditor(t)}>
                    تعديل
                  </button>
                  <button disabled={busy} onClick={() => taskStatus(t, 'cancelled')}>
                    إلغاء
                  </button>
                </>
              ) : (
                manager && (
                  <button disabled={busy} onClick={() => taskStatus(t, 'open')}>
                    إعادة فتح
                  </button>
                )
              )}
            </div>
          </article>
        ))}
      </div>
    ) : (
      <Empty>لا توجد متابعات في هذه القائمة. أضف متابعة لعميل أو فرصة بخطوة وتاريخ واضحين.</Empty>
    )
  const visibleViews = (Object.keys(pages) as View[]).filter(
    (v) => !['users', 'audit', 'settings'].includes(v) || admin,
  )
  const editorOpp = quoteEditor ? s.opportunities.find((x) => x.id === quoteEditor) : undefined,
    editorContact = editorOpp ? s.contacts.find((x) => x.id === editorOpp.contactId) : undefined
  return (
    <div className="crm-app">
      <aside className="crm-rail">
        <div className="crm-brand">
          <img src="./icon.svg" alt="" />
          <div>
            XZARE <b>CRM</b>
            <small>العلاقة تبدأ بخطوة</small>
          </div>
        </div>
        <div className="crm-company">
          {s.settings.businessName}
          <small>
            {s.user.name} · {roles[s.user.role]}
          </small>
        </div>
        <nav aria-label="مساحات المبيعات">
          {visibleViews.map((v) => (
            <button
              key={v}
              aria-current={v === view ? 'page' : undefined}
              onClick={() => {
                setView(v)
                setQuery('')
                setError('')
              }}
            >
              {pages[v]}
              {v === 'today' && due.length > 0 && <span>{due.length}</span>}
            </button>
          ))}
        </nav>
        <footer>
          <WorkspaceClock english={false} />
          <button
            disabled={busy}
            onClick={() =>
              invoke(async () => {
                await call('logout')
                end()
              })
            }
          >
            خروج
          </button>
          <small dir="ltr">
            hello@xzare.com
            <br />
            +201501230440
          </small>
        </footer>
      </aside>
      <main className="crm-main">
        <header className="crm-page-head">
          <div>
            <span className="eyebrow">XZARE / RELATIONSHIPS</span>
            <h1>{pages[view]}</h1>
          </div>
          <div className="crm-toolbar">
            <button disabled={busy} onClick={() => invoke(load)}>
              تحديث
            </button>
            <button
              disabled={busy}
              onClick={() =>
                saveForm(
                  'تغيير كلمة المرور',
                  <>
                    <Field label="كلمة المرور الحالية">
                      <input
                        name="current"
                        type="password"
                        required
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
                  </>,
                  'password.change',
                  (f) => ({ current: text(f, 'current'), password: text(f, 'password') }),
                )
              }
            >
              كلمة المرور
            </button>
          </div>
        </header>
        {error && (
          <p className="alert error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="alert success" role="status">
            {notice}
          </p>
        )}
        {view === 'today' && (
          <>
            <section className="crm-workday">
              <div>
                <span>اليوم · {s.today}</span>
                <h2>المتابعة القادمة تصنع الفرق.</h2>
                <p>ابدأ بما يستحق التواصل، ثم حرّك الفرصة بخطوة واضحة.</p>
                <button className="primary" disabled={busy} onClick={() => taskEditor()}>
                  متابعة جديدة
                </button>
                <button onClick={() => setView('pipeline')}>فتح مسار البيع</button>
              </div>
              <div className="crm-workday-count">
                <strong>{due.length}</strong>
                <span>متابعة لليوم أو متأخرة</span>
                <small>
                  {s.leads.filter((l) => l.status === 'new').length} عميل محتمل جديد ·{' '}
                  {s.opportunities.filter((o) => !['won', 'lost'].includes(o.stage)).length} فرصة
                  مفتوحة
                </small>
              </div>
            </section>
            <div className="crm-section-head">
              <h2>قائمة التواصل</h2>
              <button onClick={() => setView('tasks')}>كل المتابعات</button>
            </div>
            {taskRows(due)}
            {!records.length && (
              <div className="crm-start">
                <h2>أضف أول علاقة تجارية</h2>
                <p>سجل شخصًا أو شركة ببياناتهم الفعلية، ثم حدد أول متابعة.</p>
                <button className="primary" onClick={() => personEditor('lead')}>
                  عميل محتمل جديد
                </button>
                <button onClick={() => personEditor('contact')}>إضافة عميل</button>
              </div>
            )}
          </>
        )}
        {view === 'pipeline' && (
          <>
            <div className="crm-toolbar">
              <input
                aria-label="بحث الفرص"
                placeholder="بحث بالفرصة أو العميل"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button className="primary" disabled={busy} onClick={() => opportunityEditor()}>
                فرصة جديدة
              </button>
            </div>
            <p className="crm-board-help">اسحب الفرصة إلى المرحلة المطلوبة ثم أكمل سبب التغيير. يمكنك استخدام زر تغيير المرحلة داخل البطاقة.</p>
            <div className="crm-pipeline" aria-label="مراحل فرص البيع">
              {Object.entries(stages).map(([stage, label]) => {
                const rows = s.opportunities.filter(
                  (o) =>
                    o.stage === stage && matching(o.title + ' ' + o.contactName + ' ' + o.company),
                )
                return (
                  <section key={stage} className={'crm-stage ' + stage}
                    onDragOver={(event) => { if (!busy && event.dataTransfer.types.includes('application/x-xzare-opportunity')) { event.preventDefault(); event.dataTransfer.dropEffect = 'move' } }}
                    onDrop={(event) => {
                      event.preventDefault()
                      const id = event.dataTransfer.getData('application/x-xzare-opportunity')
                      const opportunity = s.opportunities.find((o) => o.id === id)
                      if (!busy && opportunity && canMoveOpportunity(opportunity.stage, stage, manager)) stageEditor(opportunity, stage)
                    }}>
                    <header>
                      <h2>{label}</h2>
                      <b>{rows.length}</b>
                    </header>
                    <div className="crm-stage-amount">
                      {amount(
                        rows.reduce(
                          (n, o) => n + (stage === 'won' ? (o.actualValue ?? 0) : o.value),
                          0,
                        ),
                      )}{' '}
                      ج.م
                    </div>
                    {!rows.length ? (
                      <p className="crm-stage-empty">لا توجد فرص هنا</p>
                    ) : (
                      rows.map((o) => (
                        <article key={o.id} draggable={!busy && (manager || !['won', 'lost'].includes(o.stage))}
                          onDragStart={(event) => { event.dataTransfer.setData('application/x-xzare-opportunity', o.id); event.dataTransfer.effectAllowed = 'move' }}>
                          <button
                            className="crm-card-title"
                            onClick={() => invoke(() => openRecord('opportunity', o.id))}
                          >
                            {o.title}
                          </button>
                          <p>{o.contactName}</p>
                          <strong>
                            {amount(o.stage === 'won' ? (o.actualValue ?? 0) : o.value)} ج.م
                          </strong>
                          <small>الإغلاق المتوقع {o.expectedClose}</small>
                          <div className="crm-card-meta">
                            <span>{ownerName(o.ownerId)}</span>
                            <span>{o.probability}%</span>
                          </div>
                          <footer>
                            {!['won', 'lost'].includes(o.stage) ? (
                              <button disabled={busy} onClick={() => stageEditor(o)}>
                                تغيير المرحلة
                              </button>
                            ) : (
                              manager && (
                                <button disabled={busy} onClick={() => stageEditor(o)}>
                                  إعادة فتح
                                </button>
                              )
                            )}
                          </footer>
                        </article>
                      ))
                    )}
                  </section>
                )
              })}
            </div>
          </>
        )}
        {view === 'leads' && (
          <>
            <div className="crm-toolbar">
              <input
                aria-label="بحث العملاء المحتملين"
                placeholder="بحث بالاسم أو الشركة أو التواصل"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button className="primary" disabled={busy} onClick={() => personEditor('lead')}>
                عميل محتمل جديد
              </button>
            </div>
            {!s.leads.length ? (
              <Empty>سجل عميلًا محتملًا ومصدره والمستخدم المكلف بمتابعته.</Empty>
            ) : (
              <div className="crm-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>العميل المحتمل</th>
                      <th>التواصل</th>
                      <th>المصدر والمكلف</th>
                      <th>الحالة</th>
                      <th>الإجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.leads
                      .filter((l) =>
                        matching(l.name + ' ' + l.company + ' ' + l.phone + ' ' + l.email),
                      )
                      .map((l) => (
                        <tr key={l.id}>
                          <td>
                            <button
                              className="crm-text-button"
                              onClick={() => invoke(() => openRecord('lead', l.id))}
                            >
                              {l.name}
                            </button>
                            <small>{l.company}</small>
                          </td>
                          <td dir="ltr">
                            {l.phone || '—'}
                            <small>{l.email}</small>
                          </td>
                          <td>
                            {l.source || '—'}
                            <small>{ownerName(l.ownerId)}</small>
                          </td>
                          <td>{leadStatuses[l.status]}</td>
                          <td>
                            {l.status !== 'converted' && (
                              <>
                                <button disabled={busy} onClick={() => personEditor('lead', l)}>
                                  تعديل
                                </button>
                                <button disabled={busy} onClick={() => leadStatus(l)}>
                                  تأهيل
                                </button>
                                {l.status !== 'disqualified' && (
                                  <button disabled={busy} onClick={() => convert(l)}>
                                    تحويل لعميل
                                  </button>
                                )}
                              </>
                            )}
                            {l.contactId && (
                              <button
                                onClick={() => invoke(() => openRecord('contact', l.contactId!))}
                              >
                                ملف العميل
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        {view === 'contacts' && (
          <>
            <div className="crm-toolbar">
              <input
                aria-label="بحث العملاء"
                placeholder="بحث بالاسم أو الكود أو الشركة"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button className="primary" disabled={busy} onClick={() => personEditor('contact')}>
                إضافة عميل
              </button>
            </div>
            {!s.contacts.length ? (
              <Empty>حوّل عميلًا محتملًا أو أضف عميلًا فعليًا لفتح فرصة بيع.</Empty>
            ) : (
              <div className="crm-contact-grid">
                {s.contacts
                  .filter((c) => matching(c.name + ' ' + c.company + ' ' + c.code))
                  .map((c) => (
                    <article key={c.id}>
                      <header>
                        <span className="crm-avatar">{c.name.slice(0, 1)}</span>
                        <div>
                          <button
                            className="crm-card-title"
                            onClick={() => invoke(() => openRecord('contact', c.id))}
                          >
                            {c.name}
                          </button>
                          <small>{c.company || c.code}</small>
                        </div>
                        <span>{c.active ? 'نشط' : 'متوقف'}</span>
                      </header>
                      <p dir="ltr">
                        {c.phone || '—'}
                        <br />
                        {c.email}
                      </p>
                      <p>
                        {ownerName(c.ownerId)} ·{' '}
                        {s.opportunities.filter((o) => o.contactId === c.id).length} فرصة
                      </p>
                      <footer>
                        <button disabled={busy} onClick={() => personEditor('contact', c)}>
                          تعديل
                        </button>
                        <button
                          disabled={busy || !c.active}
                          onClick={() => opportunityEditor(undefined, c.id)}
                        >
                          فرصة جديدة
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => taskEditor(undefined, { type: 'contact', id: c.id })}
                        >
                          متابعة
                        </button>
                      </footer>
                    </article>
                  ))}
              </div>
            )}
          </>
        )}
        {view === 'tasks' && (
          <>
            <div className="crm-toolbar">
              <Field label="حالة المتابعات">
                <select value={taskFilter} onChange={(e) => setTaskFilter(e.target.value)}>
                  <option value="open">المفتوحة</option>
                  <option value="overdue">المتأخرة</option>
                  <option value="done">المكتملة</option>
                  <option value="cancelled">الملغاة</option>
                  <option value="all">كل المتابعات</option>
                </select>
              </Field>
              <button className="primary" disabled={busy} onClick={() => taskEditor()}>
                متابعة جديدة
              </button>
            </div>
            {taskRows(visibleTasks)}
          </>
        )}
        {view === 'quotes' && (
          <>
            <div className="crm-toolbar">
              <Field label="فرصة إصدار العرض">
                <select value={quoteChoice} onChange={(e) => setQuoteChoice(e.target.value)}>
                  <option value="">اختر فرصة مفتوحة</option>
                  {s.opportunities
                    .filter(
                      (o) =>
                        !['won', 'lost'].includes(o.stage) &&
                        s.contacts.some((c) => c.id === o.contactId && c.active),
                    )
                    .map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.title} · {o.contactName}
                      </option>
                    ))}
                </select>
              </Field>
              <button
                className="primary"
                disabled={busy || !quoteChoice}
                onClick={() => {
                  setError('')
                  setQuoteEditor(quoteChoice)
                }}
              >
                إصدار عرض سعر
              </button>
            </div>
            {!s.quotes.length ? (
              <Empty>لا توجد عروض أسعار. افتح فرصة ثم أضف بنود العرض الفعلية.</Empty>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>العرض</th>
                    <th>العميل</th>
                    <th>القيمة</th>
                    <th>الصلاحية والحالة</th>
                    <th>تفاصيل</th>
                  </tr>
                </thead>
                <tbody>
                  {s.quotes.map((q) => (
                    <tr key={q.id}>
                      <td>
                        {q.number}
                        <small>{stamp(q.at)}</small>
                      </td>
                      <td>
                        {q.customer.name}
                        <small>
                          {s.opportunities.find((o) => o.id === q.opportunityId)?.title}
                        </small>
                      </td>
                      <td>{amount(q.total)} ج.م</td>
                      <td>
                        {q.validUntil}
                        <small>{q.expired ? 'انتهت الصلاحية' : quoteStatuses[q.status]}</small>
                      </td>
                      <td>
                        <button disabled={busy} onClick={() => invoke(() => openQuote(q.id))}>
                          فتح العرض
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
        {view === 'reports' && (
          <>
            <div className="crm-toolbar">
              <Field label="من">
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </Field>
              <Field label="إلى">
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </Field>
              <button
                disabled={!report}
                onClick={() =>
                  report &&
                  csv('CRM-pipeline.csv', [
                    [
                      'الفرصة',
                      'العميل',
                      'المرحلة',
                      'القيمة المتوقعة',
                      'الاحتمال',
                      'القيمة المرجحة',
                      'قيمة الفوز المؤكدة',
                      'الإغلاق المتوقع',
                    ],
                    ...report.opportunities.map((o) => [
                      o.title,
                      o.contactName,
                      stages[o.stage],
                      decimal(o.value),
                      o.probability,
                      decimal(o.weighted),
                      o.actualValue !== null ? decimal(o.actualValue) : '',
                      o.expectedClose,
                    ]),
                  ])
                }
              >
                تصدير الفرص CSV
              </button>
              <button
                disabled={!report}
                onClick={() =>
                  report &&
                  csv('CRM-quotes.csv', [
                    ['العرض', 'العميل', 'التاريخ', 'الإجمالي', 'الحالة'],
                    ...report.quotes.map((q) => [
                      q.number,
                      q.customer.name,
                      stamp(q.at),
                      decimal(q.total),
                      quoteStatuses[q.status],
                    ]),
                  ])
                }
              >
                تصدير عروض الفترة
              </button>
              <button onClick={() => window.print()}>طباعة</button>
            </div>
            {report && (
              <div className="print-area">
                <h2>تقرير {s.settings.businessName}</h2>
                <p>
                  {from} → {to}
                </p>
                <div className="crm-report-numbers">
                  <section>
                    <span>توقع مرجح للفرص المفتوحة حاليًا</span>
                    <b>{amount(report.weighted)} ج.م</b>
                  </section>
                  <section>
                    <span>فرص فائزة حاليًا أُغلقت خلال الفترة</span>
                    <b>{amount(report.wonValue)} ج.م</b>
                  </section>
                  <section>
                    <span>عميل محتمل سجل خلال الفترة</span>
                    <b>{report.leads.length}</b>
                  </section>
                  <section>
                    <span>عروض صدرت خلال الفترة</span>
                    <b>{report.quotes.length}</b>
                  </section>
                </div>
                <p className="muted">
                  التوقع يُحسب من قيمة الفرصة × احتمالها المدخل، وليس إيرادًا محصلًا. النتائج حسب
                  التكليف الحالي بالسجلات.
                </p>
                <table>
                  <thead>
                    <tr>
                      <th>المرحلة</th>
                      <th>الفرص الحالية</th>
                      <th>القيمة المرجحة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(stages).map(([k, n]) => (
                      <tr key={k}>
                        <td>{n}</td>
                        <td>{report.opportunities.filter((o) => o.stage === k).length}</td>
                        <td>
                          {amount(
                            report.opportunities
                              .filter((o) => o.stage === k)
                              .reduce((v, o) => v + o.weighted, 0),
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <h3>التواصل والقرارات خلال الفترة</h3>
                <table>
                  <thead>
                    <tr>
                      <th>التاريخ</th>
                      <th>السجل</th>
                      <th>النشاط</th>
                      <th>المستخدم</th>
                      <th>الملخص</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.activities.map((a) => (
                      <tr key={a.id}>
                        <td>{stamp(a.at)}</td>
                        <td>{recordName(a.entityType, a.entityId)}</td>
                        <td>{actions[a.action] ?? 'تواصل'}</td>
                        <td>{a.actorName}</td>
                        <td>{a.text || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        {view === 'users' && (
          <>
            <div className="crm-toolbar">
              <button className="primary" disabled={busy} onClick={() => userEditor()}>
                مستخدم جديد
              </button>
            </div>
            <table>
              <thead>
                <tr>
                  <th>المستخدم</th>
                  <th>الصلاحية</th>
                  <th>الحالة</th>
                  <th>تعديل</th>
                </tr>
              </thead>
              <tbody>
                {s.users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      {u.name}
                      <small>{u.username}</small>
                    </td>
                    <td>{roles[u.role]}</td>
                    <td>{u.active ? 'نشط' : 'متوقف'}</td>
                    <td>
                      <button disabled={busy} onClick={() => userEditor(u)}>
                        تعديل
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        {view === 'audit' && (
          <>
            <p className="muted">آخر 300 عملية إدارية. سجل العلاقة يحتفظ بأنشطة كل عميل أو فرصة.</p>
            <table>
              <thead>
                <tr>
                  <th>الوقت</th>
                  <th>المستخدم</th>
                  <th>العملية</th>
                  <th>السجل</th>
                </tr>
              </thead>
              <tbody>
                {s.audit.map((a, i) => (
                  <tr key={i}>
                    <td>{stamp(a.at)}</td>
                    <td>{a.user_name}</td>
                    <td>{actions[a.action] ?? a.action}</td>
                    <td dir="ltr">{a.entity_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        {view === 'settings' && (
          <div className="crm-settings">
            <section>
              <h2>بيانات الشركة</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  const f = new FormData(e.currentTarget)
                  invoke(() =>
                    run('settings.save', {
                      businessName: text(f, 'businessName'),
                      phone: text(f, 'phone'),
                      address: text(f, 'address'),
                      currency: 'EGP',
                      language: 'ar',
                      receiptFooter: text(f, 'receiptFooter'),
                      taxBps: 0,
                    }),
                  )
                }}
              >
                <Field label="اسم الشركة">
                  <input
                    name="businessName"
                    required
                    maxLength={160}
                    defaultValue={s.settings.businessName}
                  />
                </Field>
                <Field label="هاتف الشركة">
                  <input name="phone" maxLength={40} dir="ltr" defaultValue={s.settings.phone} />
                </Field>
                <Field label="العنوان">
                  <input name="address" maxLength={250} defaultValue={s.settings.address} />
                </Field>
                <Field label="نهاية العرض">
                  <input
                    name="receiptFooter"
                    maxLength={250}
                    defaultValue={s.settings.receiptFooter}
                  />
                </Field>
                <button className="primary" disabled={busy}>
                  حفظ البيانات
                </button>
              </form>
            </section>
            <section>
              <LicensePanel />
            </section>
            <section>
              <h2>النسخ الاحتياطي</h2>
              <p>
                ملفات العمل والنسخ غير مشفرة. احتفظ بها في مكان موثوق؛ مفتاح الجهاز وحده محمي بتخزين
                Windows الآمن.
              </p>
              <button
                disabled={busy}
                onClick={() =>
                  invoke(() =>
                    exclusive(mutex, setBusy, async () => {
                      const r = await call<{
                        download?: string
                        fileName?: string
                        cancelled?: boolean
                      }>('backup.create')
                      if (r.download)
                        download(
                          r.fileName ?? 'CRM.xzbak',
                          new Blob([Uint8Array.from(atob(r.download), (c) => c.charCodeAt(0))]),
                        )
                      if (!r.cancelled) setNotice('تم إنشاء النسخة الاحتياطية')
                    }),
                  )
                }
              >
                إنشاء نسخة
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  saveForm(
                    'استعادة نسخة CRM',
                    <>
                      <p>
                        تستبدل سجلات العمل وتنتهي الجلسات. تُحفظ نسخة قبل الاستبدال ويبقى ترخيص
                        الجهاز محفوظًا.
                      </p>
                      {!window.xzare && (
                        <Field label="ملف النسخة">
                          <input name="file" type="file" accept=".xzbak" required />
                        </Field>
                      )}
                      <Field label="كلمة مرور المسؤول">
                        <input
                          name="password"
                          type="password"
                          required
                          autoComplete="current-password"
                        />
                      </Field>
                      <label className="a-check">
                        <input type="checkbox" required />
                        أؤكد استعادة هذه النسخة
                      </label>
                    </>,
                    'backup.restore',
                    (f) => ({ password: text(f, 'password'), file: f.get('file') }),
                    'استعادة النسخة',
                  )
                }
              >
                استعادة نسخة
              </button>
            </section>
            <section>
              <h2>دعم Xzare</h2>
              <p dir="ltr">
                hello@xzare.com
                <br />
                +201501230440
              </p>
            </section>
          </div>
        )}
        <footer className="crm-footer">XZARE SOFTWARE SOLUTIONS · CRM / 0.1</footer>
      </main>
      {form && (
        <Modal
          title={form.title}
          busy={busy}
          error={error}
          submit={form.submit}
          onClose={() => setForm(null)}
          onSubmit={async (e) => {
            if (mutex.current) return
            const f = new FormData(e.currentTarget),
              current = form
            try {
              const p = current.payload(f)
              if (current.action === 'backup.restore') {
                await exclusive(mutex, setBusy, async () => {
                  if (window.xzare) {
                    const r = await call<{ restored?: boolean; cancelled?: boolean }>(
                      'backup.restore',
                      { password: p.password },
                    )
                    if (r.restored) end()
                    else if (r.cancelled) setForm(null)
                  } else {
                    const file = p.file
                    if (!(file instanceof File) || !file.size || file.size > 128 * 1024 * 1024)
                      throw new Error('اختر نسخة صحيحة حتى 128 ميجابايت')
                    const r = await fetch('/api/restore', {
                      method: 'POST',
                      headers: {
                        'X-Xzare-Request': '1',
                        'X-Xzare-Password': encodeURIComponent(String(p.password)),
                      },
                      credentials: 'same-origin',
                      body: file,
                    })
                    const v = await r.json()
                    if (!r.ok || !v.ok) throw new Error(v.error ?? 'تعذر الاستعادة')
                    end()
                  }
                })
              } else {
                await run(current.action, p)
                setForm(null)
                if (current.action === 'password.change') end()
              }
            } catch (e) {
              const m = e instanceof Error ? e.message : 'تعذر الحفظ'
              setError(m)
              authError(m)
            }
          }}
        >
          {form.body}
        </Modal>
      )}
      {detail && (
        <Modal
          title={
            detail.entityType === 'opportunity'
              ? (detail.record as CrmOpportunity).title
              : (detail.record as CrmContact).name
          }
          busy={busy}
          error=""
          manual
          onClose={() => setDetail(null)}
        >
          <div className="crm-record-meta">
            <span>{entityLabels[detail.entityType]}</span>
            <span>{ownerName(detail.record.ownerId)}</span>
            <span>منذ {stamp(detail.record.at)}</span>
          </div>
          <p className="crm-pre">{detail.record.note || 'لم تسجل ملاحظات'}</p>
          {detail.entityType === 'opportunity' && (
            <div className="crm-total">
              <span>
                {stages[(detail.record as CrmOpportunity).stage]} ·{' '}
                {(detail.record as CrmOpportunity).contactName}
              </span>
              <strong>{amount((detail.record as CrmOpportunity).value)} ج.م متوقعة</strong>
            </div>
          )}
          <div className="crm-toolbar">
            <button
              disabled={busy}
              onClick={() => addActivity(detail.entityType, detail.record.id)}
            >
              تسجيل تواصل
            </button>
            <button
              disabled={busy}
              onClick={() =>
                taskEditor(undefined, { type: detail.entityType, id: detail.record.id })
              }
            >
              متابعة جديدة
            </button>
            {detail.entityType === 'contact' && (
              <button
                disabled={busy}
                onClick={() => opportunityEditor(undefined, detail.record.id)}
              >
                فرصة جديدة
              </button>
            )}
            {detail.entityType === 'opportunity' &&
              !['won', 'lost'].includes((detail.record as CrmOpportunity).stage) && (
                <>
                  <button
                    disabled={busy}
                    onClick={() => opportunityEditor(detail.record as CrmOpportunity)}
                  >
                    تعديل الفرصة
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => stageEditor(detail.record as CrmOpportunity)}
                  >
                    تغيير المرحلة
                  </button>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => {
                      setQuoteEditor(detail.record.id)
                      setDetail(null)
                    }}
                  >
                    إصدار عرض سعر
                  </button>
                </>
              )}
          </div>
          <h3>المتابعات المرتبطة</h3>
          {taskRows(detail.tasks)}
          {detail.quotes.length > 0 && (
            <>
              <h3>العروض المرتبطة</h3>
              {detail.quotes.map((q) => (
                <button key={q.id} disabled={busy} onClick={() => invoke(() => openQuote(q.id))}>
                  {q.number} · {amount(q.total)} · {q.expired ? 'منتهي' : quoteStatuses[q.status]}
                </button>
              ))}
            </>
          )}
          <h3>سجل العلاقة</h3>
          <div className="crm-timeline">
            {detail.activities.map((a) => (
              <article key={a.id}>
                <span>
                  {stamp(a.at)} · {a.actorName}
                </span>
                <h4>{actions[a.action] ?? 'تواصل'}</h4>
                {a.text && <p className="crm-pre">{a.text}</p>}
              </article>
            ))}
          </div>
        </Modal>
      )}
      {editorOpp && editorContact && (
        <QuoteEditor
          opportunity={editorOpp}
          contact={editorContact}
          today={s.today}
          busy={busy}
          save={run}
          onClose={() => setQuoteEditor(null)}
        />
      )}
      {quoteDetail && (
        <QuoteDetail
          key={quoteDetail.quote.id}
          d={quoteDetail}
          busy={busy}
          onClose={() => setQuoteDetail(null)}
          mutate={(a, p) =>
            commitThenRefresh(
              () => run(a, p),
              () => openQuote(quoteDetail.quote.id),
              (e) => {
                setQuoteDetail(null)
                authError(e instanceof Error ? e.message : '')
                setError('تم حفظ القرار؛ أعد فتح العرض لقراءة حالته الجديدة')
              },
            )
          }
        />
      )}
    </div>
  )
}
