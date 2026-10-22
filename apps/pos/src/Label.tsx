import { useEffect, useRef, useState } from 'react'
import type { Product } from '@xzare/engine'

export function Label({ product }: { product: Product }) {
  const canvas = useRef<HTMLCanvasElement>(null),
    [error, setError] = useState('')
  useEffect(() => {
    let live = true
    import('bwip-js/browser')
      .then((module) => {
        if (!live || !canvas.current || !product.barcode) return
        const format: Record<string, string> = {
          EAN13: 'ean13',
          EAN8: 'ean8',
          UPCA: 'upca',
          GTIN14: 'itf14',
          CODE128: 'code128',
        }
        module.default.toCanvas(canvas.current, {
          bcid: format[product.format ?? 'CODE128'] ?? 'code128',
          text: product.barcode,
          scale: 3,
          height: 12,
          includetext: true,
          textxalign: 'center',
          paddingwidth: 12,
          paddingheight: 3,
        })
      })
      .catch((e) => {
        if (live) setError(e instanceof Error ? e.message : 'تعذر توليد الباركود')
      })
    return () => {
      live = false
    }
  }, [product.barcode, product.format])
  return (
    <div className="barcode-label print-area">
      <strong>{product.name}</strong>
      <span>
        {(product.price / 100).toFixed(2)} ج.م / {product.unit}
      </span>
      {error ? <p role="alert">{error}</p> : <canvas ref={canvas} />}
    </div>
  )
}
