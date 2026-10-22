import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Icon } from '../../pos/src/Icon'
export type AuthValues = {
  businessName: string
  name: string
  username: string
  password: string
}
export function AuthScreen({
  configured,
  busy,
  error,
  onAuthenticate,
}: {
  configured: boolean | null
  busy: boolean
  error: string
  onAuthenticate: (v: AuthValues) => Promise<void>
}) {
  const [step, setStep] = useState(1),
    [v, setV] = useState<AuthValues>({
      businessName: '',
      name: '',
      username: '',
      password: '',
    }),
    [confirm, setConfirm] = useState(''),
    [visible, setVisible] = useState(false),
    [validation, setValidation] = useState(''),
    [caps, setCaps] = useState(false)
  const form = useRef<HTMLFormElement>(null),
    mutex = useRef(false)
  useEffect(() => {
    form.current?.querySelector<HTMLInputElement>('input')?.focus()
  }, [step, configured])
  const edit = (key: keyof AuthValues, value: string) => {
    setV((old) => ({ ...old, [key]: value }))
    setValidation('')
  }
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy || mutex.current) return
    if (!configured && step === 1) {
      setStep(2)
      return
    }
    if (!configured && v.password !== confirm) {
      setValidation('كلمتا المرور غير متطابقتين')
      return
    }
    mutex.current = true
    try {
      await onAuthenticate(v)
    } catch {
      setV((old) => ({ ...old, password: '' }))
      setConfirm('')
      setVisible(false)
      form.current?.querySelector<HTMLInputElement>('[name=password]')?.focus()
    } finally {
      mutex.current = false
    }
  }
  return (
    <main className="auth gym-auth">
      <section className="auth-brand">
        <div className="auth-wordmark">
          <img className="gym-mark" src="./icon.svg" alt="" />
          <div>
            XZARE<small>GYM</small>
          </div>
        </div>
        <div className="auth-story">
          <span className="auth-kicker">كل عضو، بداية جديدة</span>
          <h1>
            استقبال أسرع.
            <br />
            عضويات واضحة.
          </h1>
          <p>اشتراكات وتجديدات وحضور ومدربون؛ تابع يوم الجيم من مكان واحد.</p>
          <div className="gym-auth-route">
            <span>بطاقة العضو</span>
            <i />
            <span>تسجيل الدخول</span>
            <i />
            <span>تجديد الاشتراك</span>
          </div>
        </div>
        <div className="auth-footer">
          <span>XZARE SOFTWARE SOLUTIONS</span>
          <span dir="ltr">hello@xzare.com · +201501230440</span>
        </div>
      </section>
      <section className="auth-panel" aria-labelledby="auth-title">
        <span className="eyebrow">XZARE GYM / 0.1</span>
        <h2 id="auth-title">
          {configured === null
            ? 'جارٍ فتح الجيم'
            : configured
              ? 'أهلًا بعودتك'
              : step === 1
                ? 'ابدأ بالجيم'
                : 'أنشئ حساب المسؤول'}
        </h2>
        <p className="muted">
          {configured
            ? 'سجّل الدخول للمتابعة.'
            : 'أضف بيانات الجيم الفعلية؛ الأعضاء والاشتراكات يبدأون فارغين.'}
        </p>
        {configured === false && (
          <div className="auth-progress">
            <span>الخطوة {step} من 2</span>
            <div>
              <i className="done" />
              <i className={step === 2 ? 'done' : ''} />
            </div>
          </div>
        )}
        {(validation || error) && (
          <p role="alert" className="alert error">
            {validation || error}
          </p>
        )}
        {configured === null ? (
          <button onClick={() => window.location.reload()}>
            إعادة المحاولة
          </button>
        ) : (
          <form
            className="auth-form"
            ref={form}
            onSubmit={submit}
            aria-busy={busy}
          >
            {!configured && step === 1 ? (
              <>
                <label className="field">
                  <span>اسم الجيم</span>
                  <input
                    name="businessName"
                    required
                    maxLength={160}
                    value={v.businessName}
                    onChange={(e) => edit('businessName', e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>اسم المسؤول</span>
                  <input
                    name="name"
                    required
                    maxLength={160}
                    value={v.name}
                    onChange={(e) => edit('name', e.target.value)}
                  />
                </label>
              </>
            ) : (
              <>
                <label className="field">
                  <span>اسم المستخدم</span>
                  <input
                    name="username"
                    required
                    pattern="[A-Za-z0-9_.\-]{3,40}"
                    maxLength={40}
                    autoComplete="username"
                    dir="ltr"
                    value={v.username}
                    onChange={(e) => edit('username', e.target.value)}
                  />
                </label>
                <small>
                  3–40 حرفًا إنجليزيًا أو رقمًا، ويمكن استخدام . _ -
                </small>
                <div className="field">
                  <label htmlFor="gym-password">كلمة المرور</label>
                  <div className="password-field">
                    <input
                      id="gym-password"
                      name="password"
                      type={visible ? 'text' : 'password'}
                      required
                      minLength={configured ? 1 : 12}
                      maxLength={128}
                      autoComplete={
                        configured ? 'current-password' : 'new-password'
                      }
                      dir="ltr"
                      value={v.password}
                      onChange={(e) => edit('password', e.target.value)}
                      onKeyUp={(e) => setCaps(e.getModifierState('CapsLock'))}
                      onBlur={() => setCaps(false)}
                    />
                    <button
                      type="button"
                      className="password-toggle"
                      aria-label={
                        visible ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'
                      }
                      aria-pressed={visible}
                      onClick={() => setVisible(!visible)}
                    >
                      <Icon name={visible ? 'eyeOff' : 'eye'} />
                    </button>
                  </div>
                </div>
                {caps && <small>Caps Lock مفعّل</small>}
                {!configured && (
                  <>
                    <small>كلمة مرور خاصة لا تقل عن 12 حرفًا.</small>
                    <label className="field">
                      <span>تأكيد كلمة المرور</span>
                      <input
                        type="password"
                        name="confirmPassword"
                        required
                        minLength={12}
                        maxLength={128}
                        autoComplete="new-password"
                        dir="ltr"
                        value={confirm}
                        onChange={(e) => {
                          setConfirm(e.target.value)
                          setValidation('')
                        }}
                      />
                    </label>
                  </>
                )}
              </>
            )}
            <button className="primary large" disabled={busy}>
              {busy
                ? 'جارٍ التحقق…'
                : configured
                  ? 'دخول إلى الجيم'
                  : step === 1
                    ? 'متابعة إلى الحساب'
                    : 'إنشاء الجيم'}
            </button>
            {!configured && step === 2 && (
              <button type="button" disabled={busy} onClick={() => setStep(1)}>
                العودة لبيانات الجيم
              </button>
            )}
          </form>
        )}
        <div className="local-note">
          <Icon name="lock" />
          <span>
            البيانات محفوظة على هذا الجهاز.
            <small>
              الاتصال مطلوب للتفعيل والتجديد؛ العمل دون اتصال داخل مهلة الترخيص.
            </small>
          </span>
        </div>
        {configured && (
          <p className="auth-recovery">
            لإعادة تعيين كلمة المرور تواصل مع مسؤول الجيم، أو دعم Xzare لحساب
            المسؤول.
          </p>
        )}
      </section>
    </main>
  )
}
