import { useEffect, useState, type FormEvent } from 'react'
import type { Manufacturing, ManufacturingBom, ProductionOrder } from '@xzare/engine'
import { call } from '../../pos/src/bridge'
import { BomEditor } from './BomEditor'
import { OrderEditor } from './OrderEditor'
import { Modal, Field, Empty, amount, decimal, csv, today } from './ui'
import { qty, type State } from './model'
export const productionStatus = {
  planned: 'مخطط',
  started: 'جارٍ التصنيع',
  completed: 'مكتمل',
  cancelled: 'ملغى',
} as const
export type ProductionView = 'overview' | 'boms' | 'orders' | 'mrp' | 'costs'
type Run = (action: string, payload?: Record<string, unknown>, command?: boolean) => Promise<any>
export function ProductionWorkspace({
  state,
  view,
  manager,
  busy,
  run,
  navigate,
  onError,
}: {
  state: State
  view: ProductionView
  manager: boolean
  busy: boolean
  run: Run
  navigate: (v: ProductionView) => void
  onError: (s: string) => void
}) {
  const [search, setSearch] = useState(''),
    [status, setStatus] = useState(''),
    [warehouse, setWarehouse] = useState(''),
    [from, setFrom] = useState(today().slice(0, 4) + '-01-01'),
    [to, setTo] = useState(today()),
    [bomEditor, setBomEditor] = useState<false | ManufacturingBom | true>(false),
    [orderEditor, setOrderEditor] = useState<false | ProductionOrder | true>(false),
    [detail, setDetail] = useState<ReturnType<Manufacturing['get']> | null>(null),
    [confirm, setConfirm] = useState<{ order: ProductionOrder; action: 'start' | 'cancel' } | null>(
      null,
    ),
    [mrp, setMrp] = useState<ReturnType<Manufacturing['mrp']> | null>(null),
    [report, setReport] = useState<ReturnType<Manufacturing['report']> | null>(null),
    [readError, setReadError] = useState(''),
    [confirmError, setConfirmError] = useState('')
  useEffect(() => {
    setSearch('')
    setWarehouse('')
    setReadError('')
  }, [view])
  useEffect(() => {
    let live = true
    if (view !== 'mrp' && view !== 'costs') return
    setReadError('')
    if (view === 'mrp') setMrp(null)
    else setReport(null)
    const action = view === 'mrp' ? 'manufacturing.mrp' : 'manufacturing.report',
      payload = {
        ...(view === 'costs' ? { from, to } : {}),
        ...(warehouse ? { warehouseId: warehouse } : {}),
      }
    void call<any>(action, payload)
      .then((r) => {
        if (live) {
          if (view === 'mrp') setMrp(r)
          else setReport(r)
        }
      })
      .catch((e) => {
        if (live) setReadError(e.message)
      })
    return () => {
      live = false
    }
  }, [view, warehouse, from, to, state])
  const match = (s: string) => s.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
    warehouseName = (id: string) => state.warehouses.find((w) => w.id === id)?.name ?? '—',
    orders = state.orders.filter(
      (o) =>
        (!status || o.status === status) &&
        (!warehouse || o.warehouseId === warehouse) &&
        match(o.number + ' ' + o.outputName + ' ' + o.note),
    ),
    boms = state.boms.filter((b) => match(b.name + ' ' + b.outputName + ' ' + b.sku)),
    needs = mrp?.rows.filter((r) => match(r.name + ' ' + r.sku)) ?? [],
    costs = report?.rows.filter((o) => match(o.number + ' ' + o.outputName + ' ' + o.note)) ?? []
  const invoke = (fn: () => Promise<unknown>) => {
    void fn().catch((e) => onError(e instanceof Error ? e.message : 'تعذر إتمام العملية'))
  }
  async function open(id: string) {
    setDetail(await call('manufacturing.order.get', { id }))
  }
  const orderTable = (rows: ProductionOrder[]) => (
    <section className="a-sheet a-scroll">
      <table>
        <thead>
          <tr>
            <th>أمر الإنتاج / المنتج</th>
            <th>الإصدار</th>
            <th>الكمية</th>
            <th>موعد الإكمال</th>
            <th>مخزن الخامات</th>
            <th>الحالة</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.id}>
              <td>
                <b dir="ltr">{o.number}</b>
                <small>{o.outputName}</small>
              </td>
              <td>{o.revision}</td>
              <td className="a-num">
                {qty(o.qty)} {o.unit}
              </td>
              <td dir="ltr">{o.dueDate}</td>
              <td>{warehouseName(o.warehouseId)}</td>
              <td>
                <span className={'m-status ' + o.status}>{productionStatus[o.status]}</span>
              </td>
              <td>
                <button disabled={busy} onClick={() => invoke(() => open(o.id))}>
                  تفاصيل الأمر
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && (
        <Empty>لا توجد أوامر مطابقة. سجّل الأصناف وقائمة خامات، ثم أنشئ أمر إنتاج.</Empty>
      )}
    </section>
  )
  const costTable = (rows: ProductionOrder[]) => (
    <section className="a-sheet a-scroll">
      <table>
        <thead>
          <tr>
            <th>الأمر / المنتج</th>
            <th>الحالة</th>
            <th>الخامات · ج.م</th>
            <th>العمالة</th>
            <th>الإضافات</th>
            <th>التكلفة الكلية</th>
            <th>السليم / الهالك</th>
            <th>تكلفة وحدة سليمة</th>
            <th>خسارة هالك كامل</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.id}>
              <td>
                <b dir="ltr">{o.number}</b>
                <small>{o.outputName}</small>
              </td>
              <td>{productionStatus[o.status]}</td>
              <td>{amount(o.materialCost)}</td>
              <td>{amount(o.laborCost)}</td>
              <td>{amount(o.overheadCost)}</td>
              <td>{amount(o.totalCost)}</td>
              <td>
                {qty(o.goodQty)} / {qty(o.scrapQty)} {o.unit}
              </td>
              <td>{o.goodQty ? amount(Math.round((o.totalCost * 1000) / o.goodQty)) : '—'}</td>
              <td>{amount(o.writeoffCost)}</td>
              <td>
                <button onClick={() => invoke(() => open(o.id))}>تفاصيل الأمر</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && (
        <Empty>ستظهر هنا التكلفة من أوامر الإنتاج الفعلية في الفترة المختارة.</Empty>
      )}
    </section>
  )
  async function confirmAction(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!confirm || busy) return
    const { order, action } = confirm,
      f = new FormData(e.currentTarget)
    try {
      const r = await run('manufacturing.order.' + action, {
        id: order.id,
        ...(action === 'cancel' ? { note: String(f.get('note')) } : {}),
      })
      setConfirm(null)
      setDetail(r)
    } catch (e) {
      setConfirmError(e instanceof Error ? e.message : 'تعذر إتمام العملية')
    }
  }
  return (
    <div className="m-workspace">
      {readError && (
        <p className="alert error" role="alert">
          {readError}
        </p>
      )}
      {view === 'overview' ? (
        <>
          <div className="m-flow" aria-label="دورة الإنتاج">
            {(['planned', 'started', 'completed'] as const).map((s, i) => (
              <button
                key={s}
                onClick={() => {
                  navigate('orders')
                  setStatus(s)
                }}
              >
                <span className="m-step">{i + 1}</span>
                <div>
                  <b>{productionStatus[s]}</b>
                  <small>
                    {s === 'planned'
                      ? 'تخطيط قبل صرف الخامات'
                      : s === 'started'
                        ? 'خامات مصروفة إلى التشغيل'
                        : 'منتج وتكلفة وهالك مسجل'}
                  </small>
                </div>
                <strong>{state.orders.filter((o) => o.status === s).length}</strong>
              </button>
            ))}
          </div>
          <div className="m-overview-actions">
            {manager && (
              <>
                <button
                  className="primary"
                  disabled={busy || !state.boms.length}
                  onClick={() => setOrderEditor(true)}
                >
                  + أمر إنتاج جديد
                </button>
                <button disabled={busy} onClick={() => setBomEditor(true)}>
                  + قائمة خامات
                </button>
              </>
            )}
            <button onClick={() => navigate('mrp')}>راجع احتياج المواد</button>
            <button onClick={() => navigate('costs')}>تكلفة الإنتاج</button>
          </div>
          <div className="a-stats">
            <div>
              <span>قيمة الإنتاج الجاري · ج.م</span>
              <strong>{amount(state.wipValue)}</strong>
            </div>
            <div>
              <span>قيمة المخزون · ج.م</span>
              <strong>{amount(state.balances.reduce((s, b) => s + b.cost, 0))}</strong>
            </div>
            <div>
              <span>قوائم خامات / إصدارات</span>
              <strong>{state.boms.length}</strong>
            </div>
            <div>
              <span>حالة أرصدة المخزون</span>
              <strong className={state.reconciled ? '' : 'i-warn'}>
                {state.reconciled ? 'متطابقة' : 'تحتاج مراجعة'}
              </strong>
            </div>
          </div>
          <div className="a-section-title">
            <h2>أوامر تحتاج متابعة</h2>
            <button onClick={() => navigate('orders')}>كل الأوامر</button>
          </div>
          {orderTable(
            state.orders
              .filter((o) => o.status === 'planned' || o.status === 'started')
              .slice(0, 12),
          )}
        </>
      ) : (
        <>
          <div className="m-toolbar">
            <Field label="بحث في التصنيع">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="منتج، كود أو أمر"
              />
            </Field>
            {view !== 'boms' && (
              <Field label="مخزن الخامات">
                <select value={warehouse} onChange={(e) => setWarehouse(e.target.value)}>
                  <option value="">كل المخازن</option>
                  {state.warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {view === 'orders' && (
              <Field label="حالة الأمر">
                <select value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="">كل الحالات</option>
                  {Object.entries(productionStatus).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {view === 'costs' && (
              <>
                <Field label="من">
                  <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                </Field>
                <Field label="إلى">
                  <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                </Field>
              </>
            )}
            {manager && view === 'boms' && (
              <button className="primary" disabled={busy} onClick={() => setBomEditor(true)}>
                + قائمة خامات
              </button>
            )}
            {manager && view === 'orders' && (
              <button
                className="primary"
                disabled={busy || !state.boms.length}
                onClick={() => setOrderEditor(true)}
              >
                + أمر إنتاج جديد
              </button>
            )}
          </div>
          {view === 'boms' && (
            <section className="a-sheet a-scroll">
              <table>
                <thead>
                  <tr>
                    <th>المنتج / القائمة</th>
                    <th>الإصدار</th>
                    <th>كمية الإنتاج الأساسية</th>
                    <th>الخامات</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {boms.map((b) => (
                    <tr key={b.id}>
                      <td>
                        <b>{b.outputName}</b>
                        <small>
                          {b.name} · {b.sku}
                        </small>
                      </td>
                      <td>{b.revision}</td>
                      <td>
                        {qty(b.yieldQty)} {b.unit}
                      </td>
                      <td>
                        <details>
                          <summary>{b.components.length} خامات</summary>
                          <ul>
                            {b.components.map((c) => (
                              <li key={c.variantId}>
                                {c.name} · {qty(c.qty)} {c.unit} · سماح {c.wasteBps / 100}%
                              </li>
                            ))}
                          </ul>
                        </details>
                      </td>
                      <td>
                        {manager && (
                          <button disabled={busy} onClick={() => setBomEditor(b)}>
                            إصدار جديد
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!boms.length && (
                <Empty>
                  قائمة الخامات تربط المنتج بالكميات اللازمة لتصنيعه. سجّل أصنافك ثم أضف أول قائمة.
                </Empty>
              )}
            </section>
          )}
          {view === 'orders' && orderTable(orders)}
          {view === 'mrp' && (
            <>
              <p className="m-summary">
                احتياج أوامرك المخططة، شامل سماح الهالك. المتاح يستبعد التشغيلات المنتهية؛ كل مخزن
                يُحسب منفصلًا.
              </p>
              <div className="m-report-actions">
                <button
                  disabled={!mrp}
                  onClick={() =>
                    csv('Xzare-Manufacturing-MRP.csv', [
                      [
                        'الخامة',
                        'SKU',
                        'المخزن',
                        'عدد الأوامر',
                        'الاحتياج',
                        'المتاح',
                        'الناقص',
                        'الوحدة',
                      ],
                      ...needs.map((r) => [
                        r.name,
                        r.sku,
                        r.warehouse,
                        r.orderCount,
                        qty(r.requiredQty),
                        qty(r.availableQty),
                        qty(r.shortageQty),
                        r.unit,
                      ]),
                    ])
                  }
                >
                  تصدير الاحتياجات CSV
                </button>
                <button onClick={() => window.print()}>طباعة / PDF</button>
              </div>
              {!mrp ? (
                <p role="status">جارٍ حساب الاحتياجات…</p>
              ) : (
                <section className="a-sheet a-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>الخامة / الكود</th>
                        <th>المخزن</th>
                        <th>الأوامر</th>
                        <th>الاحتياج</th>
                        <th>المتاح الصالح</th>
                        <th>الناقص</th>
                      </tr>
                    </thead>
                    <tbody>
                      {needs.map((r) => (
                        <tr key={r.warehouseId + r.variantId}>
                          <td>
                            <b>{r.name}</b>
                            <small>{r.sku}</small>
                          </td>
                          <td>{r.warehouse}</td>
                          <td>{r.orderCount}</td>
                          <td>
                            {qty(r.requiredQty)} {r.unit}
                          </td>
                          <td>{qty(r.availableQty)}</td>
                          <td className={r.shortageQty ? 'i-warn' : 'm-ok'}>
                            {qty(r.shortageQty)} {r.unit}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!needs.length && (
                    <Empty>
                      لا توجد احتياجات مطابقة. تنتهي حاجة الأمر عند صرف خاماته وبدء التصنيع.
                    </Empty>
                  )}
                </section>
              )}
            </>
          )}
          {view === 'costs' && (
            <>
              <p className="m-summary">
                تكلفة الخامات تثبت عند البدء، وتُضاف تكاليف التحويل عند الإكمال. سعر البيع المرجعي
                لا يُستخدم لحساب تكلفة التصنيع.
              </p>
              <div className="m-report-actions">
                <button
                  disabled={!report}
                  onClick={() =>
                    csv('Xzare-Manufacturing-Costs.csv', [
                      [
                        'الأمر',
                        'المنتج',
                        'الحالة',
                        'الخامات',
                        'العمالة',
                        'الإضافات',
                        'الإجمالي',
                        'السليم',
                        'الهالك',
                        'شطب تكلفة الهالك',
                      ],
                      ...costs.map((o) => [
                        o.number,
                        o.outputName,
                        productionStatus[o.status],
                        decimal(o.materialCost),
                        decimal(o.laborCost),
                        decimal(o.overheadCost),
                        decimal(o.totalCost),
                        qty(o.goodQty),
                        qty(o.scrapQty),
                        decimal(o.writeoffCost),
                      ]),
                    ])
                  }
                >
                  تصدير التكلفة CSV
                </button>
                <button onClick={() => window.print()}>طباعة / PDF</button>
              </div>
              {!report ? <p role="status">جارٍ قراءة تكاليف الإنتاج…</p> : costTable(costs)}
            </>
          )}
        </>
      )}
      {bomEditor && (
        <BomEditor
          state={state}
          initial={bomEditor === true ? undefined : bomEditor}
          busy={busy}
          onClose={() => setBomEditor(false)}
          onSave={(p) => run('manufacturing.bom.create', p)}
        />
      )}
      {orderEditor && (
        <OrderEditor
          state={state}
          order={orderEditor === true ? undefined : orderEditor}
          busy={busy}
          onClose={() => setOrderEditor(false)}
          onSave={(p) =>
            run(
              orderEditor === true ? 'manufacturing.order.create' : 'manufacturing.order.complete',
              p,
            )
          }
        />
      )}
      {detail && (
        <Modal
          busy={busy}
          error=""
          manual
          title={'أمر الإنتاج ' + detail.order.number}
          onClose={() => setDetail(null)}
        >
          <p className="m-summary">
            <b>{detail.order.outputName}</b> · {qty(detail.order.qty)} {detail.order.unit} · إصدار{' '}
            {detail.order.revision}
          </p>
          <div className="m-timeline">
            {detail.events.map((e) => (
              <div key={e.status}>
                <span className={'m-status ' + e.status}>{productionStatus[e.status]}</span>
                <span>
                  {e.note}
                  <small>
                    {e.userName} · {new Date(e.at).toLocaleString('ar-EG')}
                  </small>
                </span>
              </div>
            ))}
          </div>
          <p className="muted">
            الخامات: {warehouseName(detail.order.warehouseId)} · المنتج:{' '}
            {warehouseName(detail.order.destinationId)} · المطلوب: {detail.order.dueDate}
          </p>
          <h3>
            {detail.order.status === 'planned'
              ? 'احتياج المواد قبل البدء'
              : 'قائمة الخامات المعتمدة'}
          </h3>
          <div className="a-sheet a-scroll">
            <table>
              <thead>
                <tr>
                  <th>الخامة</th>
                  <th>الاحتياج</th>
                  {detail.order.status === 'planned' && (
                    <>
                      <th>المتاح</th>
                      <th>الناقص</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {detail.requirements.map((r) => (
                  <tr key={r.variantId}>
                    <td>{r.name}</td>
                    <td>
                      {qty(r.qty)} {r.unit}
                    </td>
                    {detail.order.status === 'planned' && (
                      <>
                        <td>{qty(r.availableQty)}</td>
                        <td className={r.shortageQty ? 'i-warn' : ''}>{qty(r.shortageQty)}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!!detail.allocations.length && (
            <>
              <h3>الخامات المصروفة فعليًا</h3>
              <div className="a-sheet a-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>الخامة</th>
                      <th>التشغيلة / التسلسل</th>
                      <th>الكمية</th>
                      <th>التكلفة · ج.م</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.allocations.map((a) => (
                      <tr key={a.id}>
                        <td>{a.name}</td>
                        <td>
                          {a.batch || '—'} / {a.serial || '—'}
                        </td>
                        <td>
                          {qty(a.qty)} {a.unit}
                        </td>
                        <td>{amount(a.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {detail.order.status === 'completed' && (
            <>
              <h3>الناتج والتكلفة</h3>
              {costTable([detail.order])}
            </>
          )}
          <footer className="a-modal-foot">
            <button onClick={() => setDetail(null)}>إغلاق</button>
            {manager && detail.order.status === 'planned' && (
              <>
                <button
                  disabled={busy}
                  onClick={() => {
                    setConfirmError('')
                    setConfirm({ order: detail.order, action: 'cancel' })
                    setDetail(null)
                  }}
                >
                  إلغاء الأمر
                </button>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => {
                    setConfirmError('')
                    setConfirm({ order: detail.order, action: 'start' })
                    setDetail(null)
                  }}
                >
                  بدء التصنيع وصرف الخامات
                </button>
              </>
            )}
            {manager && detail.order.status === 'started' && (
              <button
                className="primary"
                disabled={busy}
                onClick={() => {
                  setOrderEditor(detail.order)
                  setDetail(null)
                }}
              >
                إكمال الإنتاج والهالك
              </button>
            )}
          </footer>
        </Modal>
      )}
      {confirm && (
        <Modal
          busy={busy}
          error={confirmError}
          manual
          title={
            confirm.action === 'start'
              ? 'بدء التصنيع ' + confirm.order.number
              : 'إلغاء ' + confirm.order.number
          }
          onClose={() => setConfirm(null)}
        >
          <form onSubmit={confirmAction}>
            <p>
              {confirm.action === 'start'
                ? 'سيُصرف احتياج الخامات كاملًا من المخزن حسب الصلاحية، وتُثبت تكلفته في الإنتاج الجاري. راجع الكمية قبل الاعتماد.'
                : 'يلغى التخطيط دون حركة مخزون. يظل الأمر محفوظًا بسجل الأحداث.'}
            </p>
            {confirm.action === 'cancel' && (
              <Field label="سبب إلغاء الأمر">
                <textarea name="note" required maxLength={1000} />
              </Field>
            )}
            <footer className="a-modal-foot">
              <button type="button" disabled={busy} onClick={() => setConfirm(null)}>
                رجوع
              </button>
              <button className="primary" disabled={busy}>
                {confirm.action === 'start' ? 'اعتماد بدء التصنيع' : 'اعتماد الإلغاء'}
              </button>
            </footer>
          </form>
        </Modal>
      )}
    </div>
  )
}
