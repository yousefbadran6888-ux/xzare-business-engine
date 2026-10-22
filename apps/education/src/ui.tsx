import { useEffect, useId, useRef, type ReactNode, type FormEvent } from 'react'
import { Money } from '@xzare/core'
export const today = () => {
  const d = new Date()
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-')
}
export const amount = (n: number) =>
  new Intl.NumberFormat('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    n / 100,
  )
export const decimal = (n: number) => Money.toDecimalString(Money.fromPiastres(n))
export const kinds = {
  asset: 'أصول',
  liability: 'التزامات',
  equity: 'حقوق ملكية',
  income: 'إيرادات',
  expense: 'مصروفات',
}
export const statuses = { draft: 'مسودة', posted: 'مرحّل', void: 'ملغى' }
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  )
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className="a-empty">{children}</div>
}
export function Modal({
  title,
  children,
  onClose,
  onSubmit,
  busy,
  error,
  submit = 'حفظ',
  disabled = false,
  manual = false,
}: {
  title: string
  children: ReactNode
  onClose: () => void
  onSubmit?: (e: FormEvent<HTMLFormElement>) => void
  busy: boolean
  error: string
  submit?: string
  disabled?: boolean
  manual?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null),
    id = useId()
  useEffect(() => {
    const old = document.activeElement as HTMLElement
    ref.current?.querySelector<HTMLElement>('input,select,button')?.focus()
    return () => old?.focus()
  }, [])
  return (
    <div className="a-overlay">
      <div
        ref={ref}
        className="a-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !busy) onClose()
          if (e.key === 'Tab') {
            const xs = [
              ...(ref.current?.querySelectorAll<HTMLElement>(
                'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)',
              ) ?? []),
            ]
            const first = xs[0],
              last = xs.at(-1)
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault()
              last?.focus()
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault()
              first?.focus()
            }
          }
        }}
      >
        <div className="a-modal-head">
          <h2 id={id}>{title}</h2>
          <button type="button" aria-label="إغلاق" disabled={busy} onClick={onClose}>
            ×
          </button>
        </div>
        {manual ? (
          <div>
            {children}
            {error && (
              <p className="alert error" role="alert">
                {error}
              </p>
            )}
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              onSubmit?.(e)
            }}
            aria-busy={busy}
          >
            {children}
            {error && (
              <p className="alert error" role="alert">
                {error}
              </p>
            )}
            <footer>
              <button type="button" disabled={busy} onClick={onClose}>
                إغلاق
              </button>
              {onSubmit && (
                <button className="primary" type="submit" disabled={busy || disabled}>
                  {busy ? 'جارٍ الحفظ…' : submit}
                </button>
              )}
            </footer>
          </form>
        )}
      </div>
    </div>
  )
}
export function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob),
    a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export function csv(name: string, rows: unknown[][]) {
  const safe = (v: unknown) => {
    let s = String(v ?? '')
    if (/^[\s]*[=+@-]/.test(s)) s = "'" + s
    return '"' + s.replaceAll('"', '""') + '"'
  }
  download(
    name,
    new Blob(['\uFEFF' + rows.map((r) => r.map(safe).join(',')).join('\r\n')], {
      type: 'text/csv;charset=utf-8',
    }),
  )
}
