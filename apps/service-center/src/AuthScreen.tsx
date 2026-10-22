import { useEffect, useRef, useState, type FormEvent } from 'react'
import { BrandMark } from '../../pos/src/BrandMark'
import { Icon } from '../../pos/src/Icon'

export type AuthValues = { businessName: string; name: string; username: string; password: string }
export function AuthScreen({
  configured,
  busy,
  error,
  onAuthenticate,
  product = 'pos',
}: {
  configured: boolean | null
  busy: boolean
  error: string
  onAuthenticate: (values: AuthValues) => Promise<void>
  product?: 'pos' | 'restaurant' | 'accounting' | 'inventory' | 'manufacturing' | 'service-center'
}) {
  const [step, setStep] = useState(1),
    [values, setValues] = useState<AuthValues>({
      businessName: '',
      name: '',
      username: '',
      password: '',
    })
  const [confirmation, setConfirmation] = useState(''),
    [visible, setVisible] = useState(false),
    [validation, setValidation] = useState(''),
    [caps, setCaps] = useState(false)
  const formRef = useRef<HTMLFormElement>(null),
    submitting = useRef(false)
  useEffect(() => {
    formRef.current?.querySelector<HTMLInputElement>('input')?.focus()
  }, [step, configured])
  const update = (key: keyof AuthValues, value: string) => {
    setValues((previous) => ({ ...previous, [key]: value }))
    setValidation('')
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || submitting.current) return
    if (!configured && step === 1) {
      if (!values.businessName.trim() || !values.name.trim()) {
        setValidation(
          product === 'accounting' ||
            product === 'inventory' ||
            product === 'manufacturing' ||
            product === 'service-center'
            ? 'اكتب اسم الشركة واسم المسؤول'
            : product === 'restaurant'
              ? 'اكتب اسم المطعم واسم المسؤول'
              : 'اكتب اسم المتجر واسم المسؤول',
        )
        return
      }
      setValidation('')
      setStep(2)
      return
    }
    if (!configured && values.password !== confirmation) {
      setValidation('كلمتا المرور غير متطابقتين')
      return
    }
    submitting.current = true
    try {
      await onAuthenticate(values)
    } catch {
      setValues((previous) => ({ ...previous, password: '' }))
      setConfirmation('')
      setVisible(false)
      formRef.current?.querySelector<HTMLInputElement>('[name="password"]')?.focus()
    } finally {
      submitting.current = false
    }
  }
  return (
    <main className="auth">
      <section className="auth-brand">
        <div className="auth-wordmark">
          <BrandMark />
          <div>
            XZARE<small>BUSINESS ENGINE</small>
          </div>
        </div>
        <div className="auth-story">
          <span className="auth-kicker">مساحة عملك، بوضوح.</span>
          <h1>
            كل جهاز له حكاية.
            <br />
            وكل إصلاح له سجل.
          </h1>
          <p>
            {product === 'accounting' ||
            product === 'inventory' ||
            product === 'manufacturing' ||
            product === 'service-center'
              ? product === 'manufacturing' || product === 'service-center'
                ? product === 'service-center'
                  ? 'من استقبال الجهاز إلى تسليمه؛ أوامر صيانة وقطع غيار وتكلفة وتحصيل موثّق.'
                  : 'من الخامة إلى المنتج؛ أوامر إنتاج واحتياجات مواد وهالك وتكلفة فعلية.'
                : product === 'inventory'
                  ? 'من الاستلام إلى الجرد؛ مستودعات وباركود وتشغيلات وأرصدة من حركاتك الفعلية.'
                  : 'من القيد إلى التقرير؛ دليل حسابات وقيود مزدوجة وأرقام من دفاترك الفعلية.'
              : product === 'restaurant'
                ? 'من استقبال الضيف إلى تحضير الطلب؛ الطاولات والمطبخ والتحصيل في مساحة واحدة.'
                : 'من أول باركود إلى آخر فاتورة؛ البيع والمخزون والخزينة في مساحة واحدة.'}
          </p>
          <div className="auth-features">
            <span>
              <Icon name="barcode" />{' '}
              {product === 'accounting' ||
              product === 'inventory' ||
              product === 'manufacturing' ||
              product === 'service-center'
                ? product === 'manufacturing' || product === 'service-center'
                  ? product === 'service-center'
                    ? 'أجهزة وضمان وقطع غيار بالباركود'
                    : 'قوائم خامات وتصنيع موثق بالباركود'
                  : product === 'inventory'
                    ? 'تشغيلات وأرقام تسلسلية وباركود'
                    : 'قيود متوازنة ودفاتر قابلة للتدقيق'
                : product === 'restaurant'
                  ? 'وصفات وخصم فعلي للخامات'
                  : 'تسجيل وبيع بالباركود'}
            </span>
            <span>
              <Icon name="reports" /> أرقام من عملياتك الفعلية
            </span>
            <span>
              <Icon name="audit" /> صلاحيات لكل مستخدم
            </span>
          </div>
        </div>
        <div className="auth-footer">
          <span>XZARE SOFTWARE SOLUTIONS</span>
          <span dir="ltr">hello@xzare.com · +201501230440</span>
        </div>
      </section>
      <section className="auth-panel" aria-labelledby="auth-title">
        <div className="auth-mobile-brand">
          <BrandMark />
          <strong>
            XZARE{' '}
            {product === 'accounting' ||
            product === 'inventory' ||
            product === 'manufacturing' ||
            product === 'service-center'
              ? product === 'manufacturing' || product === 'service-center'
                ? product === 'service-center'
                  ? 'SERVICE CENTER'
                  : 'MANUFACTURING'
                : product === 'inventory'
                  ? 'INVENTORY'
                  : 'ACCOUNTING'
              : product === 'restaurant'
                ? 'RESTAURANT'
                : 'POS'}
          </strong>
        </div>
        <div className="auth-heading-icon">
          <Icon name={configured ? 'lock' : 'products'} />
        </div>
        <span className="eyebrow">
          {product === 'accounting' ||
          product === 'inventory' ||
          product === 'manufacturing' ||
          product === 'service-center'
            ? product === 'manufacturing' || product === 'service-center'
              ? product === 'service-center'
                ? 'XZARE SERVICE CENTER / 0.1'
                : 'XZARE MANUFACTURING / 0.1'
              : product === 'inventory'
                ? 'XZARE INVENTORY / 0.1'
                : 'XZARE ACCOUNTING / 0.1'
            : product === 'restaurant'
              ? 'XZARE RESTAURANT / 0.2'
              : 'XZARE POS / 0.3'}
        </span>
        <h2 id="auth-title">
          {configured === null
            ? 'نجهّز مساحة عملك'
            : configured
              ? 'أهلًا بعودتك'
              : step === 1
                ? product === 'accounting' ||
                  product === 'inventory' ||
                  product === 'manufacturing' ||
                  product === 'service-center'
                  ? product === 'service-center'
                    ? 'ابدأ بمركزك'
                    : 'ابدأ بشركتك'
                  : product === 'restaurant'
                    ? 'ابدأ بمطعمك'
                    : 'ابدأ بمتجرك'
                : 'أنشئ حسابك'}
        </h2>
        <p className="muted">
          {configured
            ? 'سجّل الدخول، وكمل يومك من حيث توقفت.'
            : 'إعداد بسيط ببياناتك الفعلية. أنت تضيف الأصناف والعمليات.'}
        </p>
        {configured === false && (
          <div className="auth-progress">
            <span>الخطوة {step} من 2</span>
            <div>
              <i className="done" />
              <i className={step === 2 ? 'done' : ''} />
            </div>
            <small>
              {step === 1
                ? product === 'accounting' ||
                  product === 'inventory' ||
                  product === 'manufacturing' ||
                  product === 'service-center'
                  ? 'الشركة والمسؤول'
                  : product === 'restaurant'
                    ? 'المطعم والمسؤول'
                    : 'المتجر والمسؤول'
                : 'بيانات الدخول'}
            </small>
          </div>
        )}
        {(validation || error) && (
          <div className="alert error" role="alert">
            {validation || error}
          </div>
        )}
        {configured === null ? (
          <div className="auth-loading" role="status">
            {error ? (
              <button onClick={() => window.location.reload()}>إعادة المحاولة</button>
            ) : (
              'جارٍ الاتصال بقاعدة البيانات…'
            )}
          </div>
        ) : (
          <form className="auth-form" ref={formRef} onSubmit={submit} aria-busy={busy}>
            {!configured && step === 1 ? (
              <>
                <label className="field">
                  <span>
                    {product === 'accounting' ||
                    product === 'inventory' ||
                    product === 'manufacturing' ||
                    product === 'service-center'
                      ? 'اسم الشركة'
                      : product === 'restaurant'
                        ? 'اسم المطعم'
                        : 'اسم المتجر'}
                  </span>
                  <input
                    name="businessName"
                    value={values.businessName}
                    onChange={(e) => update('businessName', e.target.value)}
                    required
                    maxLength={160}
                    autoComplete="organization"
                    placeholder={
                      product === 'accounting' ||
                      product === 'inventory' ||
                      product === 'manufacturing' ||
                      product === 'service-center'
                        ? 'اسم شركتك'
                        : product === 'restaurant'
                          ? 'اسم مطعمك'
                          : 'اسم متجرك'
                    }
                  />
                </label>
                <label className="field">
                  <span>اسم المسؤول</span>
                  <input
                    name="name"
                    value={values.name}
                    onChange={(e) => update('name', e.target.value)}
                    required
                    maxLength={160}
                    autoComplete="name"
                    placeholder="اسمك كما سيظهر في البرنامج"
                  />
                </label>
              </>
            ) : (
              <>
                <label className="field">
                  <span>اسم المستخدم</span>
                  <input
                    name="username"
                    value={values.username}
                    onChange={(e) => update('username', e.target.value)}
                    required
                    pattern="[A-Za-z0-9_.\-]{3,40}"
                    maxLength={40}
                    autoComplete="username"
                    dir="ltr"
                    aria-describedby="username-help"
                  />
                </label>
                <small id="username-help">
                  من 3 إلى 40 حرفًا إنجليزيًا أو رقمًا؛ يمكن استخدام . _ -
                </small>
                <div className="field">
                  <label htmlFor="auth-password">كلمة المرور</label>
                  <div className="password-field">
                    <input
                      id="auth-password"
                      name="password"
                      type={visible ? 'text' : 'password'}
                      required
                      minLength={configured ? 1 : 12}
                      maxLength={128}
                      autoComplete={configured ? 'current-password' : 'new-password'}
                      dir="ltr"
                      value={values.password}
                      onChange={(e) => update('password', e.target.value)}
                      onKeyUp={(e) => setCaps(e.getModifierState('CapsLock'))}
                      onKeyDown={(e) => setCaps(e.getModifierState('CapsLock'))}
                      onBlur={() => setCaps(false)}
                      aria-describedby={!configured ? 'password-help' : undefined}
                    />
                    <button
                      type="button"
                      className="password-toggle"
                      aria-label={visible ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                      aria-pressed={visible}
                      onClick={() => setVisible(!visible)}
                    >
                      <Icon name={visible ? 'eyeOff' : 'eye'} />
                    </button>
                  </div>
                </div>
                {caps && <small role="status">مفتاح Caps Lock مفعّل.</small>}
                {!configured && (
                  <>
                    <small id="password-help">
                      12 حرفًا على الأقل. استخدم كلمة مرور خاصة بهذا الحساب.
                    </small>
                    <label className="field">
                      <span>تأكيد كلمة المرور</span>
                      <input
                        name="confirmPassword"
                        type="password"
                        required
                        minLength={12}
                        maxLength={128}
                        autoComplete="new-password"
                        dir="ltr"
                        value={confirmation}
                        onChange={(e) => {
                          setConfirmation(e.target.value)
                          setValidation('')
                        }}
                      />
                    </label>
                  </>
                )}
              </>
            )}
            <button className="primary large auth-submit" disabled={busy}>
              <span>
                {busy
                  ? 'جارٍ التحقق…'
                  : configured
                    ? 'دخول إلى البرنامج'
                    : step === 1
                      ? 'متابعة إلى الحساب'
                      : product === 'accounting' ||
                          product === 'inventory' ||
                          product === 'manufacturing' ||
                          product === 'service-center'
                        ? 'إنشاء الشركة'
                        : product === 'restaurant'
                          ? 'إنشاء المطعم'
                          : 'إنشاء المتجر'}
              </span>
              <Icon name={busy ? 'shifts' : 'arrow'} />
            </button>
            {!configured && step === 2 && (
              <button
                type="button"
                className="auth-back"
                disabled={busy}
                onClick={() => {
                  setStep(1)
                  setValidation('')
                  setVisible(false)
                }}
              >
                {product === 'accounting' ||
                product === 'inventory' ||
                product === 'manufacturing' ||
                product === 'service-center'
                  ? 'العودة لبيانات الشركة'
                  : product === 'restaurant'
                    ? 'العودة لبيانات المطعم'
                    : 'العودة لبيانات المتجر'}
              </button>
            )}
          </form>
        )}
        <div className="local-note">
          <Icon name="device" />
          <span>
            {product === 'accounting' ||
            product === 'inventory' ||
            product === 'manufacturing' ||
            product === 'service-center'
              ? 'بيانات الشركة محفوظة على هذا الجهاز.'
              : product === 'restaurant'
                ? 'بيانات المطعم محفوظة على هذا الجهاز.'
                : 'بيانات المتجر محفوظة على هذا الجهاز.'}
            <small>الاتصال مطلوب للتفعيل والتجديد؛ العمل دون اتصال داخل مهلة الترخيص.</small>
          </span>
        </div>
        {configured && (
          <p className="auth-recovery">
            نسيت كلمة المرور؟ اطلب من مسؤول المركز إعادة تعيينها. لحساب المسؤول: تواصل مع دعم Xzare.
          </p>
        )}
      </section>
    </main>
  )
}
