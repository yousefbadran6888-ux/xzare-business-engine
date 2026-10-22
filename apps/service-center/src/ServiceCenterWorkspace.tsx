import { createPortal } from 'react-dom'
import { useEffect, useState, type ReactNode } from 'react'
import type {
  ServiceCenter,
  ServiceCenterDevice,
  ServiceCenterTechnician,
  ServiceCenterOrder,
} from '@xzare/engine'
import { call } from '../../pos/src/bridge'
import { Field, Modal, Empty, amount, decimal, today, csv } from './ui'
import { type State } from './model'
import { OrderDetail, phases } from './OrderDetail'
export type ServiceCenterView = 'overview' | 'devices' | 'orders' | 'technicians' | 'jobs'
type Form = { title: string; body: ReactNode; submit: (f: FormData) => Promise<void> }
export function ServiceCenterWorkspace({
  state,
  view,
  manager,
  busy,
  run,
  navigate,
  onError,
}: {
  state: State
  view: ServiceCenterView
  manager: boolean
  busy: boolean
  run: (a: string, p?: Record<string, unknown>) => Promise<any>
  navigate: (v: ServiceCenterView) => void
  onError: (s: string) => void
}) {
  const [search, setSearch] = useState(''),
    [status, setStatus] = useState(''),
    [form, setForm] = useState<Form | null>(null),
    [error, setError] = useState(''),
    [detail, setDetail] = useState<ReturnType<ServiceCenter['get']> | null>(null),
    [history, setHistory] = useState<{
      device: ServiceCenterDevice
      orders: ServiceCenterOrder[]
    } | null>(null),
    [from, setFrom] = useState(today().slice(0, 4) + '-01-01'),
    [to, setTo] = useState(today()),
    [report, setReport] = useState<ReturnType<ServiceCenter['report']> | null>(null)
  useEffect(() => {
    setSearch('')
    setStatus('')
    setHistory(null)
    setError('')
  }, [view])
  useEffect(() => {
    if (view !== 'jobs') return
    let live = true
    setReport(null)
    void call<ReturnType<ServiceCenter['report']>>('service-center.report', { from, to })
      .then((r) => {
        if (live) setReport(r)
      })
      .catch((e) => {
        if (live) onError(e.message)
      })
    return () => {
      live = false
    }
  }, [view, from, to, state])
  const match = (s: string) => s.toLowerCase().includes(search.toLowerCase())
  const open = async (id: string) => {
    setError('')
    try {
      setDetail(await call('service-center.order.get', { id }))
    } catch (e) {
      onError(e instanceof Error ? e.message : 'تعذر قراءة الأمر')
    }
  }
  const save = (
    title: string,
    body: ReactNode,
    a: string,
    p: (f: FormData) => Record<string, unknown>,
  ) => {
    setError('')
    setForm({
      title,
      body,
      submit: async (f) => {
        await run(a, p(f))
        setForm(null)
      },
    })
  }
  function deviceForm(v?: ServiceCenterDevice) {
    save(
      v ? 'تعديل الجهاز والعميل' : 'تسجيل جهاز وعميل',
      <>
        <div className="a-form-row">
          <Field label="اسم العميل">
            <input name="customer" required maxLength={160} defaultValue={v?.customer || ''} />
          </Field>
          <Field label="رقم التواصل">
            <input
              name="phone"
              dir="ltr"
              type="tel"
              required
              maxLength={30}
              defaultValue={v?.phone || ''}
            />
          </Field>
        </div>
        <div className="a-form-row">
          <Field label="السيريال أو كود الجهاز">
            <input
              name="serial"
              dir="ltr"
              required
              maxLength={160}
              defaultValue={v?.serial || ''}
            />
          </Field>
          <Field label="نوع الجهاز">
            <input name="type" required maxLength={160} defaultValue={v?.type || ''} />
          </Field>
        </div>
        <div className="a-form-row">
          <Field label="الماركة">
            <input name="brand" maxLength={80} defaultValue={v?.brand || ''} />
          </Field>
          <Field label="الموديل">
            <input name="model" maxLength={80} defaultValue={v?.model || ''} />
          </Field>
        </div>
        <p className="muted">
          يمكن مسح السيريال بقارئ باركود. لو الجهاز بلا سيريال، ألصق عليه كودًا خاصًا بالمركز. لا
          يتغير الكود بعد أول استلام. لا تسجّل كلمات مرور الجهاز هنا.
        </p>
      </>,
      'service-center.device.save',
      (f) => ({
        ...(v && { id: v.id }),
        customer: String(f.get('customer')),
        phone: String(f.get('phone')),
        serial: String(f.get('serial')),
        type: String(f.get('type')),
        brand: String(f.get('brand')),
        model: String(f.get('model')),
      }),
    )
  }
  function technicianForm(t?: ServiceCenterTechnician) {
    save(
      t ? 'تعديل الفني' : 'تسجيل فني',
      <>
        <Field label="اسم الفني">
          <input name="name" required maxLength={160} defaultValue={t?.name || ''} />
        </Field>
        <Field label="رقم التواصل">
          <input name="phone" dir="ltr" type="tel" maxLength={30} defaultValue={t?.phone || ''} />
        </Field>
        <label className="a-check">
          <input name="active" type="checkbox" defaultChecked={t ? !!t.active : true} />
          فني نشط
        </label>
      </>,
      'service-center.technician.save',
      (f) => ({
        ...(t && { id: t.id }),
        name: String(f.get('name')),
        phone: String(f.get('phone')),
        active: f.has('active'),
      }),
    )
  }
  function orderForm() {
    save(
      'استقبال جهاز · أمر صيانة جديد',
      <>
        <Field label="الجهاز والعميل">
          <select name="deviceId" required defaultValue="">
            <option value="" disabled>
              اختر الجهاز
            </option>
            {state.devices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.serial} · {v.customer} · {v.type}
              </option>
            ))}
          </select>
        </Field>
        <div className="a-form-row">
          <Field label="موعد التسليم المتوقع">
            <input name="dueDate" required type="date" defaultValue={today()} />
          </Field>
          <Field label="مخزن قطع الغيار">
            <select name="warehouseId" required defaultValue={state.warehouses[0]?.id}>
              {state.warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="شكوى العميل">
          <textarea name="complaint" required maxLength={1000} />
        </Field>
        <Field label="حالة الجهاز عند الاستلام">
          <textarea name="condition" required maxLength={1000} />
        </Field>
        <Field label="الملحقات المستلمة · اكتب لا يوجد عند عدم وجود ملحقات">
          <textarea name="accessories" maxLength={1000} />
        </Field>
        <p className="muted">
          وثّق الكسور والحالة الظاهرة والملحقات. صرف القطع بعد التشخيص وموافقة العميل.
        </p>
      </>,
      'service-center.order.create',
      (f) => ({
        deviceId: String(f.get('deviceId')),
        warehouseId: String(f.get('warehouseId')),
        dueDate: String(f.get('dueDate')),
        complaint: String(f.get('complaint')),
        condition: String(f.get('condition')),
        accessories: String(f.get('accessories')),
      }),
    )
  }
  const table = (xs: ServiceCenterOrder[]) => (
    <section className="a-sheet a-scroll">
      <table>
        <thead>
          <tr>
            <th>الأمر / السيريال</th>
            <th>العميل والجهاز</th>
            <th>المرحلة / الفني</th>
            <th>الموعد</th>
            <th>الإجمالي · ج.م</th>
            <th>المتبقي</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {xs.map((o) => (
            <tr key={o.id}>
              <td>
                <b dir="ltr">{o.number}</b>
                <small>
                  {o.device.serial} {o.kind === 'warranty' ? '· رجوع ضمان' : ''}
                </small>
              </td>
              <td>
                {o.device.customer}
                <small>
                  {o.device.brand} {o.device.model}
                </small>
              </td>
              <td>
                <span className={'sc-status ' + o.status}>{phases[o.status]}</span>
                <small>{o.technicianName || 'لم يسند'}</small>
              </td>
              <td>{o.dueDate}</td>
              <td className="a-num">{amount(o.total)}</td>
              <td className="a-num">{o.status === 'cancelled' ? '—' : amount(o.total - o.paid)}</td>
              <td>
                <button disabled={busy} onClick={() => void open(o.id)}>
                  فتح الأمر
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!xs.length && <Empty>لا توجد أوامر مطابقة. ابدأ بتسجيل الجهاز ثم استقباله.</Empty>}
    </section>
  )
  const active = state.orders.filter((o) => !['delivered', 'cancelled'].includes(o.status)),
    shown = (history?.orders ?? state.orders).filter(
      (o) =>
        (!status || o.status === status) &&
        match(o.number + ' ' + o.device.serial + ' ' + o.device.customer + ' ' + o.device.phone),
    )
  return (
    <div className="sc-domain">
      {view === 'overview' && (
        <>
          <section className="sc-welcome">
            <div>
              <span>دورة الجهاز داخل المركز</span>
              <h2>كل جهاز، من الاستلام إلى الضمان.</h2>
              <p>السيريال وحالة الجهاز والفحص والقطع والتحصيل في سجل واحد.</p>
            </div>
            {manager && (
              <button
                className="primary"
                disabled={busy || !state.devices.length}
                onClick={orderForm}
              >
                + استقبال جهاز
              </button>
            )}
          </section>
          <div className="sc-pipeline">
            {(['received', 'estimated', 'approved', 'in_progress', 'ready'] as const).map((s) => (
              <button
                key={s}
                onClick={() => {
                  navigate('orders')
                  setStatus(s)
                }}
              >
                <span>{phases[s]}</span>
                <b>{active.filter((o) => o.status === s).length}</b>
              </button>
            ))}
          </div>
          {!state.devices.length ? (
            <section className="a-sheet sc-onboarding">
              <h3>ابدأ تجهيز مركزك</h3>
              <p>
                أضف أجهزة العملاء والفنيين وقطع الغيار. كل أمر جديد يسجّل حالة الجهاز والعرض
                والموافقة والتكلفة.
              </p>
              <div className="a-rosc-actions">
                {manager && (
                  <button className="primary" onClick={() => deviceForm()}>
                    تسجيل أول جهاز
                  </button>
                )}
                <button onClick={() => navigate('technicians')}>الفنيون</button>
              </div>
            </section>
          ) : (
            <>
              <div className="sc-section-head">
                <h3>أوامر تحتاج المتابعة</h3>
                <button onClick={() => navigate('orders')}>كل أوامر الصيانة</button>
              </div>
              {table(active.slice(0, 12))}
            </>
          )}
        </>
      )}
      {view === 'devices' && (
        <>
          <div className="sc-section-head">
            <Field label="بحث أو مسح بالسيريال أو العميل">
              <input value={search} onChange={(e) => setSearch(e.target.value)} />
            </Field>
            {manager && (
              <button className="primary" disabled={busy} onClick={() => deviceForm()}>
                + تسجيل جهاز
              </button>
            )}
          </div>
          <section className="a-sheet a-scroll">
            <table>
              <thead>
                <tr>
                  <th>سيريال الجهاز</th>
                  <th>العميل / الهاتف</th>
                  <th>الجهاز</th>
                  <th>سجل الجهاز</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {state.devices
                  .filter((v) => match(v.serial + ' ' + v.type + ' ' + v.customer + ' ' + v.phone))
                  .map((v) => (
                    <tr key={v.id}>
                      <td>
                        <b>{v.serial}</b>
                        <small>{v.type}</small>
                      </td>
                      <td>
                        {v.customer}
                        <small dir="ltr">{v.phone || 'لم يسجل'}</small>
                      </td>
                      <td>
                        {v.brand} {v.model}
                      </td>
                      <td>
                        {state.orders.filter((o) => o.deviceId === v.id).length} من أحدث الأوامر
                      </td>
                      <td>
                        <div className="a-rosc-actions">
                          {manager && (
                            <button disabled={busy} onClick={() => deviceForm(v)}>
                              تعديل
                            </button>
                          )}
                          <button
                            onClick={() => {
                              void call<{
                                device: ServiceCenterDevice
                                orders: ServiceCenterOrder[]
                              }>('service-center.device.history', { id: v.id })
                                .then((h) => {
                                  setHistory(h)
                                  setSearch('')
                                  setStatus('')
                                })
                                .catch((e) => onError(e.message))
                            }}
                          >
                            سجل الصيانة
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {!state.devices.length && <Empty>سجّل أول جهاز مع بيانات العميل.</Empty>}
          </section>
          {history && (
            <>
              <h3>سجل {history.device.serial} · كل الأوامر</h3>
              {table(shown)}
            </>
          )}
        </>
      )}
      {view === 'orders' && (
        <>
          <div className="sc-section-head">
            <div className="a-filter">
              <Field label="بحث بالسيريال أو رقم الأمر أو العميل">
                <input value={search} onChange={(e) => setSearch(e.target.value)} />
              </Field>
              <Field label="المرحلة">
                <select value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="">كل المراحل</option>
                  {Object.entries(phases).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {manager && (
              <button
                className="primary"
                disabled={busy || !state.devices.length}
                onClick={orderForm}
              >
                + استقبال جهاز
              </button>
            )}
          </div>
          {table(shown)}
          <p className="a-footnote">
            {state.orders.length} أمر ظاهر من {state.orderCount}؛ كل الأوامر المفتوحة وأحدث ١٠٠٠
            أمر. سجل الجهاز والتقرير يعرضان التاريخ الكامل.
          </p>
        </>
      )}
      {view === 'technicians' && (
        <>
          <div className="sc-section-head">
            <p>أضف الفني الحقيقي لإسناد أوامر الإصلاح ومتابعتها.</p>
            {manager && (
              <button className="primary" disabled={busy} onClick={() => technicianForm()}>
                + تسجيل فني
              </button>
            )}
          </div>
          <section className="a-sheet a-scroll">
            <table>
              <thead>
                <tr>
                  <th>الفني</th>
                  <th>التواصل</th>
                  <th>الحالة</th>
                  <th>أوامر مفتوحة حالية</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {state.technicians.map((t) => (
                  <tr key={t.id}>
                    <td>{t.name}</td>
                    <td dir="ltr">{t.phone || 'لم يسجل'}</td>
                    <td>{t.active ? 'نشط' : 'موقوف'}</td>
                    <td>{active.filter((o) => o.technicianId === t.id).length}</td>
                    <td>
                      {manager && (
                        <button disabled={busy} onClick={() => technicianForm(t)}>
                          تعديل
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!state.technicians.length && (
              <Empty>لم تضف فنيين بعد. سجّل الفني المسؤول قبل اعتماد أول أمر.</Empty>
            )}
          </section>
        </>
      )}
      {view === 'jobs' && (
        <>
          <div className="a-filter">
            <Field label="من">
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="إلى">
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
            <button
              disabled={!report}
              onClick={() => {
                if (report)
                  csv('Xzare-Service-Center-Jobs.csv', [
                    [
                      'الأمر',
                      'السيريال',
                      'نوع الأمر',
                      'مرجع الإصلاح الأصلي',
                      'تكلفة رجوع الضمان',
                      'العميل',
                      'الحالة',
                      'الإجمالي',
                      'المدفوع حتى الآن',
                      'تكلفة القطع',
                      'تكلفة العمل',
                    ],
                    ...report.rows.map((o) => [
                      o.number,
                      o.device.serial,
                      o.kind === 'warranty' ? 'رجوع ضمان' : 'إصلاح',
                      o.parentNumber || '',
                      decimal(o.kind === 'warranty' ? o.partsCost + o.laborCost : 0),
                      o.device.customer,
                      phases[o.status],
                      decimal(o.total),
                      decimal(o.paid),
                      decimal(o.partsCost),
                      decimal(o.laborCost),
                    ]),
                  ])
              }}
            >
              تصدير أوامر CSV
            </button>
            <button
              disabled={!report}
              onClick={() => {
                if (report)
                  csv('Xzare-Service-Center-Payments.csv', [
                    ['الأمر', 'المبلغ', 'الطريقة', 'المرجع', 'التوقيت'],
                    ...report.payments.map((p) => [
                      p.number,
                      decimal(p.amount),
                      p.method,
                      p.reference,
                      new Date(p.at).toISOString(),
                    ]),
                  ])
              }}
            >
              تصدير التحصيل CSV
            </button>
            <button onClick={() => window.print()}>طباعة التقرير</button>
          </div>
          {report ? (
            <>
              <div className="sc-report-totals">
                {[
                  ['قيمة الأوامر المنجزة', report.revenue],
                  ['تحصيل خلال الفترة', report.collected],
                  ['تكلفة فعلية', report.cost],
                  ['تكلفة رجوع الضمان', report.warrantyCost],
                  ['هامش الأوامر', report.margin],
                  ['متبقي الأوامر حتى الآن', report.receivable],
                ].map(([l, n]) => (
                  <div key={l}>
                    <span>{l}</span>
                    <b>{amount(Number(n))}</b>
                    <small>ج.م</small>
                  </div>
                ))}
              </div>
              <p className="muted">
                الأوامر حسب تاريخ الإنجاز أو الاستقبال. التحصيل حسب تاريخ الدفعة. المتبقي والمدفوع
                يشملان الدفعات حتى الآن. التقرير إداري، ولا يمثل دفتر أستاذ أو إقرارًا ضريبيًا.
              </p>
              {table(report.rows)}
            </>
          ) : (
            <Empty>جارٍ قراءة التقرير…</Empty>
          )}
        </>
      )}
      {form && (
        <Modal
          title={form.title}
          busy={busy}
          error={error}
          onClose={() => {
            setForm(null)
            setError('')
          }}
          onSubmit={(e) => {
            const data = new FormData(e.currentTarget)
            void form.submit(data).catch((e) => setError(e.message))
          }}
        >
          {form.body}
        </Modal>
      )}
      {detail &&
        createPortal(
          <div className="sc-app">
            <OrderDetail
              key={detail.order.id}
              detail={detail}
              state={state}
              busy={busy}
              manager={manager}
              onClose={() => setDetail(null)}
              onRun={async (a, p) => {
                const saved = await run(a, p)
                if (a === 'service-center.warranty.create' && saved?.id) {
                  setDetail(await call('service-center.order.get', { id: saved.id }))
                } else if (saved?.order) setDetail(saved)
                else {
                  try {
                    setDetail(await call('service-center.order.get', { id: detail.order.id }))
                  } catch {
                    setDetail(null)
                    onError('تم حفظ عرض السعر؛ افتح الأمر لقراءة النسخة الجديدة')
                  }
                }
              }}
            />
          </div>,
          document.body,
        )}
    </div>
  )
}
