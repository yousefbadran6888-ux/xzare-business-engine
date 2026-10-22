import type { AppState, RestaurantState } from '@xzare/engine'
import type { Page } from '../../pos/src/App'
export function StartGuide({
  state,
  core,
  openShift,
  navigate,
}: {
  state: RestaurantState
  core: AppState
  openShift: () => void
  navigate: (view: Page | 'menu' | 'tables') => void
}) {
  const menu = state.menu.some((m) => m.active),
    tables = state.tables.some((t) => t.active),
    shift = !!core.shift
  if (menu && tables && shift) return null
  const steps = [
    {
      label: 'الخامات والمخزون',
      done: core.products.some((p) => p.qty > 0),
      text: 'سجّل الخامات ووحداتها وباركودها، ثم رصيدها. الخدمات لا تحتاج خامات.',
      action: () => navigate('products'),
      button: 'الخامات والباركود',
    },
    {
      label: 'قائمة الطعام',
      done: menu,
      text: 'أضف السعر والوصفة لكل حصة، أو سجّل منتجًا جاهزًا أو خدمة.',
      action: () => navigate('menu'),
      button: 'قائمة الطعام',
    },
    {
      label: 'الطاولات',
      done: tables,
      text: 'أضف الطاولات الفعلية للصالة. التيك أواي والتوصيل يعملان بدون طاولات.',
      action: () => navigate('tables'),
      button: 'الطاولات',
    },
    {
      label: 'وردية اليوم',
      done: shift,
      text: 'افتح ورديتك برصيد الخزينة الفعلي قبل التحصيل.',
      action: openShift,
      button: 'افتح وردية',
    },
  ]
  return (
    <section className="r-start-guide" aria-label="تجهيز المطعم">
      <header>
        <div>
          <span className="eyebrow">خطوات البداية</span>
          <h2>{!menu ? 'جهّز مطعمك لأول طلب' : 'ابدأ يوم العمل'}</h2>
        </div>
        <small>{steps.filter((s) => s.done).length} من 4 خطوات مكتملة</small>
      </header>
      <div className="r-start-steps">
        {steps.map((step) => (
          <article key={step.label} className={step.done ? 'done' : ''}>
            <span className="r-step-check" aria-hidden="true">
              {step.done ? '✓' : '○'}
            </span>
            <div>
              <h3>{step.label}</h3>
              <p>{step.text}</p>
              {!step.done && (
                <button type="button" onClick={step.action}>
                  {step.button}
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
