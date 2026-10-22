export function paymentKey(value: string, key: string, replace = false): string {
  if (key === 'clear') return '0'
  if (key === 'backspace') return value.slice(0, -1) || '0'
  if (!/^[0-9.]$/.test(key)) return value
  const base = replace ? '0' : value
  if (!/^\d*(\.\d{0,2})?$/.test(base)) return value
  if (key === '.') return base.includes('.') ? base : (base || '0') + '.'
  const next = base === '0' ? key : base + key
  return /^\d{1,12}(\.\d{0,2})?$/.test(next) ? next : value
}
