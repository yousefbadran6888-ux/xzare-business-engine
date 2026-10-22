export interface Bridge {
  call(action: string, payload?: unknown): Promise<unknown>
}
declare global {
  interface Window {
    xzare?: Bridge
  }
}
export async function call<T = unknown>(action: string, payload: unknown = {}): Promise<T> {
  if (window.xzare) return window.xzare.call(action, payload) as Promise<T>
  const response = await fetch('/api/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Xzare-Request': '1' },
    body: JSON.stringify({ action, payload }),
    credentials: 'same-origin',
  })
  const data = (await response.json()) as { ok: boolean; value: T; error?: string; code?: string; devices?: unknown[] }
  if (!response.ok || !data.ok) {
    const error = new Error(data.error ?? 'تعذر إتمام العملية') as Error & { devices?: unknown[] }
    if (data.code === 'DEVICE_QUOTA_EXCEEDED' && Array.isArray(data.devices)) error.devices = data.devices.slice(0, 2)
    throw error
  }
  return data.value
}
