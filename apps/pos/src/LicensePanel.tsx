import { ActivationMethods } from './ActivationGate'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { call } from './bridge'
type Status = {
  device: string
  licensed: boolean
  customer: string
  days: number
  readOnly: boolean
  clockRollback: boolean
  backupError: string
  onlineConfigured?: boolean
  expiresAt?: number | null
  renewError?: string
  connectionRequired?: boolean
}
export function LicensePanel() {
  const [status, setStatus] = useState<Status>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [secret, setSecret] = useState(''),
    [entry, setEntry] = useState(false),
    mutex = useRef(false)
  useEffect(() => {
    call<Status>('license.status')
      .then(setStatus)
      .catch(() => setError('تعذر قراءة حالة الترخيص'))
    const clear = () => {
      setSecret('')
      setEntry(false)
    }
    const hidden = () => {
      if (document.visibilityState === 'hidden') clear()
    }
    window.addEventListener('blur', clear)
    document.addEventListener('visibilitychange', hidden)
    return () => {
      window.removeEventListener('blur', clear)
      document.removeEventListener('visibilitychange', hidden)
    }
  }, [])
  const close = () => {
    setSecret('')
    setEntry(false)
    setError('')
  }
  async function activate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (mutex.current) return
    mutex.current = true
    setBusy(true)
    setError('')
    const code = secret
    setSecret('')
    try {
      setStatus(await call<Status>('license.activate', { license: code }))
      setEntry(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر التفعيل')
    } finally {
      mutex.current = false
      setBusy(false)
    }
  }
  async function renew() {
    if (mutex.current) return
    mutex.current = true
    setBusy(true)
    setError('')
    try {
      setStatus(await call<Status>('license.renew'))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحديث الترخيص')
      try {
        setStatus(await call<Status>('license.status'))
      } catch {}
    } finally {
      mutex.current = false
      setBusy(false)
    }
  }
  return (
    <section className="panel license-panel">
      <div className="license-heading">
        <div>
          <span className="eyebrow">حماية الجهاز</span>
          <h3>الترخيص وحالة التشغيل</h3>
        </div>
        <span className={status?.licensed ? 'license-status valid' : 'license-status'}>
          {status?.licensed ? 'مفعّل' : status?.readOnly ? 'يلزم التفعيل' : 'معاينة محلية'}
        </span>
      </div>
      {status ? (
        <>
          <p>
            {status.licensed
              ? 'مرخّص باسم ' + status.customer
              : status.readOnly
                ? 'فعّل هذا الجهاز للبدء في العمليات. بياناتك والعرض والنسخ الاحتياطي متاحون.'
                : 'هذه معاينة محلية للتجربة، وليست بديلًا عن تفعيل نسخة Windows.'}
          </p>
          {status.clockRollback && (
            <p className="alert">راجع توقيت Windows لإعادة العمليات المالية.</p>
          )}
          {status.connectionRequired && (
            <p className="alert">اتصل بالإنترنت ثم حدّث الترخيص لاستئناف العمليات داخل المهلة.</p>
          )}
          {!status.onlineConfigured && (
            <p className="alert">
              خادم التفعيل غير مربوط بهذه النسخة. تجهيز الربط من Xzare: hello@xzare.com ·
              +201501230440
            </p>
          )}
          {status.expiresAt && (
            <p className="muted">
              العمل دون اتصال متاح حتى {new Date(status.expiresAt).toLocaleString('ar-EG')}، ويتجدد
              التصريح عند الاتصال.
            </p>
          )}
          {status.renewError && <p className="alert">{status.renewError}</p>}
          {status.backupError && <p className="alert">{status.backupError}</p>}
          {status.device && (
            <details className="license-support">
              <summary>بيانات الجهاز للدعم</summary>
              <p className="muted">هذا معرّف الجهاز؛ لا يحتوي على كود التفعيل.</p>
              <input
                readOnly
                aria-label="معرّف الجهاز للدعم"
                value={status.device}
                dir="ltr"
                onFocus={(e) => e.currentTarget.select()}
              />
            </details>
          )}
        </>
      ) : (
        <p role="status">جارٍ قراءة حالة الجهاز…</p>
      )}
      {status?.onlineConfigured === undefined && !status?.licensed && !entry && (
        <button
          type="button"
          className="primary"
          disabled={busy || !status?.onlineConfigured}
          onClick={() => {
            setEntry(true)
            setError('')
          }}
        >
          تفعيل هذا الجهاز
        </button>
      )}
      {status?.onlineConfigured === undefined && !status?.licensed && entry && (
        <form
          onSubmit={activate}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !busy) {
              e.preventDefault()
              close()
            }
          }}
        >
          <label className="field">
            <span>كود التفعيل</span>
            <input
              autoFocus
              required
              type="password"
              name="license"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              minLength={43}
              maxLength={4096}
              pattern="[A-Za-z0-9_.-]+"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              dir="ltr"
              disabled={busy}
              onCopy={(e) => e.preventDefault()}
              onCut={(e) => e.preventDefault()}
            />
          </label>
          <p className="muted">
            الصق الكود الذي استلمته من Xzare. الإدخال مخفي ويُمسح بعد المحاولة؛ لا نعرض الكود
            المحفوظ أو نحتفظ به.
          </p>
          <div className="inline-form">
            <button className="primary" disabled={busy}>
              {busy ? 'جارٍ التفعيل…' : 'تفعيل الترخيص'}
            </button>
            <button type="button" disabled={busy} onClick={close}>
              إلغاء التفعيل
            </button>
          </div>
        </form>
      )}
      {status?.onlineConfigured === undefined && status?.licensed && (
        <button
          type="button"
          disabled={busy || !status.onlineConfigured}
          onClick={() => void renew()}
        >
          {busy ? 'جارٍ التحديث…' : 'تحديث حالة الترخيص'}
        </button>
      )}
      {status?.onlineConfigured !== undefined && (
        <ActivationMethods onlineConfigured={status.onlineConfigured} canRenew={true} onActivated={async () => setStatus(await call<Status>('license.status'))} />
      )}
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
      <p className="muted">
        الكود خاص بالتفعيل فقط. مفتاح الجهاز محمي في نسخة Windows ولا يظهر في الواجهة أو النسخ
        الاحتياطية.
      </p>
    </section>
  )
}


