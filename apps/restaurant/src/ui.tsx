import { useLayoutEffect, useRef, type ReactNode, type FormEvent } from 'react'
import { Money, Quantity, unwrap } from '@xzare/core'
export const amount = (value: FormDataEntryValue | null) =>
  unwrap(Money.parse(String(value ?? '0')))
export const quantity = (value: FormDataEntryValue | null) =>
  unwrap(Quantity.parse(String(value ?? '0')))
export const decimal = (value: number) => Money.toDecimalString(Money.fromPiastres(value))
export const fmt = (value: number) =>
  new Intl.NumberFormat('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    value / 100,
  ) + ' ج.م'
export const date = (value: number) =>
  new Date(value).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' })
export const status: Record<string, string> = {
  open: 'مسودة',
  draft: 'لم يُرسل',
  queued: 'بانتظار المطبخ',
  preparing: 'قيد التحضير',
  ready: 'جاهز',
  served: 'تم التقديم',
  out: 'مع المندوب',
  completed: 'تم التحصيل',
  cancelled: 'ملغي',
  refunded: 'تم الاسترداد',
  booked: 'محجوز',
  seated: 'حضر الضيف',
}
export const kind: Record<string, string> = {
  dinein: 'صالة',
  takeaway: 'تيك أواي',
  delivery: 'توصيل',
}
export const terminal = (value: string) => ['completed', 'cancelled', 'refunded'].includes(value)
export function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="r-empty">
      <div className="r-empty-symbol" aria-hidden="true">
        ◌
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  )
}
export function Field({
  label,
  name,
  value = '',
  type = 'text',
  required = false,
  children,
}: {
  label: string
  name?: string
  value?: string | number
  type?: string
  required?: boolean
  children?: ReactNode
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children ?? (
        <input
          name={name}
          type={type}
          defaultValue={value}
          required={required}
          maxLength={type === 'password' ? 128 : 250}
          autoComplete={type === 'password' ? 'new-password' : 'off'}
        />
      )}
    </label>
  )
}
export function Dialog({
  title,
  busy,
  error,
  close,
  submit,
  children,
  button = 'حفظ',
}: {
  title: string
  busy: boolean
  error: string
  close: () => void
  submit: (data: FormData) => Promise<void>
  children: ReactNode
  button?: string
}) {
  const ref = useRef<HTMLElement>(null),
    busyRef = useRef(busy)
  busyRef.current = busy
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    ref.current?.querySelector<HTMLElement>('input,select,button')?.focus()
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busyRef.current) {
        e.preventDefault()
        close()
      }
      if (e.key === 'Tab') {
        const list = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])',
          ) ?? [],
        ).filter((el) => el.getClientRects().length)
        const first = list[0],
          last = list.at(-1)
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last?.focus()
        }
        if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first?.focus()
        }
      }
    }
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('keydown', key)
      previous?.focus()
    }
  }, [])
  return (
    <div className="r-dialog-backdrop">
      <section
        ref={ref}
        className="r-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="r-dialog-title"
      >
        <header>
          <h2 id="r-dialog-title">{title}</h2>
          <button type="button" disabled={busy} onClick={close} aria-label="إغلاق">
            ×
          </button>
        </header>
        <form
          onSubmit={(e: FormEvent<HTMLFormElement>) => {
            e.preventDefault()
            if (!busy) void submit(new FormData(e.currentTarget)).catch(() => {})
          }}
        >
          <fieldset disabled={busy}>{children}</fieldset>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <footer>
            <button type="button" disabled={busy} onClick={close}>
              إلغاء
            </button>
            <button className="primary" disabled={busy}>
              {busy ? 'جارٍ الحفظ…' : button}
            </button>
          </footer>
        </form>
      </section>
    </div>
  )
}
