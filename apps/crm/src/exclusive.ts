export async function exclusive<T>(
  lock: { current: boolean },
  busy: (v: boolean) => void,
  operation: () => Promise<T>,
): Promise<T> {
  if (lock.current) throw new Error('انتظر انتهاء العملية')
  lock.current = true
  busy(true)
  try {
    return await operation()
  } finally {
    lock.current = false
    busy(false)
  }
}
