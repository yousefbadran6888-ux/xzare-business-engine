import { useEffect, useRef, useState, type ReactNode } from 'react'
import { call } from './bridge'
import { BrandMark } from './BrandMark'
import './activation.css'
export type BootStatus = { configured: boolean; activationRequired: boolean; onlineConfigured?: boolean; licensed?: boolean; canRenew?: boolean }
type QuotaDevice = { id: string; deviceName: string; activatedAt: number; lastSeenAt: number }
type QuotaError = Error & { devices?: QuotaDevice[] }
function saveChallenge(challenge: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(challenge, null, 2)], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = 'Xzare-activation-request.json'; anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
/** Shared by the first launch gate and authenticated administrator license management. */
export function ActivationMethods({ onlineConfigured, canRenew = false, onActivated }: {
  onlineConfigured: boolean; canRenew?: boolean; onActivated: () => void | Promise<void>
}) {
  const [secret, setSecret] = useState(''), [busy, setBusy] = useState(false),
    [error, setError] = useState(''), [notice, setNotice] = useState(''),
    [devices, setDevices] = useState<QuotaDevice[]>([]), mutex = useRef(false)
  useEffect(() => {
    const clear = () => setSecret('')
    const hidden = () => { if (document.visibilityState === 'hidden') clear() }
    window.addEventListener('blur', clear); document.addEventListener('visibilitychange', hidden)
    return () => { window.removeEventListener('blur', clear); document.removeEventListener('visibilitychange', hidden) }
  }, [])
  async function perform(action: 'activate' | 'renew' | 'export' | 'import', response?: string) {
    if (mutex.current) return
    mutex.current = true; setBusy(true); setError(''); setNotice(''); setDevices([])
    const code = secret.trim(); setSecret('')
    try {
      if (action === 'activate') {
        await call('license.activate', { license: code }); await onActivated()
      } else if (action === 'renew') {
        await call('license.renew'); await onActivated()
      } else if (action === 'export') {
        const result = await call<{ challenge: unknown }>('license.offline.export', code ? { license: code } : {})
        saveChallenge(result.challenge)
        setNotice('تم حفظ طلب هذا الجهاز. افتحه في حسابك لدى Xzare خلال 24 ساعة، ثم استورد ملف الاستجابة هنا.')
      } else {
        await call('license.offline.import', { response }); await onActivated()
        setNotice('تم التحقق من الاستجابة وتفعيل هذا الجهاز.')
      }
    } catch (e) {
      const failure = e as QuotaError
      setError(e instanceof Error ? e.message : 'تعذر التفعيل')
      if (Array.isArray(failure.devices)) setDevices(failure.devices.slice(0, 2))
    } finally { mutex.current = false; setBusy(false) }
  }
  return <div className="xz-activation-methods">
    <form onSubmit={(event) => { event.preventDefault(); void perform('activate') }}>
      <label className="xz-activation-field"><span>كود الشراء</span>
        <input type="password" autoComplete="off" autoCapitalize="none" spellCheck={false} dir="ltr"
          name="license" value={secret} onChange={(e) => setSecret(e.target.value)} maxLength={4096}
          placeholder="الصق كود الشراء الذي استلمته" disabled={busy} />
      </label>
      <p className="xz-activation-hint">الكود مخفي ويُمسح بعد كل محاولة. الترخيص مخصص لجهاز واحد أو جهازين حسب خطة الشراء.</p>
      <div className="xz-activation-buttons">
        <button className="primary" type="submit" disabled={busy || !onlineConfigured || !secret.trim()}>{busy ? 'جارٍ التحقق…' : 'تفعيل عبر الإنترنت'}</button>
        {canRenew ? <button type="button" disabled={busy || !onlineConfigured} onClick={() => void perform('renew')}>تحديث تصريح الجهاز</button> : null}
      </div>
    </form>
    {!onlineConfigured ? <p className="xz-activation-hint">الاتصال بخادم التفعيل غير مجهّز لهذه النسخة. استخدم ملف التفعيل دون إنترنت أو تواصل مع الدعم.</p> : null}
    <details className="xz-offline-activation">
      <summary>تفعيل أو تجديد دون إنترنت</summary>
      <ol>
        <li>{canRenew ? 'اترك كود الشراء فارغًا لتجديد تصريح الجهاز، أو الصقه لتغيير الترخيص.' : 'الصق كود الشراء في الحقل أعلاه ثم صدّر طلب هذا الجهاز.'}</li>
        <li>انقل الطلب إلى جهاز متصل، وسجّل الدخول إلى حسابك لدى Xzare للحصول على الاستجابة.</li>
        <li>استورد الاستجابة على هذا الجهاز. يتطلب كل تجديد طلبًا جديدًا ويستمر التصريح بحد أقصى سبعة أيام.</li>
      </ol>
      <p className="xz-activation-hint">ملف الطلب خاص وقد يحتوي على كود الشراء؛ احتفظ به بأمان. كل طلب صالح لمدة 24 ساعة فقط.</p>
      <div className="xz-activation-buttons">
        <button type="button" disabled={busy || (!canRenew && !secret.trim())} onClick={() => void perform('export')}>تصدير طلب التفعيل</button>
        <label className="xz-activation-file">استيراد ملف الاستجابة
          <input type="file" accept=".json,application/json" disabled={busy} onChange={(event) => {
            const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''
            if (!file) return
            if (file.size > 20000) { setError('ملف الاستجابة أكبر من الحجم المسموح'); return }
            void file.text().then((raw) => perform('import', raw)).catch(() => setError('تعذر قراءة ملف الاستجابة'))
          }} />
        </label>
      </div>
    </details>
    {error ? <p className="xz-activation-error" role="alert">{error}</p> : null}
    {devices.length ? <div className="xz-activation-quota"><p>الأجهزة المسجّلة لهذا الترخيص:</p><ul>{devices.map((device) => <li key={device.id}>{device.deviceName}</li>)}</ul><p>ألغِ تفعيل الجهاز السابق من حسابك، ثم أعد محاولة التفعيل.</p></div> : null}
    {notice ? <p className="xz-activation-notice" role="status">{notice}</p> : null}
  </div>
}
export function ActivationGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<BootStatus>(), [error, setError] = useState('')
  async function refresh() {
    try { setStatus(await call<BootStatus>('boot.status')); setError('') }
    catch (e) { setError(e instanceof Error ? e.message : 'تعذر التحقق من حالة بدء التشغيل') }
  }
  useEffect(() => { void refresh() }, [])
  if (status && !status.activationRequired) return children
  return <main className="xz-activation-page" dir="rtl">
    <section className="xz-activation-shell" aria-labelledby="xz-activation-title">
      <header><BrandMark /><div><p className="xz-activation-eyebrow">XZARE · بدء التشغيل</p><h1 id="xz-activation-title">فعّل البرنامج على هذا الجهاز</h1></div></header>
      <p className="xz-activation-intro">ابدأ بكود الشراء. بعد التفعيل يمكنك إنشاء حساب المدير وإعداد نشاطك.</p>
      <div className="xz-activation-steps" aria-label="خطوات البدء"><strong>١ التفعيل</strong><span>٢ حساب المدير</span><span>٣ إعداد النشاط</span></div>
      {!status ? <p role="status">{error || 'جارٍ التحقق من الجهاز…'}</p> : <ActivationMethods onlineConfigured={status.onlineConfigured === true} canRenew={status.canRenew} onActivated={refresh} />}
      {!status && error ? <button type="button" onClick={() => void refresh()}>إعادة المحاولة</button> : null}
      <footer>مساعدة التفعيل: <a href="mailto:hello@xzare.com">hello@xzare.com</a> · <span dir="ltr">+201501230440</span></footer>
    </section>
  </main>
}
