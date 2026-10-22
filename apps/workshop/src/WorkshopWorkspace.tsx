import { createPortal } from 'react-dom'
import { useEffect, useState, type ReactNode } from 'react'
import type { Workshop, WorkshopVehicle, WorkshopTechnician, WorkshopOrder } from '@xzare/engine'
import { call } from '../../pos/src/bridge'
import { Field, Modal, Empty, amount, decimal, today, csv } from './ui'
import { type State } from './model'
import { OrderDetail, phases } from './OrderDetail'
import { workshopDropAction } from './board-move'
export type WorkshopView = 'overview' | 'vehicles' | 'orders' | 'technicians' | 'jobs'
type Form = { title: string; body: ReactNode; submit: (f: FormData) => Promise<void> }
export function WorkshopWorkspace({
  state,
  view,
  manager,
  busy,
  run,
  navigate,
  onError,
}: {
  state: State
  view: WorkshopView
  manager: boolean
  busy: boolean
  run: (a: string, p?: Record<string, unknown>) => Promise<any>
  navigate: (v: WorkshopView) => void
  onError: (s: string) => void
}) {
  const [search, setSearch] = useState(''),
    [status, setStatus] = useState(''),
    [form, setForm] = useState<Form | null>(null),
    [error, setError] = useState(''),
    [detail, setDetail] = useState<ReturnType<Workshop['get']> | null>(null),
    [boardAction, setBoardAction] = useState(''),
    [orderLayout, setOrderLayout] = useState<'board' | 'table'>('board'),
    [history, setHistory] = useState<{ vehicle: WorkshopVehicle; orders: WorkshopOrder[] } | null>(
      null,
    ),
    [from, setFrom] = useState(today().slice(0, 4) + '-01-01'),
    [to, setTo] = useState(today()),
    [report, setReport] = useState<ReturnType<Workshop['report']> | null>(null)
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
    void call<ReturnType<Workshop['report']>>('workshop.report', { from, to })
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
  const open = async (id: string, initialAction = '') => {
    setError('')
    try {
      const next = await call<ReturnType<Workshop['get']>>('workshop.order.get', { id })
      setBoardAction(initialAction)
      setDetail(next)
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
  function vehicleForm(v?: WorkshopVehicle) {
    save(
      v ? 'تعديل السيارة والعميل' : 'تسجيل سيارة وعميل',
      <>
        <div className="a-form-row">
          <Field label="اسم العميل">
            <input name="customer" required maxLength={160} defaultValue={v?.customer || ''} />
          </Field>
          <Field label="رقم التواصل">
            <input name="phone" dir="ltr" type="tel" maxLength={30} defaultValue={v?.phone || ''} />
          </Field>
        </div>
        <div className="a-form-row">
          <Field label="رقم اللوحة">
            <input name="plate" required maxLength={160} defaultValue={v?.plate || ''} />
          </Field>
          <Field label="رقم الشاسيه VIN · اختياري">
            <input
              name="vin"
              dir="ltr"
              maxLength={17}
              pattern="[A-HJ-NPR-Z0-9a-hj-npr-z]{17}"
              defaultValue={v?.vin || ''}
            />
          </Field>
        </div>
        <div className="a-form-row">
          <Field label="الماركة">
            <input name="make" maxLength={80} defaultValue={v?.make || ''} />
          </Field>
          <Field label="الموديل">
            <input name="model" maxLength={80} defaultValue={v?.model || ''} />
          </Field>
        </div>
        <div className="a-form-row">
          <Field label="سنة الصنع">
            <input
              name="year"
              required
              type="number"
              min="1900"
              max="2100"
              defaultValue={v?.year ?? new Date().getFullYear()}
            />
          </Field>
          <Field label="قراءة العداد · كم">
            <input
              name="mileage"
              required
              type="number"
              min={v?.mileage ?? 0}
              max={10000000}
              defaultValue={v?.mileage ?? 0}
            />
          </Field>
        </div>
      </>,
      'workshop.vehicle.save',
      (f) => ({
        ...(v && { id: v.id }),
        customer: String(f.get('customer')),
        phone: String(f.get('phone')),
        plate: String(f.get('plate')),
        vin: String(f.get('vin')),
        make: String(f.get('make')),
        model: String(f.get('model')),
        year: Number(f.get('year')),
        mileage: Number(f.get('mileage')),
      }),
    )
  }
  function technicianForm(t?: WorkshopTechnician) {
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
      'workshop.technician.save',
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
      'استقبال سيارة · أمر صيانة جديد',
      <>
        <Field label="السيارة والعميل">
          <select name="vehicleId" required defaultValue="">
            <option value="" disabled>
              اختر السيارة
            </option>
            {state.vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.plate} · {v.customer} · آخر عداد {v.mileage}
              </option>
            ))}
          </select>
        </Field>
        <div className="a-form-row">
          <Field label="عداد الاستقبال · كم">
            <input name="mileage" required type="number" min="0" max={10000000} />
          </Field>
          <Field label="موعد التسليم المتوقع">
            <input name="dueDate" required type="date" defaultValue={today()} />
          </Field>
        </div>
        <Field label="مخزن قطع الغيار">
          <select name="warehouseId" required defaultValue={state.warehouses[0]?.id}>
            {state.warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="شكوى العميل وحالة السيارة عند الاستقبال">
          <textarea name="complaint" required maxLength={1000} />
        </Field>
        <p className="muted">لن تُصرف قطع غيار حتى تسجيل عرض السعر وموافقة العميل وبدء الإصلاح.</p>
      </>,
      'workshop.order.create',
      (f) => ({
        vehicleId: String(f.get('vehicleId')),
        warehouseId: String(f.get('warehouseId')),
        mileage: Number(f.get('mileage')),
        dueDate: String(f.get('dueDate')),
        complaint: String(f.get('complaint')),
      }),
    )
  }
  const table = (xs: WorkshopOrder[]) => (
    <section className="a-sheet a-scroll">
      <table>
        <thead>
          <tr>
            <th>الأمر / اللوحة</th>
            <th>العميل والسيارة</th>
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
                <small>{o.vehicle.plate}</small>
              </td>
              <td>
                {o.vehicle.customer}
                <small>
                  {o.vehicle.make} {o.vehicle.model}
                </small>
              </td>
              <td>
                <span className={'w-status ' + o.status}>{phases[o.status]}</span>
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
      {!xs.length && <Empty>لا توجد أوامر مطابقة. ابدأ بتسجيل السيارة ثم استقبالها.</Empty>}
    </section>
  )
  const active = state.orders.filter((o) => !['delivered', 'cancelled'].includes(o.status)),
    shown = (history?.orders ?? state.orders).filter(
      (o) =>
        (!status || o.status === status) &&
        match(o.number + ' ' + o.vehicle.plate + ' ' + o.vehicle.customer + ' ' + o.vehicle.phone),
    )
  return (
    <div className="w-domain">
      {view === 'overview' && (
        <>
          <section className="w-welcome">
            <div>
              <span>دورة السيارة داخل الورشة</span>
              <h2>استقبل. أصلح. سلّم.</h2>
              <p>العملاء والقطع والمصنعية والتحصيل مرتبطين بأمر صيانة واحد.</p>
            </div>
            {manager && (
              <button
                className="primary"
                disabled={busy || !state.vehicles.length}
                onClick={orderForm}
              >
                + استقبال سيارة
              </button>
            )}
          </section>
          <div className="w-pipeline">
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
          {!state.vehicles.length ? (
            <section className="a-sheet w-onboarding">
              <h3>ابدأ تجهيز ورشتك</h3>
              <p>
                أضف سيارات العملاء والفنيين وقطع الغيار. كل أمر جديد يسجّل الشكوى والعرض والموافقة
                والتكلفة.
              </p>
              <div className="a-row-actions">
                {manager && (
                  <button className="primary" onClick={() => vehicleForm()}>
                    تسجيل أول سيارة
                  </button>
                )}
                <button onClick={() => navigate('technicians')}>الفنيون</button>
              </div>
            </section>
          ) : (
            <>
              <div className="w-section-head">
                <h3>أوامر تحتاج المتابعة</h3>
                <button onClick={() => navigate('orders')}>كل أوامر الصيانة</button>
              </div>
              {table(active.slice(0, 12))}
            </>
          )}
        </>
      )}
      {view === 'vehicles' && (
        <>
          <div className="w-section-head">
            <Field label="بحث باللوحة أو العميل أو الشاسيه">
              <input value={search} onChange={(e) => setSearch(e.target.value)} />
            </Field>
            {manager && (
              <button className="primary" disabled={busy} onClick={() => vehicleForm()}>
                + تسجيل سيارة
              </button>
            )}
          </div>
          <section className="a-sheet a-scroll">
            <table>
              <thead>
                <tr>
                  <th>اللوحة / الشاسيه</th>
                  <th>العميل / الهاتف</th>
                  <th>السيارة</th>
                  <th>العداد · كم</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {state.vehicles
                  .filter((v) => match(v.plate + ' ' + v.vin + ' ' + v.customer + ' ' + v.phone))
                  .map((v) => (
                    <tr key={v.id}>
                      <td>
                        <b>{v.plate}</b>
                        <small dir="ltr">{v.vin || 'بدون رقم شاسيه'}</small>
                      </td>
                      <td>
                        {v.customer}
                        <small dir="ltr">{v.phone || 'لم يسجل'}</small>
                      </td>
                      <td>
                        {v.make} {v.model}
                        <small>{v.year}</small>
                      </td>
                      <td>{v.mileage.toLocaleString('ar-EG')}</td>
                      <td>
                        <div className="a-row-actions">
                          {manager && (
                            <button disabled={busy} onClick={() => vehicleForm(v)}>
                              تعديل
                            </button>
                          )}
                          <button
                            onClick={() => {
                              void call<{ vehicle: WorkshopVehicle; orders: WorkshopOrder[] }>(
                                'workshop.vehicle.history',
                                { id: v.id },
                              )
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
            {!state.vehicles.length && <Empty>سجّل أول سيارة مع بيانات العميل.</Empty>}
          </section>
          {history && (
            <>
              <h3>سجل {history.vehicle.plate} · كل الأوامر</h3>
              {table(shown)}
            </>
          )}
        </>
      )}
      {view === 'orders' && (
        <>
          <div className="w-section-head">
            <div className="a-filter">
              <Field label="بحث عن أمر أو لوحة أو عميل">
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
                disabled={busy || !state.vehicles.length}
                onClick={orderForm}
              >
                + استقبال سيارة
              </button>
            )}
          </div>
          <div className="w-board-toolbar">
            <div className="toolbar" aria-label="طريقة عرض أوامر الصيانة">
              <button type="button" aria-pressed={orderLayout === 'board'} className={orderLayout === 'board' ? 'primary' : ''} onClick={() => setOrderLayout('board')}>لوحة العمل</button>
              <button type="button" aria-pressed={orderLayout === 'table'} className={orderLayout === 'table' ? 'primary' : ''} onClick={() => setOrderLayout('table')}>جدول الأوامر</button>
            </div>
            <small>اسحب الأمر إلى المرحلة التالية لإكمال بياناتها، أو افتح الأمر من زر التفاصيل.</small>
          </div>
          {orderLayout === 'table' ? table(shown) : <div className="w-kanban" aria-label="مراحل صيانة السيارات">
            {Object.entries(phases).filter(([phase]) => !status || status === phase).map(([phase, label]) => {
              const orders = shown.filter((order) => order.status === phase)
              return <section key={phase} className={'w-kanban-lane ' + phase}
                onDragOver={(event) => { if (manager && !busy && event.dataTransfer.types.includes('application/x-xzare-workshop-order')) { event.preventDefault(); event.dataTransfer.dropEffect = 'move' } }}
                onDrop={(event) => {
                  event.preventDefault()
                  const order = state.orders.find((entry) => entry.id === event.dataTransfer.getData('application/x-xzare-workshop-order'))
                  if (!manager || busy || !order) return
                  const action = workshopDropAction(order.status, phase, order.paid, order.total)
                  if (action) void open(order.id, action)
                  else onError('انتقل للمرحلة التالية فقط. تسليم السيارة يتطلب تحصيل كامل المبلغ.')
                }}>
                <header><h3>{label}</h3><b>{orders.length}</b></header>
                {orders.length ? orders.map((order) => <article className="w-kanban-card" key={order.id} draggable={manager && !busy && !['delivered', 'cancelled'].includes(order.status)} onDragStart={(event) => { event.dataTransfer.setData('application/x-xzare-workshop-order', order.id); event.dataTransfer.effectAllowed = 'move' }}>
                  <span dir="ltr">{order.number}</span>
                  <h4>{order.vehicle.plate}</h4><p>{order.vehicle.make} {order.vehicle.model}</p><strong>{order.vehicle.customer}</strong>
                  <small>الفني: {order.technicianName || 'لم يسند بعد'}</small><small>الموعد المتوقع: {order.dueDate}</small>
                  <div className="w-kanban-balance"><span>المتبقي</span><b>{amount(order.total - order.paid)} ج.م</b></div>
                  <button type="button" disabled={busy} onClick={() => void open(order.id)}>تفاصيل وإجراءات الأمر</button>
                </article>) : <p className="w-kanban-empty">لا توجد أوامر في هذه المرحلة</p>}
              </section>
            })}
          </div>}
          <p className="a-footnote">
            أحدث {state.orders.length} من {state.orderCount} أمر. سجل السيارة والتقرير يعرضان
            التاريخ الكامل.
          </p>
        </>
      )}
      {view === 'technicians' && (
        <>
          <div className="w-section-head">
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
                  csv('Xzare-Workshop-Jobs.csv', [
                    [
                      'الأمر',
                      'اللوحة',
                      'العميل',
                      'الحالة',
                      'الإجمالي',
                      'المدفوع حتى الآن',
                      'تكلفة القطع',
                      'تكلفة العمل',
                    ],
                    ...report.rows.map((o) => [
                      o.number,
                      o.vehicle.plate,
                      o.vehicle.customer,
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
                  csv('Xzare-Workshop-Payments.csv', [
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
              <div className="w-report-totals">
                {[
                  ['قيمة الأوامر المنجزة', report.revenue],
                  ['تحصيل خلال الفترة', report.collected],
                  ['تكلفة فعلية', report.cost],
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
          <div className="w-app">
            <OrderDetail
              key={detail.order.id + ':' + boardAction}
              initialAction={boardAction}
              detail={detail}
              state={state}
              busy={busy}
              manager={manager}
              onClose={() => setDetail(null)}
              onRun={async (a, p) => {
                const saved = await run(a, p)
                if (saved?.order) setDetail(saved)
                else {
                  try {
                    setDetail(await call('workshop.order.get', { id: detail.order.id }))
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
