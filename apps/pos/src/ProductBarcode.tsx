import { useRef, useState } from 'react'
import { Barcode, type BarcodeFormat } from '@xzare/barcode'
import type { Product } from '@xzare/engine'
import { call } from './bridge'
export function ProductBarcode({
  product,
  open,
}: {
  product?: Product
  open: (p: Product) => void
}) {
  const [code, setCode] = useState(product?.barcode ?? ''),
    [format, setFormat] = useState<BarcodeFormat>((product?.format ?? 'CODE128') as BarcodeFormat)
  const [message, setMessage] = useState(''),
    [existing, setExisting] = useState<Product | null>(null)
  const generation = useRef(0),
    input = useRef<HTMLInputElement>(null)
  const valid = !code || Barcode.parse(code, format).ok
  async function check() {
    const current = ++generation.current
    if (!code) {
      setMessage('')
      return
    }
    if (!Barcode.parse(code, format).ok) {
      setMessage('راجع الصيغة ورقم المراجعة؛ الباركود لم يُحفظ')
      return
    }
    setMessage('جارٍ فحص الباركود…')
    try {
      const result = await call<{ product: Product | null }>('product.barcodeCheck', { code })
      if (generation.current !== current) return
      if (result.product && result.product.id !== product?.id) {
        setExisting(result.product)
        setMessage(`الباركود مسجل للصنف: ${result.product.name}`)
      } else {
        setExisting(null)
        setMessage('الباركود صالح؛ أكمل بيانات الصنف ثم احفظ')
      }
    } catch {
      if (generation.current === current)
        setMessage('تعذر فحص الباركود؛ الحفظ سيعيد التحقق من عدم التكرار')
    }
  }
  return (
    <div className="full barcode-registration">
      <label className="field">
        <span>الباركود</span>
        <input
          ref={input}
          name="barcode"
          value={code}
          maxLength={64}
          dir="ltr"
          autoComplete="off"
          spellCheck={false}
          placeholder="امسح بالقارئ أو اكتب الكود ثم Enter"
          onChange={(e) => {
            generation.current++
            setCode(e.target.value)
            setExisting(null)
            setMessage('')
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              e.stopPropagation()
              void check()
            }
          }}
          onBlur={() => {
            void check()
          }}
          aria-invalid={!valid || !!existing}
        />
      </label>
      <label className="field">
        <span>صيغة الباركود</span>
        <select
          name="format"
          value={format}
          onChange={(e) => {
            generation.current++
            setFormat(e.target.value as BarcodeFormat)
            setExisting(null)
            setMessage('')
          }}
        >
          {['CODE128', 'EAN13', 'EAN8', 'UPCA', 'GTIN14'].map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
      </label>
      <div className="toolbar">
        <button type="button" onClick={() => input.current?.focus()}>
          مسح باركود الصنف
        </button>
        <button
          type="button"
          onClick={() => {
            void check()
          }}
        >
          فحص الباركود
        </button>
        {existing && (
          <button type="button" onClick={() => open(existing)}>
            فتح الصنف المسجل
          </button>
        )}
      </div>
      <p role="status" className={existing || !valid ? 'alert' : 'muted'}>
        {message ||
          'Enter يفحص الكود دون حفظ الصنف. اختر EAN أو UPC للباركود التجاري؛ CODE128 للأكواد الداخلية. الأصفار في البداية محفوظة.'}
      </p>
    </div>
  )
}
